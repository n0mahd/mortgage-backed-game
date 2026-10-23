// The single entry point for game-state changes: guards every action and
// dispatches it to its rules module.

const { requireHost, GameRuleError } = require('./util');
const {
    createIPO,
    buyShares,
    changeChairman,
    proposeChairmanVote,
    supportChairmanVote,
} = require('./corporations');
const {
    rollDice,
    payJailFine,
    useGetOutOfJailCard,
    buyProperty,
    buyHouses,
} = require('./movement');
const {
    startAuction,
    placeAuctionBid,
    passAuction,
    expireOpenAuctionIfNeeded,
    hostCancelAuction,
} = require('./auctions');
const { issueDebt, refinanceDebt, payDebt, setDebtAutopay } = require('./debt');
const {
    trade,
    proposeTrade,
    acceptTrade,
    cancelTrade,
    hostCancelTradeOffer,
    expirePendingTradeOffersIfNeeded,
    manualPayment,
} = require('./trades');
const {
    addToCorporation,
    setRentPolicy,
    proposeRentPolicyChange,
    voteRentPolicyChange,
    payDividend,
    offerPropertyToCorporation,
    respondPropertyOffer,
    expirePendingPropertyOffers,
} = require('./corporationManagement');
const { endTurn, finishGame, pauseGame, resumeGame } = require('./turns');
const { normalizeState, validateStateInvariants, syncDerivedPortfolios } = require('./state');


// Every action type, with who may take it:
//   turn: only the current player    host: only the room host
// Anything else may be taken by any active player (the handler checks the rest).
const ACTIONS = {
    roll_dice: { turn: true, run: c => rollDice(c.state, c.actor, c.events, c.options) },
    pay_jail_fine: { turn: true, run: c => payJailFine(c.state, c.actor, c.events) },
    use_get_out_of_jail_card: { turn: true, run: c => useGetOutOfJailCard(c.state, c.actor, c.events) },
    buy_property: { turn: true, run: c => buyProperty(c.state, c.actor, c.payload, c.events) },
    buy_houses: { turn: true, run: c => buyHouses(c.state, c.actor, c.payload, c.events) },
    end_turn: { turn: true, run: c => endTurn(c.state, c.actor, c.events) },

    start_auction: { turn: true, run: c => startAuction(c.state, c.actor, c.events) },
    place_bid: { run: c => placeAuctionBid(c.state, c.actor, c.payload, c.events) },
    pass_auction: { run: c => passAuction(c.state, c.actor, c.events) },

    create_ipo: { turn: true, run: c => createIPO(c.state, c.actor, c.payload, c.events) },
    add_to_corporation: { turn: true, run: c => addToCorporation(c.state, c.actor, c.payload, c.events) },
    buy_shares: { turn: true, run: c => buyShares(c.state, c.actor, c.payload, c.events) },
    set_rent_policy: { turn: true, run: c => setRentPolicy(c.state, c.actor, c.payload, c.events) },
    propose_rent_policy_change: { run: c => proposeRentPolicyChange(c.state, c.actor, c.payload, c.events) },
    vote_rent_policy_change: { run: c => voteRentPolicyChange(c.state, c.actor, c.payload, c.events) },
    pay_dividend: { turn: true, run: c => payDividend(c.state, c.actor, c.payload, c.events) },
    offer_property_to_corporation: { run: c => offerPropertyToCorporation(c.state, c.actor, c.payload, c.events) },
    respond_property_offer: { run: c => respondPropertyOffer(c.state, c.actor, c.payload, c.events) },
    change_chairman: { run: c => changeChairman(c.state, c.actor, c.payload, c.events) },
    propose_chairman_vote: { run: c => proposeChairmanVote(c.state, c.actor, c.payload, c.events) },
    support_chairman_vote: { run: c => supportChairmanVote(c.state, c.actor, c.payload, c.events) },

    issue_debt: { turn: true, run: c => issueDebt(c.state, c.actor, c.payload, c.events) },
    pay_debt: { turn: true, run: c => payDebt(c.state, c.actor, c.payload, c.events) },
    refinance_debt: { turn: true, run: c => refinanceDebt(c.state, c.actor, c.payload, c.events) },
    set_debt_autopay: { run: c => setDebtAutopay(c.state, c.actor, c.payload, c.events) },

    propose_trade: { run: c => proposeTrade(c.state, c.actor, c.payload, c.events) },
    accept_trade: { run: c => acceptTrade(c.state, c.actor, c.payload, c.events) },
    cancel_trade: { run: c => cancelTrade(c.state, c.actor, c.payload, c.events) },
    trade: { run: c => trade(c.state, c.actor, c.payload, c.events) },
    manual_payment: { run: c => manualPayment(c.state, c.actor, c.payload, c.events) },

    host_cancel_auction: { host: true, run: c => hostCancelAuction(c.state, c.actor, c.events) },
    host_cancel_trade_offer: { host: true, run: c => hostCancelTradeOffer(c.state, c.actor, c.payload, c.events) },
    host_pause_game: { host: true, run: c => pauseGame(c.state, c.actor, c.payload, c.events) },
    host_resume_game: { host: true, run: c => resumeGame(c.state, c.actor, c.events) },
    host_end_game: { host: true, run: c => finishGame(c.state, 'Host ended the game.', c.events) },
};

