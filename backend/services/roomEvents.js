'use strict';

// In-process "something changed in this room" signal. Fired after the same
// commits that produce Socket.IO broadcasts (joins, game start, game actions)
// so long-polling callers such as MCP wait_for_turn wake immediately.
// Single-process only; callers must still poll as a fallback.

const { EventEmitter } = require('events');

const roomUpdates = new EventEmitter();
roomUpdates.setMaxListeners(0);

function notifyRoom(roomId) {
    roomUpdates.emit(roomId);
}

function onRoomUpdate(roomId, listener) {
    roomUpdates.on(roomId, listener);
    return () => roomUpdates.off(roomId, listener);
}

module.exports = { notifyRoom, onRoomUpdate };
