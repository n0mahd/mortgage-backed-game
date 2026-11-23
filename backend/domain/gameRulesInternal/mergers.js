'use strict';

// Mergers: one corporation (the acquirer) takes over another (the target).
//
// Whoever runs the acquirer proposes terms for the whole target: cash from the
// treasury and a stake (a percent) of the merged company, paid in new acquirer
// shares. Every target share gets the same deal; shares the target's treasury
// holds get nothing. Optionally the merged company takes a new ticker.
//
// The target's shareholders vote, weighted by shares. Holders on the buying
// side (anyone who runs the acquirer) count as yes for every target share they
// hold, so a buyer who owns most of the target passes it alone. The merger
// closes the moment yes votes pass half of the target's shares held by
// players, and fails the moment it can no longer get there. It also
// ends when the proposer's turn comes round again, if the proposer withdraws
// it, or if either company can no longer take part.
//
// On closing, the target's properties (with their buildings), cash and loans
// move to the acquirer, its owners get their cash and new shares, and the
// target closes with status 'merged'. A merged company has no shares,
// properties, cash, debt or chairman, so nothing can act on it.

const { v4: uuidv4 } = require('uuid');
const {
    MAX_MERGER_STAKE_PERCENT,
    mergerNewShares,
    fairMergerStakePercent,
    splitByShares,
    splitWholeShares,
} = require('./corporateFinance');
const { makeEvent, log, roundCents, markResolved, GameRuleError } = require('./util');
const {
    calculateCorporationNetAssetValue,
    calculateCorporationShareValue,
    recordCashFlow,
} = require('./ledger');
const {
    runCorporation,
    controlsCorporation,
    corporationClosed,
    activeShareholders,
    addShareholderShares,
    normalizeCorporationShareLedger,
    snapshotHoldings,
    chairMajorityHolder,
    addCorporationAsset,
} = require('./corporations');

const MERGER_HISTORY_LIMIT = 20;

