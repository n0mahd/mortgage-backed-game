'use strict';

// Seat links: a host-made link that brings one player back to their seat
// (documents/accounts-and-game-management.md). A link belongs to one room
// member; a new link for the seat revokes the older ones, and links last 7
// days. Only the token's SHA-256 hash is stored.
//
// Redeeming a guest seat's link signs that browser in as the seat and uses up
// the link. A seat owned by an account is never handed out by link: the
// player is sent to sign in, and the link stays usable.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { sha256Hex, toSqliteDate } = require('../helpers');
const { RoomError, getRoomWithMembers, requireRoomHost } = require('./rooms');

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_INVALID = 'This link has expired or was replaced';

// Returns { token, expiresAt } for a non-agent member of the host's room.
function createSeatLink({ roomId, memberId, hostUserId }) {
    const room = requireRoomHost(roomId, hostUserId);
    const member = room.room_members.find(m => m.id === memberId);
    if (!member) throw new RoomError(404, 'Player not found');
    if (member.is_agent) throw new RoomError(400, 'Agents get a new key instead of a link');

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    db.withTransaction(() => {
        db.prepare(`
            UPDATE seat_links SET revoked_at = datetime('now')
            WHERE member_id = ? AND used_at IS NULL AND revoked_at IS NULL
        `).run(member.id);
        db.prepare(`
            INSERT INTO seat_links (id, room_id, member_id, token_hash, created_by, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), room.id, member.id, sha256Hex(token), hostUserId, toSqliteDate(expiresAt));
    });
    return { token, expiresAt };
}

// callerUserId is the redeeming browser's user, if it is signed in. Returns
//   { signInAs: userId, room }              guest seat (link now used)
//   { room }                                account seat, caller is that account
//   { requiresSignIn: true, room: {id,name} } account seat, anyone else
function redeemSeatLink({ token, callerUserId = null }) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) throw new RoomError(400, LINK_INVALID);
    return db.withTransaction(() => {
        const link = db.prepare(`
            SELECT seat_links.*, room_members.user_id, users.is_anonymous
            FROM seat_links
            JOIN room_members ON room_members.id = seat_links.member_id
            JOIN users ON users.id = room_members.user_id
            WHERE seat_links.token_hash = ? AND seat_links.used_at IS NULL AND seat_links.revoked_at IS NULL
                AND seat_links.expires_at > datetime('now')
        `).get(sha256Hex(token));
        if (!link) throw new RoomError(400, LINK_INVALID);
        const room = getRoomWithMembers(link.room_id);

        if (link.is_anonymous) {
            db.prepare(`UPDATE seat_links SET used_at = datetime('now') WHERE id = ?`).run(link.id);
            return { signInAs: link.user_id, room };
        }
        if (callerUserId === link.user_id) return { room };
        return { requiresSignIn: true, room: { id: room.id, name: room.name } };
    });
}

module.exports = { createSeatLink, redeemSeatLink };
