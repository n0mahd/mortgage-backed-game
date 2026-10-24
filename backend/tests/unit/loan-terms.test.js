'use strict';

// Loans run for 1 to 30 of the borrower's turns at the one rate the host set.
// Autopay takes the installment that pays the loan off on schedule, or the
// interest only, or nothing; unpaid interest compounds; the whole balance is due
// at maturity.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    createInitialGame,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

const BOARDWALK = 'prop-26'; // $400
const PARK_PLACE = 'prop-25'; // $350
const RATE = 4;

function makeState({ cash = 1500, loanRate = RATE } = {}) {
    const state = normalizeState({
        currentPlayerIndex: 0,
        players: [player('alice', 'Alice', cash), player('bob', 'Bob', 1500)],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({ ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0 })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, loanRate },
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
    test('the borrower picks any term from 1 to 30 turns, all at the host rate', () => {
        const short = alice(borrow(makeState(), { termTurns: 5 })).debts[0];
        const long = alice(borrow(makeState(), { termTurns: 23 })).debts[0];
        expect(short).toMatchObject({ termTurns: 5, turnsRemaining: 5, interestRate: 4, autopay: 'pay_down' });
        expect(long).toMatchObject({ termTurns: 23, turnsRemaining: 23, interestRate: 4 });
        // A longer term means a smaller installment each turn.
        expect(long.nextPayment).toBeLessThan(short.nextPayment);
    });

    test('a term outside 1-30 turns is refused; no term means 10', () => {
        refusedWith(() => borrow(makeState(), { termTurns: 31 }), /1 to 30 turns/);
        refusedWith(() => borrow(makeState(), { termTurns: 0 }), /1 to 30 turns/);
        refusedWith(() => borrow(makeState(), { termTurns: 2.5 }), /1 to 30 turns/);
        expect(alice(borrow(makeState(), { termTurns: 1 })).debts[0].nextPayment).toBe(312);
        expect(alice(borrow(makeState(), { termTurns: 30 })).debts[0].termTurns).toBe(30);
        expect(alice(borrow(makeState(), {})).debts[0]).toMatchObject({ termTurns: 10, interestRate: 4 });
    });

    test('a rate in the payload is ignored', () => {
        expect(alice(borrow(makeState(), { termTurns: 5, interestRate: 0 })).debts[0].interestRate).toBe(4);
    });

    test('paying down every turn pays the loan off exactly at maturity, costing more over a longer term', () => {
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

    test('interest only keeps the balance level, then the whole balance is due at the end', () => {
        let state = borrow(makeState(), { termTurns: 3, autopay: 'interest_only' });
        const debt = alice(state).debts[0];
        expect(debt).toMatchObject({ autopay: 'interest_only', nextPayment: 12, interestDue: 12 });
        expect(debt.installment).toBeGreaterThan(100);
        const cash = alice(state).cash;
        state = round(state);
        state = round(state);
        expect(alice(state).debts[0].principal).toBe(300);
        expect(alice(state).cash).toBe(cash - 24);
        expect(alice(state).debts[0].nextPayment).toBe(312);
        state = round(state);
        expect(alice(state).debts).toHaveLength(0);
        expect(alice(state).cash).toBe(cash - 24 - 312);
    });

    test('with autopay off nothing is taken and the interest compounds', () => {
        let state = borrow(makeState(), { termTurns: 10, autopay: 'off' });
        expect(alice(state).debts[0].nextPayment).toBe(0);
        const cash = alice(state).cash;
        state = round(state);
        state = round(state);
        expect(alice(state).cash).toBe(cash);
        expect(alice(state).debts[0].principal).toBeCloseTo(300 * 1.04 * 1.04, 2);
        expect(state.gameLog.map(entry => entry.message).join('\n')).toMatch(/unpaid interest was added/);
    });

    test('the autopay mode can be changed any time, off-turn too', () => {
        let state = borrow(makeState(), { termTurns: 10 });
        const debtId = alice(state).debts[0].id;
        state.currentPlayerIndex = 1;
        state = act(state, 'set_debt_autopay', { debtId, autopay: 'interest_only' });
        expect(alice(state).debts[0]).toMatchObject({ autopay: 'interest_only', nextPayment: 12 });
        expect(state.gameLog.at(-1).message).toMatch(/set autopay to interest only/);
        state = act(state, 'set_debt_autopay', { debtId, autopay: 'off' });
        expect(alice(state).debts[0].autopay).toBe('off');
        // The old on/off booleans still work for older clients and agents.
        state = act(state, 'set_debt_autopay', { debtId, autopay: true });
        expect(alice(state).debts[0].autopay).toBe('pay_down');
        refusedWith(() => act(state, 'set_debt_autopay', { debtId, autopay: 'sometimes' }), /pay_down/);
        refusedWith(() => act(state, 'set_debt_autopay', { debtId, autopay: 'off' }, 'bob'), /Debt not found/);
    });

    test('a missed installment makes the next ones bigger so the loan still ends on time', () => {
        let state = borrow(makeState(), { termTurns: 5, autopay: 'off' });
        const before = alice(state).debts[0].installment;
        state = round(state);
        expect(alice(state).debts[0].installment).toBeGreaterThan(before);
    });

    test('autopay never takes more than the cash on hand before maturity', () => {
        let state = borrow(makeState({ cash: 0 }), { termTurns: 10 });
        state.players[0].cash = 10;
        state = round(state);
        expect(alice(state).cash).toBe(0);
        expect(alice(state).bankrupt).toBe(false);
        expect(alice(state).debts[0].principal).toBeCloseTo(300 * 1.04 - 10, 2);
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
        expect(alice(state).debts[0].principal).toBeCloseTo(300 * 1.04 - 20, 2);
    });

    test('the whole balance is due at maturity, autopay or not', () => {
        let state = borrow(makeState(), { termTurns: 5, autopay: 'off' });
        for (let turn = 0; turn < 5; turn += 1) state = round(state);
        expect(alice(state).debts).toHaveLength(0);
        expect(alice(state).cash).toBeCloseTo(1500 + 300 - 300 * 1.04 ** 5, 2);
        expect(state.gameLog.map(entry => entry.message).join('\n')).toMatch(/repaid a loan in full at maturity/);
    });

    test("a borrower who can't repay at maturity goes bankrupt and the property returns to the bank", () => {
        let state = borrow(makeState({ cash: 0 }), { termTurns: 5, autopay: 'off' });
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
        state = act(state, 'set_debt_autopay', { corpId: 'corp-1', debtId, autopay: 'off' });
        state = round(state);
        expect(corp(state).debts[0].turnsRemaining).toBe(4);
        expect(corp(state).cash).toBe(700);
        state = act(state, 'pay_debt', { corpId: 'corp-1', debtId, amount: 1000 });
        expect(corp(state).debts).toHaveLength(0);
        expect(corp(state).cash).toBeCloseTo(700 - 200 * 1.04, 2);
        refusedWith(() => act(state, 'set_debt_autopay', { corpId: 'corp-1', debtId, autopay: 'pay_down' }, 'bob'), /chairman or controlling/);
    });

    test('loans from before terms get a 10-turn term, paid down', () => {
        const state = makeState();
        state.players[0].debts.push({ id: 'old', principal: 100, interestRate: 5 });
        state.players[0].debts.push({ id: 'old-off', principal: 100, interestRate: 5, termTurns: 15, turnsRemaining: 3, autopay: false });
        const [debt, off] = alice(normalizeState(state)).debts;
        expect(debt).toMatchObject({ termTurns: 10, turnsRemaining: 10, autopay: 'pay_down' });
        expect(off).toMatchObject({ termTurns: 15, turnsRemaining: 3, autopay: 'off', interestRate: 5 });
    });
});

describe('host loan rate', () => {
    const members = [{ user_id: 'alice', player_name: 'Alice' }, { user_id: 'bob', player_name: 'Bob' }];

    test('the host sets one rate per turn when the game starts; 5% by default', () => {
        expect(createInitialGame(members, { loanRate: 3.5 }).settings.loanRate).toBe(3.5);
        expect(createInitialGame(members, { loanRate: '' }).settings.loanRate).toBe(5);
        expect(createInitialGame(members).settings.loanRate).toBe(5);
    });

    test('a rate outside 0-25% is refused', () => {
        refusedWith(() => createInitialGame(members, { loanRate: 30 }), /between 0% and 25%/);
        refusedWith(() => createInitialGame(members, { loanRate: -1 }), /between 0% and 25%/);
    });

    test('a game saved with a rate per term keeps its 10-turn rate', () => {
        const state = makeState();
        delete state.settings.loanRate;
        state.settings.loanRates = { 5: 4, 10: 7, 15: 6 };
        const normalized = normalizeState(state);
        expect(normalized.settings.loanRate).toBe(7);
        expect(normalized.settings.loanRates).toBeUndefined();
    });

    test('a 0% loan is paid back in equal parts', () => {
        let state = borrow(makeState({ loanRate: 0 }), { termTurns: 5 });
        expect(alice(state).debts[0].nextPayment).toBe(60);
        state = round(state);
        expect(alice(state).debts[0].principal).toBe(240);
    });
});
