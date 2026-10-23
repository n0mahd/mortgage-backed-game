'use strict';

// My games (archive), the host's Manage players tools (seat links, agent
// re-invites, host transfer), and leaving only before the start.

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const { resetTestDb } = require('../helpers/fixtures');

let app, db, agentSeats;

beforeAll(() => {
    ({ app } = require('../../server'));
    db = require('../../db');
    agentSeats = require('../../services/agentSeats');
});

beforeEach(() => resetTestDb(db));

const auth = token => ({ Authorization: `Bearer ${token}` });

async function guest() {
    const res = await request(app).post('/api/auth/anonymous').expect(200);
    return { token: res.body.token, id: res.body.user.id };
}

async function account(username) {
    const res = await request(app).post('/api/auth/register').send({ username, password: 'password123' }).expect(200);
    return { token: res.body.token, id: res.body.user.id };
}

// A room hosted by an account, with a guest player and an account player.
async function setup() {
    const host = await account('hosty');
    const room = (await request(app).post('/api/rooms').set(auth(host.token)).send({ name: 'Table', player_name: 'Host' }).expect(200)).body;
    const g = await guest();
    await request(app).post(`/api/rooms/${room.id}/join`).set(auth(g.token)).send({ player_name: 'Gus' }).expect(200);
    const acct = await account('annie');
    await request(app).post(`/api/rooms/${room.id}/join`).set(auth(acct.token)).send({ player_name: 'Annie' }).expect(200);
    const members = db.prepare(`SELECT * FROM room_members WHERE room_id = ?`).all(room.id);
    const memberOf = user => members.find(m => m.user_id === user.id);
    return { host, room, guest: { ...g, member: memberOf(g) }, acct: { ...acct, member: memberOf(acct) }, hostMember: memberOf(host) };
}

async function startGame(room, host) {
    return (await request(app).post('/api/games').set(auth(host.token)).send({ room_id: room.id }).expect(200)).body;
}

async function seatLink(room, host, memberId) {
    const res = await request(app).post(`/api/rooms/${room.id}/members/${memberId}/link`).set(auth(host.token)).expect(200);
    expect(res.body.url).toMatch(/\/index\.html\?seat=[A-Za-z0-9_-]{43}$/);
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    return new URL(res.body.url).searchParams.get('seat');
}

describe('GET /api/rooms/mine and archiving', () => {
    test('rooms carry archived, is_host and my_member_id; archiving is per user', async () => {
        const { host, room, guest: g } = await setup();

        const before = await request(app).get('/api/rooms/mine').set(auth(g.token)).expect(200);
        expect(before.body[0]).toMatchObject({ id: room.id, archived: false, is_host: false, my_member_id: g.member.id });

        await request(app).post(`/api/rooms/${room.id}/archive`).set(auth(g.token)).expect(200, { ok: true });
        const archived = await request(app).get('/api/rooms/mine').set(auth(g.token)).expect(200);
        expect(archived.body[0].archived).toBe(true);
        const hostView = await request(app).get('/api/rooms/mine').set(auth(host.token)).expect(200);
        expect(hostView.body[0]).toMatchObject({ archived: false, is_host: true });

        await request(app).delete(`/api/rooms/${room.id}/archive`).set(auth(g.token)).expect(200);
        const after = await request(app).get('/api/rooms/mine').set(auth(g.token)).expect(200);
        expect(after.body[0].archived).toBe(false);
    });

    test('a spectating host has no member id', async () => {
        const host = await guest();
        await request(app).post('/api/rooms').set(auth(host.token)).send({ name: 'Bots', spectate: true }).expect(200);
        const mine = await request(app).get('/api/rooms/mine').set(auth(host.token)).expect(200);
        expect(mine.body[0]).toMatchObject({ is_host: true, my_member_id: null });
    });

    test('403 archiving a room you are not in', async () => {
        const { room } = await setup();
        const stranger = await guest();
        await request(app).post(`/api/rooms/${room.id}/archive`).set(auth(stranger.token)).expect(403);
    });
});

