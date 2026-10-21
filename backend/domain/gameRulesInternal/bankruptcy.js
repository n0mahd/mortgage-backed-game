// Bankruptcy: unpaid-rent claims, paying creditors what cash allows, and
// liquidating a bankrupt player.

const { makeEvent, log } = require('./util');
const { recordCashFlow } = require('./ledger');
const {
    setChairman,
    addShareholderShares,
    removeZeroShareholders,
    normalizeCorporationShareLedger,
    returnSharesToTreasury,
    addCorporationAsset,
} = require('./corporations');

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

module.exports = {
    liquidateBankruptPlayer,
    clearBankruptcyClaim,
    payCreditorAvailableCash,
    settleBankruptcyClaimAtTurnEnd,
    normalizeBankruptcyClaims,
};
