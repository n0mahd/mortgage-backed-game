'use strict';

// Loans keep a 10% equity cushion across the whole portfolio: all of a
// borrower's loans together may reach 90% of the book value of what they own
// (properties at price plus buildings, shares at book value). Nothing is pledged.

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

const borrow = (state, amount, actor = 'alice') =>
    applyAction(state, actor, { type: 'issue_debt', payload: { amount } });

function refusedWith(fn, message) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    expect(error.message).toMatch(message);
}

describe('loan limits', () => {
    test('a borrower who owns nothing cannot borrow', () => {
        const state = makeState();
        state.currentPlayerIndex = 1;
        refusedWith(() => borrow(state, 100, 'bob'), /up to \$0\.00/);
    });

    test('loans can total 90% of the whole portfolio, no property pledged', () => {
        // Boardwalk $400 + Park Place $350 = $750 of book value, so $675.
        const { state } = borrow(makeState(), 675);
        expect(state.players[0].cash).toBe(2175);
        expect(state.players[0].debts[0].collateral).toBeUndefined();
        refusedWith(() => borrow(makeState(), 675.01), /up to \$675\.00: loans can total 90% of the \$750\.00 book value/);
    });

    test('existing loans count against the limit', () => {
        const { state } = borrow(makeState(), 500);
        expect(state.players[0].borrowing).toEqual({ bookValue: 750, owed: 500, limit: 675, available: 175 });
        refusedWith(() => borrow(state, 176), /up to \$175\.00.*less the \$500\.00 already owed/);
        expect(() => borrow(state, 175)).not.toThrow();
    });

    test('buildings count towards the book value', () => {
        const state = makeState();
        state.properties.find(p => p.id === BOARDWALK).houses = 2; // + 2 x $200
        expect(() => borrow(state, 1035)).not.toThrow();
    });

    test('shares count at book value', () => {
        let { state } = applyAction(makeState(), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, assetIds: [BOARDWALK] },
        });
        // Boardwalk now sits in ALC ($400 NAV, all of it Alice's shares) and Park Place is hers.
        expect(state.players[0].borrowing.bookValue).toBe(750);
        state.corporations[0].cash = 100; // NAV $500
        state = normalizeState(state);
        expect(state.players[0].borrowing.bookValue).toBe(850);
    });

    test('a refinance does not count the loans it replaces', () => {
        const { state } = borrow(makeState(), 600);
        const debtId = state.players[0].debts[0].id;
        const { state: after } = applyAction(state, 'alice', { type: 'refinance_debt', payload: { debtIds: [debtId], amount: 675 } });
        expect(after.players[0].debts).toHaveLength(1);
        expect(after.players[0].debts[0].principal).toBe(675);
        refusedWith(() => applyAction(state, 'alice', { type: 'refinance_debt', payload: { debtIds: [debtId], amount: 676 } }), /up to \$675\.00/);
    });

    test("corporate loans are limited by the corporation's properties", () => {
        const { state } = applyAction(makeState(), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, pricePerShare: 50, assetIds: [BOARDWALK] },
        });
        const corpId = state.corporations[0].id;
        const corporate = amount => applyAction(state, 'alice', { type: 'issue_debt', payload: { amount, issuerType: 'corporation', corpId } });
        refusedWith(() => corporate(361), /up to \$360\.00.*the corporation's properties/);
        expect(corporate(360).state.corporations[0].cash).toBe(360);
    });
});
