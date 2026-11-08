'use strict';

// House rules and the votes that change them mid-game.
//
// The host sets the house rules before the game starts (Pass GO, the loan rate).
// After that any active player can propose changing one of them. The change
// happens the moment every active (not bankrupt) player has agreed; a single
// rejection ends the vote. Only one proposal is open at a time. It expires when
// the proposer's turn comes round, and is dropped if the proposer goes bankrupt.
// After a change passes, that rule can't be proposed again for a full round;
// after a rejection, the proposer waits for their next turn to propose again.
//
// A new house rule is one more entry in RULES.

const { makeEvent, log, GameRuleError } = require('./util');
const loans = require('./loans');

const RULES = {
    passGoAmount: {
        label: 'Pass GO',
        unit: 'money',
        min: 0,
        max: 1000,
        step: 50,
        defaultValue: 200,
        read: state => Number(state.settings.passGoAmount),
        write: (state, value) => { state.settings.passGoAmount = value; },
    },
    loanRate: {
        label: 'Loan interest rate',
        unit: 'percent',
        min: 0,
        max: loans.MAX_LOAN_RATE,
        step: 0.5,
        defaultValue: loans.DEFAULT_LOAN_RATE,
        // Existing loans keep the rate stored on each loan; this one applies to
        // new loans and refinancing.
        read: state => Number(state.settings.loanRate),
        write: (state, value) => { state.settings.loanRate = value; },
    },
};

const RULE_KEYS = Object.freeze(Object.keys(RULES));
const RULE_HISTORY_LIMIT = 20;

function formatRuleValue(rule, value) {
    const number = Number(value);
    if (RULES[rule]?.unit === 'percent') return `${number}% per turn`;
    return `$${number.toLocaleString('en-US')}`;
}

function isOnStep(value, step) {
    const steps = value / step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
}

// Returns { value } or { error } for a value of one rule.
function validateRuleValue(rule, raw) {
    const spec = RULES[rule];
    if (!spec) return { error: `Choose a rule to change: ${RULE_KEYS.join(' or ')}.` };
    const value = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    const range = spec.unit === 'percent'
        ? `${spec.min}% to ${spec.max}%, in steps of ${spec.step}%`
        : `$${spec.min} to $${spec.max.toLocaleString('en-US')}, in steps of $${spec.step}`;
    if (!Number.isFinite(value) || value < spec.min || value > spec.max || !isOnStep(value, spec.step)) {
        return { error: `${spec.label} must be ${range}.` };
    }
    return { value: Math.round(value * 100) / 100 };
}

// The host's Pass GO amount when the game starts (default $200).
function validatePassGoAmount(raw) {
    if (raw === undefined || raw === null || raw === '') return { amount: RULES.passGoAmount.defaultValue };
    const { value, error } = validateRuleValue('passGoAmount', raw);
    return error ? { error } : { amount: value };
}

function activePlayers(state) {
    return state.players.filter(player => !player.bankrupt);
}

function normalizeRuleProposal(proposal) {
    if (!proposal || !RULES[proposal.rule]) return null;
    const { value, error } = validateRuleValue(proposal.rule, proposal.value);
    if (error) return null;
    return {
        id: proposal.id || `rule-${Date.now()}`,
        rule: proposal.rule,
        value,
        previousValue: Number(proposal.previousValue),
        proposedById: proposal.proposedById || null,
        proposedByName: proposal.proposedByName || null,
        supporterIds: Array.isArray(proposal.supporterIds) ? [...new Set(proposal.supporterIds.filter(Boolean))] : [],
        createdAt: proposal.createdAt || new Date().toISOString(),
    };
}

// Locks: { rule } blocks proposing that rule, { userId } blocks that player
// proposing anything; each lasts until untilTurnOf's turn starts.
function normalizeRuleLocks(locks) {
    if (!Array.isArray(locks)) return [];
    return locks.filter(lock => lock && lock.untilTurnOf && (RULES[lock.rule] || lock.userId));
}

function normalizeRuleChanges(changes) {
    if (!Array.isArray(changes)) return [];
    return changes.filter(change => change && RULES[change.rule]).slice(-RULE_HISTORY_LIMIT);
}

