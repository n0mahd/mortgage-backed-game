'use strict';

// Player-facing catalog of game actions and their payload shapes, plus a
// legality check for "what can this player do right now". Legality is decided
// by trial-running the authoritative applyAction on a throwaway copy of the
// state, so this module never re-implements game rules; it only proposes
// candidate payloads. Used by the MCP server; the engine stays the authority.

const { applyAction, GameRuleError } = require('./gameRules');

const ACTIONS = [
    { type: 'roll_dice', category: 'turn', payload: {}, description: 'Roll two dice and move. Your turn only; once per turn, again after doubles (three doubles = Jail), paying any rent still owed from your cash first (refused if your cash cannot cover it). In Jail this rolls for doubles.' },
    { type: 'pay_jail_fine', category: 'turn', payload: {}, description: 'Pay $50 to leave Jail before rolling.' },
    { type: 'use_get_out_of_jail_card', category: 'turn', payload: {}, description: 'Use your Get Out of Jail Free card before rolling.' },
    { type: 'buy_property', category: 'turn', payload: { corpId: '<corporation id you run (optional): buy it for that corporation from its treasury>' }, description: 'Buy the unowned property you are standing on at its list price, yourself or for a corporation you run.' },
    { type: 'start_auction', category: 'turn', payload: {}, description: 'Decline to buy the unowned property you are standing on and auction it to all players (after rolling).' },
    { type: 'end_turn', category: 'turn', payload: {}, description: 'End your turn (only after rolling, or after doubles while you cannot pay rent you owe). Debt interest is charged, then bankruptcy is checked if cash < 0 or rent is unpaid.' },
    { type: 'place_bid', category: 'auction', payload: { amount: 'number > current bid, <= your cash' }, description: 'Bid in the open auction.' },
    { type: 'pass_auction', category: 'auction', payload: {}, description: 'Pass in the open auction (the current high bidder cannot pass).' },
    { type: 'buy_houses', category: 'assets', payload: { selections: { '<propertyId>': 'integer houses to add (total per property <= 5; 5th = hotel)' }, corpId: '<corporation id you run (optional): build on its complete groups from its treasury>' }, description: 'Buy houses/hotels on properties where you (or the corporation you build for) own the complete color group. Your turn only.' },
    { type: 'create_ipo', category: 'assets', payload: { ticker: 'string, up to 8 letters/digits', totalShares: 'integer 1-12000 (optional, default 12000)', assetIds: ['<propertyId you own>'] }, description: 'Bundle your properties into a corporation; you get all of its shares. Nothing is listed for sale: others buy your shares by a propose_trade you accept. Your turn only.' },
    { type: 'add_to_corporation', category: 'assets', payload: { corpId: '<corporation id you run (chairman or majority holder)>', assetIds: ['<propertyId you own>'], issueShares: 'boolean (optional): take new shares for it' }, description: 'Put more of your properties into a corporation you run, at book value. With issueShares, you get whole new shares at the current value per share (rounded to the nearest share) so other holders keep their value; without it the property raises every share\'s value. A built colour group goes in whole. Your turn only.' },
    { type: 'buy_shares', category: 'assets', payload: { corpId: '<corporation id>', shares: 'integer > 0' }, description: 'Buy treasury shares a corporation has for sale, at its current share value (NAV). Shares a player holds can only be bought with a propose_trade they accept. Your turn only.' },
    { type: 'set_rent_policy', category: 'corporation', payload: { corpId: '<corporation id you run>', policy: "'payout' or 'reinvest'" }, description: 'Payout: rent goes straight to shareholders, and a shareholder landing there pays only the part they do not own. Reinvest: everyone pays full rent into the treasury. Your turn, before you roll. After a change it is locked for your next 5 turns; to change it sooner use propose_rent_policy_change.' },
    { type: 'propose_rent_policy_change', category: 'corporation', payload: { corpId: '<corporation id you hold shares in>', policy: "'payout' or 'reinvest'" }, description: 'Ask every shareholder to switch the rent policy; it switches the moment all of them agree (you count as agreeing). Works any time, including during the 5-turn lock. Any time.' },
    { type: 'vote_rent_policy_change', category: 'corporation', payload: { corpId: '<corporation id with an open rent policy vote>', approve: 'boolean' }, description: 'Agree to (approve: true) or reject (approve: false) an open rent policy vote; one rejection closes it. Any time.' },
    { type: 'pay_dividend', category: 'corporation', payload: { corpId: '<corporation id you run>', amount: 'number > 0, <= its treasury cash' }, description: 'Pay treasury cash to the shareholders by shares held; the slice for treasury shares stays. Your turn only.' },
    { type: 'offer_property_to_corporation', category: 'corporation', payload: { corpId: '<corporation id you do not run>', assetIds: ['<propertyId you own>'], price: 'number > 0 (optional; omit for book value)', payWith: "'shares' (default: new shares at the current value per share) or 'cash' (from its treasury)" }, description: "Offer properties to a corporation; its chairman accepts, declines or counters. Any time." },
    { type: 'respond_property_offer', category: 'corporation', payload: { offerId: '<pending property offer id>', response: "'accept', 'decline' or 'counter'", price: 'number > 0 (counter only)', payWith: "'shares' or 'cash' (counter only, optional)" }, description: 'Answer a property offer waiting for you (as offerer or as the corporation chairman); either side can decline or withdraw at any time.' },
    { type: 'issue_debt', category: 'debt', payload: { amount: 'number > 0, <= you.borrowing.available (all your loans together may reach 90% of the book value of your properties and shares)', termTurns: '5, 10 (default) or 15: turns until the whole balance is due', autopay: 'boolean, default true: pay each installment from cash at the end of your turn', issuerType: "'player' (default) or 'corporation'", corpId: '<corporation id, when issuerType is corporation>' }, description: "Borrow cash at the host's rate for the chosen term. Each End Turn charges interest; autopay pays the installment that clears the loan on schedule; unpaid interest is added to the balance. The whole balance is due at the end of the last turn, and if you can't pay it you go bankrupt. Your turn only." },
    { type: 'pay_debt', category: 'debt', payload: { debtId: '<your debt id>', amount: 'number > 0, <= your cash (more than the balance pays it off)', corpId: "<corporation id, for a loan of a corporation you run (optional)>" }, description: 'Repay part or all of a loan. Your turn only.' },
    { type: 'set_debt_autopay', category: 'debt', payload: { debtId: '<your debt id>', autopay: 'boolean', corpId: "<corporation id, for a loan of a corporation you run (optional)>" }, description: 'Turn autopay on or off for a loan. Allowed any time.' },
    { type: 'refinance_debt', category: 'debt', payload: { debtIds: ['<debt id>'], amount: 'number > 0: above the selected balance, within the borrowing limit (the replaced loans do not count); below it, the difference is paid from cash', termTurns: '5, 10 (default) or 15', corpId: "<corporation id, to refinance loans of a corporation you run (optional)>" }, description: "Replace one or more loans of one borrower (you, or a corporation you run) with one new loan on a fresh term. A larger loan pays out the cash above the payoff; a smaller one pays the balance down from the borrower's cash. Your turn only." },
    { type: 'propose_trade', category: 'market', payload: { player1Id: '<player id>', player2Id: '<player id>', player1Cash: 'number >= 0 paid by player1 to player2', player2Cash: 'number >= 0 paid by player2 to player1', player1AssetIds: ['<propertyId player1 gives>'], player2AssetIds: ['<propertyId player2 gives>'], player1Shares: [{ corpId: '<corporation id>', shares: 'integer > 0 player1 gives (optional)' }], player2Shares: [{ corpId: '<corporation id>', shares: 'integer > 0 player2 gives (optional)' }], player1PropertiesToCorpId: '<corporation id player2 runs: player1AssetIds properties go into it instead of to player2 (optional)>', player2PropertiesToCorpId: '<corporation id player1 runs: player2AssetIds properties go into it instead of to player1 (optional)>', player1CorpId: '<corporation id player1 runs (optional): player1 trades for it>', player2CorpId: '<corporation id player2 runs (optional): player2 trades for it>', counterOfferId: '<pending offer id made to you (optional): counter it; same two players, and the original closes as countered>' }, description: 'Offer a trade of cash, properties and/or corporation shares; you must be player1 or player2. The other player must accept. A one-sided offer sends shares as a gift. To buy into an LLC with a property, give the property with *PropertiesToCorpId set to the LLC and ask for its shares. With *CorpId a side trades for a corporation it runs: its cash, properties and own treasury shares, and it can buy back its own shares; a runner cannot trade personally with their corporation. Allowed any time.' },
    { type: 'accept_trade', category: 'market', payload: { offerId: '<pending offer id>' }, description: 'Accept a pending trade offer made to you.' },
    { type: 'cancel_trade', category: 'market', payload: { offerId: '<pending offer id>' }, description: 'Cancel your own pending offer, or decline one made to you. To counter one instead, use propose_trade with counterOfferId.' },
    { type: 'manual_payment', category: 'market', payload: { fromPlayerId: '<your player id>', toPlayerId: '<player id>', toCorpId: '<corporation id (optional): pay into its treasury instead of a player>', issueShares: 'boolean (optional, with toCorpId, only for a corporation you run): take new shares at the current value per share', amount: 'number > 0' }, description: "Pay another player cash directly (side deals, gifts), or with toCorpId put cash into a corporation's treasury. That is a gift that raises every share's value, unless you run the corporation and set issueShares: then you get whole new shares at the current value per share. Allowed any time." },
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
    const myPriciestPropertyId = state.properties.filter(prop => prop.ownerId === me.userId)
        .reduce((best, prop) => (!best || Number(prop.price || 0) > Number(best.price || 0) ? prop : best), null)?.id;

    ['roll_dice', 'pay_jail_fine', 'use_get_out_of_jail_card', 'buy_property', 'start_auction', 'end_turn', 'pass_auction'].forEach(type => add(type));

    if (state.auction?.status === 'open') {
        add('place_bid', { amount: Math.floor(Number(state.auction.currentBid || 0)) + 1 });
    }

    myPropertyIds.forEach(id => add('buy_houses', { selections: { [id]: 1 } }));
    if (myPropertyIds.length > 0) {
        add('create_ipo', { ticker: 'NEWCO', totalShares: 10, assetIds: [myPropertyIds[0]] });
    }
    state.corporations.forEach(corp => {
        add('buy_shares', { corpId: corp.id, shares: 1 });
        const otherPolicy = corp.rentPolicy === 'payout' ? 'reinvest' : 'payout';
        add('set_rent_policy', { corpId: corp.id, policy: otherPolicy });
        add('propose_rent_policy_change', { corpId: corp.id, policy: otherPolicy });
        if (corp.rentPolicyVote) {
            add('vote_rent_policy_change', { corpId: corp.id, approve: true });
            add('vote_rent_policy_change', { corpId: corp.id, approve: false });
        }
        add('pay_dividend', { corpId: corp.id, amount: Math.max(1, Math.floor(Number(corp.cash || 0))) });
        (corp.debts || []).forEach(debt => {
            add('refinance_debt', { corpId: corp.id, debtIds: [debt.id], amount: Number(debt.principal || 0) });
        });
        add('buy_property', { corpId: corp.id });
        const corpPropertyIds = state.properties.filter(prop => prop.ownerId === corp.id).map(prop => prop.id);
        corpPropertyIds.forEach(id => add('buy_houses', { corpId: corp.id, selections: { [id]: 1 } }));
        if (myPriciestPropertyId) add('offer_property_to_corporation', { corpId: corp.id, assetIds: [myPriciestPropertyId] });
        add('manual_payment', { fromPlayerId: me.userId, toCorpId: corp.id, amount: 1 });
        add('manual_payment', { fromPlayerId: me.userId, toCorpId: corp.id, amount: Math.max(1, Math.floor(Number(me.cash || 0))), issueShares: true });
        others.forEach(other => {
            add('propose_trade', { player1Id: me.userId, player1CorpId: corp.id, player2Id: other.userId, player1Cash: 1, player2Cash: 0, player1AssetIds: [], player2AssetIds: [] });
        });
        if (myPropertyIds.length > 0) {
            // The priciest property is the likeliest to be worth a whole share.
            add('add_to_corporation', { corpId: corp.id, assetIds: [myPriciestPropertyId], issueShares: true });
            add('add_to_corporation', { corpId: corp.id, assetIds: [myPropertyIds[0]] });
        }
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

    // Loans stay within 90% of the borrower's portfolio; offer the smallest
    // valid shape and let the dry run decide.
    add('issue_debt', { amount: 1 });
    (me.debts || []).forEach(debt => {
        add('pay_debt', { debtId: debt.id, amount: Math.min(Number(debt.principal || 0), Math.max(Number(me.cash || 0), 1)) });
        add('set_debt_autopay', { debtId: debt.id, autopay: debt.autopay === false });
        add('refinance_debt', { debtIds: [debt.id], amount: Number(debt.principal || 0) });
    });

    others.forEach(other => {
        add('propose_trade', { player1Id: me.userId, player2Id: other.userId, player1Cash: 1, player2Cash: 0, player1AssetIds: [], player2AssetIds: [] });
        add('manual_payment', { fromPlayerId: me.userId, toPlayerId: other.userId, amount: 1 });
    });

    (state.propertyOffers || []).filter(offer => offer.status === 'pending').forEach(offer => {
        add('respond_property_offer', { offerId: offer.id, response: 'accept' });
        add('respond_property_offer', { offerId: offer.id, response: 'decline' });
    });
    (state.marketOffers || []).filter(offer => offer.status === 'pending').forEach(offer => {
        add('accept_trade', { offerId: offer.id });
        if (offer.recipientId === me.userId) {
            add('propose_trade', { player1Id: me.userId, player2Id: offer.proposedById, player1Cash: 1, player2Cash: 0, player1AssetIds: [], player2AssetIds: [], counterOfferId: offer.id });
        }
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
