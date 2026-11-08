'use strict';

// House rules (Pass GO, the loan rate) change mid-game only by a unanimous vote
// of the players who aren't bankrupt. One rejection ends a vote; a vote expires
// when its proposer's turn comes round.

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    createInitialGame,
    normalizeState,
    houseRules,
    GameRuleError,
} = require('../../domain/gameRules');

const BOARDWALK = 'prop-26'; // $400

function player(userId, name, cash = 1500) {
    return {
        userId, name, cash, position: 0, bankrupt: false, inJail: false, jailTurns: 0,
        hasGetOutOfJailCard: false, doubleCount: 0, diceRolled: true, properties: [], corporations: [], debts: [],
    };
}

function makeState({ players = [player('alice', 'Alice'), player('bob', 'Bob'), player('carol', 'Carol')], current = 0 } = {}) {
    const state = normalizeState({
        currentPlayerIndex: current,
        players,
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({ ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0 })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, loanRate: 5 },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
    Object.assign(state.properties.find(p => p.id === BOARDWALK), { ownerId: 'alice', ownerName: 'Alice' });
    return normalizeState(state);
}

const run = (state, actor, type, payload = {}, options = {}) => applyAction(state, actor, { type, payload }, options);
const act = (state, actor, type, payload = {}) => run(state, actor, type, payload).state;
const propose = (state, actor, rule, value) => act(state, actor, 'propose_rule_change', { rule, value });
const vote = (state, actor, approve) => act(state, actor, 'vote_rule_change', { approve });
const byId = (state, id) => state.players.find(p => p.userId === id);

// Ends the current player's turn (they have rolled).
function endTurn(state) {
    const current = state.players[state.currentPlayerIndex];
    state = act(state, current.userId, 'end_turn');
    state.players[state.currentPlayerIndex].diceRolled = true;
    return state;
}

function refusedWith(fn, message) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error).toBeInstanceOf(GameRuleError);
    expect(error.message).toMatch(message);
}

