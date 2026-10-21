const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { sendEmail } = require('../services/mailer');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const { normalizeEmail, isValidEmail, normalizeInviteCode, plainText } = require('../helpers');
const { RoomError, createRoom, joinRoom, getRoomMembers, canViewRoom } = require('../services/rooms');
const {
    createRejoinRequest,
    listApprovableRequests,
    decideRejoinRequest,
    collectRejoinRequest,
    cancelRejoinRequest,
} = require('../services/rejoinRequests');
const { emitToRoom } = require('../services/roomEvents');
const { createAgentSeat, listAgentSeats, renameAgentSeat, revokeAgentSeat, agentInvitePrompt } = require('../services/agentSeats');

const router = express.Router();
const VALID_ROOM_STATUSES = new Set(['waiting', 'in_progress', 'completed']);
const config = getConfig();
const roomCreateRateLimit = createRateLimiter({
    name: 'room_create',
    ...config.rateLimits.roomCreate,
    keyGenerator: getRequestActorKey,
});

const rejoinRequestRateLimit = createRateLimiter({
    name: 'rejoin_request',
    ...config.rateLimits.rejoinRequest,
    keyGenerator: getRequestActorKey,
});
const rejoinCollectRateLimit = createRateLimiter({
    name: 'rejoin_collect',
    ...config.rateLimits.rejoinCollect,
    keyGenerator: getRequestActorKey,
});

function getRoomWithMembers(roomId) {
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    if (!room) return null;
    return attachRoomMembers(room);
}

function attachRoomMembers(room, members = getRoomMembers(room.id)) {
    return { ...room, room_members: members };
}

function getRoomByInviteCode(code) {
    return db.prepare(`SELECT * FROM rooms WHERE invite_code = ?`).get(normalizeInviteCode(code));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Outgoing mail is limited per sender and per recipient, so the endpoints
// below can't be used to spam an address.
const emailSenderLimit = createRateLimiter({ name: 'email_sender', ...config.rateLimits.emailSender });
const emailRecipientLimit = createRateLimiter({ name: 'email_recipient', ...config.rateLimits.emailRecipient });

function emailAllowed(senderKey, recipient) {
    return emailSenderLimit.check(senderKey).allowed && emailRecipientLimit.check(recipient).allowed;
}

// Invite email: only an email-verified member of the room can send it, and the
// code and room name come from the database, never from the request.
async function sendInviteCodeEmail({ senderUserId, email, inviteCode }) {
    const recipient = normalizeEmail(email);
    if (!recipient || !isValidEmail(recipient)) throw new RoomError(400, 'Valid email required');

    const sender = db.prepare(`SELECT email, is_anonymous FROM users WHERE id = ?`).get(senderUserId);
    if (!sender || sender.is_anonymous || !sender.email) {
        throw new RoomError(403, 'Sign in with your email to send invites');
    }
    const room = getRoomByInviteCode(inviteCode);
    if (!room || !canViewRoom(room.id, senderUserId)) {
        throw new RoomError(404, 'Room not found');
    }
    if (!emailAllowed(`user:${senderUserId}`, recipient)) throw new RoomError(429, 'Too many emails. Try again later.');

    const roomName = plainText(room.name, 60) || 'Mortgage Backed Monopoly';
    await sendEmail(
        recipient,
        `Your room code for ${roomName}`,
        `Your invite code is: ${room.invite_code}\n\nShare it with friends to join your game.`,
        `<p>Your invite code is: <strong>${escapeHtml(room.invite_code)}</strong></p><p>Share it with friends to join your game.</p>`
    );
}

async function sendForgotRoomCodes(email, requesterKey) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        return { status: 400, body: { error: 'Valid email required' } };
    }
    // Same answer whether or not anything is sent, so this can't probe accounts.
    if (!emailAllowed(requesterKey, normalizedEmail)) return { status: 200, body: { ok: true } };

    const rooms = db.prepare(`
        SELECT DISTINCT rooms.name, rooms.invite_code, rooms.status
        FROM rooms
        JOIN room_members ON room_members.room_id = rooms.id
        JOIN users ON users.id = room_members.user_id
        WHERE lower(users.email) = ?
        ORDER BY rooms.created_at DESC
    `).all(normalizedEmail);

    if (rooms.length > 0) {
        const listText = rooms.map(room => `${room.name}: ${room.invite_code} (${room.status})`).join('\n');
        const listHtml = rooms
            .map(room => `<li><strong>${escapeHtml(room.invite_code)}</strong> - ${escapeHtml(room.name)} (${escapeHtml(room.status)})</li>`)
            .join('');

        await sendEmail(
            normalizedEmail,
            'Your Mortgage Backed room codes',
            `Here are your room codes:\n\n${listText}`,
            `<p>Here are your room codes:</p><ul>${listHtml}</ul>`
        );
    }

    return { status: 200, body: { ok: true } };
}

