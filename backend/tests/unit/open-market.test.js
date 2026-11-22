'use strict';

// Open market: only moving round the board waits for your turn. Building,
// IPOs, shares, dividends, rent policy and loans work on anyone's turn.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

const MEDITERRANEAN = 'prop-0';
const BALTIC = 'prop-1';
const PARK_PLACE = 'prop-25';
const BOARDWALK = 'prop-26';

function player(userId, name) {
    return {
        userId, name, cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: false, properties: [], corporations: [], debts: [],
    };
}

// Bob's turn, already rolled. Alice owns the Browns and the Dark Blues.
function bobsTurn() {
    const state = normalizeState({
        currentPlayerIndex: 0,
        players: [player('alice', 'Alice'), player('bob', 'Bob'), player('carol', 'Carol')],
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
    [MEDITERRANEAN, BALTIC, PARK_PLACE, BOARDWALK].forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        prop.ownerId = 'alice';
        prop.ownerName = 'Alice';
    });
    state.currentPlayerIndex = 1;
    return act(state, 'bob', 'roll_dice', {}, { dice: [1, 2] });
}

function act(state, userId, type, payload = {}, options = {}) {
    return applyAction(state, userId, { type, payload }, options).state;
}

function refused(fn, message) {
    let error;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    if (message) expect(error.message).toMatch(message);
}

const alice = state => state.players.find(p => p.userId === 'alice');
const prop = (state, id) => state.properties.find(p => p.id === id);

describe("on another player's turn", () => {
    test('build houses', () => {
        const state = act(bobsTurn(), 'alice', 'buy_houses', { selections: { [MEDITERRANEAN]: 1, [BALTIC]: 1 } });
        expect(prop(state, MEDITERRANEAN).houses).toBe(1);
        expect(prop(state, BALTIC).houses).toBe(1);
        expect(state.players[state.currentPlayerIndex].userId).toBe('bob');
    });

    test('IPO, buy treasury shares, add property, pay a dividend and set rent policy', () => {
        let state = act(bobsTurn(), 'alice', 'create_ipo', { ticker: 'MBS', assetIds: [PARK_PLACE, BOARDWALK] });
        const corpId = state.corporations[0].id;
        state.corporations[0].treasuryShares = 1200;
        state.corporations[0].shareholders[0].shares -= 1200;
        state = act(state, 'carol', 'buy_shares', { corpId, shares: 120 });
        expect(state.corporations[0].shareholders.find(h => h.userId === 'carol').shares).toBe(120);
        state = act(state, 'alice', 'add_to_corporation', { corpId, assetIds: [MEDITERRANEAN] });
        expect(prop(state, MEDITERRANEAN).ownerId).toBe(corpId);
        state.corporations[0].cash = 100;
        state = act(state, 'alice', 'pay_dividend', { corpId, amount: 100 });
        expect(state.corporations[0].cash).toBeLessThan(100);
        state = act(state, 'alice', 'set_rent_policy', { corpId, policy: 'payout' });
        expect(state.corporations[0].rentPolicy).toBe('payout');
    });

    test('borrow, repay and refinance; the loan is serviced at your own End Turn', () => {
        const start = bobsTurn();
        let state = act(start, 'alice', 'issue_debt', { amount: 300 });
        expect(alice(state).cash).toBe(alice(start).cash + 300);
        const debtId = alice(state).debts[0].id;
        state = act(state, 'alice', 'pay_debt', { debtId, amount: 50 });
        expect(alice(state).debts[0].principal).toBe(250);
        state = act(state, 'alice', 'refinance_debt', { debtIds: [debtId], amount: 250, termTurns: 15 });
        const loan = alice(state).debts[0];
        expect(loan.termTurns).toBe(15);

        // Bob's End Turn leaves Alice's loan alone; hers services it.
        state = act(state, 'bob', 'end_turn');
        expect(alice(state).debts[0].turnsRemaining).toBe(loan.turnsRemaining);
        state = act(state, 'carol', 'roll_dice', {}, { dice: [1, 2] });
        state = act(state, 'carol', 'end_turn');
        state = act(state, 'alice', 'roll_dice', {}, { dice: [1, 2] });
        const beforeEnd = alice(state).cash;
        state = act(state, 'alice', 'end_turn');
        expect(alice(state).cash).toBeLessThan(beforeEnd);
        expect(alice(state).debts[0].turnsRemaining).toBe(loan.turnsRemaining - 1);
    });
});

describe('still waits for your turn', () => {
    test('rolling, buying the square you landed on, auctions and End Turn', () => {
        const state = bobsTurn();
        refused(() => act(state, 'alice', 'roll_dice'), /Not the current player/);
        refused(() => act(state, 'alice', 'buy_property'), /Not the current player/);
        refused(() => act(state, 'alice', 'start_auction'), /Not the current player/);
        refused(() => act(state, 'alice', 'end_turn'), /Not the current player/);
        refused(() => act(state, 'alice', 'pay_jail_fine'), /Not the current player/);
    });

    test('nothing else while an auction is open', () => {
        const { BOARD_SQUARES } = require('../../domain/gameRules');
        const start = bobsTurn();
        const square = BOARD_SQUARES.findIndex(sq => sq.propertyId && !prop(start, sq.propertyId).ownerId);
        start.players[1].diceRolled = false;
        start.lastDiceRoll = null;
        start.players[1].position = (square - 3 + 40) % 40;
        let state = act(start, 'bob', 'roll_dice', {}, { dice: [1, 2] });
        state = act(state, 'bob', 'start_auction');
        refused(() => act(state, 'alice', 'buy_houses', { selections: { [MEDITERRANEAN]: 1, [BALTIC]: 1 } }), /Resolve auction/);
        refused(() => act(state, 'alice', 'issue_debt', { amount: 100 }), /Resolve auction/);
    });
});