function normalizeTicker(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function normalizeMergerProposals(list) {
    if (!Array.isArray(list)) return [];
    const proposals = list
        .filter(item => item && item.id && item.acquirerId && item.targetId)
        .map(item => ({
            ...item,
            status: item.status || 'open',
            cash: roundCents(Number(item.cash || 0)),
            stakePercent: Number(item.stakePercent || 0),
            ticker: item.ticker ? normalizeTicker(item.ticker) : null,
            votes: item.votes && typeof item.votes === 'object' && !Array.isArray(item.votes) ? item.votes : {},
        }));
    const closed = proposals.filter(item => item.status !== 'open').slice(-MERGER_HISTORY_LIMIT);
    return proposals.filter(item => item.status === 'open' || closed.includes(item));
}

function openMergers(state) {
    return (state.mergerProposals || []).filter(item => item.status === 'open');
}

function findCorp(state, corpId) {
    return state.corporations.find(corp => corp.id === corpId) || null;
}

// The merger's numbers right now: each company's value, the new shares, the
// merged company, and what each target owner gets. Used to validate, to close
// and to show agents the deal.
function mergerQuote(state, acquirer, target, cash, stakePercent) {
    const acquirerValue = roundCents(calculateCorporationNetAssetValue(state, acquirer));
    const targetValue = roundCents(calculateCorporationNetAssetValue(state, target));
    const owners = activeShareholders(state, target).map(holder => ({
        userId: holder.player.userId,
        name: holder.player.name,
        player: holder.player,
        shares: holder.shares,
    }));
    const newShares = mergerNewShares(stakePercent, acquirer.totalShares);
    const cashParts = splitByShares(cash, owners).parts;
    const shareParts = splitWholeShares(newShares, owners);
    const cashPaid = roundCents(cashParts.reduce((sum, part) => sum + part.amount, 0));
    const mergedValue = roundCents(acquirerValue + targetValue - cashPaid);
    const totalSharesAfter = Number(acquirer.totalShares || 0) + newShares;
    const shareValueAfter = totalSharesAfter > 0 ? Math.max(0, mergedValue) / totalSharesAfter : 0;
    const targetShareValue = calculateCorporationShareValue(state, target);
    // What the owners' shares are worth today: treasury shares are left out.
    const ownersValue = roundCents(owners.reduce((sum, owner) => sum + owner.shares, 0) * targetShareValue);
    const payouts = owners.map(owner => {
        const cashPart = cashParts.find(part => part.userId === owner.userId)?.amount || 0;
        const sharesPart = shareParts.find(part => part.userId === owner.userId)?.newShares || 0;
        return {
            userId: owner.userId,
            name: owner.name,
            player: owner.player,
            targetShares: owner.shares,
            cash: cashPart,
            newShares: sharesPart,
            valueBefore: roundCents(owner.shares * targetShareValue),
            valueAfter: roundCents(cashPart + sharesPart * shareValueAfter),
        };
    });
    return {
        acquirerValue,
        targetValue,
        cash: cashPaid,
        stakePercent,
        newShares,
        totalSharesAfter,
        mergedValue,
        shareValueAfter,
        offerValue: roundCents(cashPaid + newShares * shareValueAfter),
        ownersValue,
        fairStakePercent: fairMergerStakePercent(acquirerValue, targetValue, cashPaid, ownersValue),
        payouts,
    };
}

// The vote on a merger right now. Every active target shareholder's shares
// count. Holders who run the acquirer back their own offer, so their shares
// count as yes (buyerSide) and they don't cast a vote; the rest are voters.
function mergerTally(state, proposal) {
    const acquirer = findCorp(state, proposal.acquirerId);
    const target = findCorp(state, proposal.targetId);
    if (!acquirer || !target) return { voters: [], buyerSide: [], votingShares: 0, yesShares: 0, noShares: 0, neededShares: 1 };
    const holders = activeShareholders(state, target).map(holder => ({
        userId: holder.player.userId,
        name: holder.player.name,
        shares: holder.shares,
    }));
    const runsBuyer = holder => controlsCorporation(acquirer, holder.userId);
    const buyerSide = holders.filter(runsBuyer).map(holder => ({ ...holder, vote: true }));
    const voters = holders.filter(holder => !runsBuyer(holder)).map(holder => ({
        ...holder,
        vote: Object.hasOwn(proposal.votes, holder.userId) ? proposal.votes[holder.userId] : null,
    }));
    const sum = list => list.reduce((total, voter) => total + voter.shares, 0);
    const votingShares = sum(holders);
    return {
        voters,
        buyerSide,
        votingShares,
        yesShares: sum(buyerSide) + sum(voters.filter(voter => voter.vote === true)),
        noShares: sum(voters.filter(voter => voter.vote === false)),
        // More than half of the target's shares held by players.
        neededShares: Math.floor(votingShares / 2) + 1,
    };
}

function requireMergerTerms(state, acquirer, target, payload) {
    if (!target) throw new GameRuleError(404, 'Corporation to merge with not found');
    if (target.id === acquirer.id) throw new GameRuleError(400, 'A corporation cannot merge with itself');
    if (corporationClosed(target)) throw new GameRuleError(400, `${target.ticker} is closed and cannot merge`);
    const cash = payload.cash === undefined || payload.cash === null || payload.cash === '' ? 0 : Number(payload.cash);
    if (!Number.isFinite(cash) || cash < 0) throw new GameRuleError(400, 'Cash must be $0 or more');
    const stakePercent = payload.stakePercent === undefined || payload.stakePercent === null || payload.stakePercent === '' ? 0 : Number(payload.stakePercent);
    if (!Number.isFinite(stakePercent) || stakePercent < 0 || stakePercent > MAX_MERGER_STAKE_PERCENT) {
        throw new GameRuleError(400, `The stake must be 0% to ${MAX_MERGER_STAKE_PERCENT}% of the merged company`);
    }
    const terms = { cash: roundCents(cash), stakePercent: Math.round(stakePercent * 100) / 100 };
    const available = roundCents(Number(acquirer.cash || 0) + Number(target.cash || 0));
    if (terms.cash > available + 1e-9) {
        throw new GameRuleError(400, `${acquirer.ticker} and ${target.ticker} have $${available.toFixed(2)} in cash between them, not enough for $${terms.cash.toFixed(2)}`);
    }
    if (terms.stakePercent > 0 && mergerNewShares(terms.stakePercent, acquirer.totalShares) === 0) {
        throw new GameRuleError(400, `That stake is less than one ${acquirer.ticker} share`);
    }
    return terms;
}

// The merged company's ticker: null keeps the acquirer's. It may take the
// target's ticker; otherwise it must be unused.
function requireMergerTicker(state, acquirer, target, raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker || ticker === acquirer.ticker) return null;
    if (ticker !== target.ticker && state.corporations.some(corp => corp.ticker === ticker)) {
        throw new GameRuleError(400, `The ticker ${ticker} is already taken`);
    }
    return ticker;
}

function requireNoOpenMerger(state, corp) {
    const open = openMergers(state).find(item => item.acquirerId === corp.id || item.targetId === corp.id);
    if (open) throw new GameRuleError(400, `${corp.ticker} is already in a merger vote (${open.targetTicker} into ${open.acquirerTicker})`);
}

