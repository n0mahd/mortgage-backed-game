'use strict';

// Username/password accounts: register (new and guest upgrade), login,
// password changes, and the shared user shape.

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const { createUserFixture, resetTestDb } = require('../helpers/fixtures');

let app, db;

beforeAll(() => {
    ({ app } = require('../../server'));
    db = require('../../db');
});

beforeEach(() => resetTestDb(db));

const auth = token => ({ Authorization: `Bearer ${token}` });

async function guest() {
    const res = await request(app).post('/api/auth/anonymous').expect(200);
    return { token: res.body.token, id: res.body.user.id };
}

describe('POST /api/auth/register', () => {
    test('creates an account that can sign in by username, ignoring case', async () => {
        const res = await request(app).post('/api/auth/register').send({ username: 'Alice_1', password: 'correct horse' }).expect(200);
        expect(res.body.user).toEqual({ id: expect.any(String), email: null, username: 'Alice_1', is_anonymous: false, has_password: true });
        expect(res.body.token).toEqual(expect.any(String));

        const me = await request(app).get('/api/auth/me').set(auth(res.body.token)).expect(200);
        expect(me.body).toEqual(res.body.user);

        const login = await request(app).post('/api/auth/login').send({ login: 'alice_1', password: 'correct horse' }).expect(200);
        expect(login.body.user.id).toBe(res.body.user.id);
    });

    test('stores only a scrypt hash', async () => {
        const res = await request(app).post('/api/auth/register').send({ username: 'bob', password: 'hunter2hunter2' }).expect(200);
        const row = db.prepare(`SELECT password_hash, username_key FROM users WHERE id = ?`).get(res.body.user.id);
        expect(row.password_hash).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
        expect(row.password_hash).not.toContain('hunter2');
        expect(row.username_key).toBe('bob');
    });

    test('a guest upgrades in place and keeps their seat', async () => {
        const g = await guest();
        const room = await request(app).post('/api/rooms').set(auth(g.token)).send({ name: 'R', player_name: 'Gus' }).expect(200);

        const res = await request(app).post('/api/auth/register').set(auth(g.token)).send({ username: 'gus', password: 'password123' }).expect(200);
        expect(res.body.user.id).toBe(g.id);
        expect(res.body.user.is_anonymous).toBe(false);

        const mine = await request(app).get('/api/rooms/mine').set(auth(res.body.token)).expect(200);
        expect(mine.body.map(r => r.id)).toEqual([room.body.id]);
        expect(mine.body[0].my_member_id).toBe(room.body.room_members[0].id);
    });

    test('409 when the username is taken, in any case', async () => {
        await request(app).post('/api/auth/register').send({ username: 'Carol', password: 'password123' }).expect(200);
        const res = await request(app).post('/api/auth/register').send({ username: 'carol', password: 'password456' }).expect(409);
        expect(res.body.error).toBe('Username taken');
    });

    test('400 for an account that is already signed in', async () => {
        const user = createUserFixture(db);
        await request(app).post('/api/auth/register').set(auth(user.token)).send({ username: 'dave', password: 'password123' }).expect(400);
    });

    test('400 for bad usernames and passwords', async () => {
        for (const body of [
            { username: 'ab', password: 'password123' },
            { username: 'has space', password: 'password123' },
            { username: 'x'.repeat(25), password: 'password123' },
            { username: 'okname', password: 'short' },
            { username: 'okname', password: 'x'.repeat(201) },
        ]) {
            await request(app).post('/api/auth/register').send(body).expect(400);
        }
    });
});

