'use strict';

// Room-code emails: a member sends a room's invite code to a friend, or anyone
// asks for the codes of every room their email is in. Mail is limited per
// sender and per recipient, so neither can be used to spam an address.

const db = require('../db');
const { getConfig } = require('../config');
const { createRateLimiter } = require('../rateLimit');
const { normalizeEmail, isValidEmail, plainText } = require('../helpers');
const { sendEmail } = require('./mailer');
const { RoomError, getRoomByInviteCode, canViewRoom } = require('./rooms');

const config = getConfig();
const emailSenderLimit = createRateLimiter({ name: 'email_sender', ...config.rateLimits.emailSender });
const emailRecipientLimit = createRateLimiter({ name: 'email_recipient', ...config.rateLimits.emailRecipient });

function emailAllowed(senderKey, recipient) {
    return emailSenderLimit.check(senderKey).allowed && emailRecipientLimit.check(recipient).allowed;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function requireValidEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !isValidEmail(normalized)) throw new RoomError(400, 'Valid email required');
    return normalized;
}

// Only an email-verified member of the room can send its invite, and the code
// and room name come from the database, never from the request.
async function sendInviteCodeEmail({ senderUserId, email, inviteCode }) {
    const recipient = requireValidEmail(email);

    const sender = db.prepare(`SELECT email, is_anonymous FROM users WHERE id = ?`).get(senderUserId);
    if (!sender || sender.is_anonymous || !sender.email) {
        throw new RoomError(403, 'Sign in with your email to send invites');
    }
    const room = getRoomByInviteCode(inviteCode);
    if (!room || !canViewRoom(room.id, senderUserId)) throw new RoomError(404, 'Room not found');
    if (!emailAllowed(`user:${senderUserId}`, recipient)) throw new RoomError(429, 'Too many emails. Try again later.');

    const roomName = plainText(room.name, 60) || 'Mortgage Backed Monopoly';
    await sendEmail(
        recipient,
        `Your room code for ${roomName}`,
        `Your invite code is: ${room.invite_code}\n\nShare it with friends to join your game.`,
        `<p>Your invite code is: <strong>${escapeHtml(room.invite_code)}</strong></p><p>Share it with friends to join your game.</p>`
    );
}

// Mails the address the codes of every room it is in. Callers answer the same
// way whether or not anything was sent, so this can't probe for accounts.
async function sendForgotRoomCodes({ email, requesterKey }) {
    const recipient = requireValidEmail(email);
    if (!emailAllowed(requesterKey, recipient)) return;

    const rooms = db.prepare(`
        SELECT DISTINCT rooms.name, rooms.invite_code, rooms.status
        FROM rooms
        JOIN room_members ON room_members.room_id = rooms.id
        JOIN users ON users.id = room_members.user_id
        WHERE lower(users.email) = ?
        ORDER BY rooms.created_at DESC
    `).all(recipient);
    if (rooms.length === 0) return;

    const listText = rooms.map(room => `${room.name}: ${room.invite_code} (${room.status})`).join('\n');
    const listHtml = rooms
        .map(room => `<li><strong>${escapeHtml(room.invite_code)}</strong> - ${escapeHtml(room.name)} (${escapeHtml(room.status)})</li>`)
        .join('');
    await sendEmail(
        recipient,
        'Your Mortgage Backed room codes',
        `Here are your room codes:\n\n${listText}`,
        `<p>Here are your room codes:</p><ul>${listHtml}</ul>`
    );
}

module.exports = { sendInviteCodeEmail, sendForgotRoomCodes };
