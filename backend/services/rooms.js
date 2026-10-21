'use strict';

// Room membership writes shared by the HTTP routes and the MCP server:
// anonymous player accounts, room creation, and joining before a game starts.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { normalizeInviteCode } = require('../helpers');
const { emitToRoom, notifyRoom } = require('./roomEvents');

class RoomError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Members in join order; is_agent marks seats taken with a host-issued agent key.
function getRoomMembers(roomId) {
    return db.prepare(`
        SELECT room_members.*, EXISTS (
            SELECT 1 FROM agent_seats
            WHERE agent_seats.room_id = room_members.room_id AND agent_seats.user_id = room_members.user_id
        ) AS is_agent
        FROM room_members WHERE room_id = ? ORDER BY joined_at ASC
    `).all(roomId).map(member => ({ ...member, is_agent: member.is_agent === 1 }));
}

// Agent invites not yet used hold a seat, so people joining by room code
// cannot fill the room before the host's agents arrive.
function pendingAgentSeatCount(roomId, exceptSeatId = null) {
    return db.prepare(`
        SELECT COUNT(*) AS count FROM agent_seats
        WHERE room_id = ? AND user_id IS NULL AND revoked_at IS NULL AND id IS NOT ?
    `).get(roomId, exceptSeatId).count;
}

function getRoomWithMembers(roomId) {
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    if (!room) return null;
    return { ...room, room_members: getRoomMembers(room.id) };
}

function getRoomByInviteCode(code) {
    return db.prepare(`SELECT * FROM rooms WHERE invite_code = ?`).get(normalizeInviteCode(code));
}

function createAnonymousUser() {
    const userId = uuidv4();
    db.prepare(`INSERT INTO users (id, email, is_anonymous) VALUES (?, NULL, 1)`).run(userId);
    return { id: userId, email: null, is_anonymous: true };
}

function createRoom({ hostUserId, name, maxPlayers: rawMaxPlayers, playerName }) {
    if (!name || !playerName) throw new RoomError(400, 'name and player_name required');

    const roomId = uuidv4();
    const memberId = uuidv4();
    const inviteCode = generateUniqueInviteCode();
    const maxPlayers = Number(rawMaxPlayers || 4);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
        throw new RoomError(400, 'max_players must be between 2 and 8');
    }

    db.prepare(`
        INSERT INTO rooms (id, invite_code, host_id, name, max_players)
        VALUES (?, ?, ?, ?, ?)
    `).run(roomId, inviteCode, hostUserId, name, maxPlayers);

    db.prepare(`
        INSERT INTO room_members (id, room_id, user_id, player_name)
        VALUES (?, ?, ?, ?)
    `).run(memberId, roomId, hostUserId, playerName);

    return getRoomWithMembers(roomId);
}

// Join a waiting room. Joining a room you are already in returns it unchanged.
// agentSeatId is set when an agent takes the seat its invite reserved.
function joinRoom({ roomId, userId, playerName, agentSeatId = null }) {
    const room = getRoomWithMembers(roomId);
    if (!room) throw new RoomError(404, 'Room not found');

    const alreadyJoined = room.room_members.some(m => m.user_id === userId);
    if (alreadyJoined) return room;

    if (room.room_members.length + pendingAgentSeatCount(room.id, agentSeatId) >= room.max_players) {
        throw new RoomError(400, 'Room is full');
    }
    if (room.status !== 'waiting') {
        throw new RoomError(400, 'Game has already started');
    }

    db.prepare(`
        INSERT INTO room_members (id, room_id, user_id, player_name)
        VALUES (?, ?, ?, ?)
    `).run(uuidv4(), room.id, userId, playerName || 'Guest');

    const updatedRoom = getRoomWithMembers(room.id);
    emitToRoom(room.id, 'room:member_change', updatedRoom);
    notifyRoom(room.id);
    return updatedRoom;
}

function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(crypto.randomInt(chars.length));
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

module.exports = {
    RoomError,
    getRoomMembers,
    pendingAgentSeatCount,
    getRoomWithMembers,
    getRoomByInviteCode,
    createAnonymousUser,
    createRoom,
    joinRoom,
};
