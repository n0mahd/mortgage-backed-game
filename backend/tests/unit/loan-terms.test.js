'use strict';

// Loans run for 5, 10 or 15 of the borrower's turns at the rate the host set for
// that term. Autopay takes the installment that pays the loan off on schedule;
// unpaid interest compounds; the whole balance is due at maturity.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    createInitialGame,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

const BOARDWALK = 'prop-26'; // $400
const PARK_PLACE = 'prop-25'; // $350
const RATES = { 5: 4, 10: 5, 15: 6 };

function makeState({ cash = 1500, loanRates = RATES } = {}) {
    const state = normalizeState({
        currentPlayerIndex: 0,
        players: [player('alice', 'Alice', cash), player('bob', 'Bob', 1500)],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({ ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0 })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, loanRates },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
    [BOARDWALK, PARK_PLACE].forEach(id => Object.assign(state.properties.find(p => p.id === id), { ownerId: 'alice', ownerName: 'Alice' }));
    return normalizeState(state);
}

function player(userId, name, cash) {
    return {
        userId, name, cash, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: true, properties: [], corporations: [], debts: [],
    };
}

const act = (state, type, payload = {}, actor = 'alice') => applyAction(state, actor, { type, payload }).state;
const borrow = (state, payload) => act(state, 'issue_debt', { amount: 300, ...payload });
const alice = state => state.players.find(p => p.userId === 'alice');

// Ends Alice's turn, then Bob's, so it is Alice's turn again.
function round(state) {
    state = act(state, 'end_turn');
    state.players[1].diceRolled = true;
    state = act(state, 'end_turn', {}, 'bob');
    state.players[0].diceRolled = true;
    return state;
}

function refusedWith(fn, message) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    expect(error.message).toMatch(message);
}

