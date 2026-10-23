// Network and session helpers shared by every page: apiFetch, tokens, rooms,
// Socket.IO. DOM helpers live in ui.js.

window.API_BASE = window.API_BASE || '/api';

// ----------------------------------------------------------------
// Session storage: the one place that knows where tokens live.
// localStorage 'auth_token' is the active player's token; sessionStorage
// 'hotseat_tokens' lists every player of a same-device (hotseat) game as
// [{ userId, token, name }]. Tests read these keys directly.
// ----------------------------------------------------------------

function getToken() {
    return localStorage.getItem('auth_token');
}

function setToken(token) {
    localStorage.setItem('auth_token', token);
}

function clearToken() {
    localStorage.removeItem('auth_token');
}

function getHotseatSession() {
    try {
        const records = JSON.parse(sessionStorage.getItem('hotseat_tokens') || 'null');
        return Array.isArray(records) ? records : null;
    } catch {
        return null;
    }
}

// Saves the hotseat players and makes the first one active.
function setHotseatSession(records) {
    sessionStorage.setItem('hotseat_tokens', JSON.stringify(records));
    setToken(records[0].token);
}

function clearHotseatSession() {
    sessionStorage.removeItem('hotseat_tokens');
}

// ----------------------------------------------------------------
// API fetch helper — attaches auth token automatically
// ----------------------------------------------------------------
async function apiFetch(path, options = {}) {
    const token = getToken();
    const res = await fetch(window.API_BASE + path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers
        }
    });
    const refreshedToken = res.headers.get('X-Refreshed-Token');
    if (token && refreshedToken) replaceStoredToken(token, refreshedToken);
    if (!res.ok) {
        const text = await res.text();
        let message = text || `HTTP ${res.status}`;
        let code = null;
        try {
            const parsed = JSON.parse(text);
            message = parsed.error || message;
            code = parsed.code || null;
        } catch {}
        const err = new Error(message);
        err.status = res.status;
        err.code = code;
        err.responseText = text;
        throw err;
    }
    return res.json();
}

// ----------------------------------------------------------------
// Socket.io connection (lazy — initialised once per page)
// ----------------------------------------------------------------
let _socket = null;

function getSocket() {
    if (!_socket) {
        // Read the token on every (re)connect, so a swapped token is used.
        let connectedWith = null;
        _socket = io({
            auth: (cb) => {
                connectedWith = getToken();
                cb(connectedWith ? { token: connectedWith } : {});
            }
        });
        _socket.on('auth:token_refreshed', (fresh) => {
            if (connectedWith && fresh) replaceStoredToken(connectedWith, fresh);
        });
    }
    return _socket;
}

// ----------------------------------------------------------------
// Token swap while JWT_SECRET is being rotated: the server answers an
// old-secret token with a replacement, which takes its place everywhere the
// browser keeps tokens (the active one and saved same-device players).
// ----------------------------------------------------------------

function replaceStoredToken(oldToken, newToken) {
    if (!oldToken || !newToken || oldToken === newToken) return;
    if (getToken() === oldToken) setToken(newToken);

    const sessionTokens = getHotseatSession();
    if (sessionTokens && swapTokenInRecords(sessionTokens, oldToken, newToken)) {
        sessionStorage.setItem('hotseat_tokens', JSON.stringify(sessionTokens));
    }

    const rooms = getHotseatResumeRooms();
    let changed = false;
    Object.values(rooms).forEach(room => {
        if (Array.isArray(room.tokens) && swapTokenInRecords(room.tokens, oldToken, newToken)) changed = true;
    });
    if (changed) localStorage.setItem(HOTSEAT_RESUME_STORAGE_KEY, JSON.stringify(rooms));
}

function swapTokenInRecords(records, oldToken, newToken) {
    let changed = false;
    records.forEach(record => {
        if (record && record.token === oldToken) {
            record.token = newToken;
            changed = true;
        }
    });
    return changed;
}

