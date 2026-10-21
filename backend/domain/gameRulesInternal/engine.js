const { v4: uuidv4 } = require('uuid');

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
                ? tradeOfferExpiryFrom(state, normalizeDate(offer.createdAt))
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

function applyAction(inputState, actorUserId, action, options = {}) {
    const state = normalizeState(inputState);
    const events = [];
    const actor = state.players.find(player => player.userId === actorUserId);
    if (!actor) throw new GameRuleError(403, 'Actor is not a player in this game');
    if (state.ended && action.type !== 'host_end_game') throw new GameRuleError(400, 'Game has already ended');
    const hostControlTypes = new Set(['host_end_game', 'host_pause_game', 'host_resume_game', 'host_cancel_auction', 'host_cancel_trade_offer']);
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
            buyProperty(state, actor, events);
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
        case 'buy_shares':
            requireTurn();
            buyShares(state, actor, action.payload || {}, events);
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
        const rent = calculateRentForLanding(state, prop.id, diceTotal, options);
        const creditor = owner
            ? { type: 'player', id: owner.userId, name: owner.name, entity: owner }
            : { type: 'corporation', id: corporationOwner.id, name: `[${corporationOwner.ticker}]`, entity: corporationOwner };
        payCreditorAvailableCash(state, player, creditor, rent, `Rent for ${square.name}`, events, {
            propertyId: prop.id,
            propertyName: prop.name,
        });
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

function buyProperty(state, player, events) {
    const square = BOARD_SQUARES[player.position || 0];
    if (!square || !square.propertyId) throw new GameRuleError(400, 'You are not on a property');
    const prop = state.properties.find(p => p.id === square.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Property is not available');
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
    if (!player.diceRolled) throw new GameRuleError(400, 'Roll before starting an auction');
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
    const totalShares = positiveInt(payload.totalShares || payload.shares, 'shares');
    const pricePerShare = positiveNumber(payload.pricePerShare, 'pricePerShare');
    if (!ticker) throw new GameRuleError(400, 'Ticker is required');
    if (totalShares > 12) throw new GameRuleError(400, 'Shares must be 12 or fewer');
    if (state.corporations.some(c => c.ticker === ticker)) throw new GameRuleError(400, 'Ticker already exists');
    if (assetIds.length === 0) throw new GameRuleError(400, 'At least one asset is required');
    const assets = assetIds.map(id => {
        const prop = state.properties.find(p => p.id === id);
        if (!prop || prop.ownerId !== player.userId) throw new GameRuleError(400, 'IPO assets must be owned by founder');
        return { id: prop.id, name: prop.name, value: prop.price, color: prop.color };
    });
    const corporation = {
        id: `corp-${uuidv4()}`,
        ticker,
        name: `${ticker} Corporation`,
        founderId: player.userId,
        founderName: player.name,
        chairmanId: player.userId,
        chairmanName: player.name,
        totalShares,
        pricePerShare,
        assets,
        shareholders: [{ userId: player.userId, name: player.name, shares: totalShares }],
        availableShares: totalShares,
        treasuryShares: 0,
        cash: 0,
        debts: [],
        chairmanVotes: [],
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
        pricePerShare,
    }));
    log(state, `${player.name} created ${ticker} IPO with ${totalShares} founder-owned shares listed at $${pricePerShare} each`);
}