describe('loan terms', () => {
    test('the borrower picks a term and gets the host rate for it', () => {
        const short = alice(borrow(makeState(), { termTurns: 5 })).debts[0];
        const long = alice(borrow(makeState(), { termTurns: 15 })).debts[0];
        expect(short).toMatchObject({ termTurns: 5, turnsRemaining: 5, interestRate: 4, autopay: true });
        expect(long).toMatchObject({ termTurns: 15, turnsRemaining: 15, interestRate: 6 });
        // A longer term means a smaller installment each turn.
        expect(long.nextPayment).toBeLessThan(short.nextPayment);
    });

    test('a term other than 5, 10 or 15 turns is refused; no term means 10', () => {
        refusedWith(() => borrow(makeState(), { termTurns: 30 }), /5, 10 or 15 turns/);
        expect(alice(borrow(makeState(), {})).debts[0]).toMatchObject({ termTurns: 10, interestRate: 5 });
    });

    test('a rate in the payload is ignored', () => {
        expect(alice(borrow(makeState(), { termTurns: 5, interestRate: 0 })).debts[0].interestRate).toBe(4);
    });

    test('autopay pays the loan off exactly at maturity, costing more over a longer term', () => {
        const totalCost = termTurns => {
            let state = borrow(makeState(), { termTurns });
            const cashAfterLoan = alice(state).cash;
            for (let turn = 0; turn < termTurns; turn += 1) state = round(state);
            expect(alice(state).debts).toHaveLength(0);
            return Math.round((cashAfterLoan - alice(state).cash) * 100) / 100;
        };
        const five = totalCost(5);
        const fifteen = totalCost(15);
        expect(five).toBeCloseTo(336.93, 2);
        expect(fifteen).toBeGreaterThan(five);
    });

    test('with autopay off nothing is taken and the interest compounds', () => {
        let state = borrow(makeState(), { termTurns: 10, autopay: false });
        const cash = alice(state).cash;
        state = round(state);
        state = round(state);
        expect(alice(state).cash).toBe(cash);
        expect(alice(state).debts[0].principal).toBeCloseTo(300 * 1.05 * 1.05, 2);
        expect(state.gameLog.map(entry => entry.message).join('\n')).toMatch(/unpaid interest was added/);
    });

    test('autopay can be switched off and on again, off-turn too', () => {
        let state = borrow(makeState(), { termTurns: 10 });
        const debtId = alice(state).debts[0].id;
        state.currentPlayerIndex = 1;
        state = act(state, 'set_debt_autopay', { debtId, autopay: false });
        expect(alice(state).debts[0].autopay).toBe(false);
        state = act(state, 'set_debt_autopay', { debtId, autopay: true });
        expect(alice(state).debts[0].autopay).toBe(true);
        refusedWith(() => act(state, 'set_debt_autopay', { debtId, autopay: true }, 'bob'), /Debt not found/);
    });

    test('a missed installment makes the next ones bigger so the loan still ends on time', () => {
        let state = borrow(makeState(), { termTurns: 5, autopay: false });
        const before = alice(state).debts[0].nextPayment;
        state = round(state);
        expect(alice(state).debts[0].nextPayment).toBeGreaterThan(before);
    });

    test('autopay never takes more than the cash on hand before maturity', () => {
        let state = borrow(makeState({ cash: 0 }), { termTurns: 10 });
        state.players[0].cash = 10;
        state = round(state);
        expect(alice(state).cash).toBe(0);
        expect(alice(state).bankrupt).toBe(false);
        expect(alice(state).debts[0].principal).toBeCloseTo(300 * 1.05 - 10, 2);
    });

    test('rent owed is paid before autopay, so autopay alone never causes a bankruptcy', () => {
        let state = borrow(makeState({ cash: 0 }), { termTurns: 10 });
        state.players[0].cash = 100;
        state.bankruptcyClaims = {
            alice: {
                debtorId: 'alice', debtorName: 'Alice', creditorId: 'bob', creditorName: 'Bob', creditorType: 'player',
                reason: 'Rent for Boardwalk', amountOwed: 80, paidAmount: 0, unpaidAmount: 80, createdAt: new Date().toISOString(),
            },
        };
        state = act(state, 'end_turn');
        expect(alice(state).bankrupt).toBe(false);
        expect(state.players[1].cash).toBe(1580);
        expect(alice(state).cash).toBe(0);
        expect(alice(state).debts[0].principal).toBeCloseTo(300 * 1.05 - 20, 2);
    });

    test('the whole balance is due at maturity, autopay or not', () => {
        let state = borrow(makeState(), { termTurns: 5, autopay: false });
        for (let turn = 0; turn < 5; turn += 1) state = round(state);
        expect(alice(state).debts).toHaveLength(0);
        expect(alice(state).cash).toBeCloseTo(1500 + 300 - 300 * 1.04 ** 5, 2);
        expect(state.gameLog.map(entry => entry.message).join('\n')).toMatch(/repaid a loan in full at maturity/);
    });

    test("a borrower who can't repay at maturity goes bankrupt and the property returns to the bank", () => {
        let state = borrow(makeState({ cash: 0 }), { termTurns: 5, autopay: false });
        for (let turn = 0; turn < 4; turn += 1) state = round(state);
        state.players[0].cash = 50;
        state = act(state, 'end_turn');
        expect(alice(state).bankrupt).toBe(true);
        expect(state.properties.find(p => p.id === BOARDWALK).ownerId).toBeNull();
        expect(state.gameLog.map(entry => entry.message).join('\n')).toMatch(/couldn't repay a \$\d+\.\d\d loan that came due/);
    });

    test('pay off or pay part of a loan from the debt page', () => {
        let state = borrow(makeState(), { termTurns: 10 });
        const debtId = alice(state).debts[0].id;
        state = act(state, 'pay_debt', { debtId, amount: 100 });
        expect(alice(state).debts[0].principal).toBe(200);
        expect(alice(state).debts[0].turnsRemaining).toBe(10);
        state = act(state, 'pay_debt', { debtId, amount: 200 });
        expect(alice(state).debts).toHaveLength(0);
    });

    test("a chairman manages the corporation's loans; they count down on the chairman's turn", () => {
        let state = makeState();
        state.corporations.push({
            id: 'corp-1', ticker: 'ALC', name: 'Alice Co', founderId: 'alice', founderName: 'Alice',
            chairmanId: 'alice', chairmanName: 'Alice', totalShares: 10, treasuryShares: 0, pricePerShare: 10,
            cash: 500, shareholders: [{ userId: 'alice', name: 'Alice', shares: 10 }], assets: [], debts: [],
        });
        Object.assign(state.properties.find(p => p.id === PARK_PLACE), { ownerId: 'corp-1', ownerName: 'ALC' });
        state.corporations[0].assets.push({ id: PARK_PLACE, name: 'Park Place', value: 350 });
        state = normalizeState(state);
        state = act(state, 'issue_debt', { issuerType: 'corporation', corpId: 'corp-1', amount: 200, termTurns: 5 });
        const corp = s => s.corporations[0];
        const debtId = corp(state).debts[0].id;
        expect(corp(state).cash).toBe(700);
        state = act(state, 'set_debt_autopay', { corpId: 'corp-1', debtId, autopay: false });
        state = round(state);
        expect(corp(state).debts[0].turnsRemaining).toBe(4);
        expect(corp(state).cash).toBe(700);
        state = act(state, 'pay_debt', { corpId: 'corp-1', debtId, amount: 1000 });
        expect(corp(state).debts).toHaveLength(0);
        expect(corp(state).cash).toBeCloseTo(700 - 200 * 1.04, 2);
        refusedWith(() => act(state, 'set_debt_autopay', { corpId: 'corp-1', debtId, autopay: true }, 'bob'), /chairman or controlling/);
    });

    test('loans from before terms get a 10-turn term with autopay on', () => {
        const state = makeState();
        state.players[0].debts.push({ id: 'old', principal: 100, interestRate: 5 });
        const debt = alice(normalizeState(state)).debts[0];
        expect(debt).toMatchObject({ termTurns: 10, turnsRemaining: 10, autopay: true });
    });
});

describe('host loan rates', () => {
    const members = [{ user_id: 'alice', player_name: 'Alice' }, { user_id: 'bob', player_name: 'Bob' }];

    test('the host sets a rate per term when the game starts', () => {
        expect(createInitialGame(members, { loanRates: { 5: 2, 10: 3.5, 15: 0 } }).settings.loanRates).toEqual({ 5: 2, 10: 3.5, 15: 0 });
        expect(createInitialGame(members).settings.loanRates).toEqual(RATES);
    });

    test('a rate outside 0-25% is refused', () => {
        refusedWith(() => createInitialGame(members, { loanRates: { 5: 30 } }), /5-turn rate must be between 0% and 25%/);
        refusedWith(() => createInitialGame(members, { loanRates: { 10: -1 } }), /10-turn rate/);
    });

    test('a 0% loan is paid back in equal parts', () => {
        let state = borrow(makeState({ loanRates: { 5: 0, 10: 5, 15: 6 } }), { termTurns: 5 });
        expect(alice(state).debts[0].nextPayment).toBe(60);
        state = round(state);
        expect(alice(state).debts[0].principal).toBe(240);
    });
});
