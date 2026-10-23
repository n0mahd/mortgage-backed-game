'use strict';

// Username and password accounts (documents/accounts-and-game-management.md).
// A user is an account when it has an email (email code sign-in) or a username
// and password; guests have neither. Registering while signed in as a guest
// upgrades that user in place, so every seat they hold stays theirs.
//
// Passwords are hashed with scrypt and a random salt, stored as
// scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>, and compared in constant time.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { normalizeEmail } = require('../helpers');
const { RoomError } = require('./rooms');

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 };
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;
const LOGIN_FAILED = 'Wrong username or password';

function scrypt(password, salt, { N, r, p, keyLength }) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keyLength, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key)));
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(String(password), salt, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [N, r, p] = parts.slice(1, 4).map(Number);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (![N, r, p].every(Number.isInteger) || expected.length === 0) return false;
    const actual = await scrypt(String(password), salt, { N, r, p, keyLength: expected.length });
    return crypto.timingSafeEqual(actual, expected);
}

// A hash of nothing, checked when the login matches no user so a wrong
// username takes as long as a wrong password.
let dummyHashPromise = null;
function dummyHash() {
    if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
    return dummyHashPromise;
}

function cleanUsername(raw) {
    const username = typeof raw === 'string' ? raw.trim() : '';
    if (!USERNAME_PATTERN.test(username)) {
        throw new RoomError(400, 'Usernames are 3 to 24 letters, digits, _ . or -');
    }
    return username;
}

function checkPassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        throw new RoomError(400, `Passwords are ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
    }
}

function requireFreeUsername(username, userId = null) {
    const owner = db.prepare(`SELECT id FROM users WHERE username_key = ?`).get(username.toLowerCase());
    if (owner && owner.id !== userId) throw new RoomError(409, 'Username taken');
}

function getUserRow(userId) {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) || null;
}

// The user shape every auth endpoint answers with.
function publicUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        email: row.email || null,
        username: row.username || null,
        is_anonymous: !!row.is_anonymous,
        has_password: !!row.password_hash,
    };
}

function getPublicUser(userId) {
    return publicUser(getUserRow(userId));
}

function isAccount(userId) {
    const row = getUserRow(userId);
    return !!row && !row.is_anonymous;
}

function saveCredentials(userId, username, passwordHash) {
    try {
        db.prepare(`
            UPDATE users
            SET username = ?, username_key = ?, password_hash = ?, password_updated_at = datetime('now'), is_anonymous = 0
            WHERE id = ?
        `).run(username, username.toLowerCase(), passwordHash, userId);
    } catch (err) {
        if (/UNIQUE/i.test(err.message || '')) throw new RoomError(409, 'Username taken');
        throw err;
    }
}

// Creates an account, or upgrades the signed-in guest (currentUserId) in
// place. Returns the user row's public shape.
async function register({ currentUserId = null, username: rawUsername, password }) {
    const username = cleanUsername(rawUsername);
    checkPassword(password);

    const current = currentUserId ? getUserRow(currentUserId) : null;
    if (current && !current.is_anonymous) {
        throw new RoomError(400, 'You already have an account. Change your password instead.');
    }
    requireFreeUsername(username);
    const passwordHash = await hashPassword(password);

    let userId = current ? current.id : null;
    if (!userId) {
        userId = uuidv4();
        db.prepare(`INSERT INTO users (id, email, is_anonymous) VALUES (?, NULL, 0)`).run(userId);
    }
    try {
        saveCredentials(userId, username, passwordHash);
    } catch (err) {
        if (!current) db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
        throw err;
    }
    return getPublicUser(userId);
}

// login is a username or an email. Returns the user, or throws 401 with one
// message for every failure.
async function login({ login: rawLogin, password }) {
    const loginText = typeof rawLogin === 'string' ? rawLogin.trim() : '';
    const row = !loginText || typeof password !== 'string' ? null
        : loginText.includes('@')
            ? db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizeEmail(loginText))
            : db.prepare(`SELECT * FROM users WHERE username_key = ?`).get(loginText.toLowerCase());

    const ok = row && row.password_hash
        ? await verifyPassword(password, row.password_hash)
        : (await verifyPassword(String(password || ''), await dummyHash()), false);
    if (!ok) throw new RoomError(401, LOGIN_FAILED);
    return publicUser(row);
}

// Sets or changes the password, and the username if given. The current
// password is required once the user has one.
async function setPassword({ userId, username: rawUsername, password, currentPassword }) {
    const row = getUserRow(userId);
    if (!row) throw new RoomError(404, 'User not found');
    checkPassword(password);

    const username = rawUsername !== undefined && rawUsername !== null && rawUsername !== ''
        ? cleanUsername(rawUsername)
        : row.username;
    if (!username && !row.email) throw new RoomError(400, 'Choose a username');
    if (username && username !== row.username) requireFreeUsername(username, row.id);

    if (row.password_hash) {
        const ok = typeof currentPassword === 'string' && await verifyPassword(currentPassword, row.password_hash);
        if (!ok) throw new RoomError(400, 'Current password is wrong');
    }

    const passwordHash = await hashPassword(password);
    if (username) {
        saveCredentials(row.id, username, passwordHash);
    } else {
        db.prepare(`
            UPDATE users SET password_hash = ?, password_updated_at = datetime('now'), is_anonymous = 0 WHERE id = ?
        `).run(passwordHash, row.id);
    }
    return getPublicUser(row.id);
}

module.exports = {
    hashPassword,
    verifyPassword,
    publicUser,
    getPublicUser,
    isAccount,
    register,
    login,
    setPassword,
};
