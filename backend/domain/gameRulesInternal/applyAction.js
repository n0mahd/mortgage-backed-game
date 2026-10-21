// The single entry point for game-state changes: guards every action and
// dispatches it to its rules module.

const { requireHost, makeEvent, GameRuleError } = require('./util');
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
const { issueDebt, refinanceDebt, payDebt } = require('./debt');
const {
    trade,
    proposeTrade,
    acceptTrade,
    cancelTrade,
    hostCancelTradeOffer,
    expirePendingTradeOffersIfNeeded,
    manualPayment,
} = require('./trades');
const { endTurn, finishGame, pauseGame, resumeGame } = require('./turns');
const { normalizeState, validateStateInvariants, syncDerivedPortfolios } = require('./state');

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

module.exports = {
    applyAction,
};
