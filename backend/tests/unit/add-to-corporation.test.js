'use strict';

// Whoever runs an LLC can put more of their own properties into it. With other
// shareholders, the runner can take whole new shares priced at the current
// value per share (rounded down, 12 shares at most); otherwise the property is
// a gift that raises every share's value.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    calculateNetWorth,
    GameRuleError,
} = require('../../domain/gameRules');

// Atlantic, Ventnor, Marvin Gardens, Reading and Pennsylvania Railroads: $1,200.
const MBS_ASSETS = ['prop-17', 'prop-18', 'prop-20', 'prop-9', 'prop-16'];
const ILLINOIS = 'prop-15'; // $240
const KENTUCKY = 'prop-13'; // $220
const MEDITERRANEAN = 'prop-0'; // $60
const ORANGE = ['prop-10', 'prop-11', 'prop-12'];

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

function own(state, ids, ownerId, ownerName) {
    ids.forEach(id => {
        const prop = state.properties.find(p => p.id === id);
        prop.ownerId = ownerId;
        prop.ownerName = ownerName;
    });
    return state;
}

// Alice founds MBS ($1,200, 10 shares) and holds `aliceShares`; Bob holds the rest.
function mbsState({ totalShares = 10, aliceShares = 7 } = {}) {
    let state = own(makeState(), [...MBS_ASSETS, ILLINOIS, KENTUCKY, MEDITERRANEAN], 'alice', 'Alice');
    state = applyAction(state, 'alice', {
        type: 'create_ipo',
        payload: { ticker: 'MBS', totalShares, pricePerShare: 100, assetIds: MBS_ASSETS },
    }).state;
    const corp = state.corporations[0];
    const bobShares = totalShares - aliceShares;
    corp.shareholders = [{ userId: 'alice', name: 'Alice', shares: aliceShares }];
    if (bobShares > 0) corp.shareholders.push({ userId: 'bob', name: 'Bob', shares: bobShares });
    return state;
}

function add(state, actorId, payload) {
    return applyAction(state, actorId, {
        type: 'add_to_corporation',
        payload: { corpId: state.corporations[0].id, ...payload },
    });
}

function sharesOf(corp, userId) {
    return corp.shareholders.find(holder => holder.userId === userId)?.shares || 0;
}

function expectRefused(fn, message) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    expect(error.message).toMatch(message);
}

