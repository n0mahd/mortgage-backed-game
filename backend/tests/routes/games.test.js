'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const { addRoomMemberFixture, createRoomFixture, createUserFixture, resetTestDb } = require('../helpers/fixtures');
const { MONOPOLY_PROPERTIES } = require('../../domain/gameRules');

let app, db;
let user1, user2, room;

beforeAll(() => {
    const { app: a } = require('../../server');
    const d = require('../../db');
    app = a;
    db = d;
});

beforeEach(() => {
    resetTestDb(db);
    user1 = createUserFixture(db);
    user2 = createUserFixture(db);
    room = createRoomFixture(db, user1.id, { inviteCode: 'ROOM01', maxPlayers: 4 });
});

function minimalGameState() {
    return {
        currentPlayerIndex: 0,
        players: [
            { userId: user1.id, name: 'Alice', cash: 1500, position: 0, bankrupt: false, inJail: false, properties: [], corporations: [], debts: [] },
            { userId: user2.id, name: 'Bob',   cash: 1500, position: 0, bankrupt: false, inJail: false, properties: [], corporations: [], debts: [] },
        ],
        properties: [],
        corporations: [],
        gameLog: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500 },
    };
}

function rolledGameState() {
    const state = minimalGameState();
    state.players[0].diceRolled = true;
    return state;
}

// ---------------------------------------------------------------------------
// POST /api/games
// ---------------------------------------------------------------------------
describe('POST /api/games', () => {
    test('creates game with game_state, returns parsed state', async () => {
        const gs = minimalGameState();
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id');
        expect(res.body.room_id).toBe(room.id);
        expect(typeof res.body.game_state).toBe('object');
    });

    test('game_state is returned as parsed object (not string)', async () => {
        const gs = minimalGameState();
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        expect(res.body.game_state).toHaveProperty('players');
        expect(Array.isArray(res.body.game_state.players)).toBe(true);
    });

    test('400 if room_id is missing', async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ game_state: minimalGameState() });

        expect(res.status).toBe(400);
    });

    test('creates default authoritative state if game_state is missing', async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id });

        expect(res.status).toBe(200);
        expect(res.body.game_state.players).toHaveLength(1);
    });

    test('403 if requester is not room host', async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user2.token}`)
            .send({ room_id: room.id, game_state: minimalGameState() });

        expect(res.status).toBe(403);
    });

    test('401 without auth', async () => {
        const res = await request(app)
            .post('/api/games')
            .send({ room_id: room.id, game_state: minimalGameState() });

        expect(res.status).toBe(401);
    });

    test('sets room_id correctly in DB', async () => {
        const gs = minimalGameState();
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(res.body.id);
        expect(game.room_id).toBe(room.id);
    });

    test('game_state stored as JSON string in DB', async () => {
        const gs = minimalGameState();
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        const game = db.prepare(`SELECT game_state FROM games WHERE id = ?`).get(res.body.id);
        expect(typeof game.game_state).toBe('string');
        expect(() => JSON.parse(game.game_state)).not.toThrow();
    });

    test('duplicate create returns existing game instead of 500', async () => {
        const gs = minimalGameState();
        const first = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        const second = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        expect(second.status).toBe(200);
        expect(second.body.id).toBe(first.body.id);
    });

    test('creating game marks room in_progress', async () => {
        const gs = minimalGameState();
        await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: gs });

        const updatedRoom = db.prepare(`SELECT status FROM rooms WHERE id = ?`).get(room.id);
        expect(updatedRoom.status).toBe('in_progress');
    });
});

// ---------------------------------------------------------------------------
// GET /api/games/by-room/:roomId
// ---------------------------------------------------------------------------
describe('GET /api/games/by-room/:roomId', () => {
    let gameId;

    beforeEach(async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: minimalGameState() });
        gameId = res.body.id;
    });

    test('200 returns game with parsed game_state', async () => {
        const res = await request(app)
            .get(`/api/games/by-room/${room.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.game_state).toBe('object');
    });

    test('404 if no game for room', async () => {
        const emptyRoom = createRoomFixture(db, user1.id, { inviteCode: 'EMPTY1' });
        const res = await request(app)
            .get(`/api/games/by-room/${emptyRoom.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(404);
    });

    test('auth required', async () => {
        const res = await request(app).get(`/api/games/by-room/${room.id}`);
        expect(res.status).toBe(401);
    });

    test('returns correct room_id', async () => {
        const res = await request(app)
            .get(`/api/games/by-room/${room.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.body.room_id).toBe(room.id);
    });
});

