// Game state shape: the initial game, normalizing saved state, derived
// portfolios, and invariants checked after every action.

const loans = require('./loans');
const { normalizeRentPolicy } = require('./corporateFinance');
const {
    MONOPOLY_PROPERTIES,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    shuffleDeck,
} = require('./board');
const {
    expiresAfter,
    normalizeDate,
    normalizeDateString,
    structuredCloneSafe,
    GameRuleError,
} = require('./util');
const {
    propertyWorth,
    calculateCorporationNetAssetValue,
    calculateCorporationShareValue,
    ensureCashFlow,
} = require('./ledger');
const { normalizeCorporationShareLedger, getSaleableShares } = require('./corporations');
const { normalizeBankruptcyClaims } = require('./bankruptcy');
const { normalizeAuction } = require('./auctions');
const { borrowingCapacity } = require('./debt');
const { normalizeRentPolicyVote } = require('./corporationManagement');
const { normalizePauseState } = require('./turns');

function createInitialGame(roomMembers, options = {}) {
    const { rates: loanRates, error } = loans.validateLoanRates(options.loanRates);
    if (error) throw new GameRuleError(400, error);
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
        settings: { loanRates, passGoAmount: 200, startingCash: 1500 },
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
        corp.debts = Array.isArray(corp.debts) ? corp.debts.map(loans.normalizeDebt) : [];
        corp.chairmanVotes = Array.isArray(corp.chairmanVotes) ? corp.chairmanVotes : [];
        corp.cash = Number(corp.cash || 0);
        corp.totalShares = Math.max(0, Math.floor(Number(corp.totalShares || 0)));
        // IPOs used to set a price per share; treasury shares now sell at NAV.
        delete corp.pricePerShare;
        corp.treasuryShares = Math.max(0, Math.floor(Number(corp.treasuryShares || 0)));
        corp.insolvent = !!corp.insolvent || corp.status === 'insolvent';
        corp.status = corp.insolvent ? 'insolvent' : (corp.status || 'active');
        corp.availableShares = Math.max(0, Math.floor(Number(corp.availableShares ?? corp.totalShares ?? 0)));
        corp.rentPolicy = normalizeRentPolicy(corp.rentPolicy);
        corp.rentPolicyLockedTurns = Math.max(0, Math.floor(Number(corp.rentPolicyLockedTurns || 0)));
        corp.rentPolicyLockSkipsTurnOf = corp.rentPolicyLockSkipsTurnOf || null;
        corp.rentPolicyVote = normalizeRentPolicyVote(corp.rentPolicyVote);
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
        auctionTimeoutMs: 120000,
        tradeOfferTimeoutMs: 600000,
        ...(state.settings || {}),
    };
    state.settings.loanRates = loans.normalizeLoanRates(state.settings.loanRates);
    delete state.settings.interestRate;
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
    // Keep every pending property offer and the most recent resolved ones.
    const propertyOffers = Array.isArray(state.propertyOffers) ? state.propertyOffers : [];
    const resolvedOffers = propertyOffers.filter(offer => offer.status !== 'pending').slice(-30);
    state.propertyOffers = propertyOffers.filter(offer => offer.status === 'pending' || resolvedOffers.includes(offer));
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
        player.debts = Array.isArray(player.debts) ? player.debts.map(loans.normalizeDebt) : [];
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
    for (const debt of [...state.players, ...state.corporations].flatMap(account => account.debts || [])) {
        if (!(Number(debt.principal) >= 0)) return 'Invalid loan balance';
        if (!Number.isInteger(debt.turnsRemaining) || debt.turnsRemaining < 1 || debt.turnsRemaining > debt.termTurns) return 'Invalid loan term';
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
    [...state.players, ...state.corporations].forEach(account => (account.debts || []).forEach(debt => {
        debt.nextPayment = loans.scheduledPayment(debt);
    }));
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
    // Shown on the Debt page and to agents: { bookValue, owed, limit, available }.
    state.players.forEach(player => { player.borrowing = borrowingCapacity(state, player); });
    state.corporations.forEach(corp => { corp.borrowing = corp.insolvent ? null : borrowingCapacity(state, corp); });
}

module.exports = {
    createInitialGame,
    normalizeState,
    validateStateInvariants,
    syncDerivedPortfolios,
};
