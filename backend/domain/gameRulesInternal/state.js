// Game state shape: the initial game, normalizing saved state, derived
// portfolios, and invariants checked after every action.

const {
    MONOPOLY_PROPERTIES,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    shuffleDeck,
} = require('./board');
const { expiresAfter, normalizeDate, normalizeDateString, structuredCloneSafe } = require('./util');
const {
    propertyWorth,
    calculateCorporationNetAssetValue,
    calculateCorporationShareValue,
    ensureCashFlow,
} = require('./ledger');
const { normalizeCorporationShareLedger, getSaleableShares } = require('./corporations');
const { normalizeBankruptcyClaims } = require('./bankruptcy');
const { normalizeAuction } = require('./auctions');
const { normalizePauseState } = require('./turns');

function createInitialGame(roomMembers) {
    const players = roomMembers.map(member => ({
        userId: member.user_id,
        name: member.player_name,
        cash: 1500,
        position: 0,
        bankrupt: false,
        inJail: false,
        jailTurns: 0,
        hasGetOutOfJailCard: false,
        doubleCount: 0,
        diceRolled: false,
        properties: [],
        corporations: [],
        debts: [],
    }));
    return normalizeState({
        players,
        currentPlayerIndex: 0,
        properties: MONOPOLY_PROPERTIES.map((prop, i) => ({
            ...prop,
            id: `prop-${i}`,
            ownerId: null,
            ownerName: null,
            houses: 0,
        })),
        corporations: [],
        gameLog: [],
        settings: { interestRate: 5, passGoAmount: 200, startingCash: 1500 },
        chanceCards: shuffleDeck(CHANCE_CARDS),
        communityChestCards: shuffleDeck(COMMUNITY_CHEST_CARDS),
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
        standings: null,
    });
}

function normalizeState(raw) {
    const state = structuredCloneSafe(raw || {});
    state.players = Array.isArray(state.players) ? state.players : [];
    state.properties = Array.isArray(state.properties) && state.properties.length > 0
        ? state.properties.map((prop, i) => ({ ...prop, id: prop.id || `prop-${i}`, houses: Number(prop.houses || 0) }))
        : MONOPOLY_PROPERTIES.map((prop, i) => ({ ...prop, id: `prop-${i}`, ownerId: null, ownerName: null, houses: 0 }));
    state.corporations = Array.isArray(state.corporations) ? state.corporations : [];
    state.corporations.forEach(corp => {
        corp.shareholders = Array.isArray(corp.shareholders) ? corp.shareholders : [];
        corp.assets = Array.isArray(corp.assets) ? corp.assets : [];
        corp.debts = Array.isArray(corp.debts) ? corp.debts : [];
        corp.chairmanVotes = Array.isArray(corp.chairmanVotes) ? corp.chairmanVotes : [];
        corp.cash = Number(corp.cash || 0);
        corp.totalShares = Math.max(0, Math.floor(Number(corp.totalShares || 0)));
        corp.pricePerShare = Number(corp.pricePerShare || 0);
        corp.treasuryShares = Math.max(0, Math.floor(Number(corp.treasuryShares || 0)));
        corp.insolvent = !!corp.insolvent || corp.status === 'insolvent';
        corp.status = corp.insolvent ? 'insolvent' : (corp.status || 'active');
        corp.availableShares = Math.max(0, Math.floor(Number(corp.availableShares ?? corp.totalShares ?? 0)));
        if (corp.insolvent) {
            corp.chairmanId = corp.chairmanId || null;
            corp.chairmanName = corp.chairmanName || null;
        } else {
            corp.chairmanId = corp.chairmanId || corp.founderId || null;
            corp.chairmanName = corp.chairmanName || corp.founderName || null;
        }
        normalizeCorporationShareLedger(state, corp);
    });
    state.gameLog = Array.isArray(state.gameLog) ? state.gameLog.slice(-100) : [];
    state.settings = {
        passGoAmount: 200,
        startingCash: 1500,
        interestRate: 5,
        auctionTimeoutMs: 120000,
        tradeOfferTimeoutMs: 600000,
        ...(state.settings || {}),
    };
    state.paused = !!state.paused;
    state.pause = state.paused ? normalizePauseState(state.pause) : null;
    state.pauseHistory = Array.isArray(state.pauseHistory) ? state.pauseHistory.slice(-20) : [];
    state.marketOffers = Array.isArray(state.marketOffers)
        ? state.marketOffers.map(offer => ({
            ...offer,
            player1Cash: Number(offer.player1Cash || 0),
            player2Cash: Number(offer.player2Cash || 0),
            player1AssetIds: Array.isArray(offer.player1AssetIds) ? offer.player1AssetIds : [],
            player2AssetIds: Array.isArray(offer.player2AssetIds) ? offer.player2AssetIds : [],
            status: offer.status || 'pending',
            createdAt: normalizeDateString(offer.createdAt),
            expiresAt: offer.expiresAt || ((offer.status || 'pending') === 'pending'
                ? expiresAfter(state.settings.tradeOfferTimeoutMs, normalizeDate(offer.createdAt))
                : null),
        }))
        : [];
    state.auction = normalizeAuction(state.auction);
    state.bankruptcyClaims = normalizeBankruptcyClaims(state.bankruptcyClaims);
    state.turnCashFlow = state.turnCashFlow && typeof state.turnCashFlow === 'object' ? state.turnCashFlow : {};
    state.chanceCards = Array.isArray(state.chanceCards) && state.chanceCards.length ? state.chanceCards : shuffleDeck(CHANCE_CARDS);
    state.communityChestCards = Array.isArray(state.communityChestCards) && state.communityChestCards.length ? state.communityChestCards : shuffleDeck(COMMUNITY_CHEST_CARDS);
    state.currentPlayerIndex = Number.isInteger(state.currentPlayerIndex) ? state.currentPlayerIndex : 0;
    state.players.forEach(player => {
        player.cash = Number(player.cash || 0);
        player.position = Number(player.position || 0);
        player.properties = Array.isArray(player.properties) ? player.properties : [];
        player.corporations = Array.isArray(player.corporations) ? player.corporations : [];
        player.debts = Array.isArray(player.debts) ? player.debts : [];
        player.bankrupt = !!player.bankrupt;
        player.inJail = !!player.inJail;
        player.jailTurns = Number(player.jailTurns || 0);
        player.doubleCount = Number(player.doubleCount || 0);
        player.diceRolled = !!player.diceRolled;
        player.hasGetOutOfJailCard = !!player.hasGetOutOfJailCard;
        ensureCashFlow(state, player.userId);
    });
    syncDerivedPortfolios(state);
    return state;
}

