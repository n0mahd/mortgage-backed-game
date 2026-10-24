'use strict';

// Every setting the backend reads from the environment (and backend/.env),
// with its default and the production guards.

const path = require('path');

const DEFAULT_DEV_SECRET = 'dev-secret-change-me';
// Response header carrying a replacement for a token signed with the previous secret.
const REFRESHED_TOKEN_HEADER = 'X-Refreshed-Token';

function loadDotEnv() {
    const fs = require('fs');
    const envPath = path.join(__dirname, '.env');
    try {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq === -1) continue;
            const key = trimmed.slice(0, eq).trim();
            const val = trimmed.slice(eq + 1).trim();
            if (key && !process.env[key]) process.env[key] = val;
        }
    } catch {}
}

function isProduction() {
    return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
}

function getConfig() {
    loadDotEnv();
    const env = process.env.APP_ENV || process.env.NODE_ENV || 'development';
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || process.env.BIND_HOST || (isProduction() ? '127.0.0.1' : '0.0.0.0');
    const jwtSecret = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
    // Set only while rotating JWT_SECRET: tokens signed with it still work and
    // are swapped for new ones, so rotation signs nobody out. Remove it once
    // players have moved over.
    const jwtPreviousSecret = process.env.JWT_SECRET_PREVIOUS || null;
    const dbPath = process.env.DB_PATH || (process.env.NODE_ENV === 'test'
        ? ':memory:'
        : path.join(__dirname, 'game.db'));
    const corsOrigins = (process.env.CORS_ORIGINS || (isProduction() ? '' : '*'))
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
    const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED
        ? process.env.RATE_LIMIT_ENABLED !== 'false'
        : process.env.NODE_ENV !== 'test';

    if (isProduction()) {
        if (!process.env.DB_PATH) throw new Error('DB_PATH is required in production');
        if (!process.env.JWT_SECRET || jwtSecret === DEFAULT_DEV_SECRET) {
            throw new Error('A non-default JWT_SECRET is required in production');
        }
        if (jwtPreviousSecret === jwtSecret) {
            throw new Error('JWT_SECRET_PREVIOUS must differ from JWT_SECRET');
        }
        if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
            throw new Error('CORS_ORIGINS must be explicit in production');
        }
        if (host !== '127.0.0.1' && host !== 'localhost') {
            throw new Error('Production HOST/BIND_HOST must be 127.0.0.1');
        }
        if (process.env.PUSH_ALLOW_LOCAL_ENDPOINTS === 'true') {
            throw new Error('PUSH_ALLOW_LOCAL_ENDPOINTS is for tests and dev only');
        }
    }

    return {
        env,
        isProduction: isProduction(),
        port,
        host,
        jwtSecret,
        jwtPreviousSecret,
        jwtExpiry: process.env.JWT_EXPIRY || (isProduction() ? '12h' : '30d'),
        dbPath,
        corsOrigins,
        trustProxy: parseTrustProxy(process.env.TRUST_PROXY, isProduction()),
        allowStateRepair: process.env.ALLOW_STATE_REPAIR === 'true',
        requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '256kb',
        // Public browser URL used in links handed to MCP agents (room join links).
        publicAppUrl: (process.env.PUBLIC_APP_URL || 'https://mortgage.abdlh.com').replace(/\/+$/, ''),
        otpLogEnabled: process.env.LOG_OTPS === 'true' && !isProduction(),
        actionAuditLogEnabled: process.env.ACTION_AUDIT_LOG
            ? process.env.ACTION_AUDIT_LOG !== 'false'
            : process.env.NODE_ENV !== 'test',
        // Mail goes to a Resend-compatible HTTP API. The USESEND_ names are
        // historical; production points USESEND_URL at Resend. No key: no mail.
        email: {
            apiKey: process.env.USESEND_API_KEY || null,
            url: process.env.USESEND_URL || 'https://api.resend.com/emails',
            from: process.env.SMTP_FROM || 'noreply@abdlh.com',
        },
        // Web Push (turn alerts). Without both keys, alerts are off.
        vapid: {
            publicKey: process.env.VAPID_PUBLIC_KEY || null,
            privateKey: process.env.VAPID_PRIVATE_KEY || null,
            subject: process.env.VAPID_SUBJECT || 'mailto:noreply@abdlh.com',
        },
        rateLimitEnabled,
        rateLimits: {
            auth: buildRateLimitConfig('AUTH', rateLimitEnabled, { max: 120, windowMs: 15 * 60 * 1000 }),
            roomCreate: buildRateLimitConfig('ROOM_CREATE', rateLimitEnabled, { max: 12, windowMs: 60 * 60 * 1000 }),
            gameAction: buildRateLimitConfig('GAME_ACTION', rateLimitEnabled, { max: 120, windowMs: 60 * 1000 }),
            rejoinRequest: buildRateLimitConfig('REJOIN_REQUEST', rateLimitEnabled, { max: 20, windowMs: 15 * 60 * 1000 }),
            rejoinCollect: buildRateLimitConfig('REJOIN_COLLECT', rateLimitEnabled, { max: 600, windowMs: 15 * 60 * 1000 }),
            mcp: buildRateLimitConfig('MCP', rateLimitEnabled, { max: 300, windowMs: 60 * 1000 }),
            emailSender: buildRateLimitConfig('EMAIL_SENDER', rateLimitEnabled, { max: 10, windowMs: 60 * 60 * 1000 }),
            emailRecipient: buildRateLimitConfig('EMAIL_RECIPIENT', rateLimitEnabled, { max: 3, windowMs: 60 * 60 * 1000 }),
        },
    };
}

function getCorsOptions(config) {
    const exposedHeaders = [REFRESHED_TOKEN_HEADER];
    if (config.corsOrigins.includes('*')) return { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'], exposedHeaders };
    return {
        origin(origin, callback) {
            if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
            const err = new Error('Origin not allowed');
            err.status = 403;
            return callback(err);
        },
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        exposedHeaders,
    };
}

function buildRateLimitConfig(prefix, enabled, defaults) {
    return {
        enabled,
        max: readPositiveInteger(`${prefix}_RATE_LIMIT_MAX`, defaults.max),
        windowMs: readPositiveInteger(`${prefix}_RATE_LIMIT_WINDOW_MS`, defaults.windowMs),
    };
}

function readPositiveInteger(envName, fallback) {
    const raw = process.env[envName];
    if (!raw) return fallback;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
    if (isProduction()) throw new Error(`${envName} must be a positive integer`);
    return fallback;
}

function parseTrustProxy(raw, production) {
    if (raw === undefined) return production ? 'loopback' : false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && String(numeric) === raw) return numeric;
    return raw;
}

module.exports = { getConfig, getCorsOptions, isProduction, REFRESHED_TOKEN_HEADER };
