'use strict';

// Telling everyone in a room that something changed, two ways:
// - emitToRoom: a Socket.IO event to the browsers in the room's channel.
// - notifyRoom: an in-process signal that wakes long-polling callers such as
//   MCP wait_for_turn. Single-process only; callers still poll as a fallback.
// server.js hands over the Socket.IO server with setSocketServer at startup.

const { EventEmitter } = require('events');

let io = null;
const roomUpdates = new EventEmitter();
roomUpdates.setMaxListeners(0);

function setSocketServer(socketServer) {
    io = socketServer;
}

function emitToRoom(roomId, event, payload) {
    if (io) io.to(`room:${roomId}`).emit(event, payload);
}

function notifyRoom(roomId) {
    roomUpdates.emit(roomId);
}

function onRoomUpdate(roomId, listener) {
    roomUpdates.on(roomId, listener);
    return () => roomUpdates.off(roomId, listener);
}

module.exports = { setSocketServer, emitToRoom, notifyRoom, onRoomUpdate };
