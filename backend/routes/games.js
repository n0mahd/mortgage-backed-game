'use strict';

// Games: start a game, read it, take actions, and (dev only) repair its state.
// Every write goes through services/gameActions.js. Errors carrying a 4xx
// status (GameRuleError) are answered by the error handler in server.js.

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const {
    parseGame,
    getGame,
    getGameByRoom,
    startGameForRoom,
    applyGameAction,
    repairGameState,
} = require('../services/gameActions');
const { canViewRoom } = require('../services/rooms');
const {
    MONOPOLY_PROPERTIES,
    BOARD_SQUARES,
    HOUSE_COSTS,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
} = require('../domain/gameRules');

const router = express.Router();
const config = getConfig();
const gameActionRateLimit = createRateLimiter({
    name: 'game_action',
    ...config.rateLimits.gameAction,
    keyGenerator: req => `${req.params.id}:${getRequestActorKey(req)}`,
});

// Loads the game in :id into req.game; 404 if missing, 403 for non-members.
function requireMember(req, res, next) {
    const game = getGame(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canViewRoom(game.room_id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    req.game = game;
    next();
}

// GET /api/games/config — authoritative board/config data
router.get('/config', (_req, res) => {
    res.json({ properties: MONOPOLY_PROPERTIES, board: BOARD_SQUARES, houseCosts: HOUSE_COSTS, chanceCards: CHANCE_CARDS, communityChestCards: COMMUNITY_CHEST_CARDS });
});

// POST /api/games — create a new game for a room
router.post('/', requireAuth, (req, res) => {
    const { room_id, game_state, settings } = req.body;
    res.json(startGameForRoom({ roomId: room_id, actorUserId: req.userId, gameState: game_state, settings }));
});

// GET /api/games/by-room/:roomId
router.get('/by-room/:roomId', requireAuth, (req, res) => {
    const game = getGameByRoom(req.params.roomId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canViewRoom(game.room_id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    res.json(parseGame(game));
});

// GET /api/games/:id
router.get('/:id', requireAuth, requireMember, (req, res) => {
    res.json(parseGame(req.game));
});

// POST /api/games/:id/actions — authoritative game action
router.post('/:id/actions', requireAuth, requireMember, gameActionRateLimit, (req, res) => {
    const { actionId, type, payload, expectedVersion } = req.body;
    res.json(applyGameAction({
        gameId: req.params.id,
        actorUserId: req.userId,
        actionId,
        type,
        payload,
        expectedVersion,
        requestBody: req.body,
    }));
});

// PATCH /api/games/:id/state — emergency host state repair, only when
// ALLOW_STATE_REPAIR=true (never in production).
router.patch('/:id/state', requireAuth, (req, res) => {
    if (!config.allowStateRepair) return res.status(404).json({ error: 'State repair disabled' });
    const { game_state, action_type, expected_version } = req.body;
    res.json(repairGameState({
        gameId: req.params.id,
        actorUserId: req.userId,
        gameState: game_state,
        actionType: action_type,
        expectedVersion: expected_version,
    }));
});

// GET /api/games/:id/events — get recent events
router.get('/:id/events', requireAuth, requireMember, (req, res) => {
    const events = db.prepare(`
        SELECT * FROM game_events WHERE game_id = ?
        ORDER BY created_at DESC LIMIT 100
    `).all(req.params.id);

    res.json(events.map(e => ({ ...e, event_data: JSON.parse(e.event_data) })));
});

module.exports = router;
