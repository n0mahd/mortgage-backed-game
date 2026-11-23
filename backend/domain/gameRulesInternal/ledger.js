// Money and ownership: per-turn cash flow, rent, net worth, corporation
// valuation, and moving properties between owners.

const { HOUSE_COSTS } = require('./board');
const { GameRuleError } = require('./util');

// A colour group with buildings moves into an LLC whole.
function requireWholeBuiltGroups(state, propertyIds, destination) {
    const colors = new Set(propertyIds.map(id => state.properties.find(p => p.id === id)?.color).filter(Boolean));
    colors.forEach(color => {
        if (!groupHasBuildings(state, color)) return;
        const missing = state.properties.filter(p => p.color === color && !propertyIds.includes(p.id));
        if (missing.length) {
            throw new GameRuleError(400, `The ${color} group has buildings, so ${destination} must take the whole group. Also select ${missing.map(p => p.name).join(' and ')}.`);
        }
    });
}

function calculateRent(state, propertyId, diceTotal) {
    const property = state.properties.find(p => p.id === propertyId);
    if (!property || !property.ownerId) return 0;
    if (property.color === 'Railroad') {
        const owned = state.properties.filter(p => p.color === 'Railroad' && p.ownerId === property.ownerId).length;
        return property.rent[Math.max(0, owned - 1)];
    }
    if (property.color === 'Utility') {
        const owned = state.properties.filter(p => p.color === 'Utility' && p.ownerId === property.ownerId).length;
        return diceTotal * (owned === 2 ? 10 : 4);
    }
    if (property.houses > 0) return property.rent[property.houses];
    const colorGroup = state.properties.filter(p => p.color === property.color);
    const monopoly = colorGroup.length > 0 && colorGroup.every(p => p.ownerId === property.ownerId);
    return monopoly ? property.rent[0] * 2 : property.rent[0];
}

function calculateRentForLanding(state, propertyId, diceTotal, options = {}) {
    const property = state.properties.find(p => p.id === propertyId);
    if (!property || !property.ownerId) return 0;
    if (property.color === 'Utility' && options.utilityMultiplier) {
        return diceTotal * Number(options.utilityMultiplier || 0);
    }
    return calculateRent(state, propertyId, diceTotal) * Number(options.rentMultiplier || 1);
}

// A property's value: list price plus what its houses cost.
function propertyWorth(prop) {
    return prop.price + (prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0);
}

function calculateNetWorth(state, playerId) {
    const player = state.players.find(p => p.userId === playerId);
    if (!player) return 0;
    const propertyValue = state.properties
        .filter(p => p.ownerId === player.userId)
        .reduce((sum, prop) => sum + propertyWorth(prop), 0);
    const corpValue = state.corporations.reduce((sum, corp) => {
        const holding = (corp.shareholders || []).find(s => s.userId === player.userId);
        return sum + ((holding ? holding.shares : 0) * calculateCorporationShareValue(state, corp));
    }, 0);
    const debtTotal = player.debts.reduce((sum, debt) => sum + Number(debt.principal || 0), 0);
    return player.cash + propertyValue + corpValue - debtTotal;
}

function calculateCorporationAssetValue(state, corp) {
    const assetIds = new Set((corp.assets || []).map(asset => asset.id));
    const propertyValue = state.properties
        .filter(prop => prop.ownerId === corp.id)
        .reduce((sum, prop) => {
            assetIds.delete(prop.id);
            return sum + propertyWorth(prop);
        }, 0);
    const fallbackAssetValue = (corp.assets || [])
        .filter(asset => assetIds.has(asset.id))
        .reduce((sum, asset) => sum + Number(asset.value || 0), 0);
    return propertyValue + fallbackAssetValue;
}

function calculateCorporationDebtValue(corp) {
    return (corp.debts || []).reduce((sum, debt) => sum + Number(debt.principal || 0), 0);
}

function calculateCorporationNetAssetValue(state, corp) {
    if (corp.insolvent) return 0;
    return calculateCorporationAssetValue(state, corp) + Number(corp.cash || 0) - calculateCorporationDebtValue(corp);
}

function calculateCorporationShareValue(state, corp) {
    const totalShares = Number(corp.totalShares || 0);
    if (totalShares <= 0) return 0;
    return Math.max(0, calculateCorporationNetAssetValue(state, corp)) / totalShares;
}

function ensureCashFlow(state, entityId) {
    if (!entityId) return null;
    state.turnCashFlow = state.turnCashFlow && typeof state.turnCashFlow === 'object' ? state.turnCashFlow : {};
    if (!state.turnCashFlow[entityId]) {
        state.turnCashFlow[entityId] = { paid: 0, received: 0, receivedBetweenTurns: 0 };
    }
    return state.turnCashFlow[entityId];
}

function resetCashFlow(state, entityId) {
    if (!entityId) return;
    state.turnCashFlow = state.turnCashFlow && typeof state.turnCashFlow === 'object' ? state.turnCashFlow : {};
    state.turnCashFlow[entityId] = { paid: 0, received: 0, receivedBetweenTurns: 0 };
}

