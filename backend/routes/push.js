'use strict';

const express = require('express');
const { requireAuth } = require('./auth');
const { getConfig } = require('../config');
const { createRateLimiter } = require('../rateLimit');
const push = require('../services/push');

const router = express.Router();
const config = getConfig();
const pushRateLimit = createRateLimiter({ name: 'push', ...config.rateLimits.auth });
const testRateLimit = createRateLimiter({ name: 'push_test', ...config.rateLimits.emailSender });

// GET /api/push/config — whether alerts are available and the VAPID public key.
router.get('/config', (_req, res) => {
    const { enabled, publicKey } = push.pushConfig();
    res.json(enabled ? { enabled, publicKey } : { enabled: false });
});

// POST /api/push/subscriptions — remember this device for the signed-in player.
router.post('/subscriptions', requireAuth, pushRateLimit, (req, res) => {
    if (!push.pushConfig().enabled) return res.status(503).json({ error: 'Alerts are not available right now' });
    const subscription = push.validateSubscription(req.body?.subscription);
    if (!subscription) return res.status(400).json({ error: 'Unsupported push subscription' });
    push.saveSubscription(req.userId, subscription);
    res.json({ ok: true, devices: push.countSubscriptions(req.userId) });
});

// DELETE /api/push/subscriptions — forget this device.
router.delete('/subscriptions', requireAuth, pushRateLimit, (req, res) => {
    push.deleteSubscription(req.userId, req.body?.endpoint);
    res.json({ ok: true, devices: push.countSubscriptions(req.userId) });
});

// POST /api/push/test — send a test alert to the player's own devices.
router.post('/test', requireAuth, testRateLimit, async (req, res) => {
    const { sent } = await push.sendToUser(req.userId, {
        title: 'Alerts are on',
        body: "You'll get a notification like this when it's your turn.",
        url: '/lobby.html',
        tag: 'test',
    });
    res.json({ ok: true, sent });
});

module.exports = router;