describe('GET /api/rooms/:id/manage', () => {
    test('the host sees every member with what they can do', async () => {
        const { host, room, guest: g, acct, hostMember } = await setup();
        const res = await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(host.token)).expect(200);
        expect(res.body.room.id).toBe(room.id);
        expect(res.body.agent_seats).toEqual([]);
        expect(res.body.host_transfer).toBeNull();
        expect(res.body.members).toEqual([
            { id: hostMember.id, player_name: 'Host', user_id: host.id, is_agent: false, is_host: true, has_account: true, agent_seat_id: null },
            { id: g.member.id, player_name: 'Gus', user_id: g.id, is_agent: false, is_host: false, has_account: false, agent_seat_id: null },
            { id: acct.member.id, player_name: 'Annie', user_id: acct.id, is_agent: false, is_host: false, has_account: true, agent_seat_id: null },
        ]);
    });

    test('403 for anyone but the host, for every host tool', async () => {
        const { room, guest: g, acct } = await setup();
        await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(g.token)).expect(403);
        await request(app).post(`/api/rooms/${room.id}/members/${acct.member.id}/link`).set(auth(g.token)).expect(403);
        await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(g.token)).send({ member_id: g.member.id }).expect(403);
        await request(app).delete(`/api/rooms/${room.id}/host-transfer`).set(auth(g.token)).expect(403);
    });

    test('agent invites still list after the game starts', async () => {
        const { host, room } = await setup();
        const { key } = agentSeats.createAgentSeat({ roomId: room.id, hostUserId: host.id, label: 'Robo' });
        agentSeats.claimAgentSeat({ key });
        await startGame(room, host);
        const res = await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(host.token)).expect(200);
        expect(res.body.agent_seats).toHaveLength(1);
        const robo = res.body.members.find(m => m.player_name === 'Robo');
        expect(robo).toMatchObject({ is_agent: true, agent_seat_id: res.body.agent_seats[0].id });
    });
});

describe('seat links', () => {
    test('a guest seat link signs the browser in as that seat, once', async () => {
        const { host, room, guest: g } = await setup();
        const token = await seatLink(room, host, g.member.id);
        expect(db.prepare(`SELECT COUNT(*) AS n FROM seat_links WHERE token_hash = ?`).get(token).n).toBe(0);

        const res = await request(app).post('/api/seat-links/redeem').send({ token }).expect(200);
        expect(res.body.user).toMatchObject({ id: g.id, is_anonymous: true });
        expect(res.body.room.id).toBe(room.id);
        const me = await request(app).get('/api/auth/me').set(auth(res.body.token)).expect(200);
        expect(me.body.id).toBe(g.id);

        const again = await request(app).post('/api/seat-links/redeem').send({ token }).expect(400);
        expect(again.body.error).toBe('This link has expired or was replaced');
    });

    test('a new link replaces the older one', async () => {
        const { host, room, guest: g } = await setup();
        const first = await seatLink(room, host, g.member.id);
        const second = await seatLink(room, host, g.member.id);
        await request(app).post('/api/seat-links/redeem').send({ token: first }).expect(400);
        await request(app).post('/api/seat-links/redeem').send({ token: second }).expect(200);
    });

    test('expired and made-up links fail', async () => {
        const { host, room, guest: g } = await setup();
        const token = await seatLink(room, host, g.member.id);
        db.prepare(`UPDATE seat_links SET expires_at = datetime('now', '-1 minute')`).run();
        await request(app).post('/api/seat-links/redeem').send({ token }).expect(400);
        await request(app).post('/api/seat-links/redeem').send({ token: 'x'.repeat(43) }).expect(400);
        await request(app).post('/api/seat-links/redeem').send({}).expect(400);
    });

    test('an account seat asks to sign in, and the link stays usable', async () => {
        const { host, room, acct } = await setup();
        const token = await seatLink(room, host, acct.member.id);
        const res = await request(app).post('/api/seat-links/redeem').send({ token }).expect(200);
        expect(res.body).toEqual({ requires_sign_in: true, room: { id: room.id, name: 'Table' } });
        expect(res.body.token).toBeUndefined();

        const signedIn = await request(app).post('/api/seat-links/redeem').set(auth(acct.token)).send({ token }).expect(200);
        expect(signedIn.body.room.id).toBe(room.id);
        expect(signedIn.body.token).toBeUndefined();
        expect(signedIn.body.requires_sign_in).toBeUndefined();
    });

    test('agents get a new key, not a link', async () => {
        const { host, room } = await setup();
        const { key } = agentSeats.createAgentSeat({ roomId: room.id, hostUserId: host.id, label: 'Robo' });
        const { seat } = agentSeats.claimAgentSeat({ key });
        const member = db.prepare(`SELECT id FROM room_members WHERE user_id = ?`).get(seat.user_id);
        await request(app).post(`/api/rooms/${room.id}/members/${member.id}/link`).set(auth(host.token)).expect(400);
    });
});

