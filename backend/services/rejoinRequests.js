'use strict';

// Getting back into a started room after losing your token. Anyone with the
// invite code can ask to take over a guest seat (or, for a same-device game,
// every seat), but the token only goes to the browser that asked, and only
// after a signed-in player approves:
// - the seat's own player (moving devices), or the host;
// - if the seat is the host's, any other player in the room;
// - a whole-room (hotseat) request needs the host.
// Email seats are never handed out this way: those players sign in with email.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { RoomError, getRoomMembers, getRoomByInviteCode } = require('./rooms');
const { makeToken } = require('../routes/auth');

const REQUEST_TTL_MS = 10 * 60 * 1000;

function hashSecret(secret) {
    return crypto.createHash('sha256').update(String(secret || '')).digest('hex');
}

function toSqliteDate(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

function isClosedToNewMembers(room, members) {
    return room.status !== 'waiting' || members.length >= room.max_players;
}

function isAnonymousUser(userId) {
    return !!db.prepare(`SELECT 1 FROM users WHERE id = ? AND is_anonymous = 1`).get(userId);
}

function getLiveRequest(requestId) {
    return db.prepare(`
        SELECT * FROM rejoin_requests WHERE id = ? AND expires_at > datetime('now')
    `).get(requestId);
}

function getSecretRequest(requestId, secret) {
    const request = db.prepare(`SELECT * FROM rejoin_requests WHERE id = ?`).get(requestId);
    if (!request) return null;
    const expected = Buffer.from(request.secret_hash, 'hex');
    const actual = Buffer.from(hashSecret(secret), 'hex');
    return crypto.timingSafeEqual(expected, actual) ? request : null;
}

function canApprove(room, members, request, userId) {
    const approver = members.find(member => member.user_id === userId);
    if (!approver) return false;
    if (!request.member_id) return room.host_id === userId;
    const seat = members.find(member => member.id === request.member_id);
    if (!seat) return false;
    if (seat.user_id === userId || room.host_id === userId) return true;
    return seat.user_id === room.host_id;
}

function createRejoinRequest({ inviteCode, memberId }) {
    const room = getRoomByInviteCode(inviteCode);
    if (!room) throw new RoomError(404, 'Room not found');
    const members = getRoomMembers(room.id);
    if (!isClosedToNewMembers(room, members)) throw new RoomError(400, 'Room is still open for new players');

    if (memberId) {
        const member = members.find(item => item.id === memberId);
        if (!member) throw new RoomError(404, 'Player not found in this room');
        if (!isAnonymousUser(member.user_id)) {
            throw new RoomError(403, 'This player signed in with email. Sign in with that email to continue.');
        }
    } else if (!members.every(member => isAnonymousUser(member.user_id))) {
        throw new RoomError(403, 'Only same-device games can be resumed this way. Sign in to continue.');
    }

    // A newer request for the same seat replaces the old one.
    db.prepare(`
        UPDATE rejoin_requests SET status = 'superseded'
        WHERE room_id = ? AND status = 'pending' AND member_id IS ?
    `).run(room.id, memberId || null);

    const id = uuidv4();
    const secret = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);
    db.prepare(`
        INSERT INTO rejoin_requests (id, room_id, member_id, secret_hash, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, room.id, memberId || null, hashSecret(secret), toSqliteDate(expiresAt));

    return { room, requestId: id, secret, expiresAt: expiresAt.toISOString() };
}

function countOtherRecentRequests(request) {
    return db.prepare(`
        SELECT COUNT(*) AS count FROM rejoin_requests
        WHERE room_id = ? AND member_id IS ? AND id != ?
          AND created_at > datetime('now', '-10 minutes')
    `).get(request.room_id, request.member_id, request.id).count;
}

// Pending requests in a room that this user may approve.
function listApprovableRequests(roomId, userId) {
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    if (!room) throw new RoomError(404, 'Room not found');
    const members = getRoomMembers(room.id);
    if (!members.some(member => member.user_id === userId)) throw new RoomError(403, 'Not a room member');

    return db.prepare(`
        SELECT * FROM rejoin_requests
        WHERE room_id = ? AND status = 'pending' AND expires_at > datetime('now')
        ORDER BY created_at ASC
    `).all(room.id)
        .filter(request => canApprove(room, members, request, userId))
        .map(request => ({
            id: request.id,
            // Other devices that asked for the same seat recently: the approver
            // is warned, since one of them may not be the real player.
            otherRecentRequests: countOtherRecentRequests(request),
            memberId: request.member_id,
            playerName: request.member_id
                ? members.find(member => member.id === request.member_id)?.player_name || 'Player'
                : null,
            createdAt: request.created_at,
            expiresAt: request.expires_at,
        }));
}

function decideRejoinRequest({ roomId, requestId, userId, approve }) {
    const request = getLiveRequest(requestId);
    if (!request || request.room_id !== roomId || request.status !== 'pending') {
        throw new RoomError(404, 'That request has expired or was already answered');
    }
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    const members = getRoomMembers(roomId);
    if (!room || !canApprove(room, members, request, userId)) {
        throw new RoomError(403, 'You cannot answer this request');
    }
    db.prepare(`
        UPDATE rejoin_requests SET status = ?, decided_by = ? WHERE id = ? AND status = 'pending'
    `).run(approve ? 'approved' : 'denied', userId, requestId);
    return { roomId };
}

// The asking browser polls this with its secret. An approved request hands
// out tokens exactly once.
function collectRejoinRequest({ requestId, secret }) {
    const request = getSecretRequest(requestId, secret);
    if (!request) throw new RoomError(404, 'Request not found');

    const expired = !getLiveRequest(requestId);
    if (request.status === 'pending') return { status: expired ? 'expired' : 'pending' };
    if (request.status !== 'approved' || expired) {
        return { status: request.status === 'approved' ? 'expired' : request.status };
    }

    const claimed = db.prepare(`
        UPDATE rejoin_requests SET status = 'collected' WHERE id = ? AND status = 'approved'
    `).run(requestId);
    if (claimed.changes !== 1) return { status: 'collected' };

    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(request.room_id);
    const members = getRoomMembers(request.room_id);
    const roomWithMembers = { ...room, room_members: members };

    if (!request.member_id) {
        return {
            status: 'approved',
            room: roomWithMembers,
            tokens: members.map(member => ({
                userId: member.user_id,
                token: makeToken(member.user_id),
                name: member.player_name,
            })),
        };
    }

    const member = members.find(item => item.id === request.member_id);
    const user = member && db.prepare(`SELECT id, email, is_anonymous FROM users WHERE id = ?`).get(member.user_id);
    if (!user) throw new RoomError(404, 'Player account not found');
    return { status: 'approved', room: roomWithMembers, member, user, token: makeToken(user.id) };
}

function cancelRejoinRequest({ requestId, secret }) {
    const request = getSecretRequest(requestId, secret);
    if (!request) throw new RoomError(404, 'Request not found');
    db.prepare(`UPDATE rejoin_requests SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(requestId);
    return { roomId: request.room_id };
}

module.exports = {
    createRejoinRequest,
    listApprovableRequests,
    decideRejoinRequest,
    collectRejoinRequest,
    cancelRejoinRequest,
};
