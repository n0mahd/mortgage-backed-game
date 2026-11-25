let currentRoom = null;
let currentUser = null;
let roomSubscription = null;
let isHost = false;
const ROOM_STATUS_LABELS = {
    waiting: 'Waiting for players',
    in_progress: 'Game in progress',
    completed: 'Game completed'
};

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const roomCode = urlParams.get('code'); // unauthenticated join path
const normalizedRoomCode = normalizeInviteCode(roomCode);

async function initWaitingRoom() {
    if (roomCode) {
        await showGuestJoinSection();
        return;
    }

    if (!roomId) {
        window.location.href = 'index.html';
        return;
    }

    const user = await requireAuth();
    if (!user) return;

    currentUser = user;

    await loadRoomDataById(roomId);
    subscribeToRoomUpdatesById(roomId);
    checkGameStatusById(roomId);
}

// A room code from someone already in the room (the host back from the home
// page, a player on their own device) goes straight in, not to the guest form.
// Saved hotseat players for this room keep their own resume choice.
async function openRoomIfAlreadyIn() {
    if (!getToken() || getHotseatResumeByCode(normalizedRoomCode)) return false;
    try {
        const [user, room] = await Promise.all([getCurrentUser(), getRoomByCode(normalizedRoomCode)]);
        if (!user || !room) return false;
        const isIn = room.host_id === user.id || room.room_members.some(member => member.user_id === user.id);
        if (!isIn) return false;
        clearHotseatSession();
        navigateToRoom(room);
        return true;
    } catch {
        return false;
    }
}

async function showGuestJoinSection() {
    if (await openRoomIfAlreadyIn()) return;
    document.getElementById('waiting-room-section').style.display = 'none';
    document.getElementById('guest-join-section').style.display = 'block';
    const leaveBtn = document.getElementById('leave-room-btn');
    if (leaveBtn) leaveBtn.style.display = 'none';

    const optionsEl = document.getElementById('hotseat-resume-options');
    const hasLocalHotseatResume = RoomResume.showSavedHotseat(optionsEl, normalizedRoomCode);
    let room = null;
    try {
        room = await getRoomByCode(normalizedRoomCode);
    } catch (err) {
        console.warn('Could not load the room:', err);
    }
    showGuestJoinHeading(room);
    if (hasLocalHotseatResume) {
        setGuestJoinFormVisible(false);
    } else {
        const hasExistingPlayerResume = !!room && RoomResume.showExistingMembers(optionsEl, normalizedRoomCode, room);
        setGuestJoinFormVisible(!hasExistingPlayerResume);
    }

    const nameInput = document.getElementById('guest-player-name');
    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') joinAsGuest();
        });
    }
}

// The room's name and host, so the player knows which game they're joining.
function showGuestJoinHeading(room) {
    if (!room) return;
    const host = (room.room_members || []).find(member => member.user_id === room.host_id);
    document.getElementById('guest-join-title').textContent = room.name || 'Join game';
    const subtitle = document.getElementById('guest-join-subtitle');
    subtitle.textContent = host && host.player_name ? `Hosted by ${host.player_name}` : '';
    subtitle.hidden = !subtitle.textContent;
}

// A full or started room shows only "Already in this game?", not the name form.
function setGuestJoinFormVisible(visible) {
    const card = document.getElementById('guest-join-card');
    if (card) card.hidden = !visible;
}

async function joinAsGuest() {
    const playerName = document.getElementById('guest-player-name').value.trim();
    const errorEl = document.getElementById('guest-join-error');
    const btn = document.getElementById('guest-join-btn');
    let createdAnonymousSession = false;

    if (!playerName) {
        errorEl.textContent = 'Enter your name.';
        return;
    }

    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Joining...';

    try {
        // Someone signed in with email joins as themselves, so the game stays tied to
        // their account. Everyone else gets a fresh guest session, as before.
        const existingUser = getToken() ? await getCurrentUser().catch(() => null) : null;
        if (existingUser && !existingUser.is_anonymous) {
            currentUser = existingUser;
        } else {
            const anonData = await createGuestUser();
            setToken(anonData.token);
            currentUser = anonData.user;
            createdAnonymousSession = true;
        }

        const room = await joinRoomByCode(normalizedRoomCode, playerName);
        currentRoom = room;

        document.getElementById('guest-join-section').style.display = 'none';
        document.getElementById('waiting-room-section').style.display = 'block';
        const leaveBtn = document.getElementById('leave-room-btn');
        if (leaveBtn) leaveBtn.style.display = '';

        history.replaceState(null, '', `waiting.html?room=${encodeURIComponent(room.id)}`);

        await loadRoomDataById(room.id);
        subscribeToRoomUpdatesById(room.id);
        checkGameStatusById(room.id);

    } catch (error) {
        if (createdAnonymousSession) {
            clearToken();
            currentUser = null;
        }
        if (isExpectedGuestJoinError(error)) {
            console.warn('Could not join room:', error.message || error);
        } else {
            console.error('Error joining room:', error);
        }
        errorEl.textContent = error.message || 'Could not join room. Check your code and try again.';
        btn.disabled = false;
        btn.textContent = 'Join Game';
    }
}

