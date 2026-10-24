'use strict';

// Public game-rules API. Everything outside backend/domain/gameRulesInternal
// imports from here (scripts/check-architecture.js enforces it).
//
// The rules live in gameRulesInternal/, one module per topic, each importing
// only the ones listed before it:
//   board, util, loans, corporateFinance → ledger → corporations →
//   bankruptcy, movement, auctions, debt, trades → corporationManagement →
//   turns → state → applyAction
// loans.js and corporateFinance.js are pure maths (loan terms and schedules,
// share splits); the other modules move the cash. applyAction is the only
// function that changes game state.

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
const loans = require('./gameRulesInternal/loans');
const { calculateRent, calculateNetWorth, calculateCorporationShareValue } = require('./gameRulesInternal/ledger');
const { applyCardEffect } = require('./gameRulesInternal/movement');
const {
    createInitialGame,
    normalizeState,
    validateStateInvariants,
    validateRepairedState,
} = require('./gameRulesInternal/state');
const { applyAction, ACTION_TYPES } = require('./gameRulesInternal/applyAction');

module.exports = {
    MONOPOLY_PROPERTIES,
    BOARD_SQUARES,
    HOUSE_COSTS,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    createInitialGame,
    normalizeState,
    applyAction,
    ACTION_TYPES,
    calculateRent,
    calculateNetWorth,
    calculateCorporationShareValue,
    validateStateInvariants,
    validateRepairedState,
    applyCardEffect,
    shuffleDeck,
    findNearestType,
    GameRuleError,
    JAIL_CARD_ASSET_ID,
    MIN_LOAN_TERM: loans.MIN_LOAN_TERM,
    MAX_LOAN_TERM: loans.MAX_LOAN_TERM,
    DEFAULT_LOAN_RATE: loans.DEFAULT_LOAN_RATE,
    MAX_LOAN_RATE: loans.MAX_LOAN_RATE,
    AUTOPAY_MODES: loans.AUTOPAY_MODES,
    validateLoanRate: loans.validateLoanRate,
};
