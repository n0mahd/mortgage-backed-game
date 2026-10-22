const { v4: uuidv4 } = require('uuid');
const loans = require('./loans');
const {
    DEFAULT_CORPORATION_SHARES,
    MAX_CORPORATION_SHARES,
    RENT_POLICY_COOLDOWN_TURNS,
    normalizeRentPolicy,
    splitByShares,
    shareholderRentDue,
    sharesForPrice,
} = require('./corporateFinance');

const MONOPOLY_PROPERTIES = [
    { name: 'Mediterranean Avenue', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250] },
    { name: 'Baltic Avenue', color: 'Brown', price: 60, rent: [4, 20, 60, 180, 320, 450] },
    { name: 'Oriental Avenue', color: 'Light Blue', price: 100, rent: [6, 30, 90, 270, 400, 550] },
    { name: 'Vermont Avenue', color: 'Light Blue', price: 100, rent: [6, 30, 90, 270, 400, 550] },
    { name: 'Connecticut Avenue', color: 'Light Blue', price: 120, rent: [8, 40, 100, 300, 450, 600] },
    { name: 'St. Charles Place', color: 'Pink', price: 140, rent: [10, 50, 150, 450, 625, 750] },
    { name: 'Electric Company', color: 'Utility', price: 150, rent: [4, 10] },
    { name: 'States Avenue', color: 'Pink', price: 140, rent: [10, 50, 150, 450, 625, 750] },
    { name: 'Virginia Avenue', color: 'Pink', price: 160, rent: [12, 60, 180, 500, 700, 900] },
    { name: 'Reading Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
    { name: 'St. James Place', color: 'Orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
    { name: 'Tennessee Avenue', color: 'Orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
    { name: 'New York Avenue', color: 'Orange', price: 200, rent: [16, 80, 220, 600, 800, 1000] },
    { name: 'Kentucky Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
    { name: 'Indiana Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
    { name: 'Illinois Avenue', color: 'Red', price: 240, rent: [20, 100, 300, 750, 925, 1100] },
    { name: 'Pennsylvania Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
    { name: 'Atlantic Avenue', color: 'Yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
    { name: 'Ventnor Avenue', color: 'Yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
    { name: 'Water Works', color: 'Utility', price: 150, rent: [4, 10] },
    { name: 'Marvin Gardens', color: 'Yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200] },
    { name: 'Pacific Avenue', color: 'Green', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    { name: 'North Carolina Avenue', color: 'Green', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    { name: 'Pennsylvania Avenue', color: 'Green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
    { name: 'Short Line', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
    { name: 'Park Place', color: 'Dark Blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    { name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
    { name: 'B. & O. Railroad', color: 'Railroad', price: 200, rent: [25, 50, 100, 200] },
];

const BOARD_SQUARES = [
    { position: 0, name: 'GO', type: 'go', propertyId: null, taxAmount: 0 },
    { position: 1, name: 'Mediterranean Ave', type: 'property', propertyId: 'prop-0', taxAmount: 0 },
    { position: 2, name: 'Community Chest', type: 'community_chest', propertyId: null, taxAmount: 0 },
    { position: 3, name: 'Baltic Ave', type: 'property', propertyId: 'prop-1', taxAmount: 0 },
    { position: 4, name: 'Income Tax', type: 'tax', propertyId: null, taxAmount: 200 },
    { position: 5, name: 'Reading Railroad', type: 'railroad', propertyId: 'prop-9', taxAmount: 0 },
    { position: 6, name: 'Oriental Ave', type: 'property', propertyId: 'prop-2', taxAmount: 0 },
    { position: 7, name: 'Chance', type: 'chance', propertyId: null, taxAmount: 0 },
    { position: 8, name: 'Vermont Ave', type: 'property', propertyId: 'prop-3', taxAmount: 0 },
    { position: 9, name: 'Connecticut Ave', type: 'property', propertyId: 'prop-4', taxAmount: 0 },
    { position: 10, name: 'Jail / Just Visiting', type: 'jail', propertyId: null, taxAmount: 0 },
    { position: 11, name: 'St. Charles Pl.', type: 'property', propertyId: 'prop-5', taxAmount: 0 },
    { position: 12, name: 'Electric Company', type: 'utility', propertyId: 'prop-6', taxAmount: 0 },
    { position: 13, name: 'States Ave', type: 'property', propertyId: 'prop-7', taxAmount: 0 },
    { position: 14, name: 'Virginia Ave', type: 'property', propertyId: 'prop-8', taxAmount: 0 },
    { position: 15, name: 'Pennsylvania RR', type: 'railroad', propertyId: 'prop-16', taxAmount: 0 },
    { position: 16, name: 'St. James Place', type: 'property', propertyId: 'prop-10', taxAmount: 0 },
    { position: 17, name: 'Community Chest', type: 'community_chest', propertyId: null, taxAmount: 0 },
    { position: 18, name: 'Tennessee Ave', type: 'property', propertyId: 'prop-11', taxAmount: 0 },
    { position: 19, name: 'New York Ave', type: 'property', propertyId: 'prop-12', taxAmount: 0 },
    { position: 20, name: 'Free Parking', type: 'free_parking', propertyId: null, taxAmount: 0 },
    { position: 21, name: 'Kentucky Ave', type: 'property', propertyId: 'prop-13', taxAmount: 0 },
    { position: 22, name: 'Chance', type: 'chance', propertyId: null, taxAmount: 0 },
    { position: 23, name: 'Indiana Ave', type: 'property', propertyId: 'prop-14', taxAmount: 0 },
    { position: 24, name: 'Illinois Ave', type: 'property', propertyId: 'prop-15', taxAmount: 0 },
    { position: 25, name: 'B.&O. Railroad', type: 'railroad', propertyId: 'prop-27', taxAmount: 0 },
    { position: 26, name: 'Atlantic Ave', type: 'property', propertyId: 'prop-17', taxAmount: 0 },
    { position: 27, name: 'Ventnor Ave', type: 'property', propertyId: 'prop-18', taxAmount: 0 },
    { position: 28, name: 'Water Works', type: 'utility', propertyId: 'prop-19', taxAmount: 0 },
    { position: 29, name: 'Marvin Gardens', type: 'property', propertyId: 'prop-20', taxAmount: 0 },
    { position: 30, name: 'Go to Jail', type: 'go_to_jail', propertyId: null, taxAmount: 0 },
    { position: 31, name: 'Pacific Ave', type: 'property', propertyId: 'prop-21', taxAmount: 0 },
    { position: 32, name: 'N. Carolina Ave', type: 'property', propertyId: 'prop-22', taxAmount: 0 },
    { position: 33, name: 'Community Chest', type: 'community_chest', propertyId: null, taxAmount: 0 },
    { position: 34, name: 'Pennsylvania Ave', type: 'property', propertyId: 'prop-23', taxAmount: 0 },
    { position: 35, name: 'Short Line RR', type: 'railroad', propertyId: 'prop-24', taxAmount: 0 },
    { position: 36, name: 'Chance', type: 'chance', propertyId: null, taxAmount: 0 },
    { position: 37, name: 'Park Place', type: 'property', propertyId: 'prop-25', taxAmount: 0 },
    { position: 38, name: 'Luxury Tax', type: 'tax', propertyId: null, taxAmount: 100 },
    { position: 39, name: 'Boardwalk', type: 'property', propertyId: 'prop-26', taxAmount: 0 },
];

const HOUSE_COSTS = {
    Brown: 50, 'Light Blue': 50, Pink: 100, Orange: 100,
    Red: 150, Yellow: 150, Green: 200, 'Dark Blue': 200,
};

const JAIL_FINE_AMOUNT = 50;
const JAIL_CARD_ASSET_ID = 'get-out-of-jail-free';

const CHANCE_CARDS = [
    { id: 'ch-1', text: 'Advance to GO. Collect $200.', action: { type: 'advance_to', position: 0 } },
    { id: 'ch-2', text: 'Advance to Illinois Ave.', action: { type: 'advance_to', position: 24 } },
    { id: 'ch-3', text: 'Advance to St. Charles Place.', action: { type: 'advance_to', position: 11 } },
    { id: 'ch-4', text: 'Advance to nearest Utility. If owned, pay 10x your dice roll.', action: { type: 'advance_nearest', nearestType: 'utility', utilityMultiplier: 10 } },
    { id: 'ch-5', text: 'Advance to nearest Railroad. Pay owner twice the normal rent.', action: { type: 'advance_nearest', nearestType: 'railroad', rentMultiplier: 2 } },
    { id: 'ch-6', text: 'Bank pays you a dividend of $50.', action: { type: 'collect', amount: 50 } },
    { id: 'ch-7', text: 'Get Out of Jail Free.', action: { type: 'get_out_of_jail' } },
    { id: 'ch-8', text: 'Go Back 3 Spaces.', action: { type: 'back_3' } },
    { id: 'ch-9', text: 'Go to Jail. Do not pass GO.', action: { type: 'go_to_jail' } },
    { id: 'ch-10', text: 'Make general repairs - $25 per house, $100 per hotel.', action: { type: 'repairs', perHouse: 25, perHotel: 100 } },
    { id: 'ch-11', text: 'Pay a poor tax of $15.', action: { type: 'pay', amount: 15 } },
    { id: 'ch-12', text: 'Take a trip to Reading Railroad.', action: { type: 'advance_to', position: 5 } },
    { id: 'ch-13', text: 'Take a walk on the Boardwalk.', action: { type: 'advance_to', position: 39 } },
    { id: 'ch-14', text: 'You have been elected Chairman of the Board - pay each player $50.', action: { type: 'pay_to_each', amount: 50 } },
    { id: 'ch-15', text: 'Your building and loan matures - collect $150.', action: { type: 'collect', amount: 150 } },
    { id: 'ch-16', text: 'You have won a crossword competition - collect $100.', action: { type: 'collect', amount: 100 } },
];

const COMMUNITY_CHEST_CARDS = [
    { id: 'cc-1', text: 'Advance to GO. Collect $200.', action: { type: 'advance_to', position: 0 } },
    { id: 'cc-2', text: 'Bank error in your favor - collect $200.', action: { type: 'collect', amount: 200 } },
    { id: 'cc-3', text: "Doctor's fee - pay $50.", action: { type: 'pay', amount: 50 } },
    { id: 'cc-4', text: 'From sale of stock - collect $50.', action: { type: 'collect', amount: 50 } },
    { id: 'cc-5', text: 'Get Out of Jail Free.', action: { type: 'get_out_of_jail' } },
    { id: 'cc-6', text: 'Go to Jail. Do not pass GO.', action: { type: 'go_to_jail' } },
    { id: 'cc-7', text: 'Grand Opera Night - collect $50 from every other player.', action: { type: 'collect_from_each', amount: 50 } },
    { id: 'cc-8', text: 'Holiday fund matures - collect $100.', action: { type: 'collect', amount: 100 } },
    { id: 'cc-9', text: 'Income tax refund - collect $20.', action: { type: 'collect', amount: 20 } },
    { id: 'cc-10', text: 'It is your birthday - collect $10 from every other player.', action: { type: 'collect_from_each', amount: 10 } },
    { id: 'cc-11', text: 'Life insurance matures - collect $100.', action: { type: 'collect', amount: 100 } },
    { id: 'cc-12', text: 'Pay hospital fees of $100.', action: { type: 'pay', amount: 100 } },
    { id: 'cc-13', text: 'Pay school fees of $150.', action: { type: 'pay', amount: 150 } },
    { id: 'cc-14', text: 'Receive $25 consultancy fee.', action: { type: 'collect', amount: 25 } },
    { id: 'cc-15', text: 'You are assessed for street repairs - $40 per house, $115 per hotel.', action: { type: 'repairs', perHouse: 40, perHotel: 115 } },
    { id: 'cc-16', text: 'You have won second prize in a beauty contest - collect $10.', action: { type: 'collect', amount: 10 } },
];

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
                ? tradeOfferExpiryFrom(state, normalizeDate(offer.createdAt))
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

function applyAction(inputState, actorUserId, action, options = {}) {
    const state = normalizeState(inputState);
    const events = [];
    const hostControlTypes = new Set(['host_end_game', 'host_pause_game', 'host_resume_game', 'host_cancel_auction', 'host_cancel_trade_offer']);
    // A host who only watches (no seat) still runs the host controls.
    const actor = state.players.find(player => player.userId === actorUserId)
        || (options.hostId && options.hostId === actorUserId && hostControlTypes.has(action.type) ? { userId: actorUserId, name: 'Host' } : null);
    if (!actor) throw new GameRuleError(403, 'Actor is not a player in this game');
    if (state.ended && action.type !== 'host_end_game') throw new GameRuleError(400, 'Game has already ended');
    if (actor.bankrupt && !hostControlTypes.has(action.type)) throw new GameRuleError(403, 'Bankrupt player cannot act');
    const pauseAllowedActionTypes = new Set(['host_pause_game', 'host_resume_game', 'host_end_game', 'host_cancel_auction', 'host_cancel_trade_offer']);
    if (state.paused && !pauseAllowedActionTypes.has(action.type)) throw new GameRuleError(400, 'Game is paused');
    const expiredAuction = expireOpenAuctionIfNeeded(state, actor, events);
    const expiredAuctionActionTypes = new Set(['place_bid', 'pass_auction', 'host_cancel_auction']);
    if (expiredAuction && expiredAuctionActionTypes.has(action.type)) {
        if (action.type === 'host_cancel_auction') requireHost(options, actorUserId);
        syncDerivedPortfolios(state);
        const invariant = validateStateInvariants(state);
        if (invariant) throw new GameRuleError(400, invariant);
        return { state, events };
    }
    const tradeOfferResolutionTypes = new Set(['accept_trade', 'cancel_trade', 'host_cancel_trade_offer']);
    if (tradeOfferResolutionTypes.has(action.type)) {
        const expiredTradeOfferIds = expirePendingTradeOffersIfNeeded(state, actor, events);
        if (expiredTradeOfferIds.has((action.payload || {}).offerId)) {
            if (action.type === 'host_cancel_trade_offer') requireHost(options, actorUserId);
            syncDerivedPortfolios(state);
            const invariant = validateStateInvariants(state);
            if (invariant) throw new GameRuleError(400, invariant);
            return { state, events };
        }
    }
    const auctionActionTypes = new Set(['start_auction', 'place_bid', 'pass_auction', 'host_cancel_auction', 'host_pause_game', 'host_resume_game', 'host_end_game']);
    if (state.auction?.status === 'open' && !auctionActionTypes.has(action.type)) {
        throw new GameRuleError(400, 'Resolve auction before other actions');
    }

    const currentPlayer = state.players[state.currentPlayerIndex];
    const requireTurn = () => {
        if (!currentPlayer || currentPlayer.userId !== actorUserId) {
            throw new GameRuleError(403, 'Not the current player');
        }
    };

    switch (action.type) {
        case 'roll_dice':
            requireTurn();
            rollDice(state, actor, events, options);
            break;
        case 'pay_jail_fine':
            requireTurn();
            payJailFine(state, actor, events);
            break;
        case 'use_get_out_of_jail_card':
            requireTurn();
            useGetOutOfJailCard(state, actor, events);
            break;
        case 'buy_property':
            requireTurn();
            buyProperty(state, actor, action.payload || {}, events);
            break;
        case 'start_auction':
            requireTurn();
            startAuction(state, actor, events);
            break;
        case 'place_bid':
            placeAuctionBid(state, actor, action.payload || {}, events);
            break;
        case 'pass_auction':
            passAuction(state, actor, events);
            break;
        case 'host_cancel_auction':
            requireHost(options, actorUserId);
            hostCancelAuction(state, actor, events);
            break;
        case 'end_turn':
            requireTurn();
            endTurn(state, actor, events);
            break;
        case 'create_ipo':
            requireTurn();
            createIPO(state, actor, action.payload || {}, events);
            break;
        case 'add_to_corporation':
            requireTurn();
            addToCorporation(state, actor, action.payload || {}, events);
            break;
        case 'buy_shares':
            requireTurn();
            buyShares(state, actor, action.payload || {}, events);
            break;
        case 'set_rent_policy':
            requireTurn();
            setRentPolicy(state, actor, action.payload || {}, events);
            break;
        case 'propose_rent_policy_change':
            proposeRentPolicyChange(state, actor, action.payload || {}, events);
            break;
        case 'vote_rent_policy_change':
            voteRentPolicyChange(state, actor, action.payload || {}, events);
            break;
        case 'pay_dividend':
            requireTurn();
            payDividend(state, actor, action.payload || {}, events);
            break;
        case 'offer_property_to_corporation':
            offerPropertyToCorporation(state, actor, action.payload || {}, events);
            break;
        case 'respond_property_offer':
            respondPropertyOffer(state, actor, action.payload || {}, events);
            break;
        case 'change_chairman':
            changeChairman(state, actor, action.payload || {}, events);
            break;
        case 'propose_chairman_vote':
            proposeChairmanVote(state, actor, action.payload || {}, events);
            break;
        case 'support_chairman_vote':
            supportChairmanVote(state, actor, action.payload || {}, events);
            break;
        case 'issue_debt':
            requireTurn();
            issueDebt(state, actor, action.payload || {}, events);
            break;
        case 'pay_debt':
            requireTurn();
            payDebt(state, actor, action.payload || {}, events);
            break;
        case 'refinance_debt':
            requireTurn();
            refinanceDebt(state, actor, action.payload || {}, events);
            break;
        case 'set_debt_autopay':
            setDebtAutopay(state, actor, action.payload || {}, events);
            break;
        case 'buy_houses':
            requireTurn();
            buyHouses(state, actor, action.payload || {}, events);
            break;
        case 'propose_trade':
            proposeTrade(state, actor, action.payload || {}, events);
            break;
        case 'accept_trade':
            acceptTrade(state, actor, action.payload || {}, events);
            break;
        case 'cancel_trade':
            cancelTrade(state, actor, action.payload || {}, events);
            break;
        case 'host_cancel_trade_offer':
            requireHost(options, actorUserId);
            hostCancelTradeOffer(state, actor, action.payload || {}, events);
            break;
        case 'host_pause_game':
            requireHost(options, actorUserId);
            pauseGame(state, actor, action.payload || {}, events);
            break;
        case 'host_resume_game':
            requireHost(options, actorUserId);
            resumeGame(state, actor, events);
            break;
        case 'trade':
            trade(state, actor, action.payload || {}, events);
            break;
        case 'manual_payment':
            manualPayment(state, actor, action.payload || {}, events);
            break;
        case 'host_end_game':
            requireHost(options, actorUserId);
            finishGame(state, 'Host ended the game.', events);
            break;
        case 'start_game':
            events.push(makeEvent(actor, 'game_started', { player_count: state.players.length }));
            break;
        default:
            throw new GameRuleError(400, 'Unknown action type');
    }

    if (!tradeOfferResolutionTypes.has(action.type)) {
        expirePendingTradeOffersIfNeeded(state, actor, events);
    }
    expirePendingPropertyOffers(state, actor, events);

    syncDerivedPortfolios(state);
    const invariant = validateStateInvariants(state);
    if (invariant) throw new GameRuleError(400, invariant);
    return { state, events };
}

function rollDice(state, player, events, options) {
    if (player.diceRolled) throw new GameRuleError(400, 'Dice already rolled this turn');
    state.lastCardDrawn = null;
    const [die1, die2] = Array.isArray(options.dice) ? options.dice : [randomDie(), randomDie()];
    const total = die1 + die2;
    const isDoubles = die1 === die2;
    const wasInJail = player.inJail;
    state.lastDiceRoll = [die1, die2];

    if (!wasInJail && isDoubles) {
        player.doubleCount += 1;
        if (player.doubleCount >= 3) {
            sendToJail(player);
            player.diceRolled = true;
            log(state, `${player.name} rolled doubles 3 times - sent to Jail!`);
            events.push(makeEvent(player, 'dice_roll', { player: player.name, die1, die2, total, isDoubles, sentToJail: true }));
            return;
        }
    } else if (!wasInJail) {
        player.doubleCount = 0;
    }

    if (wasInJail) {
        if (isDoubles) {
            releaseFromJail(player);
            log(state, `${player.name} rolled doubles and left Jail.`);
        } else {
            player.jailTurns += 1;
            if (player.jailTurns >= 3) {
                player.cash -= JAIL_FINE_AMOUNT;
                recordCashFlow(state, player.userId, null, JAIL_FINE_AMOUNT);
                releaseFromJail(player);
                events.push(makeEvent(player, 'forced_payment', { from: player.name, to: 'the Bank', amount: JAIL_FINE_AMOUNT, reason: 'Jail bail' }));
                log(state, `${player.name} paid $${JAIL_FINE_AMOUNT} bail after their third Jail turn.`);
            } else {
                player.diceRolled = true;
                log(state, `${player.name} is in Jail (turn ${player.jailTurns}/3). Rolled ${die1}+${die2}.`);
                events.push(makeEvent(player, 'dice_roll', { player: player.name, die1, die2, total, isDoubles, inJail: true }));
                return;
            }
        }
    }

    movePlayer(state, player, total, events);
    if (!isDoubles || wasInJail) player.diceRolled = true;
    if (wasInJail) player.doubleCount = 0;
    const square = BOARD_SQUARES[player.position];
    const canRollAgain = isDoubles && !wasInJail;
    log(state, `${player.name} rolled ${die1}+${die2}=${total} - moved to ${square.name}${canRollAgain ? ' (doubles - roll again!)' : ''}`);
    events.push(makeEvent(player, 'dice_roll', { player: player.name, die1, die2, total, isDoubles, square: square.name, jailReleased: wasInJail }));
    processLanding(state, player, square, total, events);
}

function payJailFine(state, player, events) {
    requireJailExitChoice(player);
    state.lastDiceRoll = null;
    player.cash -= JAIL_FINE_AMOUNT;
    recordCashFlow(state, player.userId, null, JAIL_FINE_AMOUNT);
    releaseFromJail(player);
    events.push(makeEvent(player, 'jail_fine_paid', { player: player.name, amount: JAIL_FINE_AMOUNT }));
    log(state, `${player.name} paid $${JAIL_FINE_AMOUNT} to leave Jail.`);
}

function useGetOutOfJailCard(state, player, events) {
    requireJailExitChoice(player);
    if (!player.hasGetOutOfJailCard) throw new GameRuleError(400, 'No Get Out of Jail Free card available');
    state.lastDiceRoll = null;
    player.hasGetOutOfJailCard = false;
    releaseFromJail(player);
    events.push(makeEvent(player, 'jail_card_used', { player: player.name }));
    log(state, `${player.name} used a Get Out of Jail Free card.`);
}

function requireJailExitChoice(player) {
    if (!player.inJail) throw new GameRuleError(400, 'Player is not in Jail');
    if (player.diceRolled) throw new GameRuleError(400, 'Jail choice must be made before rolling');
}

function movePlayer(state, player, spaces, events) {
    const oldPos = player.position || 0;
    const newPos = (oldPos + spaces) % 40;
    if (newPos < oldPos) {
        const amount = state.settings.passGoAmount || 200;
        player.cash += amount;
        recordCashFlow(state, null, player.userId, amount);
        events.push(makeEvent(player, 'pass_go', { player: player.name, amount }));
        log(state, `${player.name} passed GO - collected $${amount}!`);
    }
    player.position = newPos;
}

function processLanding(state, player, square, diceTotal, events, options = {}) {
    if (!square) return;
    if (['property', 'railroad', 'utility'].includes(square.type)) {
        const prop = state.properties.find(p => p.id === square.propertyId);
        if (!prop || !prop.ownerId || prop.ownerId === player.userId) return;
        const owner = state.players.find(p => p.userId === prop.ownerId);
        const corporationOwner = owner ? null : state.corporations.find(corp => corp.id === prop.ownerId);
        if (!owner && !corporationOwner) return;
        if (owner && owner.bankrupt) return;
        if (corporationOwner && corporationOwner.insolvent) return;
        const fullRent = calculateRentForLanding(state, prop.id, diceTotal, options);
        if (owner) {
            payCreditorAvailableCash(state, player, { type: 'player', id: owner.userId, name: owner.name, entity: owner },
                fullRent, `Rent for ${square.name}`, events, { propertyId: prop.id, propertyName: prop.name });
            return;
        }
        payCorporationRent(state, player, corporationOwner, prop, `Rent for ${square.name}`, fullRent, events);
        return;
    }
    if (square.type === 'tax') {
        player.cash -= square.taxAmount;
        recordCashFlow(state, player.userId, null, square.taxAmount);
        events.push(makeEvent(player, 'tax_payment', { from: player.name, to: 'the Bank', amount: square.taxAmount, reason: square.name }));
        log(state, `${player.name} paid $${square.taxAmount} to the Bank for ${square.name}`);
        return;
    }
    if (square.type === 'chance') drawCard(state, player, 'chance', events);
    if (square.type === 'community_chest') drawCard(state, player, 'community_chest', events);
    if (square.type === 'go_to_jail') {
        sendToJail(player);
        player.diceRolled = true;
        log(state, `${player.name} landed on Go to Jail!`);
    }
}

function drawCard(state, player, deckType, events) {
    const key = deckType === 'chance' ? 'chanceCards' : 'communityChestCards';
    const source = deckType === 'chance' ? CHANCE_CARDS : COMMUNITY_CHEST_CARDS;
    if (!state[key] || state[key].length === 0) state[key] = shuffleDeck(source);
    const card = state[key].shift();
    const before = snapshotCardState(state, player);
    applyCardEffect(state, player, card, events);
    const effect = summarizeCardEffect(before, state, player);
    state.lastCardDrawn = {
        id: card.id,
        deckType,
        playerId: player.userId,
        playerName: player.name,
        card: card.text,
        effect,
        drawnAt: new Date().toISOString(),
    };
    events.push(makeEvent(player, 'card_draw', { player: player.name, deckType, card: card.text, effect }));
}

function applyCardEffect(state, player, card, events) {
    const action = card.action;
    switch (action.type) {
        case 'advance_to': {
            const old = player.position;
            player.position = action.position;
            if (action.position < old || (action.position === 0 && old !== 0)) {
                player.cash += state.settings.passGoAmount || 200;
                recordCashFlow(state, null, player.userId, state.settings.passGoAmount || 200);
            }
            processLanding(state, player, BOARD_SQUARES[player.position], state.lastDiceRoll ? state.lastDiceRoll[0] + state.lastDiceRoll[1] : 0, events);
            break;
        }
        case 'advance_nearest': {
            const nearest = findNearestType(player.position, action.nearestType);
            if (nearest < player.position) {
                player.cash += state.settings.passGoAmount || 200;
                recordCashFlow(state, null, player.userId, state.settings.passGoAmount || 200);
            }
            player.position = nearest;
            processLanding(state, player, BOARD_SQUARES[player.position], state.lastDiceRoll ? state.lastDiceRoll[0] + state.lastDiceRoll[1] : 0, events, {
                rentMultiplier: action.rentMultiplier || 1,
                utilityMultiplier: action.utilityMultiplier || (action.nearestType === 'utility' ? 10 : null),
            });
            break;
        }
        case 'go_to_jail':
            sendToJail(player);
            break;
        case 'back_3':
            player.position = (player.position - 3 + 40) % 40;
            processLanding(state, player, BOARD_SQUARES[player.position], state.lastDiceRoll ? state.lastDiceRoll[0] + state.lastDiceRoll[1] : 0, events);
            break;
        case 'collect':
            player.cash += action.amount;
            recordCashFlow(state, null, player.userId, action.amount);
            break;
        case 'pay':
            player.cash -= action.amount;
            recordCashFlow(state, player.userId, null, action.amount);
            break;
        case 'collect_from_each':
            state.players.forEach(other => {
                if (other.userId !== player.userId && !other.bankrupt) {
                    other.cash -= action.amount;
                    player.cash += action.amount;
                    recordCashFlow(state, other.userId, player.userId, action.amount);
                }
            });
            break;
        case 'pay_to_each':
            state.players.forEach(other => {
                if (other.userId !== player.userId && !other.bankrupt) {
                    other.cash += action.amount;
                    player.cash -= action.amount;
                    recordCashFlow(state, player.userId, other.userId, action.amount);
                }
            });
            break;
        case 'get_out_of_jail':
            player.hasGetOutOfJailCard = true;
            break;
        case 'repairs': {
            let houses = 0;
            let hotels = 0;
            state.properties.forEach(prop => {
                if (prop.ownerId === player.userId) {
                    if (prop.houses === 5) hotels += 1;
                    else houses += prop.houses || 0;
                }
            });
            const repairCost = action.perHouse * houses + action.perHotel * hotels;
            player.cash -= repairCost;
            if (repairCost > 0) recordCashFlow(state, player.userId, null, repairCost);
            break;
        }
    }
    log(state, `${player.name} drew card: ${card.text}`);
}

function snapshotCardState(state, player) {
    return {
        player: {
            cash: Number(player.cash || 0),
            position: Number(player.position || 0),
            inJail: !!player.inJail,
            hasGetOutOfJailCard: !!player.hasGetOutOfJailCard,
        },
        others: state.players
            .filter(other => other.userId !== player.userId)
            .map(other => ({ userId: other.userId, cash: Number(other.cash || 0) })),
    };
}

function summarizeCardEffect(before, state, player) {
    const parts = [];
    const cashDelta = Number(player.cash || 0) - before.player.cash;
    if (cashDelta > 0) parts.push(`collected $${cashDelta.toFixed(2)}`);
    if (cashDelta < 0) parts.push(`paid $${Math.abs(cashDelta).toFixed(2)}`);
    if (Number(player.position || 0) !== before.player.position) {
        const square = BOARD_SQUARES[player.position || 0];
        parts.push(`moved to ${square ? square.name : `position ${player.position}`}`);
    }
    if (!before.player.inJail && player.inJail) parts.push('went to Jail');
    if (!before.player.hasGetOutOfJailCard && player.hasGetOutOfJailCard) parts.push('received a Get Out of Jail Free card');

    const otherDeltas = state.players
        .filter(other => other.userId !== player.userId)
        .map(other => {
            const previous = before.others.find(item => item.userId === other.userId);
            return previous ? Number(other.cash || 0) - previous.cash : 0;
        })
        .filter(delta => delta !== 0);
    if (otherDeltas.length > 0) parts.push('affected other players');
    return parts.length ? parts.join('; ') : 'no immediate cash or position change';
}

// Doubles leave diceRolled false so the player can roll again, but they have still
// landed; lastDiceRoll is cleared when a turn ends or a Jail fine/card is used.
function hasMovedThisTurn(state, player) {
    return !!player.diceRolled || Array.isArray(state.lastDiceRoll);
}

function buyProperty(state, player, payload, events) {
    if (!hasMovedThisTurn(state, player)) throw new GameRuleError(400, 'Roll before buying a property');
    const square = BOARD_SQUARES[player.position || 0];
    if (!square || !square.propertyId) throw new GameRuleError(400, 'You are not on a property');
    const prop = state.properties.find(p => p.id === square.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Property is not available');
    if (payload.corpId) {
        buyPropertyForCorporation(state, player, runCorporation(state, player, payload.corpId), prop, events);
        return;
    }
    if (player.cash < prop.price) throw new GameRuleError(400, 'Insufficient funds');
    prop.ownerId = player.userId;
    prop.ownerName = player.name;
    player.cash -= prop.price;
    recordCashFlow(state, player.userId, null, prop.price);
    events.push(makeEvent(player, 'property_purchase', { buyer: player.name, property: prop.name, price: prop.price }));
    log(state, `${player.name} purchased ${prop.name} for $${prop.price.toFixed(2)}`);
}

function startAuction(state, player, events) {
    if (state.auction?.status === 'open') throw new GameRuleError(400, 'Auction already in progress');
    if (!hasMovedThisTurn(state, player)) throw new GameRuleError(400, 'Roll before starting an auction');
    const square = BOARD_SQUARES[player.position || 0];
    if (!square || !square.propertyId) throw new GameRuleError(400, 'You are not on a property');
    const prop = state.properties.find(p => p.id === square.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Property is not available');
    const now = new Date();
    const createdAt = now.toISOString();

    state.auction = {
        id: `auction-${uuidv4()}`,
        status: 'open',
        propertyId: prop.id,
        propertyName: prop.name,
        startedById: player.userId,
        startedByName: player.name,
        currentBid: 0,
        highBidderId: null,
        highBidderName: null,
        passedPlayerIds: [],
        createdAt,
        updatedAt: createdAt,
        expiresAt: auctionExpiryFrom(state, now),
    };
    events.push(makeEvent(player, 'property_auction_started', {
        auctionId: state.auction.id,
        property: prop.name,
        startedBy: player.name,
        expiresAt: state.auction.expiresAt,
    }));
    log(state, `${player.name} started an auction for ${prop.name}`);
}

function placeAuctionBid(state, actor, payload, events) {
    const auction = getOpenAuction(state);
    const prop = state.properties.find(p => p.id === auction.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Auction property is not available');
    if ((auction.passedPlayerIds || []).includes(actor.userId)) throw new GameRuleError(400, 'Player has already passed this auction');
    const amount = positiveNumber(payload.amount, 'bid');
    if (amount <= Number(auction.currentBid || 0)) throw new GameRuleError(400, 'Bid must exceed current bid');
    if (actor.cash < amount) throw new GameRuleError(400, 'Insufficient funds');

    auction.currentBid = amount;
    auction.highBidderId = actor.userId;
    auction.highBidderName = actor.name;
    const now = new Date();
    auction.updatedAt = now.toISOString();
    auction.expiresAt = auctionExpiryFrom(state, now);
    events.push(makeEvent(actor, 'property_auction_bid', {
        auctionId: auction.id,
        property: auction.propertyName,
        bidder: actor.name,
        amount,
        expiresAt: auction.expiresAt,
    }));
    log(state, `${actor.name} bid $${amount.toFixed(2)} for ${auction.propertyName}`);
    // If everyone else already passed, this bid wins now; nobody is left to answer it.
    settleAuctionIfComplete(state, actor, events);
}

function passAuction(state, actor, events) {
    const auction = getOpenAuction(state);
    if (auction.highBidderId === actor.userId) throw new GameRuleError(400, 'Current high bidder cannot pass');
    auction.passedPlayerIds = Array.isArray(auction.passedPlayerIds) ? auction.passedPlayerIds : [];
    if (!auction.passedPlayerIds.includes(actor.userId)) {
        auction.passedPlayerIds.push(actor.userId);
        const now = new Date();
        auction.updatedAt = now.toISOString();
        auction.expiresAt = auctionExpiryFrom(state, now);
        events.push(makeEvent(actor, 'property_auction_passed', {
            auctionId: auction.id,
            property: auction.propertyName,
            player: actor.name,
            expiresAt: auction.expiresAt,
        }));
        log(state, `${actor.name} passed on the auction for ${auction.propertyName}`);
    }
    settleAuctionIfComplete(state, actor, events);
}

function settleAuctionIfComplete(state, actor, events) {
    const auction = getOpenAuction(state);
    const activePlayers = state.players.filter(player => !player.bankrupt);
    const passed = new Set(auction.passedPlayerIds || []);
    const unresolved = activePlayers.filter(player => player.userId !== auction.highBidderId && !passed.has(player.userId));
    if (unresolved.length > 0) return;

    if (!auction.highBidderId) {
        closeAuctionNoSale(state, actor, events, 'passes');
        return;
    }

    closeAuctionSold(state, actor, events, 'passes');
}

function expireOpenAuctionIfNeeded(state, actor, events) {
    if (!state.auction || state.auction.status !== 'open') return false;
    if (!isAuctionExpired(state.auction)) return false;
    if (state.auction.highBidderId) {
        closeAuctionSold(state, actor, events, 'timeout');
    } else {
        closeAuctionNoSale(state, actor, events, 'timeout');
    }
    return true;
}

function isAuctionExpired(auction) {
    if (!auction?.expiresAt) return false;
    const expiresAt = new Date(auction.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function auctionExpiryFrom(state, date = new Date()) {
    const timeoutMs = Math.max(Number(state.settings?.auctionTimeoutMs || 0), 1000);
    return new Date(date.getTime() + timeoutMs).toISOString();
}

function tradeOfferExpiryFrom(state, date = new Date()) {
    const timeoutMs = Math.max(Number(state.settings?.tradeOfferTimeoutMs || 0), 1000);
    return new Date(date.getTime() + timeoutMs).toISOString();
}

function closeAuctionNoSale(state, actor, events, reason) {
    const auction = getOpenAuction(state);
    auction.status = 'no_sale';
    auction.closeReason = reason;
    auction.resolvedAt = new Date().toISOString();
    auction.resolvedById = actor.userId;
    auction.resolvedByName = actor.name;
    events.push(makeEvent(actor, 'property_auction_no_sale', {
        auctionId: auction.id,
        property: auction.propertyName,
        reason,
    }));
    const reasonText = reason === 'timeout' ? ' after timing out' : '';
    log(state, `Auction for ${auction.propertyName} ended with no sale${reasonText}`);
}

function closeAuctionSold(state, actor, events, reason) {
    const auction = getOpenAuction(state);
    const winner = state.players.find(player => player.userId === auction.highBidderId);
    const prop = state.properties.find(p => p.id === auction.propertyId);
    const amount = Number(auction.currentBid || 0);
    if (!winner || winner.bankrupt) throw new GameRuleError(400, 'Auction winner is not active');
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Auction property is not available');
    if (winner.cash < amount) throw new GameRuleError(400, 'Auction winner has insufficient funds');

    winner.cash -= amount;
    prop.ownerId = winner.userId;
    prop.ownerName = winner.name;
    recordCashFlow(state, winner.userId, null, amount);
    auction.status = 'sold';
    auction.closeReason = reason;
    auction.resolvedAt = new Date().toISOString();
    auction.resolvedById = actor.userId;
    auction.resolvedByName = actor.name;
    auction.winnerId = winner.userId;
    auction.winnerName = winner.name;
    auction.finalBid = amount;
    events.push(makeEvent(actor, 'property_auction_won', {
        auctionId: auction.id,
        property: auction.propertyName,
        winner: winner.name,
        amount,
        reason,
    }));
    const reasonText = reason === 'timeout' ? ' after the auction timed out' : '';
    log(state, `${winner.name} won ${auction.propertyName} at auction for $${amount.toFixed(2)}${reasonText}`);
}

function getOpenAuction(state) {
    if (!state.auction || state.auction.status !== 'open') throw new GameRuleError(404, 'Open auction not found');
    return state.auction;
}

function hostCancelAuction(state, actor, events) {
    const auction = getOpenAuction(state);
    auction.status = 'canceled';
    auction.cancelReason = 'host';
    auction.resolvedAt = new Date().toISOString();
    auction.resolvedById = actor.userId;
    auction.resolvedByName = actor.name;
    events.push(makeEvent(actor, 'property_auction_canceled', {
        auctionId: auction.id,
        property: auction.propertyName,
        actor: actor.name,
        reason: 'host',
    }));
    log(state, `${actor.name} canceled the auction for ${auction.propertyName}`);
}

function createIPO(state, player, payload, events) {
    const ticker = String(payload.ticker || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const assetIds = Array.isArray(payload.assetIds) ? payload.assetIds : [];
    const requestedShares = payload.totalShares || payload.shares;
    const totalShares = requestedShares ? positiveInt(requestedShares, 'shares') : DEFAULT_CORPORATION_SHARES;
    if (!ticker) throw new GameRuleError(400, 'Ticker is required');
    if (totalShares > DEFAULT_CORPORATION_SHARES) throw new GameRuleError(400, `Shares must be ${DEFAULT_CORPORATION_SHARES.toLocaleString('en-US')} or fewer`);
    if (state.corporations.some(c => c.ticker === ticker)) throw new GameRuleError(400, 'Ticker already exists');
    if (assetIds.length === 0) throw new GameRuleError(400, 'At least one asset is required');
    const assets = assetIds.map(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== player.userId) throw new GameRuleError(400, 'IPO assets must be owned by founder');
        return { id: prop.id, name: prop.name, value: prop.price, color: prop.color };
    });
    requireWholeBuiltGroups(state, assetIds, 'the IPO');
    const corporation = {
        id: `corp-${uuidv4()}`,
        ticker,
        name: `${ticker} Corporation`,
        founderId: player.userId,
        founderName: player.name,
        chairmanId: player.userId,
        chairmanName: player.name,
        totalShares,
        assets,
        shareholders: [{ userId: player.userId, name: player.name, shares: totalShares }],
        // Nothing is for sale at a fixed price: the founder sells by trade offers.
        availableShares: 0,
        treasuryShares: 0,
        cash: 0,
        debts: [],
        chairmanVotes: [],
        rentPolicy: normalizeRentPolicy(),
    };
    state.corporations.push(corporation);
    assets.forEach(asset => {
        const prop = state.properties.find(p => p.id === asset.id);
        prop.ownerId = corporation.id;
        prop.ownerName = `[${ticker}]`;
    });
    events.push(makeEvent(player, 'ipo_created', {
        founder: player.name,
        ticker,
        shares: totalShares,
        founderShares: totalShares,
        listedShares: totalShares,
    }));
    log(state, `${player.name} created ${ticker} IPO: ${totalShares} shares, all held by ${player.name}`);
}

// Whoever runs an LLC can put more of their own properties into it. If other
// players hold shares, the runner can take new shares priced at the current
// value per share, so the other stakes keep their value. Shares are whole,
// rounded to the nearest share, so stakes can move by up to half a share.
function addToCorporation(state, player, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, `${corp.ticker} is insolvent and cannot take property`);
    if (!controlsCorporation(corp, player.userId)) {
        throw new GameRuleError(403, `You don't run ${corp.ticker}. To put a property into it, offer it to ${corp.chairmanName || 'the chairman'} in a trade.`);
    }
    const assetIds = uniqueIds(payload.assetIds);
    if (assetIds.length === 0) throw new GameRuleError(400, `Choose a property to put into ${corp.ticker}`);
    requireNoOpenClaim(state, player, `put property into ${corp.ticker}`);
    assetIds.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== player.userId) throw new GameRuleError(400, 'You can only put in properties you own');
    });
    requireWholeBuiltGroups(state, assetIds, corp.ticker);
    const quote = corporationContributionQuote(state, corp, player.userId, assetIds);
    if (payload.issueShares === true && quote.newShares === 0) throw new GameRuleError(400, quote.noSharesReason);
    const newShares = payload.issueShares === true ? quote.newShares : 0;

    transferPropertiesToCorporation(state, player, corp, assetIds);
    // The chair stays put: the runner already chairs or holds a majority.
    if (newShares > 0) {
        corp.totalShares = Number(corp.totalShares || 0) + newShares;
        addShareholderShares(corp, player, newShares);
        normalizeCorporationShareLedger(state, corp);
    }
    const names = assetIds.map(id => state.properties.find(p => p.id === id).name);
    events.push(makeEvent(player, 'corporation_assets_added', {
        actor: player.name,
        ticker: corp.ticker,
        properties: names,
        value: quote.value,
        newShares,
        totalShares: corp.totalShares,
    }));
    const sharesNote = newShares > 0
        ? ` and received ${newShares} new share${newShares === 1 ? '' : 's'} (${corp.ticker} now has ${corp.totalShares})`
        : '';
    log(state, `${player.name} put ${names.join(', ')} into ${corp.ticker}${sharesNote}`);
}

// How many whole new shares a contribution is worth at the LLC's current value
// per share, rounded to the nearest share and kept within the share cap. The price defaults to
// the properties' book value (price plus buildings); a property offer can name
// another price. newShares is 0, with a reason, when shares can't or needn't
// be issued.
function corporationContributionQuote(state, corp, userId, assetIds, price = null) {
    const value = assetIds.reduce((sum, id) => sum + propertyBookValue(state.properties.find(p => p.id === id)), 0);
    const agreedPrice = price == null ? value : Number(price);
    const totalShares = Number(corp.totalShares || 0);
    const otherShares = totalShares - sharesFor(corp, userId);
    const netAssetValue = calculateCorporationNetAssetValue(state, corp);
    const room = Math.max(0, MAX_CORPORATION_SHARES - totalShares);
    const quote = { value, price: agreedPrice, newShares: 0, fairShares: 0, noSharesReason: null };
    if (otherShares <= 0) {
        quote.noSharesReason = `You hold every ${corp.ticker} share, so new shares would change nothing`;
    } else if (netAssetValue <= 0) {
        quote.noSharesReason = `${corp.ticker} is worth $0 or less, so new shares can't be priced`;
    } else {
        quote.fairShares = sharesForPrice(agreedPrice, totalShares, netAssetValue);
        quote.newShares = Math.min(quote.fairShares, room);
        if (room === 0) {
            quote.noSharesReason = `${corp.ticker} already has ${MAX_CORPORATION_SHARES.toLocaleString('en-US')} shares, the most allowed`;
        } else if (quote.fairShares === 0) {
            quote.noSharesReason = `That is worth less than half a ${corp.ticker} share`;
        }
    }
    return quote;
}

// Adding property never raises cash, so a player with an unpaid claim can't do
// it: the property would only move out of the creditor's reach. (An IPO stays
// open to them, since selling its shares is how a built group raises cash.)
function requireNoOpenClaim(state, player, what) {
    if (getBankruptcyClaim(state, player.userId)) {
        throw new GameRuleError(400, `You owe an unpaid claim, so you can't ${what} until it's paid`);
    }
}

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

function buyShares(state, player, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
    const shares = positiveInt(payload.shares, 'shares');
    // Only the corporation's own treasury shares are for sale. Shares a player
    // holds change hands only by a trade offer that player accepts.
    const maxShares = getSaleableShares(corp);
    if (shares > maxShares) {
        throw new GameRuleError(400, maxShares > 0
            ? `${corp.ticker} has only ${maxShares} treasury share(s) for sale`
            : `${corp.ticker} has no treasury shares for sale. To buy shares a player holds, make them an offer in the Market.`);
    }
    // Treasury shares sell at what each share is worth right now (NAV).
    const pricePerShare = roundCents(calculateCorporationShareValue(state, corp));
    if (pricePerShare <= 0) throw new GameRuleError(400, `${corp.ticker} shares are worth $0, so its treasury shares are not for sale`);
    const totalCost = roundCents(shares * pricePerShare);
    if (player.cash < totalCost) throw new GameRuleError(400, 'Insufficient funds');
    const holdersBefore = snapshotHoldings(corp);

    player.cash -= totalCost;
    corp.cash = Number(corp.cash || 0) + totalCost;
    corp.treasuryShares = Math.max(0, Number(corp.treasuryShares || 0) - shares);
    recordCashFlow(state, player.userId, corp.id, totalCost);

    addShareholderShares(corp, player, shares);
    removeZeroShareholders(corp);
    corp.availableShares = Math.max(0, Number(corp.availableShares || 0) - shares);
    normalizeCorporationShareLedger(state, corp);
    chairMajorityHolder(state, corp, holdersBefore, player, events);

    events.push(makeEvent(player, 'share_purchase', {
        buyer: player.name,
        ticker: corp.ticker,
        shares,
        pricePerShare,
        totalCost,
        treasuryShares: shares,
        treasuryProceeds: totalCost,
        seller: '[Treasury]',
    }));
    log(state, `${player.name} bought ${shares} treasury share(s) of ${corp.ticker} at $${pricePerShare.toFixed(2)} each for $${totalCost.toFixed(2)}`);
}

// ---- Running a corporation ------------------------------------------------
// The chairman (or a majority holder) runs an LLC: sets what happens to its
// rent, pays dividends, and spends the treasury on property, houses and
// trades. A runner can't move treasury cash to themselves except through a
// dividend every holder shares.

function runCorporation(state, player, corpId) {
    const corp = state.corporations.find(c => c.id === corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, `${corp.ticker} is insolvent`);
    if (!controlsCorporation(corp, player.userId)) {
        throw new GameRuleError(403, `Only ${corp.ticker}'s chairman or a majority holder can do that`);
    }
    return corp;
}

function requireTreasuryCash(corp, amount) {
    if (Number(corp.cash || 0) + 1e-9 < amount) {
        throw new GameRuleError(400, `${corp.ticker}'s treasury has $${Number(corp.cash || 0).toFixed(2)}, not enough for $${Number(amount).toFixed(2)}`);
    }
}

// Payout sends rent straight to the shareholders; Reinvest keeps it in the
// treasury. The runner changes it on their own only before they roll, so
// nobody can switch it after seeing where anyone landed, and a change then
// stays put for their next RENT_POLICY_COOLDOWN_TURNS turns. During that
// cooldown it changes only if every shareholder agrees (a policy vote).
function setRentPolicy(state, player, payload, events) {
    const corp = runCorporation(state, player, payload.corpId);
    const policy = requireRentPolicy(payload.policy);
    if (hasMovedThisTurn(state, player)) {
        throw new GameRuleError(400, `${corp.ticker}'s rent policy can only change at the start of your turn, before you roll`);
    }
    if (corp.rentPolicy === policy) throw new GameRuleError(400, `${corp.ticker} is already in ${policy} mode`);
    if (corp.rentPolicyLockedTurns > 0) {
        throw new GameRuleError(400, `${corp.ticker}'s rent policy is locked for ${corp.rentPolicyLockedTurns} more of your turns. To change it sooner, every shareholder has to agree: propose the change to them.`);
    }
    applyRentPolicy(state, corp, policy, player, events, 'chairman');
}

function requireRentPolicy(value) {
    const policy = String(value || '');
    if (!['payout', 'reinvest'].includes(policy)) throw new GameRuleError(400, "Rent policy must be 'payout' or 'reinvest'");
    return policy;
}

// rentPolicyLockedTurns counts the chairman's turns still locked. A change
// made during the chairman's own turn doesn't count that turn
// (rentPolicyLockSkipsTurnOf), so the lock always covers their next turns.
function applyRentPolicy(state, corp, policy, actor, events, method) {
    corp.rentPolicy = policy;
    corp.rentPolicyLockedTurns = RENT_POLICY_COOLDOWN_TURNS;
    const current = state.players[state.currentPlayerIndex];
    corp.rentPolicyLockSkipsTurnOf = current && current.userId === corp.chairmanId ? current.userId : null;
    corp.rentPolicyVote = null;
    events.push(makeEvent(actor, 'rent_policy_changed', { actor: actor.name, ticker: corp.ticker, policy, method, lockedTurns: RENT_POLICY_COOLDOWN_TURNS }));
    const label = policy === 'payout' ? 'Payout: rent now goes to its shareholders' : 'Reinvest: rent now stays in its treasury';
    const what = method === 'unanimous'
        ? `Every ${corp.ticker} shareholder agreed to switch ${corp.ticker} to ${label}.`
        : `${actor.name} switched ${corp.ticker} to ${label}.`;
    log(state, `${what} The chairman can't change it alone for their next ${RENT_POLICY_COOLDOWN_TURNS} turns.`);
}

// A policy vote: any shareholder proposes a switch; it happens the moment
// every current shareholder has agreed, and any one of them can reject it.
function normalizeRentPolicyVote(vote) {
    if (!vote || !['payout', 'reinvest'].includes(vote.policy)) return null;
    return {
        policy: vote.policy,
        proposedById: vote.proposedById || null,
        proposedByName: vote.proposedByName || null,
        supporterIds: Array.isArray(vote.supporterIds) ? [...new Set(vote.supporterIds.filter(Boolean))] : [],
        createdAt: vote.createdAt || new Date().toISOString(),
    };
}

function shareholderForVote(state, corp, player) {
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, `${corp.ticker} is insolvent`);
    if (sharesFor(corp, player.userId) <= 0) throw new GameRuleError(403, `Only ${corp.ticker} shareholders can vote on its rent policy`);
}

function proposeRentPolicyChange(state, player, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    shareholderForVote(state, corp, player);
    const policy = requireRentPolicy(payload.policy);
    if (corp.rentPolicy === policy) throw new GameRuleError(400, `${corp.ticker} is already in ${policy} mode`);
    corp.rentPolicyVote = {
        policy,
        proposedById: player.userId,
        proposedByName: player.name,
        supporterIds: [player.userId],
        createdAt: new Date().toISOString(),
    };
    events.push(makeEvent(player, 'rent_policy_vote_proposed', { actor: player.name, ticker: corp.ticker, policy }));
    log(state, `${player.name} proposed switching ${corp.ticker} to ${policy === 'payout' ? 'Payout' : 'Reinvest'}. It happens if every shareholder agrees.`);
    passRentPolicyVoteIfUnanimous(state, corp, player, events);
}

function voteRentPolicyChange(state, player, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    shareholderForVote(state, corp, player);
    const vote = corp.rentPolicyVote;
    if (!vote) throw new GameRuleError(404, `${corp.ticker} has no rent policy vote open`);
    if (payload.approve === false) {
        corp.rentPolicyVote = null;
        events.push(makeEvent(player, 'rent_policy_vote_rejected', { actor: player.name, ticker: corp.ticker, policy: vote.policy }));
        log(state, `${player.name} rejected switching ${corp.ticker} to ${vote.policy === 'payout' ? 'Payout' : 'Reinvest'}.`);
        return;
    }
    if (!vote.supporterIds.includes(player.userId)) vote.supporterIds.push(player.userId);
    events.push(makeEvent(player, 'rent_policy_vote_supported', { actor: player.name, ticker: corp.ticker, policy: vote.policy }));
    passRentPolicyVoteIfUnanimous(state, corp, player, events);
}

// Shareholders who still have to agree for the open vote to pass.
function rentPolicyHoldouts(state, corp) {
    const vote = corp.rentPolicyVote;
    if (!vote) return [];
    return activeShareholders(state, corp)
        .map(holder => holder.player)
        .filter(holder => !vote.supporterIds.includes(holder.userId));
}

function passRentPolicyVoteIfUnanimous(state, corp, actor, events) {
    if (rentPolicyHoldouts(state, corp).length > 0) return;
    applyRentPolicy(state, corp, corp.rentPolicyVote.policy, actor, events, 'unanimous');
}

// Splits treasury cash across the shareholders by shares held. The slice for
// shares the treasury holds itself stays in the treasury.
function payDividend(state, player, payload, events) {
    const corp = runCorporation(state, player, payload.corpId);
    const amount = roundCents(positiveNumber(payload.amount, 'amount'));
    requireTreasuryCash(corp, amount);
    const totalShares = Number(corp.totalShares || 0);
    const holders = activeShareholders(state, corp);
    if (holders.length === 0) throw new GameRuleError(400, `${corp.ticker} has no shareholders to pay`);
    const { parts } = splitByShares(amount, [
        ...holders,
        { treasury: true, shares: Math.max(0, totalShares - holders.reduce((sum, h) => sum + h.shares, 0)) },
    ]);
    const payouts = payFromTreasury(state, corp, parts.filter(part => !part.treasury));
    if (payouts.length === 0) throw new GameRuleError(400, 'That dividend is too small to pay anyone a cent');
    const paid = roundCents(payouts.reduce((sum, p) => sum + p.amount, 0));
    events.push(makeEvent(player, 'dividend_paid', { actor: player.name, ticker: corp.ticker, amount: paid, payouts }));
    log(state, `${player.name} paid a ${corp.ticker} dividend: ${describePayouts(payouts)}.`);
}

function activeShareholders(state, corp) {
    return (corp.shareholders || [])
        .map(holder => ({ player: state.players.find(p => p.userId === holder.userId && !p.bankrupt), shares: Number(holder.shares || 0) }))
        .filter(holder => holder.player && holder.shares > 0);
}

function payFromTreasury(state, corp, parts) {
    return parts.map(part => {
        corp.cash = roundCents(Number(corp.cash || 0) - part.amount);
        part.player.cash = roundCents(Number(part.player.cash || 0) + part.amount);
        recordCashFlow(state, corp.id, part.player.userId, part.amount);
        return { name: part.player.name, userId: part.player.userId, amount: part.amount };
    });
}

function describePayouts(payouts) {
    return payouts.map(p => `$${p.amount.toFixed(2)} to ${p.name}`).join(', ');
}

// In Payout mode the rent a corporation just received goes on to its
// shareholders, except the one who paid it (their slice was never charged).
// Shares the treasury holds keep their slice in the treasury.
function distributeCorporationRent(state, corp, amount, payer, events) {
    if (corp.insolvent || corp.rentPolicy !== 'payout' || !(amount > 0)) return;
    const totalShares = Number(corp.totalShares || 0);
    const holders = activeShareholders(state, corp).filter(holder => holder.player.userId !== payer.userId);
    const payerShares = sharesFor(corp, payer.userId);
    const treasuryShares = Math.max(0, totalShares - payerShares - holders.reduce((sum, h) => sum + h.shares, 0));
    const { parts } = splitByShares(amount, [...holders, { treasury: true, shares: treasuryShares }]);
    const payouts = payFromTreasury(state, corp, parts.filter(part => !part.treasury));
    if (payouts.length === 0) return;
    events.push(makeEvent(payer, 'rent_distributed', { ticker: corp.ticker, payer: payer.name, amount, payouts }));
    log(state, `${corp.ticker} passed ${payer.name}'s rent to its shareholders: ${describePayouts(payouts)}.`);
}

function buyPropertyForCorporation(state, player, corp, prop, events) {
    requireTreasuryCash(corp, prop.price);
    corp.cash = roundCents(Number(corp.cash || 0) - prop.price);
    recordCashFlow(state, corp.id, null, prop.price);
    prop.ownerId = corp.id;
    prop.ownerName = `[${corp.ticker}]`;
    addCorporationAsset(corp, prop);
    events.push(makeEvent(player, 'property_purchase', { buyer: `[${corp.ticker}]`, actor: player.name, property: prop.name, price: prop.price }));
    log(state, `${player.name} bought ${prop.name} for ${corp.ticker} for $${prop.price.toFixed(2)} from its treasury`);
}

function removeCorporationAsset(corp, propertyId) {
    corp.assets = (corp.assets || []).filter(asset => asset.id !== propertyId);
}

// Anyone who doesn't run an LLC can offer it properties, at book value or at a
// price they name, paid in new shares at the current value per share or in
// treasury cash. The runner accepts, declines or counters; a counter goes back
// to the offerer. The runner's own properties go in through add_to_corporation,
// at book value only, since nobody independent would approve their price.
function offerPropertyToCorporation(state, player, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, `${corp.ticker} is insolvent and cannot take property`);
    if (!corp.chairmanId) throw new GameRuleError(400, `${corp.ticker} has no chairman to accept an offer`);
    if (controlsCorporation(corp, player.userId)) {
        throw new GameRuleError(400, `You run ${corp.ticker}. Add your own properties with "Add properties", at book value.`);
    }
    const assetIds = uniqueIds(payload.assetIds);
    const terms = propertyOfferTerms(payload);
    const quote = validatePropertyOffer(state, corp, player, assetIds, terms);
    const now = new Date();
    const offer = {
        id: `propoffer-${uuidv4()}`,
        status: 'pending',
        corpId: corp.id,
        ticker: corp.ticker,
        offererId: player.userId,
        offererName: player.name,
        assetIds,
        priceBasis: terms.price == null ? 'book' : 'set',
        price: quote.price,
        bookValue: quote.value,
        payWith: terms.payWith,
        awaiting: 'corporation',
        createdAt: now.toISOString(),
        expiresAt: tradeOfferExpiryFrom(state, now),
    };
    state.propertyOffers.push(offer);
    events.push(makeEvent(player, 'property_offer_made', propertyOfferEventData(state, offer, player)));
    log(state, `${player.name} offered ${propertyNames(state, assetIds)} to ${corp.ticker} for $${offer.price.toFixed(2)} in ${offer.payWith === 'cash' ? 'treasury cash' : 'new shares'}`);
}

function propertyOfferTerms(payload) {
    const payWith = payload.payWith === 'cash' ? 'cash' : 'shares';
    const hasPrice = payload.price !== undefined && payload.price !== null && payload.price !== '';
    return { payWith, price: hasPrice ? roundCents(positiveNumber(payload.price, 'price')) : null };
}

// Checks a property offer can go through now and prices it. Run on the offer,
// every counter and again on acceptance, since holdings move in between.
function validatePropertyOffer(state, corp, offerer, assetIds, terms) {
    if (assetIds.length === 0) throw new GameRuleError(400, `Choose a property to offer ${corp.ticker}`);
    assetIds.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== offerer.userId) throw new GameRuleError(400, `${offerer.name} no longer owns ${prop?.name || 'that property'}`);
    });
    requireNoOpenClaim(state, offerer, `put property into ${corp.ticker}`);
    requireWholeBuiltGroups(state, assetIds, corp.ticker);
    const quote = corporationContributionQuote(state, corp, offerer.userId, assetIds, terms.price);
    if (terms.payWith === 'shares' && quote.newShares === 0) throw new GameRuleError(400, quote.noSharesReason);
    if (terms.payWith === 'cash') requireTreasuryCash(corp, quote.price);
    return quote;
}

function findPendingPropertyOffer(state, offerId) {
    const offer = (state.propertyOffers || []).find(item => item.id === offerId && item.status === 'pending');
    if (!offer) throw new GameRuleError(404, 'Pending property offer not found');
    if (isTradeOfferExpired(offer)) throw new GameRuleError(400, 'That property offer has expired');
    return offer;
}

function respondPropertyOffer(state, actor, payload, events) {
    const offer = findPendingPropertyOffer(state, payload.offerId);
    const corp = state.corporations.find(c => c.id === offer.corpId);
    const offerer = state.players.find(p => p.userId === offer.offererId);
    const isOfferer = actor.userId === offer.offererId;
    const runsCorp = !!corp && controlsCorporation(corp, actor.userId);
    if (!isOfferer && !runsCorp) throw new GameRuleError(403, `Only ${offer.offererName} or ${offer.ticker}'s chairman can answer this offer`);
    const response = String(payload.response || '');
    if (response === 'decline') {
        offer.status = isOfferer ? 'canceled' : 'declined';
        resolvePropertyOffer(offer, actor);
        events.push(makeEvent(actor, 'property_offer_closed', { ...propertyOfferEventData(state, offer, actor), status: offer.status }));
        log(state, `${actor.name} ${isOfferer ? 'withdrew' : 'declined'} the offer of ${propertyNames(state, offer.assetIds)} to ${offer.ticker}`);
        return;
    }
    const awaitingMe = offer.awaiting === 'offerer' ? isOfferer : runsCorp;
    if (!awaitingMe) throw new GameRuleError(400, `This offer is waiting for ${offer.awaiting === 'offerer' ? offer.offererName : `${offer.ticker}'s chairman`}`);
    if (!corp || corp.insolvent) throw new GameRuleError(400, `${offer.ticker} can no longer take property`);
    if (!offerer || offerer.bankrupt) throw new GameRuleError(400, `${offer.offererName} can no longer make this deal`);
    if (response === 'counter') {
        const terms = propertyOfferTerms({ price: payload.price, payWith: payload.payWith || offer.payWith });
        if (terms.price == null) throw new GameRuleError(400, 'A counter needs a price');
        const quote = validatePropertyOffer(state, corp, offerer, offer.assetIds, terms);
        offer.price = quote.price;
        offer.priceBasis = 'set';
        offer.payWith = terms.payWith;
        offer.awaiting = isOfferer ? 'corporation' : 'offerer';
        offer.expiresAt = tradeOfferExpiryFrom(state, new Date());
        events.push(makeEvent(actor, 'property_offer_countered', propertyOfferEventData(state, offer, actor)));
        log(state, `${actor.name} countered: ${propertyNames(state, offer.assetIds)} to ${offer.ticker} for $${offer.price.toFixed(2)} in ${offer.payWith === 'cash' ? 'treasury cash' : 'new shares'}`);
        return;
    }
    if (response !== 'accept') throw new GameRuleError(400, "Response must be 'accept', 'decline' or 'counter'");
    acceptPropertyOffer(state, actor, offer, corp, offerer, events);
}

function acceptPropertyOffer(state, actor, offer, corp, offerer, events) {
    // A book-value offer is repriced at today's book value; a named price stands.
    const terms = { payWith: offer.payWith, price: offer.priceBasis === 'book' ? null : offer.price };
    const quote = validatePropertyOffer(state, corp, offerer, offer.assetIds, terms);
    const holdersBefore = snapshotHoldings(corp);
    transferPropertiesToCorporation(state, offerer, corp, offer.assetIds);
    let newShares = 0;
    if (offer.payWith === 'cash') {
        corp.cash = roundCents(Number(corp.cash || 0) - quote.price);
        offerer.cash = roundCents(Number(offerer.cash || 0) + quote.price);
        recordCashFlow(state, corp.id, offerer.userId, quote.price);
    } else {
        newShares = quote.newShares;
        corp.totalShares = Number(corp.totalShares || 0) + newShares;
        addShareholderShares(corp, offerer, newShares);
        normalizeCorporationShareLedger(state, corp);
        chairMajorityHolder(state, corp, holdersBefore, offerer, events);
    }
    offer.price = quote.price;
    offer.newShares = newShares;
    offer.status = 'accepted';
    resolvePropertyOffer(offer, actor);
    events.push(makeEvent(actor, 'property_offer_accepted', { ...propertyOfferEventData(state, offer, actor), newShares, totalShares: corp.totalShares }));
    const paidWith = newShares > 0 ? `${newShares} new shares` : `$${quote.price.toFixed(2)} from the treasury`;
    log(state, `${offer.ticker} took ${propertyNames(state, offer.assetIds)} from ${offerer.name} for ${paidWith}`);
}

function resolvePropertyOffer(offer, actor) {
    offer.resolvedAt = new Date().toISOString();
    offer.resolvedById = actor.userId;
    offer.resolvedByName = actor.name;
}

function propertyOfferEventData(state, offer, actor) {
    return {
        offerId: offer.id,
        actor: actor.name,
        offerer: offer.offererName,
        ticker: offer.ticker,
        properties: offer.assetIds.map(id => state.properties.find(p => p.id === id)?.name || id),
        price: offer.price,
        payWith: offer.payWith,
        awaiting: offer.awaiting,
    };
}

function propertyNames(state, ids) {
    return ids.map(id => state.properties.find(p => p.id === id)?.name || id).join(', ');
}

function expirePendingPropertyOffers(state, actor, events) {
    (state.propertyOffers || []).forEach(offer => {
        if (offer.status !== 'pending') return;
        const corp = state.corporations.find(c => c.id === offer.corpId);
        const offerer = state.players.find(p => p.userId === offer.offererId);
        const reason = isTradeOfferExpired(offer) ? 'timeout'
            : (!corp || corp.insolvent ? 'corporation_insolvent' : (!offerer || offerer.bankrupt ? 'bankruptcy' : null));
        if (!reason) return;
        offer.status = reason === 'timeout' ? 'expired' : 'canceled';
        offer.cancelReason = reason;
        resolvePropertyOffer(offer, actor);
        events.push(makeEvent(actor, 'property_offer_closed', { ...propertyOfferEventData(state, offer, actor), status: offer.status, reason }));
    });
}

// Lenders keep a 10% equity cushion across the whole portfolio: a borrower's
// loans may total at most 90% of the book value of what they own. For a player
// that is their properties (price plus buildings) and their shares at book value
// (corporation NAV per share); for a corporation, its properties. No property is
// pledged to a particular loan. Loans made before a rule change stand.
const MAX_LOAN_TO_VALUE = 0.9;

function propertyBookValue(prop) {
    return Number(prop.price || 0) + Number(prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0);
}

function portfolioBookValue(state, borrower) {
    // A corporation's properties are valued as in its NAV.
    if (!borrower.userId) return calculateCorporationAssetValue(state, borrower);
    const propertyValue = state.properties
        .filter(prop => prop.ownerId === borrower.userId)
        .reduce((sum, prop) => sum + propertyBookValue(prop), 0);
    const shareValue = state.corporations.reduce((sum, corp) => {
        const holding = (corp.shareholders || []).find(s => s.userId === borrower.userId);
        return sum + Number(holding?.shares || 0) * calculateCorporationShareValue(state, corp);
    }, 0);
    return propertyValue + shareValue;
}

// What the borrower can still borrow; loans being refinanced don't count as owed.
function borrowingCapacity(state, borrower, exceptDebts = new Set()) {
    const bookValue = roundCents(portfolioBookValue(state, borrower));
    const owed = roundCents((borrower.debts || [])
        .filter(debt => !exceptDebts.has(debt))
        .reduce((sum, debt) => sum + Number(debt.principal || 0), 0));
    const limit = roundCents(bookValue * MAX_LOAN_TO_VALUE);
    return { bookValue, owed, limit, available: Math.max(0, roundCents(limit - owed)) };
}

function requireBorrowingCapacity(state, borrower, amount, exceptDebts) {
    const capacity = borrowingCapacity(state, borrower, exceptDebts);
    if (amount > capacity.available) {
        const owes = capacity.owed > 0 ? `, less the $${capacity.owed.toFixed(2)} already owed` : '';
        throw new GameRuleError(400, `You can borrow up to $${capacity.available.toFixed(2)}: loans can total 90% of the $${capacity.bookValue.toFixed(2)} book value of ${borrower.userId ? 'your properties and shares' : 'the corporation\'s properties'}${owes}.`);
    }
}

// The borrower picks the term; the rate for that term was set by the host when
// the game started. Without a term (older clients, agents) a loan runs 10 turns.
function loanTerms(state, payload) {
    const termTurns = payload.termTurns === undefined || payload.termTurns === null || payload.termTurns === ''
        ? loans.LEGACY_LOAN_TERM
        : Number(payload.termTurns);
    if (!loans.LOAN_TERMS.includes(termTurns)) {
        throw new GameRuleError(400, `Choose a loan term of ${loans.LOAN_TERMS.join(', ').replace(/, (\d+)$/, ' or $1')} turns.`);
    }
    return {
        termTurns,
        turnsRemaining: termTurns,
        interestRate: Number(state.settings.loanRates[termTurns]),
        autopay: payload.autopay !== false,
    };
}

function describeLoan(amount, terms) {
    return `$${amount.toFixed(2)} over ${terms.termTurns} turns at ${terms.interestRate}%${terms.autopay ? '' : ', autopay off'}`;
}

function issueDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const terms = loanTerms(state, payload);
    const { interestRate, termTurns } = terms;
    const issuerType = payload.issuerType === 'corporation' ? 'corporation' : 'player';
    if (issuerType === 'corporation') {
        const corp = state.corporations.find(c => c.id === payload.corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
        if (!canManageCorporationDebt(corp, player.userId)) {
            throw new GameRuleError(403, 'Only the chairman or controlling shareholder can issue corporation debt');
        }
        requireBorrowingCapacity(state, corp, amount);
        corp.debts.push({ id: `debt-${uuidv4()}`, principal: amount, ...terms, issueDate: new Date().toISOString(), issuerType: 'corporation' });
        corp.cash = Number(corp.cash || 0) + amount;
        recordCashFlow(state, null, corp.id, amount);
        events.push(makeEvent(player, 'debt_issued', { issuer: `[${corp.ticker}]`, actor: player.name, amount, interestRate, termTurns }));
        log(state, `${player.name} borrowed for ${corp.ticker}: ${describeLoan(amount, terms)}.`);
        return;
    }
    requireBorrowingCapacity(state, player, amount);
    player.debts.push({ id: `debt-${uuidv4()}`, principal: amount, ...terms, issueDate: new Date().toISOString(), issuerType: 'player' });
    player.cash += amount;
    recordCashFlow(state, null, player.userId, amount);
    events.push(makeEvent(player, 'debt_issued', { issuer: player.name, amount, interestRate, termTurns }));
    log(state, `${player.name} borrowed ${describeLoan(amount, terms)}.`);
}

function refinanceDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const terms = loanTerms(state, payload);
    const { interestRate, termTurns } = terms;

    const selectedDebts = resolveSelectedPlayerDebts(player, payload);
    if (!selectedDebts.length) throw new GameRuleError(400, 'Select at least one debt to refinance');

    const payoffAmount = selectedDebts.reduce((sum, debt) => {
        const principal = Number(debt.principal || 0);
        if (!Number.isFinite(principal) || principal <= 0) {
            throw new GameRuleError(400, 'Selected debts must have positive principal');
        }
        return sum + principal;
    }, 0);

    if (amount <= payoffAmount) {
        throw new GameRuleError(400, 'Refinance amount must exceed selected debt principal');
    }

    // The loans being replaced don't count against the limit for the new one.
    requireBorrowingCapacity(state, player, amount, new Set(selectedDebts));

    const refinancedFrom = selectedDebts.map(debt => ({
        id: debt.id || null,
        principal: Number(debt.principal || 0),
        interestRate: Number(debt.interestRate || 0),
    }));
    const selectedDebtSet = new Set(selectedDebts);
    player.debts = player.debts.filter(debt => !selectedDebtSet.has(debt));

    const netProceeds = amount - payoffAmount;
    player.debts.push({
        id: `debt-${uuidv4()}`,
        principal: amount,
        ...terms,
        issueDate: new Date().toISOString(),
        issuerType: 'player',
        refinancedFrom,
    });
    player.cash += netProceeds;
    recordCashFlow(state, null, player.userId, amount);
    recordCashFlow(state, player.userId, null, payoffAmount);
    events.push(makeEvent(player, 'debt_refinanced', {
        borrower: player.name,
        amount,
        payoffAmount,
        netProceeds,
        interestRate,
        termTurns,
        refinancedDebtCount: selectedDebts.length,
    }));
    log(state, `${player.name} refinanced ${selectedDebts.length} debt(s) into ${describeLoan(amount, terms)} and received $${netProceeds.toFixed(2)} net cash`);
}

function resolveSelectedPlayerDebts(player, payload) {
    const refs = [];
    if (Array.isArray(payload.debtIds)) {
        payload.debtIds.forEach(id => refs.push({ id }));
    }
    if (Array.isArray(payload.debtIndexes)) {
        payload.debtIndexes.forEach(index => refs.push({ index }));
    }
    if (payload.debtId) refs.push({ id: payload.debtId });
    if (payload.debtIndex !== undefined) refs.push({ index: payload.debtIndex });

    const selected = [];
    const seenIndexes = new Set();
    refs.forEach(ref => {
        const debt = ref.id
            ? player.debts.find(item => item.id === ref.id)
            : player.debts[Number(ref.index)];
        if (!debt) throw new GameRuleError(404, 'Debt not found');
        const index = player.debts.indexOf(debt);
        if (seenIndexes.has(index)) return;
        seenIndexes.add(index);
        selected.push(debt);
    });
    return selected;
}

function canManageCorporationDebt(corp, userId) {
    return controlsCorporation(corp, userId);
}

// The chairman or a majority holder runs an LLC: they can manage its debt and
// accept property into it.
function controlsCorporation(corp, userId) {
    if (!corp || !userId) return false;
    if (corp.insolvent) return false;
    return corp.chairmanId === userId || hasMajorityShares(corp, userId);
}

function changeChairman(state, actor, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
    if (!hasMajorityShares(corp, actor.userId)) throw new GameRuleError(403, 'Majority shares required to change chairman directly');
    const candidate = getChairmanCandidate(state, corp, payload.candidateUserId);
    setChairman(corp, candidate);
    corp.chairmanVotes = closeChairmanVotesForCandidate(corp, candidate.userId);
    events.push(makeEvent(actor, 'chairman_changed', { ticker: corp.ticker, chairman: candidate.name, method: 'majority' }));
    log(state, `${actor.name} changed ${corp.ticker} chairman to ${candidate.name} by majority control.`);
}

function proposeChairmanVote(state, actor, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
    const actorShares = sharesFor(corp, actor.userId);
    if (actorShares <= 0) throw new GameRuleError(403, 'Only shareholders can propose chairman votes');
    const candidate = getChairmanCandidate(state, corp, payload.candidateUserId);
    const existingOpen = (corp.chairmanVotes || []).find(vote => vote.status === 'open' && vote.candidateUserId === candidate.userId);
    if (existingOpen) {
        supportExistingChairmanVote(state, corp, actor, existingOpen, events);
        return;
    }
    const vote = {
        id: `vote-${uuidv4()}`,
        type: 'chairman',
        status: 'open',
        candidateUserId: candidate.userId,
        candidateName: candidate.name,
        supporters: [{ userId: actor.userId, name: actor.name }],
        createdBy: actor.userId,
        createdAt: new Date().toISOString(),
    };
    corp.chairmanVotes.push(vote);
    events.push(makeEvent(actor, 'chairman_vote_proposed', { ticker: corp.ticker, candidate: candidate.name }));
    log(state, `${actor.name} proposed ${candidate.name} for ${corp.ticker} chairman.`);
    finalizeChairmanVoteIfMajority(state, corp, vote, actor, events);
}

function supportChairmanVote(state, actor, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
    const vote = (corp.chairmanVotes || []).find(item => item.id === payload.voteId && item.status === 'open');
    if (!vote) throw new GameRuleError(404, 'Open chairman vote not found');
    supportExistingChairmanVote(state, corp, actor, vote, events);
}

function supportExistingChairmanVote(state, corp, actor, vote, events) {
    const actorShares = sharesFor(corp, actor.userId);
    if (actorShares <= 0) throw new GameRuleError(403, 'Only shareholders can support chairman votes');
    if (!vote.supporters.some(supporter => supporter.userId === actor.userId)) {
        vote.supporters.push({ userId: actor.userId, name: actor.name });
        events.push(makeEvent(actor, 'chairman_vote_supported', { ticker: corp.ticker, candidate: vote.candidateName, supporter: actor.name }));
        log(state, `${actor.name} supported ${vote.candidateName} for ${corp.ticker} chairman.`);
    }
    finalizeChairmanVoteIfMajority(state, corp, vote, actor, events);
}

function finalizeChairmanVoteIfMajority(state, corp, vote, actor, events) {
    const supportedShares = voteSupportShares(corp, vote);
    vote.supportedShares = supportedShares;
    vote.requiredShares = majorityThreshold(corp);
    if (supportedShares <= Number(corp.totalShares || 0) / 2) return;
    const candidate = getChairmanCandidate(state, corp, vote.candidateUserId);
    setChairman(corp, candidate);
    vote.status = 'passed';
    vote.passedAt = new Date().toISOString();
    corp.chairmanVotes = closeChairmanVotesForCandidate(corp, candidate.userId, vote.id);
    events.push(makeEvent(actor, 'chairman_changed', { ticker: corp.ticker, chairman: candidate.name, method: 'vote', supportedShares }));
    log(state, `${corp.ticker} shareholders elected ${candidate.name} chairman with ${supportedShares}/${corp.totalShares} shares.`);
}

function closeChairmanVotesForCandidate(corp, candidateUserId, passedVoteId = null) {
    return (corp.chairmanVotes || []).map(vote => {
        if (vote.status !== 'open') return vote;
        if (vote.id === passedVoteId) return vote;
        return {
            ...vote,
            status: vote.candidateUserId === candidateUserId ? 'passed' : 'closed',
            closedAt: new Date().toISOString(),
        };
    });
}

function getChairmanCandidate(state, corp, candidateUserId) {
    const candidate = state.players.find(player => player.userId === candidateUserId);
    if (!candidate) throw new GameRuleError(404, 'Chairman candidate not found');
    const isCurrentChairman = corp.chairmanId === candidate.userId;
    const isFounder = corp.founderId === candidate.userId;
    if (!isCurrentChairman && !isFounder && sharesFor(corp, candidate.userId) <= 0) {
        throw new GameRuleError(400, 'Chairman candidate must be a shareholder');
    }
    return candidate;
}

function setChairman(corp, candidate) {
    corp.chairmanId = candidate.userId;
    corp.chairmanName = candidate.name;
}

function hasMajorityShares(corp, userId) {
    return sharesFor(corp, userId) > Number(corp.totalShares || 0) / 2;
}

function sharesFor(corp, userId) {
    const holder = (corp.shareholders || []).find(shareholder => shareholder.userId === userId);
    return Number(holder?.shares || 0);
}

function addShareholderShares(corp, player, shares) {
    if (!player || !player.userId || shares <= 0) return null;
    corp.shareholders = Array.isArray(corp.shareholders) ? corp.shareholders : [];
    let holder = corp.shareholders.find(shareholder => shareholder.userId === player.userId);
    if (!holder) {
        holder = { userId: player.userId, name: player.name, shares: 0 };
        corp.shareholders.push(holder);
    }
    holder.name = holder.name || player.name;
    holder.shares = Number(holder.shares || 0) + shares;
    return holder;
}

function removeZeroShareholders(corp) {
    corp.shareholders = (corp.shareholders || []).filter(shareholder => Number(shareholder.shares || 0) > 0);
}

function normalizeCorporationShareLedger(state, corp) {
    corp.totalShares = Math.max(0, Math.floor(Number(corp.totalShares || 0)));
    corp.treasuryShares = Math.max(0, Math.floor(Number(corp.treasuryShares || 0)));
    corp.availableShares = Math.max(0, Math.floor(Number(corp.availableShares || 0)));
    corp.shareholders = aggregateShareholders(state, corp.shareholders || []);

    if (corp.insolvent) {
        corp.treasuryShares = 0;
        corp.availableShares = 0;
        return;
    }

    const heldShares = shareholderShareTotal(corp);
    const missingShares = Math.max(0, corp.totalShares - heldShares - corp.treasuryShares);
    if (missingShares > 0) {
        const founder = state.players.find(player => player.userId === corp.founderId && !player.bankrupt);
        if (founder) {
            addShareholderShares(corp, founder, missingShares);
        } else {
            corp.treasuryShares += missingShares;
        }
    }

    const excessTreasuryShares = Math.max(0, shareholderShareTotal(corp) + corp.treasuryShares - corp.totalShares);
    if (excessTreasuryShares > 0) {
        corp.treasuryShares = Math.max(0, corp.treasuryShares - excessTreasuryShares);
    }
    corp.availableShares = Math.min(corp.availableShares, getSaleableShares(corp));
}

function aggregateShareholders(state, shareholders) {
    const playersById = new Map((state.players || []).map(player => [player.userId, player]));
    const holdersById = new Map();
    shareholders.forEach(shareholder => {
        const userId = shareholder?.userId;
        const shares = Math.max(0, Math.floor(Number(shareholder?.shares || 0)));
        if (!userId || shares <= 0) return;
        const player = playersById.get(userId);
        const existing = holdersById.get(userId);
        if (existing) {
            existing.shares += shares;
        } else {
            holdersById.set(userId, {
                userId,
                name: shareholder.name || player?.name || 'Shareholder',
                shares,
            });
        }
    });
    return Array.from(holdersById.values());
}

function shareholderShareTotal(corp) {
    return (corp.shareholders || []).reduce((sum, shareholder) => sum + Number(shareholder.shares || 0), 0);
}

// Only treasury shares can be listed for sale; founder listings from before
// this rule are dropped when the ledger is normalized.
function getSaleableShares(corp) {
    return Number(corp.treasuryShares || 0);
}

function returnSharesToTreasury(corp, shares) {
    if (shares <= 0) return;
    const heldShares = shareholderShareTotal(corp);
    const maxTreasuryShares = Math.max(0, Number(corp.totalShares || 0) - heldShares);
    const returnedShares = Math.min(shares, maxTreasuryShares);
    corp.treasuryShares = Math.min(maxTreasuryShares, Number(corp.treasuryShares || 0) + returnedShares);
    corp.availableShares = Math.min(getSaleableShares(corp), Number(corp.availableShares || 0) + returnedShares);
}

function voteSupportShares(corp, vote) {
    return (vote.supporters || []).reduce((sum, supporter) => sum + sharesFor(corp, supporter.userId), 0);
}

function majorityThreshold(corp) {
    return Math.floor(Number(corp.totalShares || 0) / 2) + 1;
}

// A loan and the account that owes it: the player's own, or a corporation's
// that the player runs (payload.corpId).
function findBorrowerLoan(state, player, payload) {
    if (payload.corpId) {
        const corp = state.corporations.find(c => c.id === payload.corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (!canManageCorporationDebt(corp, player.userId)) {
            throw new GameRuleError(403, 'Only the chairman or controlling shareholder can manage corporation debt');
        }
        const debt = corp.debts.find(d => d.id === payload.debtId);
        if (!debt) throw new GameRuleError(404, 'Debt not found');
        return { debt, account: corp, cashFlowId: corp.id, name: corp.ticker, eventName: `[${corp.ticker}]` };
    }
    const debt = player.debts.find(d => d.id === payload.debtId) || player.debts[Number(payload.debtIndex)];
    if (!debt) throw new GameRuleError(404, 'Debt not found');
    return { debt, account: player, cashFlowId: player.userId, name: player.name, eventName: player.name };
}

function payDebt(state, player, payload, events) {
    let amount = positiveNumber(payload.amount, 'amount');
    const { debt, account, cashFlowId, name, eventName } = findBorrowerLoan(state, player, payload);
    // Paying more than is owed only settles the debt; the rest stays in cash.
    amount = Math.min(amount, roundCents(debt.principal));
    if (Number(account.cash || 0) < amount) throw new GameRuleError(400, 'Insufficient funds');
    account.cash = roundCents(Number(account.cash || 0) - amount);
    debt.principal = roundCents(debt.principal - amount);
    recordCashFlow(state, cashFlowId, null, amount);
    const paidOff = debt.principal < 0.005;
    if (paidOff) account.debts = account.debts.filter(d => d !== debt);
    events.push(makeEvent(player, 'debt_payment', { payer: eventName, amount, paidOff }));
    log(state, paidOff
        ? `${name} paid off a loan ($${amount.toFixed(2)}).`
        : `${name} paid $${amount.toFixed(2)} towards a loan.`);
}

function setDebtAutopay(state, player, payload, events) {
    const { debt, name, eventName } = findBorrowerLoan(state, player, payload);
    if (typeof payload.autopay !== 'boolean') throw new GameRuleError(400, 'Choose autopay on or off');
    if (debt.autopay === payload.autopay) return;
    debt.autopay = payload.autopay;
    events.push(makeEvent(player, 'debt_autopay', { borrower: eventName, autopay: debt.autopay }));
    log(state, `${name} turned autopay ${debt.autopay ? 'on' : 'off'} for a loan.`);
}

// Builds on complete colour groups. With payload.corpId the runner builds on
// groups the corporation owns whole, paying from its treasury.
function buyHouses(state, player, payload, events) {
    const selections = payload.selections || {};
    const corp = payload.corpId ? runCorporation(state, player, payload.corpId) : null;
    const ownerId = corp ? corp.id : player.userId;
    let totalCost = 0;
    const changes = [];
    for (const [propId, deltaRaw] of Object.entries(selections)) {
        const delta = Number(deltaRaw);
        if (!Number.isInteger(delta) || delta <= 0) continue;
        const prop = state.properties.find(p => p.id === propId);
        if (!prop || prop.ownerId !== ownerId) throw new GameRuleError(400, corp ? `${corp.ticker} doesn't own that property` : 'Can only improve owned properties');
        if (!ownsCompleteGroup(state, ownerId, prop.color)) throw new GameRuleError(400, corp ? `${corp.ticker} must own the whole ${prop.color} group` : 'Must own complete color group');
        if (!HOUSE_COSTS[prop.color]) throw new GameRuleError(400, 'Cannot improve this property type');
        if ((prop.houses || 0) + delta > 5) throw new GameRuleError(400, 'Too many houses');
        totalCost += delta * HOUSE_COSTS[prop.color];
        changes.push({ prop, delta });
    }
    if (changes.length === 0) throw new GameRuleError(400, 'No houses selected');
    if (corp) {
        requireTreasuryCash(corp, totalCost);
        corp.cash = roundCents(Number(corp.cash || 0) - totalCost);
        recordCashFlow(state, corp.id, null, totalCost);
    } else {
        if (player.cash < totalCost) throw new GameRuleError(400, 'Insufficient funds');
        player.cash -= totalCost;
        recordCashFlow(state, player.userId, null, totalCost);
    }
    changes.forEach(({ prop, delta }) => { prop.houses = (prop.houses || 0) + delta; });
    const builder = corp ? `[${corp.ticker}]` : player.name;
    events.push(makeEvent(player, 'house_purchase', { player: builder, actor: player.name, cost: totalCost }));
    log(state, corp
        ? `${player.name} built houses/hotels for ${corp.ticker} for $${totalCost} from its treasury`
        : `${player.name} bought houses/hotels for $${totalCost}`);
}

function getTradeTerms(state, payload) {
    const player1 = state.players.find(p => p.userId === payload.player1Id);
    const player2 = state.players.find(p => p.userId === payload.player2Id);
    if (!player1 || !player2 || player1.userId === player2.userId) throw new GameRuleError(400, 'Invalid trade players');
    const player1Cash = nonNegativeNumber(payload.player1Cash || 0, 'player1Cash');
    const player2Cash = nonNegativeNumber(payload.player2Cash || 0, 'player2Cash');
    const player1AssetIds = uniqueIds(payload.player1AssetIds || []);
    const player2AssetIds = uniqueIds(payload.player2AssetIds || []);
    const player1Shares = normalizeTradeShares(payload.player1Shares);
    const player2Shares = normalizeTradeShares(payload.player2Shares);
    const player1PropertiesToCorpId = optionalTradeCorpId(payload.player1PropertiesToCorpId);
    const player2PropertiesToCorpId = optionalTradeCorpId(payload.player2PropertiesToCorpId);
    const player1CorpId = optionalTradeCorpId(payload.player1CorpId);
    const player2CorpId = optionalTradeCorpId(payload.player2CorpId);
    if (player1Cash <= 0 && player2Cash <= 0 && player1AssetIds.length === 0 && player2AssetIds.length === 0
        && player1Shares.length === 0 && player2Shares.length === 0) {
        throw new GameRuleError(400, 'Trade must include cash, property or shares');
    }
    return {
        player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds, player1Shares, player2Shares,
        player1PropertiesToCorpId, player2PropertiesToCorpId, player1CorpId, player2CorpId,
        player1Corp: tradingCorporation(state, player1CorpId),
        player2Corp: tradingCorporation(state, player2CorpId),
    };
}

// A side's player can trade for an LLC they run (*CorpId): that side's cash,
// properties and treasury shares come from the LLC, and what it receives goes
// into the LLC. Null means the player trades for themselves.
function tradingCorporation(state, corpId) {
    if (!corpId) return null;
    const corp = state.corporations.find(c => c.id === corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    return corp;
}

// One side of a trade: who gives, from which balance sheet, and whose
// properties and cash change.
function tradeSides(terms) {
    const side1 = { player: terms.player1, corp: terms.player1Corp, cash: terms.player1Cash, assetIds: terms.player1AssetIds, shares: terms.player1Shares, propertiesToCorpId: terms.player1PropertiesToCorpId };
    const side2 = { player: terms.player2, corp: terms.player2Corp, cash: terms.player2Cash, assetIds: terms.player2AssetIds, shares: terms.player2Shares, propertiesToCorpId: terms.player2PropertiesToCorpId };
    [side1, side2].forEach(side => {
        side.entity = side.corp || side.player;
        side.entityId = side.corp ? side.corp.id : side.player.userId;
        side.label = side.corp ? side.corp.ticker : side.player.name;
    });
    return [side1, side2];
}

// A side's properties can go into an LLC run by the other player instead of to
// that player personally (a property-for-shares deal). Null means "to the player".
function optionalTradeCorpId(value) {
    const corpId = String(value || '').trim();
    return corpId || null;
}

function validatePropertyDestination(state, propertyIds, receiver, corpId) {
    if (!corpId) return;
    const corp = state.corporations.find(c => c.id === corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, `${corp.ticker} is insolvent and cannot take property`);
    if (propertyIds.length === 0) throw new GameRuleError(400, `Choose a property to put into ${corp.ticker}`);
    if (!controlsCorporation(corp, receiver.userId)) {
        throw new GameRuleError(400, `${receiver.name} does not run ${corp.ticker}, so it cannot take the property`);
    }
}

function transferPropertiesToCorporation(state, from, corp, ids) {
    ids.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== from.userId) throw new GameRuleError(400, 'Can only transfer owned property');
        prop.ownerId = corp.id;
        prop.ownerName = `[${corp.ticker}]`;
        addCorporationAsset(corp, prop);
    });
}

// Trade share lists are [{ corpId, shares }]; repeated corporations are merged.
function normalizeTradeShares(list) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new GameRuleError(400, 'Trade shares must be a list');
    const byCorp = new Map();
    list.forEach(item => {
        const corpId = String(item?.corpId || '').trim();
        if (!corpId) throw new GameRuleError(400, 'Trade shares need a corpId');
        const shares = positiveInt(item.shares, 'shares');
        byCorp.set(corpId, (byCorp.get(corpId) || 0) + shares);
    });
    return Array.from(byCorp, ([corpId, shares]) => ({ corpId, shares }));
}

function validateShareTransferList(state, from, shareList) {
    shareList.forEach(({ corpId, shares }) => {
        const corp = state.corporations.find(c => c.id === corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (corp.insolvent) throw new GameRuleError(400, `${corp.ticker} is insolvent; its shares cannot be traded`);
        if (sharesFor(corp, from.userId) < shares) {
            throw new GameRuleError(400, `${from.name} does not hold ${shares} share(s) of ${corp.ticker}`);
        }
    });
}

function transferShares(state, from, to, shareList, events = []) {
    shareList.forEach(({ corpId, shares }) => {
        const corp = state.corporations.find(c => c.id === corpId);
        const holdersBefore = snapshotHoldings(corp);
        const holder = corp.shareholders.find(shareholder => shareholder.userId === from.userId);
        holder.shares = Number(holder.shares || 0) - shares;
        addShareholderShares(corp, to, shares);
        removeZeroShareholders(corp);
        normalizeCorporationShareLedger(state, corp);
        chairMajorityHolder(state, corp, holdersBefore, to, events);
    });
}

function snapshotHoldings(corp) {
    return new Map((corp.shareholders || []).map(holder => [holder.userId, Number(holder.shares || 0)]));
}

// Whoever gains a majority of an LLC's shares becomes its chairman at once.
// Only the moment of gaining it counts, so a majority holder can still appoint
// someone else afterwards with change_chairman.
function chairMajorityHolder(state, corp, holdersBefore, actor, events) {
    if (corp.insolvent) return;
    const total = Number(corp.totalShares || 0);
    const holder = (corp.shareholders || []).find(h => Number(h.shares || 0) > total / 2);
    if (!holder || holder.userId === corp.chairmanId) return;
    if (Number(holdersBefore.get(holder.userId) || 0) > total / 2) return;
    const player = state.players.find(p => p.userId === holder.userId);
    if (!player || player.bankrupt) return;
    setChairman(corp, player);
    corp.chairmanVotes = closeChairmanVotesForCandidate(corp, player.userId);
    events.push(makeEvent(actor, 'chairman_changed', { ticker: corp.ticker, chairman: player.name, method: 'majority-gained' }));
    log(state, `${player.name} now holds a majority of ${corp.ticker} and became its chairman.`);
}

function tradeAssetCount(assetIds, shareList) {
    return assetIds.length + shareList.length;
}

// Trade asset lists hold property ids plus, optionally, JAIL_CARD_ASSET_ID for
// a held Get Out of Jail Free card.
function splitTradeAssets(assetIds) {
    return {
        propertyIds: assetIds.filter(id => id !== JAIL_CARD_ASSET_ID),
        jailCard: assetIds.includes(JAIL_CARD_ASSET_ID),
    };
}

function validateTradeTerms(state, terms) {
    const [side1, side2] = tradeSides(terms);
    validateTradeSide(state, side1, side2);
    validateTradeSide(state, side2, side1);
    validateJailCardTransfer(terms.player1, terms.player2, splitTradeAssets(side1.assetIds).jailCard, splitTradeAssets(side2.assetIds).jailCard);
    validateJailCardTransfer(terms.player2, terms.player1, splitTradeAssets(side2.assetIds).jailCard, splitTradeAssets(side1.assetIds).jailCard);
}

// What one side gives, checked against the side that receives it.
function validateTradeSide(state, giver, receiver) {
    const { propertyIds, jailCard } = splitTradeAssets(giver.assetIds);
    if (Number(giver.entity.cash || 0) + 1e-9 < giver.cash) {
        throw new GameRuleError(400, giver.corp ? `${giver.corp.ticker}'s treasury doesn't have $${giver.cash.toFixed(2)}` : 'Insufficient trade cash');
    }
    if (giver.corp) {
        if (giver.corp.insolvent) throw new GameRuleError(400, `${giver.corp.ticker} is insolvent and cannot trade`);
        if (!controlsCorporation(giver.corp, giver.player.userId)) {
            throw new GameRuleError(400, `${giver.player.name} does not run ${giver.corp.ticker}, so can't trade for it`);
        }
        if (receiver.corp && receiver.corp.id === giver.corp.id) throw new GameRuleError(400, 'A company cannot trade with itself');
        // The runner can't take treasury cash or property for themselves; money
        // reaches them only through a dividend every holder shares.
        if (!receiver.corp && controlsCorporation(giver.corp, receiver.player.userId)) {
            throw new GameRuleError(400, `${receiver.player.name} runs ${giver.corp.ticker}, so can't trade with it personally. Pay a dividend instead.`);
        }
        if (jailCard) throw new GameRuleError(400, 'A company has no Get Out of Jail Free card to trade');
        if (giver.propertiesToCorpId) throw new GameRuleError(400, `${giver.corp.ticker}'s properties go to whoever receives them`);
        propertyIds.forEach(id => {
            const prop = state.properties.find(p => p.id === id);
            if (!prop || prop.ownerId !== giver.corp.id) throw new GameRuleError(400, `${giver.corp.ticker} does not own ${prop?.name || 'that property'}`);
            if (groupHasBuildings(state, prop.color)) {
                throw new GameRuleError(400, `${prop.name} is in the ${prop.color} group, which has buildings. A built group can't be traded.`);
            }
        });
        giver.shares.forEach(({ corpId, shares }) => {
            if (corpId !== giver.corp.id) throw new GameRuleError(400, `${giver.corp.ticker} can only trade its own treasury shares`);
            if (Number(giver.corp.treasuryShares || 0) < shares) {
                throw new GameRuleError(400, `${giver.corp.ticker} holds only ${Number(giver.corp.treasuryShares || 0)} treasury share(s)`);
            }
        });
    } else {
        validatePropertyTransferList(state, giver.player, propertyIds);
        validateShareTransferList(state, giver.player, giver.shares);
        if (receiver.corp && giver.propertiesToCorpId && giver.propertiesToCorpId !== receiver.corp.id) {
            throw new GameRuleError(400, `Properties given to ${receiver.corp.ticker} go into ${receiver.corp.ticker}`);
        }
        if (!receiver.corp) validatePropertyDestination(state, propertyIds, receiver.player, giver.propertiesToCorpId);
    }
    if (receiver.corp) {
        if (jailCard) throw new GameRuleError(400, `${receiver.corp.ticker} can't hold a Get Out of Jail Free card`);
        giver.shares.forEach(({ corpId }) => {
            if (corpId !== receiver.corp.id) throw new GameRuleError(400, `${receiver.corp.ticker} can only take back its own shares`);
        });
    }
}

function validateJailCardTransfer(from, to, givesCard, receivesCard) {
    if (!givesCard) return;
    if (!from.hasGetOutOfJailCard) throw new GameRuleError(400, `${from.name} has no Get Out of Jail Free card to trade`);
    if (to.hasGetOutOfJailCard && !receivesCard) {
        throw new GameRuleError(400, `${to.name} already holds a Get Out of Jail Free card`);
    }
}

function applyTradeTransfer(state, terms, events = []) {
    const [side1, side2] = tradeSides(terms);
    moveTradeCash(state, side1, side2);
    moveTradeCash(state, side2, side1);
    moveTradeProperties(state, side1, side2);
    moveTradeProperties(state, side2, side1);
    moveTradeShares(state, side1, side2, events);
    moveTradeShares(state, side2, side1, events);
    const card1 = splitTradeAssets(side1.assetIds).jailCard;
    const card2 = splitTradeAssets(side2.assetIds).jailCard;
    if (card1 !== card2) {
        const giver = card1 ? terms.player1 : terms.player2;
        const receiver = card1 ? terms.player2 : terms.player1;
        giver.hasGetOutOfJailCard = false;
        receiver.hasGetOutOfJailCard = true;
    }
}

function moveTradeCash(state, giver, receiver) {
    if (!(giver.cash > 0)) return;
    giver.entity.cash = roundCents(Number(giver.entity.cash || 0) - giver.cash);
    receiver.entity.cash = roundCents(Number(receiver.entity.cash || 0) + giver.cash);
    recordCashFlow(state, giver.entityId, receiver.entityId, giver.cash);
}

function moveTradeProperties(state, giver, receiver) {
    const { propertyIds } = splitTradeAssets(giver.assetIds);
    if (propertyIds.length === 0) return;
    if (!giver.corp && !receiver.corp) {
        transferTradeProperties(state, giver.player, receiver.player, propertyIds, giver.propertiesToCorpId);
        return;
    }
    if (!giver.corp) {
        transferPropertiesToCorporation(state, giver.player, receiver.corp, propertyIds);
        return;
    }
    propertyIds.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        removeCorporationAsset(giver.corp, id);
        if (receiver.corp) {
            prop.ownerId = receiver.corp.id;
            prop.ownerName = `[${receiver.corp.ticker}]`;
            addCorporationAsset(receiver.corp, prop);
        } else {
            prop.ownerId = receiver.player.userId;
            prop.ownerName = receiver.player.name;
        }
    });
}

// Shares a company gives come out of its treasury; shares it receives are its
// own, bought back into the treasury.
function moveTradeShares(state, giver, receiver, events) {
    if (giver.shares.length === 0) return;
    if (!giver.corp && !receiver.corp) {
        transferShares(state, giver.player, receiver.player, giver.shares, events);
        return;
    }
    giver.shares.forEach(({ corpId, shares }) => {
        const corp = state.corporations.find(c => c.id === corpId);
        const holdersBefore = snapshotHoldings(corp);
        if (giver.corp) {
            corp.treasuryShares = Number(corp.treasuryShares || 0) - shares;
            corp.availableShares = Math.min(Number(corp.availableShares || 0), corp.treasuryShares);
            addShareholderShares(corp, receiver.player, shares);
            normalizeCorporationShareLedger(state, corp);
            chairMajorityHolder(state, corp, holdersBefore, receiver.player, events);
        } else {
            const holder = corp.shareholders.find(h => h.userId === giver.player.userId);
            holder.shares = Number(holder.shares || 0) - shares;
            removeZeroShareholders(corp);
            corp.treasuryShares = Number(corp.treasuryShares || 0) + shares;
            normalizeCorporationShareLedger(state, corp);
        }
    });
}

function transferTradeProperties(state, from, to, propertyIds, corpId) {
    if (!corpId) {
        transferProperties(state, from, to, propertyIds);
        return;
    }
    const corp = state.corporations.find(c => c.id === corpId);
    transferPropertiesToCorporation(state, from, corp, propertyIds);
    const names = propertyIds.map(id => state.properties.find(p => p.id === id)?.name || id).join(', ');
    log(state, `${from.name} put ${names} into ${corp.ticker}`);
}

function trade(state, actor, payload, events) {
    const terms = getTradeTerms(state, payload);
    const { player1, player2, player1Cash, player2Cash } = terms;
    if (![player1.userId, player2.userId].includes(actor.userId)) throw new GameRuleError(403, 'Trade must involve acting player');
    validateTradeTerms(state, terms);
    applyTradeTransfer(state, terms, events);
    events.push(makeEvent(actor, 'transaction', { player1: player1.name, player2: player2.name, player1Cash, player2Cash }));
    log(state, `Transaction: ${player1.name} <-> ${player2.name}`);
}

function proposeTrade(state, actor, payload, events) {
    const terms = getTradeTerms(state, payload);
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds, player1Shares, player2Shares } = terms;
    if (![player1.userId, player2.userId].includes(actor.userId)) throw new GameRuleError(403, 'Trade must involve acting player');
    validateTradeTerms(state, terms);
    const recipient = actor.userId === player1.userId ? player2 : player1;
    const now = new Date();
    const createdAt = now.toISOString();
    const offer = {
        id: `offer-${uuidv4()}`,
        status: 'pending',
        proposedById: actor.userId,
        proposedByName: actor.name,
        recipientId: recipient.userId,
        recipientName: recipient.name,
        player1Id: player1.userId,
        player1Name: player1.name,
        player2Id: player2.userId,
        player2Name: player2.name,
        player1Cash,
        player2Cash,
        player1AssetIds,
        player2AssetIds,
        player1Shares,
        player2Shares,
        player1PropertiesToCorpId: terms.player1PropertiesToCorpId,
        player2PropertiesToCorpId: terms.player2PropertiesToCorpId,
        player1CorpId: terms.player1CorpId,
        player2CorpId: terms.player2CorpId,
        player1CorpTicker: terms.player1Corp?.ticker || null,
        player2CorpTicker: terms.player2Corp?.ticker || null,
        createdAt,
        expiresAt: tradeOfferExpiryFrom(state, now),
    };
    state.marketOffers.push(offer);
    events.push(makeEvent(actor, 'trade_offer_proposed', {
        offerId: offer.id,
        proposer: actor.name,
        recipient: recipient.name,
        player1: player1.name,
        player2: player2.name,
        player1Cash,
        player2Cash,
        player1Assets: tradeAssetCount(player1AssetIds, player1Shares),
        player2Assets: tradeAssetCount(player2AssetIds, player2Shares),
        expiresAt: offer.expiresAt,
    }));
    log(state, `${actor.name} proposed a trade with ${recipient.name}`);
}

function acceptTrade(state, actor, payload, events) {
    const offer = findPendingTradeOffer(state, payload.offerId);
    if (![offer.player1Id, offer.player2Id].includes(actor.userId)) throw new GameRuleError(403, 'Trade must involve acting player');
    if (offer.proposedById === actor.userId) throw new GameRuleError(403, 'Trade proposer cannot accept their own offer');
    const terms = getTradeTerms(state, offer);
    validateTradeTerms(state, terms);
    applyTradeTransfer(state, terms, events);
    offer.status = 'accepted';
    offer.acceptedById = actor.userId;
    offer.acceptedByName = actor.name;
    offer.resolvedAt = new Date().toISOString();
    events.push(makeEvent(actor, 'trade_offer_accepted', {
        offerId: offer.id,
        proposer: offer.proposedByName,
        accepter: actor.name,
        player1: offer.player1Name,
        player2: offer.player2Name,
        player1Cash: offer.player1Cash,
        player2Cash: offer.player2Cash,
        player1Assets: tradeAssetCount(terms.player1AssetIds, terms.player1Shares),
        player2Assets: tradeAssetCount(terms.player2AssetIds, terms.player2Shares),
    }));
    log(state, `${actor.name} accepted ${offer.proposedByName}'s trade offer`);
}

function cancelTrade(state, actor, payload, events) {
    const offer = findPendingTradeOffer(state, payload.offerId);
    if (![offer.player1Id, offer.player2Id].includes(actor.userId)) throw new GameRuleError(403, 'Trade must involve acting player');
    offer.status = offer.proposedById === actor.userId ? 'canceled' : 'declined';
    offer.resolvedAt = new Date().toISOString();
    offer.resolvedById = actor.userId;
    offer.resolvedByName = actor.name;
    events.push(makeEvent(actor, 'trade_offer_canceled', {
        offerId: offer.id,
        proposer: offer.proposedByName,
        actor: actor.name,
        status: offer.status,
    }));
    log(state, `${actor.name} ${offer.status === 'declined' ? 'declined' : 'canceled'} a trade offer`);
}

function hostCancelTradeOffer(state, actor, payload, events) {
    const offer = findPendingTradeOffer(state, payload.offerId);
    offer.status = 'canceled';
    offer.cancelReason = 'host';
    offer.resolvedAt = new Date().toISOString();
    offer.resolvedById = actor.userId;
    offer.resolvedByName = actor.name;
    events.push(makeEvent(actor, 'trade_offer_canceled', {
        offerId: offer.id,
        proposer: offer.proposedByName,
        actor: actor.name,
        status: offer.status,
        reason: 'host',
    }));
    log(state, `${actor.name} canceled a trade offer as host`);
}

function findPendingTradeOffer(state, offerId) {
    const offer = (state.marketOffers || []).find(item => item.id === offerId && item.status === 'pending');
    if (!offer) throw new GameRuleError(404, 'Pending trade offer not found');
    return offer;
}

function expirePendingTradeOffersIfNeeded(state, actor, events) {
    const expiredOfferIds = new Set();
    const now = new Date().toISOString();
    (state.marketOffers || []).forEach(offer => {
        if (offer.status !== 'pending' || !isTradeOfferExpired(offer)) return;
        offer.status = 'expired';
        offer.cancelReason = 'timeout';
        offer.resolvedAt = now;
        offer.resolvedById = actor.userId;
        offer.resolvedByName = actor.name;
        expiredOfferIds.add(offer.id);
        events.push(makeEvent(actor, 'trade_offer_expired', {
            offerId: offer.id,
            proposer: offer.proposedByName,
            recipient: offer.recipientName,
            actor: actor.name,
            reason: 'timeout',
        }));
        log(state, `Trade offer from ${offer.proposedByName} to ${offer.recipientName} expired`);
    });
    return expiredOfferIds;
}

function isTradeOfferExpired(offer) {
    if (!offer?.expiresAt) return false;
    const expiresAt = new Date(offer.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function cancelPendingTradeOffersForPlayer(state, player, events) {
    const now = new Date().toISOString();
    (state.marketOffers || []).forEach(offer => {
        if (offer.status !== 'pending') return;
        if (![offer.player1Id, offer.player2Id].includes(player.userId)) return;
        offer.status = 'canceled';
        offer.cancelReason = 'bankruptcy';
        offer.resolvedAt = now;
        offer.resolvedById = player.userId;
        offer.resolvedByName = player.name;
        events.push(makeEvent(player, 'trade_offer_canceled', {
            offerId: offer.id,
            proposer: offer.proposedByName,
            actor: player.name,
            status: offer.status,
            reason: 'bankruptcy',
        }));
    });
}

function liquidateBankruptPlayer(state, player, events, claim = null) {
    const creditor = resolveBankruptcyCreditor(state, claim);
    const releasedProperties = [];
    state.properties.forEach(prop => {
        if (prop.ownerId !== player.userId) return;
        releasedProperties.push({ id: prop.id, name: prop.name });
        prop.houses = 0;
        if (creditor?.type === 'player') {
            prop.ownerId = creditor.id;
            prop.ownerName = creditor.name;
        } else if (creditor?.type === 'corporation') {
            prop.ownerId = creditor.id;
            prop.ownerName = creditor.name;
            addCorporationAsset(creditor.entity, prop);
        } else {
            prop.ownerId = null;
            prop.ownerName = null;
        }
    });

    const returnedSharePositions = [];
    const transferredSharePositions = [];
    state.corporations.forEach(corp => {
        const holding = (corp.shareholders || []).find(shareholder => shareholder.userId === player.userId);
        if (holding) {
            const shares = Number(holding.shares || 0);
            corp.shareholders = (corp.shareholders || []).filter(shareholder => shareholder.userId !== player.userId);
            if (creditor?.type === 'player') {
                addShareholderShares(corp, { userId: creditor.id, name: creditor.name }, shares);
                transferredSharePositions.push({ ticker: corp.ticker, shares, to: creditor.name });
            } else {
                returnSharesToTreasury(corp, shares);
                returnedSharePositions.push({ ticker: corp.ticker, shares });
            }
        }
        removeZeroShareholders(corp);
        normalizeCorporationShareLedger(state, corp);
        corp.chairmanVotes = (corp.chairmanVotes || []).map(vote => {
            if (vote.status !== 'open') return vote;
            const supporters = (vote.supporters || []).filter(supporter => supporter.userId !== player.userId);
            if (vote.createdBy === player.userId || vote.candidateUserId === player.userId || supporters.length !== (vote.supporters || []).length) {
                return {
                    ...vote,
                    supporters,
                    status: 'closed',
                    closedAt: new Date().toISOString(),
                    closeReason: 'bankruptcy',
                };
            }
            return vote;
        });
        if (corp.chairmanId === player.userId) {
            const replacement = chooseReplacementChairman(state, corp, player.userId);
            if (replacement) {
                setChairman(corp, replacement);
                events.push(makeEvent(player, 'chairman_changed', {
                    ticker: corp.ticker,
                    chairman: replacement.name,
                    method: 'bankruptcy',
                }));
                log(state, `${corp.ticker} chairman changed to ${replacement.name} after ${player.name} went bankrupt.`);
            } else {
                corp.chairmanId = null;
                corp.chairmanName = null;
                events.push(makeEvent(player, 'chairman_vacated', {
                    ticker: corp.ticker,
                    formerChairman: player.name,
                    reason: 'bankruptcy',
                }));
                log(state, `${corp.ticker} chairman seat is vacant after ${player.name} went bankrupt.`);
            }
        }
    });

    player.debts = [];
    if (releasedProperties.length > 0 || returnedSharePositions.length > 0 || transferredSharePositions.length > 0) {
        const assetDestinationName = creditor ? creditor.name : 'the Bank';
        events.push(makeEvent(player, 'bankruptcy_liquidation', {
            player: player.name,
            creditor: creditor ? creditor.name : null,
            reason: claim ? claim.reason : null,
            assetDestinationName,
            assetDestinationType: creditor ? creditor.type : 'bank',
            releasedProperties,
            returnedSharePositions,
            transferredSharePositions,
        }));
        const propertyText = releasedProperties.length
            ? `${releasedProperties.length} propert${releasedProperties.length === 1 ? 'y' : 'ies'} ${creditor ? `transferred to ${creditor.name}` : 'returned to the bank'}`
            : 'no direct properties';
        const returnedShares = returnedSharePositions.reduce((sum, item) => sum + item.shares, 0);
        const transferredShares = transferredSharePositions.reduce((sum, item) => sum + item.shares, 0);
        const shareText = returnedShares || transferredShares
            ? `${returnedShares} share(s) returned, ${transferredShares} share(s) transferred`
            : 'no shares returned';
        log(state, `${player.name} bankruptcy liquidation: ${propertyText}, ${shareText}.`);
    }
}

function addCorporationAsset(corp, prop) {
    corp.assets = Array.isArray(corp.assets) ? corp.assets : [];
    if (corp.assets.some(asset => asset.id === prop.id)) return;
    corp.assets.push({
        id: prop.id,
        name: prop.name,
        value: prop.price,
        color: prop.color,
    });
}

function chooseReplacementChairman(state, corp, bankruptUserId) {
    const activePlayersById = new Map(state.players
        .filter(candidate => !candidate.bankrupt && candidate.userId !== bankruptUserId)
        .map(candidate => [candidate.userId, candidate]));
    const shareholder = (corp.shareholders || [])
        .filter(holder => activePlayersById.has(holder.userId) && Number(holder.shares || 0) > 0)
        .sort((a, b) => Number(b.shares || 0) - Number(a.shares || 0))[0];
    if (shareholder) return activePlayersById.get(shareholder.userId);
    if (corp.founderId && activePlayersById.has(corp.founderId)) return activePlayersById.get(corp.founderId);
    return null;
}

function manualPayment(state, actor, payload, events) {
    const from = state.players.find(p => p.userId === payload.fromPlayerId);
    const to = state.players.find(p => p.userId === payload.toPlayerId);
    const amount = positiveNumber(payload.amount, 'amount');
    if (!from || !to || from.userId === to.userId) throw new GameRuleError(400, 'Invalid payment players');
    if (from.userId !== actor.userId) throw new GameRuleError(403, 'Payment must be sent by actor');
    if (from.cash < amount) throw new GameRuleError(400, 'Insufficient funds');
    from.cash -= amount;
    to.cash += amount;
    recordCashFlow(state, from.userId, to.userId, amount);
    events.push(makeEvent(actor, 'payment', { from: from.name, to: to.name, amount }));
    log(state, `${from.name} paid $${amount.toFixed(2)} to ${to.name}`);
}

// A corporation's loans count down on its chairman's turns (or, with the chair
// vacant, its majority holder's), once per round.
function loanServicerId(corp) {
    if (corp.chairmanId) return corp.chairmanId;
    const majority = (corp.shareholders || []).find(holder => hasMajorityShares(corp, holder.userId));
    return majority ? majority.userId : null;
}

// End-of-turn loan servicing for one borrower (a player or a corporation): see
// loans.js. A loan that matures takes its whole balance from cash; when the cash
// isn't there the account goes negative and the caller's bankruptcy or
// insolvency check takes over. Returns the interest charged.
// Events name a corporation as [TICKER], like debt_issued does.
function serviceLoans(state, actor, account, cashFlowId, name, events, eventName = name) {
    let interestCharged = 0;
    let paid = 0;
    let unpaidInterest = 0;
    (account.debts || []).forEach(debt => {
        const result = loans.serviceLoan(debt, account.cash);
        interestCharged += result.interest;
        unpaidInterest += result.unpaidInterest;
        if (result.matured) {
            const repaid = Number(account.cash || 0) >= result.paid;
            events.push(makeEvent(actor, 'loan_matured', { borrower: eventName, amount: result.paid, repaid }));
            log(state, repaid
                ? `${name} repaid a loan in full at maturity ($${result.paid.toFixed(2)}).`
                : `${name} couldn't repay a $${result.paid.toFixed(2)} loan that came due.`);
        }
        account.cash = roundCents(Number(account.cash || 0) - result.paid);
        paid += result.paid;
    });
    account.debts = (account.debts || []).filter(debt => debt.turnsRemaining > 0 && debt.principal >= 0.005);
    interestCharged = roundCents(interestCharged);
    paid = roundCents(paid);
    unpaidInterest = roundCents(unpaidInterest);
    if (paid > 0) recordCashFlow(state, cashFlowId, null, paid);
    if (interestCharged > 0 || paid > 0) {
        events.push(makeEvent(actor, 'interest_accrual', { player: eventName, interestCharged, paid, unpaidInterest }));
        const parts = [];
        parts.push(paid > 0
            ? `${name} paid $${paid.toFixed(2)} on loans (interest this turn: $${interestCharged.toFixed(2)})`
            : `${name} paid nothing on loans this turn`);
        if (unpaidInterest > 0) parts.push(`$${unpaidInterest.toFixed(2)} of unpaid interest was added to the balance`);
        log(state, `${parts.join('; ')}.`);
    }
    return interestCharged;
}

function endTurn(state, player, events) {
    if (!player.diceRolled) throw new GameRuleError(400, 'Roll before ending turn');

    // Rent owed is paid before loans, so autopay (which never takes more than the
    // cash left) can't turn a payable claim into a bankruptcy. A loan coming due can.
    const bankruptcyClaim = settleBankruptcyClaimAtTurnEnd(state, player, events);
    serviceLoans(state, player, player, player.userId, player.name, events);
    state.corporations.forEach(corp => {
        if (corp.insolvent || loanServicerId(corp) !== player.userId) return;
        const corpInterest = serviceLoans(state, player, corp, corp.id, corp.ticker, events, `[${corp.ticker}]`);
        if (Number(corp.cash || 0) < 0) {
            resolveCorporationInsolvency(state, corp, player, events, {
                reason: 'interest',
                interestCharged: corpInterest,
            });
        }
    });
    // The rent-policy cooldown counts the chairman's own turns.
    state.corporations.forEach(corp => {
        if (corp.chairmanId !== player.userId) return;
        if (corp.rentPolicyLockSkipsTurnOf === player.userId) corp.rentPolicyLockSkipsTurnOf = null;
        else if (corp.rentPolicyLockedTurns > 0) corp.rentPolicyLockedTurns -= 1;
    });
    if ((player.cash < 0 || bankruptcyClaim) && !player.bankrupt) {
        player.bankrupt = true;
        cancelPendingTradeOffersForPlayer(state, player, events);
        liquidateBankruptPlayer(state, player, events, bankruptcyClaim);
        clearBankruptcyClaim(state, player.userId);
        events.push(makeEvent(player, 'bankruptcy', {
            player: player.name,
            creditor: bankruptcyClaim ? bankruptcyClaim.creditorName : null,
            reason: bankruptcyClaim ? bankruptcyClaim.reason : null,
        }));
        log(state, `${player.name} has gone BANKRUPT!`);
    } else if (!bankruptcyClaim && player.cash >= 0) {
        clearBankruptcyClaim(state, player.userId);
    }
    player.diceRolled = false;
    player.doubleCount = 0;
    const activePlayers = state.players.filter(p => !p.bankrupt);
    if (activePlayers.length <= 1) {
        finishGame(state, activePlayers[0] ? `${activePlayers[0].name} wins - last player standing!` : "Everyone went bankrupt - it's a draw!", events);
        return;
    }
    const totalPlayers = state.players.length;
    let nextIndex = (state.currentPlayerIndex + 1) % totalPlayers;
    let safety = 0;
    while (state.players[nextIndex].bankrupt && safety < totalPlayers) {
        nextIndex = (nextIndex + 1) % totalPlayers;
        safety += 1;
    }
    state.currentPlayerIndex = nextIndex;
    resetCashFlow(state, state.players[nextIndex].userId);
    state.lastDiceRoll = null;
    state.lastCardDrawn = null;
    state.players[nextIndex].diceRolled = false;
    events.push(makeEvent(player, 'turn_end', { player: player.name, nextPlayer: state.players[nextIndex].name }));
    log(state, `${player.name} ended their turn. It's now ${state.players[nextIndex].name}'s turn.`);
}

function resolveCorporationInsolvency(state, corp, actor, events, details = {}) {
    if (!corp || corp.insolvent) return;
    const releasedProperties = [];
    state.properties.forEach(prop => {
        if (prop.ownerId !== corp.id) return;
        releasedProperties.push({ id: prop.id, name: prop.name });
        prop.ownerId = null;
        prop.ownerName = null;
        prop.houses = 0;
    });

    const wipedSharePositions = (corp.shareholders || [])
        .map(shareholder => ({
            userId: shareholder.userId,
            name: shareholder.name,
            shares: Number(shareholder.shares || 0),
        }))
        .filter(shareholder => shareholder.shares > 0);
    const clearedDebts = (corp.debts || []).map(debt => ({
        id: debt.id,
        principal: Number(debt.principal || 0),
        interestRate: Number(debt.interestRate || 0),
    }));
    const openVotes = (corp.chairmanVotes || []).filter(vote => vote.status === 'open');
    const cashBeforeReset = Number(corp.cash || 0);

    corp.status = 'insolvent';
    corp.insolvent = true;
    corp.cash = 0;
    corp.assets = [];
    corp.debts = [];
    corp.shareholders = [];
    corp.availableShares = 0;
    corp.treasuryShares = 0;
    corp.chairmanId = null;
    corp.chairmanName = null;
    corp.chairmanVotes = (corp.chairmanVotes || []).map(vote => {
        if (vote.status !== 'open') return vote;
        return {
            ...vote,
            status: 'closed',
            closedAt: new Date().toISOString(),
            closeReason: 'corporation_insolvent',
        };
    });

    events.push(makeEvent(actor, 'corporation_insolvent', {
        ticker: corp.ticker,
        corporation: corp.name,
        reason: details.reason || 'insolvency',
        interestCharged: Number(details.interestCharged || 0),
        cashBeforeReset,
        releasedProperties,
        wipedSharePositions,
        clearedDebts,
        closedVotes: openVotes.length,
    }));
    log(state, `${corp.ticker} became insolvent: ${releasedProperties.length} propert${releasedProperties.length === 1 ? 'y' : 'ies'} returned to the Bank, shares wiped, and debts cleared.`);
}

function finishGame(state, reason, events) {
    if (state.paused && state.pause) {
        state.pauseHistory.push({
            ...state.pause,
            closedAt: new Date().toISOString(),
            closeReason: 'game_ended',
        });
        state.pauseHistory = state.pauseHistory.slice(-20);
    }
    state.paused = false;
    state.pause = null;
    state.ended = true;
    state.standings = state.players.map(player => ({
        userId: player.userId,
        name: player.name,
        cash: player.cash,
        netWorth: calculateNetWorth(state, player.userId),
        bankrupt: player.bankrupt,
    })).sort((a, b) => b.netWorth - a.netWorth);
    events.push(makeEvent(state.players[state.currentPlayerIndex] || state.players[0], 'game_ended', { reason, standings: state.standings }));
    log(state, `Game over - ${reason}`);
}

function pauseGame(state, actor, payload, events) {
    if (state.paused) throw new GameRuleError(400, 'Game is already paused');
    const reason = cleanText(payload.reason, 'Host paused the game');
    const pausedAt = new Date().toISOString();
    state.paused = true;
    state.pause = {
        reason,
        pausedAt,
        pausedById: actor.userId,
        pausedByName: actor.name,
    };
    events.push(makeEvent(actor, 'game_paused', {
        actor: actor.name,
        reason,
        pausedAt,
    }));
    log(state, `${actor.name} paused the game: ${reason}`);
}

function resumeGame(state, actor, events) {
    if (!state.paused) throw new GameRuleError(400, 'Game is not paused');
    const resumedAt = new Date().toISOString();
    state.pauseHistory.push({
        ...(state.pause || {}),
        resumedAt,
        resumedById: actor.userId,
        resumedByName: actor.name,
    });
    state.pauseHistory = state.pauseHistory.slice(-20);
    state.paused = false;
    state.pause = null;
    events.push(makeEvent(actor, 'game_resumed', {
        actor: actor.name,
        resumedAt,
    }));
    log(state, `${actor.name} resumed the game`);
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

function calculateNetWorth(state, playerId) {
    const player = state.players.find(p => p.userId === playerId);
    if (!player) return 0;
    const propertyValue = state.properties
        .filter(p => p.ownerId === player.userId)
        .reduce((sum, prop) => sum + prop.price + (prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0), 0);
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
            return sum + prop.price + (prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0);
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

function recordCashFlow(state, fromEntityId, toEntityId, amount) {
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
}

function getBankruptcyClaim(state, debtorId) {
    return state.bankruptcyClaims && state.bankruptcyClaims[debtorId] ? state.bankruptcyClaims[debtorId] : null;
}

function clearBankruptcyClaim(state, debtorId) {
    if (!state.bankruptcyClaims) state.bankruptcyClaims = {};
    delete state.bankruptcyClaims[debtorId];
}

function setBankruptcyClaim(state, debtor, claim) {
    const unpaidAmount = Number(claim.unpaidAmount || 0);
    if (unpaidAmount <= 0) {
        clearBankruptcyClaim(state, debtor.userId);
        return null;
    }
    state.bankruptcyClaims = state.bankruptcyClaims && typeof state.bankruptcyClaims === 'object' ? state.bankruptcyClaims : {};
    state.bankruptcyClaims[debtor.userId] = {
        debtorId: debtor.userId,
        debtorName: debtor.name,
        creditorId: claim.creditorId || null,
        creditorName: claim.creditorName || 'the Bank',
        creditorType: claim.creditorType || 'bank',
        reason: claim.reason || 'Unpaid obligation',
        propertyId: claim.propertyId || null,
        propertyName: claim.propertyName || null,
        amountOwed: Number(claim.amountOwed || 0),
        paidAmount: Number(claim.paidAmount || 0),
        unpaidAmount,
        createdAt: claim.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    return state.bankruptcyClaims[debtor.userId];
}

function resolveBankruptcyCreditor(state, claim) {
    if (!claim || !claim.creditorId) return null;
    if (claim.creditorType === 'player') {
        const player = state.players.find(candidate => candidate.userId === claim.creditorId && !candidate.bankrupt);
        return player ? { type: 'player', id: player.userId, name: player.name, entity: player } : null;
    }
    if (claim.creditorType === 'corporation') {
        const corporation = state.corporations.find(candidate => candidate.id === claim.creditorId && !candidate.insolvent);
        return corporation ? { type: 'corporation', id: corporation.id, name: `[${corporation.ticker}]`, entity: corporation } : null;
    }
    return null;
}

// Rent on a corporation's property goes into its treasury. In Payout mode a
// shareholder pays only the part of the rent they don't own, and what the
// treasury receives goes straight on to the other shareholders.
function payCorporationRent(state, player, corp, prop, reason, fullRent, events) {
    const payout = corp.rentPolicy === 'payout';
    const ownShares = payout ? sharesFor(corp, player.userId) : 0;
    const due = payout ? shareholderRentDue(fullRent, ownShares, corp.totalShares) : fullRent;
    const extra = { propertyId: prop.id, propertyName: prop.name };
    if (due < fullRent) {
        extra.fullRent = fullRent;
        extra.ownPercent = Math.round((ownShares / Number(corp.totalShares || 1)) * 1000) / 10;
    }
    if (due <= 0) {
        log(state, `${player.name} owns all of ${corp.ticker}, so pays no rent on ${prop.name}`);
        return;
    }
    const paid = payCreditorAvailableCash(state, player, { type: 'corporation', id: corp.id, name: `[${corp.ticker}]`, entity: corp },
        due, reason, events, extra);
    distributeCorporationRent(state, corp, paid, player, events);
}

function payCreditorAvailableCash(state, debtor, creditor, amountOwed, reason, events, extra = {}) {
    const owed = Number(amountOwed || 0);
    if (owed <= 0) return 0;
    const availableCash = Math.max(Number(debtor.cash || 0), 0);
    const paidAmount = Math.min(availableCash, owed);
    const unpaidAmount = owed - paidAmount;
    debtor.cash -= paidAmount;
    if (creditor.type === 'player') {
        creditor.entity.cash += paidAmount;
    } else {
        creditor.entity.cash = Number(creditor.entity.cash || 0) + paidAmount;
    }
    recordCashFlow(state, debtor.userId, creditor.id, paidAmount);

    const eventData = {
        from: debtor.name,
        to: creditor.name,
        amount: paidAmount,
        amountOwed: owed,
        unpaidAmount,
        reason,
        ...extra,
    };
    events.push(makeEvent(debtor, 'forced_payment', eventData));

    if (unpaidAmount > 0) {
        setBankruptcyClaim(state, debtor, {
            creditorId: creditor.id,
            creditorName: creditor.name,
            creditorType: creditor.type,
            reason,
            amountOwed: owed,
            paidAmount,
            unpaidAmount,
            propertyId: extra.propertyId,
            propertyName: extra.propertyName,
        });
        log(state, `${debtor.name} owed $${owed.toFixed(2)} to ${creditor.name} for ${reason}, paid $${paidAmount.toFixed(2)}, and has $${unpaidAmount.toFixed(2)} unpaid.`);
    } else {
        log(state, `${debtor.name} paid $${owed.toFixed(2)} to ${creditor.name} for ${reason}`);
    }
    return paidAmount;
}

function settleBankruptcyClaimAtTurnEnd(state, player, events) {
    const claim = getBankruptcyClaim(state, player.userId);
    if (!claim) return null;
    const creditor = resolveBankruptcyCreditor(state, claim);
    if (!creditor) return claim;

    const payment = Math.min(Math.max(Number(player.cash || 0), 0), Number(claim.unpaidAmount || 0));
    if (payment > 0) {
        player.cash -= payment;
        if (creditor.type === 'player') {
            creditor.entity.cash += payment;
        } else {
            creditor.entity.cash = Number(creditor.entity.cash || 0) + payment;
        }
        recordCashFlow(state, player.userId, creditor.id, payment);
        claim.paidAmount = Number(claim.paidAmount || 0) + payment;
        claim.unpaidAmount = Math.max(Number(claim.unpaidAmount || 0) - payment, 0);
        claim.updatedAt = new Date().toISOString();
        events.push(makeEvent(player, 'bankruptcy_claim_payment', {
            player: player.name,
            creditor: creditor.name,
            amount: payment,
            reason: claim.reason,
            unpaidAmount: claim.unpaidAmount,
        }));
        log(state, `${player.name} paid $${payment.toFixed(2)} toward ${claim.reason} owed to ${creditor.name}.`);
        if (creditor.type === 'corporation' && claim.propertyId) distributeCorporationRent(state, creditor.entity, payment, player, events);
    }

    if (Number(claim.unpaidAmount || 0) <= 0) {
        clearBankruptcyClaim(state, player.userId);
        events.push(makeEvent(player, 'bankruptcy_claim_settled', {
            player: player.name,
            creditor: creditor.name,
            reason: claim.reason,
        }));
        log(state, `${player.name} settled the unpaid ${claim.reason} claim.`);
        return null;
    }

    setBankruptcyClaim(state, player, claim);
    return getBankruptcyClaim(state, player.userId);
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
                value: prop.price + (prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0),
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

function normalizeAuction(auction) {
    if (!auction || typeof auction !== 'object') return null;
    return {
        ...auction,
        status: auction.status || 'open',
        propertyId: auction.propertyId || null,
        propertyName: auction.propertyName || '',
        currentBid: Number(auction.currentBid || auction.finalBid || 0),
        highBidderId: auction.highBidderId || auction.winnerId || null,
        highBidderName: auction.highBidderName || auction.winnerName || null,
        passedPlayerIds: Array.isArray(auction.passedPlayerIds) ? auction.passedPlayerIds : [],
    };
}

function normalizePauseState(pause) {
    if (!pause || typeof pause !== 'object') {
        return {
            reason: 'Host paused the game',
            pausedAt: new Date().toISOString(),
            pausedById: null,
            pausedByName: 'Host',
        };
    }
    return {
        reason: cleanText(pause.reason, 'Host paused the game'),
        pausedAt: normalizeDateString(pause.pausedAt),
        pausedById: pause.pausedById || null,
        pausedByName: pause.pausedByName || 'Host',
    };
}

function normalizeBankruptcyClaims(claims) {
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return {};
    return Object.entries(claims).reduce((normalized, [debtorId, claim]) => {
        if (!claim || typeof claim !== 'object') return normalized;
        const amountOwed = Number(claim.amountOwed || 0);
        const paidAmount = Number(claim.paidAmount || 0);
        const unpaidAmount = Number(claim.unpaidAmount ?? Math.max(amountOwed - paidAmount, 0));
        if (!debtorId || unpaidAmount <= 0) return normalized;
        normalized[debtorId] = {
            ...claim,
            debtorId: claim.debtorId || debtorId,
            creditorId: claim.creditorId || null,
            creditorName: claim.creditorName || 'the Bank',
            creditorType: claim.creditorType || 'bank',
            amountOwed,
            paidAmount,
            unpaidAmount,
        };
        return normalized;
    }, {});
}

function requireHost(options, actorUserId) {
    if (!options.hostId || options.hostId !== actorUserId) throw new GameRuleError(403, 'Not the host');
}

function ownsCompleteGroup(state, userId, color) {
    if (!HOUSE_COSTS[color]) return false;
    const group = state.properties.filter(p => p.color === color);
    return group.length > 0 && group.every(p => p.ownerId === userId);
}

// Going to Jail by any route ends the turn: no doubles re-roll and no Jail
// choice until the player's next turn.
function sendToJail(player) {
    player.position = 10;
    player.inJail = true;
    player.jailTurns = 0;
    player.doubleCount = 0;
    player.diceRolled = true;
}

function releaseFromJail(player) {
    player.inJail = false;
    player.jailTurns = 0;
    player.doubleCount = 0;
}

function makeEvent(player, type, data) {
    return { type, playerId: player ? player.userId : null, data: data || {} };
}

function log(state, message) {
    state.gameLog.push({ timestamp: new Date().toISOString(), message });
    state.gameLog = state.gameLog.slice(-100);
}

function shuffleDeck(arr) {
    const deck = arr.slice();
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function findNearestType(currentPos, type) {
    for (let i = 1; i <= 40; i++) {
        const candidate = (currentPos + i) % 40;
        if (BOARD_SQUARES[candidate].type === type) return candidate;
    }
    return currentPos;
}

function randomDie() {
    return Math.floor(Math.random() * 6) + 1;
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
