'use strict';

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
} = require('../../domain/gameRules');


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

function makeState({ alice = {}, bob = {}, chanceCards = [], communityChestCards = [] } = {}) {
    return normalizeState({
        currentPlayerIndex: 0,
        players: [player('alice', 'Alice', alice), player('bob', 'Bob', bob)],
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
        chanceCards,
        communityChestCards,
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
}

function find(state, userId) {
    return state.players.find(p => p.userId === userId);
}

describe('cash ledger', () => {
    function baltic(state) {
        return state.properties.find(p => p.name === 'Baltic Avenue');
    }

    test('records who paid whom and why, by turn', () => {
        const state = makeState();
        Object.assign(baltic(state), { ownerId: 'alice', ownerName: 'Alice' });
        expect(state.turnNumber).toBe(1);
        expect(state.turnStarts.alice).toEqual({ previous: null, current: 1 });

        let next = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 3] }).state; // Income Tax
        next = applyAction(next, 'alice', { type: 'end_turn', payload: {} }).state;
        next = applyAction(next, 'bob', { type: 'roll_dice', payload: {} }, { dice: [1, 2] }).state; // Baltic Avenue
        next = applyAction(next, 'bob', { type: 'end_turn', payload: {} }).state;

        expect(next.turnNumber).toBe(3);
        expect(next.turnStarts.alice).toEqual({ previous: 1, current: 3 });
        expect(next.turnStarts.bob).toEqual({ previous: null, current: 2 });
        const tax = next.cashLedger.find(entry => entry.kind === 'tax');
        expect(tax).toMatchObject({ turn: 1, fromId: 'alice', fromName: 'Alice', toId: null, toName: null, note: 'Income Tax' });
        const rent = next.cashLedger.find(entry => entry.kind === 'rent');
        expect(rent).toMatchObject({
            turn: 2,
            fromId: 'bob',
            toId: 'alice',
            toName: 'Alice',
            amount: baltic(next).rent[0],
            note: 'Rent: Bob landed on Baltic Avenue',
        });
    });

    test('card money names the deck and the card', () => {
        const card = { id: 'ch-x', text: 'Bank pays you dividend of $50.', action: { type: 'collect', amount: 50 } };
        const state = makeState({ chanceCards: [card] });
        const next = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [3, 4] }).state; // Chance
        expect(next.cashLedger.at(-1)).toMatchObject({ kind: 'card', toId: 'alice', amount: 50, note: 'Chance: Bank pays you dividend of $50.' });
    });

    test('drops entries older than every player\'s previous turn', () => {
        let state = makeState();
        for (let turn = 0; turn < 6; turn += 1) {
            const mover = turn % 2 === 0 ? 'alice' : 'bob';
            find(state, mover).position = 0; // lands on Income Tax every turn
            state = applyAction(state, mover, { type: 'roll_dice', payload: {} }, { dice: [1, 3] }).state;
            state = applyAction(state, mover, { type: 'end_turn', payload: {} }).state;
        }
        // Turn 7 is Alice's; her previous turn was 5 and Bob's was 4.
        expect(state.turnStarts.bob.previous).toBe(4);
        expect(Math.min(...state.cashLedger.map(entry => entry.turn))).toBe(4);
    });
});