function ruleLockFor(state, player, rule) {
    return state.ruleLocks.find(lock => lock.userId === player.userId)
        || state.ruleLocks.find(lock => lock.rule === rule)
        || null;
}

function proposeRuleChange(state, player, payload, events) {
    if (state.ruleProposal) throw new GameRuleError(400, 'A rule vote is already open. It has to finish first.');
    const rule = payload.rule;
    const { value, error } = validateRuleValue(rule, payload.value);
    if (error) throw new GameRuleError(400, error);
    const spec = RULES[rule];
    const current = spec.read(state);
    if (value === current) throw new GameRuleError(400, `${spec.label} is already ${formatRuleValue(rule, value)}.`);
    const lock = ruleLockFor(state, player, rule);
    if (lock?.userId) throw new GameRuleError(400, 'Your last proposal was rejected. You can propose again from your next turn.');
    if (lock) throw new GameRuleError(400, `${spec.label} was just changed by vote. It can be proposed again after a full round.`);

    state.ruleProposal = {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        rule,
        value,
        previousValue: current,
        proposedById: player.userId,
        proposedByName: player.name,
        supporterIds: [player.userId],
        createdAt: new Date().toISOString(),
    };
    events.push(makeEvent(player, 'rule_change_proposed', {
        actor: player.name, rule, label: spec.label, from: current, to: value,
    }));
    log(state, `${player.name} proposed changing ${spec.label} from ${formatRuleValue(rule, current)} to ${formatRuleValue(rule, value)}. It changes if every player agrees.`);
    settleRuleProposal(state, events);
}

function requireOpenProposal(state) {
    if (!state.ruleProposal) throw new GameRuleError(404, 'There is no rule vote open');
    return state.ruleProposal;
}

function voteRuleChange(state, player, payload, events) {
    const proposal = requireOpenProposal(state);
    if (payload.proposalId && payload.proposalId !== proposal.id) throw new GameRuleError(409, 'That rule vote has already closed');
    if (typeof payload.approve !== 'boolean') throw new GameRuleError(400, 'Vote with approve: true or false');
    const spec = RULES[proposal.rule];
    const what = `${spec.label} → ${formatRuleValue(proposal.rule, proposal.value)}`;
    if (!payload.approve) {
        if (proposal.proposedById === player.userId) throw new GameRuleError(400, 'Withdraw your own proposal instead of rejecting it');
        closeProposal(state, proposal);
        state.ruleLocks.push({ userId: proposal.proposedById, untilTurnOf: proposal.proposedById });
        events.push(makeEvent(player, 'rule_change_rejected', {
            actor: player.name, proposer: proposal.proposedByName, rule: proposal.rule, label: spec.label, from: proposal.previousValue, to: proposal.value,
        }));
        log(state, `${player.name} rejected ${proposal.proposedByName}'s rule change (${what}). ${spec.label} stays ${formatRuleValue(proposal.rule, proposal.previousValue)}.`);
        return;
    }
    if (proposal.supporterIds.includes(player.userId)) throw new GameRuleError(400, 'You have already agreed');
    proposal.supporterIds.push(player.userId);
    events.push(makeEvent(player, 'rule_change_supported', {
        actor: player.name, rule: proposal.rule, label: spec.label, to: proposal.value,
    }));
    settleRuleProposal(state, events);
}

function withdrawRuleChange(state, player, payload, events) {
    const proposal = requireOpenProposal(state);
    if (proposal.proposedById !== player.userId) throw new GameRuleError(403, 'Only the player who proposed it can withdraw it');
    const spec = RULES[proposal.rule];
    closeProposal(state, proposal);
    events.push(makeEvent(player, 'rule_change_withdrawn', { actor: player.name, rule: proposal.rule, label: spec.label, to: proposal.value }));
    log(state, `${player.name} withdrew their proposal to change ${spec.label}.`);
}

function closeProposal(state, proposal) {
    if (state.ruleProposal && state.ruleProposal.id === proposal.id) state.ruleProposal = null;
}

// Active players who still have to agree to the open proposal.
function ruleProposalHoldouts(state) {
    const proposal = state.ruleProposal;
    if (!proposal) return [];
    return activePlayers(state).filter(player => !proposal.supporterIds.includes(player.userId));
}

