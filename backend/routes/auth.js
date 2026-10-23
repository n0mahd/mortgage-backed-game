'use strict';

// Sign-in: username/password accounts, email codes, anonymous guests, device
// transfer codes, and token refresh. Account logic is in services/accounts.js.

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getConfig } = require('../config');
const { sendEmail } = require('../services/mailer');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const { normalizeEmail, isValidEmail, sha256Hex, toSqliteDate } = require('../helpers');
const { createAnonymousUser } = require('../services/rooms');
const { readToken, makeToken, requireAuth, optionalUserId } = require('../auth');
const accounts = require('../services/accounts');

const router = express.Router();
const config = getConfig();
const authRateLimit = createRateLimiter({
    name: 'auth',
    ...config.rateLimits.auth,
    keyGenerator: req => {
        const email = normalizeEmail(req.body?.email);
        const emailKey = email ? `:email:${email}` : '';
        return `${getRequestActorKey(req)}:${req.method}:${req.path}${emailKey}`;
    },
});
// Per-address limits on guessing codes. Always on, even where the general
// limits are switched off (tests, dev).
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const otpSendLimit = createRateLimiter({ name: 'otp_send', enabled: true, max: 5, windowMs: FIFTEEN_MINUTES });
const otpVerifyLimit = createRateLimiter({ name: 'otp_verify', enabled: true, max: 10, windowMs: FIFTEEN_MINUTES });
const transferRedeemLimit = createRateLimiter({ name: 'transfer_redeem', enabled: true, max: 10, windowMs: FIFTEEN_MINUTES });
const loginLimit = createRateLimiter({ name: 'password_login', enabled: true, max: 10, windowMs: FIFTEEN_MINUTES });
// Caps guesses at one account from many addresses.
const loginAccountLimit = createRateLimiter({ name: 'password_login_account', enabled: true, max: 50, windowMs: FIFTEEN_MINUTES });

// Express 4 does not catch rejected promises; hand them to the error handler.
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// POST /api/auth/register { username, password } — a new account, or the
// signed-in guest upgraded in place (same user id, so their seats stay).
router.post('/register', authRateLimit, asyncRoute(async (req, res) => {
    const currentUserId = optionalUserId(req);
    const user = await accounts.register({
        currentUserId: currentUserId && accounts.getPublicUser(currentUserId) ? currentUserId : null,
        username: req.body?.username,
        password: req.body?.password,
    });
    res.json({ token: makeToken(user.id), user });
}));

// POST /api/auth/login { login, password } — login is a username or an email.
router.post('/login', authRateLimit, asyncRoute(async (req, res) => {
    const loginKey = String(req.body?.login ?? '').trim().toLowerCase().slice(0, 254);
    if (!loginLimit.check(`${req.ip}:${loginKey}`).allowed || !loginAccountLimit.check(loginKey).allowed) {
        return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    }
    const user = await accounts.login({ login: req.body?.login, password: req.body?.password });
    res.json({ token: makeToken(user.id), user });
}));

// POST /api/auth/password { username?, password, current_password? } — set or
// change the password (and the username if given).
router.post('/password', requireAuth, authRateLimit, asyncRoute(async (req, res) => {
    const user = await accounts.setPassword({
        userId: req.userId,
        username: req.body?.username,
        password: req.body?.password,
        currentPassword: req.body?.current_password,
    });
    res.json({ user });
}));

