// lobby.html, "My games": the signed-in user's rooms (Active and Archived,
// archive is per user), host offers made to them, the guest's invitation to
// create an account, and an email account's "Set password". The host's Manage
// sheet is src/js/manage-room.js; ?manage=<roomId> opens it on load.
// Everything here can change elsewhere (another device archives a game or
// makes one, a game starts or ends, a host offer, a player joins), so one
// coalesced resyncLobby refetches it all; see "Staying live" below.

const ROOM_STATUS_LABELS = {
    waiting: 'Waiting',
    in_progress: 'In Progress',
    completed: 'Completed'
};
const LOBBY_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;

let lobbyUser = null;
let lobbyRooms = [];
const lobbyRoomSubscriptions = new Map();
let lobbyReloadTimer = null;
let lobbyRoomsShown = null;
let lobbyOffersShown = null;
let lobbyResyncInFlight = null;
let lobbyResyncAgain = false;

async function initLobby() {
    const user = await requireAuth();
    if (!user) return;
    lobbyUser = user;
    renderAccount();

    // An offer made, cancelled or answered changes both lists.
    getSocket().on('room:host_transfer', scheduleRoomsReload);

    await Promise.all([loadUserRooms(), loadHostOffers()]);
    watchForMissedUpdates(resyncLobby);
    reloadOnSignInChange(() => lobbyUser && lobbyUser.id, scheduleRoomsReload);

    const manageRoomId = new URLSearchParams(window.location.search).get('manage');
    if (manageRoomId) openManageSheet(manageRoomId);
}

// ── Account ─────────────────────────────────────────────────────

function renderAccount() {
    const user = lobbyUser;
    const isGuest = !!user.is_anonymous;
    const name = user.username || user.email || '';
    // The guest banner says it; the app bar keeps its room for Sign in and Log out.
    document.getElementById('user-email').textContent = isGuest ? '' : name;
    document.getElementById('signin-link').hidden = !isGuest;
    document.getElementById('guest-banner').hidden = !isGuest;
    document.getElementById('account-summary').hidden = isGuest;
    document.getElementById('account-name').textContent = name;
    // Email accounts sign in with codes; a password lets them use a username too.
    document.getElementById('set-password-btn').hidden = isGuest || !!user.has_password;
}

// The account can change elsewhere too (a password set on another device, a
// guest upgraded in another tab).
async function refreshLobbyAccount() {
    try {
        const user = await getCurrentUser();
        if (user && user.id === lobbyUser.id) {
            lobbyUser = user;
            renderAccount();
        }
    } catch (error) {
        console.warn('Could not refresh the account:', error.message || error);
    }
}

function showSetPasswordModal() {
    document.getElementById('set-password-username').value = lobbyUser.username || '';
    document.getElementById('set-password-error').textContent = '';
    document.getElementById('setPasswordModal').classList.add('active');
    document.getElementById('set-password-new').focus();
}

async function saveAccountPassword(event) {
    event.preventDefault();
    const username = document.getElementById('set-password-username').value.trim();
    const password = document.getElementById('set-password-new').value;
    const confirmPassword = document.getElementById('set-password-confirm').value;
    const errorEl = document.getElementById('set-password-error');
    const button = document.getElementById('set-password-save-btn');
    errorEl.textContent = '';

    if (username && !LOBBY_USERNAME_PATTERN.test(username)) {
        errorEl.textContent = 'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.';
        return;
    }
    if (password.length < 8 || password.length > 200) {
        errorEl.textContent = 'Passwords are 8 to 200 characters.';
        return;
    }
    if (password !== confirmPassword) {
        errorEl.textContent = "The passwords don't match.";
        return;
    }

    const fields = { password };
    if (username && username !== lobbyUser.username) fields.username = username;
    button.disabled = true;
    try {
        const data = await setAccountPassword(fields);
        lobbyUser = data.user || { ...lobbyUser, has_password: true };
        renderAccount();
        closeModal('setPasswordModal');
        showToast('Password saved. You can sign in with it on any device.');
    } catch (error) {
        errorEl.textContent = error.message || 'Could not save your password. Please try again.';
    } finally {
        button.disabled = false;
    }
}

// ── Host offers made to me ──────────────────────────────────────

async function loadHostOffers() {
    const section = document.getElementById('host-offers-section');
    let offers;
    try {
        offers = await getMyHostOffers();
    } catch (error) {
        console.warn('Could not load host offers:', error.message || error);
        return;
    }
    const shown = JSON.stringify(offers);
    if (shown === lobbyOffersShown) return;
    lobbyOffersShown = shown;
    section.hidden = offers.length === 0;
    document.getElementById('host-offers-list').innerHTML = offers.map(offer => `
        <div class="host-offer" data-host-offer="${escapeHtml(offer.id)}">
            <div class="room-name">${escapeHtml(offer.room_name)}</div>
            <p class="room-info">${escapeHtml(offer.from_player_name || 'The host')} offered to make you host. You can start, pause and manage the game once you accept.</p>
            <div class="room-card-actions">
                <button class="btn btn-secondary btn-sm" data-host-offer-accept="${escapeHtml(offer.id)}">Accept</button>
                <button class="btn btn-secondary btn-sm" data-host-offer-decline="${escapeHtml(offer.id)}">Decline</button>
            </div>
        </div>
    `).join('');
}

