'use strict';

// Turn alerts end to end: real HTTP game actions, real web-push encryption and
// VAPID signing, delivered to a local HTTPS server standing in for the
// browser vendor's push service.

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = 'true';
// Lets tests pin dice through payload.testDice, so turns never depend on luck.
process.env.ALLOW_STATE_REPAIR = 'true';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const request = require('supertest');
const webpush = require('web-push');
const { createUserFixture, createRoomFixture, addRoomMemberFixture, resetTestDb } = require('../helpers/fixtures');

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;

let app, server, db, pushServer, pushBase, serverUrl;
let received = [];
let respondWith = 201;

function fakeBrowserSubscription(id) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return {
        endpoint: `${pushBase}/push/${id}`,
        keys: {
            p256dh: ecdh.getPublicKey().toString('base64url'),
            auth: crypto.randomBytes(16).toString('base64url'),
        },
    };
}

beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    const cert = fs.readFileSync(path.join(dir, 'cert.pem'));
    // Trust only this test certificate, for requests made by web-push.
    https.globalAgent.options.ca = cert;
    pushServer = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert }, (req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            received.push({ path: req.url, headers: req.headers, bytes: Buffer.concat(chunks).length });
            res.statusCode = respondWith;
            res.end();
        });
    });
    await new Promise(resolve => pushServer.listen(0, '127.0.0.1', resolve));
    pushBase = `https://127.0.0.1:${pushServer.address().port}`;
    ({ app, server } = require('../../server'));
    db = require('../../db');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise(resolve => pushServer.close(resolve));
    await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
    received = [];
    respondWith = 201;
    resetTestDb(db);
});

async function waitForPushes(count) {
    const deadline = Date.now() + 3000;
    while (received.length < count && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 100));
    return received;
}

async function startTwoPlayerGame() {
    const alice = createUserFixture(db, { anonymous: true });
    const bob = createUserFixture(db, { anonymous: true });
    const room = createRoomFixture(db, alice.id, { name: 'Friday night', playerName: 'Alice', maxPlayers: 2 });
    addRoomMemberFixture(db, room.id, bob.id, 'Bob');
    const game = await request(app).post('/api/games').set('Authorization', `Bearer ${alice.token}`).send({ room_id: room.id });
    return { alice, bob, room, game: game.body };
}

async function act(user, game, type, payload = {}) {
    const latest = await request(app).get(`/api/games/${game.id}`).set('Authorization', `Bearer ${user.token}`);
    return request(app).post(`/api/games/${game.id}/actions`).set('Authorization', `Bearer ${user.token}`)
        .send({ actionId: crypto.randomUUID(), type, payload, expectedVersion: latest.body.state_version });
}

// A roll of 3 every turn only ever lands on unowned streets, so End Turn always works.
const ROLL_THREE = { testDice: [1, 2] };

async function passTurn(user, game) {
    expect((await act(user, game, 'roll_dice', ROLL_THREE)).status).toBe(200);
    expect((await act(user, game, 'end_turn')).status).toBe(200);
}

async function subscribe(user, subscription) {
    return request(app).post('/api/push/subscriptions').set('Authorization', `Bearer ${user.token}`).send({ subscription });
}

test('config exposes the public key so browsers can subscribe', async () => {
    const res = await request(app).get('/api/push/config');
    expect(res.body).toEqual({ enabled: true, publicKey: vapid.publicKey });
});

test('only browser push services are accepted as endpoints', async () => {
    const user = createUserFixture(db, { anonymous: true });
    const keys = fakeBrowserSubscription('x').keys;
    for (const endpoint of [
        'http://web.push.apple.com/abc',
        'https://evil.example/push',
        'https://web.push.apple.com.evil.example/abc',
        'https://169.254.169.254/latest/meta-data',
        'https://fcm.googleapis.com:8443/fcm/send/abc',
        'file:///etc/passwd',
    ]) {
        const res = await subscribe(user, { endpoint, keys });
        expect({ endpoint, status: res.status }).toEqual({ endpoint, status: 400 });
    }
    process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = 'false';
    expect((await subscribe(user, fakeBrowserSubscription('local'))).status).toBe(400);
    process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = 'true';
    // Production never accepts a local push service, even with the flag set.
    const push = require('../../services/push');
    process.env.APP_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://example.test';
    try {
        expect(push.validateSubscription(fakeBrowserSubscription('local-prod'))).toBeNull();
        expect(() => require('../../config').getConfig()).toThrow(/PUSH_ALLOW_LOCAL_ENDPOINTS/);
    } finally {
        delete process.env.APP_ENV;
        delete process.env.CORS_ORIGINS;
    }
    expect((await subscribe(user, { endpoint: 'https://web.push.apple.com/QGx1', keys })).status).toBe(200);
});

test('subscribing requires a signed-in player', async () => {
    const res = await request(app).post('/api/push/subscriptions').send({ subscription: fakeBrowserSubscription('anon') });
    expect(res.status).toBe(401);
});