function buyShares(state, player, payload, events) {
    const corp = state.corporations.find(c => c.id === payload.corpId);
    if (!corp) throw new GameRuleError(404, 'Corporation not found');
    if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
    const shares = positiveInt(payload.shares, 'shares');
    const salePool = getShareSalePool(state, corp);
    const maxShares = player.userId === corp.founderId ? salePool.treasuryListedShares : salePool.totalListedShares;
    if (shares > maxShares) {
        if (player.userId === corp.founderId && salePool.founderListedShares > 0) {
            throw new GameRuleError(400, 'Founder cannot buy own listed shares');
        }
        throw new GameRuleError(400, 'Not enough shares available');
    }
    const totalCost = shares * corp.pricePerShare;
    if (player.cash < totalCost) throw new GameRuleError(400, 'Insufficient funds');

    let remaining = shares;
    const treasuryShares = Math.min(remaining, salePool.treasuryListedShares);
    const founderShares = remaining - treasuryShares;

    player.cash -= totalCost;
    if (treasuryShares > 0) {
        const treasuryCost = treasuryShares * corp.pricePerShare;
        corp.cash = Number(corp.cash || 0) + treasuryCost;
        corp.treasuryShares = Math.max(0, Number(corp.treasuryShares || 0) - treasuryShares);
        recordCashFlow(state, player.userId, corp.id, treasuryCost);
        remaining -= treasuryShares;
    }
    if (founderShares > 0) {
        if (!salePool.founder || !salePool.founderHolding || salePool.founder.bankrupt) {
            throw new GameRuleError(400, 'Founder listed shares are not available');
        }
        const founderCost = founderShares * corp.pricePerShare;
        salePool.founder.cash += founderCost;
        salePool.founderHolding.shares = Number(salePool.founderHolding.shares || 0) - founderShares;
        recordCashFlow(state, player.userId, salePool.founder.userId, founderCost);
    }

    addShareholderShares(corp, player, shares);
    removeZeroShareholders(corp);
    corp.availableShares = Math.max(0, Number(corp.availableShares || 0) - shares);
    normalizeCorporationShareLedger(state, corp);

    events.push(makeEvent(player, 'share_purchase', {
        buyer: player.name,
        ticker: corp.ticker,
        shares,
        totalCost,
        founderShares,
        treasuryShares,
        founderProceeds: founderShares * corp.pricePerShare,
        treasuryProceeds: treasuryShares * corp.pricePerShare,
        seller: founderShares > 0 ? salePool.founder.name : '[Treasury]',
    }));
    const proceedsParts = [];
    if (founderShares > 0) proceedsParts.push(`$${(founderShares * corp.pricePerShare).toFixed(2)} to ${salePool.founder.name}`);
    if (treasuryShares > 0) proceedsParts.push(`$${(treasuryShares * corp.pricePerShare).toFixed(2)} to ${corp.ticker} treasury`);
    log(state, `${player.name} bought ${shares} share(s) of ${corp.ticker} for $${totalCost.toFixed(2)} (${proceedsParts.join(', ')})`);
}

function issueDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const interestRate = positiveNumber(state.settings.interestRate, 'interestRate');
    if (interestRate > 100) throw new GameRuleError(400, 'Interest rate too high');
    const issuerType = payload.issuerType === 'corporation' ? 'corporation' : 'player';
    const collateralIds = Array.isArray(payload.collateralIds) ? payload.collateralIds : [];
    if (issuerType === 'corporation') {
        const corp = state.corporations.find(c => c.id === payload.corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
        if (!canManageCorporationDebt(corp, player.userId)) {
            throw new GameRuleError(403, 'Only the chairman or controlling shareholder can issue corporation debt');
        }
        const collateral = collateralIds.map(id => {
            const asset = corp.assets.find(item => item.id === id);
            if (!asset) throw new GameRuleError(400, 'Collateral must be owned by corporation');
            return { id: asset.id, name: asset.name, value: asset.value };
        });
        corp.debts.push({ id: `debt-${uuidv4()}`, principal: amount, interestRate, collateral, issueDate: new Date().toISOString(), issuerType: 'corporation' });
        corp.cash = Number(corp.cash || 0) + amount;
        recordCashFlow(state, null, corp.id, amount);
        events.push(makeEvent(player, 'debt_issued', { issuer: `[${corp.ticker}]`, actor: player.name, amount, interestRate }));
        log(state, `${player.name} issued debt under ${corp.ticker}: $${amount.toFixed(2)} @ ${interestRate}%`);
        return;
    }
    const collateral = collateralIds.map(id => {
        const prop = state.properties.find(p => p.id === id && p.ownerId === player.userId);
        if (!prop) throw new GameRuleError(400, 'Collateral must be owned by issuer');
        return { id: prop.id, name: prop.name, value: prop.price };
    });
    player.debts.push({ id: `debt-${uuidv4()}`, principal: amount, interestRate, collateral, issueDate: new Date().toISOString(), issuerType: 'player' });
    player.cash += amount;
    recordCashFlow(state, null, player.userId, amount);
    events.push(makeEvent(player, 'debt_issued', { issuer: player.name, amount, interestRate }));
    log(state, `${player.name} issued debt: $${amount.toFixed(2)} @ ${interestRate}%`);
}

function refinanceDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const interestRate = positiveNumber(state.settings.interestRate, 'interestRate');
    if (interestRate > 100) throw new GameRuleError(400, 'Interest rate too high');

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

    const collateralIds = Array.isArray(payload.collateralIds) ? uniqueIds(payload.collateralIds) : [];
    const collateral = collateralIds.map(id => {
        const prop = state.properties.find(p => p.id === id && p.ownerId === player.userId);
        if (!prop) throw new GameRuleError(400, 'Collateral must be owned by issuer');
        return { id: prop.id, name: prop.name, value: prop.price };
    });

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
        interestRate,
        collateral,
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
        refinancedDebtCount: selectedDebts.length,
    }));
    log(state, `${player.name} refinanced ${selectedDebts.length} debt(s) into $${amount.toFixed(2)} @ ${interestRate}% and received $${netProceeds.toFixed(2)} net cash`);
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

function getSaleableShares(corp) {
    return sharesFor(corp, corp.founderId) + Number(corp.treasuryShares || 0);
}

function getShareSalePool(state, corp) {
    const founder = state.players.find(player => player.userId === corp.founderId);
    const founderHolding = (corp.shareholders || []).find(shareholder => shareholder.userId === corp.founderId);
    const listedShares = Math.max(0, Math.floor(Number(corp.availableShares || 0)));
    const treasuryShares = Math.max(0, Math.floor(Number(corp.treasuryShares || 0)));
    const treasuryListedShares = Math.min(treasuryShares, listedShares);
    const founderListedShares = Math.min(
        Math.max(listedShares - treasuryListedShares, 0),
        Math.max(0, Number(founderHolding?.shares || 0))
    );
    return {
        founder,
        founderHolding,
        treasuryListedShares,
        founderListedShares,
        totalListedShares: treasuryListedShares + founderListedShares,
    };
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

function payDebt(state, player, payload, events) {
    const debt = player.debts.find(d => d.id === payload.debtId) || player.debts[Number(payload.debtIndex)];
    const amount = positiveNumber(payload.amount, 'amount');
    if (!debt) throw new GameRuleError(404, 'Debt not found');
    if (player.cash < amount) throw new GameRuleError(400, 'Insufficient funds');
    player.cash -= amount;
    debt.principal -= amount;
    recordCashFlow(state, player.userId, null, amount);
    if (debt.principal <= 0) player.debts = player.debts.filter(d => d !== debt);
    events.push(makeEvent(player, 'debt_payment', { payer: player.name, amount }));
    log(state, `${player.name} paid $${amount.toFixed(2)} towards debt`);
}

function buyHouses(state, player, payload, events) {
    const selections = payload.selections || {};
    let totalCost = 0;
    const changes = [];
    for (const [propId, deltaRaw] of Object.entries(selections)) {
        const delta = Number(deltaRaw);
        if (!Number.isInteger(delta) || delta <= 0) continue;
        const prop = state.properties.find(p => p.id === propId);
        if (!prop || prop.ownerId !== player.userId) throw new GameRuleError(400, 'Can only improve owned properties');
        if (!ownsCompleteGroup(state, player.userId, prop.color)) throw new GameRuleError(400, 'Must own complete color group');
        if (!HOUSE_COSTS[prop.color]) throw new GameRuleError(400, 'Cannot improve this property type');
        if ((prop.houses || 0) + delta > 5) throw new GameRuleError(400, 'Too many houses');
        totalCost += delta * HOUSE_COSTS[prop.color];
        changes.push({ prop, delta });
    }
    if (changes.length === 0) throw new GameRuleError(400, 'No houses selected');
    if (player.cash < totalCost) throw new GameRuleError(400, 'Insufficient funds');
    player.cash -= totalCost;
    recordCashFlow(state, player.userId, null, totalCost);
    changes.forEach(({ prop, delta }) => { prop.houses = (prop.houses || 0) + delta; });
    events.push(makeEvent(player, 'house_purchase', { player: player.name, cost: totalCost }));
    log(state, `${player.name} bought houses/hotels for $${totalCost}`);
}

function getTradeTerms(state, payload) {
    const player1 = state.players.find(p => p.userId === payload.player1Id);
    const player2 = state.players.find(p => p.userId === payload.player2Id);
    if (!player1 || !player2 || player1.userId === player2.userId) throw new GameRuleError(400, 'Invalid trade players');
    const player1Cash = nonNegativeNumber(payload.player1Cash || 0, 'player1Cash');
    const player2Cash = nonNegativeNumber(payload.player2Cash || 0, 'player2Cash');
    const player1AssetIds = uniqueIds(payload.player1AssetIds || []);
    const player2AssetIds = uniqueIds(payload.player2AssetIds || []);
    if (player1Cash <= 0 && player2Cash <= 0 && player1AssetIds.length === 0 && player2AssetIds.length === 0) {
        throw new GameRuleError(400, 'Trade must include cash or property');
    }
    return { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds };
}

function validateTradeTerms(state, terms) {
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds } = terms;
    if (player1.cash < player1Cash || player2.cash < player2Cash) throw new GameRuleError(400, 'Insufficient trade cash');
    validatePropertyTransferList(state, player1, player1AssetIds);
    validatePropertyTransferList(state, player2, player2AssetIds);
}

