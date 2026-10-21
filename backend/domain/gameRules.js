'use strict';

// Public game-rules API. Everything outside backend/domain/gameRulesInternal
// imports from here (scripts/check-architecture.js enforces it).
//
// The rules live in gameRulesInternal/, one module per topic, each importing
// only the ones listed before it:
//   board, util → ledger → corporations → bankruptcy, movement, auctions, debt,
//   trades → turns → state → applyAction
// applyAction is the only function that changes game state.

const {
    MONOPOLY_PROPERTIES,
    BOARD_SQUARES,
    HOUSE_COSTS,
    JAIL_CARD_ASSET_ID,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    shuffleDeck,
    findNearestType,
} = require('./gameRulesInternal/board');
const { GameRuleError } = require('./gameRulesInternal/util');
const { calculateRent, calculateNetWorth } = require('./gameRulesInternal/ledger');
const { applyCardEffect } = require('./gameRulesInternal/movement');
const {
    createInitialGame,
    normalizeState,
    validateRepairedState,
} = require('./gameRulesInternal/state');
const { applyAction } = require('./gameRulesInternal/applyAction');

module.exports = {
    MONOPOLY_PROPERTIES,
    BOARD_SQUARES,
    HOUSE_COSTS,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    createInitialGame,
    normalizeState,
    applyAction,
    calculateRent,
    calculateNetWorth,
    validateRepairedState,
    applyCardEffect,
    shuffleDeck,
    findNearestType,
    GameRuleError,
    JAIL_CARD_ASSET_ID,
};
