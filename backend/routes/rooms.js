const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, makeToken } = require('./auth');
const { sendEmail } = require('../mailer');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const { normalizeEmail, isValidEmail, normalizeInviteCode } = require('../normalizers');

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

async function sendInviteCodeEmail({ email, inviteCode, roomName }) {
    if (!email || !inviteCode) return;

    await sendEmail(
        email,
        `Your room code for ${roomName || 'Mortgage Backed Monopoly'}`,
        `Your invite code is: ${inviteCode}\n\nShare it with friends to join your game.`,
        `<p>Your invite code is: <strong>${inviteCode}</strong></p><p>Share it with friends to join your game.</p>`
    );
}

async function sendForgotRoomCodes(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        return { status: 400, body: { error: 'Valid email required' } };
    }

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
    if (!name || !player_name) {
        return res.status(400).json({ error: 'name and player_name required' });
    }

    const roomId = uuidv4();
    const memberId = uuidv4();
    const inviteCode = generateUniqueInviteCode();
    const maxPlayers = Number(max_players || 4);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
        return res.status(400).json({ error: 'max_players must be between 2 and 8' });
    }

    db.prepare(`
        INSERT INTO rooms (id, invite_code, host_id, name, max_players)
        VALUES (?, ?, ?, ?, ?)
    `).run(roomId, inviteCode, req.userId, name, maxPlayers);

    db.prepare(`
        INSERT INTO room_members (id, room_id, user_id, player_name)
        VALUES (?, ?, ?, ?)
    `).run(memberId, roomId, req.userId, player_name);

    res.json(getRoomWithMembers(roomId));
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
    const room = getRoomWithMembers(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const alreadyJoined = room.room_members.some(m => m.user_id === req.userId);
    if (alreadyJoined) return res.json(room);

    if (room.room_members.length >= room.max_players) {
        return res.status(400).json({ error: 'Room is full' });
    }
    if (room.status !== 'waiting') {
        return res.status(400).json({ error: 'Game has already started' });
    }

    const memberId = uuidv4();
    db.prepare(`
        INSERT INTO room_members (id, room_id, user_id, player_name)
        VALUES (?, ?, ?, ?)
    `).run(memberId, room.id, req.userId, player_name || 'Guest');

    const updatedRoom = getRoomWithMembers(room.id);
    io.to(`room:${room.id}`).emit('room:member_change', updatedRoom);
    res.json(updatedRoom);
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
            const result = await sendForgotRoomCodes(req.body.email);
            return res.status(result.status).json(result.body);
        } catch (err) {
            console.error('Forgot room code email error:', err);
            return res.json({ ok: true });
        }
    }

    requireAuth(req, res, async () => {
        const { email, inviteCode, roomName } = req.body;
        try {
            await sendInviteCodeEmail({ email, inviteCode, roomName });
        } catch (err) {
            console.error('Invite email error:', err);
        }
        res.json({ ok: true });
    });
});

function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function generateUniqueInviteCode() {
    for (let i = 0; i < 20; i++) {
        const code = generateInviteCode();
        const exists = db.prepare(`SELECT 1 FROM rooms WHERE invite_code = ?`).get(code);
        if (!exists) return code;
    }
    throw new Error('Unable to generate unique invite code');
}

    return router;
};
