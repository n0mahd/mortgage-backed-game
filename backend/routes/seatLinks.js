'use strict';

// Seat links, the player's side: redeeming a link the host shared
// (services/seatLinks.js). No sign-in needed; always rate limited per IP.

const express = require('express');
const { createRateLimiter } = require('../rateLimit');
const { makeToken, optionalUserId } = require('../auth');
const { redeemSeatLink } = require('../services/seatLinks');
const { getPublicUser } = require('../services/accounts');

const router = express.Router();
const redeemLimit = createRateLimiter({ name: 'seat_link_redeem', enabled: true, max: 20, windowMs: 15 * 60 * 1000 });

// POST /api/seat-links/redeem { token }
router.post('/redeem', (req, res) => {
    if (!redeemLimit.check(req.ip).allowed) {
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const result = redeemSeatLink({ token: req.body?.token, callerUserId: optionalUserId(req) });
    if (result.signInAs) {
        return res.json({ token: makeToken(result.signInAs), user: getPublicUser(result.signInAs), room: result.room });
    }
    if (result.requiresSignIn) return res.json({ requires_sign_in: true, room: result.room });
    res.json({ room: result.room });
});

module.exports = router;