function proposeMerger(state, player, payload, events) {
    const acquirer = runCorporation(state, player, payload.acquirerId);
    const target = findCorp(state, payload.targetId);
    const terms = requireMergerTerms(state, acquirer, target, payload);
    const ticker = requireMergerTicker(state, acquirer, target, payload.ticker);
    requireNoOpenMerger(state, acquirer);
    requireNoOpenMerger(state, target);
    const quote = mergerQuote(state, acquirer, target, terms.cash, terms.stakePercent);
    const proposal = {
        id: `merger-${uuidv4()}`,
        status: 'open',
        acquirerId: acquirer.id,
        acquirerTicker: acquirer.ticker,
        targetId: target.id,
        targetTicker: target.ticker,
        proposedById: player.userId,
        proposedByName: player.name,
        cash: terms.cash,
        stakePercent: terms.stakePercent,
        newShares: quote.newShares,
        ticker,
        votes: {},
        createdAt: new Date().toISOString(),
    };
    state.mergerProposals.push(proposal);
    events.push(makeEvent(player, 'merger_proposed', mergerEventData(proposal, player)));
    log(state, `${player.name} proposed merging ${target.ticker} into ${acquirer.ticker}: ${describeTerms(proposal)} for all of ${target.ticker}. ${target.ticker}'s owners vote.`);
    settleMergers(state, events, player);
}

function voteMerger(state, player, payload, events) {
    const proposal = openMergers(state).find(item => item.id === payload.mergerId);
    if (!proposal) throw new GameRuleError(404, 'Open merger vote not found');
    const tally = mergerTally(state, proposal);
    const voter = tally.voters.find(item => item.userId === player.userId);
    if (!voter) {
        throw new GameRuleError(403, tally.buyerSide.some(item => item.userId === player.userId)
            ? `You run ${proposal.acquirerTicker}, so your ${proposal.targetTicker} shares already count as yes`
            : `Only ${proposal.targetTicker} shareholders vote on this merger`);
    }
    if (typeof payload.approve !== 'boolean') throw new GameRuleError(400, 'approve must be true or false');
    proposal.votes[player.userId] = payload.approve;
    events.push(makeEvent(player, 'merger_vote', { ...mergerEventData(proposal, player), approve: payload.approve }));
    log(state, `${player.name} voted ${payload.approve ? 'yes' : 'no'} on merging ${proposal.targetTicker} into ${proposal.acquirerTicker}.`);
    settleMergers(state, events, player);
}

function withdrawMerger(state, player, payload, events) {
    const proposal = openMergers(state).find(item => item.id === payload.mergerId);
    if (!proposal) throw new GameRuleError(404, 'Open merger vote not found');
    const acquirer = findCorp(state, proposal.acquirerId);
    if (proposal.proposedById !== player.userId && !controlsCorporation(acquirer, player.userId)) {
        throw new GameRuleError(403, `Only ${proposal.proposedByName} or whoever runs ${proposal.acquirerTicker} can withdraw this merger`);
    }
    closeMerger(state, proposal, 'withdrawn', player, events);
    log(state, `${player.name} withdrew the merger of ${proposal.targetTicker} into ${proposal.acquirerTicker}.`);
}

function closeMerger(state, proposal, status, actor, events, reason = null) {
    proposal.status = status;
    if (reason) proposal.closeReason = reason;
    markResolved(proposal, actor || { userId: null, name: null });
    events.push(makeEvent(actor, 'merger_closed', { ...mergerEventData(proposal, actor), status, reason }));
}

// Settles every open merger: cancels one that can no longer happen, closes one
// whose vote passed (or can no longer pass). Runs after every action, since a
// bankruptcy or a share trade can change who votes.
function settleMergers(state, events, actor = null) {
    openMergers(state).forEach(proposal => {
        const acquirer = findCorp(state, proposal.acquirerId);
        const target = findCorp(state, proposal.targetId);
        const proposer = state.players.find(p => p.userId === proposal.proposedById);
        const who = actor || proposer;
        if (!acquirer || !target || corporationClosed(acquirer) || corporationClosed(target)) {
            closeMerger(state, proposal, 'canceled', who, events, 'corporation_closed');
            log(state, `The merger of ${proposal.targetTicker} into ${proposal.acquirerTicker} was canceled: one of the companies closed.`);
            return;
        }
        if (!proposer || proposer.bankrupt) {
            closeMerger(state, proposal, 'canceled', who, events, 'bankruptcy');
            log(state, `The merger of ${proposal.targetTicker} into ${proposal.acquirerTicker} was canceled: ${proposal.proposedByName} went bankrupt.`);
            return;
        }
        const tally = mergerTally(state, proposal);
        if (tally.votingShares === 0 || tally.yesShares * 2 > tally.votingShares) {
            completeMerger(state, proposal, acquirer, target, who, events);
            return;
        }
        if (tally.noShares * 2 >= tally.votingShares) {
            closeMerger(state, proposal, 'rejected', who, events);
            log(state, `${proposal.targetTicker}'s owners voted down merging into ${proposal.acquirerTicker}.`);
        }
    });
}

