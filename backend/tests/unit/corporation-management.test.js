'use strict';

// Running a corporation: rent policy (Payout / Reinvest), dividends, buying
// and building with the treasury, property offers for new shares, and trading
// as the company.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    calculateNetWorth,
    GameRuleError,
} = require('../../domain/gameRules');

const PARK_PLACE = 'prop-25';
const BOARDWALK = 'prop-26';
const ILLINOIS = 'prop-15'; // $240
const KENTUCKY = 'prop-13'; // $220
const MEDITERRANEAN = 'prop-0'; // $60
const BALTIC = 'prop-1'; // $60
const BOARDWALK_SQUARE = 39;

function player(userId, name) {
    return {
        userId, name, cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: false, properties: [], corporations: [], debts: [],
    };
}

function baseState() {
    return normalizeState({
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
}

function own(state, ids, ownerId, ownerName) {
    ids.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        prop.ownerId = ownerId;
        prop.ownerName = ownerName;
    });
    return state;
}

// Alice founds MBS with the Dark Blues (12,000 shares). `holders` gives each
// stake in thousandths (500 = 50%); shares the holders don't take stay in the
// treasury.
const SHARES = 12000;
const PER_MILLE = SHARES / 1000;
function mbsState({ holders = { alice: 500, bob: 300, carol: 200 }, cash = 0 } = {}) {
    let state = own(baseState(), [PARK_PLACE, BOARDWALK], 'alice', 'Alice');
    state = act(state, 'alice', 'create_ipo', { ticker: 'MBS', assetIds: [PARK_PLACE, BOARDWALK] });
    const corp = state.corporations[0];
    corp.shareholders = Object.entries(holders).map(([userId, perMille]) => ({
        userId, name: state.players.find(p => p.userId === userId).name, shares: perMille * PER_MILLE,
    }));
    corp.treasuryShares = corp.totalShares - corp.shareholders.reduce((sum, h) => sum + h.shares, 0);
    corp.cash = cash;
    return normalizeState(state);
}

function act(state, userId, type, payload = {}, options = {}) {
    return applyAction(state, userId, { type, payload }, options).state;
}

function actWithEvents(state, userId, type, payload = {}, options = {}) {
    return applyAction(state, userId, { type, payload }, options);
}

function refused(fn, message) {
    let error;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    if (message) expect(error.message).toMatch(message);
}

function corpOf(state) { return state.corporations[0]; }
function cashOf(state, userId) { return state.players.find(p => p.userId === userId).cash; }
function sharesOf(corp, userId) { return corp.shareholders.find(h => h.userId === userId)?.shares || 0; }

function setPolicy(state, policy) {
    return act(state, 'alice', 'set_rent_policy', { corpId: corpOf(state).id, policy });
}

