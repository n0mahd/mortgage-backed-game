'use strict';

// Mergers: whoever runs one corporation offers the owners of another cash plus
// a stake of the merged company. The target's owners vote by shares (holders
// who run the buyer don't vote); it closes the moment yes passes half.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    calculateNetWorth,
    mergerQuote,
    mergerTally,
} = require('../../domain/gameRules');

const MBS_PROPS = ['prop-21', 'prop-22', 'prop-23', 'prop-17', 'prop-13']; // $1,400
const RAILROADS = ['prop-9', 'prop-16', 'prop-24', 'prop-27']; // $800

function player(userId, name) {
    return {
        userId, name, cash: 1500, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: false, properties: [], corporations: [], debts: [],
    };
}

function corp(id, ticker, chairman, shareholders, cash, debts = []) {
    return {
        id, ticker, name: `${ticker} Corporation`,
        founderId: chairman.userId, founderName: chairman.name,
        chairmanId: chairman.userId, chairmanName: chairman.name,
        totalShares: shareholders.reduce((sum, h) => sum + h.shares, 0),
        shareholders, treasuryShares: 0, availableShares: 0, cash, debts, assets: [], chairmanVotes: [],
        rentPolicy: 'reinvest',
    };
}

// Sam runs MBS (worth $2,200). RRX is worth $800 ($800 of railroads + $150
// cash - a $150 loan): Priya 60% (chairman), Lee 30%, Sam 10%.
function makeState({ rrxHolders } = {}) {
    const sam = player('sam', 'Sam');
    const priya = player('priya', 'Priya');
    const lee = player('lee', 'Lee');
    const properties = MONOPOLY_PROPERTIES.map((prop, index) => ({ ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0 }));
    const ownBy = (ids, ownerId, ownerName) => ids.forEach(id => Object.assign(properties.find(p => p.id === id), { ownerId, ownerName }));
    ownBy(MBS_PROPS, 'corp-mbs', '[MBS]');
    ownBy(RAILROADS, 'corp-rrx', '[RRX]');
    const mbs = corp('corp-mbs', 'MBS', sam, [{ userId: 'sam', name: 'Sam', shares: 12000 }], 800);
    const rrx = corp('corp-rrx', 'RRX', priya, rrxHolders || [
        { userId: 'priya', name: 'Priya', shares: 7200 },
        { userId: 'lee', name: 'Lee', shares: 3600 },
        { userId: 'sam', name: 'Sam', shares: 1200 },
    ], 150, [{ id: 'loan-1', principal: 150, interestRate: 5, termTurns: 10, turnsRemaining: 10 }]);
    mbs.assets = MBS_PROPS.map(id => ({ id, name: id, value: 0 }));
    rrx.assets = RAILROADS.map(id => ({ id, name: id, value: 0 }));
    return normalizeState({
        currentPlayerIndex: 0,
        players: [sam, priya, lee],
        properties,
        corporations: [mbs, rrx],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, loanRate: 5 },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
}

const byId = (state, id) => state.corporations.find(c => c.id === id);
const sharesOf = (c, userId) => c.shareholders.find(h => h.userId === userId)?.shares || 0;
const cashOf = (state, userId) => state.players.find(p => p.userId === userId).cash;

function propose(state, payload = {}, actor = 'sam') {
    return applyAction(state, actor, {
        type: 'propose_merger',
        payload: { acquirerId: 'corp-mbs', targetId: 'corp-rrx', cash: 300, stakePercent: 20, ...payload },
    }).state;
}

function vote(state, actor, approve) {
    const merger = state.mergerProposals.find(m => m.status === 'open');
    return applyAction(state, actor, { type: 'vote_merger', payload: { mergerId: merger.id, approve } }).state;
}

describe('merger maths', () => {
    test('prices the deal: new shares, merged value, each owner\'s payout and the fair stake', () => {
        const state = makeState();
        const quote = mergerQuote(state, byId(state, 'corp-mbs'), byId(state, 'corp-rrx'), 300, 20);
        expect(quote.acquirerValue).toBe(2200);
        expect(quote.targetValue).toBe(800);
        expect(quote.newShares).toBe(3000);
        expect(quote.mergedValue).toBe(2700);
        expect(quote.offerValue).toBe(840);
        expect(quote.fairStakePercent).toBeCloseTo(18.52, 2);
        const lines = Object.fromEntries(quote.payouts.map(p => [p.userId, [p.cash, p.newShares, p.valueBefore, p.valueAfter]]));
        expect(lines.priya).toEqual([180, 1800, 480, 504]);
        expect(lines.lee).toEqual([90, 900, 240, 252]);
        expect(lines.sam).toEqual([30, 300, 80, 84]);
    });

    test('less cash means a bigger fair stake', () => {
        const state = makeState();
        const fair = cash => mergerQuote(state, byId(state, 'corp-mbs'), byId(state, 'corp-rrx'), cash, 0).fairStakePercent;
        expect(fair(0)).toBeCloseTo(26.67, 2);
        expect(fair(600)).toBeCloseTo(8.33, 2);
        expect(fair(800)).toBe(0);
    });
});

describe('proposing a merger', () => {
    test('only whoever runs the buyer can propose', () => {
        expect(() => propose(makeState(), {}, 'priya')).toThrow(/chairman or a majority holder/);
    });

    test('rejects bad terms', () => {
        const state = makeState();
        expect(() => propose(state, { cash: 951 })).toThrow(/not enough/);
        expect(() => propose(state, { stakePercent: 96 })).toThrow(/0% to 95%/);
        expect(() => propose(state, { targetId: 'corp-mbs' })).toThrow(/itself/);
        expect(() => propose(state, { ticker: 'MBS' })).not.toThrow();
    });

    test('one open merger per corporation', () => {
        const state = propose(makeState());
        expect(() => propose(state)).toThrow(/already in a merger vote/);
    });

    test('the buyer\'s own holdings in the target do not vote', () => {
        const state = propose(makeState());
        const tally = mergerTally(state, state.mergerProposals[0]);
        expect(tally.voters.map(v => v.userId).sort()).toEqual(['lee', 'priya']);
        expect(tally.votingShares).toBe(10800);
        expect(tally.neededShares).toBe(5401);
        expect(() => vote(state, 'sam', true)).toThrow(/don't run MBS/);
    });
});

describe('the vote', () => {
    test('stays open until yes passes half, then closes the merger at once', () => {
        const before = makeState();
        const worth = Object.fromEntries(['sam', 'priya', 'lee'].map(id => [id, calculateNetWorth(before, id)]));
        let state = propose(before);
        state = vote(state, 'lee', true);
        expect(state.mergerProposals[0].status).toBe('open');
        state = vote(state, 'priya', true);
        expect(state.mergerProposals[0].status).toBe('passed');

        const mbs = byId(state, 'corp-mbs');
        const rrx = byId(state, 'corp-rrx');
        expect(state.properties.filter(p => RAILROADS.includes(p.id)).every(p => p.ownerId === 'corp-mbs')).toBe(true);
        expect(mbs.totalShares).toBe(15000);
        expect([sharesOf(mbs, 'sam'), sharesOf(mbs, 'priya'), sharesOf(mbs, 'lee')]).toEqual([12300, 1800, 900]);
        expect(mbs.cash).toBe(650);
        expect(mbs.debts.map(d => d.id)).toContain('loan-1');
        expect(rrx.status).toBe('merged');
        expect(rrx.mergedInto.ticker).toBe('MBS');
        expect([rrx.totalShares, rrx.cash, rrx.debts.length, rrx.shareholders.length, rrx.chairmanId]).toEqual([0, 0, 0, 0, null]);
        expect(cashOf(state, 'priya')).toBe(1680);

        const change = id => Math.round((calculateNetWorth(state, id) - worth[id]) * 100) / 100;
        expect([change('sam'), change('priya'), change('lee')]).toEqual([-36, 24, 12]);
    });

    test('a majority of the voting shares alone is enough', () => {
        const state = vote(propose(makeState()), 'priya', true);
        expect(state.mergerProposals[0].status).toBe('passed');
    });

    test('fails once it can no longer pass', () => {
        let state = propose(makeState());
        state = vote(state, 'lee', false);
        expect(state.mergerProposals[0].status).toBe('open');
        state = vote(state, 'priya', false);
        expect(state.mergerProposals[0].status).toBe('rejected');
        expect(byId(state, 'corp-rrx').status).toBe('active');
    });

    test('closes on proposal when the buyer owns the whole target', () => {
        const state = propose(makeState({ rrxHolders: [{ userId: 'sam', name: 'Sam', shares: 12000 }] }), { cash: 0, stakePercent: 0 });
        expect(state.mergerProposals[0].status).toBe('passed');
        expect(byId(state, 'corp-rrx').status).toBe('merged');
    });

    test('the proposer can withdraw it', () => {
        let state = propose(makeState());
        const id = state.mergerProposals[0].id;
        state = applyAction(state, 'sam', { type: 'withdraw_merger', payload: { mergerId: id } }).state;
        expect(state.mergerProposals[0].status).toBe('withdrawn');
        expect(() => applyAction(state, 'priya', { type: 'vote_merger', payload: { mergerId: id, approve: true } })).toThrow(/not found/);
    });

    test('expires when the proposer\'s turn comes round', () => {
        let state = propose(makeState());
        for (const id of ['sam', 'priya', 'lee']) {
            state.players.find(p => p.userId === id).diceRolled = true;
            state = applyAction(state, id, { type: 'end_turn' }).state;
        }
        expect(state.mergerProposals[0].status).toBe('expired');
    });

    test('is canceled if the buyer can no longer pay when it passes', () => {
        let state = propose(makeState());
        byId(state, 'corp-mbs').cash = 100;
        state = vote(state, 'priya', true);
        expect(state.mergerProposals[0].status).toBe('canceled');
        expect(state.mergerProposals[0].closeReason).toBe('cannot_complete');
        expect(byId(state, 'corp-rrx').status).toBe('active');
    });
});

describe('the ticker of the merged company', () => {
    test('can be new', () => {
        const state = vote(propose(makeState(), { ticker: 'mrx' }), 'priya', true);
        const merged = byId(state, 'corp-mbs');
        expect(merged.ticker).toBe('MRX');
        expect(merged.name).toBe('MRX Corporation');
        expect(state.properties.find(p => p.id === 'prop-9').ownerName).toBe('[MRX]');
        expect(byId(state, 'corp-rrx').mergedInto.ticker).toBe('MRX');
    });

    test('can be the target\'s, but not another company\'s', () => {
        const state = makeState();
        const renamed = vote(propose(state, { ticker: 'RRX' }), 'priya', true);
        expect(byId(renamed, 'corp-mbs').ticker).toBe('RRX');
        expect(byId(renamed, 'corp-rrx').mergedInto).toMatchObject({ ticker: 'RRX', acquirerTicker: 'MBS' });
        state.corporations.push({ ...byId(state, 'corp-rrx'), id: 'corp-xyz', ticker: 'XYZ', shareholders: [], totalShares: 0 });
        expect(() => propose(normalizeState(state), { ticker: 'XYZ' })).toThrow(/already taken/);
    });
});

describe('a merged company', () => {
    test('takes no payments or trades', () => {
        const state = vote(propose(makeState()), 'priya', true);
        expect(() => applyAction(state, 'lee', { type: 'manual_payment', payload: { toCorpId: 'corp-rrx', amount: 10 } })).toThrow(/merged into MBS/);
        expect(() => applyAction(state, 'priya', {
            type: 'propose_trade',
            payload: { player1Id: 'priya', player2Id: 'sam', player1CorpId: 'corp-rrx', player1Cash: 0, player2Cash: 10 },
        })).toThrow(/merged into MBS/);
    });

    test('stays merged through a save and reload', () => {
        const state = normalizeState(JSON.parse(JSON.stringify(vote(propose(makeState()), 'priya', true))));
        const rrx = byId(state, 'corp-rrx');
        expect(rrx.status).toBe('merged');
        expect(rrx.chairmanId).toBeNull();
    });
});

describe('fair prices', () => {
    test('a fair stake leaves the owners whole even when the target holds treasury shares', () => {
        // RRX: Priya 7,200, Lee 3,600 and 1,200 in its own treasury (from a bankruptcy).
        const before = makeState({ rrxHolders: [{ userId: 'priya', name: 'Priya', shares: 7200 }, { userId: 'lee', name: 'Lee', shares: 3600 }] });
        Object.assign(byId(before, 'corp-rrx'), { totalShares: 12000, treasuryShares: 1200 });
        const state = normalizeState(before);
        const quote = mergerQuote(state, byId(state, 'corp-mbs'), byId(state, 'corp-rrx'), 300, 0);
        // The owners hold 90% of RRX ($800), so their shares are worth $720.
        expect(quote.ownersValue).toBe(720);
        expect(quote.fairStakePercent).toBeCloseTo((720 - 300) / 2700 * 100, 6);
        const worth = id => calculateNetWorth(state, id);
        const startWorth = { priya: worth('priya'), lee: worth('lee') };
        let after = propose(state, { stakePercent: Math.round(quote.fairStakePercent * 100) / 100 });
        after = vote(after, 'priya', true);
        expect(after.mergerProposals[0].status).toBe('passed');
        // Whole shares round the result by at most a cent or two.
        expect(Math.abs(calculateNetWorth(after, 'priya') - startWorth.priya)).toBeLessThan(0.1);
        expect(Math.abs(calculateNetWorth(after, 'lee') - startWorth.lee)).toBeLessThan(0.1);
    });

    test('treasury shares sell at the exact value per share, not one rounded to the cent', () => {
        // MBS worth $300 over 12,000 shares: $0.025 a share. 6,000 sit in its treasury.
        const state = makeState();
        const mbs = byId(state, 'corp-mbs');
        state.properties.forEach(p => { if (p.ownerId === 'corp-mbs') { p.ownerId = null; p.ownerName = null; } });
        mbs.assets = [];
        mbs.cash = 300;
        mbs.shareholders = [{ userId: 'sam', name: 'Sam', shares: 6000 }];
        mbs.treasuryShares = 6000;
        state.currentPlayerIndex = 1; // Priya's turn
        const result = applyAction(normalizeState(state), 'priya', { type: 'buy_shares', payload: { corpId: 'corp-mbs', shares: 6000 } });
        expect(cashOf(result.state, 'priya')).toBe(1500 - 150);
        expect(byId(result.state, 'corp-mbs').cash).toBe(450);
    });
});