function isExpectedGuestJoinError(error) {
    return error && [400, 403, 404].includes(error.status);
}

async function loadRoomDataById(id) {
    try {
        renderRoom(await getRoomById(id));
    } catch (error) {
        console.error('Error loading room:', error);
        showPageLoadError(`Couldn't load this room: ${error.message}`);
    }
}

function renderRoom(room) {
    currentRoom = room;

    document.getElementById('room-name').textContent = room.name;
    document.getElementById('invite-code').textContent = room.invite_code;
    document.getElementById('player-count').textContent =
        `${room.room_members.length}/${room.max_players} players`;

    isHost = currentUser && room.host_id === currentUser.id;
    const me = currentUser && room.room_members.find(member => member.user_id === currentUser.id);
    document.getElementById('user-email').textContent = currentUser
        ? currentUser.username || currentUser.email || (me && me.player_name) || 'Guest'
        : '';
    renderWaitingStatus(room);
    document.querySelectorAll('[data-manage-room-link]').forEach(link => {
        link.href = `lobby.html?manage=${encodeURIComponent(room.id)}`;
    });

    // Host rights can move to another player (Manage players).
    document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
    if (isHost && room.status === 'waiting') AgentInvites.mount(room.id);
    // A host who only watches has no seat to leave.
    const watching = isHost && !room.room_members.some(member => member.user_id === currentUser.id);
    document.getElementById('spectator-help-text').hidden = !watching;

    updateRoomStatus(room.status, room.room_members.length, room.max_players);
    renderPlayers(room.room_members);
    updateStartButtonState(room.room_members.length);

    const leaveBtn = document.getElementById('leave-room-btn');
    if (leaveBtn) leaveBtn.style.display = watching ? 'none' : '';
}

// Socket events missed while the page was hidden or offline (a phone switching
// apps to paste an agent invite) are caught up by refetching the room and the
// agent invites: on every socket (re)join, and through watchForMissedUpdates
// (api.js) when the page is shown again, comes back online, and on a slow poll.
let roomResyncInFlight = null;

function resyncRoom() {
    if (!currentRoom || roomResyncInFlight) return roomResyncInFlight;
    roomResyncInFlight = (async () => {
        try {
            const room = await getRoomById(currentRoom.id);
            renderRoom(room);
            if (isHost) await AgentInvites.refresh();
            if (room.status === 'in_progress') navigateToGameRoom(room.id);
        } catch (error) {
            console.warn('Could not refresh the room:', error.message || error);
        } finally {
            roomResyncInFlight = null;
        }
    })();
    return roomResyncInFlight;
}

function subscribeToRoomUpdatesById(id) {
    RejoinPrompts.watch(id);
    roomSubscription = subscribeToRoom(
        id,
        async (room) => {
            renderRoom(room);
            if (isHost) AgentInvites.refresh();
        },
        async (room) => {
            updateRoomStatus(room.status, room.room_members ? room.room_members.length : undefined, room.max_players);
            if (room.status === 'in_progress') navigateToGameRoom(id);
        },
        resyncRoom
    );
    watchForMissedUpdates(resyncRoom);
    reloadOnSignInChange(() => currentUser && currentUser.id, resyncRoom);
}

function renderPlayers(members) {
    const container = document.getElementById('players-list');

    if (members.length === 0) {
        container.innerHTML = `<div class="loading"><p>No players yet</p></div>`;
        return;
    }

    container.innerHTML = members.map(member => `
        <div class="player-item">
            <div class="player-item-info">
                <strong>${escapeHtml(member.player_name)}</strong>
                ${member.user_id === currentRoom.host_id ?
                    '<span class="player-badge">Host</span>' : ''}
                ${member.is_agent ? '<span class="player-badge player-badge-agent">AI</span>' : ''}
                ${currentUser && member.user_id === currentUser.id ?
                    '<span class="player-badge badge-info">You</span>' : ''}
            </div>
        </div>
    `).join('');
}

function updateRoomStatus(status, playerCount, maxPlayers) {
    const statusEl = document.getElementById('room-status');

    if (status === 'waiting' && maxPlayers && playerCount >= maxPlayers) {
        statusEl.className = 'room-status room_full';
        statusEl.textContent = 'Room Full';
    } else {
        statusEl.className = `room-status ${status}`;
        statusEl.textContent = ROOM_STATUS_LABELS[status] || status;
    }
}

function updateStartButtonState(playerCount) {
    const startBtn = document.getElementById('start-game-btn');
    if (!isHost || !startBtn) return;

    if (playerCount < 2) {
        startBtn.disabled = true;
        startBtn.textContent = 'Need at least 2 players';
    } else {
        startBtn.disabled = false;
        startBtn.textContent = `Start Game (${playerCount} players)`;
    }
}