// POST /api/auth/send-otp
router.post('/send-otp', authRateLimit, async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Valid email required' });
    }
    if (!otpSendLimit.check(`${req.ip}:${normalizedEmail}`).allowed) {
        return res.status(429).json({ error: 'Too many code requests' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const id = uuidv4();
    const expires = toSqliteDate(new Date(Date.now() + 10 * 60 * 1000)); // 10 min

    // Invalidate old OTPs for this email
    db.prepare(`DELETE FROM otps WHERE email = ?`).run(normalizedEmail);

    db.prepare(`
        INSERT INTO otps (id, email, code, expires_at)
        VALUES (?, ?, ?, ?)
    `).run(id, normalizedEmail, code, expires);

    if (process.env.NODE_ENV !== 'test') {
        try {
            await sendEmail(
                normalizedEmail,
                'Your Mortgage Backed Monopoly login code',
                `Your verification code is: ${code}\n\nValid for 10 minutes.`,
                `<p>Your verification code is: <strong>${code}</strong></p><p>Valid for 10 minutes.</p>`
            );
        } catch (err) {
            console.error('Email send error:', err.message);
            if (config.otpLogEnabled) console.log(`\nOTP for ${normalizedEmail}: ${code}\n`);
        }
    }

    res.json({ ok: true });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', authRateLimit, (req, res) => {
    const { token } = req.body;
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail || !token) {
        return res.status(400).json({ error: 'email and token required' });
    }

    if (!otpVerifyLimit.check(`${req.ip}:${normalizedEmail}`).allowed) {
        return res.status(429).json({ error: 'Too many verification attempts' });
    }

    const otp = db.prepare(`
        SELECT * FROM otps
        WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    `).get(normalizedEmail, String(token));

    if (!otp) {
        db.prepare(`UPDATE otps SET attempts = attempts + 1 WHERE email = ? AND used = 0`).run(normalizedEmail);
        return res.status(400).json({ error: 'Invalid or expired code' });
    }

    // Mark OTP as used
    db.prepare(`UPDATE otps SET used = 1 WHERE id = ?`).run(otp.id);

    // Get or create user
    let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail);
    if (!user) {
        const userId = uuidv4();
        db.prepare(`INSERT INTO users (id, email, is_anonymous) VALUES (?, ?, 0)`).run(userId, normalizedEmail);
        user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    }

    res.json({ token: makeToken(user.id), user: accounts.publicUser(user) });
});

// POST /api/auth/anonymous
router.post('/anonymous', authRateLimit, (req, res) => {
    const user = createAnonymousUser();
    res.json({ token: makeToken(user.id), user: accounts.getPublicUser(user.id) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
    const user = accounts.getPublicUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// Moving to another device: the signed-in device asks for a short one-time
// code, and the new device redeems it for its own token for the same user.
const TRANSFER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRANSFER_CODE_LENGTH = 8;
const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;

function normalizeTransferCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// POST /api/auth/transfer-code
router.post('/transfer-code', requireAuth, authRateLimit, (req, res) => {
    const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let code = '';
    for (let i = 0; i < TRANSFER_CODE_LENGTH; i++) {
        code += TRANSFER_CODE_ALPHABET[crypto.randomInt(TRANSFER_CODE_ALPHABET.length)];
    }
    const expiresAt = new Date(Date.now() + TRANSFER_CODE_TTL_MS);
    db.prepare(`DELETE FROM device_transfer_codes WHERE user_id = ? AND used_at IS NULL`).run(req.userId);
    db.prepare(`
        INSERT INTO device_transfer_codes (code_hash, user_id, expires_at)
        VALUES (?, ?, ?)
    `).run(sha256Hex(code), req.userId, toSqliteDate(expiresAt));

    res.json({ code, expiresAt: expiresAt.toISOString() });
});

// POST /api/auth/redeem-transfer
router.post('/redeem-transfer', authRateLimit, (req, res) => {
    const code = normalizeTransferCode(req.body?.code);
    if (code.length !== TRANSFER_CODE_LENGTH) return res.status(400).json({ error: 'Enter the 8-character code' });
    if (!transferRedeemLimit.check(req.ip).allowed) {
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }

    const codeHash = sha256Hex(code);
    const record = db.prepare(`
        SELECT user_id FROM device_transfer_codes
        WHERE code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(codeHash);
    if (!record) return res.status(400).json({ error: 'That code is invalid or has expired' });

    db.prepare(`UPDATE device_transfer_codes SET used_at = datetime('now') WHERE code_hash = ?`).run(codeHash);
    const user = accounts.getPublicUser(record.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ token: makeToken(user.id), user });
});

// POST /api/auth/refresh-tokens — swap saved same-device (hotseat) tokens
// signed with the previous secret for new ones. Tokens that are already
// current come back unchanged; invalid ones come back as null.
router.post('/refresh-tokens', authRateLimit, (req, res) => {
    const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, 12) : [];
    res.json({
        tokens: tokens.map(token => {
            const result = typeof token === 'string' ? readToken(token) : null;
            if (!result) return null;
            return result.stale ? makeToken(result.userId) : token;
        }),
    });
});

router.post('/signout', requireAuth, (req, res) => {
    // JWTs are stateless; nothing to delete. Client clears the token.
    res.json({ ok: true });
});

module.exports = router;
