// Property auctions: start, bid, pass, expiry, and host cancellation.

const { v4: uuidv4 } = require('uuid');
const { BOARD_SQUARES } = require('./board');
const { makeEvent, log, positiveNumber, GameRuleError } = require('./util');
const { recordCashFlow } = require('./ledger');

function startAuction(state, player, events) {
    if (state.auction?.status === 'open') throw new GameRuleError(400, 'Auction already in progress');
    if (!player.diceRolled) throw new GameRuleError(400, 'Roll before starting an auction');
    const square = BOARD_SQUARES[player.position || 0];
    if (!square || !square.propertyId) throw new GameRuleError(400, 'You are not on a property');
    const prop = state.properties.find(p => p.id === square.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Property is not available');
    const now = new Date();
    const createdAt = now.toISOString();

    state.auction = {
        id: `auction-${uuidv4()}`,
        status: 'open',
        propertyId: prop.id,
        propertyName: prop.name,
        startedById: player.userId,
        startedByName: player.name,
        currentBid: 0,
        highBidderId: null,
        highBidderName: null,
        passedPlayerIds: [],
        createdAt,
        updatedAt: createdAt,
        expiresAt: auctionExpiryFrom(state, now),
    };
    events.push(makeEvent(player, 'property_auction_started', {
        auctionId: state.auction.id,
        property: prop.name,
        startedBy: player.name,
        expiresAt: state.auction.expiresAt,
    }));
    log(state, `${player.name} started an auction for ${prop.name}`);
}

function placeAuctionBid(state, actor, payload, events) {
    const auction = getOpenAuction(state);
    const prop = state.properties.find(p => p.id === auction.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Auction property is not available');
    if ((auction.passedPlayerIds || []).includes(actor.userId)) throw new GameRuleError(400, 'Player has already passed this auction');
    const amount = positiveNumber(payload.amount, 'bid');
    if (amount <= Number(auction.currentBid || 0)) throw new GameRuleError(400, 'Bid must exceed current bid');
    if (actor.cash < amount) throw new GameRuleError(400, 'Insufficient funds');

    auction.currentBid = amount;
    auction.highBidderId = actor.userId;
    auction.highBidderName = actor.name;
    const now = new Date();
    auction.updatedAt = now.toISOString();
    auction.expiresAt = auctionExpiryFrom(state, now);
    events.push(makeEvent(actor, 'property_auction_bid', {
        auctionId: auction.id,
        property: auction.propertyName,
        bidder: actor.name,
        amount,
        expiresAt: auction.expiresAt,
    }));
    log(state, `${actor.name} bid $${amount.toFixed(2)} for ${auction.propertyName}`);
}

function passAuction(state, actor, events) {
    const auction = getOpenAuction(state);
    if (auction.highBidderId === actor.userId) throw new GameRuleError(400, 'Current high bidder cannot pass');
    auction.passedPlayerIds = Array.isArray(auction.passedPlayerIds) ? auction.passedPlayerIds : [];
    if (!auction.passedPlayerIds.includes(actor.userId)) {
        auction.passedPlayerIds.push(actor.userId);
        const now = new Date();
        auction.updatedAt = now.toISOString();
        auction.expiresAt = auctionExpiryFrom(state, now);
        events.push(makeEvent(actor, 'property_auction_passed', {
            auctionId: auction.id,
            property: auction.propertyName,
            player: actor.name,
            expiresAt: auction.expiresAt,
        }));
        log(state, `${actor.name} passed on the auction for ${auction.propertyName}`);
    }
    settleAuctionIfComplete(state, actor, events);
}

function settleAuctionIfComplete(state, actor, events) {
    const auction = getOpenAuction(state);
    const activePlayers = state.players.filter(player => !player.bankrupt);
    const passed = new Set(auction.passedPlayerIds || []);
    const unresolved = activePlayers.filter(player => player.userId !== auction.highBidderId && !passed.has(player.userId));
    if (unresolved.length > 0) return;

    if (!auction.highBidderId) {
        closeAuctionNoSale(state, actor, events, 'passes');
        return;
    }

    closeAuctionSold(state, actor, events, 'passes');
}

function expireOpenAuctionIfNeeded(state, actor, events) {
    if (!state.auction || state.auction.status !== 'open') return false;
    if (!isAuctionExpired(state.auction)) return false;
    if (state.auction.highBidderId) {
        closeAuctionSold(state, actor, events, 'timeout');
    } else {
        closeAuctionNoSale(state, actor, events, 'timeout');
    }
    return true;
}

function isAuctionExpired(auction) {
    if (!auction?.expiresAt) return false;
    const expiresAt = new Date(auction.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function auctionExpiryFrom(state, date = new Date()) {
    const timeoutMs = Math.max(Number(state.settings?.auctionTimeoutMs || 0), 1000);
    return new Date(date.getTime() + timeoutMs).toISOString();
}

function closeAuctionNoSale(state, actor, events, reason) {
    const auction = getOpenAuction(state);
    auction.status = 'no_sale';
    auction.closeReason = reason;
    auction.resolvedAt = new Date().toISOString();
    auction.resolvedById = actor.userId;
    auction.resolvedByName = actor.name;
    events.push(makeEvent(actor, 'property_auction_no_sale', {
        auctionId: auction.id,
        property: auction.propertyName,
        reason,
    }));
    const reasonText = reason === 'timeout' ? ' after timing out' : '';
    log(state, `Auction for ${auction.propertyName} ended with no sale${reasonText}`);
}

function closeAuctionSold(state, actor, events, reason) {
    const auction = getOpenAuction(state);
    const winner = state.players.find(player => player.userId === auction.highBidderId);
    const prop = state.properties.find(p => p.id === auction.propertyId);
    const amount = Number(auction.currentBid || 0);
    if (!winner || winner.bankrupt) throw new GameRuleError(400, 'Auction winner is not active');
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Auction property is not available');
    if (winner.cash < amount) throw new GameRuleError(400, 'Auction winner has insufficient funds');

    winner.cash -= amount;
    prop.ownerId = winner.userId;
    prop.ownerName = winner.name;
    recordCashFlow(state, winner.userId, null, amount);
    auction.status = 'sold';
    auction.closeReason = reason;
    auction.resolvedAt = new Date().toISOString();
    auction.resolvedById = actor.userId;
    auction.resolvedByName = actor.name;
    auction.winnerId = winner.userId;
    auction.winnerName = winner.name;
    auction.finalBid = amount;
    events.push(makeEvent(actor, 'property_auction_won', {
        auctionId: auction.id,
        property: auction.propertyName,
        winner: winner.name,
        amount,
        reason,
    }));
    const reasonText = reason === 'timeout' ? ' after the auction timed out' : '';
    log(state, `${winner.name} won ${auction.propertyName} at auction for $${amount.toFixed(2)}${reasonText}`);
}

function getOpenAuction(state) {
    if (!state.auction || state.auction.status !== 'open') throw new GameRuleError(404, 'Open auction not found');
    return state.auction;
}

function hostCancelAuction(state, actor, events) {
    const auction = getOpenAuction(state);
    auction.status = 'canceled';
    auction.cancelReason = 'host';
    auction.resolvedAt = new Date().toISOString();
    auction.resolvedById = actor.userId;
    auction.resolvedByName = actor.name;
    events.push(makeEvent(actor, 'property_auction_canceled', {
        auctionId: auction.id,
        property: auction.propertyName,
        actor: actor.name,
        reason: 'host',
    }));
    log(state, `${actor.name} canceled the auction for ${auction.propertyName}`);
}

function normalizeAuction(auction) {
    if (!auction || typeof auction !== 'object') return null;
    return {
        ...auction,
        status: auction.status || 'open',
        propertyId: auction.propertyId || null,
        propertyName: auction.propertyName || '',
        currentBid: Number(auction.currentBid || auction.finalBid || 0),
        highBidderId: auction.highBidderId || auction.winnerId || null,
        highBidderName: auction.highBidderName || auction.winnerName || null,
        passedPlayerIds: Array.isArray(auction.passedPlayerIds) ? auction.passedPlayerIds : [],
    };
}

module.exports = {
    startAuction,
    placeAuctionBid,
    passAuction,
    expireOpenAuctionIfNeeded,
    hostCancelAuction,
    normalizeAuction,
};