test('when Alice ends her turn, only Bob is alerted, with an encrypted, VAPID-signed push', async () => {
    const { alice, bob, game, room } = await startTwoPlayerGame();
    await subscribe(alice, fakeBrowserSubscription('alice-phone'));
    await subscribe(bob, fakeBrowserSubscription('bob-phone'));
    received = [];

    expect((await act(alice, game, 'roll_dice', ROLL_THREE)).status).toBe(200);
    await waitForPushes(0);
    // Rolling doesn't change whose turn it is.
    expect(received).toEqual([]);

    expect((await act(alice, game, 'end_turn')).status).toBe(200);
    const pushes = await waitForPushes(1);
    expect(pushes.map(p => p.path)).toEqual(['/push/bob-phone']);
    expect(pushes[0].headers['content-encoding']).toBe('aes128gcm');
    expect(pushes[0].headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(Number(pushes[0].headers.ttl)).toBeGreaterThan(0);
    expect(pushes[0].bytes).toBeGreaterThan(0);
    expect(room.name).toBe('Friday night');
});

test('starting a game alerts the first player unless they started it', async () => {
    const alice = createUserFixture(db, { anonymous: true });
    const bob = createUserFixture(db, { anonymous: true });
    const room = createRoomFixture(db, alice.id, { playerName: 'Alice', maxPlayers: 2 });
    addRoomMemberFixture(db, room.id, bob.id, 'Bob');
    await subscribe(alice, fakeBrowserSubscription('alice-phone'));
    await request(app).post('/api/games').set('Authorization', `Bearer ${alice.token}`).send({ room_id: room.id });
    expect(await waitForPushes(0)).toEqual([]);
});

test('a subscription the push service reports as gone is deleted', async () => {
    const { alice, bob, game } = await startTwoPlayerGame();
    await subscribe(bob, fakeBrowserSubscription('bob-old-phone'));
    respondWith = 410;
    await passTurn(alice, game);
    await waitForPushes(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?`).get(bob.id).n).toBe(0);
});

test('a failing push service never breaks the game action', async () => {
    const { alice, bob, game } = await startTwoPlayerGame();
    await subscribe(bob, fakeBrowserSubscription('bob-phone'));
    respondWith = 500;
    await passTurn(alice, game);
});

test('players can turn alerts off for a device', async () => {
    const user = createUserFixture(db, { anonymous: true });
    const sub = fakeBrowserSubscription('phone');
    await subscribe(user, sub);
    const res = await request(app).delete('/api/push/subscriptions').set('Authorization', `Bearer ${user.token}`).send({ endpoint: sub.endpoint });
    expect(res.body).toEqual({ ok: true, devices: 0 });
});

test('each player keeps at most five devices', async () => {
    const user = createUserFixture(db, { anonymous: true });
    for (let i = 0; i < 7; i++) await subscribe(user, fakeBrowserSubscription(`device-${i}`));
    const rows = db.prepare(`SELECT endpoint FROM push_subscriptions WHERE user_id = ?`).all(user.id).map(r => r.endpoint);
    expect(rows).toHaveLength(5);
    expect(rows.some(e => e.endsWith('/device-6'))).toBe(true);
    expect(rows.some(e => e.endsWith('/device-0'))).toBe(false);
});

describe('alerts only go to players who are not looking at the game', () => {
    const { io: ioClient } = require('socket.io-client');

    async function openGamePage(user, roomId) {
        const socket = ioClient(serverUrl, { auth: { token: user.token }, transports: ['websocket'], forceNew: true });
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
        });
        await new Promise(resolve => socket.emit('join_room', roomId, resolve));
        return socket;
    }

    async function setVisible(socket, visible) {
        socket.emit('presence', { visible });
        await new Promise(r => setTimeout(r, 100));
    }

    test('no push while the game is on screen; a push once it is hidden or closed', async () => {
        const { alice, bob, game, room } = await startTwoPlayerGame();
        await subscribe(bob, fakeBrowserSubscription('bob-phone'));
        const page = await openGamePage(bob, room.id);

        await setVisible(page, true);
        await passTurn(alice, game);
        expect(await waitForPushes(0)).toEqual([]);

        await passTurn(bob, game);
        await setVisible(page, false); // screen locked or app switched
        await passTurn(alice, game);
        expect((await waitForPushes(1)).map(p => p.path)).toEqual(['/push/bob-phone']);

        received = [];
        await passTurn(bob, game);
        await setVisible(page, true);
        page.disconnect(); // tab closed without saying it was hidden
        await new Promise(r => setTimeout(r, 200));
        await passTurn(alice, game);
        expect((await waitForPushes(1)).map(p => p.path)).toEqual(['/push/bob-phone']);
    });

    test("another player's open page doesn't silence your alerts", async () => {
        const { alice, bob, game, room } = await startTwoPlayerGame();
        await subscribe(bob, fakeBrowserSubscription('bob-phone'));
        const alicePage = await openGamePage(alice, room.id);
        await setVisible(alicePage, true);
        await passTurn(alice, game);
        expect((await waitForPushes(1)).map(p => p.path)).toEqual(['/push/bob-phone']);
        alicePage.disconnect();
    });
});
