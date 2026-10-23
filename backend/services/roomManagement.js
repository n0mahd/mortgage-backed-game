'use strict';

// A player's own list of games (with per-user archiving), leaving a waiting
// room, and the host's Manage players view. See
// documents/accounts-and-game-management.md.

const db = require('../db');
const { emitToRoom, notifyRoom } = require('./roomEvents');
const { RoomError, getRoom, getRoomWithMembers, canViewRoom, requireRoomHost } = require('./rooms');
const { listAgentSeats } = require('./agentSeats');
const { pendingTransferForRoom } = require('./hostTransfers');

// Rooms the user is in or hosts (a spectating host has no seat), newest first,
// each with archived, is_host and my_member_id.
function listMyRooms(userId) {
    const memberships = db.prepare(`
        SELECT room_id, joined_at AS at FROM room_members WHERE user_id = ?
        UNION
        SELECT id, created_at FROM rooms WHERE host_id = ?
            AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_members.room_id = rooms.id AND room_members.user_id = rooms.host_id)
        ORDER BY at DESC
    `).all(userId, userId);
    const archived = new Set(db.prepare(`
        SELECT room_id FROM room_user_prefs WHERE user_id = ? AND archived_at IS NOT NULL
    `).all(userId).map(row => row.room_id));

    return memberships
        .map(m => getRoomWithMembers(m.room_id))
        .filter(Boolean)
        .map(room => {
            const me = room.room_members.find(member => member.user_id === userId);
            return {
                ...room,
                archived: archived.has(room.id),
                is_host: room.host_id === userId,
                my_member_id: me ? me.id : null,
            };
        });
}

// Archiving hides a game from this user's list only; it does not end it.
function setArchived({ roomId, userId, archived }) {
    if (!getRoom(roomId)) throw new RoomError(404, 'Room not found');
    if (!canViewRoom(roomId, userId)) throw new RoomError(403, 'Not a room member');
    db.prepare(`
        INSERT INTO room_user_prefs (room_id, user_id, archived_at) VALUES (?, ?, ${archived ? `datetime('now')` : 'NULL'})
        ON CONFLICT (room_id, user_id) DO UPDATE SET archived_at = excluded.archived_at
    `).run(roomId, userId);
}

// Leaving is only possible while the room is waiting: a started game would
// keep a player nobody controls.
function leaveRoom({ roomId, userId }) {
    const room = getRoom(roomId);
    if (!room) throw new RoomError(404, 'Room not found');
    if (room.status !== 'waiting') throw new RoomError(400, 'You can only leave before the game starts');
    db.prepare(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`).run(roomId, userId);
    emitToRoom(roomId, 'room:member_change', getRoomWithMembers(roomId));
    notifyRoom(roomId);
}

// The host's Manage players view: every member with what the host can do for
// them, the live agent invites, and the pending host offer.
function getManageView({ roomId, userId }) {
    const room = requireRoomHost(roomId, userId);
    const agentSeatByUser = new Map(db.prepare(`
        SELECT id, user_id FROM agent_seats WHERE room_id = ? AND revoked_at IS NULL AND user_id IS NOT NULL
    `).all(room.id).map(row => [row.user_id, row.id]));
    const accountUsers = new Set(db.prepare(`
        SELECT users.id FROM users JOIN room_members ON room_members.user_id = users.id
        WHERE room_members.room_id = ? AND users.is_anonymous = 0
    `).all(room.id).map(row => row.id));

    const members = room.room_members.map(member => ({
        id: member.id,
        player_name: member.player_name,
        user_id: member.user_id,
        is_agent: member.is_agent,
        is_host: member.user_id === room.host_id,
        has_account: accountUsers.has(member.user_id),
        agent_seat_id: agentSeatByUser.get(member.user_id) || null,
    }));

    return {
        room,
        members,
        agent_seats: listAgentSeats({ roomId: room.id, hostUserId: userId }),
        host_transfer: pendingTransferForRoom(room.id),
    };
}

module.exports = { listMyRooms, setArchived, leaveRoom, getManageView };