async function answerHostOffer(offerId, accept, button) {
    const errorEl = document.getElementById('host-offers-error');
    errorEl.textContent = '';
    button.disabled = true;
    try {
        if (accept) {
            await acceptHostOffer(offerId);
            showToast("You're the host now.");
        } else {
            await declineHostOffer(offerId);
        }
        await Promise.all([loadHostOffers(), loadUserRooms()]);
    } catch (error) {
        if (accept && error.status === 403 && error.code === 'account_required') {
            window.location.href = 'auth.html?mode=register&next=lobby.html&reason=host_offer';
            return;
        }
        button.disabled = false;
        errorEl.textContent = error.message || 'Could not answer the offer. Please try again.';
    }
}

// ── My games ────────────────────────────────────────────────────

async function loadUserRooms() {
    const activeList = document.getElementById('active-rooms-list');
    let rooms;
    try {
        rooms = await apiFetch('/rooms/mine');
    } catch (error) {
        // A failed resync keeps the list already on screen.
        if (lobbyRoomsShown !== null) {
            console.warn('Could not refresh your games:', error.message || error);
            return;
        }
        console.error('Error loading rooms:', error);
        activeList.innerHTML = `
            <div class="loading">
                <p class="turn-warning danger">Couldn't load your games. Check your connection and refresh.</p>
            </div>
        `;
        return;
    }
    // Unchanged on a poll: leave the cards (and any button being pressed) alone.
    const shown = JSON.stringify(rooms);
    if (shown === lobbyRoomsShown) return;
    lobbyRoomsShown = shown;
    lobbyRooms = rooms;

    const active = lobbyRooms.filter(room => !room.archived);
    const archived = lobbyRooms.filter(room => room.archived);

    if (active.length === 0) {
        activeList.innerHTML = `
            <div class="loading">
                <p>${archived.length ? 'No active games. Archived games are below.' : 'No games yet. Create one and share the room code with friends.'}</p>
            </div>
        `;
    } else {
        activeList.innerHTML = active.map(renderRoomCard).join('');
    }
    document.getElementById('archived-rooms-section').hidden = archived.length === 0;
    document.getElementById('archived-rooms-list').innerHTML = archived.map(renderRoomCard).join('');

    syncRoomSubscriptions();
}

// One subscription per room; any event in any of them, or a socket (re)join,
// resyncs the page once.
function syncRoomSubscriptions() {
    const ids = new Set(lobbyRooms.map(room => room.id));
    lobbyRoomSubscriptions.forEach((sub, id) => {
        if (!ids.has(id)) {
            sub.unsubscribe();
            lobbyRoomSubscriptions.delete(id);
        }
    });
    ids.forEach(id => {
        if (!lobbyRoomSubscriptions.has(id)) {
            lobbyRoomSubscriptions.set(id, subscribeToRoom(id, scheduleRoomsReload, scheduleRoomsReload, scheduleRoomsReload));
        }
    });
}

// ── Staying live ────────────────────────────────────────────────
// Room events and socket rejoins come in bursts, so they wait 200ms and share
// one resync. watchForMissedUpdates (api.js) also resyncs when the page is
// shown again, comes back online, and every 15 seconds while visible: per-user
// archiving and games made or joined on another device emit no event here.

function scheduleRoomsReload() {
    clearTimeout(lobbyReloadTimer);
    lobbyReloadTimer = setTimeout(resyncLobby, 200);
}

// A call while one runs asks for one more run, so a change made mid-fetch is
// not lost.
function resyncLobby() {
    if (lobbyResyncInFlight) {
        lobbyResyncAgain = true;
        return lobbyResyncInFlight;
    }
    lobbyResyncInFlight = (async () => {
        try {
            do {
                lobbyResyncAgain = false;
                await Promise.all([refreshLobbyAccount(), loadUserRooms(), loadHostOffers()]);
                ManageRoom.refreshIfOpen();
            } while (lobbyResyncAgain);
        } finally {
            lobbyResyncInFlight = null;
        }
    })();
    return lobbyResyncInFlight;
}