// Every cash move, for "Since your last turn": who paid whom, how much and why.
// detail is { kind, note }: kind is one of CASH_KINDS, note says why in a few
// words ("Rent: Bob landed on Boardwalk"). Entries carry the turn number they
// happened on; turnStarts says when each player's last two turns began.
const CASH_KINDS = [
    'rent', 'rent_share', 'pass_go', 'card', 'tax', 'jail', 'purchase', 'houses', 'auction',
    'shares', 'dividend', 'company_cash', 'property_sale', 'loan', 'loan_payment', 'trade',
    'payment', 'debt', 'merger',
];
const CASH_LEDGER_LIMIT = 400;

function cashAccountName(state, id) {
    if (!id) return null;
    const player = state.players.find(p => p.userId === id);
    if (player) return player.name;
    const corp = (state.corporations || []).find(c => c.id === id);
    return corp ? `[${corp.ticker}]` : null;
}

function recordCashFlow(state, fromEntityId, toEntityId, amount, detail = {}) {
    const value = Number(amount || 0);
    if (!value) return;
    const activePlayer = state.players[state.currentPlayerIndex];
    if (fromEntityId) {
        const fromFlow = ensureCashFlow(state, fromEntityId);
        fromFlow.paid += value;
    }
    if (toEntityId) {
        const toFlow = ensureCashFlow(state, toEntityId);
        toFlow.received += value;
        if (!activePlayer || activePlayer.userId !== toEntityId) {
            toFlow.receivedBetweenTurns += value;
        }
    }
    state.cashLedgerSeq = Number(state.cashLedgerSeq || 0) + 1;
    state.cashLedger = Array.isArray(state.cashLedger) ? state.cashLedger : [];
    state.cashLedger.push({
        seq: state.cashLedgerSeq,
        turn: Number(state.turnNumber || 0),
        at: new Date().toISOString(),
        amount: Math.round(value * 100) / 100,
        fromId: fromEntityId || null,
        fromName: cashAccountName(state, fromEntityId),
        toId: toEntityId || null,
        toName: cashAccountName(state, toEntityId),
        kind: CASH_KINDS.includes(detail.kind) ? detail.kind : 'payment',
        note: detail.note ? String(detail.note) : '',
    });
    if (state.cashLedger.length > CASH_LEDGER_LIMIT) state.cashLedger = state.cashLedger.slice(-CASH_LEDGER_LIMIT);
}

// A new turn begins: count it, remember when this player's last two turns
// began, and drop ledger entries older than every active player's previous turn.
function startLedgerTurn(state, player) {
    state.turnNumber = Number(state.turnNumber || 0) + 1;
    state.turnStarts = state.turnStarts && typeof state.turnStarts === 'object' ? state.turnStarts : {};
    const last = state.turnStarts[player.userId];
    state.turnStarts[player.userId] = { previous: last ? last.current : null, current: state.turnNumber };
    const oldestNeeded = state.players
        .filter(p => !p.bankrupt)
        .map(p => state.turnStarts[p.userId]?.previous ?? 0)
        .reduce((min, turn) => Math.min(min, turn), Infinity);
    if (Array.isArray(state.cashLedger) && Number.isFinite(oldestNeeded)) {
        state.cashLedger = state.cashLedger.filter(entry => entry.turn >= oldestNeeded);
    }
}

function transferProperties(state, from, to, ids) {
    ids.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== from.userId) throw new GameRuleError(400, 'Can only transfer owned property');
        prop.ownerId = to.userId;
        prop.ownerName = to.name;
    });
}

function validatePropertyTransferList(state, from, ids) {
    ids.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== from.userId) throw new GameRuleError(400, 'Can only transfer owned property');
        if (groupHasBuildings(state, prop.color)) {
            throw new GameRuleError(400, `${prop.name} is in the ${prop.color} group, which has buildings. A built group can't be traded; put the whole group into an IPO and sell shares instead.`);
        }
    });
}

// A colour group with any houses or hotels stays together: none of its streets
// can change hands by trade, and an IPO must take the whole group.
function groupHasBuildings(state, color) {
    if (!HOUSE_COSTS[color]) return false;
    return state.properties.some(p => p.color === color && Number(p.houses || 0) > 0);
}

function ownsCompleteGroup(state, userId, color) {
    if (!HOUSE_COSTS[color]) return false;
    const group = state.properties.filter(p => p.color === color);
    return group.length > 0 && group.every(p => p.ownerId === userId);
}

module.exports = {
    propertyWorth,
    requireWholeBuiltGroups,
    calculateRent,
    calculateRentForLanding,
    calculateNetWorth,
    calculateCorporationAssetValue,
    calculateCorporationNetAssetValue,
    calculateCorporationShareValue,
    ensureCashFlow,
    resetCashFlow,
    recordCashFlow,
    startLedgerTurn,
    CASH_KINDS,
    transferProperties,
    validatePropertyTransferList,
    groupHasBuildings,
    ownsCompleteGroup,
};