// POST /api/rooms — create room
router.post('/', requireAuth, roomCreateRateLimit, (req, res) => {
    const { name, max_players, player_name, spectate } = req.body;
    try {
        res.json(createRoom({ hostUserId: req.userId, name, maxPlayers: max_players, playerName: player_name, spectate: spectate === true }));
    } catch (err) {
        if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
        throw err;
    }
});

// GET /api/rooms/by-code/:code — find room by invite code
router.get('/by-code/:code', (req, res) => {
    const room = getRoomByInviteCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(attachRoomMembers(room));
});

// Rejoining a started room after losing your token: see
// services/rejoinRequests.js. The asking browser creates a request and polls
// it with its secret; a signed-in player in the room approves or denies it.
function notifyRejoinChange(roomId) {
    emitToRoom(roomId, 'room:rejoin_request', { roomId });
}

function sendRoomError(res, err) {
    if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
    throw err;
}

// POST /api/rooms/by-code/:code/rejoin-requests — ask to take over one guest
// seat ({ member_id }) or, with no member_id, every seat of a same-device game.
router.post('/by-code/:code/rejoin-requests', rejoinRequestRateLimit, (req, res) => {
    try {
        const memberId = req.body?.member_id ? String(req.body.member_id) : null;
        const result = createRejoinRequest({ inviteCode: req.params.code, memberId });
        notifyRejoinChange(result.room.id);
        res.json({ request_id: result.requestId, secret: result.secret, expires_at: result.expiresAt });
    } catch (err) {
        sendRoomError(res, err);
    }
});

// POST /api/rooms/rejoin-requests/:requestId/collect — the asking browser polls.
router.post('/rejoin-requests/:requestId/collect', rejoinCollectRateLimit, (req, res) => {
    try {
        res.json(collectRejoinRequest({ requestId: req.params.requestId, secret: req.body?.secret }));
    } catch (err) {
        sendRoomError(res, err);
    }
});

// POST /api/rooms/rejoin-requests/:requestId/cancel
router.post('/rejoin-requests/:requestId/cancel', rejoinCollectRateLimit, (req, res) => {
    try {
        const { roomId } = cancelRejoinRequest({ requestId: req.params.requestId, secret: req.body?.secret });
        notifyRejoinChange(roomId);
        res.json({ ok: true });
    } catch (err) {
        sendRoomError(res, err);
    }
});

// GET /api/rooms/mine — rooms the current user is in or hosts (a spectating host has no seat)
router.get('/mine', requireAuth, (req, res) => {
    const memberships = db.prepare(`
        SELECT room_id, joined_at AS at FROM room_members WHERE user_id = ?
        UNION
        SELECT id, created_at FROM rooms WHERE host_id = ?
            AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_members.room_id = rooms.id AND room_members.user_id = rooms.host_id)
        ORDER BY at DESC
    `).all(req.userId, req.userId);

    const rooms = memberships
        .map(m => getRoomWithMembers(m.room_id))
        .filter(Boolean);

    res.json(rooms);
});

