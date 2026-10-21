'use strict';

// Host-issued seats for AI agents. The host creates one invite per agent from
// the waiting room; the invite's key is that agent's only credential. It is
// shown to the host once, only its SHA-256 hash is stored, it works for one
// seat in one room, and the host can revoke it. Agents never get a player JWT,
// so a key cannot be used anywhere but the MCP tools for its own seat.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { sha256Hex, plainText } = require('../helpers');
const { emitToRoom, notifyRoom } = require('./roomEvents');
const { RoomError, getRoomWithMembers, createAnonymousUser, joinRoom, pendingAgentSeatCount } = require('./rooms');

const KEY_PREFIX = 'mbagent_';
const LABEL_MAX = 40;

function generateKey() {
    return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function requireHostOfWaitingRoom(roomId, hostUserId) {
    const room = getRoomWithMembers(roomId);
    if (!room) throw new RoomError(404, 'Room not found');
    if (room.host_id !== hostUserId) throw new RoomError(403, 'Only the host can manage agent invites');
    return room;
}

function publicSeat(row) {
    const member = row.user_id
        ? db.prepare(`SELECT player_name FROM room_members WHERE room_id = ? AND user_id = ?`).get(row.room_id, row.user_id)
        : null;
    return {
        id: row.id,
        label: row.label,
        status: row.revoked_at ? 'revoked' : row.user_id ? 'joined' : 'pending',
        player_name: member ? member.player_name : null,
        created_at: row.created_at,
        joined_at: row.joined_at,
    };
}

// Returns { seat, key }. The key is never retrievable again.
function createAgentSeat({ roomId, hostUserId, label }) {
    const room = requireHostOfWaitingRoom(roomId, hostUserId);
    if (room.status !== 'waiting') throw new RoomError(400, 'Game has already started');
    if (room.room_members.length + pendingAgentSeatCount(room.id) >= room.max_players) {
        throw new RoomError(400, 'Room is full');
    }

    const id = uuidv4();
    const key = generateKey();
    db.prepare(`
        INSERT INTO agent_seats (id, room_id, key_hash, label, created_by)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, room.id, sha256Hex(key), plainText(label, LABEL_MAX) || null, hostUserId);
    return { seat: publicSeat(db.prepare(`SELECT * FROM agent_seats WHERE id = ?`).get(id)), key };
}

function listAgentSeats({ roomId, hostUserId }) {
    requireHostOfWaitingRoom(roomId, hostUserId);
    return db.prepare(`
        SELECT * FROM agent_seats WHERE room_id = ? AND revoked_at IS NULL ORDER BY created_at ASC, rowid ASC
    `).all(roomId).map(publicSeat);
}

// Revoking disables the key at once. Before the game starts it also frees the
// seat; after that the player stays in the game without anyone controlling it.
function revokeAgentSeat({ roomId, seatId, hostUserId }) {
    const room = requireHostOfWaitingRoom(roomId, hostUserId);
    const seat = db.prepare(`SELECT * FROM agent_seats WHERE id = ? AND room_id = ? AND revoked_at IS NULL`).get(seatId, room.id);
    if (!seat) throw new RoomError(404, 'Agent invite not found');

    db.prepare(`UPDATE agent_seats SET revoked_at = datetime('now') WHERE id = ?`).run(seat.id);
    if (seat.user_id && room.status === 'waiting') {
        db.prepare(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`).run(room.id, seat.user_id);
        emitToRoom(room.id, 'room:member_change', getRoomWithMembers(room.id));
    }
    notifyRoom(room.id);
    return publicSeat(db.prepare(`SELECT * FROM agent_seats WHERE id = ?`).get(seat.id));
}

// The live seat for a key, or null for unknown or revoked keys.
function findSeatByKey(key) {
    if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX) || key.length > 128) return null;
    return db.prepare(`SELECT * FROM agent_seats WHERE key_hash = ? AND revoked_at IS NULL`).get(sha256Hex(key)) || null;
}

// Takes the seat on first use; later calls return the seat unchanged.
function claimAgentSeat({ key, playerName }) {
    const seat = findSeatByKey(key);
    if (!seat) throw new RoomError(401, 'Invalid or revoked agent key. Ask the host for a new invite.');
    if (seat.user_id) return { seat, alreadyJoined: true };

    // Link the seat before joining so the member_change broadcast already
    // marks this member as an agent.
    const user = createAnonymousUser();
    db.prepare(`UPDATE agent_seats SET user_id = ?, joined_at = datetime('now') WHERE id = ?`).run(user.id, seat.id);
    try {
        joinRoom({ roomId: seat.room_id, userId: user.id, playerName, agentSeatId: seat.id });
    } catch (err) {
        db.prepare(`UPDATE agent_seats SET user_id = NULL, joined_at = NULL WHERE id = ?`).run(seat.id);
        db.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
        throw err;
    }
    return { seat: { ...seat, user_id: user.id }, alreadyJoined: false };
}

// Text the host pastes into the agent's chat.
function agentInvitePrompt({ roomName, key, mcpUrl }) {
    return [
        `Join my Mortgage Backed Monopoly game "${roomName}" as a player.`,
        '',
        `1. Connect the MCP server ${mcpUrl} (in the Claude app: Settings > Connectors > Add custom connector).`,
        `2. Call join_game with agent_key ${key} and a player name you choose.`,
        '3. Then call wait_for_turn in a loop and play your turns with take_action until the game ends. get_rules explains the game.',
        '',
        'The agent key is your seat at the table: keep it private.',
    ].join('\n');
}

module.exports = {
    createAgentSeat,
    listAgentSeats,
    revokeAgentSeat,
    findSeatByKey,
    claimAgentSeat,
    agentInvitePrompt,
};