// Host actions also work while the game is paused, for a bankrupt host, and
// for a host who only watches (no seat).
const HOST_ACTION_TYPES = new Set(Object.keys(ACTIONS).filter(type => ACTIONS[type].host));
// The only actions allowed while an auction is open.
const AUCTION_OPEN_ACTION_TYPES = new Set([
    'start_auction', 'place_bid', 'pass_auction',
    'host_cancel_auction', 'host_pause_game', 'host_resume_game', 'host_end_game',
]);
// Actions that resolve a trade offer; if the offer just expired they stop there.
const TRADE_OFFER_ACTION_TYPES = new Set(['accept_trade', 'cancel_trade', 'host_cancel_trade_offer']);

// Applies one action to a copy of the state. Returns { state, events } or
// throws GameRuleError. options: { hostId, dice } (dice is for tests).
function applyAction(inputState, actorUserId, action, options = {}) {
    const state = normalizeState(inputState);
    const events = [];
    const type = action.type;
    const payload = action.payload || {};
    // A host who only watches (no seat) still runs the host controls.
    const actor = state.players.find(player => player.userId === actorUserId)
        || (options.hostId && options.hostId === actorUserId && HOST_ACTION_TYPES.has(type) ? { userId: actorUserId, name: 'Host' } : null);
    if (!actor) throw new GameRuleError(403, 'Actor is not a player in this game');
    if (state.ended && type !== 'host_end_game') throw new GameRuleError(400, 'Game has already ended');
    if (actor.bankrupt && !HOST_ACTION_TYPES.has(type)) throw new GameRuleError(403, 'Bankrupt player cannot act');
    if (state.paused && !HOST_ACTION_TYPES.has(type)) throw new GameRuleError(400, 'Game is paused');

    const finish = () => {
        syncDerivedPortfolios(state);
        const invariant = validateStateInvariants(state);
        if (invariant) throw new GameRuleError(400, invariant);
        return { state, events };
    };

    // Timed-out auctions and offers resolve on the next action. If this action
    // was aimed at the one that just resolved, that resolution is its result.
    const auctionJustExpired = expireOpenAuctionIfNeeded(state, actor, events);
    if (auctionJustExpired && ['place_bid', 'pass_auction', 'host_cancel_auction'].includes(type)) {
        if (type === 'host_cancel_auction') requireHost(options, actorUserId);
        return finish();
    }
    if (TRADE_OFFER_ACTION_TYPES.has(type)) {
        const expiredOfferIds = expirePendingTradeOffersIfNeeded(state, actor, events);
        if (expiredOfferIds.has(payload.offerId)) {
            if (type === 'host_cancel_trade_offer') requireHost(options, actorUserId);
            return finish();
        }
    }
    if (state.auction?.status === 'open' && !AUCTION_OPEN_ACTION_TYPES.has(type)) {
        throw new GameRuleError(400, 'Resolve auction before other actions');
    }

    const rule = Object.hasOwn(ACTIONS, type) ? ACTIONS[type] : null;
    if (!rule) throw new GameRuleError(400, 'Unknown action type');
    if (rule.turn && state.players[state.currentPlayerIndex]?.userId !== actorUserId) {
        throw new GameRuleError(403, 'Not the current player');
    }
    if (rule.host) requireHost(options, actorUserId);
    rule.run({ state, actor, payload, events, options });

    if (!TRADE_OFFER_ACTION_TYPES.has(type)) expirePendingTradeOffersIfNeeded(state, actor, events);
    expirePendingPropertyOffers(state, actor, events);
    return finish();
}

module.exports = {
    applyAction,
};