// Saved same-device players may not be used for weeks, so swap their tokens
// once per browser session rather than waiting for each one to be used.
async function refreshSavedTokens() {
    const flag = 'saved_tokens_refreshed';
    if (sessionStorage.getItem(flag)) return;
    const saved = new Set();
    Object.values(getHotseatResumeRooms()).forEach(room => {
        (room.tokens || []).forEach(record => record && record.token && saved.add(record.token));
    });
    const tokens = [...saved];
    try {
        for (let i = 0; i < tokens.length; i += 12) {
            const batch = tokens.slice(i, i + 12);
            const data = await apiFetch('/auth/refresh-tokens', {
                method: 'POST',
                body: JSON.stringify({ tokens: batch })
            });
            batch.forEach((token, index) => {
                const fresh = data.tokens && data.tokens[index];
                if (fresh) replaceStoredToken(token, fresh);
            });
        }
        sessionStorage.setItem(flag, '1');
    } catch (error) {
        console.warn('Could not refresh saved players:', error.message || error);
    }
}

// ----------------------------------------------------------------
// Auth helpers
// ----------------------------------------------------------------

async function requireAuth() {
    if (!getToken()) {
        window.location.href = 'index.html';
        return null;
    }

    let user;
    try {
        user = await getCurrentUser();
    } catch (error) {
        showPageLoadError(error.message);
        return null;
    }
    if (user) return user;

    clearToken();
    window.location.href = 'index.html';
    return null;
}

// Returns null only when the server rejects the saved token. Network trouble
// is retried and then thrown, so a refresh on a flaky connection never signs
// a player out (guest players cannot sign back in).
async function getCurrentUser() {
    if (!getToken()) return null;
    const retryDelaysMs = [500, 1500, 3000];
    for (let attempt = 0; ; attempt++) {
        try {
            return await apiFetch('/auth/me');
        } catch (error) {
            if ([401, 403, 404].includes(error.status)) return null;
            if (attempt >= retryDelaysMs.length) {
                throw new Error("Couldn't reach the game server. Check your connection and refresh.");
            }
            await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
        }
    }
}

// A new guest (anonymous) user: returns { token, user }.
async function createGuestUser() {
    return apiFetch('/auth/anonymous', { method: 'POST' });
}

async function handleLogout() {
    try {
        await apiFetch('/auth/signout', { method: 'POST' });
    } catch {}
    clearToken();
    window.location.href = 'index.html';
}

// ----------------------------------------------------------------
// Saved hotseat games: every player's token per room code, so a local game
// can be resumed later (UI in room-resume.js).
// ----------------------------------------------------------------

const HOTSEAT_RESUME_STORAGE_KEY = 'mortgage_hotseat_resume_rooms';