function applyTradeTransfer(state, terms) {
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds } = terms;
    player1.cash = player1.cash - player1Cash + player2Cash;
    player2.cash = player2.cash - player2Cash + player1Cash;
    if (player1Cash > 0) recordCashFlow(state, player1.userId, player2.userId, player1Cash);
    if (player2Cash > 0) recordCashFlow(state, player2.userId, player1.userId, player2Cash);
    transferProperties(state, player1, player2, player1AssetIds);
    transferProperties(state, player2, player1, player2AssetIds);
}

function trade(state, actor, payload, events) {
    const terms = getTradeTerms(state, payload);
    const { player1, player2, player1Cash, player2Cash } = terms;
    if (![player1.userId, player2.userId].includes(actor.userId)) throw new GameRuleError(403, 'Trade must involve acting player');
    validateTradeTerms(state, terms);
    applyTradeTransfer(state, terms);
    events.push(makeEvent(actor, 'transaction', { player1: player1.name, player2: player2.name, player1Cash, player2Cash }));
    log(state, `Transaction: ${player1.name} <-> ${player2.name}`);
}

function proposeTrade(state, actor, payload, events) {
    const terms = getTradeTerms(state, payload);
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds } = terms;
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
        player1Assets: player1AssetIds.length,
        player2Assets: player2AssetIds.length,
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
    applyTradeTransfer(state, terms);
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
        player1Assets: offer.player1AssetIds.length,
        player2Assets: offer.player2AssetIds.length,
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

function endTurn(state, player, events) {
    if (!player.diceRolled) throw new GameRuleError(400, 'Roll before ending turn');

    let totalInterest = 0;
    player.debts.forEach(debt => {
        const interest = debt.principal * (debt.interestRate / 100);
        debt.principal += interest;
        totalInterest += interest;
    });
    if (totalInterest > 0) {
        player.cash -= totalInterest;
        recordCashFlow(state, player.userId, null, totalInterest);
        events.push(makeEvent(player, 'interest_accrual', { player: player.name, interestCharged: totalInterest }));
        log(state, `${player.name} was charged $${totalInterest.toFixed(2)} in interest.`);
    }
    state.corporations.forEach(corp => {
        if (!canManageCorporationDebt(corp, player.userId)) return;
        let corpInterest = 0;
        (corp.debts || []).forEach(debt => {
            const interest = Number(debt.principal || 0) * (Number(debt.interestRate || 0) / 100);
            debt.principal += interest;
            corpInterest += interest;
        });
        if (corpInterest > 0) {
            corp.cash = Number(corp.cash || 0) - corpInterest;
            recordCashFlow(state, corp.id, null, corpInterest);
            events.push(makeEvent(player, 'interest_accrual', { player: `[${corp.ticker}]`, interestCharged: corpInterest }));
            log(state, `${corp.ticker} was charged $${corpInterest.toFixed(2)} in interest.`);
        }
        if (Number(corp.cash || 0) < 0) {
            resolveCorporationInsolvency(state, corp, player, events, {
                reason: 'interest',
                interestCharged: corpInterest,
            });
        }
    });
    const bankruptcyClaim = settleBankruptcyClaimAtTurnEnd(state, player, events);
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
    corp.pricePerShare = 0;
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

function payCreditorAvailableCash(state, debtor, creditor, amountOwed, reason, events, extra = {}) {
    const owed = Number(amountOwed || 0);
    if (owed <= 0) return;
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
    });
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

function sendToJail(player) {
    player.position = 10;
    player.inJail = true;
    player.jailTurns = 0;
    player.doubleCount = 0;
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

function positiveNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new GameRuleError(400, `${name} must be positive`);
    return number;
}

function nonNegativeNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new GameRuleError(400, `${name} must be non-negative`);
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
    validateStateInvariants,
    applyCardEffect,
    shuffleDeck,
    findNearestType,
    GameRuleError,
};