// Runs after every action: passes the open proposal once every active player
// has agreed (a voter may just have gone bankrupt), and drops it if its
// proposer is out of the game.
function settleRuleProposal(state, events) {
    const proposal = state.ruleProposal;
    if (!proposal) return;
    const spec = RULES[proposal.rule];
    const proposer = state.players.find(player => player.userId === proposal.proposedById);
    if (!proposer || proposer.bankrupt || state.ended) {
        closeProposal(state, proposal);
        if (proposer && !state.ended) {
            events.push(makeEvent(proposer, 'rule_change_withdrawn', { actor: proposer.name, rule: proposal.rule, label: spec.label, to: proposal.value, reason: 'bankrupt' }));
            log(state, `${proposer.name}'s proposal to change ${spec.label} was dropped: they are bankrupt.`);
        }
        return;
    }
    if (ruleProposalHoldouts(state).length > 0) return;

    spec.write(state, proposal.value);
    closeProposal(state, proposal);
    const current = state.players[state.currentPlayerIndex];
    if (current) state.ruleLocks.push({ rule: proposal.rule, untilTurnOf: current.userId });
    state.ruleChanges.push({
        rule: proposal.rule,
        from: proposal.previousValue,
        to: proposal.value,
        proposedById: proposal.proposedById,
        proposedByName: proposal.proposedByName,
        passedAt: new Date().toISOString(),
    });
    state.ruleChanges = state.ruleChanges.slice(-RULE_HISTORY_LIMIT);
    events.push(makeEvent(proposer, 'rule_change_passed', {
        proposer: proposal.proposedByName, rule: proposal.rule, label: spec.label, from: proposal.previousValue, to: proposal.value,
    }));
    const note = proposal.rule === 'loanRate' ? ' Loans already taken keep their rate.' : '';
    log(state, `Rule changed by unanimous vote: ${spec.label} is now ${formatRuleValue(proposal.rule, proposal.value)} (was ${formatRuleValue(proposal.rule, proposal.previousValue)}).${note}`);
}

// Called by End Turn once the next player is chosen. The open proposal expires
// when it is the proposer's turn again; a lock runs out when its player's turn
// starts. A rule lock names whoever's turn it was when the rule passed, so it
// lasts a full round.
function startTurnForRules(state, nextPlayer, events) {
    // A bankruptcy at this End Turn may have completed the vote before it expires.
    settleRuleProposal(state, events);
    const proposal = state.ruleProposal;
    if (proposal && proposal.proposedById === nextPlayer.userId) {
        const spec = RULES[proposal.rule];
        closeProposal(state, proposal);
        events.push(makeEvent(nextPlayer, 'rule_change_expired', { proposer: proposal.proposedByName, rule: proposal.rule, label: spec.label, to: proposal.value }));
        log(state, `The vote to change ${spec.label} to ${formatRuleValue(proposal.rule, proposal.value)} expired: not everyone answered before ${proposal.proposedByName}'s turn came round.`);
    }
    const isOut = userId => !state.players.some(player => player.userId === userId && !player.bankrupt);
    state.ruleLocks = state.ruleLocks.filter(lock => lock.untilTurnOf !== nextPlayer.userId && !isOut(lock.untilTurnOf));
}

// The house rules as players see them: current value, limits, and whether a
// vote changed them.
function houseRules(state) {
    return RULE_KEYS.map(rule => {
        const spec = RULES[rule];
        const lastChange = [...state.ruleChanges].reverse().find(change => change.rule === rule) || null;
        return {
            rule,
            label: spec.label,
            unit: spec.unit,
            value: spec.read(state),
            min: spec.min,
            max: spec.max,
            step: spec.step,
            changedByVote: !!lastChange,
            locked: state.ruleLocks.some(lock => lock.rule === rule),
        };
    });
}

module.exports = {
    RULES,
    RULE_KEYS,
    validateRuleValue,
    validatePassGoAmount,
    normalizeRuleProposal,
    normalizeRuleLocks,
    normalizeRuleChanges,
    proposeRuleChange,
    voteRuleChange,
    withdrawRuleChange,
    ruleProposalHoldouts,
    settleRuleProposal,
    startTurnForRules,
    houseRules,
    formatRuleValue,
};
