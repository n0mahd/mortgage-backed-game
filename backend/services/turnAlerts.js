'use strict';

// Decides when a game update deserves a "your turn" push and sends it.
// Game rules stay in the domain; this only compares whose turn it was.

const db = require('../db');
const { sendToUser } = require('./push');

function currentPlayerOf(gameRow) {
    if (!gameRow) return null;
    try {
        const state = JSON.parse(gameRow.game_state);
        if (state.ended || state.paused) return null;
        return state.players?.[state.currentPlayerIndex] || null;
    } catch {
        return null;
    }
}

// previousGame is null when the game has just started.
function notifyTurnChange(previousGame, updatedGame, actorUserId) {
    const next = currentPlayerOf(updatedGame);
    if (!next || next.bankrupt || next.userId === actorUserId) return;
    const previous = previousGame ? currentPlayerOf(previousGame) : null;
    if (previous && previous.userId === next.userId) return;

    const room = db.prepare(`SELECT name FROM rooms WHERE id = ?`).get(updatedGame.room_id);
    const roomName = String(room?.name || 'your game').slice(0, 60);
    sendToUser(next.userId, {
        title: 'Your turn',
        body: `It's your turn in ${roomName}.`,
        url: `/game.html?room=${encodeURIComponent(updatedGame.room_id)}`,
        tag: `turn-${updatedGame.id}`,
        topic: `turn-${String(updatedGame.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 26)}`,
    }).catch(err => console.error('Turn alert failed:', err.message));
}

module.exports = { notifyTurnChange };
