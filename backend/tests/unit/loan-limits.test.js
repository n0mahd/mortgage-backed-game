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

    test('a refinance below the balance pays the difference down from cash, even over the limit', () => {
        const { state } = borrow(makeState(), 600);
        // Park Place goes, so the $600 loan is now over the $360 limit.
        own(state, [PARK_PLACE], null, null);
        const debtId = state.players[0].debts[0].id;
        const cash = state.players[0].cash;
        const { state: after, events } = applyAction(state, 'alice', { type: 'refinance_debt', payload: { debtIds: [debtId], amount: 250, termTurns: 15 } });
        expect(after.players[0].debts).toHaveLength(1);
        expect(after.players[0].debts[0]).toMatchObject({ principal: 250, termTurns: 15 });
        expect(after.players[0].cash).toBe(cash - 350);
        expect(events.find(event => event.type === 'debt_refinanced').data.netProceeds).toBe(-350);
        // Same balance on a new term moves no cash.
        const same = applyAction(state, 'alice', { type: 'refinance_debt', payload: { debtIds: [debtId], amount: 600, termTurns: 5 } }).state;
        expect(same.players[0].cash).toBe(cash);
        expect(same.players[0].debts[0]).toMatchObject({ principal: 600, termTurns: 5 });
        state.players[0].cash = 100;
        refusedWith(() => applyAction(state, 'alice', { type: 'refinance_debt', payload: { debtIds: [debtId], amount: 250 } }), /takes \$350\.00 in cash; you have \$100\.00/);
    });

    test("a corporation's loans are refinanced from and into its treasury", () => {
        let { state } = applyAction(makeState(), 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, pricePerShare: 50, assetIds: [BOARDWALK] },
        });
        const corpId = state.corporations[0].id;
        const corporate = amount => applyAction(state, 'alice', { type: 'issue_debt', payload: { amount, issuerType: 'corporation', corpId } }).state;
        state = corporate(100);
        state = applyAction(state, 'alice', { type: 'issue_debt', payload: { amount: 200, issuerType: 'corporation', corpId } }).state;
        const debtIds = state.corporations[0].debts.map(debt => debt.id);
        const aliceCash = state.players[0].cash;

        const down = applyAction(state, 'alice', { type: 'refinance_debt', payload: { corpId, debtIds, amount: 120 } });
        const corp = down.state.corporations[0];
        expect(corp.debts).toHaveLength(1);
        expect(corp.debts[0]).toMatchObject({ principal: 120, issuerType: 'corporation' });
        expect(corp.cash).toBe(300 - 180);
        expect(down.state.players[0].cash).toBe(aliceCash);
        expect(down.state.players[0].debts).toHaveLength(0);

        const up = applyAction(state, 'alice', { type: 'refinance_debt', payload: { corpId, debtIds: [debtIds[0]], amount: 160 } }).state;
        expect(up.corporations[0].debts.map(debt => debt.principal).sort()).toEqual([160, 200]);
        expect(up.corporations[0].cash).toBe(360);
        refusedWith(() => applyAction(state, 'alice', { type: 'refinance_debt', payload: { corpId, debtIds: [debtIds[0]], amount: 161 } }), /up to \$160\.00/);

        state.currentPlayerIndex = 1;
        refusedWith(() => applyAction(state, 'bob', { type: 'refinance_debt', payload: { corpId, debtIds, amount: 300 } }), /chairman or controlling shareholder/);
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
