'use strict';

// A colour group with buildings stays together. Its streets can't change hands
// by trade (directly or into an LLC); the only way out is an IPO of the whole
// group, after which shares in the LLC can be sold and traded.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

const ORANGE = ['prop-10', 'prop-11', 'prop-12'];
const BROWN = ['prop-0', 'prop-1'];

function makeState() {
    return normalizeState({
        currentPlayerIndex: 0,
        players: [player('alice', 'Alice'), player('bob', 'Bob')],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({ ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0 })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
}

function player(userId, name) {
    return {
        userId, name, cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: false, properties: [], corporations: [], debts: [],
    };
}

function own(state, ids, ownerId, ownerName, houses = 0) {
    ids.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        prop.ownerId = ownerId;
        prop.ownerName = ownerName;
        prop.houses = houses;
    });
    return state;
}

function aliceBuiltOrange(housesOnFirst = 1) {
    const state = own(makeState(), ORANGE, 'alice', 'Alice');
    state.properties.find(p => p.id === ORANGE[0]).houses = housesOnFirst;
    return state;
}

function propose(state, actorId, payload) {
    return applyAction(state, actorId, {
        type: 'propose_trade',
        payload: { player1Id: 'alice', player2Id: 'bob', player1Cash: 0, player2Cash: 0, player1AssetIds: [], player2AssetIds: [], ...payload },
    });
}

function expectRefused(fn, message) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    expect(error.message).toMatch(message);
}

describe('colour groups with buildings stay together', () => {
    test('a street with houses cannot be offered in a trade', () => {
        expectRefused(() => propose(aliceBuiltOrange(), 'alice', { player1AssetIds: [ORANGE[0]], player2Cash: 300 }), /buildings/);
    });

    test('an unbuilt street in a built group cannot be offered either', () => {
        // Houses are on St. James Place; Tennessee Avenue has none but would still split the group.
        expectRefused(() => propose(aliceBuiltOrange(), 'alice', { player1AssetIds: [ORANGE[1]], player2Cash: 300 }), /buildings/);
    });

    test('the other player cannot ask for a street in a built group', () => {
        expectRefused(() => propose(aliceBuiltOrange(), 'bob', { player1AssetIds: [ORANGE[2]], player2Cash: 300 }), /buildings/);
    });

    test('an offer made before building is refused at accept time', () => {
        const state = own(makeState(), ORANGE, 'alice', 'Alice');
        const { state: proposed } = propose(state, 'bob', { player1AssetIds: [ORANGE[0]], player2Cash: 300 });
        const offer = proposed.marketOffers[0];
        proposed.properties.find(p => p.id === ORANGE[1]).houses = 2;
        expectRefused(() => applyAction(proposed, 'alice', { type: 'accept_trade', payload: { offerId: offer.id } }), /buildings/);
    });

    test('the direct trade action refuses a built group too', () => {
        expectRefused(() => applyAction(aliceBuiltOrange(), 'alice', {
            type: 'trade',
            payload: { player1Id: 'alice', player2Id: 'bob', player1Cash: 0, player2Cash: 300, player1AssetIds: [ORANGE[0]], player2AssetIds: [] },
        }), /buildings/);
    });

    test('a street in a built group cannot be traded into an LLC', () => {
        let state = own(aliceBuiltOrange(), ['prop-3'], 'bob', 'Bob');
        state.currentPlayerIndex = 1; // IPOs happen on your own turn
        state = applyAction(state, 'bob', { type: 'create_ipo', payload: { ticker: 'BOB', totalShares: 10, assetIds: ['prop-3'] } }).state;
        const corp = state.corporations[0];
        expectRefused(() => propose(state, 'alice', {
            player1AssetIds: [ORANGE[0]],
            player1PropertiesToCorpId: corp.id,
            player2Shares: [{ corpId: corp.id, shares: 3 }],
        }), /buildings/);
    });

    test('a group without buildings can still be traded street by street', () => {
        const state = own(makeState(), ORANGE, 'alice', 'Alice');
        const { state: proposed } = propose(state, 'alice', { player1AssetIds: [ORANGE[0]], player2Cash: 300 });
        const { state: after } = applyAction(proposed, 'bob', { type: 'accept_trade', payload: { offerId: proposed.marketOffers[0].id } });
        expect(after.properties.find(p => p.id === ORANGE[0]).ownerId).toBe('bob');
    });

    test('other groups are unaffected when one group has buildings', () => {
        const state = own(aliceBuiltOrange(), BROWN, 'alice', 'Alice');
        const { state: proposed } = propose(state, 'alice', { player1AssetIds: [BROWN[0]], player2Cash: 100 });
        expect(proposed.marketOffers).toHaveLength(1);
    });

    test('an IPO of only part of a built group is refused', () => {
        expectRefused(() => applyAction(aliceBuiltOrange(), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ORNG', totalShares: 10, assetIds: [ORANGE[0]] },
        }), /whole/);
    });

    test('an IPO of the whole built group keeps the buildings in the LLC', () => {
        const { state } = applyAction(aliceBuiltOrange(3), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ORNG', totalShares: 10, assetIds: ORANGE },
        });
        const corp = state.corporations[0];
        ORANGE.forEach(id => expect(state.properties.find(p => p.id === id).ownerId).toBe(corp.id));
        expect(state.properties.find(p => p.id === ORANGE[0]).houses).toBe(3);
    });

    test('shares in an LLC that holds a built group can be sold by trade', () => {
        let state = applyAction(aliceBuiltOrange(), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ORNG', totalShares: 10, assetIds: ORANGE },
        }).state;
        const corp = state.corporations[0];
        const { state: proposed } = propose(state, 'alice', { player1Shares: [{ corpId: corp.id, shares: 6 }], player2Cash: 400 });
        const { state: after } = applyAction(proposed, 'bob', { type: 'accept_trade', payload: { offerId: proposed.marketOffers[0].id } });
        const holders = after.corporations[0].shareholders;
        expect(holders.find(h => h.userId === 'bob').shares).toBe(6);
    });
});
