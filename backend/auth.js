'use strict';

// Player tokens: signed JWTs whose subject is the user id. requireAuth is the
// middleware every signed-in route uses.

const jwt = require('jsonwebtoken');
const { getConfig, REFRESHED_TOKEN_HEADER } = require('./config');

const config = getConfig();

// Returns { userId, stale } for a valid player token, or null. A stale token
// was signed with JWT_SECRET_PREVIOUS and should be swapped for a new one.
function readToken(token) {
    const secrets = config.jwtPreviousSecret ? [config.jwtSecret, config.jwtPreviousSecret] : [config.jwtSecret];
    for (const [index, secret] of secrets.entries()) {
        try {
            const userId = jwt.verify(token, secret).sub;
            return userId ? { userId, stale: index > 0 } : null;
        } catch {}
    }
    return null;
}

function makeToken(userId) {
    return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiry });
}

// Sets req.userId from the Bearer token, and hands stale tokens a replacement
// in the X-Refreshed-Token header.
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = readToken(header.slice(7));
    if (!result) return res.status(401).json({ error: 'Invalid token' });
    if (result.stale) res.set(REFRESHED_TOKEN_HEADER, makeToken(result.userId));
    req.userId = result.userId;
    next();
}

module.exports = { readToken, makeToken, requireAuth };
