'use strict';

// Player-facing catalog of game actions and their payload shapes, plus a
// legality check for "what can this player do right now". Legality is decided
// by trial-running the authoritative applyAction on a throwaway copy of the
// state, so this module never re-implements game rules; it only proposes
// candidate payloads. Used by the MCP server; the engine stays the authority.

const { applyAction, GameRuleError } = require('./gameRules');

const ACTIONS = [
    { type: 'roll_dice', category: 'turn', payload: {}, description: 'Roll two dice and move. Your turn only; once per turn, again after doubles (three doubles = Jail). In Jail this rolls for doubles.' },
    { type: 'pay_jail_fine', category: 'turn', payload: {}, description: 'Pay $50 to leave Jail before rolling.' },
    { type: 'use_get_out_of_jail_card', category: 'turn', payload: {}, description: 'Use your Get Out of Jail Free card before rolling.' },
    { type: 'buy_property', category: 'turn', payload: {}, description: 'Buy the unowned property you are standing on at its list price.' },
    { type: 'start_auction', category: 'turn', payload: {}, description: 'Decline to buy the unowned property you are standing on and auction it to all players (after rolling).' },
    { type: 'end_turn', category: 'turn', payload: {}, description: 'End your turn (only after rolling). Debt interest is charged, then bankruptcy is checked if cash < 0 or rent is unpaid.' },
    { type: 'place_bid', category: 'auction', payload: { amount: 'number > current bid, <= your cash' }, description: 'Bid in the open auction.' },
    { type: 'pass_auction', category: 'auction', payload: {}, description: 'Pass in the open auction (the current high bidder cannot pass).' },
    { type: 'buy_houses', category: 'assets', payload: { selections: { '<propertyId>': 'integer houses to add (total per property <= 5; 5th = hotel)' } }, description: 'Buy houses/hotels on properties where you own the complete color group. Your turn only.' },
    { type: 'create_ipo', category: 'assets', payload: { ticker: 'string, up to 8 letters/digits', totalShares: 'integer 1-12', pricePerShare: 'number > 0', assetIds: ['<propertyId you own>'] }, description: 'Bundle your properties into a corporation; you get all shares and they are listed for sale. Your turn only.' },
    { type: 'buy_shares', category: 'assets', payload: { corpId: '<corporation id>', shares: 'integer > 0' }, description: 'Buy treasury shares a corporation has for sale, at its price. Shares a player holds can only be bought with a propose_trade they accept. Your turn only.' },
    { type: 'issue_debt', category: 'debt', payload: { amount: 'number > 0', collateralIds: ['<propertyId you own, not already backing a loan> (required; amount <= 90% of their value)'], issuerType: "'player' (default) or 'corporation'", corpId: '<corporation id, when issuerType is corporation>' }, description: 'Borrow cash at the room debt rate; interest compounds each time you end your turn. Your turn only.' },
    { type: 'pay_debt', category: 'debt', payload: { debtId: '<your debt id>', amount: 'number > 0, <= your cash' }, description: 'Repay part or all of a debt. Your turn only.' },
    { type: 'refinance_debt', category: 'debt', payload: { debtIds: ['<your debt id>'], amount: 'number > total principal of selected debts', collateralIds: ['<propertyId you own, not already backing a loan> (required; amount <= 90% of their value)'] }, description: 'Replace selected debts with one new loan; you receive the cash above the payoff. Your turn only.' },
    { type: 'propose_trade', category: 'market', payload: { player1Id: '<player id>', player2Id: '<player id>', player1Cash: 'number >= 0 paid by player1 to player2', player2Cash: 'number >= 0 paid by player2 to player1', player1AssetIds: ['<propertyId player1 gives>'], player2AssetIds: ['<propertyId player2 gives>'], player1Shares: [{ corpId: '<corporation id>', shares: 'integer > 0 player1 gives (optional)' }], player2Shares: [{ corpId: '<corporation id>', shares: 'integer > 0 player2 gives (optional)' }], player1PropertiesToCorpId: '<corporation id player2 runs: player1AssetIds properties go into it instead of to player2 (optional)>', player2PropertiesToCorpId: '<corporation id player1 runs: player2AssetIds properties go into it instead of to player1 (optional)>' }, description: 'Offer a trade of cash, properties and/or corporation shares; you must be player1 or player2. The other player must accept. A one-sided offer sends shares as a gift. To buy into an LLC with a property, give the property with *PropertiesToCorpId set to the LLC and ask for its shares. Allowed any time.' },
    { type: 'accept_trade', category: 'market', payload: { offerId: '<pending offer id>' }, description: 'Accept a pending trade offer made to you.' },
    { type: 'cancel_trade', category: 'market', payload: { offerId: '<pending offer id>' }, description: 'Cancel your own pending offer, or decline one made to you.' },
    { type: 'manual_payment', category: 'market', payload: { fromPlayerId: '<your player id>', toPlayerId: '<player id>', amount: 'number > 0' }, description: 'Pay another player cash directly (side deals, gifts).' },
    { type: 'change_chairman', category: 'governance', payload: { corpId: '<corporation id>', candidateUserId: '<player id>' }, description: 'Majority shareholder sets the corporation chairman directly.' },
    { type: 'propose_chairman_vote', category: 'governance', payload: { corpId: '<corporation id>', candidateUserId: '<player id>' }, description: 'Shareholder proposes a chairman; passes when supporters hold a majority.' },
    { type: 'support_chairman_vote', category: 'governance', payload: { corpId: '<corporation id>', voteId: '<open vote id>' }, description: 'Support an open chairman vote.' },
    { type: 'host_pause_game', category: 'host', payload: { reason: 'string (optional)' }, description: 'Host only: pause the game for everyone.' },
    { type: 'host_resume_game', category: 'host', payload: {}, description: 'Host only: resume a paused game.' },
    { type: 'host_cancel_auction', category: 'host', payload: {}, description: 'Host only: cancel a stuck auction (no cash or property moves).' },
    { type: 'host_cancel_trade_offer', category: 'host', payload: { offerId: '<pending offer id>' }, description: 'Host only: cancel an abandoned trade offer.' },
    { type: 'host_end_game', category: 'host', payload: {}, description: 'Host only: end the game now for everyone; standings by net worth.' },
];