async function copyInviteCode(btn) {
    const code = document.getElementById('invite-code').textContent;
    const originalText = btn.textContent;
    if (!await copyText(code)) {
        alert('Code: ' + code + '\n\nPlease copy manually.');
        return;
    }
    btn.textContent = 'Copied';
    btn.classList.add('is-done');
    setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('is-done');
    }, 2000);
}

async function sendInviteEmail() {
    const emailInput = document.getElementById('invite-email');
    const email = emailInput.value.trim();
    const statusEl = document.getElementById('invite-status');

    if (!email || !currentRoom) return;

    statusEl.textContent = 'Sending…';
    statusEl.classList.remove('is-success', 'is-error');

    try {
        await sendRoomCode({ email, inviteCode: currentRoom.invite_code });
    } catch (err) {
        statusEl.textContent = err.message || 'Could not send the invite.';
        statusEl.classList.add('is-error');
        return;
    }

    statusEl.textContent = `Invite sent to ${email}.`;
    statusEl.classList.add('is-success');
    emailInput.value = '';
}

// The host's interest rate per turn for every loan; the server checks the range.
function readLoanRate() {
    return document.getElementById('loan-rate').value;
}

// The host's Pass GO amount; the server checks the range and the $50 step.
function readPassGoAmount() {
    return document.getElementById('pass-go-amount').value;
}

async function startGameFromLobby() {
    if (!isHost || !currentRoom || currentRoom.room_members.length < 2) return;

    const startBtn = document.getElementById('start-game-btn');
    const errorEl = document.getElementById('start-error');
    errorEl.textContent = '';
    try {
        startBtn.disabled = true;
        startBtn.textContent = 'Starting…';

        const activeRoomId = currentRoom.id;
        await startGame(activeRoomId, { loanRate: readLoanRate(), passGoAmount: readPassGoAmount() });
        navigateToGameRoom(activeRoomId);

    } catch (error) {
        console.error('Error starting game:', error);
        errorEl.textContent = error.message || "Couldn't start the game. Try again.";
        updateStartButtonState(currentRoom.room_members.length);
    }
}

async function leaveRoom() {
    const roomName = currentRoom && currentRoom.name ? currentRoom.name : 'this room';
    if (!confirm(`Leave ${roomName}? Your seat opens for someone else.`)) return;

    try {
        const activeRoomId = currentRoom ? currentRoom.id : roomId;

        if (currentUser && activeRoomId) {
            await apiFetch(`/rooms/${activeRoomId}/leave`, { method: 'DELETE' });
        }

        if (roomSubscription) {
            roomSubscription.unsubscribe();
        }

        window.location.href = 'index.html';

    } catch (error) {
        console.error('Error leaving room:', error);
        alert('Error leaving room: ' + error.message);
    }
}

async function checkGameStatusById(id) {
    try {
        const game = await getGameByRoomId(id);
        if (game && currentRoom && currentRoom.status === 'in_progress') {
            navigateToGameRoom(id);
        }
    } catch (error) {
        console.error('Error checking game status:', error);
    }
}

// Players who aren't the host see who starts the game.
function renderWaitingStatus(room) {
    const statusEl = document.getElementById('waiting-status');
    if (!statusEl) return;
    const host = room.room_members.find(member => member.user_id === room.host_id);
    const show = !isHost && room.status === 'waiting';
    statusEl.textContent = show ? `Waiting for ${host && host.player_name ? host.player_name : 'the host'} to start` : '';
    statusEl.hidden = !show;
}

window.addEventListener('beforeunload', () => {
    if (roomSubscription) {
        roomSubscription.unsubscribe();
    }
});

function bindWaitingRoomActions() {
    document.getElementById('leave-room-btn')?.addEventListener('click', leaveRoom);
    document.getElementById('guest-join-btn')?.addEventListener('click', joinAsGuest);
    document.getElementById('copy-invite-code-btn')?.addEventListener('click', event => copyInviteCode(event.currentTarget));
    document.getElementById('start-game-btn')?.addEventListener('click', startGameFromLobby);
    document.getElementById('send-invite-btn')?.addEventListener('click', sendInviteEmail);
}

// Native share sheet for the invite link, where the device supports it.
function setupShareInvite() {
    const button = document.getElementById('share-invite-btn');
    if (!button || !navigator.share) return;
    button.hidden = false;
    button.addEventListener('click', async () => {
        if (!currentRoom) return;
        const url = new URL(`waiting.html?code=${encodeURIComponent(currentRoom.invite_code)}`, window.location.href).href;
        try {
            await navigator.share({
                title: currentRoom.name || 'Mortgage Backed Monopoly',
                text: `Join my Mortgage Backed Monopoly game. Room code ${currentRoom.invite_code}.`,
                url,
            });
        } catch (error) {
            if (error && error.name !== 'AbortError') console.warn('Share failed:', error);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindWaitingRoomActions();
    setupShareInvite();
    initWaitingRoom();
});