// GET /api/rooms/:id
router.get('/:id', requireAuth, (req, res) => {
    const room = getRoomWithMembers(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!canViewRoom(room.id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    res.json(room);
});

// GET /api/rooms/:id/rejoin-requests — pending requests the caller can answer.
router.get('/:id/rejoin-requests', requireAuth, (req, res) => {
    try {
        res.json(listApprovableRequests(req.params.id, req.userId));
    } catch (err) {
        sendRoomError(res, err);
    }
});

// POST /api/rooms/:id/rejoin-requests/:requestId/(approve|deny)
router.post('/:id/rejoin-requests/:requestId/:decision(approve|deny)', requireAuth, (req, res) => {
    try {
        decideRejoinRequest({
            roomId: req.params.id,
            requestId: req.params.requestId,
            userId: req.userId,
            approve: req.params.decision === 'approve',
        });
        notifyRejoinChange(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        sendRoomError(res, err);
    }
});

// POST /api/rooms/:id/join — join by room ID (already authenticated)
router.post('/:id/join', requireAuth, (req, res) => {
    const { player_name } = req.body;
    try {
        res.json(joinRoom({ roomId: req.params.id, userId: req.userId, playerName: player_name }));
    } catch (err) {
        if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
        throw err;
    }
});

// Agent invites (host only). The key is in the create response only.

// POST /api/rooms/:id/agent-seats — create an invite for one AI agent. The
// optional label is the agent's player name.
router.post('/:id/agent-seats', requireAuth, (req, res) => {
    try {
        const { seat, key } = createAgentSeat({ roomId: req.params.id, hostUserId: req.userId, label: req.body?.label });
        const room = getRoomWithMembers(req.params.id);
        const mcpUrl = `${config.publicAppUrl}/api/mcp`;
        res.status(201).json({ seat, key, mcp_url: mcpUrl, prompt: agentInvitePrompt({ roomName: room.name, key, name: seat.label }) });
    } catch (err) {
        sendRoomError(res, err);
    }
});

// GET /api/rooms/:id/agent-seats — the host's live agent invites
router.get('/:id/agent-seats', requireAuth, (req, res) => {
    try {
        res.json(listAgentSeats({ roomId: req.params.id, hostUserId: req.userId }));
    } catch (err) {
        sendRoomError(res, err);
    }
});

// PATCH /api/rooms/:id/agent-seats/:seatId — rename an agent before the game starts
router.patch('/:id/agent-seats/:seatId', requireAuth, (req, res) => {
    try {
        res.json(renameAgentSeat({ roomId: req.params.id, seatId: req.params.seatId, hostUserId: req.userId, name: req.body?.label }));
    } catch (err) {
        sendRoomError(res, err);
    }
});

// DELETE /api/rooms/:id/agent-seats/:seatId — revoke an agent's key
router.delete('/:id/agent-seats/:seatId', requireAuth, (req, res) => {
    try {
        res.json(revokeAgentSeat({ roomId: req.params.id, seatId: req.params.seatId, hostUserId: req.userId }));
    } catch (err) {
        sendRoomError(res, err);
    }
});

// DELETE /api/rooms/:id/leave — leave room
router.delete('/:id/leave', requireAuth, (req, res) => {
    db.prepare(`
        DELETE FROM room_members WHERE room_id = ? AND user_id = ?
    `).run(req.params.id, req.userId);
    const updatedRoom = getRoomWithMembers(req.params.id);
    if (updatedRoom) emitToRoom(req.params.id, 'room:member_change', updatedRoom);
    res.json({ ok: true });
});

// PATCH /api/rooms/:id/status — update room status
router.patch('/:id/status', requireAuth, (req, res) => {
    const { status } = req.body;
    const room = getRoomWithMembers(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_id !== req.userId) return res.status(403).json({ error: 'Not the host' });
    if (!VALID_ROOM_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid room status' });

    db.prepare(`UPDATE rooms SET status = ? WHERE id = ?`).run(status, req.params.id);
    const updatedRoom = { ...room, status };
    emitToRoom(req.params.id, 'room:status_change', updatedRoom);
    res.json({ ok: true });
});

router.post('/send-code', async (req, res) => {
    if (req.body?.action === 'forgot_code') {
        try {
            const result = await sendForgotRoomCodes(req.body.email, getRequestActorKey(req));
            return res.status(result.status).json(result.body);
        } catch (err) {
            console.error('Forgot room code email error:', err.message);
            return res.json({ ok: true });
        }
    }

    requireAuth(req, res, async () => {
        const { email, inviteCode } = req.body || {};
        try {
            await sendInviteCodeEmail({ senderUserId: req.userId, email, inviteCode });
            res.json({ ok: true });
        } catch (err) {
            if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
            console.error('Invite email error:', err.message);
            res.json({ ok: true });
        }
    });
});

module.exports = router;