function getHotseatResumeRooms() {
    try {
        return JSON.parse(localStorage.getItem(HOTSEAT_RESUME_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function normalizeInviteCode(inviteCode) {
    return String(inviteCode || '').trim().toUpperCase();
}

function saveHotseatResume(room, tokenRecords) {
    if (!room || !room.invite_code || !Array.isArray(tokenRecords) || tokenRecords.length === 0) return;

    const rooms = getHotseatResumeRooms();
    const code = normalizeInviteCode(room.invite_code);
    rooms[code] = {
        roomId: room.id,
        inviteCode: code,
        tokens: tokenRecords,
        savedAt: new Date().toISOString()
    };
    localStorage.setItem(HOTSEAT_RESUME_STORAGE_KEY, JSON.stringify(rooms));
}

function getHotseatResumeByCode(inviteCode) {
    const code = normalizeInviteCode(inviteCode);
    if (!code) return null;

    const resume = getHotseatResumeRooms()[code];
    if (!resume || !resume.roomId || !Array.isArray(resume.tokens) || resume.tokens.length === 0) {
        return null;
    }
    return resume;
}

function clearHotseatResume(inviteCode) {
    const code = normalizeInviteCode(inviteCode);
    if (!code) return;

    const rooms = getHotseatResumeRooms();
    delete rooms[code];
    localStorage.setItem(HOTSEAT_RESUME_STORAGE_KEY, JSON.stringify(rooms));
}

// ----------------------------------------------------------------
// Rooms and games
// ----------------------------------------------------------------

async function createNewRoom(roomName, maxPlayers, playerName, { spectate = false } = {}) {
    return apiFetch('/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: roomName, max_players: maxPlayers, player_name: playerName, spectate })
    });
}

async function getRoomByCode(inviteCode) {
    return apiFetch(`/rooms/by-code/${normalizeInviteCode(inviteCode)}`);
}

async function joinRoom(roomId, playerName) {
    return apiFetch(`/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ player_name: playerName })
    });
}

async function joinRoomByCode(inviteCode, playerName) {
    const room = await getRoomByCode(inviteCode);
    return joinRoom(room.id, playerName);
}

function navigateToGameRoom(roomId) {
    window.location.href = `game.html?room=${encodeURIComponent(roomId)}`;
}

function navigateToWaitingRoom(roomId) {
    window.location.href = `waiting.html?room=${encodeURIComponent(roomId)}`;
}

function navigateToRoom(room) {
    if (room.status === 'in_progress') navigateToGameRoom(room.id);
    else navigateToWaitingRoom(room.id);
}

// After signing in on this device: open the game in progress, else one
// still waiting for players, else the lobby.
async function openActiveGame() {
    const rooms = await getUserRooms();
    const activeRoom = rooms.find(room => room.status === 'in_progress') || rooms.find(room => room.status === 'waiting');
    if (activeRoom) navigateToRoom(activeRoom);
    else window.location.href = 'lobby.html';
}

async function getUserRooms() {
    try {
        return await apiFetch('/rooms/mine');
    } catch {
        return [];
    }
}

async function getRoomById(roomId) {
    return apiFetch(`/rooms/${roomId}`);
}

// Host-only AI agent invites. createAgentInvite's response holds the agent key;
// it is never returned again.
// label is the agent's player name; empty lets the agent choose one.
async function createAgentInvite(roomId, label = '') {
    return apiFetch(`/rooms/${roomId}/agent-seats`, { method: 'POST', body: JSON.stringify(label ? { label } : {}) });
}

async function renameAgentInvite(roomId, seatId, label) {
    return apiFetch(`/rooms/${roomId}/agent-seats/${encodeURIComponent(seatId)}`, { method: 'PATCH', body: JSON.stringify({ label }) });
}

async function listAgentInvites(roomId) {
    return apiFetch(`/rooms/${roomId}/agent-seats`);
}

async function revokeAgentInvite(roomId, seatId) {
    return apiFetch(`/rooms/${roomId}/agent-seats/${encodeURIComponent(seatId)}`, { method: 'DELETE' });
}

// The server only lets the host start the game.
async function startGame(roomId, settings = {}) {
    return apiFetch('/games', {
        method: 'POST',
        body: JSON.stringify({ room_id: roomId, settings })
    });
}

async function getGameByRoomId(roomId) {
    try {
        return await apiFetch(`/games/by-room/${roomId}`);
    } catch (err) {
        if (err.status === 404) return null;
        throw err;
    }
}

// Emails a room code: { email, inviteCode, roomName } for one room, or
// { action: 'forgot_code', email } for every room that email created.
async function sendRoomCode(payload) {
    return apiFetch('/rooms/send-code', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

// ----------------------------------------------------------------
// Real-time subscriptions (Socket.io)
// ----------------------------------------------------------------

// Subscribe to room member + status changes
// Returns an object with an unsubscribe() method
function subscribeToRoom(roomId, onMemberChange, onStatusChange) {
    const socket = getSocket();
    socket.emit('join_room', roomId);

    function memberHandler(room) { if (onMemberChange) onMemberChange(room); }
    function statusHandler(room) { if (onStatusChange) onStatusChange(room); }

    socket.on('room:member_change', memberHandler);
    socket.on('room:status_change', statusHandler);

    return {
        unsubscribe() {
            socket.off('room:member_change', memberHandler);
            socket.off('room:status_change', statusHandler);
            socket.emit('leave_room', roomId);
        }
    };
}

// Subscribe to game state updates. onJoined runs each time the socket has
// (re)joined the room, so the page can fetch any updates it missed before
// joining or while offline.
function subscribeToGame(roomId, onGameUpdate, onJoined) {
    const socket = getSocket();
    const join = () => socket.emit('join_room', roomId, (reply) => {
        if (reply && reply.ok && onJoined) onJoined();
    });
    join();

    function gameHandler(game) { if (onGameUpdate) onGameUpdate(game); }
    // Joining twice on the first connect is harmless; resyncs are coalesced.
    const reconnectHandler = join;
    socket.on('connect', reconnectHandler);
    socket.on('game:state_update', gameHandler);

    return {
        isConnected() {
            return socket.connected;
        },
        unsubscribe() {
            socket.off('connect', reconnectHandler);
            socket.off('game:state_update', gameHandler);
            socket.emit('leave_room', roomId);
        }
    };
}

// ----------------------------------------------------------------
// Moving a signed-in session to another browser or device
// ----------------------------------------------------------------

async function requestDeviceTransferCode() {
    return apiFetch('/auth/transfer-code', { method: 'POST' });
}

async function redeemDeviceTransferCode(code) {
    const data = await apiFetch('/auth/redeem-transfer', {
        method: 'POST',
        body: JSON.stringify({ code })
    });
    setToken(data.token);
    clearHotseatSession();
    return data;
}

// ----------------------------------------------------------------
// Accounts: username and password (documents/accounts-and-game-management.md).
// Each returns { token, user } and stores the token.
// ----------------------------------------------------------------

// Sent with the current guest token, if any, so the server upgrades that
// guest in place and every seat they hold stays theirs.
async function registerAccount(username, password) {
    const previous = getToken();
    const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    if (previous) replaceStoredToken(previous, data.token);
    setToken(data.token);
    return data;
}

// Signing in switches this browser to another user, so a same-device
// session for the old one no longer applies.
async function loginWithPassword(login, password) {
    const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login, password })
    });
    setToken(data.token);
    clearHotseatSession();
    return data;
}

// { password, username?, current_password? } -> { user }
async function setAccountPassword(fields) {
    return apiFetch('/auth/password', { method: 'POST', body: JSON.stringify(fields) });
}

// ----------------------------------------------------------------
// My games: archive (per user), host tools, seat links, host offers
// ----------------------------------------------------------------

async function archiveRoom(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/archive`, { method: 'POST' });
}

async function unarchiveRoom(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/archive`, { method: 'DELETE' });
}

// Host only: { room, members, agent_seats, host_transfer }.
async function getRoomManagement(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/manage`);
}

// Host only: { url, expires_at }. A new link replaces the seat's older ones.
async function createSeatLink(roomId, memberId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/link`, { method: 'POST' });
}

// Host only: revokes the agent's key and returns a new invite
// ({ seat, key, mcp_url, prompt }) for the same seat.
async function reissueAgentKey(roomId, seatId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/agent-seats/${encodeURIComponent(seatId)}/reissue`, { method: 'POST' });
}

async function offerHostTransfer(roomId, memberId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/host-transfer`, {
        method: 'POST',
        body: JSON.stringify({ member_id: memberId })
    });
}

async function cancelHostTransfer(roomId) {
    return apiFetch(`/rooms/${encodeURIComponent(roomId)}/host-transfer`, { method: 'DELETE' });
}

// No sign-in needed. Returns { token, user, room } for a guest seat,
// { room } when already signed in as the seat, or
// { requires_sign_in: true, room: { id, name } } for an account's seat.
async function redeemSeatLink(token) {
    return apiFetch('/seat-links/redeem', { method: 'POST', body: JSON.stringify({ token }) });
}

// Host offers made to the current user: [{ id, room_id, room_name, from_player_name, created_at }].
async function getMyHostOffers() {
    return apiFetch('/host-transfers/mine');
}

// Fails with status 403 and code 'account_required' for a guest.
async function acceptHostOffer(offerId) {
    return apiFetch(`/host-transfers/${encodeURIComponent(offerId)}/accept`, { method: 'POST' });
}

async function declineHostOffer(offerId) {
    return apiFetch(`/host-transfers/${encodeURIComponent(offerId)}/decline`, { method: 'POST' });
}

refreshSavedTokens();