// ---------------------------------------------------------------------------
// GET /api/games/:id
// ---------------------------------------------------------------------------
describe('GET /api/games/:id', () => {
    let gameId;

    beforeEach(async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: minimalGameState() });
        gameId = res.body.id;
    });

    test('200 returns game by ID', async () => {
        const res = await request(app)
            .get(`/api/games/${gameId}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(gameId);
    });

    test('404 for non-existent game', async () => {
        const res = await request(app)
            .get('/api/games/nonexistent-id')
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(404);
    });

    test('auth required', async () => {
        const res = await request(app).get(`/api/games/${gameId}`);
        expect(res.status).toBe(401);
    });

    test('game_state is parsed JSON object (not string)', async () => {
        const res = await request(app)
            .get(`/api/games/${gameId}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(typeof res.body.game_state).toBe('object');
        expect(typeof res.body.game_state).not.toBe('string');
    });
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions
// ---------------------------------------------------------------------------
describe('POST /api/games/:id/actions', () => {
    let gameId;

    beforeEach(async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: rolledGameState() });
        gameId = res.body.id;
    });

    function actionPayload(type, payload = {}, expectedVersion = 0, actionId = uuidForTest()) {
        return { actionId, type, payload, expectedVersion };
    }

    test('200 applies end_turn action', async () => {
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn'));

        expect(res.status).toBe(200);
        expect(res.body.game.state_version).toBe(1);
        expect(res.body.game.game_state.currentPlayerIndex).toBe(1);
    });

    test('400 rejects end_turn before current player rolls', async () => {
        const unrolledRoom = createRoomFixture(db, user1.id, { inviteCode: 'UNROLL', maxPlayers: 4 });
        const unrolledGame = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: unrolledRoom.id, game_state: minimalGameState() });

        const res = await request(app)
            .post(`/api/games/${unrolledGame.body.id}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn'));

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Roll before ending turn');
    });

    test('host can pause and resume game actions, and normal actions are blocked while paused', async () => {
        const pause = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('host_pause_game', { reason: 'Player reconnecting' }));

        expect(pause.status).toBe(200);
        expect(pause.body.game.game_state.paused).toBe(true);
        expect(pause.body.game.game_state.pause.reason).toBe('Player reconnecting');
        expect(pause.body.events.some(event => event.type === 'game_paused')).toBe(true);

        const blocked = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn', {}, 1));

        expect(blocked.status).toBe(400);
        expect(blocked.body.error).toBe('Game is paused');

        const resume = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('host_resume_game', {}, 1));

        expect(resume.status).toBe(200);
        expect(resume.body.game.game_state.paused).toBe(false);
        expect(resume.body.game.game_state.pause).toBeNull();
        expect(resume.body.game.game_state.pauseHistory[0].reason).toBe('Player reconnecting');
        expect(resume.body.events.some(event => event.type === 'game_resumed')).toBe(true);
    });

    test('non-host cannot pause the game', async () => {
        addRoomMemberFixture(db, room.id, user2.id, 'Bob');

        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send(actionPayload('host_pause_game'));

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Not the host');
    });

    test('state persisted after action', async () => {
        await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn'));

        const game = db.prepare(`SELECT game_state FROM games WHERE id = ?`).get(gameId);
        const parsed = JSON.parse(game.game_state);
        expect(parsed.currentPlayerIndex).toBe(1);
    });

    test('400 with missing actionId', async () => {
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ type: 'end_turn', expectedVersion: 0 });

        expect(res.status).toBe(400);
    });

    test('400 with missing type', async () => {
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ actionId: uuidForTest(), expectedVersion: 0 });

        expect(res.status).toBe(400);
    });

    test('400 with missing expectedVersion', async () => {
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ actionId: uuidForTest(), type: 'end_turn' });

        expect(res.status).toBe(400);
    });

    test('401 without auth', async () => {
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .send(actionPayload('end_turn'));

        expect(res.status).toBe(401);
    });

    test('404 for non-existent game', async () => {
        const res = await request(app)
            .post('/api/games/nonexistent/actions')
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn'));

        expect(res.status).toBe(404);
    });

    test('403 for authenticated user outside the room', async () => {
        const outsider = createUserFixture(db);

        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${outsider.token}`)
            .send(actionPayload('end_turn'));

        expect(res.status).toBe(403);
    });

    test('409 with stale expected_version', async () => {
        await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn'));

        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn', {}, 0));

        expect(res.status).toBe(409);
    });

    test('403 when non-current player attempts turn action', async () => {
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send(actionPayload('end_turn'));

        expect(res.status).toBe(403);
    });

    test('same actionId is idempotent', async () => {
        const actionId = uuidForTest();
        const first = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn', {}, 0, actionId));
        const second = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('end_turn', {}, 0, actionId));

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.body.game.state_version).toBe(first.body.game.state_version);
    });

    test('issue_debt uses fixed game interest rate instead of client payload', async () => {
        // Loans can total 90% of the borrower's portfolio: Alice owns Boardwalk.
        const state = minimalGameState();
        state.properties = MONOPOLY_PROPERTIES.map((prop, i) => ({ ...prop, id: `prop-${i}`, ownerId: null, ownerName: null, houses: 0 }));
        Object.assign(state.properties.find(p => p.id === 'prop-26'), { ownerId: user1.id, ownerName: 'Alice' });
        db.prepare(`UPDATE games SET game_state = ?, state_version = 0 WHERE id = ?`).run(JSON.stringify(state), gameId);
        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('issue_debt', { amount: 100, interestRate: 99 }));

        expect(res.status).toBe(200);
        expect(res.body.game.game_state.players[0].debts[0].interestRate).toBe(5);
    });

    test('chairman can issue debt under a corporation', async () => {
        const state = minimalGameState();
        state.corporations = [{
            id: 'corp-1',
            ticker: 'ALPH',
            name: 'ALPH Corporation',
            founderId: user1.id,
            founderName: 'Alice',
            chairmanId: user1.id,
            chairmanName: 'Alice',
            totalShares: 8,
            pricePerShare: 50,
            availableShares: 8,
            assets: [{ id: 'prop-0', name: 'Mediterranean Avenue', value: 60 }],
            shareholders: [],
            debts: [],
            cash: 0,
        }];
        db.prepare(`UPDATE games SET game_state = ?, state_version = 0 WHERE id = ?`).run(JSON.stringify(state), gameId);

        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send(actionPayload('issue_debt', {
                amount: 50, // within 90% of Mediterranean Avenue's $60
                interestRate: 99,
                issuerType: 'corporation',
                corpId: 'corp-1',
            }));

        expect(res.status).toBe(200);
        const corp = res.body.game.game_state.corporations.find(item => item.id === 'corp-1');
        expect(corp.debts[0].principal).toBe(50);
        expect(corp.debts[0].interestRate).toBe(5);
        expect(corp.cash).toBe(50);
    });

    test('majority shareholder can change corporation chairman directly', async () => {
        addRoomMemberFixture(db, room.id, user2.id, 'Bob');
        const state = minimalGameState();
        state.corporations = [governedCorp({
            chairmanId: user1.id,
            chairmanName: 'Alice',
            shareholders: [{ userId: user2.id, name: 'Bob', shares: 5 }],
            totalShares: 8,
        })];
        db.prepare(`UPDATE games SET game_state = ?, state_version = 0 WHERE id = ?`).run(JSON.stringify(state), gameId);

        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send(actionPayload('change_chairman', { corpId: 'corp-1', candidateUserId: user2.id }));

        expect(res.status).toBe(200);
        const corp = res.body.game.game_state.corporations.find(item => item.id === 'corp-1');
        expect(corp.chairmanId).toBe(user2.id);
        expect(corp.chairmanName).toBe('Bob');
    });

    test('half ownership cannot remove existing chairman without pooled majority vote', async () => {
        addRoomMemberFixture(db, room.id, user2.id, 'Bob');
        const state = minimalGameState();
        state.corporations = [governedCorp({
            chairmanId: user1.id,
            chairmanName: 'Alice',
            shareholders: [{ userId: user2.id, name: 'Bob', shares: 4 }],
            totalShares: 8,
        })];
        db.prepare(`UPDATE games SET game_state = ?, state_version = 0 WHERE id = ?`).run(JSON.stringify(state), gameId);

        const res = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send(actionPayload('change_chairman', { corpId: 'corp-1', candidateUserId: user2.id }));

        expect(res.status).toBe(403);
    });

    test('shareholders can pool shares through a vote to change chairman', async () => {
        const user3 = createUserFixture(db);
        addRoomMemberFixture(db, room.id, user2.id, 'Bob');
        addRoomMemberFixture(db, room.id, user3.id, 'Carol');
        const state = minimalGameState();
        state.players.push({ userId: user3.id, name: 'Carol', cash: 1500, position: 0, bankrupt: false, inJail: false, properties: [], corporations: [], debts: [] });
        state.corporations = [governedCorp({
            chairmanId: user1.id,
            chairmanName: 'Alice',
            shareholders: [
                { userId: user2.id, name: 'Bob', shares: 3 },
                { userId: user3.id, name: 'Carol', shares: 3 },
            ],
            totalShares: 9,
        })];
        db.prepare(`UPDATE games SET game_state = ?, state_version = 0 WHERE id = ?`).run(JSON.stringify(state), gameId);

        const proposed = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user2.token}`)
            .send(actionPayload('propose_chairman_vote', { corpId: 'corp-1', candidateUserId: user2.id }));

        expect(proposed.status).toBe(200);
        let corp = proposed.body.game.game_state.corporations.find(item => item.id === 'corp-1');
        expect(corp.chairmanId).toBe(user1.id);
        expect(corp.chairmanVotes[0].status).toBe('open');

        const supported = await request(app)
            .post(`/api/games/${gameId}/actions`)
            .set('Authorization', `Bearer ${user3.token}`)
            .send(actionPayload('support_chairman_vote', { corpId: 'corp-1', voteId: corp.chairmanVotes[0].id }, proposed.body.game.state_version));

        expect(supported.status).toBe(200);
        corp = supported.body.game.game_state.corporations.find(item => item.id === 'corp-1');
        expect(corp.chairmanId).toBe(user2.id);
        expect(corp.chairmanName).toBe('Bob');
        expect(corp.chairmanVotes[0].status).toBe('passed');
        expect(corp.chairmanVotes[0].supportedShares).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// GET /api/games/:id/events
// ---------------------------------------------------------------------------
describe('GET /api/games/:id/events', () => {
    let gameId;

    beforeEach(async () => {
        const res = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: minimalGameState() });
        gameId = res.body.id;
    });

    test('200 returns events array', async () => {
        const res = await request(app)
            .get(`/api/games/${gameId}/events`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('returns game_started event after create', async () => {
        const res = await request(app)
            .get(`/api/games/${gameId}/events`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(res.body.some(event => event.event_type === 'game_started')).toBe(true);
    });

    test('event_data is parsed JSON', async () => {
        db.prepare(`
            INSERT INTO game_events (id, game_id, player_id, event_type, event_data)
            VALUES (?, ?, ?, ?, ?)
        `).run('event-buy', gameId, user1.id, 'buy', JSON.stringify({ property: 'prop-0', price: 60 }));

        const res = await request(app)
            .get(`/api/games/${gameId}/events`)
            .set('Authorization', `Bearer ${user1.token}`);
        const event = res.body.find(row => row.event_type === 'buy');
        expect(event.event_data).toEqual({ property: 'prop-0', price: 60 });
    });

    test('auth required to get events', async () => {
        const res = await request(app).get(`/api/games/${gameId}/events`);
        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Game State Integrity
// ---------------------------------------------------------------------------
describe('Game state integrity', () => {
    test('deeply nested game_state is preserved exactly', async () => {
        const deepState = {
            ...minimalGameState(),
            meta: { nested: { deeply: { value: 42, arr: [1, 2, 3] } } },
        };

        const createRes = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: room.id, game_state: deepState });

        const getRes = await request(app)
            .get(`/api/games/${createRes.body.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(getRes.body.game_state.meta.nested.deeply.value).toBe(42);
        expect(getRes.body.game_state.meta.nested.deeply.arr).toEqual([1, 2, 3]);
    });

    test('unicode player names in game_state handled correctly', async () => {
        const unicodeRoom = createRoomFixture(db, user1.id, { inviteCode: 'UNCD01' });

        const unicodeState = {
            ...minimalGameState(),
            players: [{ userId: user1.id, name: '日本語プレーヤー', cash: 1500, position: 0, bankrupt: false, inJail: false, properties: [], corporations: [], debts: [] }],
        };

        const createRes = await request(app)
            .post('/api/games')
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ room_id: unicodeRoom.id, game_state: unicodeState });

        const getRes = await request(app)
            .get(`/api/games/${createRes.body.id}`)
            .set('Authorization', `Bearer ${user1.token}`);
        expect(getRes.body.game_state.players[0].name).toBe('日本語プレーヤー');
    });
});

function uuidForTest() {
    return `test-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function governedCorp(overrides = {}) {
    return {
        id: 'corp-1',
        ticker: 'ALPH',
        name: 'ALPH Corporation',
        founderId: overrides.founderId || overrides.chairmanId,
        founderName: overrides.founderName || overrides.chairmanName,
        chairmanId: overrides.chairmanId,
        chairmanName: overrides.chairmanName,
        totalShares: overrides.totalShares || 8,
        pricePerShare: 50,
        availableShares: overrides.availableShares || 0,
        assets: [{ id: 'prop-0', name: 'Mediterranean Avenue', value: 60 }],
        shareholders: overrides.shareholders || [],
        debts: [],
        cash: 0,
        chairmanVotes: [],
    };
}