const ACTIONS_BY_TYPE = new Map(ACTIONS.map(action => [action.type, action]));

// Returns [{ type, category, description, payload, examples }] for the actions
// this player could submit right now. `examples` are payloads the engine
// accepted in a dry run; for free-form actions they show one valid shape.
function listLegalActions(state, userId, { hostId } = {}) {
    const me = (state.players || []).find(player => player.userId === userId);
    if (!me || state.ended) return [];

    const legal = new Map();
    for (const candidate of buildCandidates(state, me, hostId)) {
        if (!trialSucceeds(state, userId, candidate, hostId)) continue;
        const entry = legal.get(candidate.type) || { ...ACTIONS_BY_TYPE.get(candidate.type), examples: [] };
        entry.examples.push(candidate.payload);
        legal.set(candidate.type, entry);
    }
    return ACTIONS.filter(action => legal.has(action.type)).map(action => legal.get(action.type));
}

function trialSucceeds(state, userId, candidate, hostId) {
    try {
        applyAction(state, userId, { type: candidate.type, payload: candidate.payload }, { hostId, dice: [1, 2] });
        return true;
    } catch (err) {
        if (err instanceof GameRuleError) return false;
        throw err;
    }
}

function buildCandidates(state, me, hostId) {
    const candidates = [];
    const add = (type, payload = {}) => candidates.push({ type, payload });
    const others = state.players.filter(player => player.userId !== me.userId && !player.bankrupt);
    const myPropertyIds = state.properties.filter(prop => prop.ownerId === me.userId).map(prop => prop.id);

    ['roll_dice', 'pay_jail_fine', 'use_get_out_of_jail_card', 'buy_property', 'start_auction', 'end_turn', 'pass_auction'].forEach(type => add(type));

    if (state.auction?.status === 'open') {
        add('place_bid', { amount: Math.floor(Number(state.auction.currentBid || 0)) + 1 });
    }

    myPropertyIds.forEach(id => add('buy_houses', { selections: { [id]: 1 } }));
    if (myPropertyIds.length > 0) {
        add('create_ipo', { ticker: 'NEWCO', totalShares: 10, pricePerShare: 50, assetIds: [myPropertyIds[0]] });
    }
    state.corporations.forEach(corp => {
        add('buy_shares', { corpId: corp.id, shares: 1 });
        others.forEach(other => {
            add('change_chairman', { corpId: corp.id, candidateUserId: other.userId });
            add('propose_chairman_vote', { corpId: corp.id, candidateUserId: other.userId });
        });
        add('change_chairman', { corpId: corp.id, candidateUserId: me.userId });
        add('propose_chairman_vote', { corpId: corp.id, candidateUserId: me.userId });
        (corp.chairmanVotes || []).filter(vote => vote.status === 'open').forEach(vote => {
            add('support_chairman_vote', { corpId: corp.id, voteId: vote.id });
        });
    });

    // Loans need collateral and stay within 90% of its value; offer the smallest
    // valid shape and let the dry run decide.
    const pledged = new Set([...state.players.flatMap(p => p.debts || []), ...state.corporations.flatMap(c => c.debts || [])]
        .flatMap(debt => (debt.collateral || []).map(item => item.id)));
    const freeCollateral = state.properties.find(prop => prop.ownerId === me.userId && !pledged.has(prop.id));
    if (freeCollateral) add('issue_debt', { amount: 1, collateralIds: [freeCollateral.id] });
    (me.debts || []).forEach(debt => {
        add('pay_debt', { debtId: debt.id, amount: Math.min(Number(debt.principal || 0), Math.max(Number(me.cash || 0), 1)) });
        const collateralIds = (debt.collateral || []).map(item => item.id);
        add('refinance_debt', { debtIds: [debt.id], amount: Math.ceil(Number(debt.principal || 0)) + 1, collateralIds });
    });

    others.forEach(other => {
        add('propose_trade', { player1Id: me.userId, player2Id: other.userId, player1Cash: 1, player2Cash: 0, player1AssetIds: [], player2AssetIds: [] });
        add('manual_payment', { fromPlayerId: me.userId, toPlayerId: other.userId, amount: 1 });
    });

    (state.marketOffers || []).filter(offer => offer.status === 'pending').forEach(offer => {
        add('accept_trade', { offerId: offer.id });
        add('cancel_trade', { offerId: offer.id });
        add('host_cancel_trade_offer', { offerId: offer.id });
    });

    if (hostId === me.userId) {
        ['host_pause_game', 'host_resume_game', 'host_cancel_auction', 'host_end_game'].forEach(type => add(type));
    }
    return candidates;
}

module.exports = {
    ACTIONS,
    listLegalActions,
};
