// Trades between players: offers, consent, expiry, asset transfer, and
// direct payments.

const { v4: uuidv4 } = require('uuid');
const { JAIL_CARD_ASSET_ID } = require('./board');
const {
    expiresAfter,
    isExpired,
    markResolved,
    uniqueIds,
    makeEvent,
    log,
    positiveNumber,
    nonNegativeNumber,
    positiveInt,
    GameRuleError,
} = require('./util');
const { recordCashFlow, transferProperties, validatePropertyTransferList } = require('./ledger');
const {
    controlsCorporation,
    sharesFor,
    addShareholderShares,
    removeZeroShareholders,
    normalizeCorporationShareLedger,
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
    if (player1Cash <= 0 && player2Cash <= 0 && player1AssetIds.length === 0 && player2AssetIds.length === 0
        && player1Shares.length === 0 && player2Shares.length === 0) {
        throw new GameRuleError(400, 'Trade must include cash, property or shares');
    }
    return {
        player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds, player1Shares, player2Shares,
        player1PropertiesToCorpId, player2PropertiesToCorpId,
    };
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

function transferShares(state, from, to, shareList) {
    shareList.forEach(({ corpId, shares }) => {
        const corp = state.corporations.find(c => c.id === corpId);
        const holder = corp.shareholders.find(shareholder => shareholder.userId === from.userId);
        holder.shares = Number(holder.shares || 0) - shares;
        addShareholderShares(corp, to, shares);
        removeZeroShareholders(corp);
        normalizeCorporationShareLedger(state, corp);
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
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds } = terms;
    if (player1.cash < player1Cash || player2.cash < player2Cash) throw new GameRuleError(400, 'Insufficient trade cash');
    const side1 = splitTradeAssets(player1AssetIds);
    const side2 = splitTradeAssets(player2AssetIds);
    validatePropertyTransferList(state, player1, side1.propertyIds);
    validatePropertyTransferList(state, player2, side2.propertyIds);
    validateShareTransferList(state, player1, terms.player1Shares);
    validateShareTransferList(state, player2, terms.player2Shares);
    validatePropertyDestination(state, side1.propertyIds, player2, terms.player1PropertiesToCorpId);
    validatePropertyDestination(state, side2.propertyIds, player1, terms.player2PropertiesToCorpId);
    validateJailCardTransfer(player1, player2, side1.jailCard, side2.jailCard);
    validateJailCardTransfer(player2, player1, side2.jailCard, side1.jailCard);
}

function validateJailCardTransfer(from, to, givesCard, receivesCard) {
    if (!givesCard) return;
    if (!from.hasGetOutOfJailCard) throw new GameRuleError(400, `${from.name} has no Get Out of Jail Free card to trade`);
    if (to.hasGetOutOfJailCard && !receivesCard) {
        throw new GameRuleError(400, `${to.name} already holds a Get Out of Jail Free card`);
    }
}

function applyTradeTransfer(state, terms) {
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds } = terms;
    const side1 = splitTradeAssets(player1AssetIds);
    const side2 = splitTradeAssets(player2AssetIds);
    player1.cash = player1.cash - player1Cash + player2Cash;
    player2.cash = player2.cash - player2Cash + player1Cash;
    if (player1Cash > 0) recordCashFlow(state, player1.userId, player2.userId, player1Cash);
    if (player2Cash > 0) recordCashFlow(state, player2.userId, player1.userId, player2Cash);
    transferTradeProperties(state, player1, player2, side1.propertyIds, terms.player1PropertiesToCorpId);
    transferTradeProperties(state, player2, player1, side2.propertyIds, terms.player2PropertiesToCorpId);
    transferShares(state, player1, player2, terms.player1Shares);
    transferShares(state, player2, player1, terms.player2Shares);
    if (side1.jailCard !== side2.jailCard) {
        const giver = side1.jailCard ? player1 : player2;
        const receiver = side1.jailCard ? player2 : player1;
        giver.hasGetOutOfJailCard = false;
        receiver.hasGetOutOfJailCard = true;
    }
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
    const { player1, player2, player1Cash, player2Cash, player1AssetIds, player2AssetIds, player1Shares, player2Shares } = terms;
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
        player1Shares,
        player2Shares,
        player1PropertiesToCorpId: terms.player1PropertiesToCorpId,
        player2PropertiesToCorpId: terms.player2PropertiesToCorpId,
        createdAt,
        expiresAt: expiresAfter(state.settings.tradeOfferTimeoutMs, now),
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
        player1Assets: tradeAssetCount(player1AssetIds, player1Shares),
        player2Assets: tradeAssetCount(player2AssetIds, player2Shares),
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
    trade,
    proposeTrade,
    acceptTrade,
    cancelTrade,
    hostCancelTradeOffer,
    expirePendingTradeOffersIfNeeded,
    cancelPendingTradeOffersForPlayer,
    manualPayment,
};
