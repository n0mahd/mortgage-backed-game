'use strict';

// Rooms: create, join, leave, look up, rejoin requests, agent invites, and
// room-code emails. Rule and storage logic lives in services/; handlers only
// authenticate, call a service, broadcast, and answer. Errors carrying a 4xx
// status (RoomError) are answered by the error handler in server.js.

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const { emitToRoom } = require('../services/roomEvents');
const {
    RoomError,
    createRoom,
    joinRoom,
    getRoomWithMembers,
    getRoomByInviteCode,
    canViewRoom,
} = require('../services/rooms');
const {
    createRejoinRequest,
    listApprovableRequests,
    decideRejoinRequest,
    collectRejoinRequest,
    cancelRejoinRequest,
} = require('../services/rejoinRequests');
const { createAgentSeat, listAgentSeats, renameAgentSeat, revokeAgentSeat, agentInvitePrompt } = require('../services/agentSeats');
const { sendInviteCodeEmail, sendForgotRoomCodes } = require('../services/roomEmails');

const router = express.Router();
const config = getConfig();
const VALID_ROOM_STATUSES = new Set(['waiting', 'in_progress', 'completed']);
const roomCreateRateLimit = createRateLimiter({ name: 'room_create', ...config.rateLimits.roomCreate });
const rejoinRequestRateLimit = createRateLimiter({ name: 'rejoin_request', ...config.rateLimits.rejoinRequest });
const rejoinCollectRateLimit = createRateLimiter({ name: 'rejoin_collect', ...config.rateLimits.rejoinCollect });

// POST /api/rooms — create room
router.post('/', requireAuth, roomCreateRateLimit, (req, res) => {
    const { name, max_players, player_name, spectate } = req.body;
    res.json(createRoom({ hostUserId: req.userId, name, maxPlayers: max_players, playerName: player_name, spectate: spectate === true }));
});

// GET /api/rooms/by-code/:code — find room by invite code
router.get('/by-code/:code', (req, res) => {
    const room = getRoomByInviteCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(getRoomWithMembers(room.id));
});

// Rejoining a started room after losing your token: see
// services/rejoinRequests.js. The asking browser creates a request and polls
// it with its secret; a signed-in player in the room approves or denies it.
function notifyRejoinChange(roomId) {
    emitToRoom(roomId, 'room:rejoin_request', { roomId });
}

// POST /api/rooms/by-code/:code/rejoin-requests — ask to take over one guest
// seat ({ member_id }) or, with no member_id, every seat of a same-device game.
router.post('/by-code/:code/rejoin-requests', rejoinRequestRateLimit, (req, res) => {
    const memberId = req.body?.member_id ? String(req.body.member_id) : null;
    const result = createRejoinRequest({ inviteCode: req.params.code, memberId });
    notifyRejoinChange(result.room.id);
    res.json({ request_id: result.requestId, secret: result.secret, expires_at: result.expiresAt });
});

// POST /api/rooms/rejoin-requests/:requestId/collect — the asking browser polls.
router.post('/rejoin-requests/:requestId/collect', rejoinCollectRateLimit, (req, res) => {
    res.json(collectRejoinRequest({ requestId: req.params.requestId, secret: req.body?.secret }));
});

// POST /api/rooms/rejoin-requests/:requestId/cancel
router.post('/rejoin-requests/:requestId/cancel', rejoinCollectRateLimit, (req, res) => {
    const { roomId } = cancelRejoinRequest({ requestId: req.params.requestId, secret: req.body?.secret });
    notifyRejoinChange(roomId);
    res.json({ ok: true });
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
    res.json(listApprovableRequests(req.params.id, req.userId));
});

// POST /api/rooms/:id/rejoin-requests/:requestId/(approve|deny)
router.post('/:id/rejoin-requests/:requestId/:decision(approve|deny)', requireAuth, (req, res) => {
    decideRejoinRequest({
        roomId: req.params.id,
        requestId: req.params.requestId,
        userId: req.userId,
        approve: req.params.decision === 'approve',
    });
    notifyRejoinChange(req.params.id);
    res.json({ ok: true });
});

// POST /api/rooms/:id/join — join by room ID (already authenticated)
router.post('/:id/join', requireAuth, (req, res) => {
    const { player_name } = req.body;
    res.json(joinRoom({ roomId: req.params.id, userId: req.userId, playerName: player_name }));
});

// Agent invites (host only). The key is in the create response only.

// POST /api/rooms/:id/agent-seats — create an invite for one AI agent. The
// optional label is the agent's player name.
router.post('/:id/agent-seats', requireAuth, (req, res) => {
    const { seat, key } = createAgentSeat({ roomId: req.params.id, hostUserId: req.userId, label: req.body?.label });
    const room = getRoomWithMembers(req.params.id);
    const mcpUrl = `${config.publicAppUrl}/api/mcp`;
    res.status(201).json({ seat, key, mcp_url: mcpUrl, prompt: agentInvitePrompt({ roomName: room.name, key, name: seat.label }) });
});

// GET /api/rooms/:id/agent-seats — the host's live agent invites
router.get('/:id/agent-seats', requireAuth, (req, res) => {
    res.json(listAgentSeats({ roomId: req.params.id, hostUserId: req.userId }));
});

// PATCH /api/rooms/:id/agent-seats/:seatId — rename an agent before the game starts
router.patch('/:id/agent-seats/:seatId', requireAuth, (req, res) => {
    res.json(renameAgentSeat({ roomId: req.params.id, seatId: req.params.seatId, hostUserId: req.userId, name: req.body?.label }));
});

// DELETE /api/rooms/:id/agent-seats/:seatId — revoke an agent's key
router.delete('/:id/agent-seats/:seatId', requireAuth, (req, res) => {
    res.json(revokeAgentSeat({ roomId: req.params.id, seatId: req.params.seatId, hostUserId: req.userId }));
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

// POST /api/rooms/send-code — { action: 'forgot_code', email } mails the codes
// of every room that email is in (no sign-in needed); otherwise a signed-in
// member mails { inviteCode } to { email }. A failed send still answers ok.
router.post('/send-code', async (req, res) => {
    if (req.body?.action === 'forgot_code') {
        try {
            await sendForgotRoomCodes({ email: req.body.email, requesterKey: getRequestActorKey(req) });
        } catch (err) {
            if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
            console.error('Forgot room code email error:', err.message);
        }
        return res.json({ ok: true });
    }

    requireAuth(req, res, async () => {
        const { email, inviteCode } = req.body || {};
        try {
            await sendInviteCodeEmail({ senderUserId: req.userId, email, inviteCode });
        } catch (err) {
            if (err instanceof RoomError) return res.status(err.status).json({ error: err.message });
            console.error('Invite email error:', err.message);
        }
        res.json({ ok: true });
    });
});

module.exports = router;
