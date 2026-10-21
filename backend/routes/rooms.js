const express = require('express');
const db = require('../db');
const { requireAuth, makeToken } = require('./auth');
const { sendEmail } = require('../mailer');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const { normalizeEmail, isValidEmail, normalizeInviteCode } = require('../normalizers');
const { RoomError, createRoom, joinRoom } = require('../services/rooms');

module.exports = (io) => {
const router = express.Router();
const VALID_ROOM_STATUSES = new Set(['waiting', 'in_progress', 'completed']);
const config = getConfig();
const roomCreateRateLimit = createRateLimiter({
    name: 'room_create',
    ...config.rateLimits.roomCreate,
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

function getRoomMembers(roomId) {
    return db.prepare(`SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC`).all(roomId);
}

function isRoomMember(roomId, userId) {
    return !!db.prepare(`SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`).get(roomId, userId);
}

function getRoomByInviteCode(code) {
    return db.prepare(`SELECT * FROM rooms WHERE invite_code = ?`).get(normalizeInviteCode(code));
}

function isClosedToNewMembers(room, members) {
    return room.status !== 'waiting' || members.length >= room.max_players;
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

function plainSubjectText(value, maxLength) {
    return String(value ?? '').replace(/[\p{C}]/gu, ' ').trim().slice(0, maxLength);
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
    if (!room || !db.prepare(`SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`).get(room.id, senderUserId)) {
        throw new RoomError(404, 'Room not found');
    }
    if (!emailAllowed(`user:${senderUserId}`, recipient)) throw new RoomError(429, 'Too many emails. Try again later.');

    const roomName = plainSubjectText(room.name, 60) || 'Mortgage Backed Monopoly';
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
    const { name, max_players, player_name } = req.body;
    try {
        res.json(createRoom({ hostUserId: req.userId, name, maxPlayers: max_players, playerName: player_name }));
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

// POST /api/rooms/by-code/:code/claim-member — resume as an existing room member.
// This supports hotseat rooms filled with local anonymous players before the
// browser had persistent token recovery.
router.post('/by-code/:code/claim-member', (req, res) => {
    const { member_id } = req.body;
    const room = getRoomByInviteCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!member_id) return res.status(400).json({ error: 'member_id required' });

    const members = getRoomMembers(room.id);
    if (!isClosedToNewMembers(room, members)) {
        return res.status(400).json({ error: 'Room is still open for new players' });
    }

    const member = members.find(item => item.id === member_id);
    if (!member) return res.status(404).json({ error: 'Player not found in this room' });

    const user = db.prepare(`SELECT id, email, is_anonymous FROM users WHERE id = ?`).get(member.user_id);
    if (!user) return res.status(404).json({ error: 'Player account not found' });
    // Anyone with the invite code can call this, so never hand out tokens for
    // email accounts; those players sign in with their email instead.
    if (!user.is_anonymous) {
        return res.status(403).json({ error: 'This player signed in with email. Sign in with that email to continue.' });
    }

    res.json({
        token: makeToken(user.id),
        user,
        member,
        room: attachRoomMembers(room, members)
    });
});

// POST /api/rooms/by-code/:code/claim-hotseat — resume all existing room
// members in local hotseat mode.
router.post('/by-code/:code/claim-hotseat', (req, res) => {
    const room = getRoomByInviteCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const members = getRoomMembers(room.id);
    if (!isClosedToNewMembers(room, members)) {
        return res.status(400).json({ error: 'Room is still open for new players' });
    }

    const anonymousCount = db.prepare(`
        SELECT COUNT(*) AS count FROM users
        WHERE is_anonymous = 1 AND id IN (SELECT user_id FROM room_members WHERE room_id = ?)
    `).get(room.id).count;
    if (anonymousCount !== members.length) {
        return res.status(403).json({ error: 'Only same-device games can be resumed this way. Sign in to continue.' });
    }

    const tokens = members.map(member => ({
        userId: member.user_id,
        token: makeToken(member.user_id),
        name: member.player_name
    }));

    res.json({
        room: attachRoomMembers(room, members),
        tokens
    });
});

// GET /api/rooms/mine — rooms the current user is in
router.get('/mine', requireAuth, (req, res) => {
    const memberships = db.prepare(`
        SELECT room_id FROM room_members WHERE user_id = ? ORDER BY joined_at DESC
    `).all(req.userId);

    const rooms = memberships
        .map(m => getRoomWithMembers(m.room_id))
        .filter(Boolean);

    res.json(rooms);
});

// GET /api/rooms/:id
router.get('/:id', requireAuth, (req, res) => {
    const room = getRoomWithMembers(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!isRoomMember(room.id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    res.json(room);
});

// POST /api/rooms/:id/join — join by room ID (already authenticated)
router.post('/:id/join', requireAuth, (req, res) => {
    const { player_name } = req.body;
    try {
        res.json(joinRoom(io, { roomId: req.params.id, userId: req.userId, playerName: player_name }));
    } catch (err) {
        if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
        throw err;
    }
});

// DELETE /api/rooms/:id/leave — leave room
router.delete('/:id/leave', requireAuth, (req, res) => {
    db.prepare(`
        DELETE FROM room_members WHERE room_id = ? AND user_id = ?
    `).run(req.params.id, req.userId);
    const updatedRoom = getRoomWithMembers(req.params.id);
    if (updatedRoom) io.to(`room:${req.params.id}`).emit('room:member_change', updatedRoom);
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
    io.to(`room:${req.params.id}`).emit('room:status_change', updatedRoom);
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

    return router;
};
