// Corporations (LLCs): IPOs, share purchases, the share ledger, chairman
// changes and votes, and corporation insolvency.

const { v4: uuidv4 } = require('uuid');
const { makeEvent, log, positiveNumber, positiveInt, GameRuleError } = require('./util');
const { recordCashFlow } = require('./ledger');

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

module.exports = {
    createIPO,
    buyShares,
    canManageCorporationDebt,
    controlsCorporation,
    changeChairman,
    proposeChairmanVote,
    supportChairmanVote,
    setChairman,
    sharesFor,
    addShareholderShares,
    removeZeroShareholders,
    normalizeCorporationShareLedger,
    getSaleableShares,
    returnSharesToTreasury,
    addCorporationAsset,
    resolveCorporationInsolvency,
};
