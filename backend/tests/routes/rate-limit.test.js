'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.AUTH_RATE_LIMIT_MAX = '2';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
process.env.ROOM_CREATE_RATE_LIMIT_MAX = '1';
process.env.ROOM_CREATE_RATE_LIMIT_WINDOW_MS = '60000';
process.env.GAME_ACTION_RATE_LIMIT_MAX = '1';
process.env.GAME_ACTION_RATE_LIMIT_WINDOW_MS = '60000';

const request = require('supertest');
const {
    addRoomMemberFixture,
    buildGameState,
    createGameFixture,
    createRoomFixture,
    createUserFixture,
    resetTestDb,
} = require('../helpers/fixtures');

let app, db;

beforeAll(() => {
    const { app: a } = require('../../server');
    const d = require('../../db');
    app = a;
    db = d;
});

beforeEach(() => {
    resetTestDb(db);
});

afterAll(() => {
    [
        'RATE_LIMIT_ENABLED',
        'AUTH_RATE_LIMIT_MAX',
        'AUTH_RATE_LIMIT_WINDOW_MS',
        'ROOM_CREATE_RATE_LIMIT_MAX',
        'ROOM_CREATE_RATE_LIMIT_WINDOW_MS',
        'GAME_ACTION_RATE_LIMIT_MAX',
        'GAME_ACTION_RATE_LIMIT_WINDOW_MS',
    ].forEach(key => delete process.env[key]);
});

describe('production rate limits', () => {
    test('limits auth requests by client, path, and email', async () => {
        await request(app).post('/api/auth/send-otp').send({ email: 'limit@example.com' }).expect(200);
        await request(app).post('/api/auth/send-otp').send({ email: 'limit@example.com' }).expect(200);

        const limited = await request(app)
            .post('/api/auth/send-otp')
            .send({ email: 'limit@example.com' });

        expect(limited.status).toBe(429);
        expect(limited.body.error).toBe('Too many requests');
        expect(limited.headers['retry-after']).toBeTruthy();
        expect(limited.headers['x-ratelimit-limit']).toBe('2');
        expect(limited.headers['x-ratelimit-remaining']).toBe('0');
    });

    test('limits room creation per authenticated user', async () => {
        const user = createUserFixture(db);

        await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user.token}`)
            .send({ name: 'First Room', player_name: 'Alice' })
            .expect(200);

        const limited = await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${user.token}`)
            .send({ name: 'Second Room', player_name: 'Alice' });

        expect(limited.status).toBe(429);
        expect(limited.body.error).toBe('Too many requests');
        expect(db.prepare(`SELECT COUNT(*) AS count FROM rooms`).get().count).toBe(1);
    });

    test('limits authoritative game actions per game and actor', async () => {
        const { user1, game } = createTwoPlayerGame();

        await request(app)
            .post(`/api/games/${game.id}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ actionId: 'first-action', type: 'end_turn', expectedVersion: 0 })
            .expect(200);

        const limited = await request(app)
            .post(`/api/games/${game.id}/actions`)
            .set('Authorization', `Bearer ${user1.token}`)
            .send({ actionId: 'second-action', type: 'end_turn', expectedVersion: 1 });

        expect(limited.status).toBe(429);
        expect(limited.body.error).toBe('Too many requests');
        expect(db.prepare(`SELECT COUNT(*) AS count FROM game_actions WHERE game_id = ?`).get(game.id).count).toBe(1);
    });

    test('limits MCP room creation per client like the HTTP route', async () => {
        const callCreateRoom = id => request(app)
            .post('/api/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .send({
                jsonrpc: '2.0',
                id,
                method: 'tools/call',
                params: { name: 'create_room', arguments: { room_name: `Room ${id}`, player_name: 'Robo' } },
            })
            .expect(200);

        const first = await callCreateRoom(1);
        expect(first.body.result.isError).toBeFalsy();

        const limited = await callCreateRoom(2);
        expect(limited.body.result.isError).toBe(true);
        expect(limited.body.result.content[0].text).toMatch(/Too many requests/);
        expect(db.prepare(`SELECT COUNT(*) AS count FROM rooms`).get().count).toBe(1);
    });

});

function createTwoPlayerGame() {
    const user1 = createUserFixture(db);
    const user2 = createUserFixture(db);
    const room = createRoomFixture(db, user1.id, { maxPlayers: 4 });
    addRoomMemberFixture(db, room.id, user2.id, 'Bob');

    const gameState = buildGameState(['Alice', 'Bob']);
    gameState.players[0].userId = user1.id;
    gameState.players[0].diceRolled = true;
    gameState.players[1].userId = user2.id;
    const game = createGameFixture(db, room.id, { gameState });

    return { user1, user2, room, game };
}
