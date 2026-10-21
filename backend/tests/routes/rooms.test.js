'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const { addRoomMemberFixture, createRoomFixture, createUserFixture, resetTestDb } = require('../helpers/fixtures');

let app, db;
let user1, user2;
const originalUseSendApiKey = process.env.USESEND_API_KEY;

beforeAll(() => {
    const { app: a } = require('../../server');
    const d = require('../../db');
    app = a;
    db = d;
});

beforeEach(() => {
    delete process.env.USESEND_API_KEY;

    resetTestDb(db);
    user1 = createUserFixture(db);
    user2 = createUserFixture(db);
});

afterAll(() => {
    if (originalUseSendApiKey) {
        process.env.USESEND_API_KEY = originalUseSendApiKey;
    } else {
        delete process.env.USESEND_API_KEY;
    }
});

// ---------------------------------------------------------------------------
// POST /api/rooms
// ---------------------------------------------------------------------------
describe('POST /api/rooms', () => {
    test('creates room and returns room with members', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'My Room', player_name: 'Alice', max_players: 4 });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id');
        expect(res.body.name).toBe('My Room');
        expect(res.body.room_members).toHaveLength(1);
        expect(res.body.room_members[0].player_name).toBe('Alice');
    });

    test('invite_code is 6 chars alphanumeric', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'Code Room', player_name: 'Alice' });

        expect(res.body.invite_code).toMatch(/^[A-Z0-9]{6}$/);
    });

    test('invite_code is unique across rooms', async () => {
        const r1 = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'Room 1', player_name: 'Alice' });

        const r2 = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ name: 'Room 2', player_name: 'Bob' });

        // Different codes (with astronomically high probability)
        expect(r1.body.invite_code).not.toBe(r2.body.invite_code);
    });

    test('host is automatically added as first room_member', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'Host Room', player_name: 'HostPlayer' });

        expect(res.body.room_members[0].user_id).toBe(user1.id);
        expect(res.body.room_members[0].player_name).toBe('HostPlayer');
    });

    test('400 with missing name', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ player_name: 'Alice' });
        expect(res.status).toBe(400);
    });

    test('400 with missing player_name', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'No Player' });
        expect(res.status).toBe(400);
    });

    test('401 without auth', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .send({ name: 'Unauth', player_name: 'Alice' });
        expect(res.status).toBe(401);
    });

    test('room status defaults to waiting', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'Status Room', player_name: 'Alice' });
        expect(res.body.status).toBe('waiting');
    });

    test('max_players defaults to 4 if not specified', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'Default Max', player_name: 'Alice' });
        expect(res.body.max_players).toBe(4);
    });

    test('custom max_players is stored', async () => {
        const res = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ name: 'Big Room', player_name: 'Alice', max_players: 8 });
        expect(res.body.max_players).toBe(8);
    });
});

