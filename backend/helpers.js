'use strict';

// Small helpers shared across routes and services.

const crypto = require('crypto');

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isValidEmail(email) {
    return email.includes('@');
}

function normalizeInviteCode(code) {
    return String(code || '').trim().toUpperCase();
}

// Player-typed text made safe for one line: control characters become spaces,
// then it is trimmed and cut to maxLength.
function plainText(value, maxLength) {
    return String(value ?? '').replace(/\p{C}+/gu, ' ').trim().slice(0, maxLength);
}

// Secrets (agent keys, transfer codes, rejoin secrets) are stored only as this hash.
function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

// SQLite's datetime('now') format, so stored expiry times compare correctly with it.
function toSqliteDate(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

module.exports = {
    normalizeEmail,
    isValidEmail,
    normalizeInviteCode,
    plainText,
    sha256Hex,
    toSqliteDate,
};
