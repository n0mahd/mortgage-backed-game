const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { getConfig } = require('../config');
const { createRateLimiter, getRequestActorKey } = require('../rateLimit');
const {
    parseGame,
    startGameForRoom,
    applyGameAction,
    publishGameUpdate,
} = require('../services/gameActions');
const { canViewRoom } = require('../services/rooms');
const {
    normalizeState,
    GameRuleError,
    MONOPOLY_PROPERTIES,
    BOARD_SQUARES,
    HOUSE_COSTS,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
} = require('../domain/gameRules');

module.exports = (io) => {
const router = express.Router();
const config = getConfig();
const gameActionRateLimit = createRateLimiter({
    name: 'game_action',
    ...config.rateLimits.gameAction,
    keyGenerator: req => `${req.params.id}:${getRequestActorKey(req)}`,
});

function validateStateShape(beforeState, afterState) {
    if (!afterState || !Array.isArray(afterState.players) || !Array.isArray(afterState.properties)) {
        return 'Invalid game state shape';
    }

    const beforePlayerIds = (beforeState.players || []).map(player => player.userId).sort();
    const afterPlayerIds = afterState.players.map(player => player.userId).sort();
    if (JSON.stringify(beforePlayerIds) !== JSON.stringify(afterPlayerIds)) {
        return 'Player list cannot be changed by state patch';
    }

    const beforePropertyIds = (beforeState.properties || []).map(prop => prop.id).sort();
    const afterPropertyIds = afterState.properties.map(prop => prop.id).sort();
    if (JSON.stringify(beforePropertyIds) !== JSON.stringify(afterPropertyIds)) {
        return 'Property list cannot be changed by state patch';
    }

    const playerPropertyIds = new Set();
    const propertyOwners = new Map(afterState.properties.map(prop => [prop.id, prop.ownerId]));
    for (const player of afterState.players) {
        if (!Array.isArray(player.properties) || !Array.isArray(player.corporations) || !Array.isArray(player.debts)) {
            return 'Invalid player portfolio shape';
        }
        for (const prop of player.properties) {
            if (playerPropertyIds.has(prop.id)) return 'Property duplicated across players';
            playerPropertyIds.add(prop.id);
            if (propertyOwners.get(prop.id) !== player.userId) {
                return 'Player property ownership does not match master property owner';
            }
        }
    }

    for (const corp of afterState.corporations || []) {
        const shares = (corp.shareholders || []).reduce((sum, shareholder) => sum + Number(shareholder.shares || 0), 0);
        if (shares > Number(corp.totalShares || 0)) return 'Corporation shareholders exceed total shares';
        for (const asset of corp.assets || []) {
            if (propertyOwners.get(asset.id) !== corp.id) return 'Corporation asset ownership does not match master property owner';
            if (playerPropertyIds.has(asset.id)) return 'Corporation asset is also held by a player';
        }
    }

    return null;
}

function requireMember(req, res, next) {
    const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canViewRoom(game.room_id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    next();
}

// GET /api/games/config — authoritative board/config data
router.get('/config', (_req, res) => {
    res.json({ properties: MONOPOLY_PROPERTIES, board: BOARD_SQUARES, houseCosts: HOUSE_COSTS, chanceCards: CHANCE_CARDS, communityChestCards: COMMUNITY_CHEST_CARDS });
});

// POST /api/games — create a new game for a room
router.post('/', requireAuth, (req, res) => {
    const { room_id, game_state, settings } = req.body;
    try {
        res.json(startGameForRoom(io, { roomId: room_id, actorUserId: req.userId, gameState: game_state, settings }));
    } catch (err) {
        if (err instanceof GameRuleError) return res.status(err.status).json({ error: err.message });
        throw err;
    }
});

// GET /api/games/by-room/:roomId
router.get('/by-room/:roomId', requireAuth, (req, res) => {
    const game = db.prepare(`SELECT * FROM games WHERE room_id = ?`).get(req.params.roomId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canViewRoom(game.room_id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    res.json(parseGame(game));
});

// GET /api/games/:id
router.get('/:id', requireAuth, (req, res) => {
    const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canViewRoom(game.room_id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    res.json(parseGame(game));
});

// POST /api/games/:id/actions — authoritative game action
router.post('/:id/actions', requireAuth, requireMember, gameActionRateLimit, (req, res) => {
    const { actionId, type, payload, expectedVersion } = req.body;
    try {
        res.json(applyGameAction(io, {
            gameId: req.params.id,
            actorUserId: req.userId,
            actionId,
            type,
            payload,
            expectedVersion,
            requestBody: req.body,
        }));
    } catch (err) {
        if (err instanceof GameRuleError) {
            const body = err.status === 409
                ? { error: err.message, state_version: err.stateVersion }
                : { error: err.message };
            return res.status(err.status).json(body);
        }
        throw err;
    }
});

// PATCH /api/games/:id/state — emergency host state repair only
router.patch('/:id/state', requireAuth, (req, res) => {
    if (!config.allowStateRepair) return res.status(404).json({ error: 'State repair disabled' });
    const { game_state, action_type, expected_version } = req.body;
    if (!game_state) return res.status(400).json({ error: 'game_state required' });
    if (typeof expected_version !== 'number') return res.status(400).json({ error: 'expected_version required' });

    const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canViewRoom(game.room_id, req.userId)) return res.status(403).json({ error: 'Not a room member' });
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(game.room_id);
    if (!room || room.host_id !== req.userId) return res.status(403).json({ error: 'Not the host' });
    if (game.state_version !== expected_version) {
        return res.status(409).json({ error: 'Stale game state', state_version: game.state_version });
    }

    const beforeState = JSON.parse(game.game_state);
    const shapeError = validateStateShape(beforeState, game_state);
    if (shapeError) return res.status(400).json({ error: shapeError });
    if (action_type !== 'host_state_repair') return res.status(400).json({ error: 'Only host_state_repair is allowed' });
    const repairedState = normalizeState(game_state);

    db.prepare(`
        UPDATE games
        SET game_state = ?, state_version = state_version + 1, updated_at = datetime('now')
        WHERE id = ?
    `).run(JSON.stringify(repairedState), req.params.id);

    const updatedGame = db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id);
    publishGameUpdate(io, updatedGame);

    res.json(parseGame(updatedGame));
});

// GET /api/games/:id/events — get recent events
router.get('/:id/events', requireAuth, requireMember, (req, res) => {
    const events = db.prepare(`
        SELECT * FROM game_events WHERE game_id = ?
        ORDER BY created_at DESC LIMIT 100
    `).all(req.params.id);

    res.json(events.map(e => ({ ...e, event_data: JSON.parse(e.event_data) })));
});

    return router;
};
