'use strict';

// Web Push delivery for "your turn" alerts. Browsers hand us a subscription
// (an endpoint URL at their vendor's push service plus encryption keys); we
// sign each message with our own VAPID key pair, so no Apple or Google
// developer account is involved. Payloads are end-to-end encrypted to the
// device: the push service relays them without being able to read them.

const webpush = require('web-push');
const db = require('../db');

// Only the browser vendors' push services. We send requests to whatever URL a
// browser registers, so anything else would let a client aim the server at
// arbitrary hosts.
const PUSH_SERVICE_HOSTS = [
    /^web\.push\.apple\.com$/,
    /^[a-z0-9-]+\.push\.apple\.com$/,
    /^fcm\.googleapis\.com$/,
    /^updates\.push\.services\.mozilla\.com$/,
    /^[a-z0-9-]+\.notify\.windows\.com$/,
];
const MAX_SUBSCRIPTIONS_PER_USER = 5;

let configured = null;

function pushConfig() {
    if (configured !== null) return configured;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@abdlh.com';
    if (!publicKey || !privateKey) {
        configured = { enabled: false };
    } else {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        configured = { enabled: true, publicKey };
    }
    return configured;
}

function isAllowedEndpoint(endpoint) {
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        return false;
    }
    // Integration tests run a local HTTPS stand-in for the push service.
    if (process.env.NODE_ENV === 'test' && process.env.PUSH_ALLOW_LOCAL_ENDPOINTS === 'true' && url.hostname === '127.0.0.1') {
        return url.protocol === 'https:';
    }
    return url.protocol === 'https:' && !url.port && PUSH_SERVICE_HOSTS.some(pattern => pattern.test(url.hostname));
}

function validateSubscription(subscription) {
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (typeof endpoint !== 'string' || endpoint.length > 1024 || !isAllowedEndpoint(endpoint)) return null;
    if (typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh)) return null;
    if (typeof auth !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(auth)) return null;
    return { endpoint, p256dh, auth };
}

function saveSubscription(userId, subscription) {
    db.prepare(`
        INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
    `).run(subscription.endpoint, userId, subscription.p256dh, subscription.auth);
    // Keep only the newest few devices per player.
    db.prepare(`
        DELETE FROM push_subscriptions
        WHERE user_id = ? AND endpoint NOT IN (
            SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
        )
    `).run(userId, userId, MAX_SUBSCRIPTIONS_PER_USER);
}

function deleteSubscription(userId, endpoint) {
    db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).run(userId, String(endpoint || ''));
}

function countSubscriptions(userId) {
    return db.prepare(`SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?`).get(userId).count;
}

// Send a notification to every device the user enabled. Never throws: alerts
// are best effort and must not affect the game action that triggered them.
async function sendToUser(userId, message) {
    if (!pushConfig().enabled) return { sent: 0 };
    const subscriptions = db.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`).all(userId);
    let sent = 0;
    await Promise.all(subscriptions.map(async sub => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify(message),
                { TTL: 15 * 60, urgency: 'high', topic: message.topic }
            );
            sent += 1;
            db.prepare(`UPDATE push_subscriptions SET last_success_at = datetime('now') WHERE endpoint = ?`).run(sub.endpoint);
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(sub.endpoint);
            } else {
                console.error('Push send failed:', err.statusCode || err.message);
            }
        }
    }));
    return { sent };
}

module.exports = {
    pushConfig,
    validateSubscription,
    saveSubscription,
    deleteSubscription,
    countSubscriptions,
    sendToUser,
    isAllowedEndpoint,
};