function validateStateInvariants(state) {
    if (!Array.isArray(state.players) || state.players.length === 0) return 'Game must have players';
    if (state.currentPlayerIndex < 0 || state.currentPlayerIndex >= state.players.length) return 'Invalid current player index';
    const userIds = new Set();
    for (const player of state.players) {
        if (!player.userId || userIds.has(player.userId)) return 'Invalid duplicate player';
        userIds.add(player.userId);
        if (!Array.isArray(player.debts)) return 'Invalid debts';
        if (player.cash == null || Number.isNaN(Number(player.cash))) return 'Invalid cash';
    }
    const propIds = new Set();
    for (const prop of state.properties) {
        if (!prop.id || propIds.has(prop.id)) return 'Invalid duplicate property';
        propIds.add(prop.id);
        if (prop.houses < 0 || prop.houses > 5) return 'Illegal house count';
    }
    for (const corp of state.corporations) {
        const shares = (corp.shareholders || []).reduce((sum, s) => sum + Number(s.shares || 0), 0);
        const treasuryShares = Number(corp.treasuryShares || 0);
        if (shares + treasuryShares > corp.totalShares) return 'Corporation shareholders exceed total shares';
        if (!corp.insolvent && shares + treasuryShares !== Number(corp.totalShares || 0)) return 'Corporation share ledger does not match total shares';
        if (corp.availableShares < 0 || corp.availableShares > corp.totalShares) return 'Invalid available shares';
        if (treasuryShares < 0 || treasuryShares > corp.totalShares) return 'Invalid treasury shares';
        if (corp.availableShares > getSaleableShares(corp)) return 'Listed shares exceed saleable shares';
    }
    if (state.auction?.status === 'open') {
        const prop = state.properties.find(item => item.id === state.auction.propertyId);
        if (!prop || prop.ownerId) return 'Invalid open auction property';
        if (state.auction.highBidderId && !userIds.has(state.auction.highBidderId)) return 'Invalid open auction bidder';
        if (Number(state.auction.currentBid || 0) < 0) return 'Invalid open auction bid';
    }
    return null;
}

function syncDerivedPortfolios(state) {
    state.players.forEach(player => {
        player.properties = state.properties
            .filter(prop => prop.ownerId === player.userId)
            .map(prop => ({
                id: prop.id,
                name: prop.name,
                color: prop.color,
                value: propertyWorth(prop),
            }));
        player.corporations = state.corporations
            .map(corp => {
                const holder = (corp.shareholders || []).find(s => s.userId === player.userId);
                const isChairman = corp.chairmanId === player.userId;
                const isFounder = corp.founderId === player.userId;
                const netAssetValue = calculateCorporationNetAssetValue(state, corp);
                const shareValue = calculateCorporationShareValue(state, corp);
                return holder || isChairman || isFounder ? {
                    id: corp.id,
                    ticker: corp.ticker,
                    sharesOwned: holder ? holder.shares : 0,
                    totalShares: corp.totalShares,
                    pricePerShare: corp.pricePerShare,
                    shareValue,
                    netAssetValue,
                    availableShares: Number(corp.availableShares || 0),
                    treasuryShares: Number(corp.treasuryShares || 0),
                    status: corp.status || 'active',
                    insolvent: !!corp.insolvent,
                    role: isChairman ? 'Chairman' : (isFounder ? 'Founder' : 'Shareholder'),
                } : null;
            })
            .filter(Boolean);
    });
}

// Checks a whole state sent for host repair (PATCH /api/games/:id/state) keeps
// the same players and properties and a consistent ownership. Returns an
// error message or null.
function validateRepairedState(beforeState, afterState) {
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

module.exports = {
    validateRepairedState,
    createInitialGame,
    normalizeState,
    validateStateInvariants,
    syncDerivedPortfolios,
};
