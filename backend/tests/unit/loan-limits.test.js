'use strict';

// Loans keep a 10% equity cushion: at most 90% of the pledged property's value
// (list price plus buildings), and each property backs one loan at a time.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

const BOARDWALK = 'prop-26'; // $400
const PARK_PLACE = 'prop-25'; // $350

function makeState() {
    const state = normalizeState({
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
    own(state, [BOARDWALK, PARK_PLACE], 'alice', 'Alice');
    return state;
}

function player(userId, name) {
    return {
        userId, name, cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: true, properties: [], corporations: [], debts: [],
    };
}

function own(state, ids, ownerId, ownerName) {
    ids.forEach(id => Object.assign(state.properties.find(p => p.id === id), { ownerId, ownerName }));
}

const borrow = (state, amount, collateralIds, actor = 'alice') =>
    applyAction(state, actor, { type: 'issue_debt', payload: { amount, collateralIds } });

function refusedWith(fn, message) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    expect(error.message).toMatch(message);
}

describe('loan limits', () => {
    test('a loan without collateral is refused', () => {
        refusedWith(() => borrow(makeState(), 100, []), /needs collateral/);
    });

    test('up to 90% of the collateral value can be borrowed, and no more', () => {
        const { state } = borrow(makeState(), 360, [BOARDWALK]);
        expect(state.players[0].debts[0].collateral).toEqual([{ id: BOARDWALK, name: 'Boardwalk', value: 400 }]);
        refusedWith(() => borrow(makeState(), 360.01, [BOARDWALK]), /up to \$360\.00 against Boardwalk/);
    });

    test('several pledged properties add up', () => {
        const { state } = borrow(makeState(), 675, [BOARDWALK, PARK_PLACE]);
        expect(state.players[0].cash).toBe(2175);
    });

    test('buildings count towards the collateral value', () => {
        const state = makeState();
        state.properties.find(p => p.id === BOARDWALK).houses = 2; // + 2 x $200
        expect(() => borrow(state, 720, [BOARDWALK])).not.toThrow();
    });

    test('a property backs only one loan at a time', () => {
        const { state } = borrow(makeState(), 100, [BOARDWALK]);
        refusedWith(() => borrow(state, 100, [BOARDWALK]), /already backs another loan/);
    });

    test('a pledged property stays pledged after it changes hands', () => {
        let { state } = borrow(makeState(), 100, [BOARDWALK]);
        own(state, [BOARDWALK], 'bob', 'Bob');
        state.currentPlayerIndex = 1;
        refusedWith(() => borrow(state, 100, [BOARDWALK], 'bob'), /already backs another loan/);
    });

    test('a refinance may reuse the collateral of the loans it replaces', () => {
        const { state } = borrow(makeState(), 100, [BOARDWALK]);
        const debtId = state.players[0].debts[0].id;
        const { state: after } = applyAction(state, 'alice', {
            type: 'refinance_debt',
            payload: { debtIds: [debtId], amount: 300, collateralIds: [BOARDWALK] },
        });
        expect(after.players[0].debts).toHaveLength(1);
        expect(after.players[0].debts[0].principal).toBe(300);
    });

    test('a refinance above 90% of its collateral is refused', () => {
        const { state } = borrow(makeState(), 100, [BOARDWALK]);
        const debtId = state.players[0].debts[0].id;
        refusedWith(() => applyAction(state, 'alice', {
            type: 'refinance_debt',
            payload: { debtIds: [debtId], amount: 400, collateralIds: [BOARDWALK] },
        }), /up to \$360\.00/);
    });

    test('corporate loans follow the same limit against the corporation\'s property', () => {
        let { state } = applyAction(makeState(), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, assetIds: [BOARDWALK] },
        });
        const corpId = state.corporations[0].id;
        const corporate = amount => applyAction(state, 'alice', {
            type: 'issue_debt',
            payload: { amount, issuerType: 'corporation', corpId, collateralIds: [BOARDWALK] },
        });
        refusedWith(() => corporate(361), /up to \$360\.00/);
        expect(corporate(360).state.corporations[0].cash).toBe(360);
        refusedWith(() => applyAction(state, 'alice', {
            type: 'issue_debt',
            payload: { amount: 100, issuerType: 'corporation', corpId, collateralIds: [PARK_PLACE] },
        }), /owned by the borrower/);
    });
});
