'use strict';

// Authoritative game persistence shared by the HTTP routes and the MCP server.
// The only code that writes the games table:
// - startGameForRoom creates a room's game.
// - applyGameAction runs every game move: one SQLite transaction with the
//   state_version check, the domain applyAction call, event rows, the
//   game_actions idempotency row, the audit log, and the Socket.IO broadcast
//   (game:state_update, plus room:status_change when the game ends, so My
//   games and the waiting room see the room complete).
// - repairGameState replaces the state wholesale (dev-only host repair).
// Callers authenticate; game rules stay in the domain.

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getConfig } = require('../config');
const { buildGameActionAuditRecord, logGameActionAudit } = require('./audit');
const { emitToRoom, notifyRoom } = require('./roomEvents');
const { notifyTurnChange } = require('./turnAlerts');
const { getRoom, getRoomWithMembers, canViewRoom } = require('./rooms');
const {
    createInitialGame,
    normalizeState,
    applyAction,
    validateRepairedState,
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

function insertEvents(gameId, actorUserId, events) {
    const stmt = db.prepare(`
        INSERT INTO game_events (id, game_id, player_id, event_type, event_data)
        VALUES (?, ?, ?, ?, ?)
    `);
    events.forEach(event => {
        stmt.run(uuidv4(), gameId, event.playerId || actorUserId, event.type, JSON.stringify(event.data || {}));
    });
}

function publishGameUpdate(updatedGame) {
    emitToRoom(updatedGame.room_id, 'game:state_update', parseGame(updatedGame));
    notifyRoom(updatedGame.room_id);
}

// Create the game for a room (host only). Returns the parsed game. If a game
// already exists for the room it is returned unchanged.
function startGameForRoom({ roomId, actorUserId, gameState, settings }) {
    if (!roomId) throw new GameRuleError(400, 'room_id required');

    const room = getRoom(roomId);
    if (!room) throw new GameRuleError(404, 'Room not found');
    if (room.host_id !== actorUserId) throw new GameRuleError(403, 'Not the host');

    const existingGame = getGameByRoom(roomId);
    if (existingGame) return parseGame(existingGame);

    const gameId = uuidv4();
    const roomMembers = db.prepare(`SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC`).all(roomId);
    const initialState = normalizeState(gameState || createInitialGame(roomMembers, { loanRate: settings?.loanRate, loanRates: settings?.loanRates }));
    db.withTransaction(() => {
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
    });

    const game = getGame(gameId);
    emitToRoom(roomId, 'room:status_change', { ...room, status: 'in_progress' });
    notifyRoom(roomId);
    notifyTurnChange(null, game, actorUserId);
    return parseGame(game);
}

// Apply one game action authoritatively. Returns { game, events } exactly as the
// HTTP route responds. A replayed actionId returns the stored result. Throws
// GameRuleError for rule/validation failures; a 409 carries err.stateVersion.
function applyGameAction({ gameId, actorUserId, actionId, type, payload, expectedVersion, requestBody }) {
    if (!actionId || !type) throw new GameRuleError(400, 'actionId and type required');
    if (typeof expectedVersion !== 'number') throw new GameRuleError(400, 'expectedVersion required');

    const existing = db.prepare(`SELECT result_json FROM game_actions WHERE game_id = ? AND action_id = ?`).get(gameId, actionId);
    if (existing) return JSON.parse(existing.result_json);

    const { game, updatedGame, result, justEnded } = db.withTransaction(() => {
        const game = getGame(gameId);
        if (!game) throw new GameRuleError(404, 'Game not found');
        if (game.state_version !== expectedVersion) {
            const err = new GameRuleError(409, 'Stale game state');
            err.stateVersion = game.state_version;
            throw err;
        }
        const room = getRoom(game.room_id);
        const beforeState = normalizeState(JSON.parse(game.game_state));
        const testDice = config.allowStateRepair && Array.isArray((payload || {}).testDice)
            ? (payload || {}).testDice
            : undefined;
        const { state: afterState, events } = applyAction(beforeState, actorUserId, { type, payload: payload || {} }, { hostId: room.host_id, dice: testDice });
        db.prepare(`
            UPDATE games
            SET game_state = ?, current_player_index = ?, state_version = state_version + 1, updated_at = datetime('now')
            WHERE id = ?
        `).run(JSON.stringify(afterState), afterState.currentPlayerIndex, gameId);
        const justEnded = !!afterState.ended && room.status !== 'completed';
        if (afterState.ended) {
            db.prepare(`UPDATE rooms SET status = 'completed' WHERE id = ?`).run(game.room_id);
        }
        insertEvents(gameId, actorUserId, events);
        const updatedGame = getGame(gameId);
        const result = { game: parseGame(updatedGame), events };
        db.prepare(`
            INSERT INTO game_actions (id, game_id, actor_user_id, action_id, action_type, request_json, result_json, state_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), gameId, actorUserId, actionId, type, JSON.stringify(requestBody), JSON.stringify(result), updatedGame.state_version);
        return { game, updatedGame, result, justEnded };
    });

    logGameActionAudit(buildGameActionAuditRecord({
        game,
        updatedGame,
        actorUserId,
        actionId,
        actionType: type,
        events: result.events,
    }), config);
    publishGameUpdate(updatedGame);
    if (justEnded) emitToRoom(updatedGame.room_id, 'room:status_change', getRoomWithMembers(updatedGame.room_id));
    notifyTurnChange(game, updatedGame, actorUserId);
    return result;
}

// Replace a game's whole state, for a host repairing a stuck game on a dev
// server (the route refuses unless ALLOW_STATE_REPAIR=true). No events or
// audit are recorded. Returns the parsed game.
function repairGameState({ gameId, actorUserId, gameState, actionType, expectedVersion }) {
    if (!gameState) throw new GameRuleError(400, 'game_state required');
    if (typeof expectedVersion !== 'number') throw new GameRuleError(400, 'expected_version required');

    const game = getGame(gameId);
    if (!game) throw new GameRuleError(404, 'Game not found');
    if (!canViewRoom(game.room_id, actorUserId)) throw new GameRuleError(403, 'Not a room member');
    const room = getRoom(game.room_id);
    if (!room || room.host_id !== actorUserId) throw new GameRuleError(403, 'Not the host');
    if (game.state_version !== expectedVersion) {
        const err = new GameRuleError(409, 'Stale game state');
        err.stateVersion = game.state_version;
        throw err;
    }
    const shapeError = validateRepairedState(JSON.parse(game.game_state), gameState);
    if (shapeError) throw new GameRuleError(400, shapeError);
    if (actionType !== 'host_state_repair') throw new GameRuleError(400, 'Only host_state_repair is allowed');

    db.prepare(`
        UPDATE games
        SET game_state = ?, state_version = state_version + 1, updated_at = datetime('now')
        WHERE id = ?
    `).run(JSON.stringify(normalizeState(gameState)), gameId);
    const updatedGame = getGame(gameId);
    publishGameUpdate(updatedGame);
    return parseGame(updatedGame);
}

module.exports = {
    parseGame,
    getGame,
    getGameByRoom,
    startGameForRoom,
    applyGameAction,
    repairGameState,
};