describe('POST /api/rooms/:id/agent-seats/:seatId/reissue', () => {
    test('the old key stops working and the new one holds the same seat', async () => {
        const { host, room } = await setup();
        const { key: oldKey, seat: invite } = agentSeats.createAgentSeat({ roomId: room.id, hostUserId: host.id, label: 'Robo' });
        const { seat: joined } = agentSeats.claimAgentSeat({ key: oldKey });
        await startGame(room, host);

        const res = await request(app).post(`/api/rooms/${room.id}/agent-seats/${invite.id}/reissue`).set(auth(host.token)).expect(201);
        expect(res.body).toMatchObject({ key: expect.stringMatching(/^mbagent_/), mcp_url: expect.stringMatching(/\/api\/mcp$/) });
        expect(res.body.seat).toMatchObject({ label: 'Robo', status: 'joined', player_name: 'Robo' });
        expect(res.body.prompt).toContain('already have a seat');
        expect(res.body.prompt).toContain(res.body.key);

        expect(agentSeats.findSeatByKey(oldKey)).toBeNull();
        const claim = agentSeats.claimAgentSeat({ key: res.body.key });
        expect(claim.alreadyJoined).toBe(true);
        expect(claim.seat.user_id).toBe(joined.user_id);
        expect(() => agentSeats.claimAgentSeat({ key: oldKey })).toThrow(/Invalid or revoked/);

        const manage = await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(host.token)).expect(200);
        expect(manage.body.agent_seats.map(s => s.id)).toEqual([res.body.seat.id]);
        expect(manage.body.members.filter(m => m.is_agent)).toHaveLength(1);
    });

    test('400 once the game is completed; 403 for non-hosts', async () => {
        const { host, room, guest: g } = await setup();
        const { seat } = agentSeats.createAgentSeat({ roomId: room.id, hostUserId: host.id });
        await request(app).post(`/api/rooms/${room.id}/agent-seats/${seat.id}/reissue`).set(auth(g.token)).expect(403);
        db.prepare(`UPDATE rooms SET status = 'completed' WHERE id = ?`).run(room.id);
        await request(app).post(`/api/rooms/${room.id}/agent-seats/${seat.id}/reissue`).set(auth(host.token)).expect(400);
    });
});

