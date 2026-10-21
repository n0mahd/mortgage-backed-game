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
        alert('No room ID provided');
        window.location.href = 'index.html';
        return;
    }

    const user = await requireAuth();
    if (!user) return;

    currentUser = user;
    const emailDisplay = document.getElementById('user-email');
    if (emailDisplay) {
        emailDisplay.textContent = currentUser.email || 'Guest';
    }

    await loadRoomDataById(roomId);
    subscribeToRoomUpdatesById(roomId);
    checkGameStatusById(roomId);
}

async function showGuestJoinSection() {
    document.getElementById('waiting-room-section').style.display = 'none';
    document.getElementById('guest-join-section').style.display = 'block';
    const leaveBtn = document.getElementById('leave-room-btn');
    if (leaveBtn) leaveBtn.style.display = 'none';

    const codeInput = document.getElementById('guest-room-code');
    if (codeInput) codeInput.value = normalizedRoomCode;

    const optionsEl = document.getElementById('hotseat-resume-options');
    const hasLocalHotseatResume = renderHotseatResumeOptions(optionsEl, normalizedRoomCode);
    if (!hasLocalHotseatResume) {
        try {
            const room = await getRoomByCode(normalizedRoomCode);
            const hasExistingPlayerResume = renderExistingRoomMemberOptions(optionsEl, normalizedRoomCode, room);
            setGuestJoinFormVisible(!hasExistingPlayerResume);
        } catch (err) {
            console.warn('Could not load room resume options:', err);
            setGuestJoinFormVisible(true);
        }
    } else {
        setGuestJoinFormVisible(false);
    }

    const nameInput = document.getElementById('guest-player-name');
    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') joinAsGuest();
        });
    }
}

function setGuestJoinFormVisible(visible) {
    const nameGroup = document.getElementById('guest-player-name')?.closest('.form-group');
    const joinBtn = document.getElementById('guest-join-btn');
    if (nameGroup) nameGroup.style.display = visible ? '' : 'none';
    if (joinBtn) joinBtn.style.display = visible ? '' : 'none';
}

async function joinAsGuest() {
    const playerName = document.getElementById('guest-player-name').value.trim();
    const errorEl = document.getElementById('guest-join-error');
    const btn = document.getElementById('guest-join-btn');
    let createdAnonymousSession = false;

    if (!playerName) {
        errorEl.textContent = 'Please enter your player name';
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

        const emailDisplay = document.getElementById('user-email');
        if (emailDisplay) emailDisplay.textContent = playerName;

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
        const room = await getRoomById(id);
        currentRoom = room;

        document.getElementById('room-name').textContent = room.name;
        document.getElementById('invite-code').textContent = room.invite_code;
        document.getElementById('player-count').textContent =
            `${room.room_members.length}/${room.max_players} players`;

        isHost = currentUser && room.host_id === currentUser.id;

        if (isHost) {
            document.getElementById('host-controls').style.display = 'block';
            if (room.status === 'waiting') AgentInvites.mount(room.id);
        }

        updateRoomStatus(room.status, room.room_members.length, room.max_players);
        renderPlayers(room.room_members);
        updateStartButtonState(room.room_members.length);

        const leaveBtn = document.getElementById('leave-room-btn');
        if (leaveBtn) leaveBtn.style.display = '';

    } catch (error) {
        console.error('Error loading room:', error);
        alert('Error loading room: ' + error.message);
        window.location.href = 'index.html';
    }
}

function subscribeToRoomUpdatesById(id) {
    RejoinPrompts.watch(id);
    roomSubscription = subscribeToRoom(
        id,
        async (room) => {
            currentRoom = room;
            renderPlayers(room.room_members);
            document.getElementById('player-count').textContent =
                `${room.room_members.length}/${room.max_players} players`;
            updateStartButtonState(room.room_members.length);
            if (isHost) AgentInvites.refresh();
            logActivity('Player list updated');
        },
        async (room) => {
            updateRoomStatus(room.status, room.room_members ? room.room_members.length : undefined, room.max_players);
            if (room.status === 'in_progress') {
                logActivity('Game is starting!');
                setTimeout(() => navigateToGameRoom(id), 1500);
            }
        }
    );
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
            <div class="player-item-meta">Joined ${formatTimeAgo(member.joined_at)}</div>
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

    const helpText = document.getElementById('start-help-text');

    if (playerCount < 2) {
        startBtn.disabled = true;
        startBtn.textContent = 'Need at least 2 players';
        if (helpText) helpText.style.display = '';
    } else {
        startBtn.disabled = false;
        startBtn.textContent = `Start Game (${playerCount} players)`;
        if (helpText) helpText.style.display = 'none';
    }
}

function copyInviteCode(btn) {
    const code = document.getElementById('invite-code').textContent;
    const originalText = btn.textContent;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            showCopySuccess(btn, originalText);
        }).catch(() => fallbackCopyToClipboard(code, btn, originalText));
    } else {
        fallbackCopyToClipboard(code, btn, originalText);
    }
}

function showCopySuccess(btn, originalText) {
    btn.textContent = 'Copied';
    btn.classList.add('is-done');
    setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('is-done');
    }, 2000);
}

function fallbackCopyToClipboard(text, btn, originalText) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showCopySuccess(btn, originalText);
        } else {
            alert('Code: ' + text + '\n\nPlease copy manually.');
        }
    } catch (err) {
        alert('Code: ' + text + '\n\nPlease copy manually.');
    } finally {
        document.body.removeChild(textarea);
    }
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

async function startGameFromLobby() {
    if (!isHost) {
        alert('Only the host can start the game');
        return;
    }

    if (!currentRoom || currentRoom.room_members.length < 2) {
        alert('Need at least 2 players to start');
        return;
    }

    try {
        const startBtn = document.getElementById('start-game-btn');
        startBtn.disabled = true;
        startBtn.textContent = 'Starting game...';

        const activeRoomId = currentRoom.id;
        await startGame(activeRoomId);

        logActivity('Game started! Redirecting...');

        setTimeout(() => navigateToGameRoom(activeRoomId), 1000);

    } catch (error) {
        console.error('Error starting game:', error);
        alert('Error starting game: ' + error.message);

        const startBtn = document.getElementById('start-game-btn');
        startBtn.disabled = false;
        startBtn.textContent = 'Start Game';
    }
}

async function leaveRoom() {
    if (!confirm('Are you sure you want to leave this room?')) return;

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

function logActivity(message) {
    const logContainer = document.getElementById('activity-log');
    const timestamp = new Date().toLocaleTimeString();

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${timestamp}] ${message}`;

    logContainer.insertBefore(entry, logContainer.firstChild);

    while (logContainer.children.length > 10) {
        logContainer.removeChild(logContainer.lastChild);
    }
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindWaitingRoomActions();
        initWaitingRoom();
    });
} else {
    bindWaitingRoomActions();
    initWaitingRoom();
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

document.addEventListener('DOMContentLoaded', setupShareInvite);
