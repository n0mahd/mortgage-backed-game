'use strict';

// A local stand-in for the browser vendor's push service (FCM, Apple, Mozilla),
// so turn alerts can be verified headless from end to end. Headless Chromium
// can't reach a real push service, so its pushManager.subscribe always fails.
// Everything else stays real:
//
//   browser page (real Turn alerts sheet, real /api/push calls)
//     -> backend (real subscription checks, VAPID signing, aes128gcm encryption)
//     -> this relay (checks the VAPID JWT, decrypts with the device's private key)
//     -> the browser's real service worker, through CDP ServiceWorker.deliverPushMessage
//     -> sw.js showNotification, read back with registration.getNotifications().
//
// The only substitute is in the page: PushManager.subscribe/getSubscription
// hand out this relay's endpoint and a key pair the harness made (see
// installFakePushManager). The daemon starts the relay before the backend and
// passes PUSH_ALLOW_LOCAL_ENDPOINTS and NODE_EXTRA_CA_CERTS so the backend
// accepts and trusts it; production refuses that flag (backend/config.js).

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

function b64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

// Checks the `Authorization: vapid t=<jwt>, k=<public key>` header the way a
// push service does: ES256 signature by k, audience is this origin, not expired.
function checkVapid(header, origin) {
    const match = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(String(header || ''));
    if (!match) return { ok: false, error: `no VAPID authorization header (${String(header || '').slice(0, 40)})` };
    const [, jwt, k] = match;
    const [h, p, sig] = jwt.split('.');
    let claims;
    try {
        claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
        const raw = Buffer.from(k, 'base64url');
        const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) }, format: 'jwk' });
        const valid = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
        if (!valid) return { ok: false, error: 'VAPID signature does not verify' };
    } catch (err) {
        return { ok: false, error: `unreadable VAPID token: ${err.message}` };
    }
    if (claims.aud !== origin) return { ok: false, error: `VAPID audience ${claims.aud} is not ${origin}` };
    if (!(claims.exp * 1000 > Date.now())) return { ok: false, error: 'VAPID token expired' };
    return { ok: true, publicKey: k, subject: claims.sub };
}

async function startPushRelay({ dir, appRoot, log = () => {} }) {
    fs.mkdirSync(dir, { recursive: true });
    const keyFile = path.join(dir, 'push-relay-key.pem');
    const certFile = path.join(dir, 'push-relay-cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    // web-push's own decryption library, from the app under test.
    const ece = require(path.join(appRoot, 'backend', 'node_modules', 'http_ece'));

    const devices = new Map(); // id -> device
    const received = []; // every request, in order
    let nextId = 0;
    let base = null;

    async function handle(req, body) {
        const id = decodeURIComponent((req.url.match(/^\/push\/([^/?]+)/) || [])[1] || '');
        const device = devices.get(id);
        const entry = {
            at: Date.now(), deviceId: id, person: device?.person || null,
            ttl: Number(req.headers.ttl), urgency: req.headers.urgency || null, topic: req.headers.topic || null,
            encoding: req.headers['content-encoding'] || null, bytes: body.length,
            payload: null, error: null, delivered: false,
        };
        received.push(entry);
        if (req.method !== 'POST') return [405, (entry.error = `method ${req.method}`)];
        if (!device) return [404, (entry.error = 'unknown subscription')];
        if (device.gone) return [410, (entry.error = 'subscription was unsubscribed')];
        const vapid = checkVapid(req.headers.authorization, base);
        if (!vapid.ok) return [401, (entry.error = vapid.error)];
        if (device.applicationServerKey && device.applicationServerKey !== vapid.publicKey) {
            return [403, (entry.error = 'signed with a different VAPID key than the browser subscribed with')];
        }
        if (entry.encoding !== 'aes128gcm') return [400, (entry.error = `content-encoding ${entry.encoding}`)];
        try {
            const plain = ece.decrypt(body, { version: 'aes128gcm', privateKey: device.ecdh, authSecret: device.auth });
            entry.payload = JSON.parse(plain.toString('utf8'));
        } catch (err) {
            return [400, (entry.error = `could not decrypt: ${err.message}`)];
        }
        // Answer like a push service (201), then hand the message to the browser.
        setImmediate(async () => {
            try {
                await device.deliver(JSON.stringify(entry.payload));
                entry.delivered = true;
            } catch (err) {
                entry.error = `delivery to the service worker failed: ${err.message}`;
            }
            log(`push relay: ${device.person} <- ${entry.payload?.title}${entry.error ? ` (${entry.error})` : ''}`);
        });
        return [201, null];
    }

    const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
            const [status] = await handle(req, Buffer.concat(chunks)).catch(err => [500, err.message]);
            res.statusCode = status;
            res.end();
        });
    });
    await new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    base = `https://127.0.0.1:${server.address().port}`;

    return {
        base,
        certFile,
        received,
        // A push "device" for one person: their subscription keys and how to
        // deliver into their browser. deliver(data) is set by the caller.
        newDevice(person) {
            const id = `d${++nextId}-${crypto.randomBytes(6).toString('hex')}`;
            const ecdh = crypto.createECDH('prime256v1');
            ecdh.generateKeys();
            const device = {
                id, person, ecdh,
                auth: crypto.randomBytes(16),
                endpoint: `${base}/push/${id}`,
                applicationServerKey: null,
                gone: false,
                deliver: async () => { throw new Error('no browser attached'); },
            };
            device.keys = { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(device.auth) };
            devices.set(id, device);
            return device;
        },
        forPerson(person) {
            return received.filter(r => r.person === person);
        },
        close() {
            return new Promise(resolve => server.close(resolve));
        },
    };
}

module.exports = { startPushRelay, checkVapid };
