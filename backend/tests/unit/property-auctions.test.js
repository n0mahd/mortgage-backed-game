'use strict';

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
} = require('../../domain/gameRules');

function makeState(overrides = {}) {
    return normalizeState({
        currentPlayerIndex: 0,
        players: [
            player('alice', 'Alice', { position: 1, diceRolled: true }),
            player('bob', 'Bob'),
            player('carol', 'Carol'),
        ],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({
            ...prop,
            id: `prop-${index}`,
            ownerId: null,
            ownerName: null,
            houses: 0,
        })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: [3, 4],
        lastCardDrawn: null,
        ended: false,
        ...overrides,
    });
}

function player(userId, name, overrides = {}) {
    return {
        userId,
        name,
        cash: 1500,
        position: 0,
        bankrupt: false,
        inJail: false,
        jailTurns: 0,
        hasGetOutOfJailCard: false,
        doubleCount: 0,
        diceRolled: false,
        properties: [],
        corporations: [],
        debts: [],
        ...overrides,
    };
}

function startAuction(state = makeState()) {
    return applyAction(state, 'alice', { type: 'start_auction', payload: {} });
}

describe('property auction rules', () => {
    test('current player can start an auction for the unowned property they landed on', () => {
        const result = startAuction();

        expect(result.state.auction.status).toBe('open');
        expect(result.state.auction.propertyId).toBe('prop-0');
        expect(result.state.auction.propertyName).toBe('Mediterranean Avenue');
        expect(result.state.auction.currentBid).toBe(0);
        expect(result.events.some(event => event.type === 'property_auction_started')).toBe(true);
    });

    test('bids and passes settle the property to the high bidder', () => {
        const started = startAuction();
        const bid = applyAction(started.state, 'bob', {
            type: 'place_bid',
            payload: { amount: 75 },
        });
        const alicePassed = applyAction(bid.state, 'alice', { type: 'pass_auction', payload: {} });
        const settled = applyAction(alicePassed.state, 'carol', { type: 'pass_auction', payload: {} });

        expect(settled.state.auction.status).toBe('sold');
        expect(settled.state.auction.winnerId).toBe('bob');
        expect(settled.state.properties.find(prop => prop.id === 'prop-0').ownerId).toBe('bob');
        expect(settled.state.players.find(p => p.userId === 'bob').cash).toBe(1425);
        expect(settled.events.some(event =>
            event.type === 'property_auction_won' &&
            event.data.property === 'Mediterranean Avenue' &&
            event.data.amount === 75
        )).toBe(true);
    });

    test('auction closes with no sale when every active player passes without a bid', () => {
        const started = startAuction();
        const alicePassed = applyAction(started.state, 'alice', { type: 'pass_auction', payload: {} });
        const bobPassed = applyAction(alicePassed.state, 'bob', { type: 'pass_auction', payload: {} });
        const closed = applyAction(bobPassed.state, 'carol', { type: 'pass_auction', payload: {} });

        expect(closed.state.auction.status).toBe('no_sale');
        expect(closed.state.properties.find(prop => prop.id === 'prop-0').ownerId).toBeNull();
        expect(closed.events.some(event => event.type === 'property_auction_no_sale')).toBe(true);
    });

    test('open auction with no bids times out as no sale on the next action', () => {
        const started = startAuction();
        started.state.auction.expiresAt = '2000-01-01T00:00:00.000Z';

        const ended = applyAction(started.state, 'alice', { type: 'end_turn', payload: {} });

        expect(ended.state.auction.status).toBe('no_sale');
        expect(ended.state.auction.closeReason).toBe('timeout');
        expect(ended.state.properties.find(prop => prop.id === 'prop-0').ownerId).toBeNull();
        expect(ended.state.currentPlayerIndex).toBe(1);
        expect(ended.events.some(event =>
            event.type === 'property_auction_no_sale' &&
            event.data.reason === 'timeout'
        )).toBe(true);
    });

    test('open auction with a high bidder times out and sells to the high bidder on the next action', () => {
        const started = startAuction();
        const bid = applyAction(started.state, 'bob', {
            type: 'place_bid',
            payload: { amount: 75 },
        });
        bid.state.auction.expiresAt = '2000-01-01T00:00:00.000Z';

        const ended = applyAction(bid.state, 'alice', { type: 'end_turn', payload: {} });

        expect(ended.state.auction.status).toBe('sold');
        expect(ended.state.auction.closeReason).toBe('timeout');
        expect(ended.state.auction.winnerId).toBe('bob');
        expect(ended.state.properties.find(prop => prop.id === 'prop-0').ownerId).toBe('bob');
        expect(ended.state.players.find(p => p.userId === 'bob').cash).toBe(1425);
        expect(ended.state.currentPlayerIndex).toBe(1);
        expect(ended.events.some(event =>
            event.type === 'property_auction_won' &&
            event.data.reason === 'timeout'
        )).toBe(true);
    });

    test('normal game actions are blocked while an auction is open', () => {
        const started = startAuction();

        expect(() => applyAction(started.state, 'alice', { type: 'end_turn', payload: {} }))
            .toThrow('Resolve auction before other actions');
        expect(() => applyAction(started.state, 'alice', {
            type: 'manual_payment',
            payload: { fromPlayerId: 'alice', toPlayerId: 'bob', amount: 10 },
        })).toThrow('Resolve auction before other actions');
    });

    test('host can cancel an open auction and non-host cannot', () => {
        const started = startAuction();

        expect(() => applyAction(started.state, 'bob', { type: 'host_cancel_auction', payload: {} }, { hostId: 'alice' }))
            .toThrow('Not the host');

        const canceled = applyAction(started.state, 'alice', { type: 'host_cancel_auction', payload: {} }, { hostId: 'alice' });

        expect(canceled.state.auction.status).toBe('canceled');
        expect(canceled.state.auction.cancelReason).toBe('host');
        expect(canceled.state.properties.find(prop => prop.id === 'prop-0').ownerId).toBeNull();
        expect(canceled.events.some(event =>
            event.type === 'property_auction_canceled' &&
            event.data.reason === 'host'
        )).toBe(true);
    });

    test('current high bidder cannot pass and bids must be affordable increases', () => {
        const started = startAuction();
        const bid = applyAction(started.state, 'bob', {
            type: 'place_bid',
            payload: { amount: 75 },
        });

        expect(() => applyAction(bid.state, 'bob', { type: 'pass_auction', payload: {} }))
            .toThrow('Current high bidder cannot pass');
        expect(() => applyAction(bid.state, 'carol', {
            type: 'place_bid',
            payload: { amount: 75 },
        })).toThrow('Bid must exceed current bid');
        expect(() => applyAction(bid.state, 'carol', {
            type: 'place_bid',
            payload: { amount: 2000 },
        })).toThrow('Insufficient funds');
    });

    test('a bid settles the auction at once when every other player already passed', () => {
        // Found by the verify-mortgage bot: Alice and Carol passed before anyone bid, then Bob bid.
        // Nobody could bid or pass after that, and End Turn stayed blocked until the timeout.
        let { state } = startAuction();
        state = applyAction(state, 'alice', { type: 'pass_auction', payload: {} }).state;
        state = applyAction(state, 'carol', { type: 'pass_auction', payload: {} }).state;
        expect(state.auction.status).toBe('open');

        const { state: after } = applyAction(state, 'bob', { type: 'place_bid', payload: { amount: 25 } });
        expect(after.auction.status).not.toBe('open');
        expect(after.properties.find(p => p.id === 'prop-0').ownerId).toBe('bob');
        expect(after.players.find(p => p.userId === 'bob').cash).toBe(1475);
    });
});
