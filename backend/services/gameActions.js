'use strict';

// Authoritative game persistence shared by the HTTP routes and the MCP server.
// Every game mutation runs through applyGameAction: one SQLite transaction with
// the state_version check, the domain applyAction call, event rows, the
// game_actions idempotency row, the audit log, and the Socket.IO broadcast.
// Callers authenticate and authorize membership; game rules stay in the domain.

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getConfig } = require('../config');
const { buildGameActionAuditRecord, logGameActionAudit } = require('../audit');
const { notifyRoom } = require('./roomEvents');
const { notifyTurnChange } = require('./turnAlerts');
const {
    createInitialGame,
    normalizeState,
    applyAction,
    GameRuleError,
} = require('../domain/gameRules');

const config = getConfig();

function parseGame(game) {
    const gameState = normalizeState(JSON.parse(game.game_state));
    return { ...game, game_state: gameState };
}

function getGame(gameId) {
    return db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
}

function getGameByRoom(roomId) {
    return db.prepare(`SELECT * FROM games WHERE room_id = ?`).get(roomId);
}

function getRoom(roomId) {
    return db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
}

function insertEvents(gameId, actorUserId, events) {
    const stmt = db.prepare(`
        INSERT INTO game_events (id, game_id, player_id, event_type, event_data)
        VALUES (?, ?, ?, ?, ?)
    `);
    events.forEach(event => {
        stmt.run(uuidv4(), gameId, event.playerId || actorUserId, event.type, JSON.stringify(event.data || {}));
    });
}

function safeRollback() {
    try {
        db.exec('ROLLBACK');
    } catch (err) {
        if (!/no transaction is active/i.test(err.message || '')) throw err;
    }
}

function publishGameUpdate(io, updatedGame) {
    io.to(`room:${updatedGame.room_id}`).emit('game:state_update', parseGame(updatedGame));
    notifyRoom(updatedGame.room_id);
}

// Create the game for a room (host only). Returns the parsed game. If a game
// already exists for the room it is returned unchanged.
function startGameForRoom(io, { roomId, actorUserId, gameState, settings, minPlayers = 0 }) {
    if (!roomId) throw new GameRuleError(400, 'room_id required');

    const room = getRoom(roomId);
    if (!room) throw new GameRuleError(404, 'Room not found');
    if (room.host_id !== actorUserId) throw new GameRuleError(403, 'Not the host');

    const existingGame = getGameByRoom(roomId);
    if (existingGame) return parseGame(existingGame);

    const gameId = uuidv4();
    const roomMembers = db.prepare(`SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC`).all(roomId);
    if (roomMembers.length < minPlayers) {
        throw new GameRuleError(400, `Need at least ${minPlayers} players to start`);
    }
    const initialState = normalizeState(gameState || createInitialGame(roomMembers, { loanRates: settings?.loanRates }));
    try {
        db.exec('BEGIN');
        db.prepare(`
            INSERT INTO games (id, room_id, game_state, current_player_index)
            VALUES (?, ?, ?, 0)
        `).run(gameId, roomId, JSON.stringify(initialState));
        db.prepare(`UPDATE rooms SET status = 'in_progress' WHERE id = ?`).run(roomId);
        db.prepare(`
            INSERT INTO game_events (id, game_id, player_id, event_type, event_data)
            VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), gameId, actorUserId, 'game_started', JSON.stringify({
            player_count: initialState.players.length,
            players: initialState.players.map(player => player.name),
        }));
        db.exec('COMMIT');
    } catch (err) {
        safeRollback();
        throw err;
    }

    const game = getGame(gameId);
    io.to(`room:${roomId}`).emit('room:status_change', { ...room, status: 'in_progress' });
    notifyRoom(roomId);
    notifyTurnChange(null, game, actorUserId);
    return parseGame(game);
}

// Apply one game action authoritatively. Returns { game, events } exactly as the
// HTTP route responds. A replayed actionId returns the stored result. Throws
// GameRuleError for rule/validation failures; a 409 carries err.stateVersion.
function applyGameAction(io, { gameId, actorUserId, actionId, type, payload, expectedVersion, requestBody }) {
    if (!actionId || !type) throw new GameRuleError(400, 'actionId and type required');
    if (typeof expectedVersion !== 'number') throw new GameRuleError(400, 'expectedVersion required');

    const existing = db.prepare(`SELECT result_json FROM game_actions WHERE game_id = ? AND action_id = ?`).get(gameId, actionId);
    if (existing) return JSON.parse(existing.result_json);

    let result;
    let updatedGame;
    let previousGame;
    let events;
    try {
        db.exec('BEGIN');
        const game = getGame(gameId);
        if (!game) throw new GameRuleError(404, 'Game not found');
        previousGame = game;
        if (game.state_version !== expectedVersion) {
            throw new GameRuleError(409, 'Stale game state');
        }
        const room = getRoom(game.room_id);
        const beforeState = normalizeState(JSON.parse(game.game_state));
        const testDice = config.allowStateRepair && Array.isArray((payload || {}).testDice)
            ? (payload || {}).testDice
            : undefined;
        const applied = applyAction(beforeState, actorUserId, { type, payload: payload || {} }, { hostId: room.host_id, dice: testDice });
        const afterState = applied.state;
        events = applied.events;
        db.prepare(`
            UPDATE games
            SET game_state = ?, current_player_index = ?, state_version = state_version + 1, updated_at = datetime('now')
            WHERE id = ?
        `).run(JSON.stringify(afterState), afterState.currentPlayerIndex, gameId);
        if (afterState.ended) {
            db.prepare(`UPDATE rooms SET status = 'completed' WHERE id = ?`).run(game.room_id);
        }
        insertEvents(gameId, actorUserId, events);
        updatedGame = getGame(gameId);
        result = { game: parseGame(updatedGame), events };
        db.prepare(`
            INSERT INTO game_actions (id, game_id, actor_user_id, action_id, action_type, request_json, result_json, state_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), gameId, actorUserId, actionId, type, JSON.stringify(requestBody), JSON.stringify(result), updatedGame.state_version);
        db.exec('COMMIT');
        logGameActionAudit(buildGameActionAuditRecord({
            game,
            updatedGame,
            actorUserId,
            actionId,
            actionType: type,
            events,
        }), config);
    } catch (err) {
        safeRollback();
        if (err instanceof GameRuleError && err.status === 409) {
            err.stateVersion = getGame(gameId)?.state_version;
        }
        throw err;
    }

    publishGameUpdate(io, updatedGame);
    notifyTurnChange(previousGame, updatedGame, actorUserId);
    return result;
}

module.exports = {
    parseGame,
    getGame,
    getGameByRoom,
    getRoom,
    startGameForRoom,
    applyGameAction,
    publishGameUpdate,
    GameRuleError,
};