// Puts `userId` on turn three squares before Boardwalk and rolls a 3.
function landOnBoardwalk(state, userId) {
    const next = normalizeState(state);
    next.currentPlayerIndex = next.players.findIndex(p => p.userId === userId);
    next.players.forEach(p => { p.diceRolled = false; });
    next.lastDiceRoll = null;
    next.players.find(p => p.userId === userId).position = BOARDWALK_SQUARE - 3;
    return applyAction(next, userId, { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
}

describe('new corporations', () => {
    test('issue 12,000 shares and start in Reinvest mode', () => {
        const state = act(own(baseState(), [ILLINOIS], 'alice', 'Alice'), 'alice', 'create_ipo', { ticker: 'ILL', assetIds: [ILLINOIS] });
        expect(corpOf(state).totalShares).toBe(12000);
        expect(corpOf(state).rentPolicy).toBe('reinvest');
    });

    test('older games without a policy load as Reinvest', () => {
        const state = mbsState();
        delete state.corporations[0].rentPolicy;
        expect(normalizeState(state).corporations[0].rentPolicy).toBe('reinvest');
    });
});

describe('rent policy', () => {
    test('the chairman switches it at the start of their turn', () => {
        const start = mbsState();
        const { state, events } = actWithEvents(start, 'alice', 'set_rent_policy', { corpId: corpOf(start).id, policy: 'payout' });
        expect(corpOf(state).rentPolicy).toBe('payout');
        expect(events.map(e => e.type)).toContain('rent_policy_changed');
    });

    test('is locked once the chairman has rolled, including after doubles', () => {
        const state = mbsState();
        const rolled = act(state, 'alice', 'roll_dice', {}, { dice: [1, 2] });
        refused(() => setPolicy(rolled, 'payout'), /before you roll/);
        const doubles = act(state, 'alice', 'roll_dice', {}, { dice: [2, 2] });
        expect(doubles.players[0].diceRolled).toBe(false);
        refused(() => setPolicy(doubles, 'payout'), /before you roll/);
    });

    // Ends the current player's turn (after a roll) and the next players' until
    // it is `userId`'s turn again.
    function passTurnsUntil(state, userId) {
        let next = state;
        do {
            const current = next.players[next.currentPlayerIndex].userId;
            if (!next.players[next.currentPlayerIndex].diceRolled) next = act(next, current, 'roll_dice', {}, { dice: [1, 2] });
            next = act(next, current, 'end_turn');
        } while (next.players[next.currentPlayerIndex].userId !== userId);
        return next;
    }

    test('after the chairman switches it alone, it is locked for their next 5 turns', () => {
        let state = setPolicy(mbsState(), 'payout');
        expect(corpOf(state).rentPolicyLockedTurns).toBe(5);
        for (let turn = 1; turn <= 5; turn += 1) {
            state = passTurnsUntil(state, 'alice');
            refused(() => setPolicy(state, 'reinvest'), /locked for \d+ more of your turns.*every shareholder/);
        }
        state = passTurnsUntil(state, 'alice');
        state = setPolicy(state, 'reinvest');
        expect(corpOf(state).rentPolicy).toBe('reinvest');
    });

    test('during the lock it changes once every shareholder agrees', () => {
        let state = setPolicy(mbsState(), 'payout');
        const corpId = corpOf(state).id;
        // Bob proposes on Alice's turn; Carol and Alice agree.
        state = act(state, 'bob', 'propose_rent_policy_change', { corpId, policy: 'reinvest' });
        expect(corpOf(state).rentPolicyVote).toMatchObject({ policy: 'reinvest', supporterIds: ['bob'] });
        state = act(state, 'carol', 'vote_rent_policy_change', { corpId, approve: true });
        expect(corpOf(state).rentPolicy).toBe('payout');
        const { state: passed, events } = actWithEvents(state, 'alice', 'vote_rent_policy_change', { corpId, approve: true });
        expect(corpOf(passed).rentPolicy).toBe('reinvest');
        expect(corpOf(passed).rentPolicyVote).toBeNull();
        expect(events.find(e => e.type === 'rent_policy_changed').data.method).toBe('unanimous');
        // A unanimous switch starts a fresh lock for the chairman.
        expect(corpOf(passed).rentPolicyLockedTurns).toBe(5);
    });

    test('one shareholder rejecting closes the vote; outsiders cannot vote', () => {
        let state = setPolicy(mbsState({ holders: { alice: 500, bob: 300 } }), 'payout');
        const corpId = corpOf(state).id;
        refused(() => act(state, 'carol', 'propose_rent_policy_change', { corpId, policy: 'reinvest' }), /Only MBS shareholders/);
        state = act(state, 'alice', 'propose_rent_policy_change', { corpId, policy: 'reinvest' });
        state = act(state, 'bob', 'vote_rent_policy_change', { corpId, approve: false });
        expect(corpOf(state).rentPolicyVote).toBeNull();
        expect(corpOf(state).rentPolicy).toBe('payout');
    });

    test('a sole shareholder changes it at once by proposing', () => {
        let state = setPolicy(mbsState({ holders: { alice: 1000 } }), 'payout');
        state = act(state, 'alice', 'propose_rent_policy_change', { corpId: corpOf(state).id, policy: 'reinvest' });
        expect(corpOf(state).rentPolicy).toBe('reinvest');
    });

    test('only the runner can change it, and only on their turn', () => {
        const state = mbsState();
        refused(() => act(state, 'bob', 'set_rent_policy', { corpId: corpOf(state).id, policy: 'payout' }), /current player/);
        const bobsTurn = normalizeState(state);
        bobsTurn.currentPlayerIndex = 1;
        refused(() => act(bobsTurn, 'bob', 'set_rent_policy', { corpId: corpOf(state).id, policy: 'payout' }), /chairman or a majority holder/);
    });
});

describe('rent on a corporation property', () => {
    // Boardwalk with Park Place, no houses: $100 rent.
    test('Payout: a 30% holder pays 70% and it goes straight to the other holders', () => {
        const state = setPolicy(mbsState(), 'payout');
        const { state: after, events } = landOnBoardwalk(state, 'bob');
        expect(cashOf(after, 'bob')).toBe(1500 - 70);
        expect(cashOf(after, 'alice')).toBe(1500 + 50);
        expect(cashOf(after, 'carol')).toBe(1500 + 20);
        expect(corpOf(after).cash).toBe(0);
        const payment = events.find(e => e.type === 'forced_payment');
        expect(payment.data).toMatchObject({ amount: 70, fullRent: 100, ownPercent: 30 });
        expect(events.map(e => e.type)).toContain('rent_distributed');
    });

    test('Payout: a non-holder pays in full and the treasury keeps the slice for its own shares', () => {
        const state = setPolicy(mbsState({ holders: { alice: 600, bob: 300 } }), 'payout'); // 10% in the treasury
        const { state: after } = landOnBoardwalk(state, 'carol');
        expect(cashOf(after, 'carol')).toBe(1400);
        expect(cashOf(after, 'alice')).toBe(1560);
        expect(cashOf(after, 'bob')).toBe(1530);
        expect(corpOf(after).cash).toBe(10);
    });

    test('Reinvest: a holder pays full rent into the treasury', () => {
        const { state: after } = landOnBoardwalk(mbsState(), 'bob');
        expect(cashOf(after, 'bob')).toBe(1400);
        expect(corpOf(after).cash).toBe(100);
        expect(cashOf(after, 'alice')).toBe(1500);
    });

    test('the two modes cost the lander the same net worth', () => {
        const reinvest = landOnBoardwalk(mbsState(), 'bob').state;
        const payout = landOnBoardwalk(setPolicy(mbsState(), 'payout'), 'bob').state;
        const before = calculateNetWorth(mbsState(), 'bob');
        expect(calculateNetWorth(reinvest, 'bob') - before).toBeCloseTo(-70);
        expect(calculateNetWorth(payout, 'bob') - before).toBeCloseTo(-70);
    });

    test('Payout: rent paid late at End Turn is passed on too', () => {
        const state = setPolicy(mbsState(), 'payout');
        state.players.find(p => p.userId === 'bob').cash = 30;
        let { state: after } = landOnBoardwalk(state, 'bob');
        expect(cashOf(after, 'bob')).toBe(0);
        expect(after.bankruptcyClaims.bob.unpaidAmount).toBe(40);
        after.players.find(p => p.userId === 'bob').cash = 100; // raised cash before ending the turn
        after = act(after, 'bob', 'end_turn');
        expect(cashOf(after, 'bob')).toBe(60);
        // $70 reached the other holders, less the odd cents rounding leaves in the treasury.
        expect(cashOf(after, 'alice') + cashOf(after, 'carol') + corpOf(after).cash).toBeCloseTo(3000 + 70);
        expect(corpOf(after).cash).toBeLessThan(0.05);
        expect(after.bankruptcyClaims.bob).toBeUndefined();
    });
});

describe('dividends', () => {
    test('split the amount by shares; the treasury keeps its own shares\' slice', () => {
        const state = mbsState({ holders: { alice: 600, bob: 300 }, cash: 1000 });
        const after = act(state, 'alice', 'pay_dividend', { corpId: corpOf(state).id, amount: 500 });
        expect(cashOf(after, 'alice')).toBe(1800);
        expect(cashOf(after, 'bob')).toBe(1650);
        expect(corpOf(after).cash).toBe(550);
    });

    test('cannot exceed the treasury and only the runner can pay one', () => {
        const state = mbsState({ cash: 100 });
        refused(() => act(state, 'alice', 'pay_dividend', { corpId: corpOf(state).id, amount: 101 }), /treasury has \$100/);
        const bobsTurn = normalizeState(state);
        bobsTurn.currentPlayerIndex = 1;
        refused(() => act(bobsTurn, 'bob', 'pay_dividend', { corpId: corpOf(state).id, amount: 10 }), /chairman/);
    });
});

describe('spending the treasury', () => {
    function onIllinois(state) {
        const next = normalizeState(state);
        next.players[0].position = 24 - 3;
        return act(next, 'alice', 'roll_dice', {}, { dice: [1, 2] });
    }

    test('the chairman buys the property they landed on for the company', () => {
        const state = onIllinois(mbsState({ cash: 300 }));
        const after = act(state, 'alice', 'buy_property', { corpId: corpOf(state).id });
        const prop = after.properties.find(p => p.id === ILLINOIS);
        expect(prop.ownerId).toBe(corpOf(after).id);
        expect(corpOf(after).cash).toBe(60);
        expect(cashOf(after, 'alice')).toBe(1500);
        expect(corpOf(after).assets.map(a => a.id)).toContain(ILLINOIS);
    });

    test('buying for the company needs enough treasury cash', () => {
        const state = onIllinois(mbsState({ cash: 200 }));
        refused(() => act(state, 'alice', 'buy_property', { corpId: corpOf(state).id }), /treasury has \$200/);
    });

    test('the company builds houses on a group it owns whole, from the treasury', () => {
        const state = mbsState({ cash: 500 });
        const after = act(state, 'alice', 'buy_houses', { corpId: corpOf(state).id, selections: { [PARK_PLACE]: 1, [BOARDWALK]: 1 } });
        expect(after.properties.find(p => p.id === BOARDWALK).houses).toBe(1);
        expect(corpOf(after).cash).toBe(100);
        expect(cashOf(after, 'alice')).toBe(1500);
    });

    test('a group split between the chairman and the company cannot be built on', () => {
        let state = mbsState({ cash: 500 });
        state = own(state, [ILLINOIS, KENTUCKY], corpOf(state).id, '[MBS]');
        refused(() => act(state, 'alice', 'buy_houses', { corpId: corpOf(state).id, selections: { [ILLINOIS]: 1 } }), /whole Red group/);
    });
});

describe('offering a property to a company', () => {
    // MBS: Dark Blues $750, no cash, 12,000 shares, so $0.0625 a share.
    function offer(state, userId, payload) {
        return act(state, userId, 'offer_property_to_corporation', { corpId: corpOf(state).id, ...payload });
    }
    function respond(state, userId, response, extra = {}) {
        const pending = state.propertyOffers.find(o => o.status === 'pending');
        return act(state, userId, 'respond_property_offer', { offerId: pending.id, response, ...extra });
    }

    test('at book value: new shares at the current value per share, nobody loses value', () => {
        let state = own(mbsState(), [ILLINOIS], 'bob', 'Bob');
        const aliceBefore = calculateNetWorth(state, 'alice');
        const bobBefore = calculateNetWorth(state, 'bob');
        state = offer(state, 'bob', { assetIds: [ILLINOIS] });
        expect(state.propertyOffers[0]).toMatchObject({ priceBasis: 'book', price: 240, awaiting: 'corporation' });
        // Not on anyone's turn in particular: Alice answers whenever.
        state = respond(state, 'alice', 'accept');
        const corp = corpOf(state);
        expect(state.properties.find(p => p.id === ILLINOIS).ownerId).toBe(corp.id);
        expect(sharesOf(corp, 'bob')).toBe(3600 + 3840); // 240 / 0.0625
        expect(corp.totalShares).toBe(15840);
        expect(calculateNetWorth(state, 'alice')).toBeCloseTo(aliceBefore);
        expect(calculateNetWorth(state, 'bob')).toBeCloseTo(bobBefore);
    });

    test('at a set price: the chairman counters and the offerer accepts', () => {
        let state = own(mbsState(), [ILLINOIS], 'bob', 'Bob');
        state = offer(state, 'bob', { assetIds: [ILLINOIS], price: 300 });
        refused(() => respond(state, 'bob', 'accept'), /waiting for MBS's chairman/);
        state = respond(state, 'alice', 'counter', { price: 270 });
        expect(state.propertyOffers[0]).toMatchObject({ price: 270, awaiting: 'offerer' });
        refused(() => respond(state, 'alice', 'accept'), /waiting for Bob/);
        state = respond(state, 'bob', 'accept');
        expect(sharesOf(corpOf(state), 'bob')).toBe(3600 + 4320); // 270 / 0.0625
        expect(state.propertyOffers[0].status).toBe('accepted');
    });

    test('paid in treasury cash instead of shares', () => {
        let state = own(mbsState({ cash: 400 }), [ILLINOIS], 'carol', 'Carol');
        state = offer(state, 'carol', { assetIds: [ILLINOIS], price: 250, payWith: 'cash' });
        state = respond(state, 'alice', 'accept');
        expect(cashOf(state, 'carol')).toBe(1750);
        expect(corpOf(state).cash).toBe(150);
        expect(corpOf(state).totalShares).toBe(12000);
    });

    test('a deal that hands over a majority makes the offerer chairman', () => {
        let state = own(mbsState({ holders: { alice: 600, bob: 400 } }), [ILLINOIS, KENTUCKY, MEDITERRANEAN, BALTIC], 'bob', 'Bob');
        state = offer(state, 'bob', { assetIds: [ILLINOIS, KENTUCKY, MEDITERRANEAN, BALTIC] });
        state = respond(state, 'alice', 'accept');
        expect(corpOf(state).chairmanId).toBe('bob');
    });

    test('the runner adds their own property at book value, not by offer', () => {
        const state = own(mbsState(), [ILLINOIS], 'alice', 'Alice');
        refused(() => offer(state, 'alice', { assetIds: [ILLINOIS], price: 999 }), /You run MBS/);
    });

    test('either side can walk away; outsiders cannot answer', () => {
        let state = own(mbsState(), [ILLINOIS], 'bob', 'Bob');
        state = offer(state, 'bob', { assetIds: [ILLINOIS] });
        refused(() => respond(state, 'carol', 'accept'), /Only Bob or MBS's chairman/);
        const withdrawn = respond(state, 'bob', 'decline');
        expect(withdrawn.propertyOffers[0].status).toBe('canceled');
        const declined = respond(state, 'alice', 'decline');
        expect(declined.propertyOffers[0].status).toBe('declined');
    });

    test('the offer fails on acceptance if the property has moved on', () => {
        let state = own(mbsState(), [ILLINOIS], 'bob', 'Bob');
        state = offer(state, 'bob', { assetIds: [ILLINOIS] });
        own(state, [ILLINOIS], 'carol', 'Carol');
        refused(() => respond(state, 'alice', 'accept'), /no longer owns Illinois/);
    });
});

describe('trading as the company', () => {
    function propose(state, userId, payload) {
        return act(state, userId, 'propose_trade', payload);
    }
    function acceptFirst(state, userId) {
        const pending = state.marketOffers.find(o => o.status === 'pending');
        return act(state, userId, 'accept_trade', { offerId: pending.id });
    }

    test('MBS buys a property from another player with treasury cash', () => {
        let state = own(mbsState({ cash: 500 }), [ILLINOIS], 'carol', 'Carol');
        state = propose(state, 'alice', {
            player1Id: 'alice', player1CorpId: corpOf(state).id, player2Id: 'carol',
            player1Cash: 300, player2AssetIds: [ILLINOIS],
        });
        expect(state.marketOffers[0]).toMatchObject({ player1CorpTicker: 'MBS', recipientId: 'carol' });
        state = acceptFirst(state, 'carol');
        expect(state.properties.find(p => p.id === ILLINOIS).ownerId).toBe(corpOf(state).id);
        expect(corpOf(state).cash).toBe(200);
        expect(cashOf(state, 'carol')).toBe(1800);
        expect(cashOf(state, 'alice')).toBe(1500);
    });

    test('a property the company trades away leaves its books', () => {
        let state = mbsState();
        const navBefore = calculateNetWorth(state, 'alice');
        state = propose(state, 'alice', {
            player1Id: 'alice', player1CorpId: corpOf(state).id, player2Id: 'carol',
            player1AssetIds: [PARK_PLACE], player2Cash: 350,
        });
        state = acceptFirst(state, 'carol');
        expect(state.properties.find(p => p.id === PARK_PLACE).ownerId).toBe('carol');
        expect(corpOf(state).assets.map(a => a.id)).not.toContain(PARK_PLACE);
        expect(corpOf(state).cash).toBe(350);
        expect(calculateNetWorth(state, 'alice')).toBeCloseTo(navBefore);
    });

    test('buyback: shares the company receives go back to its treasury', () => {
        let state = mbsState({ cash: 300 });
        state = propose(state, 'alice', {
            player1Id: 'alice', player1CorpId: corpOf(state).id, player2Id: 'carol',
            player1Cash: 150, player2Shares: [{ corpId: corpOf(state).id, shares: 2400 }],
        });
        state = acceptFirst(state, 'carol');
        expect(sharesOf(corpOf(state), 'carol')).toBe(0);
        expect(corpOf(state).treasuryShares).toBe(2400);
        expect(corpOf(state).cash).toBe(150);
    });

    test('the company sells treasury shares in a trade', () => {
        let state = mbsState({ holders: { alice: 500, bob: 300 } }); // 2,400 treasury shares
        state = propose(state, 'alice', {
            player1Id: 'alice', player1CorpId: corpOf(state).id, player2Id: 'carol',
            player1Shares: [{ corpId: corpOf(state).id, shares: 1800 }], player2Cash: 120,
        });
        state = acceptFirst(state, 'carol');
        expect(sharesOf(corpOf(state), 'carol')).toBe(1800);
        expect(corpOf(state).treasuryShares).toBe(600);
        expect(corpOf(state).cash).toBe(120);
    });

    test('the chairman cannot trade personally with their own company', () => {
        const state = own(mbsState({ cash: 500 }), [ILLINOIS], 'alice', 'Alice');
        // Only the runner can trade for MBS...
        refused(() => propose(state, 'alice', {
            player1Id: 'alice', player2Id: 'bob', player2CorpId: corpOf(state).id,
            player1AssetIds: [ILLINOIS], player2Cash: 500,
        }), /Bob does not run MBS/);
        // ...and a runner can't be paid by MBS personally, even when someone
        // else chairs it and they hold the majority.
        const bobChairs = mbsState({ holders: { alice: 600, bob: 300, carol: 100 }, cash: 500 });
        own(bobChairs, [ILLINOIS], 'alice', 'Alice');
        bobChairs.corporations[0].chairmanId = 'bob';
        bobChairs.corporations[0].chairmanName = 'Bob';
        refused(() => propose(bobChairs, 'bob', {
            player1Id: 'bob', player1CorpId: corpOf(bobChairs).id, player2Id: 'alice',
            player1Cash: 500, player2AssetIds: [ILLINOIS],
        }), /Alice runs MBS/);
    });

    test('company to company: MBS pays CDO for a property', () => {
        let state = own(mbsState({ cash: 400 }), [ILLINOIS, KENTUCKY], 'carol', 'Carol');
        state.currentPlayerIndex = 2;
        state = act(state, 'carol', 'create_ipo', { ticker: 'CDO', assetIds: [ILLINOIS, KENTUCKY] });
        const mbs = state.corporations.find(c => c.ticker === 'MBS');
        const cdo = state.corporations.find(c => c.ticker === 'CDO');
        state = propose(state, 'alice', {
            player1Id: 'alice', player1CorpId: mbs.id, player2Id: 'carol', player2CorpId: cdo.id,
            player1Cash: 300, player2AssetIds: [KENTUCKY],
        });
        state = acceptFirst(state, 'carol');
        const after = id => state.corporations.find(c => c.id === id);
        expect(state.properties.find(p => p.id === KENTUCKY).ownerId).toBe(mbs.id);
        expect(after(mbs.id).cash).toBe(100);
        expect(after(cdo.id).cash).toBe(300);
        expect(after(cdo.id).assets.map(a => a.id)).toEqual([ILLINOIS]);
        expect(cashOf(state, 'alice')).toBe(1500);
        expect(cashOf(state, 'carol')).toBe(1500);
    });
});