describe('host transfer', () => {
    test('a guest must make an account to accept; then host rights move', async () => {
        const { host, room, guest: g } = await setup();
        const game = await startGame(room, host);

        const offer = await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: g.member.id }).expect(200);
        expect(offer.body.host_transfer).toMatchObject({ to_member_id: g.member.id, to_player_name: 'Gus' });
        const manage = await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(host.token)).expect(200);
        expect(manage.body.host_transfer.id).toBe(offer.body.host_transfer.id);

        const mine = await request(app).get('/api/host-transfers/mine').set(auth(g.token)).expect(200);
        expect(mine.body).toEqual([{ id: offer.body.host_transfer.id, room_id: room.id, room_name: 'Table', from_player_name: 'Host', created_at: expect.any(String) }]);

        const refused = await request(app).post(`/api/host-transfers/${offer.body.host_transfer.id}/accept`).set(auth(g.token)).expect(403);
        expect(refused.body.code).toBe('account_required');

        const upgraded = await request(app).post('/api/auth/register').set(auth(g.token)).send({ username: 'gus', password: 'password123' }).expect(200);
        const accepted = await request(app).post(`/api/host-transfers/${offer.body.host_transfer.id}/accept`).set(auth(upgraded.body.token)).expect(200);
        expect(accepted.body.room.host_id).toBe(g.id);

        await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(host.token)).expect(403);
        await request(app).get(`/api/rooms/${room.id}/manage`).set(auth(upgraded.body.token)).expect(200);
        await request(app).get('/api/host-transfers/mine').set(auth(g.token)).expect(200, []);

        // Host actions follow rooms.host_id.
        const pause = (token, actionId) => request(app).post(`/api/games/${game.id}/actions`).set(auth(token))
            .send({ actionId, type: 'host_pause_game', payload: {}, expectedVersion: game.state_version });
        await pause(host.token, 'old-host').expect(403);
        const paused = await pause(upgraded.body.token, 'new-host').expect(200);
        expect(paused.body.game.game_state.paused).toBe(true);
    });

    test('declining and cancelling end the offer', async () => {
        const { host, room, acct, guest: g } = await setup();
        const first = await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: acct.member.id }).expect(200);
        await request(app).post(`/api/host-transfers/${first.body.host_transfer.id}/decline`).set(auth(acct.token)).expect(200, { ok: true });
        await request(app).post(`/api/host-transfers/${first.body.host_transfer.id}/accept`).set(auth(acct.token)).expect(404);

        const second = await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: acct.member.id }).expect(200);
        // Someone else can't answer it.
        await request(app).post(`/api/host-transfers/${second.body.host_transfer.id}/accept`).set(auth(g.token)).expect(404);
        await request(app).delete(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).expect(200, { ok: true });
        await request(app).post(`/api/host-transfers/${second.body.host_transfer.id}/accept`).set(auth(acct.token)).expect(404);
        expect(db.prepare(`SELECT host_id FROM rooms WHERE id = ?`).get(room.id).host_id).toBe(host.id);
    });

    test('a new offer replaces the pending one', async () => {
        const { host, room, acct, guest: g } = await setup();
        const first = await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: acct.member.id }).expect(200);
        await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: g.member.id }).expect(200);
        await request(app).get('/api/host-transfers/mine').set(auth(acct.token)).expect(200, []);
        await request(app).post(`/api/host-transfers/${first.body.host_transfer.id}/accept`).set(auth(acct.token)).expect(404);
    });

    test('not to yourself, an agent, or a stranger', async () => {
        const { host, room, hostMember } = await setup();
        await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: hostMember.id }).expect(400);
        const { key } = agentSeats.createAgentSeat({ roomId: room.id, hostUserId: host.id, label: 'Robo' });
        const { seat } = agentSeats.claimAgentSeat({ key });
        const agentMember = db.prepare(`SELECT id FROM room_members WHERE user_id = ?`).get(seat.user_id);
        await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: agentMember.id }).expect(400);
        await request(app).post(`/api/rooms/${room.id}/host-transfer`).set(auth(host.token)).send({ member_id: 'nope' }).expect(404);
    });
});

describe('DELETE /api/rooms/:id/leave', () => {
    test('works while waiting, refused after the start', async () => {
        const { host, room, guest: g, acct } = await setup();
        await request(app).delete(`/api/rooms/${room.id}/leave`).set(auth(acct.token)).expect(200, { ok: true });
        expect(db.prepare(`SELECT 1 FROM room_members WHERE user_id = ?`).get(acct.id)).toBeUndefined();

        await startGame(room, host);
        const res = await request(app).delete(`/api/rooms/${room.id}/leave`).set(auth(g.token)).expect(400);
        expect(res.body.error).toBe('You can only leave before the game starts');
        expect(db.prepare(`SELECT 1 FROM room_members WHERE user_id = ?`).get(g.id)).toBeTruthy();
    });
});
