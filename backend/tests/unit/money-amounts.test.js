'use strict';

// Money a player types is handled in whole cents, and repaying a debt never
// takes more than is owed. Both found by verify-mortgage Haiku players.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

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
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: true, properties: [], corporations: [], debts: [],
    };
}

// Loans are limited by the portfolio: Alice owns Boardwalk ($400, so up to $360 of debt).
function withBoardwalk() {
    const state = makeState();
    Object.assign(state.properties.find(p => p.id === 'prop-26'), { ownerId: 'alice', ownerName: 'Alice' });
    return state;
}

const cash = (state, id) => state.players.find(p => p.userId === id).cash;
const lastLog = state => state.gameLog[state.gameLog.length - 1].message;

describe('money amounts', () => {
    test('a payment of a fraction of a cent is rounded once, and the log matches the cash', () => {
        const { state } = applyAction(makeState(), 'alice', {
            type: 'manual_payment',
            payload: { fromPlayerId: 'alice', toPlayerId: 'bob', amount: 12.555 },
        });
        expect(cash(state, 'alice')).toBe(1487.44);
        expect(cash(state, 'bob')).toBe(1512.56);
        expect(lastLog(state)).toContain('$12.56');
    });

    test('an amount that rounds to zero cents is refused', () => {
        expect(() => applyAction(makeState(), 'alice', {
            type: 'manual_payment',
            payload: { fromPlayerId: 'alice', toPlayerId: 'bob', amount: 0.004 },
        })).toThrow(GameRuleError);
    });

    test('paying more than a debt owes takes only what is owed', () => {
        let { state } = applyAction(withBoardwalk(), 'alice', { type: 'issue_debt', payload: { amount: 100 } });
        const debt = state.players[0].debts[0];
        ({ state } = applyAction(state, 'alice', { type: 'pay_debt', payload: { debtId: debt.id, amount: 150 } }));
        expect(state.players[0].debts).toHaveLength(0);
        expect(cash(state, 'alice')).toBe(1500);
        expect(lastLog(state)).toContain('$100.00');
    });

    test('a partial repayment still reduces the debt by exactly that amount', () => {
        let { state } = applyAction(withBoardwalk(), 'alice', { type: 'issue_debt', payload: { amount: 100 } });
        const debt = state.players[0].debts[0];
        ({ state } = applyAction(state, 'alice', { type: 'pay_debt', payload: { debtId: debt.id, amount: 40 } }));
        expect(state.players[0].debts[0].principal).toBe(60);
        expect(cash(state, 'alice')).toBe(1560);
    });

    test('paying the shown payoff clears a debt whose interest left fractions of a cent', () => {
        let { state } = applyAction(withBoardwalk(), 'alice', { type: 'issue_debt', payload: { amount: 100 } });
        state.players[0].debts[0].principal = 105.0000001;
        const debt = state.players[0].debts[0];
        ({ state } = applyAction(state, 'alice', { type: 'pay_debt', payload: { debtId: debt.id, amount: 105 } }));
        expect(state.players[0].debts).toHaveLength(0);
    });
});
