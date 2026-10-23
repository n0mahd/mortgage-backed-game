let lobbyRoomSubscriptions = [];
const ROOM_STATUS_LABELS = {
    waiting: 'Waiting',
    in_progress: 'In Progress',
    completed: 'Completed'
};

async function initLobby() {
    const user = await requireAuth();
    if (!user) return;

    document.getElementById('user-email').textContent = user.email;

    await loadUserRooms();
}

async function loadUserRooms() {
    try {
        const rooms = await getUserRooms();
        const roomsList = document.getElementById('active-rooms-list');

        if (rooms.length === 0) {
            roomsList.innerHTML = `
                <div class="loading">
                    <p>No games yet. Create one and share the room code with friends.</p>
                </div>
            `;
        } else {
            roomsList.innerHTML = rooms.map(renderRoomCard).join('');
        }

        lobbyRoomSubscriptions.forEach(sub => sub.unsubscribe());
        lobbyRoomSubscriptions = rooms.map(room =>
            subscribeToRoom(room.id, () => loadUserRooms(), null)
        );
    } catch (error) {
        console.error('Error loading rooms:', error);
        document.getElementById('active-rooms-list').innerHTML = `
            <div class="loading">
                <p class="turn-warning danger">Couldn't load your games. Check your connection and refresh.</p>
            </div>
        `;
    }
}

function showCreateRoomModal() {
    document.getElementById('createRoomModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');

    if (modalId === 'createRoomModal') {
        document.getElementById('room-name').value = '';
        document.getElementById('max-players').value = '4';
        document.getElementById('host-player-name').value = '';
        document.getElementById('host-spectate').checked = false;
        syncSpectateField();
    }
}

// A watching host takes no seat, so there is no player name to ask for.
function syncSpectateField() {
    const spectate = document.getElementById('host-spectate').checked;
    document.getElementById('host-player-name-group').hidden = spectate;
}

async function createRoom() {
    const roomName = document.getElementById('room-name').value.trim();
    const maxPlayers = Number(document.getElementById('max-players').value);
    const spectate = document.getElementById('host-spectate').checked;
    const playerName = spectate ? '' : document.getElementById('host-player-name').value.trim();

    if (!roomName || (!spectate && !playerName)) {
        alert('Please fill in all fields');
        return;
    }

    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
        alert('Max players must be between 2 and 8');
        return;
    }

    try {
        const room = await createNewRoom(roomName, maxPlayers, playerName, { spectate });
        closeModal('createRoomModal');

        const me = await getCurrentUser();
        if (me && me.email) {
            // Best effort: the room page shows the code anyway.
            sendRoomCode({ email: me.email, inviteCode: room.invite_code, roomName: room.name })
                .catch(err => console.warn('Room code email error:', err));
        }

        navigateToWaitingRoom(room.id);
    } catch (error) {
        console.error('Error creating room:', error);
        alert('Error creating game: ' + error.message);
    }
}

function renderRoomCard(room) {
    const memberCount = Array.isArray(room.room_members) ? room.room_members.length : 0;
    const maxPlayers = Number(room.max_players || 0);
    return `
        <div class="room-card" data-room-id="${escapeHtml(room.id)}">
            <div class="room-card-header">
                <div class="room-name">${escapeHtml(room.name)}</div>
                <div class="room-status ${roomStatusClass(room.status)}">${escapeHtml(formatStatus(room.status))}</div>
            </div>
            <div class="room-info">
                <span class="room-invite-code">${escapeHtml(room.invite_code)}</span>
                <span>${memberCount} of ${maxPlayers} players</span>
                <span>Created ${formatTimeAgo(room.created_at)}</span>
            </div>
        </div>
    `;
}

function formatStatus(status) {
    return ROOM_STATUS_LABELS[status] || status;
}

function roomStatusClass(status) {
    return ROOM_STATUS_LABELS[status] ? status : 'waiting';
}

window.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('show-create-room-btn')?.addEventListener('click', showCreateRoomModal);
    document.getElementById('create-room-btn')?.addEventListener('click', createRoom);
    document.getElementById('cancel-create-room-btn')?.addEventListener('click', () => closeModal('createRoomModal'));
    document.getElementById('host-spectate')?.addEventListener('change', syncSpectateField);

    document.getElementById('active-rooms-list')?.addEventListener('click', (event) => {
        const card = event.target.closest('.room-card[data-room-id]');
        if (card) navigateToWaitingRoom(card.dataset.roomId);
    });

    ['room-name', 'max-players', 'host-player-name'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') createRoom();
            });
        }
    });

    initLobby();
});