function completeMerger(state, proposal, acquirer, target, actor, events) {
    // The terms are checked again: cash and holdings may have moved since.
    let terms;
    let ticker;
    try {
        terms = requireMergerTerms(state, acquirer, target, proposal);
        ticker = requireMergerTicker(state, acquirer, target, proposal.ticker);
    } catch (error) {
        if (!(error instanceof GameRuleError)) throw error;
        closeMerger(state, proposal, 'canceled', actor, events, 'cannot_complete');
        log(state, `The merger of ${proposal.targetTicker} into ${proposal.acquirerTicker} passed but could not go through: ${error.message}.`);
        return;
    }
    const quote = mergerQuote(state, acquirer, target, terms.cash, terms.stakePercent);
    const holdersBefore = snapshotHoldings(acquirer);

    // The target's properties (with buildings), cash and loans join the acquirer.
    const movedProperties = [];
    state.properties.forEach(prop => {
        if (prop.ownerId !== target.id) return;
        prop.ownerId = acquirer.id;
        prop.ownerName = `[${acquirer.ticker}]`;
        addCorporationAsset(acquirer, prop);
        movedProperties.push(prop.name);
    });
    const targetCash = roundCents(Number(target.cash || 0));
    acquirer.cash = roundCents(Number(acquirer.cash || 0) + targetCash);
    recordCashFlow(state, target.id, acquirer.id, targetCash, { kind: 'merger', note: `${acquirer.ticker} took over ${target.ticker}` });
    const movedDebt = roundCents((target.debts || []).reduce((sum, debt) => sum + Number(debt.principal || 0), 0));
    acquirer.debts = [...(acquirer.debts || []), ...(target.debts || [])];

    // Every target owner gets the same per share: cash, then new shares.
    quote.payouts.forEach(payout => {
        if (payout.cash > 0) {
            acquirer.cash = roundCents(Number(acquirer.cash || 0) - payout.cash);
            payout.player.cash = roundCents(Number(payout.player.cash || 0) + payout.cash);
            recordCashFlow(state, acquirer.id, payout.userId, payout.cash, { kind: 'merger', note: `Cash for your ${target.ticker} shares in the ${acquirer.ticker} takeover` });
        }
        if (payout.newShares > 0) addShareholderShares(acquirer, payout.player, payout.newShares);
    });
    acquirer.totalShares = Number(acquirer.totalShares || 0) + quote.newShares;
    normalizeCorporationShareLedger(state, acquirer);

    const oldTicker = acquirer.ticker;
    if (ticker) renameCorporation(state, acquirer, ticker);
    closeTarget(state, target, acquirer, oldTicker, quote, movedProperties, movedDebt);
    chairMajorityHolder(state, acquirer, holdersBefore, actor, events);

    proposal.status = 'passed';
    proposal.newShares = quote.newShares;
    proposal.cash = quote.cash;
    proposal.mergedTicker = acquirer.ticker;
    proposal.payouts = quote.payouts.map(({ player, ...payout }) => payout);
    markResolved(proposal, actor);
    events.push(makeEvent(actor, 'merger_completed', {
        ...mergerEventData(proposal, actor),
        properties: movedProperties,
        debt: movedDebt,
        mergedValue: quote.mergedValue,
        payouts: proposal.payouts,
    }));
    const renamed = ticker ? ` ${oldTicker} is now ${acquirer.ticker}.` : '';
    const paid = proposal.payouts.length
        ? ` ${target.ticker}'s owners got ${proposal.payouts.map(p => `${p.name} ${describePayout(p, acquirer.ticker)}`).join(', ')}.`
        : '';
    log(state, `${target.ticker} merged into ${oldTicker}: its properties, cash and loans joined ${oldTicker}.${paid}${renamed}`);
}

function renameCorporation(state, corp, ticker) {
    const oldTicker = corp.ticker;
    if (corp.name === `${oldTicker} Corporation`) corp.name = `${ticker} Corporation`;
    corp.ticker = ticker;
    state.properties.forEach(prop => {
        if (prop.ownerId === corp.id) prop.ownerName = `[${ticker}]`;
    });
    (state.propertyOffers || []).forEach(offer => {
        if (offer.status === 'pending' && offer.corpId === corp.id) offer.ticker = ticker;
    });
    Object.values(state.bankruptcyClaims || {}).forEach(claim => {
        if (claim.creditorId === corp.id) claim.creditorName = ticker;
    });
}

