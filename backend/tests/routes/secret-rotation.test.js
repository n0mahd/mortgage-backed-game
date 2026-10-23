'use strict';

// Rotating JWT_SECRET with JWT_SECRET_PREVIOUS set: tokens signed with the old
// secret keep working and are swapped for new-secret tokens, so nobody is
// signed out. Tokens signed with anything else are still refused.

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'new-secret';
process.env.JWT_SECRET_PREVIOUS = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { createUserFixture, resetTestDb } = require('../helpers/fixtures');

let app, server, io, db, port;

beforeAll((done) => {
    ({ app, server, io } = require('../../server'));
    db = require('../../db');
    server.listen(0, () => {
        port = server.address().port;
        done();
    });
});

afterAll((done) => {
    io.close();
    server.close(done);
});

beforeEach(() => resetTestDb(db));

afterAll(() => {
    delete process.env.JWT_SECRET_PREVIOUS;
});

// createUserFixture signs with 'test-secret', which is now the previous secret.
function oldToken(user) {
    return user.token;
}

test('an old-secret token still works and comes back with a new-secret replacement', async () => {
    const user = createUserFixture(db, { anonymous: true });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);

    const fresh = res.headers['x-refreshed-token'];
    expect(jwt.verify(fresh, 'new-secret').sub).toBe(user.id);
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Refreshed-Token/i);

    const again = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${fresh}`);
    expect(again.status).toBe(200);
    expect(again.headers['x-refreshed-token']).toBeUndefined();
});

test('a token signed with some other secret is refused', async () => {
    const user = createUserFixture(db);
    const forged = jwt.sign({ sub: user.id }, 'not-a-secret-we-know', { expiresIn: '1h' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.headers['x-refreshed-token']).toBeUndefined();
});

test('saved same-device tokens are swapped in one call', async () => {
    const a = createUserFixture(db, { anonymous: true });
    const current = jwt.sign({ sub: a.id }, 'new-secret', { expiresIn: '1h' });

    const res = await request(app)
        .post('/api/auth/refresh-tokens')
        .send({ tokens: [oldToken(a), current, 'garbage', 42] });

    expect(res.status).toBe(200);
    const [swapped, unchanged, bad, notString] = res.body.tokens;
    expect(jwt.verify(swapped, 'new-secret').sub).toBe(a.id);
    expect(unchanged).toBe(current);
    expect(bad).toBeNull();
    expect(notString).toBeNull();
});

test('a socket connecting with an old-secret token is handed a replacement', async () => {
    const user = createUserFixture(db, { anonymous: true });
    const client = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { token: oldToken(user) },
    });
    try {
        const fresh = await new Promise((resolve, reject) => {
            client.once('auth:token_refreshed', resolve);
            client.once('connect_error', reject);
            setTimeout(() => reject(new Error('no refresh')), 5000);
        });
        expect(jwt.verify(fresh, 'new-secret').sub).toBe(user.id);
    } finally {
        client.close();
    }
});

test('readToken accepts old-secret tokens during the rotation and marks them stale', () => {
    const { readToken } = require('../../auth');
    const user = createUserFixture(db, { anonymous: true });
    expect(readToken(oldToken(user))).toEqual({ userId: user.id, stale: true });
});
