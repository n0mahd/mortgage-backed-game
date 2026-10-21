const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('../mailer');
const db = require('../db');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const { normalizeEmail, isValidEmail } = require('../normalizers');
const { createAnonymousUser } = require('../services/rooms');

const config = getConfig();
const JWT_SECRET = config.jwtSecret;
const JWT_EXPIRY = config.jwtExpiry;
const otpSendLimits = new Map();
const otpVerifyLimits = new Map();
const transferRedeemLimits = new Map();
const authRateLimit = createRateLimiter({
    name: 'auth',
    ...config.rateLimits.auth,
    keyGenerator: req => {
        const email = normalizeEmail(req.body?.email);
        const emailKey = email ? `:email:${email}` : '';
        return `${getRequestActorKey(req)}:${req.method}:${req.path}${emailKey}`;
    },
});

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = verifyToken(header.slice(7));
    if (!userId) return res.status(401).json({ error: 'Invalid token' });
    req.userId = userId;
    next();
}

// Returns the user id for a valid player token, or null.
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET).sub || null;
    } catch {
        return null;
    }
}

function makeToken(userId) {
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// POST /api/auth/send-otp
router.post('/send-otp', authRateLimit, async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Valid email required' });
    }
    if (isRateLimited(otpSendLimits, `${req.ip}:${normalizedEmail}`, 5, 15 * 60 * 1000)) {
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

    if (isRateLimited(otpVerifyLimits, `${req.ip}:${normalizedEmail}`, 10, 15 * 60 * 1000)) {
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

    res.json({ token: makeToken(user.id), user: { id: user.id, email: user.email, is_anonymous: false } });
});

// POST /api/auth/anonymous
router.post('/anonymous', authRateLimit, (req, res) => {
    const user = createAnonymousUser();
    res.json({ token: makeToken(user.id), user });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
    const user = db.prepare(`SELECT id, email, is_anonymous FROM users WHERE id = ?`).get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// Moving to another device: the signed-in device asks for a short one-time
// code, and the new device redeems it for its own token for the same user.
const TRANSFER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRANSFER_CODE_LENGTH = 8;
const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;

function hashTransferCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

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
    `).run(hashTransferCode(code), req.userId, toSqliteDate(expiresAt));

    res.json({ code, expiresAt: expiresAt.toISOString() });
});

// POST /api/auth/redeem-transfer
router.post('/redeem-transfer', authRateLimit, (req, res) => {
    const code = normalizeTransferCode(req.body?.code);
    if (code.length !== TRANSFER_CODE_LENGTH) return res.status(400).json({ error: 'Enter the 8-character code' });
    if (isRateLimited(transferRedeemLimits, req.ip, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }

    const codeHash = hashTransferCode(code);
    const record = db.prepare(`
        SELECT user_id FROM device_transfer_codes
        WHERE code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(codeHash);
    if (!record) return res.status(400).json({ error: 'That code is invalid or has expired' });

    db.prepare(`UPDATE device_transfer_codes SET used_at = datetime('now') WHERE code_hash = ?`).run(codeHash);
    const user = db.prepare(`SELECT id, email, is_anonymous FROM users WHERE id = ?`).get(record.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ token: makeToken(user.id), user: { ...user, is_anonymous: !!user.is_anonymous } });
});

router.post('/signout', requireAuth, (req, res) => {
    // JWTs are stateless; nothing to delete. Client clears the token.
    res.json({ ok: true });
});

module.exports = { router, requireAuth, makeToken, verifyToken };

function toSqliteDate(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

function isRateLimited(map, key, max, windowMs) {
    const now = Date.now();
    const record = map.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
        record.count = 0;
        record.resetAt = now + windowMs;
    }
    record.count += 1;
    map.set(key, record);
    return record.count > max;
}
