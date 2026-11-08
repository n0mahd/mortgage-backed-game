'use strict';

// Decides when a game update deserves a push and sends it: "your turn", and a
// new rule vote that needs your answer. Game rules stay in the domain; this
// only compares the state before and after an action.

const db = require('../db');
const { sendToUser } = require('./push');
const { isPresent } = require('./presence');

function parseState(gameRow) {
    if (!gameRow) return null;
    try {
        return JSON.parse(gameRow.game_state);
    } catch {
        return null;
    }
}

function currentPlayerOf(gameRow) {
    const state = parseState(gameRow);
    if (!state || state.ended || state.paused) return null;
    return state.players?.[state.currentPlayerIndex] || null;
}

function roomNameOf(gameRow) {
    const room = db.prepare(`SELECT name FROM rooms WHERE id = ?`).get(gameRow.room_id);
    return String(room?.name || 'your game').slice(0, 60);
}

// previousGame is null when the game has just started.
function notifyTurnChange(previousGame, updatedGame, actorUserId) {
    const next = currentPlayerOf(updatedGame);
    if (!next || next.bankrupt || next.userId === actorUserId) return;
    const previous = previousGame ? currentPlayerOf(previousGame) : null;
    if (previous && previous.userId === next.userId) return;
    // The game is on their screen: the page itself buzzes and shows the turn.
    if (isPresent(next.userId)) return;

    const roomName = roomNameOf(updatedGame);
    sendToUser(next.userId, {
        title: 'Your turn',
        body: `It's your turn in ${roomName}.`,
        url: `/game.html?room=${encodeURIComponent(updatedGame.room_id)}`,
        tag: `turn-${updatedGame.id}`,
        topic: `turn-${String(updatedGame.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 26)}`,
    }).catch(err => console.error('Turn alert failed:', err.message));
}

const RULE_LABELS = { passGoAmount: 'Pass GO', loanRate: 'the loan rate' };

function ruleValueText(rule, value) {
    return rule === 'loanRate' ? `${Number(value)}%` : `$${Number(value)}`;
}

// A rule vote that has just opened: alert every other active player who
// doesn't have the game on screen (the page shows them a Vote prompt).
function notifyRuleProposal(previousGame, updatedGame) {
    const state = parseState(updatedGame);
    const proposal = state?.ruleProposal;
    if (!proposal || state.ended) return;
    if (parseState(previousGame)?.ruleProposal?.id === proposal.id) return;
    const roomName = roomNameOf(updatedGame);
    const proposer = String(proposal.proposedByName || 'A player').slice(0, 40);
    (state.players || [])
        .filter(player => !player.bankrupt && !(proposal.supporterIds || []).includes(player.userId))
        .filter(player => !isPresent(player.userId))
        .forEach(player => {
            sendToUser(player.userId, {
                title: 'Rule vote',
                body: `${proposer} proposes changing ${RULE_LABELS[proposal.rule] || 'a rule'} to ${ruleValueText(proposal.rule, proposal.value)} in ${roomName}. Tap to vote.`,
                url: `/game.html?room=${encodeURIComponent(updatedGame.room_id)}`,
                tag: `rule-${updatedGame.id}`,
                topic: `rule-${String(updatedGame.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 26)}`,
            }).catch(err => console.error('Rule vote alert failed:', err.message));
        });
}

module.exports = { notifyTurnChange, notifyRuleProposal };