// The target is left as an empty shell marked merged, so its history and the
// screens that list it still make sense.
function closeTarget(state, target, acquirer, oldTicker, quote, movedProperties, movedDebt) {
    const now = new Date().toISOString();
    target.status = 'merged';
    // ticker is the merged company's ticker now; acquirerTicker what it was
    // called before (they differ when the merger renamed it, possibly to the
    // target's own ticker).
    target.mergedInto = { corpId: acquirer.id, ticker: acquirer.ticker, acquirerTicker: oldTicker, at: now };
    target.mergerSummary = {
        cash: quote.cash,
        newShares: quote.newShares,
        properties: movedProperties.length,
        debt: movedDebt,
    };
    target.assets = [];
    target.cash = 0;
    target.debts = [];
    target.shareholders = [];
    target.totalShares = 0;
    target.treasuryShares = 0;
    target.availableShares = 0;
    target.chairmanId = null;
    target.chairmanName = null;
    target.rentPolicyVote = null;
    target.chairmanVotes = (target.chairmanVotes || []).map(vote => (vote.status === 'open'
        ? { ...vote, status: 'closed', closedAt: now, closeReason: 'corporation_merged' }
        : vote));
    // Rent still owed to the target is now owed to the acquirer.
    Object.values(state.bankruptcyClaims || {}).forEach(claim => {
        if (claim.creditorId !== target.id) return;
        claim.creditorId = acquirer.id;
        claim.creditorName = acquirer.ticker;
    });
    // Offers to or from the target can no longer go through.
    (state.propertyOffers || []).forEach(offer => {
        if (offer.status !== 'pending' || offer.corpId !== target.id) return;
        offer.status = 'canceled';
        offer.cancelReason = 'corporation_merged';
        offer.resolvedAt = now;
    });
    (state.marketOffers || []).forEach(offer => {
        if (offer.status !== 'pending' || !tradeOfferTouches(offer, target.id)) return;
        offer.status = 'canceled';
        offer.cancelReason = 'corporation_merged';
        offer.resolvedAt = now;
    });
}

function tradeOfferTouches(offer, corpId) {
    const ids = [offer.player1CorpId, offer.player2CorpId, offer.player1PropertiesToCorpId, offer.player2PropertiesToCorpId];
    const shares = [...(offer.player1Shares || []), ...(offer.player2Shares || [])].map(item => item?.corpId);
    return [...ids, ...shares].includes(corpId);
}

// Called by End Turn once the next player is chosen: a merger vote ends
// unresolved when its proposer's turn comes round again.
function startTurnForMergers(state, nextPlayer, events) {
    settleMergers(state, events, nextPlayer);
    openMergers(state).forEach(proposal => {
        if (proposal.proposedById !== nextPlayer.userId) return;
        closeMerger(state, proposal, 'expired', nextPlayer, events);
        log(state, `The vote to merge ${proposal.targetTicker} into ${proposal.acquirerTicker} expired before ${proposal.proposedByName}'s turn came round.`);
    });
}

function describePayout(payout, ticker) {
    const parts = [];
    if (payout.newShares > 0) parts.push(`${payout.newShares} ${ticker}`);
    if (payout.cash > 0) parts.push(`$${payout.cash.toFixed(2)}`);
    return parts.join(' + ') || 'nothing';
}

function describeTerms(proposal) {
    const parts = [];
    if (proposal.cash > 0) parts.push(`$${proposal.cash.toFixed(2)} in cash`);
    if (proposal.stakePercent > 0) parts.push(`${proposal.stakePercent}% of the merged company`);
    const terms = parts.join(' and ') || 'nothing';
    return proposal.ticker ? `${terms}, renamed ${proposal.ticker},` : terms;
}

function mergerEventData(proposal, actor) {
    return {
        mergerId: proposal.id,
        actor: actor?.name || null,
        proposer: proposal.proposedByName,
        acquirer: proposal.acquirerTicker,
        target: proposal.targetTicker,
        cash: proposal.cash,
        stakePercent: proposal.stakePercent,
        ticker: proposal.ticker,
    };
}

module.exports = {
    normalizeMergerProposals,
    mergerQuote,
    mergerTally,
    proposeMerger,
    voteMerger,
    withdrawMerger,
    settleMergers,
    startTurnForMergers,
};
