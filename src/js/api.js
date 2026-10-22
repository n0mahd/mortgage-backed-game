// API + real-time helpers

window.API_BASE = window.API_BASE || '/api';

// ----------------------------------------------------------------
// API fetch helper — attaches auth token automatically
// ----------------------------------------------------------------
async function apiFetch(path, options = {}) {
    const token = localStorage.getItem('auth_token');
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
        try {
            const parsed = JSON.parse(text);
            message = parsed.error || message;
        } catch {}
        const err = new Error(message);
        err.status = res.status;
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
                connectedWith = localStorage.getItem('auth_token');
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
    if (localStorage.getItem('auth_token') === oldToken) localStorage.setItem('auth_token', newToken);

    try {
        const sessionTokens = JSON.parse(sessionStorage.getItem('hotseat_tokens') || 'null');
        if (Array.isArray(sessionTokens) && swapTokenInRecords(sessionTokens, oldToken, newToken)) {
            sessionStorage.setItem('hotseat_tokens', JSON.stringify(sessionTokens));
        }
    } catch {}

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
    const token = localStorage.getItem('auth_token');
    if (!token) {
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

    localStorage.removeItem('auth_token');
    window.location.href = 'index.html';
    return null;
}

function showPageLoadError(message) {
    const container = document.querySelector('.container') || document.body;
    const notice = document.createElement('div');
    notice.className = 'turn-warning danger';
    notice.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = message;
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary btn-sm';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => window.location.reload());
    notice.append(text, retry);
    container.prepend(notice);
}

// Returns null only when the server rejects the saved token. Network trouble
// is retried and then thrown, so a refresh on a flaky connection never signs
// a player out (guest players cannot sign back in).
async function getCurrentUser() {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
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

async function handleLogout() {
    try {
        await apiFetch('/auth/signout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('auth_token');
    window.location.href = 'index.html';
}

// ----------------------------------------------------------------
// Room helpers
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

function restoreHotseatResume(resume) {
    sessionStorage.setItem('hotseat_tokens', JSON.stringify(resume.tokens));
    localStorage.setItem('auth_token', resume.tokens[0].token);
    return true;
}

function restoreHotseatPlayer(resume, userId) {
    const player = resume.tokens.find(record => record.userId === userId);
    if (!player || !player.token) return false;

    sessionStorage.removeItem('hotseat_tokens');
    localStorage.setItem('auth_token', player.token);
    return true;
}

function continueSavedHotseat(inviteCode, restore) {
    const resume = getHotseatResumeByCode(inviteCode);
    if (!resume || !restore(resume)) return false;

    navigateToGameRoom(resume.roomId);
    return true;
}

function renderHotseatResumeOptions(container, inviteCode) {
    if (!container) return false;

    const resume = getHotseatResumeByCode(inviteCode);
    if (!resume) {
        container.innerHTML = '';
        container.style.display = 'none';
        return false;
    }

    renderResumeOptions(container, {
        title: 'Continue this saved hotseat game',
        hint: 'Use local hotseat on this device, or continue online as one player.',
        onHotseat: () => continueSavedHotseat(inviteCode, restoreHotseatResume),
        players: resume.tokens.map(record => ({
            label: record.name || 'Player',
            onClick: () => continueSavedHotseat(inviteCode, saved => restoreHotseatPlayer(saved, record.userId)),
        })),
    });
    return true;
}

function renderExistingRoomMemberOptions(container, inviteCode, room) {
    if (!container || !room || !Array.isArray(room.room_members)) return false;

    const roomIsClosedToNewMembers = room.status !== 'waiting' || room.room_members.length >= room.max_players;
    if (!roomIsClosedToNewMembers) return false;

    const showOptions = () => renderResumeOptions(container, {
        title: 'Continue as an existing player',
        hint: 'This room is already full. Pick who you are; a player in the game approves it on their screen.',
        onHotseat: () => requestRoomRejoin(container, inviteCode, room, null, showOptions),
        players: room.room_members.map(member => ({
            label: member.player_name || 'Player',
            onClick: () => requestRoomRejoin(container, inviteCode, room, member, showOptions),
        })),
    });
    showOptions();
    return true;
}

function renderResumeOptions(container, { title, hint, onHotseat, players }) {
    container.innerHTML = '';
    container.style.display = 'block';

    const titleEl = document.createElement('h4');
    titleEl.textContent = title;
    container.appendChild(titleEl);

    const hintEl = document.createElement('p');
    hintEl.className = 'hotseat-resume-hint';
    hintEl.textContent = hint;
    container.appendChild(hintEl);

    const hotseatButton = document.createElement('button');
    hotseatButton.type = 'button';
    hotseatButton.className = 'btn btn-primary hotseat-resume-main';
    hotseatButton.textContent = 'Continue Hotseat';
    hotseatButton.addEventListener('click', onHotseat);
    container.appendChild(hotseatButton);

    const playerList = document.createElement('div');
    playerList.className = 'hotseat-player-options';

    const playerLabel = document.createElement('p');
    playerLabel.className = 'hotseat-resume-hint';
    playerLabel.textContent = 'Continue online as:';
    playerList.appendChild(playerLabel);

    players.forEach(player => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm hotseat-player-option';
        button.textContent = player.label;
        button.addEventListener('click', player.onClick);
        playerList.appendChild(button);
    });

    container.appendChild(playerList);
}

function clearHotseatResume(inviteCode) {
    const code = normalizeInviteCode(inviteCode);
    if (!code) return;

    const rooms = getHotseatResumeRooms();
    delete rooms[code];
    localStorage.setItem(HOTSEAT_RESUME_STORAGE_KEY, JSON.stringify(rooms));
}

async function createNewRoom(roomName, maxPlayers, playerName) {
    return apiFetch('/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: roomName, max_players: maxPlayers, player_name: playerName })
    });
}

async function joinRoomByCode(inviteCode, playerName) {
    const code = normalizeInviteCode(inviteCode);
    const room = await apiFetch(`/rooms/by-code/${code}`);

    return apiFetch(`/rooms/${room.id}/join`, {
        method: 'POST',
        body: JSON.stringify({ player_name: playerName })
    });
}

// Getting back into a started room without a saved token: ask, then wait for
// a signed-in player to approve. The token only reaches this browser, which
// holds the request's secret.
const REJOIN_POLL_MS = 3000;

async function requestRoomRejoin(container, inviteCode, room, member, onBack) {
    const code = normalizeInviteCode(inviteCode);
    renderRejoinStatus(container, { title: 'Sending request…' });

    let request;
    try {
        request = await apiFetch(`/rooms/by-code/${code}/rejoin-requests`, {
            method: 'POST',
            body: JSON.stringify(member ? { member_id: member.id } : {})
        });
    } catch (error) {
        renderRejoinStatus(container, { title: 'Could not send the request', hint: error.message, actionLabel: 'Back', onAction: onBack });
        return;
    }

    let stopped = false;
    const stop = () => { stopped = true; };
    window.addEventListener('pagehide', stop, { once: true });

    renderRejoinStatus(container, {
        title: 'Waiting for approval',
        hint: rejoinApproverHint(room, member),
        waiting: true,
        actionLabel: 'Cancel',
        onAction: async () => {
            stop();
            try {
                await apiFetch(`/rooms/rejoin-requests/${request.request_id}/cancel`, {
                    method: 'POST',
                    body: JSON.stringify({ secret: request.secret })
                });
            } catch {}
            onBack();
        }
    });

    while (!stopped) {
        await new Promise(resolve => setTimeout(resolve, REJOIN_POLL_MS));
        if (stopped) return;
        let result;
        try {
            result = await apiFetch(`/rooms/rejoin-requests/${request.request_id}/collect`, {
                method: 'POST',
                body: JSON.stringify({ secret: request.secret })
            });
        } catch (error) {
            if (error.status === 404) result = { status: 'expired' };
            else continue; // network trouble: keep waiting
        }
        if (result.status === 'pending') continue;
        stop();
        if (result.status === 'approved') {
            finishRoomRejoin(result);
            return;
        }
        renderRejoinStatus(container, {
            title: result.status === 'denied' ? 'Request declined' : 'Request expired',
            hint: result.status === 'denied'
                ? 'A player in this game said no. Ask them, then try again.'
                : 'Nobody answered in time, or a newer request replaced this one.',
            actionLabel: 'Back',
            onAction: onBack
        });
        return;
    }
}

function rejoinApproverHint(room, member) {
    const members = room.room_members || [];
    const host = members.find(item => item.user_id === room.host_id);
    const hostName = host?.player_name || 'the host';
    if (!member) return `Ask ${hostName} (the host) to approve this on their screen.`;
    if (member.user_id === room.host_id) {
        return `Ask another player in this game to approve this on their screen. You will continue as ${member.player_name}.`;
    }
    return `Ask ${hostName} (the host) to approve this on their screen. You will continue as ${member.player_name}.`;
}

function finishRoomRejoin(result) {
    if (Array.isArray(result.tokens)) {
        if (result.tokens.length === 0) throw new Error('No players found for hotseat resume');
        sessionStorage.setItem('hotseat_tokens', JSON.stringify(result.tokens));
        localStorage.setItem('auth_token', result.tokens[0].token);
        saveHotseatResume(result.room, result.tokens);
    } else {
        localStorage.setItem('auth_token', result.token);
        sessionStorage.removeItem('hotseat_tokens');
    }
    navigateToRoom(result.room);
}

function renderRejoinStatus(container, { title, hint, waiting, actionLabel, onAction }) {
    container.innerHTML = '';
    container.style.display = 'block';

    const titleEl = document.createElement('h4');
    titleEl.textContent = title;
    container.appendChild(titleEl);

    if (hint) {
        const hintEl = document.createElement('p');
        hintEl.className = 'hotseat-resume-hint';
        hintEl.textContent = hint;
        container.appendChild(hintEl);
    }
    if (waiting) {
        const status = document.createElement('p');
        status.className = 'hotseat-resume-hint rejoin-waiting';
        status.setAttribute('role', 'status');
        status.textContent = 'Keep this page open. It continues as soon as they approve.';
        container.appendChild(status);
    }
    if (actionLabel) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm';
        button.textContent = actionLabel;
        button.addEventListener('click', onAction);
        container.appendChild(button);
    }
}

function navigateToGameRoom(roomId) {
    window.location.href = `game.html?room=${encodeURIComponent(roomId)}`;
}

function navigateToRoom(room) {
    if (room.status === 'in_progress') {
        navigateToGameRoom(room.id);
        return;
    }
    window.location.href = `waiting.html?room=${encodeURIComponent(room.id)}`;
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

async function startGame(roomId) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not authenticated');

    const room = await getRoomById(roomId);
    if (room.host_id !== user.id) throw new Error('Only the host can start the game');

    return apiFetch('/games', {
        method: 'POST',
        body: JSON.stringify({ room_id: roomId })
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

// Send room-code email via backend (best-effort)
async function callSendRoomCode(payload) {
    try {
        await apiFetch('/rooms/send-code', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.warn('Room code email error:', err);
    }
}

async function sendForgotRoomCodes(email) {
    return apiFetch('/rooms/send-code', {
        method: 'POST',
        body: JSON.stringify({ action: 'forgot_code', email })
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
    localStorage.setItem('auth_token', data.token);
    sessionStorage.removeItem('hotseat_tokens');
    return data;
}

// ----------------------------------------------------------------
// Shared utilities
// ----------------------------------------------------------------

// Safe for HTML text and quoted attribute values alike.
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(text) {
    return escapeHtml(text);
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

refreshSavedTokens();
