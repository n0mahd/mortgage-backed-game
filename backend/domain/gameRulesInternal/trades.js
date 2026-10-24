// Trades between players and corporations: offers, consent, expiry, asset
// transfer, and direct payments.

const { v4: uuidv4 } = require('uuid');
const { JAIL_CARD_ASSET_ID } = require('./board');
const {
    expiresAfter,
    isExpired,
    markResolved,
    uniqueIds,
    makeEvent,
    log,
    roundCents,
    positiveNumber,
    nonNegativeNumber,
    positiveInt,
    GameRuleError,
} = require('./util');
const {
    recordCashFlow,
    transferProperties,
    validatePropertyTransferList,
    groupHasBuildings,
} = require('./ledger');
const {
    removeCorporationAsset,
    controlsCorporation,
    sharesFor,
    addShareholderShares,
    removeZeroShareholders,
    normalizeCorporationShareLedger,
    snapshotHoldings,
    chairMajorityHolder,
    addCorporationAsset,
} = require('./corporations');

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

function proposeTrade(state, actor, payload, events) {
    const terms = getTradeTerms(state, payload);
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds, player1Shares, player2Shares } = terms;
    if (![player1.userId, player2.userId].includes(actor.userId)) throw new GameRuleError(403, 'Trade must involve acting player');
    const countered = payload.counterOfferId ? findCounterableTradeOffer(state, actor, payload.counterOfferId, terms) : null;
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
        expiresAt: expiresAfter(state.settings.tradeOfferTimeoutMs, now),
        counterToOfferId: countered ? countered.id : null,
    };
    if (countered) {
        // A counteroffer answers the original: it closes as countered, and the new offer replaces it.
        countered.status = 'countered';
        countered.counteredByOfferId = offer.id;
        markResolved(countered, actor, createdAt);
    }
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
        counterOfferId: offer.counterToOfferId,
    }));
    log(state, countered
        ? `${actor.name} countered ${recipient.name}'s trade offer`
        : `${actor.name} proposed a trade with ${recipient.name}`);
}

// Only the player an offer is waiting on can counter it, with a trade between the same two players.
function findCounterableTradeOffer(state, actor, offerId, terms) {
    const offer = findPendingTradeOffer(state, offerId);
    if (offer.recipientId !== actor.userId) throw new GameRuleError(403, 'Only the player an offer was made to can counter it');
    if (isExpired(offer)) throw new GameRuleError(400, 'That trade offer has expired');
    const players = [terms.player1.userId, terms.player2.userId].sort().join('|');
    if (players !== [offer.player1Id, offer.player2Id].sort().join('|')) {
        throw new GameRuleError(400, 'A counteroffer must be between the same two players');
    }
    return offer;
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
    markResolved(offer, actor);
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
    markResolved(offer, actor);
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
        if (offer.status !== 'pending' || !isExpired(offer)) return;
        offer.status = 'expired';
        offer.cancelReason = 'timeout';
        markResolved(offer, actor, now);
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

function cancelPendingTradeOffersForPlayer(state, player, events) {
    const now = new Date().toISOString();
    (state.marketOffers || []).forEach(offer => {
        if (offer.status !== 'pending') return;
        if (![offer.player1Id, offer.player2Id].includes(player.userId)) return;
        offer.status = 'canceled';
        offer.cancelReason = 'bankruptcy';
        markResolved(offer, player, now);
        events.push(makeEvent(player, 'trade_offer_canceled', {
            offerId: offer.id,
            proposer: offer.proposedByName,
            actor: player.name,
            status: offer.status,
            reason: 'bankruptcy',
        }));
    });
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

module.exports = {
    transferPropertiesToCorporation,
    proposeTrade,
    acceptTrade,
    cancelTrade,
    hostCancelTradeOffer,
    expirePendingTradeOffersIfNeeded,
    cancelPendingTradeOffersForPlayer,
    manualPayment,
};
