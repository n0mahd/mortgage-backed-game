'use strict';

// Host transfer (documents/accounts-and-game-management.md): the host offers
// host rights to one non-agent player, who must accept, and must have an
// account (email or password) to do so. One pending offer per room; a new
// offer replaces it. Host identity is rooms.host_id alone (applyGameAction
// passes it to applyAction as hostId), so a transfer changes no game state.

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { emitToRoom, notifyRoom } = require('./roomEvents');
const { RoomError, getRoom, getRoomWithMembers, requireRoomHost } = require('./rooms');

function notifyTransferChange(roomId) {
    emitToRoom(roomId, 'room:host_transfer', { roomId });
}

function publicTransfer(row) {
    if (!row) return null;
    const member = db.prepare(`SELECT id, player_name FROM room_members WHERE room_id = ? AND user_id = ?`).get(row.room_id, row.to_user_id);
    return {
        id: row.id,
        to_member_id: member ? member.id : null,
        to_player_name: member ? member.player_name : null,
        created_at: row.created_at,
    };
}

function pendingTransferForRoom(roomId) {
    return publicTransfer(db.prepare(`
        SELECT * FROM host_transfers WHERE room_id = ? AND status = 'pending' ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(roomId));
}

function cancelPending(roomId) {
    return db.prepare(`
        UPDATE host_transfers SET status = 'cancelled', decided_at = datetime('now') WHERE room_id = ? AND status = 'pending'
    `).run(roomId).changes;
}

function offerHostTransfer({ roomId, hostUserId, memberId }) {
    const room = requireRoomHost(roomId, hostUserId);
    const member = room.room_members.find(m => m.id === memberId);
    if (!member) throw new RoomError(404, 'Player not found');
    if (member.is_agent) throw new RoomError(400, 'An agent cannot be the host');
    if (member.user_id === room.host_id) throw new RoomError(400, 'You are already the host');

    const id = uuidv4();
    db.withTransaction(() => {
        cancelPending(room.id);
        db.prepare(`
            INSERT INTO host_transfers (id, room_id, from_user_id, to_user_id) VALUES (?, ?, ?, ?)
        `).run(id, room.id, hostUserId, member.user_id);
    });
    notifyTransferChange(room.id);
    return publicTransfer(db.prepare(`SELECT * FROM host_transfers WHERE id = ?`).get(id));
}

function cancelHostTransfer({ roomId, hostUserId }) {
    const room = requireRoomHost(roomId, hostUserId);
    if (cancelPending(room.id)) notifyTransferChange(room.id);
}

// Pending offers made to this user.
function listMyHostTransfers(userId) {
    return db.prepare(`
        SELECT host_transfers.id, host_transfers.room_id, rooms.name AS room_name,
            COALESCE(room_members.player_name, 'The host') AS from_player_name, host_transfers.created_at
        FROM host_transfers
        JOIN rooms ON rooms.id = host_transfers.room_id
        LEFT JOIN room_members ON room_members.room_id = host_transfers.room_id AND room_members.user_id = host_transfers.from_user_id
        WHERE host_transfers.to_user_id = ? AND host_transfers.status = 'pending'
        ORDER BY host_transfers.created_at DESC
    `).all(userId);
}

function requireMyPendingOffer(transferId, userId) {
    const offer = db.prepare(`SELECT * FROM host_transfers WHERE id = ? AND status = 'pending'`).get(transferId);
    if (!offer || offer.to_user_id !== userId) throw new RoomError(404, 'Host offer not found');
    return offer;
}

// Returns the room with its new host.
function acceptHostTransfer({ transferId, userId }) {
    const roomId = db.withTransaction(() => {
        const offer = requireMyPendingOffer(transferId, userId);
        const user = db.prepare(`SELECT is_anonymous FROM users WHERE id = ?`).get(userId);
        if (!user || user.is_anonymous) {
            throw new RoomError(403, 'Create an account to become the host', 'account_required');
        }
        const room = getRoom(offer.room_id);
        const stillMember = db.prepare(`SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`).get(offer.room_id, userId);
        // The host changed or the player left since the offer: it lapses.
        if (!room || room.host_id !== offer.from_user_id || !stillMember) {
            db.prepare(`UPDATE host_transfers SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?`).run(offer.id);
            return null;
        }
        db.prepare(`UPDATE rooms SET host_id = ? WHERE id = ?`).run(userId, room.id);
        db.prepare(`UPDATE host_transfers SET status = 'accepted', decided_at = datetime('now') WHERE id = ?`).run(offer.id);
        return room.id;
    });
    if (!roomId) throw new RoomError(400, 'This offer is no longer valid');
    const room = getRoomWithMembers(roomId);
    emitToRoom(roomId, 'room:member_change', room);
    notifyTransferChange(roomId);
    notifyRoom(roomId);
    return room;
}

function declineHostTransfer({ transferId, userId }) {
    const offer = requireMyPendingOffer(transferId, userId);
    db.prepare(`UPDATE host_transfers SET status = 'declined', decided_at = datetime('now') WHERE id = ?`).run(offer.id);
    notifyTransferChange(offer.room_id);
}

module.exports = {
    pendingTransferForRoom,
    offerHostTransfer,
    cancelHostTransfer,
    listMyHostTransfers,
    acceptHostTransfer,
    declineHostTransfer,
};
