// Small helpers shared by every rules module: the error type, event and log
// entries, input validation, money rounding, and date/id normalization.

// Doubles leave diceRolled false so the player can roll again, but they have still
// landed; lastDiceRoll is cleared when a turn ends or a Jail fine/card is used.
function hasMovedThisTurn(state, player) {
    return !!player.diceRolled || Array.isArray(state.lastDiceRoll);
}

function uniqueIds(ids) {
    if (!Array.isArray(ids)) return [];
    const seen = new Set();
    return ids
        .map(id => String(id || '').trim())
        .filter(id => {
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
}

function requireHost(options, actorUserId) {
    if (!options.hostId || options.hostId !== actorUserId) throw new GameRuleError(403, 'Not the host');
}

// When something created now with this timeout expires (at least 1 second).
function expiresAfter(timeoutMs, date = new Date()) {
    return new Date(date.getTime() + Math.max(Number(timeoutMs || 0), 1000)).toISOString();
}

function isExpired(item) {
    if (!item?.expiresAt) return false;
    const expiresAt = new Date(item.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

// Records who closed an auction or offer, and when.
function markResolved(item, actor, at = new Date().toISOString()) {
    item.resolvedAt = at;
    item.resolvedById = actor.userId;
    item.resolvedByName = actor.name;
}

function makeEvent(player, type, data) {
    return { type, playerId: player ? player.userId : null, data: data || {} };
}

function log(state, message) {
    state.gameLog.push({ timestamp: new Date().toISOString(), message });
    state.gameLog = state.gameLog.slice(-100);
}

// Money players type is kept in whole cents, so the log and the cash always agree.
function roundCents(value) {
    return Math.round(Number(value) * 100) / 100;
}

// Field names as players see them, for refusal messages shown in the game.
const AMOUNT_LABELS = {
    amount: 'The amount',
    bid: 'Your bid',
    player1Cash: 'The cash offered',
    player2Cash: 'The cash asked for',
    interestRate: 'The interest rate',
};

function positiveNumber(value, name) {
    const number = roundCents(value);
    if (!Number.isFinite(number) || number <= 0) throw new GameRuleError(400, `${AMOUNT_LABELS[name] || name} must be more than $0.`);
    return number;
}

function nonNegativeNumber(value, name) {
    const number = roundCents(value);
    if (!Number.isFinite(number) || number < 0) throw new GameRuleError(400, `${AMOUNT_LABELS[name] || name} can't be negative.`);
    return number;
}

function positiveInt(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new GameRuleError(400, `${name} must be a positive integer`);
    return number;
}

function cleanText(value, fallback, maxLength = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
}

function normalizeDate(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeDateString(value) {
    return normalizeDate(value).toISOString();
}

function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
}

class GameRuleError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

module.exports = {
    expiresAfter,
    isExpired,
    markResolved,
    hasMovedThisTurn,
    uniqueIds,
    requireHost,
    makeEvent,
    log,
    roundCents,
    positiveNumber,
    nonNegativeNumber,
    positiveInt,
    cleanText,
    normalizeDate,
    normalizeDateString,
    structuredCloneSafe,
    GameRuleError,
};