describe('POST /api/auth/login', () => {
    test('one 401 message for unknown users and wrong passwords', async () => {
        await request(app).post('/api/auth/register').send({ username: 'erin', password: 'password123' }).expect(200);
        const wrong = await request(app).post('/api/auth/login').send({ login: 'erin', password: 'nope-nope' }).expect(401);
        const unknown = await request(app).post('/api/auth/login').send({ login: 'nobody', password: 'password123' }).expect(401);
        expect(wrong.body.error).toBe('Wrong username or password');
        expect(unknown.body.error).toBe('Wrong username or password');
    });

    test('an email account with a password signs in by email', async () => {
        const user = createUserFixture(db, { email: 'frank@example.com' });
        const set = await request(app).post('/api/auth/password').set(auth(user.token)).send({ password: 'password123' }).expect(200);
        expect(set.body.user).toMatchObject({ id: user.id, email: 'frank@example.com', username: null, has_password: true });

        const res = await request(app).post('/api/auth/login').send({ login: 'Frank@Example.com', password: 'password123' }).expect(200);
        expect(res.body.user.id).toBe(user.id);
    });

    test('an email account without a password cannot sign in with one', async () => {
        createUserFixture(db, { email: 'gina@example.com' });
        await request(app).post('/api/auth/login').send({ login: 'gina@example.com', password: '' }).expect(401);
    });

    test('limited to 10 tries per IP and login', async () => {
        for (let i = 0; i < 10; i++) {
            await request(app).post('/api/auth/login').send({ login: 'limited', password: 'wrong-password' }).expect(401);
        }
        await request(app).post('/api/auth/login').send({ login: 'limited', password: 'wrong-password' }).expect(429);
        await request(app).post('/api/auth/login').send({ login: 'other', password: 'wrong-password' }).expect(401);
    });
});

describe('POST /api/auth/password', () => {
    test('changing a password needs the current one', async () => {
        const reg = await request(app).post('/api/auth/register').send({ username: 'hank', password: 'password123' }).expect(200);
        await request(app).post('/api/auth/password').set(auth(reg.body.token)).send({ password: 'newpassword1' }).expect(400);
        await request(app).post('/api/auth/password').set(auth(reg.body.token))
            .send({ password: 'newpassword1', current_password: 'wrong-one' }).expect(400);
        await request(app).post('/api/auth/password').set(auth(reg.body.token))
            .send({ password: 'newpassword1', current_password: 'password123' }).expect(200);

        await request(app).post('/api/auth/login').send({ login: 'hank', password: 'password123' }).expect(401);
        await request(app).post('/api/auth/login').send({ login: 'hank', password: 'newpassword1' }).expect(200);
    });

    test('can change the username, but not to a taken one', async () => {
        await request(app).post('/api/auth/register').send({ username: 'ivy', password: 'password123' }).expect(200);
        const reg = await request(app).post('/api/auth/register').send({ username: 'jack', password: 'password123' }).expect(200);
        await request(app).post('/api/auth/password').set(auth(reg.body.token))
            .send({ username: 'IVY', password: 'password123', current_password: 'password123' }).expect(409);
        const res = await request(app).post('/api/auth/password').set(auth(reg.body.token))
            .send({ username: 'jack2', password: 'password123', current_password: 'password123' }).expect(200);
        expect(res.body.user.username).toBe('jack2');
    });

    test('a guest needs a username to set a password', async () => {
        const g = await guest();
        await request(app).post('/api/auth/password').set(auth(g.token)).send({ password: 'password123' }).expect(400);
        const res = await request(app).post('/api/auth/password').set(auth(g.token)).send({ username: 'kim', password: 'password123' }).expect(200);
        expect(res.body.user).toMatchObject({ id: g.id, username: 'kim', is_anonymous: false });
    });

    test('401 signed out', async () => {
        await request(app).post('/api/auth/password').send({ password: 'password123' }).expect(401);
    });
});

describe('user shape', () => {
    test('verify-otp and redeem-transfer answer with the /auth/me shape', async () => {
        const user = createUserFixture(db, { email: 'lee@example.com' });
        db.prepare(`INSERT INTO otps (id, email, code, expires_at) VALUES ('o1', 'lee@example.com', '123456', datetime('now', '+5 minutes'))`).run();
        const otp = await request(app).post('/api/auth/verify-otp').send({ email: 'lee@example.com', token: '123456' }).expect(200);
        expect(otp.body.user).toEqual({ id: user.id, email: 'lee@example.com', username: null, is_anonymous: false, has_password: false });

        const code = await request(app).post('/api/auth/transfer-code').set(auth(user.token)).expect(200);
        const redeemed = await request(app).post('/api/auth/redeem-transfer').send({ code: code.body.code }).expect(200);
        expect(redeemed.body.user).toEqual(otp.body.user);
    });
});