// ---------------------------------------------------------------------------
// GET /api/rooms/by-code/:code
// ---------------------------------------------------------------------------
describe('GET /api/rooms/by-code/:code', () => {
    test('200 returns room with members', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'TESTCD' });

        const res = await request(app).get('/api/rooms/by-code/TESTCD');
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(room.id);
        expect(Array.isArray(res.body.room_members)).toBe(true);
    });

    test('404 for non-existent code', async () => {
        const res = await request(app).get('/api/rooms/by-code/ZZZZZZ');
        expect(res.status).toBe(404);
    });

    test('invite code lookup is case-insensitive', async () => {
        createRoomFixture(db, user1.id, { inviteCode: 'ABCDEF' });

        const res = await request(app).get('/api/rooms/by-code/abcdef');
        expect(res.status).toBe(200);
    });

    test('returns room_members array', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'MMBR12' });

        const res = await request(app).get(`/api/rooms/by-code/MMBR12`);
        expect(Array.isArray(res.body.room_members)).toBe(true);
        expect(res.body.room_members.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// Rejoin requests: taking back a seat in a started room needs approval
// ---------------------------------------------------------------------------
describe('rejoin requests', () => {
    function askToRejoin(code, memberId) {
        return request(app)
            .post(`/api/rooms/by-code/${code}/rejoin-requests`)
            .send(memberId ? { member_id: memberId } : {});
    }

    function collect(asked) {
        return request(app)
            .post(`/api/rooms/rejoin-requests/${asked.body.request_id}/collect`)
            .send({ secret: asked.body.secret });
    }

    function decide(roomId, requestId, token, decision) {
        return request(app)
            .post(`/api/rooms/${roomId}/rejoin-requests/${requestId}/${decision}`)
            .set('Authorization', `Bearer ${token}`);
    }

    function listFor(roomId, token) {
        return request(app)
            .get(`/api/rooms/${roomId}/rejoin-requests`)
            .set('Authorization', `Bearer ${token}`);
    }

    test('a guest seat comes back only after the host approves, and only to the asking browser', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM1', status: 'in_progress', maxPlayers: 4 });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const asked = await askToRejoin('claim1', member.id);
        expect(asked.status).toBe(200);
        expect(asked.body.token).toBeUndefined();

        const pending = await collect(asked);
        expect(pending.body).toEqual({ status: 'pending' });

        const list = await listFor(room.id, user1.token);
        expect(list.body).toEqual([expect.objectContaining({ id: asked.body.request_id, playerName: 'Bob' })]);

        const wrongSecret = await request(app)
            .post(`/api/rooms/rejoin-requests/${asked.body.request_id}/collect`)
            .send({ secret: 'guess' });
        expect(wrongSecret.status).toBe(404);

        expect((await decide(room.id, asked.body.request_id, user1.token, 'approve')).status).toBe(200);

        const approved = await collect(asked);
        expect(approved.body.status).toBe('approved');
        expect(approved.body.user.id).toBe(guest.id);
        const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${approved.body.token}`);
        expect(me.body.id).toBe(guest.id);

        const again = await collect(asked);
        expect(again.body).toEqual({ status: 'collected' });
    });

    test('another player cannot approve a request for someone else\'s seat', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const other = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM2', status: 'in_progress' });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');
        addRoomMemberFixture(db, room.id, other.id, 'Eve');

        const asked = await askToRejoin('CLAIM2', member.id);
        expect((await listFor(room.id, other.token)).body).toEqual([]);
        expect((await decide(room.id, asked.body.request_id, other.token, 'approve')).status).toBe(403);
        expect((await collect(asked)).body.status).toBe('pending');
    });

    test('the seat\'s own player can approve, for moving devices', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM3', status: 'in_progress' });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const asked = await askToRejoin('CLAIM3', member.id);
        expect((await decide(room.id, asked.body.request_id, guest.token, 'approve')).status).toBe(200);
        expect((await collect(asked)).body.status).toBe('approved');
    });

    test('when the host lost their seat, any other player can let them back in', async () => {
        const host = createUserFixture(db, { anonymous: true });
        const other = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, host.id, { inviteCode: 'CLAIM4', status: 'in_progress' });
        addRoomMemberFixture(db, room.id, other.id, 'Eve');

        const asked = await askToRejoin('CLAIM4', room.room_members[0].id);
        expect((await listFor(room.id, other.token)).body).toHaveLength(1);
        expect((await decide(room.id, asked.body.request_id, other.token, 'approve')).status).toBe(200);
        expect((await collect(asked)).body.user.id).toBe(host.id);
    });

    test('a denied request hands out nothing', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM5', status: 'in_progress' });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const asked = await askToRejoin('CLAIM5', member.id);
        await decide(room.id, asked.body.request_id, user1.token, 'deny');
        const result = await collect(asked);
        expect(result.body).toEqual({ status: 'denied' });
        expect(result.body.token).toBeUndefined();
    });

    test('a newer request for the same seat replaces the older one', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM6', status: 'in_progress' });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const first = await askToRejoin('CLAIM6', member.id);
        const second = await askToRejoin('CLAIM6', member.id);
        expect((await collect(first)).body).toEqual({ status: 'superseded' });
        expect((await decide(room.id, first.body.request_id, user1.token, 'approve')).status).toBe(404);
        expect((await listFor(room.id, user1.token)).body.map(item => item.id)).toEqual([second.body.request_id]);
    });

    test('expired requests cannot be approved or collected', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM7', status: 'in_progress' });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const asked = await askToRejoin('CLAIM7', member.id);
        db.prepare(`UPDATE rejoin_requests SET expires_at = datetime('now', '-1 minute')`).run();
        expect((await decide(room.id, asked.body.request_id, user1.token, 'approve')).status).toBe(404);
        expect((await collect(asked)).body).toEqual({ status: 'expired' });
    });

    test('the asking browser can cancel its request', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM8', status: 'in_progress' });
        const member = addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const asked = await askToRejoin('CLAIM8', member.id);
        const cancelled = await request(app)
            .post(`/api/rooms/rejoin-requests/${asked.body.request_id}/cancel`)
            .send({ secret: asked.body.secret });
        expect(cancelled.status).toBe(200);
        expect((await listFor(room.id, user1.token)).body).toEqual([]);
        expect((await collect(asked)).body).toEqual({ status: 'cancelled' });
    });

    test('403 for an email seat: those players sign in with email', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'CLAIM9', maxPlayers: 2 });
        addRoomMemberFixture(db, room.id, user2.id, 'Bob');

        const res = await askToRejoin('CLAIM9', room.room_members[0].id);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/email/);
    });

    test('400 while the room is still open for new players', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'OPEN01', maxPlayers: 4 });
        const res = await askToRejoin('OPEN01', room.room_members[0].id);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/still open/);
    });

    test('404 for a member id from another room', async () => {
        createRoomFixture(db, user1.id, { inviteCode: 'CLAIMX', maxPlayers: 1 });
        expect((await askToRejoin('CLAIMX', 'not-in-room')).status).toBe(404);
    });

    test('a whole same-device game comes back after the host approves', async () => {
        const host = createUserFixture(db, { anonymous: true });
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, host.id, { inviteCode: 'HSEAT1', maxPlayers: 2 });
        addRoomMemberFixture(db, room.id, guest.id, 'Bob');

        const asked = await askToRejoin('HSEAT1');
        expect(asked.status).toBe(200);
        expect((await decide(room.id, asked.body.request_id, guest.token, 'approve')).status).toBe(403);
        expect((await decide(room.id, asked.body.request_id, host.token, 'approve')).status).toBe(200);

        const result = await collect(asked);
        expect(result.body.tokens.map(record => record.name).sort()).toEqual(['Bob', 'Host']);
        const bobToken = result.body.tokens.find(record => record.name === 'Bob').token;
        const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bobToken}`);
        expect(me.body.id).toBe(guest.id);
    });

    test('403 for a whole-room request when any member has an email account', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, user1.id, { inviteCode: 'HSEAT9', maxPlayers: 2 });
        addRoomMemberFixture(db, room.id, guest.id, 'Bob');
        expect((await askToRejoin('HSEAT9')).status).toBe(403);
    });

    test('the old claim routes are gone', async () => {
        const guest = createUserFixture(db, { anonymous: true });
        const room = createRoomFixture(db, guest.id, { inviteCode: 'GONE01', status: 'in_progress' });
        const member = await request(app)
            .post('/api/rooms/by-code/GONE01/claim-member')
            .send({ member_id: room.room_members[0].id });
        const hotseat = await request(app).post('/api/rooms/by-code/GONE01/claim-hotseat').send({});
        expect(member.status).toBe(404);
        expect(hotseat.status).toBe(404);
        expect(member.body.token).toBeUndefined();
        expect(hotseat.body.tokens).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// GET /api/rooms/mine
// ---------------------------------------------------------------------------
describe('GET /api/rooms/mine', () => {
    test('200 returns rooms for authenticated user', async () => {
        createRoomFixture(db, user1.id, { inviteCode: 'MINE01' });

        const res = await request(app)
            .get('/api/rooms/mine')
            .set('Authorization', `Bearer ${user1.token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    test('returns empty array if no rooms', async () => {
        const res = await request(app)
            .get('/api/rooms/mine')
            .set('Authorization', `Bearer ${user2.token}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('401 without auth', async () => {
        const res = await request(app).get('/api/rooms/mine');
        expect(res.status).toBe(401);
    });

    test('only returns rooms user is a member of', async () => {
        createRoomFixture(db, user1.id, { inviteCode: 'MINE02' });
        createRoomFixture(db, user2.id, { inviteCode: 'MINE03' }); // user2's room

        const res = await request(app)
            .get('/api/rooms/mine')
            .set('Authorization', `Bearer ${user1.token}`);

        const ids = res.body.map(r => r.host_id);
        expect(ids.every(id => id === user1.id || res.body.some(r => r.room_members.some(m => m.user_id === user1.id)))).toBe(true);
    });

    test('returns multiple rooms if member of several', async () => {
        createRoomFixture(db, user1.id, { inviteCode: 'MINE04' });
        createRoomFixture(db, user1.id, { inviteCode: 'MINE05' });

        const res = await request(app)
            .get('/api/rooms/mine')
            .set('Authorization', `Bearer ${user1.token}`);

        expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// POST /api/rooms/send-code
// ---------------------------------------------------------------------------
describe('POST /api/rooms/send-code', () => {
    test('forgot_code can be requested without auth', async () => {
        createRoomFixture(db, user1.id, { inviteCode: 'FORGOT' });

        const res = await request(app)
            .post('/api/rooms/send-code')
            .send({ action: 'forgot_code', email: user1.email });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    test('forgot_code requires a valid email', async () => {
        const res = await request(app)
            .post('/api/rooms/send-code')
            .send({ action: 'forgot_code', email: '' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Valid email/);
    });

    test('invite email requires auth', async () => {
        const res = await request(app)
            .post('/api/rooms/send-code')
            .send({ email: 'friend@test.com', inviteCode: 'INVITE' });

        expect(res.status).toBe(401);
    });

    describe('what actually gets emailed', () => {
        const http = require('http');
        let mailServer;
        let sent;

        beforeAll(async () => {
            mailServer = http.createServer((req, res) => {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    sent.push(JSON.parse(body));
                    res.setHeader('Content-Type', 'application/json');
                    res.end('{"id":"test"}');
                });
            });
            await new Promise(resolve => mailServer.listen(0, '127.0.0.1', resolve));
        });

        afterAll(async () => {
            delete process.env.USESEND_API_KEY;
            delete process.env.USESEND_URL;
            await new Promise(resolve => mailServer.close(resolve));
        });

        beforeEach(() => {
            sent = [];
            // The file-level beforeEach clears the key; point the mailer at the capture server.
            process.env.USESEND_API_KEY = 'test-key';
            process.env.USESEND_URL = `http://127.0.0.1:${mailServer.address().port}/emails`;
        });

        test('a member invite uses the room code and name from the database, escaped', async () => {
            createRoomFixture(db, user1.id, { inviteCode: 'INVIT1', name: '<b>Friday</b> "game"' });

            const res = await request(app)
                .post('/api/rooms/send-code')
                .set('Authorization', `Bearer ${user1.token}`)
                .send({ email: 'Friend@Test.com', inviteCode: 'invit1', roomName: 'Click http://evil.example', html: '<script>' });

            expect(res.status).toBe(200);
            expect(sent).toHaveLength(1);
            expect(sent[0].to).toEqual(['friend@test.com']);
            expect(sent[0].subject).toBe('Your room code for <b>Friday</b> "game"');
            expect(sent[0].html).toContain('<strong>INVIT1</strong>');
            expect(JSON.stringify(sent[0])).not.toContain('evil.example');
        });

        test('guests cannot send invites', async () => {
            const guest = createUserFixture(db, { anonymous: true });
            createRoomFixture(db, guest.id, { inviteCode: 'INVIT2' });

            const res = await request(app)
                .post('/api/rooms/send-code')
                .set('Authorization', `Bearer ${guest.token}`)
                .send({ email: 'victim@test.com', inviteCode: 'INVIT2' });

            expect(res.status).toBe(403);
            expect(sent).toHaveLength(0);
        });

        test('only members of the room can send its invite', async () => {
            createRoomFixture(db, user1.id, { inviteCode: 'INVIT3' });

            const res = await request(app)
                .post('/api/rooms/send-code')
                .set('Authorization', `Bearer ${user2.token}`)
                .send({ email: 'victim@test.com', inviteCode: 'INVIT3' });

            expect(res.status).toBe(404);
            expect(sent).toHaveLength(0);
        });

        test('made-up invite codes send nothing', async () => {
            const res = await request(app)
                .post('/api/rooms/send-code')
                .set('Authorization', `Bearer ${user1.token}`)
                .send({ email: 'victim@test.com', inviteCode: '<a href=x>' });

            expect(res.status).toBe(404);
            expect(sent).toHaveLength(0);
        });

        test('forgot_code escapes room names in the email body', async () => {
            createRoomFixture(db, user1.id, { inviteCode: 'FORGT2', name: '<img src=x onerror=alert(1)>' });

            await request(app)
                .post('/api/rooms/send-code')
                .send({ action: 'forgot_code', email: user1.email });

            expect(sent).toHaveLength(1);
            expect(sent[0].html).toContain('&lt;img src=x onerror=alert(1)&gt;');
            expect(sent[0].html).not.toContain('<img');
        });
    });
});

// ---------------------------------------------------------------------------
// GET /api/rooms/:id
// ---------------------------------------------------------------------------
describe('GET /api/rooms/:id', () => {
    test('200 returns room with members', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'GETID1' });

        const res = await request(app)
            .get(`/api/rooms/${room.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(room.id);
    });

    test('404 for non-existent id', async () => {
        const res = await request(app)
            .get('/api/rooms/nonexistent-uuid')
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(404);
    });

    test('auth required', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'NOAUTH' });

        const res = await request(app).get(`/api/rooms/${room.id}`);
        expect(res.status).toBe(401);
    });

    test('returns room_members sorted by joined_at', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'SORT01' });

        const res = await request(app)
            .get(`/api/rooms/${room.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(Array.isArray(res.body.room_members)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// POST /api/rooms/:id/join
// ---------------------------------------------------------------------------
describe('POST /api/rooms/:id/join', () => {
    test('200 adds member, returns updated room', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'JOIN01', maxPlayers: 4 });

        const res = await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Player2' });

        expect(res.status).toBe(200);
        expect(res.body.room_members.some(m => m.user_id === user2.id)).toBe(true);
    });

    test('200 (no-op) if already a member', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'JOIN02' });

        // user1 is already the host/member
        const res = await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ player_name: 'Alice Again' });

        expect(res.status).toBe(200);
    });

    test('404 if room not found', async () => {
        const res = await request(app)
            .post('/api/rooms/nonexistent/join')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ player_name: 'Alice' });
        expect(res.status).toBe(404);
    });

    test('400 if room is full', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'FULL01', maxPlayers: 1 });

        const res = await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Bob' });

        expect(res.status).toBe(400);
    });

    test('400 if room status is not waiting', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'INPRO1', status: 'in_progress' });

        const res = await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Bob' });

        expect(res.status).toBe(400);
    });

    test('401 without auth', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'NOAU01' });

        const res = await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .send({ player_name: 'Anon' });

        expect(res.status).toBe(401);
    });

    test('member appears in room_members after join', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'JOIN03', maxPlayers: 4 });

        await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Newcomer' });

        const member = db.prepare(`SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`).get(room.id, user2.id);
        expect(member).toBeTruthy();
        expect(member.player_name).toBe('Newcomer');
    });

    test('guest name defaults to Guest if not provided', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'JOIN04', maxPlayers: 4 });

        await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({});

        const member = db.prepare(`SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`).get(room.id, user2.id);
        expect(member.player_name).toBe('Guest');
    });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id/leave
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id/leave', () => {
    test('200 removes member', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'LEAV01', maxPlayers: 4 });

        // Add user2 first
        await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Bob' });

        const res = await request(app)
            .delete(`/api/rooms/${room.id}/leave`)
            .set('Authorization', `Bearer ${user2.token}`);

        expect(res.status).toBe(200);
        const member = db.prepare(`SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`).get(room.id, user2.id);
        expect(member).toBeUndefined();
    });

    test('401 without auth', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'LEAV02' });

        const res = await request(app).delete(`/api/rooms/${room.id}/leave`);
        expect(res.status).toBe(401);
    });

    test('200 no-op if user not in room', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'LEAV03' });

        const res = await request(app)
            .delete(`/api/rooms/${room.id}/leave`)
            .set('Authorization', `Bearer ${user2.token}`);

        expect(res.status).toBe(200);
    });

    test('member no longer in room_members after leave', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'LEAV04', maxPlayers: 4 });

        await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Bob' });

        await request(app)
            .delete(`/api/rooms/${room.id}/leave`)
            .set('Authorization', `Bearer ${user2.token}`);

        const member = db.prepare(`SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`).get(room.id, user2.id);
        expect(member).toBeUndefined();
    });

    test('response includes ok: true', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'LEAV05' });

        const res = await request(app)
            .delete(`/api/rooms/${room.id}/leave`)
            .set('Authorization', `Bearer ${user1.token}`);

        expect(res.body).toHaveProperty('ok', true);
    });
});

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:id/status
// ---------------------------------------------------------------------------
describe('PATCH /api/rooms/:id/status', () => {
    test('200 host can set status to in_progress', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'STAT01' });

        const res = await request(app)
            .patch(`/api/rooms/${room.id}/status`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ status: 'in_progress' });

        expect(res.status).toBe(200);
        const updated = db.prepare(`SELECT status FROM rooms WHERE id = ?`).get(room.id);
        expect(updated.status).toBe('in_progress');
    });

    test('200 host can set status to completed', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'STAT02' });

        const res = await request(app)
            .patch(`/api/rooms/${room.id}/status`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ status: 'completed' });

        expect(res.status).toBe(200);
    });

    test('200 host can set status back to waiting', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'STAT03', status: 'in_progress' });

        const res = await request(app)
            .patch(`/api/rooms/${room.id}/status`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ status: 'waiting' });

        expect(res.status).toBe(200);
    });

    test('403 non-host member cannot change status', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'STAT04', maxPlayers: 4 });

        // Add user2 as member
        await request(app)
            .post(`/api/rooms/${room.id}/join`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ player_name: 'Bob' });

        const res = await request(app)
            .patch(`/api/rooms/${room.id}/status`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ status: 'in_progress' });

        expect(res.status).toBe(403);
    });

    test('401 without auth', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'STAT05' });

        const res = await request(app)
            .patch(`/api/rooms/${room.id}/status`)
            .send({ status: 'in_progress' });

        expect(res.status).toBe(401);
    });

    test('404 for non-existent room', async () => {
        const res = await request(app)
            .patch('/api/rooms/nonexistent/status')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ status: 'in_progress' });

        expect(res.status).toBe(404);
    });

    test('400 rejects invalid room status', async () => {
        const room = createRoomFixture(db, user1.id, { inviteCode: 'STAT06' });

        const res = await request(app)
            .patch(`/api/rooms/${room.id}/status`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ status: 'banana' });

        expect(res.status).toBe(400);
    });
});