describe('adding properties to an existing corporation', () => {
    test('new shares are priced at the current value per share, so the other holders keep their value', () => {
        const state = mbsState();
        const bobBefore = calculateNetWorth(state, 'bob');
        const { state: after, events } = add(state, 'alice', { assetIds: [ILLINOIS], issueShares: true });
        const corp = after.corporations[0];
        // $240 at $120 a share is 2 shares.
        expect(corp.totalShares).toBe(12);
        expect(sharesOf(corp, 'alice')).toBe(9);
        expect(sharesOf(corp, 'bob')).toBe(3);
        expect(after.properties.find(p => p.id === ILLINOIS).ownerId).toBe(corp.id);
        expect(corp.assets.map(a => a.id)).toContain(ILLINOIS);
        expect(calculateNetWorth(after, 'bob')).toBeCloseTo(bobBefore);
        expect(events.map(e => e.type)).toContain('corporation_assets_added');
        expect(after.gameLog.map(entry => entry.message).join('\n')).toMatch(/Alice put Illinois Avenue into MBS and received 2 new shares \(MBS now has 12\)/);
    });

    test('new shares are whole and rounded down', () => {
        // $220 at $120 a share is 1.83, so 1 share.
        const { state } = add(mbsState(), 'alice', { assetIds: [KENTUCKY], issueShares: true });
        expect(state.corporations[0].totalShares).toBe(11);
        expect(Number.isInteger(sharesOf(state.corporations[0], 'alice'))).toBe(true);
        expect(sharesOf(state.corporations[0], 'alice')).toBe(8);
    });

    test('a property worth less than one share gets no shares', () => {
        expectRefused(() => add(mbsState(), 'alice', { assetIds: [MEDITERRANEAN], issueShares: true }), /less than one MBS share/);
    });

    test('the 12-share cap limits how many new shares are issued', () => {
        // 11 shares at ~$109: Illinois is worth 2, but only 1 more fits.
        const { state } = add(mbsState({ totalShares: 11, aliceShares: 8 }), 'alice', { assetIds: [ILLINOIS], issueShares: true });
        expect(state.corporations[0].totalShares).toBe(12);
        expect(sharesOf(state.corporations[0], 'alice')).toBe(9);
    });

    test('at 12 shares no new shares can be issued, but the property can still go in as a gift', () => {
        const state = mbsState({ totalShares: 12, aliceShares: 9 });
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS], issueShares: true }), /most allowed/);
        const bobBefore = calculateNetWorth(state, 'bob');
        const { state: after } = add(state, 'alice', { assetIds: [ILLINOIS], issueShares: false });
        expect(after.corporations[0].totalShares).toBe(12);
        expect(after.properties.find(p => p.id === ILLINOIS).ownerId).toBe(after.corporations[0].id);
        // Bob's 3 of 12 shares gain a quarter of $240.
        expect(calculateNetWorth(after, 'bob') - bobBefore).toBeCloseTo(60);
    });

    test('a sole owner just moves the property in; new shares are refused as meaningless', () => {
        const state = mbsState({ totalShares: 10, aliceShares: 10 });
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS], issueShares: true }), /every MBS share/);
        const aliceBefore = calculateNetWorth(state, 'alice');
        const { state: after } = add(state, 'alice', { assetIds: [ILLINOIS] });
        expect(after.corporations[0].totalShares).toBe(10);
        expect(calculateNetWorth(after, 'alice')).toBeCloseTo(aliceBefore);
    });

    test('shares cannot be priced when the corporation is worth $0 or less', () => {
        const state = mbsState();
        state.corporations[0].debts.push({ id: 'debt-x', principal: 1500, interestRate: 5, collateral: [] });
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS], issueShares: true }), /can't be priced/);
    });

    test('only the player who runs the corporation can add to it', () => {
        const state = own(mbsState(), ['prop-21'], 'bob', 'Bob');
        state.currentPlayerIndex = 1;
        expectRefused(() => add(state, 'bob', { assetIds: ['prop-21'] }), /don't run MBS/);
    });

    test('only on your own turn', () => {
        const state = mbsState();
        state.currentPlayerIndex = 1;
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS] }), /Not the current player/);
    });

    test('only properties you own', () => {
        const state = own(mbsState(), ['prop-21'], 'bob', 'Bob');
        expectRefused(() => add(state, 'alice', { assetIds: ['prop-21'] }), /you own/);
        expectRefused(() => add(state, 'alice', { assetIds: [] }), /Choose a property/);
    });

    test('an insolvent corporation cannot take property', () => {
        const state = mbsState();
        state.corporations[0].insolvent = true;
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS] }), /insolvent/);
    });

    test('a property backing a loan cannot go in, be put into an IPO, or be traded', () => {
        let state = mbsState();
        state = applyAction(state, 'alice', { type: 'issue_debt', payload: { amount: 100, collateralIds: [ILLINOIS] } }).state;
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS] }), /backs a loan/);
        expectRefused(() => applyAction(state, 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ILL', totalShares: 10, pricePerShare: 10, assetIds: [ILLINOIS] },
        }), /backs a loan/);
        expectRefused(() => applyAction(state, 'alice', {
            type: 'propose_trade',
            payload: { player1Id: 'alice', player2Id: 'bob', player1Cash: 0, player2Cash: 200, player1AssetIds: [ILLINOIS], player2AssetIds: [] },
        }), /backs a loan/);
    });

    test('a built colour group goes in whole, buildings and all', () => {
        let state = own(mbsState(), ORANGE, 'alice', 'Alice');
        state.properties.find(p => p.id === ORANGE[0]).houses = 2;
        expectRefused(() => add(state, 'alice', { assetIds: [ORANGE[0]] }), /whole group/);
        state = add(state, 'alice', { assetIds: ORANGE, issueShares: true }).state;
        const corp = state.corporations[0];
        ORANGE.forEach(id => expect(state.properties.find(p => p.id === id).ownerId).toBe(corp.id));
        expect(state.properties.find(p => p.id === ORANGE[0]).houses).toBe(2);
        // $560 of land plus 2 houses at $100 is $760; at $120 a share that is 6, capped at 2.
        expect(corp.totalShares).toBe(12);
    });

    test('a player owing an unpaid claim cannot shelter property in a corporation', () => {
        const state = mbsState();
        state.bankruptcyClaims = { alice: { debtorId: 'alice', amountOwed: 500, paidAmount: 0, unpaidAmount: 500, creditorType: 'bank' } };
        expectRefused(() => add(state, 'alice', { assetIds: [ILLINOIS] }), /unpaid claim/);
    });

    test('a majority holder who is not chairman can add, and gains no automatic chair change', () => {
        const state = mbsState({ totalShares: 10, aliceShares: 4 });
        // Bob holds 6 of 10 but Alice is still chairman.
        state.currentPlayerIndex = 1;
        own(state, ['prop-21'], 'bob', 'Bob');
        const { state: after } = add(state, 'bob', { assetIds: ['prop-21'], issueShares: true });
        const corp = after.corporations[0];
        // $300 at $120 a share is 2.5, so 2 shares.
        expect(sharesOf(corp, 'bob')).toBe(8);
        expect(corp.chairmanId).toBe('alice');
    });
});

describe('agents see add_to_corporation in their legal actions', () => {
    const { listLegalActions } = require('../../domain/actionCatalog');

    test('the runner, on their turn, with a property to add', () => {
        const action = listLegalActions(mbsState(), 'alice').find(item => item.type === 'add_to_corporation');
        expect(action).toBeDefined();
        expect(action.examples).toEqual(expect.arrayContaining([expect.objectContaining({ issueShares: true })]));
    });

    test('not for a player who does not run the corporation', () => {
        const state = own(mbsState(), ['prop-21'], 'bob', 'Bob');
        state.currentPlayerIndex = 1;
        expect(listLegalActions(state, 'bob').some(item => item.type === 'add_to_corporation')).toBe(false);
    });
});