function renderRoomCard(room) {
    const memberCount = Array.isArray(room.room_members) ? room.room_members.length : 0;
    const maxPlayers = Number(room.max_players || 0);
    const id = escapeHtml(room.id);
    const canManage = room.is_host && room.status !== 'completed';
    return `
        <div class="room-card" data-room-id="${id}">
            <div class="room-card-header">
                <div class="room-name">${escapeHtml(room.name)}</div>
                <div class="room-status ${roomStatusClass(room.status)}">${escapeHtml(formatStatus(room.status))}</div>
            </div>
            <div class="room-info">
                <span class="room-invite-code">${escapeHtml(room.invite_code)}</span>
                <span>${memberCount} of ${maxPlayers} players</span>
                ${room.is_host ? '<span class="badge">Host</span>' : ''}
                <span>Created ${formatTimeAgo(room.created_at)}</span>
            </div>
            <div class="room-card-actions">
                <button class="btn btn-secondary btn-sm" data-room-open="${id}">Open</button>
                ${canManage ? `<button class="btn btn-secondary btn-sm" data-room-manage="${id}">Manage</button>` : ''}
                ${room.archived
                    ? `<button class="btn btn-secondary btn-sm" data-room-unarchive="${id}">Unarchive</button>`
                    : `<button class="btn btn-secondary btn-sm" data-room-archive="${id}">Archive</button>`}
            </div>
        </div>
    `;
}

function openLobbyRoom(roomId) {
    const room = lobbyRooms.find(item => item.id === roomId);
    if (room) navigateToRoom(room);
    else navigateToWaitingRoom(roomId);
}

async function setRoomArchived(roomId, archived, button) {
    button.disabled = true;
    try {
        if (archived) await archiveRoom(roomId);
        else await unarchiveRoom(roomId);
        await loadUserRooms();
    } catch (error) {
        button.disabled = false;
        showToast(error.message || 'Could not update that game. Please try again.', 'error');
    }
}

function openManageSheet(roomId) {
    ManageRoom.open(roomId, {
        onChange: loadUserRooms,
        onClose: () => {
            const params = new URLSearchParams(window.location.search);
            if (!params.has('manage')) return;
            params.delete('manage');
            const query = params.toString();
            window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
        },
    });
}

function onRoomListClick(event) {
    const button = event.target.closest('button');
    if (button) {
        if (button.dataset.roomOpen) openLobbyRoom(button.dataset.roomOpen);
        else if (button.dataset.roomManage) openManageSheet(button.dataset.roomManage);
        else if (button.dataset.roomArchive) setRoomArchived(button.dataset.roomArchive, true, button);
        else if (button.dataset.roomUnarchive) setRoomArchived(button.dataset.roomUnarchive, false, button);
        return;
    }
    const card = event.target.closest('.room-card[data-room-id]');
    if (card) openLobbyRoom(card.dataset.roomId);
}

// ── Create a game ───────────────────────────────────────────────

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
    if (modalId === 'setPasswordModal') {
        document.getElementById('set-password-new').value = '';
        document.getElementById('set-password-confirm').value = '';
        document.getElementById('set-password-error').textContent = '';
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

        if (lobbyUser && lobbyUser.email) {
            // Best effort: the room page shows the code anyway.
            sendRoomCode({ email: lobbyUser.email, inviteCode: room.invite_code, roomName: room.name })
                .catch(err => console.warn('Room code email error:', err));
        }

        navigateToWaitingRoom(room.id);
    } catch (error) {
        console.error('Error creating room:', error);
        alert('Error creating game: ' + error.message);
    }
}

function formatStatus(status) {
    return ROOM_STATUS_LABELS[status] || status;
}

function roomStatusClass(status) {
    return ROOM_STATUS_LABELS[status] ? status : 'waiting';
}

window.addEventListener('click', (event) => {
    const target = event.target;
    if (!target.classList.contains('modal')) return;
    if (target.id === 'manageRoomModal' || target.id === 'manageAgentKeyModal') return; // manage-room.js closes these
    closeModal(target.id);
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('show-create-room-btn')?.addEventListener('click', showCreateRoomModal);
    document.getElementById('create-room-btn')?.addEventListener('click', createRoom);
    document.getElementById('cancel-create-room-btn')?.addEventListener('click', () => closeModal('createRoomModal'));
    document.getElementById('host-spectate')?.addEventListener('change', syncSpectateField);
    document.getElementById('set-password-btn')?.addEventListener('click', showSetPasswordModal);
    document.getElementById('set-password-form')?.addEventListener('submit', saveAccountPassword);
    document.getElementById('set-password-cancel-btn')?.addEventListener('click', () => closeModal('setPasswordModal'));

    document.getElementById('active-rooms-list')?.addEventListener('click', onRoomListClick);
    document.getElementById('archived-rooms-list')?.addEventListener('click', onRoomListClick);
    document.getElementById('host-offers-list')?.addEventListener('click', (event) => {
        const accept = event.target.closest('[data-host-offer-accept]');
        if (accept) return answerHostOffer(accept.dataset.hostOfferAccept, true, accept);
        const decline = event.target.closest('[data-host-offer-decline]');
        if (decline) answerHostOffer(decline.dataset.hostOfferDecline, false, decline);
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
