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
const { createInitialGame, normalizeState, validateStateInvariants } = require('./gameRulesInternal/state');
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
    calculateCorporationShareValue,
    validateStateInvariants,
    applyCardEffect,
    shuffleDeck,
    findNearestType,
    GameRuleError,
    JAIL_CARD_ASSET_ID,
    LOAN_TERMS: loans.LOAN_TERMS,
    DEFAULT_LOAN_RATES: loans.DEFAULT_LOAN_RATES,
    MAX_LOAN_RATE: loans.MAX_LOAN_RATE,
    validateLoanRates: loans.validateLoanRates,
};
