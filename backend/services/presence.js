'use strict';

// Which players have the game on screen right now. Each game page reports its
// visibility over its socket; a player counts as present while any of their
// sockets is connected and visible. Turn alerts skip present players, because
// the open page already buzzes and shows the turn. In-memory only.

const visibleSockets = new Map(); // userId -> Set(socketId)

function setVisible(userId, socketId, visible) {
    if (!userId) return;
    const sockets = visibleSockets.get(userId) || new Set();
    if (visible) sockets.add(socketId); else sockets.delete(socketId);
    if (sockets.size) visibleSockets.set(userId, sockets); else visibleSockets.delete(userId);
}

function forgetSocket(userId, socketId) {
    setVisible(userId, socketId, false);
}

function isPresent(userId) {
    return visibleSockets.has(userId);
}

module.exports = { setVisible, forgetSocket, isPresent };