describe('rule proposals', () => {
    test('a change passes the moment every active player agrees', () => {
        let state = propose(makeState(), 'alice', 'passGoAmount', 300);
        expect(state.ruleProposal).toMatchObject({ rule: 'passGoAmount', value: 300, previousValue: 200, supporterIds: ['alice'] });
        state = vote(state, 'bob', true);
        expect(state.settings.passGoAmount).toBe(200);
        const { state: passed, events } = run(state, 'carol', 'vote_rule_change', { approve: true });
        expect(passed.settings.passGoAmount).toBe(300);
        expect(passed.ruleProposal).toBeNull();
        expect(events.map(e => e.type)).toContain('rule_change_passed');
        expect(passed.ruleChanges).toEqual([expect.objectContaining({ rule: 'passGoAmount', from: 200, to: 300, proposedByName: 'Alice' })]);
        expect(houseRules(passed).find(r => r.rule === 'passGoAmount')).toMatchObject({ value: 300, changedByVote: true, locked: true });
    });

    test('players vote off their turn; bankrupt players have no vote', () => {
        const players = [player('alice', 'Alice'), player('bob', 'Bob'), { ...player('carol', 'Carol'), bankrupt: true }];
        let state = propose(makeState({ players, current: 1 }), 'alice', 'loanRate', 3.5);
        state = vote(state, 'bob', true);
        expect(state.settings.loanRate).toBe(3.5);
        refusedWith(() => propose(state, 'carol', 'passGoAmount', 100), /Bankrupt player cannot act/);
    });

    test('one rejection ends the vote; the proposer waits for their next turn', () => {
        let state = propose(makeState({ current: 1 }), 'alice', 'passGoAmount', 300);
        state = vote(state, 'bob', true);
        const { state: rejected, events } = run(state, 'carol', 'vote_rule_change', { approve: false });
        expect(rejected.ruleProposal).toBeNull();
        expect(rejected.settings.passGoAmount).toBe(200);
        expect(events.map(e => e.type)).toContain('rule_change_rejected');
        refusedWith(() => propose(rejected, 'alice', 'passGoAmount', 250), /propose again from your next turn/);
        // Anyone else can propose straight away.
        expect(propose(rejected, 'bob', 'passGoAmount', 250).ruleProposal.proposedById).toBe('bob');
        // Bob ends his turn: it is Carol's. Carol ends hers: Alice's turn starts.
        let later = endTurn(rejected);
        refusedWith(() => propose(later, 'alice', 'passGoAmount', 250), /next turn/);
        later = endTurn(later);
        expect(propose(later, 'alice', 'passGoAmount', 250).ruleProposal.value).toBe(250);
    });

    test('values must be in range and on the step, and differ from the current rule', () => {
        const state = makeState();
        refusedWith(() => propose(state, 'alice', 'passGoAmount', 1050), /\$0 to \$1,000, in steps of \$50/);
        refusedWith(() => propose(state, 'alice', 'passGoAmount', 225), /in steps of \$50/);
        refusedWith(() => propose(state, 'alice', 'passGoAmount', -50), /\$0 to/);
        refusedWith(() => propose(state, 'alice', 'loanRate', 4.25), /0% to 25%, in steps of 0.5%/);
        refusedWith(() => propose(state, 'alice', 'loanRate', 26), /0% to 25%/);
        refusedWith(() => propose(state, 'alice', 'passGoAmount', 200), /already \$200/);
        refusedWith(() => propose(state, 'alice', 'startingCash', 2000), /Choose a rule/);
        const open = propose(state, 'alice', 'passGoAmount', 0);
        expect(open.ruleProposal.value).toBe(0);
        refusedWith(() => propose(open, 'bob', 'loanRate', 4), /already open/);
    });

    test('the proposer agrees by proposing and can only withdraw, not reject', () => {
        let state = propose(makeState(), 'alice', 'passGoAmount', 300);
        refusedWith(() => vote(state, 'alice', true), /already agreed/);
        refusedWith(() => vote(state, 'alice', false), /Withdraw/);
        refusedWith(() => act(state, 'bob', 'withdraw_rule_change'), /Only the player who proposed/);
        state = act(state, 'alice', 'withdraw_rule_change');
        expect(state.ruleProposal).toBeNull();
        refusedWith(() => vote(state, 'bob', true), /no rule vote open/);
    });

    test('a vote for an earlier proposal is refused', () => {
        const state = propose(makeState(), 'alice', 'passGoAmount', 300);
        refusedWith(() => act(state, 'bob', 'vote_rule_change', { approve: true, proposalId: 'rule-old' }), /already closed/);
    });

    test('a vote expires when its proposer\'s turn comes round', () => {
        // Proposed off-turn: expires as soon as Alice's turn starts.
        let state = propose(makeState({ current: 2 }), 'alice', 'passGoAmount', 300);
        const { state: expired, events } = run(state, 'carol', 'end_turn');
        expect(expired.ruleProposal).toBeNull();
        expect(events.map(e => e.type)).toContain('rule_change_expired');

        // Proposed on her own turn: it stays open for the rest of the round.
        state = propose(makeState({ current: 0 }), 'alice', 'passGoAmount', 300);
        state = endTurn(state);
        state = endTurn(state);
        expect(state.ruleProposal).not.toBeNull();
        state = endTurn(state);
        expect(state.ruleProposal).toBeNull();
    });

    test('after a change passes, the same rule waits a full round', () => {
        let state = propose(makeState({ current: 0 }), 'bob', 'passGoAmount', 300);
        state = vote(vote(state, 'alice', true), 'carol', true);
        refusedWith(() => propose(state, 'carol', 'passGoAmount', 400), /full round/);
        // Another rule is free.
        expect(propose(state, 'carol', 'loanRate', 6).ruleProposal.rule).toBe('loanRate');
        state = endTurn(endTurn(state));
        refusedWith(() => propose(state, 'carol', 'passGoAmount', 400), /full round/);
        state = endTurn(state);
        expect(propose(state, 'carol', 'passGoAmount', 400).ruleProposal.value).toBe(400);
    });

    test('a voter going bankrupt passes the vote if everyone left agreed', () => {
        const players = [player('alice', 'Alice'), player('bob', 'Bob'), player('carol', 'Carol', -10)];
        let state = propose(makeState({ players, current: 2 }), 'alice', 'passGoAmount', 300);
        state = vote(state, 'bob', true);
        const { state: after, events } = run(state, 'carol', 'end_turn');
        expect(byId(after, 'carol').bankrupt).toBe(true);
        expect(after.settings.passGoAmount).toBe(300);
        expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['bankruptcy', 'rule_change_passed']));
    });

    test('a proposer going bankrupt drops the vote', () => {
        const players = [player('alice', 'Alice'), player('bob', 'Bob'), player('carol', 'Carol', -10)];
        let state = propose(makeState({ players, current: 2 }), 'carol', 'passGoAmount', 300);
        state = act(state, 'carol', 'end_turn');
        expect(state.ruleProposal).toBeNull();
        expect(state.settings.passGoAmount).toBe(200);
    });

    test('a passed Pass GO amount, $0 included, is what passing GO pays', () => {
        for (const amount of [300, 0]) {
            let state = propose(makeState(), 'alice', 'passGoAmount', amount);
            state = vote(vote(state, 'bob', true), 'carol', true);
            state.players[0].diceRolled = false;
            state.players[0].position = 38;
            const cash = byId(state, 'alice').cash;
            state = run(state, 'alice', 'roll_dice', {}, { dice: [1, 2] }).state;
            expect(byId(state, 'alice').position).toBe(1);
            expect(byId(state, 'alice').cash).toBe(cash + amount);
        }
    });

    test('a new loan rate applies to new loans; loans already taken keep theirs', () => {
        let state = act(makeState(), 'alice', 'issue_debt', { amount: 100, termTurns: 10 });
        state = propose(state, 'bob', 'loanRate', 2.5);
        state = vote(vote(state, 'alice', true), 'carol', true);
        state = act(state, 'alice', 'issue_debt', { amount: 100, termTurns: 10 });
        expect(byId(state, 'alice').debts.map(d => d.interestRate)).toEqual([5, 2.5]);
    });

    test('a vote can be answered while an auction is open', () => {
        let state = propose(makeState({ current: 0 }), 'bob', 'passGoAmount', 300);
        state.auction = { status: 'open', propertyId: 'prop-1', propertyName: 'Baltic', currentBid: 0, startedById: 'alice', participantIds: ['alice', 'bob', 'carol'], passedPlayerIds: [], expiresAt: new Date(Date.now() + 60000).toISOString() };
        state = normalizeState(state);
        state = vote(state, 'alice', true);
        expect(state.ruleProposal.supporterIds).toContain('alice');
        refusedWith(() => propose(state, 'alice', 'loanRate', 6), /Resolve auction/);
    });

    test('an ended game closes the open vote', () => {
        let state = propose(makeState(), 'alice', 'passGoAmount', 300);
        state = run(state, 'alice', 'host_end_game', {}, { hostId: 'alice' }).state;
        expect(state.ruleProposal).toBeNull();
    });
});

describe('host house rules', () => {
    const members = [{ user_id: 'a', player_name: 'A' }, { user_id: 'b', player_name: 'B' }];

    test('the host sets Pass GO when the game starts; $200 by default', () => {
        expect(createInitialGame(members).settings.passGoAmount).toBe(200);
        expect(createInitialGame(members, { passGoAmount: '350' }).settings.passGoAmount).toBe(350);
        expect(createInitialGame(members, { passGoAmount: 0 }).settings.passGoAmount).toBe(0);
    });

    test('a Pass GO amount out of range or off the $50 step is refused', () => {
        refusedWith(() => createInitialGame(members, { passGoAmount: 1200 }), /Pass GO must be/);
        refusedWith(() => createInitialGame(members, { passGoAmount: 210 }), /Pass GO must be/);
    });

    test('a saved game keeps a Pass GO of $0', () => {
        expect(normalizeState({ ...createInitialGame(members), settings: { passGoAmount: 0, loanRate: 5 } }).settings.passGoAmount).toBe(0);
    });
});
