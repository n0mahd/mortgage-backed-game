/**
 * fixtures.js — shared test data factories.
 */

const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-secret';

function resetTestDb(db) {
    db.exec(`
        DELETE FROM game_actions;
        DELETE FROM game_events;
        DELETE FROM games;
        DELETE FROM rejoin_requests;
        DELETE FROM agent_seats;
        DELETE FROM room_members;
        DELETE FROM rooms;
        DELETE FROM otps;
        DELETE FROM device_transfer_codes;
        DELETE FROM push_subscriptions;
        DELETE FROM users;
    `);
}

function signToken(userId) {
    return jwt.sign({ sub: userId }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Insert a user into the test DB and return {id, email, token}.
 */
function createUserFixture(db, opts = {}) {
    const id = uuidv4();
    const email = opts.email || `user-${id.slice(0, 8)}@test.com`;
    const isAnonymous = opts.anonymous ? 1 : 0;

    if (isAnonymous) {
        db.prepare(`INSERT INTO users (id, email, is_anonymous) VALUES (?, NULL, 1)`).run(id);
    } else {
        db.prepare(`INSERT INTO users (id, email, is_anonymous) VALUES (?, ?, 0)`).run(id, email);
    }

    const token = signToken(id);
    return { id, email: isAnonymous ? null : email, token };
}

/**
 * Insert a room into the test DB and return the room with members.
 */
function createRoomFixture(db, hostId, opts = {}) {
    const roomId = uuidv4();
    const memberId = uuidv4();
    const inviteCode = opts.inviteCode || randomInviteCode();
    const name = opts.name || 'Test Room';
    const maxPlayers = opts.maxPlayers || 4;
    const status = opts.status || 'waiting';

    db.prepare(`
        INSERT INTO rooms (id, invite_code, host_id, name, max_players, status)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(roomId, inviteCode, hostId, name, maxPlayers, status);

    addRoomMemberFixture(db, roomId, hostId, opts.playerName || 'Host', memberId);

    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    const members = db.prepare(`SELECT * FROM room_members WHERE room_id = ?`).all(roomId);
    return { ...room, room_members: members };
}

function addRoomMemberFixture(db, roomId, userId, playerName = 'Player', memberId = uuidv4()) {
    db.prepare(`
        INSERT INTO room_members (id, room_id, user_id, player_name)
        VALUES (?, ?, ?, ?)
    `).run(memberId, roomId, userId, playerName);
    return db.prepare(`SELECT * FROM room_members WHERE id = ?`).get(memberId);
}

/**
 * Insert a game into the test DB and return the game row.
 */
function createGameFixture(db, roomId, opts = {}) {
    const gameId = uuidv4();
    const gameState = opts.gameState || buildGameState(['Player1', 'Player2']);

    db.prepare(`
        INSERT INTO games (id, room_id, game_state, current_player_index)
        VALUES (?, ?, ?, 0)
    `).run(gameId, roomId, JSON.stringify(gameState));

    return db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
}

function createOtpFixture(db, email, code, opts = {}) {
    const id = uuidv4();
    const expires = opts.expiredMinutesAgo > 0
        ? toSqliteDate(new Date(Date.now() - opts.expiredMinutesAgo * 60 * 1000))
        : toSqliteDate(new Date(Date.now() + 10 * 60 * 1000));

    db.prepare(`
        INSERT INTO otps (id, email, code, expires_at, used)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, email, code, expires, opts.used ? 1 : 0);

    return id;
}

/**
 * Build a minimal valid game_state object.
 */
function buildGameState(playerNames = ['Player1', 'Player2']) {
    const players = playerNames.map((name, i) => ({
        userId: `user-${i}`,
        name,
        cash: 1500,
        position: 0,
        properties: [],
        corporations: [],
        debts: [],
        bankrupt: false,
        inJail: false,
        jailTurns: 0,
        doubleCount: 0,
        diceRolled: false,
        hasGetOutOfJailCard: false,
    }));

    const properties = [
        { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-1', name: 'Baltic Ave', color: 'Brown', price: 60, rent: [4, 20, 60, 180, 320, 450], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-2', name: 'Oriental Ave', color: 'Light Blue', price: 100, rent: [6, 30, 90, 270, 400, 550], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-3', name: 'Vermont Ave', color: 'Light Blue', price: 100, rent: [6, 30, 90, 270, 400, 550], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-4', name: 'Connecticut Ave', color: 'Light Blue', price: 120, rent: [8, 40, 100, 300, 450, 600], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-9', name: 'Reading Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-16', name: 'Pennsylvania RR', color: 'Railroad', price: 200, rent: [25, 50, 100, 200], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-27', name: 'B.&O. Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-24', name: 'Short Line RR', color: 'Railroad', price: 200, rent: [25, 50, 100, 200], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-6', name: 'Electric Company', color: 'Utility', price: 150, rent: [], ownerId: null, ownerName: null, houses: 0 },
        { id: 'prop-19', name: 'Water Works', color: 'Utility', price: 150, rent: [], ownerId: null, ownerName: null, houses: 0 },
    ];

    return {
        currentPlayerIndex: 0,
        players,
        properties,
        corporations: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        settings: {
            passGoAmount: 200,
            startingCash: 1500,
        },
    };
}

function randomInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function toSqliteDate(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

module.exports = {
    resetTestDb,
    addRoomMemberFixture,
    createUserFixture,
    createRoomFixture,
    createGameFixture,
    createOtpFixture,
    buildGameState,
    signToken,
    toSqliteDate,
};
