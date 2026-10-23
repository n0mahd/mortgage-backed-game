// Running a corporation: adding properties to it, rent policy and its votes,
// dividends, and property offers to the corporation (share maths lives in
// corporateFinance.js).
//
// The chairman (or a majority holder) runs an LLC: sets what happens to its
// rent, pays dividends, and spends the treasury on property, houses and
// trades. A runner can't move treasury cash to themselves except through a
// dividend every holder shares.

const { v4: uuidv4 } = require('uuid');
const {
    MAX_CORPORATION_SHARES,
    RENT_POLICY_COOLDOWN_TURNS,
    splitByShares,
    sharesForPrice,
} = require('./corporateFinance');
const {
    expiresAfter,
    isExpired,
    markResolved,
    hasMovedThisTurn,
    uniqueIds,
    makeEvent,
    log,
    roundCents,
    positiveNumber,
    GameRuleError,
} = require('./util');
const {
    requireWholeBuiltGroups,
    calculateCorporationNetAssetValue,
    recordCashFlow,
} = require('./ledger');
const {
    runCorporation,
    requireTreasuryCash,
    activeShareholders,
    payFromTreasury,
    describePayouts,
    controlsCorporation,
    sharesFor,
    addShareholderShares,
    normalizeCorporationShareLedger,
    snapshotHoldings,
    chairMajorityHolder,
} = require('./corporations');
const { getBankruptcyClaim } = require('./bankruptcy');
const { propertyBookValue } = require('./debt');
const {
    transferPropertiesToCorporation,
} = require('./trades');

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
        expiresAt: expiresAfter(state.settings.tradeOfferTimeoutMs, now),
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
    if (isExpired(offer)) throw new GameRuleError(400, 'That property offer has expired');
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
        markResolved(offer, actor);
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
        offer.expiresAt = expiresAfter(state.settings.tradeOfferTimeoutMs, new Date());
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
    markResolved(offer, actor);
    events.push(makeEvent(actor, 'property_offer_accepted', { ...propertyOfferEventData(state, offer, actor), newShares, totalShares: corp.totalShares }));
    const paidWith = newShares > 0 ? `${newShares} new shares` : `$${quote.price.toFixed(2)} from the treasury`;
    log(state, `${offer.ticker} took ${propertyNames(state, offer.assetIds)} from ${offerer.name} for ${paidWith}`);
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
        const reason = isExpired(offer) ? 'timeout'
            : (!corp || corp.insolvent ? 'corporation_insolvent' : (!offerer || offerer.bankrupt ? 'bankruptcy' : null));
        if (!reason) return;
        offer.status = reason === 'timeout' ? 'expired' : 'canceled';
        offer.cancelReason = reason;
        markResolved(offer, actor);
        events.push(makeEvent(actor, 'property_offer_closed', { ...propertyOfferEventData(state, offer, actor), status: offer.status, reason }));
    });
}

module.exports = {
    addToCorporation,
    setRentPolicy,
    normalizeRentPolicyVote,
    proposeRentPolicyChange,
    voteRentPolicyChange,
    payDividend,
    offerPropertyToCorporation,
    respondPropertyOffer,
    expirePendingPropertyOffers,
};
