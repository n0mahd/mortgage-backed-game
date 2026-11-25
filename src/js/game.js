// Game page entry point (game.html): shared page state, startup, realtime sync
// and resync, rendering the Game tab and loading the Recent events log, sending
// game actions, turn and host actions, hotseat hand-over, winner and liquidation
// sheets, sheets and tabs, and the few helpers several sheets share
// (secondsUntil, groupHasBuildingsUi, isPlayersTurn).
// Feature code lives in src/js/game/ and is loaded before this file; all game
// page scripts share one global scope, so the state below is plain top-level
// `let` (e2e tests read currentGame and gameChannel by name) and handlers that
// action-dispatcher.js calls stay top-level functions.

let currentGame = null;
let currentRoom = null;
let currentUser = null;
let gameChannel = null;
let currentPlayerData = null;
let pendingWinnerStateAfterLiquidation = null;
let gameActionInFlight = false;
let lastGameSyncAt = 0;
let gameResyncInFlight = null;

// A connected socket delivers updates as they happen; this poll only catches
// updates missed while a phone slept or the connection dropped.
const GAME_RESYNC_CONNECTED_MS = 30000;
const GAME_RESYNC_CHECK_MS = 5000;
const GAME_JAIL_CARD_ASSET_ID = 'get-out-of-jail-free';
// About 20s in all: long enough to ride out a Cloudflare tunnel reconnect.
// Retrying is safe because the server applies one actionId only once.
const ACTION_RETRY_DELAYS_MS = [500, 1500, 3000, 5000, 10000];
// Gateway errors from nginx (502-504) and Cloudflare (520-530): the request
// did not get an answer from the game server.
const GATEWAY_ERROR_STATUSES = [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530];

// Newest game events, as loaded for the Recent events tab (the Board tab shows a few).
let recentGameEvents = [];
// The Recent events filter (a LOG_EVENT_FILTERS key); kept for this page view only.
let logEventFilter = 'all';
// Hotseat mode (same-device local play)
let isHotseatMode = false;
let isSpectator = false;
let hotseatTokens = []; // [{userId, token, name}]

// Initialize game on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Detect hotseat mode from sessionStorage
        const storedTokens = getHotseatSession();
        if (storedTokens) {
            isHotseatMode = true;
            hotseatTokens = storedTokens;
        }

        // Get current user (player 1's token is already in localStorage for hotseat)
        const user = await getCurrentUser();
        if (!user) {
            // A game link opened in a browser that isn't signed in: offer every
            // way back in (code from another device, room code, email).
            window.location.href = 'index.html?signin=game#resume';
            return;
        }
        currentUser = user;

        // Get room ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');

        if (!roomId) {
            alert('No room specified');
            window.location.href = 'lobby.html';
            return;
        }

        // Tabs and dialogs work from the first paint; the game header shows
        // before the log finishes loading, and a tap then must not be lost.
        bindStaticGameControls();

        // Load room and game data
        await loadGameData(roomId);

        // Set up real-time subscriptions
        setupRealtimeSubscriptions();

        // Set up UI event listeners
        setupUIListeners();

    } catch (error) {
        logActionError('Error initializing game:', error);
        const gameContent = document.getElementById('gameContent');
        if (gameContent) {
            gameContent.innerHTML = `
                <div class="loading">
                    <p class="turn-warning danger">Couldn't load this game: ${escapeHtml(error.message)}</p>
                    <button class="btn btn-primary" data-reload-page>Try again</button>
                    <a href="lobby.html" class="btn btn-secondary">Back to your games</a>
                </div>`;
            gameContent.querySelector('[data-reload-page]')?.addEventListener('click', () => window.location.reload());
        }
    }
});

// Load game and room data
async function loadGameData(roomId) {
    try {
        // Load room data
        const room = await getRoomById(roomId);

        currentRoom = room;

        // Display room info
        document.getElementById('room-code').textContent = room.invite_code;
        const roomTitle = document.getElementById('room-title');
        if (roomTitle && room.name) roomTitle.textContent = room.name;

        // Load game data
        const game = await getGameByRoomId(roomId);
        if (!game) throw new Error('Game not found for this room');

        currentGame = game;
        lastGameSyncAt = Date.now();
        document.getElementById('move-device-btn')?.toggleAttribute('hidden', isHotseatMode);
        document.getElementById('turn-alerts-btn')?.toggleAttribute('hidden', isHotseatMode);
        refreshTurnAlertsButton();

        // Find current player data
        const gameState = game.game_state;

        currentPlayerData = gameState.players.find(p => p.userId === currentUser.id);

        // A host without a seat watches: same board and log, no moves.
        isSpectator = !currentPlayerData && room.host_id === currentUser.id;
        if (!currentPlayerData && !isSpectator) {
            throw new Error('You are not a player in this game');
        }
        document.body.classList.toggle('is-spectator', isSpectator);
        document.querySelector('.nav-tab[data-section="market"]')?.toggleAttribute('hidden', isSpectator);
        document.getElementById('turn-alerts-btn')?.toggleAttribute('hidden', isHotseatMode || isSpectator);

        document.getElementById('user-email').textContent =
            currentUser.email || (currentPlayerData && currentPlayerData.name) || 'Guest';

        // Render game state
        renderGameState(gameState);
        if (!isHotseatMode && !isSpectator && !gameState.ended) maybeShowTurnAlertsPrompt();
        // An ended game opens on the final standings, also after a reload.
        if (gameState.ended) showWinnerFromState(gameState, winnerReasonFromState(gameState));

        // A resumed or reloaded hotseat game starts on player 1's token; hand the
        // device to whoever's turn it is.
        const turnPlayer = gameState.players[gameState.currentPlayerIndex];
        if (isHotseatMode && !gameState.ended && turnPlayer && turnPlayer.userId !== currentUser.id
            && hotseatTokens.some(record => record.userId === turnPlayer.userId)) {
            showHotseatInterstitial(turnPlayer.name);
        }

        // Load game log
        await loadGameLog();

    } catch (error) {
        logActionError('Error loading game data:', error);
        throw error;
    }
}

// Set up real-time subscriptions
function setupRealtimeSubscriptions() {
    gameChannel = subscribeToGame(currentRoom.id, async (game) => {
        await applyGameUpdate(game);
    }, () => {
        reportPresence();
        resyncGame();
        refreshRoomInfo();
    });
    RejoinPrompts.watch(currentRoom.id);
    // Host rights can move to another player mid-game (Manage players).
    getSocket().on('room:member_change', room => applyRoomUpdate(room));
    // Signed in as someone else in another tab: don't keep acting as them.
    if (!isHotseatMode) reloadOnSignInChange(() => currentUser && currentUser.id);

    // Phones drop the socket when the screen locks or the browser goes to the
    // background, so catch up whenever the page comes back. The server also
    // hears whether the game is on screen: turn alerts only go to players who
    // aren't looking at it.
    document.addEventListener('visibilitychange', () => {
        reportPresence();
        if (document.visibilityState === 'visible') resyncGame();
    });
    window.addEventListener('pageshow', (event) => {
        reportPresence();
        if (event.persisted) resyncGame();
    });
    window.addEventListener('pagehide', () => reportPresence(false));
    window.addEventListener('online', () => resyncGame());
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        const connected = gameChannel?.isConnected();
        if (!connected || Date.now() - lastGameSyncAt > GAME_RESYNC_CONNECTED_MS) resyncGame();
    }, GAME_RESYNC_CHECK_MS);
}

function reportPresence(visible = document.visibilityState === 'visible') {
    getSocket().emit('presence', { visible });
}

// The room (its host above all) can change while the game is open.
function applyRoomUpdate(room) {
    if (!room || !currentRoom || room.id !== currentRoom.id) return;
    const hostChanged = room.host_id !== currentRoom.host_id;
    currentRoom = { ...currentRoom, ...room };
    if (hostChanged && currentGame) renderGameState(currentGame.game_state);
}

async function refreshRoomInfo() {
    if (!currentRoom) return;
    try {
        applyRoomUpdate(await getRoomById(currentRoom.id));
    } catch (error) {
        console.warn('Room refresh failed:', error);
    }
}

// Fetch the latest game and apply it only if it is newer than what is shown.
function resyncGame() {
    if (!currentRoom || gameActionInFlight) return Promise.resolve();
    if (gameResyncInFlight) return gameResyncInFlight;
    gameResyncInFlight = (async () => {
        try {
            const game = await getGameByRoomId(currentRoom.id);
            lastGameSyncAt = Date.now();
            if (game && Number(game.state_version ?? 0) > Number(currentGame?.state_version ?? -1)) {
                await applyGameUpdate(game);
            }
        } catch (error) {
            console.warn('Game resync failed:', error);
        } finally {
            gameResyncInFlight = null;
        }
    })();
    return gameResyncInFlight;
}

function isRoomHost() {
    return !!currentRoom && currentUser.id === currentRoom.host_id;
}

function isMyTurnIn(game) {
    const gameState = game?.game_state;
    if (!gameState || gameState.ended || gameState.paused || !currentUser) return false;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    return !!currentPlayer && currentPlayer.userId === currentUser.id;
}

async function applyGameUpdate(game, options = {}) {
    if (!game || !game.game_state) return;
    const incomingVersion = Number(game.state_version ?? 0);
    const currentVersion = Number(currentGame?.state_version ?? -1);
    if (!options.force && incomingVersion < currentVersion) return;

    const wasMyTurn = isMyTurnIn(currentGame);
    const wasEnded = !!currentGame?.game_state?.ended;
    currentGame = game;
    lastGameSyncAt = Date.now();
    const gameState = game.game_state;
    currentPlayerData = gameState.players.find(p => p.userId === currentUser.id);
    if (!wasMyTurn && isMyTurnIn(game) && !isHotseatMode) {
        TurnAlert.buzz();
    }

    renderGameState(gameState);
    await loadGameLog();
    renderBoardTab();
    populatePlayerDropdowns();
    // Open sheets recalculate from the new state, keeping what was typed.
    Mergers.refresh();
    refreshCorporationSheets();

    // The standings open once, when the game ends. While this player's own action is
    // in flight, performGameAction opens them, after any bankruptcy summary.
    if (gameState.ended && !wasEnded && !options.suppressWinner && !gameActionInFlight) {
        showWinnerFromState(gameState, winnerReasonFromState(gameState));
    }
}

// Render complete game state
function renderGameState(gameState) {
    const gameContent = document.getElementById('gameContent');

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    // Once the game is over it is nobody's turn, even behind the Game Over dialog.
    const isMyTurn = !gameState.ended && currentPlayer.userId === currentUser.id;
    const paused = !!gameState.paused;
    const landing = getLandingSummary(gameState, currentPlayer);

    document.body.classList.toggle('is-my-turn', isMyTurn && !paused);

    const orderedPlayers = [
        ...gameState.players.filter(p => p.userId === currentUser.id),
        ...gameState.players.filter(p => p.userId !== currentUser.id)
    ];

    gameContent.innerHTML = `
        <div class="game-layout">
            <div class="game-layout-main">
                ${renderTurnTicket(gameState, currentPlayer, landing, isMyTurn, paused)}
                <div class="turn-context">
                    ${renderLandingSummary(landing, currentPlayer, isMyTurn)}
                    ${renderCashWarning(currentPlayer, isMyTurn)}
                    ${renderPauseBanner(gameState)}
                    ${renderLastCardSummary(gameState, currentPlayer)}
                </div>
                ${renderAuctionPanel(gameState)}
                ${gameState.ended ? renderGameOverActions() : `
                    ${renderCashSinceTurn(gameState, currentUser?.id)}
                    ${isSpectator ? renderSpectatorNote() : (paused ? renderPausedActions(gameState) : (isMyTurn ? renderActionButtons(landing) : renderNonTurnActions()))}
                `}
            </div>

            <div>
                <div class="section-heading"><h3>Players</h3></div>
                <div class="players-grid">
                    ${orderedPlayers.map(player => renderPlayerCard(player, player.userId === currentUser.id)).join('')}
                </div>

                <div class="recent-log">
                    <div class="section-heading"><h3>Recent actions</h3></div>
                    <div class="log-entries" id="game-recent-actions">${renderGameTabRecentActions()}</div>
                </div>

                ${renderHostPanel(gameState)}
            </div>
        </div>
    `;

    RuleProposals.render();
    updateTabAlerts();
}

// Whole seconds until an ISO time (0 once it has passed), or null if unset or invalid.
function secondsUntil(isoTime) {
    if (!isoTime) return null;
    const time = new Date(isoTime).getTime();
    if (Number.isNaN(time)) return null;
    return Math.max(Math.ceil((time - Date.now()) / 1000), 0);
}

// Load game log from events table
async function loadGameLog() {
    try {
        const events = await apiFetch(`/games/${currentGame.id}/events`);
        recentGameEvents = orderGameEventsNewestFirst(Array.isArray(events) ? events : []);
        renderGameLog();
    } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            console.warn('Unable to refresh game log:', error.message);
        } else {
            logActionError('Error loading game log:', error);
        }
    }
}

// Draws the Recent events tab from recentGameEvents: the filter row, then the
// log under the chosen filter.
function renderGameLog() {
    const filters = document.getElementById('log-filters');
    if (filters) {
        filters.innerHTML = LOG_EVENT_FILTERS.map(filter => `<button type="button" class="segmented-option"
            data-game-action="log-filter" data-log-filter="${filter.key}"
            aria-pressed="${filter.key === logEventFilter}">${escapeHtml(filter.label)}</button>`).join('');
    }
    const recentActions = document.getElementById('game-recent-actions');
    if (recentActions) recentActions.innerHTML = renderGameTabRecentActions();
    const logContainer = document.getElementById('full-game-log');
    if (!logContainer) return;
    const state = currentGame && currentGame.game_state;
    const currentPlayer = state && !state.ended ? state.players[state.currentPlayerIndex] : null;
    logContainer.innerHTML = renderGameLogHtml(recentGameEvents, logEventFilter, currentPlayer ? currentPlayer.name : null);
}

// The Game tab's last few events, in the same rows as the Recent events tab,
// which has the rest.
const GAME_TAB_RECENT_ACTIONS = 3;
function renderGameTabRecentActions() {
    const rows = recentGameEvents.slice(0, GAME_TAB_RECENT_ACTIONS).map(renderGameLogRow).join('');
    return rows || '<div class="log-entry"><span class="log-message empty-state">No moves yet.</span></div>';
}

function setLogEventFilter(filterKey) {
    if (!LOG_EVENT_FILTERS.some(filter => filter.key === filterKey)) return;
    logEventFilter = filterKey;
    renderGameLog();
}

// The server refuses trades of streets in a colour group with buildings and
// IPOs of part of one; these show that rule before the player hits it.
function groupHasBuildingsUi(color) {
    if (!HOUSE_COSTS[color] || !currentGame) return false;
    return currentGame.game_state.properties.some(p => p.color === color && Number(p.houses || 0) > 0);
}

function isPlayersTurn(player) {
    const gameState = currentGame.game_state;
    return !!player && gameState.players[gameState.currentPlayerIndex]?.userId === player.userId;
}

function isCurrentUsersTurn() {
    return isPlayersTurn({ userId: currentUser.id });
}

// Mirrors the engine: building, IPOs, adding properties, treasury shares,
// dividends, rent policy and loans are open to any active player at any time,
// except while an auction is open or the game is paused. Only movement waits
// for your turn.
function canMakeAnytimeMove() {
    const gameState = currentGame?.game_state;
    if (!gameState || gameState.ended || gameState.paused || gameState.auction?.status === 'open') return false;
    if (isSpectator) return false;
    return !!currentPlayerData && !currentPlayerData.bankrupt;
}

// Why canMakeAnytimeMove() is false, as a short note for a disabled button.
function anytimeMoveHoldNote() {
    const gameState = currentGame?.game_state;
    if (gameState?.auction?.status === 'open') return 'After the auction';
    if (gameState?.paused) return 'Game paused';
    return 'Not available';
}

// Turn actions: roll, get out of Jail, end the turn.
async function rollDiceAndMove() {
    if (!currentGame || !currentUser) return;
    // Tests set window.__E2E_NEXT_DICE to choose the roll.
    const payload = Array.isArray(window.__E2E_NEXT_DICE)
        ? { testDice: window.__E2E_NEXT_DICE.splice(0, 2) }
        : {};
    await submitGameAction('roll_dice', payload, { errorText: 'Failed to roll dice' });
}

async function payJailFine() {
    if (!currentGame || !currentUser) return;
    await submitGameAction('pay_jail_fine', {}, { errorText: 'Failed to pay Jail fine' });
}

async function useJailCard() {
    if (!currentGame || !currentUser) return;
    await submitGameAction('use_get_out_of_jail_card', {}, { errorText: 'Failed to use Jail card' });
}

async function endTurn() {
    const beforeUserId = currentUser.id;
    await submitGameAction('end_turn', {}, {
        errorText: 'Failed to end turn',
        onSaved: () => {
            const gameState = currentGame.game_state;
            const nextPlayer = gameState.players[gameState.currentPlayerIndex];
            if (gameState.ended) return;
            // Hotseat: show the pass-device screen before the next player takes over.
            if (isHotseatMode && nextPlayer && nextPlayer.userId !== beforeUserId) {
                showHotseatInterstitial(nextPlayer.name);
            }
        },
    });
}

// ── Hotseat: pass-device interstitial ──────────────────────────────
function showHotseatInterstitial(nextPlayerName) {
    document.getElementById('hotseat-next-player-name').textContent = nextPlayerName;
    document.getElementById('hotseat-interstitial').style.display = 'flex';
}

function dismissHotseatInterstitial() {
    const gameState = currentGame.game_state;
    const nextPlayer = gameState.players[gameState.currentPlayerIndex];

    const record = hotseatTokens.find(t => t.userId === nextPlayer.userId);
    if (!record) {
        document.getElementById('hotseat-interstitial').style.display = 'none';
        return;
    }

    // Swap active token — apiFetch() reads localStorage on every call
    setToken(record.token);

    // Update in-memory identity without an extra API round-trip
    currentUser = { id: record.userId, email: null, is_anonymous: true };
    currentPlayerData = gameState.players.find(p => p.userId === currentUser.id);

    // Re-render from the new player's perspective
    renderGameState(gameState);
    document.getElementById('hotseat-interstitial').style.display = 'none';
}

// Host-triggered end game: the server ranks players by net worth.
async function hostEndGame() {
    if (!confirm('End the game now and declare a winner by net worth?')) return;
    await submitGameAction('host_end_game', {}, { errorText: 'Failed to end game' });
}

async function hostPauseGame() {
    if (!confirm('Pause the game for everyone? No one can play until you resume.')) return;
    await submitGameAction('host_pause_game', {}, {
        errorText: 'Failed to pause game.',
        showError: showToast,
    });
}

async function hostResumeGame() {
    if (!confirm('Resume the game for everyone?')) return;
    await submitGameAction('host_resume_game', {}, {
        errorText: 'Failed to resume game.',
        showError: showToast,
    });
}

// Sends a game action from a button or form and tells the player if it failed.
// onSaved(result) runs only once the server saved the action: performGameAction
// returns null after a conflict, which it has already explained, or while
// another action is in flight. On failure the player sees the server's
// message, or errorText when there is none; showError defaults to alert.
async function submitGameAction(type, payload, { errorText, onSaved, showError = alert } = {}) {
    try {
        const result = await performGameAction(type, payload);
        if (result && onSaved) await onSaved(result);
        return result;
    } catch (error) {
        logActionError(`Game action ${type} failed:`, error);
        showError(error.message || errorText);
        return null;
    }
}

// Their price (share value) can move with another player's action, so a
// refused one goes back to the player to review instead of being resent.
const PRICE_SENSITIVE_ACTION_TYPES = new Set(['buy_shares', 'add_to_corporation', 'propose_merger']);

async function performGameAction(type, payload = {}) {
    if (gameActionInFlight) return null;

    gameActionInFlight = true;
    setGameActionUiBusy(true);
    const endedBefore = !!currentGame?.game_state?.ended;

    try {
        // One actionId for every retry: the server applies an action once and
        // replays the saved result if the same id arrives again.
        const actionId = makeActionId();
        const post = () => postGameActionWithRetry(JSON.stringify({
            actionId,
            type,
            payload,
            expectedVersion: currentGame.state_version
        }));
        let result;
        try {
            result = await post();
        } catch (error) {
            if (error.status !== 409 || PRICE_SENSITIVE_ACTION_TYPES.has(type)) throw error;
            // Anyone can act at any time, so another player's move often lands
            // first. A refused (409) action wasn't saved: catch up and send it
            // once more against the new state, which the server checks again.
            await refreshCurrentGame();
            result = await post();
        }
        try {
            const events = result.events || [];
            const endedNow = !!result.game?.game_state?.ended && !endedBefore;
            await applyGameUpdate(result.game, { force: true, suppressWinner: true });
            // One sheet at a time: a bankruptcy summary first, the standings when it closes.
            const liquidationShown = showLiquidationSummaryFromEvents(events);
            if (endedNow && liquidationShown) {
                pendingWinnerStateAfterLiquidation = result.game.game_state;
            } else if (endedNow) {
                showWinnerFromState(result.game.game_state, winnerReasonFromState(result.game.game_state));
            }
        } catch (renderError) {
            // The action was saved; a display problem must not be reported as a failed move.
            logActionError('Error showing game update:', renderError);
        }
        return result;
    } catch (error) {
        if (error.status === 409) {
            await refreshCurrentGame();
            alert('The game changed before your action was saved. Review the latest state and try again.');
            return null;
        }
        if (isRetryableActionError(error)) {
            gameActionInFlight = false;
            resyncGame();
            throw new Error("Couldn't reach the game server. Check your connection; the game will refresh when you're back online.");
        }
        throw error;
    } finally {
        gameActionInFlight = false;
        setGameActionUiBusy(false);
    }
}

// The server refusing an action (4xx) is part of play and was already shown to
// the player; only unexpected failures are console errors.
function logActionError(label, error) {
    const refused = error && error.status >= 400 && error.status < 500;
    (refused ? console.warn : console.error)(label, error);
}

function isRetryableActionError(error) {
    return !error.status || GATEWAY_ERROR_STATUSES.includes(error.status);
}

async function postGameActionWithRetry(body) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await apiFetch(`/games/${currentGame.id}/actions`, { method: 'POST', body });
        } catch (error) {
            if (!isRetryableActionError(error) || attempt >= ACTION_RETRY_DELAYS_MS.length) throw error;
            await new Promise(resolve => setTimeout(resolve, ACTION_RETRY_DELAYS_MS[attempt]));
        }
    }
}

function setGameActionUiBusy(isBusy) {
    document.querySelectorAll('button').forEach(button => {
        if (isBusy) {
            if (!button.dataset.preActionDisabled) {
                button.dataset.preActionDisabled = button.disabled ? 'true' : 'false';
            }
            button.disabled = true;
            button.classList.add('game-action-busy');
            return;
        }

        if (button.dataset.preActionDisabled !== undefined) {
            button.disabled = button.dataset.preActionDisabled === 'true';
            delete button.dataset.preActionDisabled;
            button.classList.remove('game-action-busy');
        }
    });
}

async function refreshCurrentGame() {
    if (!currentRoom) return;
    currentGame = await getGameByRoomId(currentRoom.id);
    lastGameSyncAt = Date.now();
    currentPlayerData = currentGame.game_state.players.find(p => p.userId === currentUser.id);
    renderGameState(currentGame.game_state);
    renderBoardTab();
}

function makeActionId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showWinnerFromState(gameState, reason) {
    const standings = gameState.standings || gameState.players.map(player => ({
        name: player.name,
        netWorth: player.netWorth || player.cash,
        bankrupt: player.bankrupt
    })).sort((a, b) => b.netWorth - a.netWorth);
    if (isHotseatMode) {
        clearHotseatSession();
        if (currentRoom && currentRoom.invite_code) clearHotseatResume(currentRoom.invite_code);
    }
    const winner = standings[0];
    const standingsHtml = standings.map((p, i) => `
        <div class="standings-row ${p.bankrupt ? 'bankrupt' : ''}">
            <span class="rank">#${i + 1}</span>
            <span class="player-name">${escapeHtml(p.name)}${p.bankrupt ? ' (bankrupt)' : ''}</span>
            <span class="net-worth">${formatMoney(Math.round(Number(p.netWorth || 0)))}</span>
        </div>
    `).join('');
    const everyoneBankrupt = standings.length > 0 && standings.every(p => p.bankrupt);
    document.getElementById('winnerName').textContent = !winner ? 'Game over' : (everyoneBankrupt ? "It's a draw" : `${winner.name} wins`);
    document.getElementById('winnerReason').textContent = reason || '';
    document.getElementById('finalStandings').innerHTML = standingsHtml;
    openModal('winnerModal');
}

// Why the game ended, from the engine's "Game over - <reason>" log line (finishGame in
// turns.js), without the winner's name the sheet already shows.
function winnerReasonFromState(gameState) {
    const log = gameState?.gameLog || [];
    const line = [...log].reverse().find(entry => /^Game over - /.test(entry.message || ''));
    if (!line) return '';
    const reason = line.message.replace(/^Game over - /, '');
    if (/^Host ended the game/.test(reason)) return 'The host ended the game. Ranked by net worth.';
    if (/last player standing/.test(reason)) return 'Last player standing';
    if (/draw/.test(reason)) return 'Everyone went bankrupt';
    return reason;
}

// Game over: what's left to do on the Game tab is look at the standings again.
function renderGameOverActions() {
    return `
        <div class="game-over-actions">
            <button class="btn btn-primary" data-game-action="show-final-standings">Final standings</button>
        </div>
    `;
}

function showFinalStandings() {
    const gameState = currentGame?.game_state;
    if (gameState?.ended) showWinnerFromState(gameState, winnerReasonFromState(gameState));
}

function hasLiquidationEvent(events) {
    return (events || []).some(event => event.type === 'bankruptcy_liquidation');
}

function showLiquidationSummaryFromEvents(events) {
    const liquidationEvent = (events || []).find(event => event.type === 'bankruptcy_liquidation');
    if (!liquidationEvent) return false;
    const bankruptcyEvent = (events || []).find(event => event.type === 'bankruptcy');
    const data = liquidationEvent.data || {};
    const destination = data.assetDestinationName || 'the Bank';
    const reason = data.reason || bankruptcyEvent?.data?.reason || 'bankruptcy';
    const propertyNames = (data.releasedProperties || []).map(item => item.name || item.id).filter(Boolean);
    const returnedShares = formatSharePositions(data.returnedSharePositions);
    const transferredShares = formatSharePositions(data.transferredSharePositions, true);

    const title = `${data.player || 'A player'} is bankrupt`;
    const summary = `${data.player || 'They'} couldn't pay ${data.creditor || 'the Bank'}.`;
    const rows = [
        ['Cause', reason],
        ['Properties', propertyNames.length ? `${propertyNames.join(', ')} to ${destination}, without houses` : 'None'],
        ['Shares', [returnedShares, transferredShares].filter(Boolean).join('; ') || 'None'],
        ['Loans', 'Cleared'],
    ];

    document.getElementById('liquidationModalTitle').textContent = title;
    document.getElementById('liquidationModalSummary').textContent = summary;
    document.getElementById('liquidationModalDetails').innerHTML = rows.map(([label, value]) => `
        <div class="liquidation-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `).join('');
    openModal('liquidationModal');
    return true;
}

function formatSharePositions(positions, transferred = false) {
    if (!Array.isArray(positions) || positions.length === 0) return '';
    return positions.map(item => {
        const shares = Number(item.shares || 0);
        const ticker = item.ticker || 'corporation';
        const count = `${ShareDeals.count(shares)} ${ticker} share${shares === 1 ? '' : 's'}`;
        if (transferred && item.to) return `${count} to ${item.to}`;
        return `${count} back to ${ticker}`;
    }).join(', ');
}

// Modal controls
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
    if (modalId === 'liquidationModal' && pendingWinnerStateAfterLiquidation) {
        const winnerState = pendingWinnerStateAfterLiquidation;
        pendingWinnerStateAfterLiquidation = null;
        showWinnerFromState(winnerState, winnerReasonFromState(winnerState));
    }
}

// Tab navigation
function showSection(tab, sectionName) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    document.getElementById(sectionName).classList.add('active');
    tab.classList.add('active');
    window.scrollTo({ top: 0 });

    if (sectionName === 'board') {
        renderBoardTab();
    }
    if (sectionName === 'market') {
        openMarketOnWaitingOffer();
    }

    updateTabAlerts();
}

// Alerts live on the tab they lead to, so nothing floats over the page: away from
// the Game tab on your turn it turns gold and reads "Your turn", and a rule vote
// waiting on you puts a badge on Market (RuleProposals.updateVoteBadge).
function updateTabAlerts() {
    if (!currentGame || !currentUser) return;
    const gameState = currentGame.game_state;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = !!currentPlayer && currentPlayer.userId === currentUser.id && !gameState.paused && !gameState.ended;
    const gameTab = document.querySelector('.nav-tab[data-section="game"]');
    if (gameTab) {
        const alert = isMyTurn && !gameTab.classList.contains('active');
        const wasAlert = gameTab.classList.contains('is-turn');
        gameTab.classList.toggle('is-turn', alert);
        gameTab.querySelector('.nav-tab-label').textContent = alert ? 'Your turn' : 'Game';
        if (alert && !wasAlert) announceTabAlert("It's your turn");
    }
    RuleProposals.updateVoteBadge();
}

// Screen readers hear a tab alert once, when it appears.
function announceTabAlert(message) {
    const status = document.getElementById('tab-alerts');
    if (status) status.textContent = message;
}

// Wire up the page's static controls once the game has loaded.
function setupUIListeners() {
    // Populate player dropdowns
    populatePlayerDropdowns();
}

function bindStaticGameControls() {
    document.querySelector('.nav-tabs')?.addEventListener('click', (event) => {
        const tab = event.target.closest('.nav-tab[data-section]');
        if (tab) showSection(tab, tab.dataset.section);
    });
    bindMarketTabs();

    // Escape or a tap on the dimmed backdrop closes a dialog, like its Cancel button.
    const dismissableModal = () => Array.from(document.querySelectorAll('.modal.active')).pop();
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const modal = dismissableModal();
        if (modal) closeModal(modal.id);
    });

    document.addEventListener('click', (event) => {
        const closeButton = event.target.closest('[data-close-modal]');
        if (closeButton) {
            closeModal(closeButton.dataset.closeModal);
            return;
        }

        if (event.target.classList?.contains('modal') && event.target === dismissableModal()) {
            closeModal(event.target.id);
            return;
        }

        const playerSummary = event.target.closest('.player-card-summary');
        if (playerSummary) {
            togglePlayerCard(playerSummary);
            return;
        }

        if (event.target.closest('#boardContent') && !event.target.closest('[data-game-action], [data-switch-section]')) {
            if (handleBoardClick(event)) renderBoardTab();
            return;
        }

        const switchButton = event.target.closest('[data-switch-section]');
        if (switchButton) {
            document.querySelector(`.nav-tab[data-section="${switchButton.dataset.switchSection}"]`)?.click();
            return;
        }

        const actionButton = event.target.closest('[data-game-action]');
        if (actionButton) GameActionDispatcher.run(actionButton);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const playerSummary = event.target.closest('.player-card-summary');
        if (!playerSummary) return;
        event.preventDefault();
        togglePlayerCard(playerSummary);
    });

    // Desktop: pointing at a board square shows its details in the centre.
    const boardContent = document.getElementById('boardContent');
    if (boardContent && window.matchMedia('(hover: hover)').matches) {
        boardContent.addEventListener('mouseover', (event) => {
            const cell = event.target.closest('.board-cell');
            if (cell && currentGame) previewBoardSquare(currentGame.game_state, Number(cell.dataset.boardSquare));
        });
        boardContent.addEventListener('mouseleave', () => {
            if (currentGame) previewBoardSquare(currentGame.game_state, null);
        });
    }

    // A hairline appears under the app bar once content scrolls beneath it.
    const appBar = document.querySelector('.app-bar');
    if (appBar) {
        window.addEventListener('scroll', () => {
            appBar.classList.toggle('is-scrolled', window.scrollY > 4);
        }, { passive: true });
    }

    document.addEventListener('change', (event) => {
        if (event.target.closest('#player1Assets, #player2Assets, #player1Destination, #player2Destination')) {
            // Shares trade whole: show the rounding instead of quietly dropping the part.
            const shareInput = event.target.closest('.trade-share-input, .trade-new-shares-input');
            if (shareInput && shareInput.value !== '' && !Number.isInteger(Number(shareInput.value))) {
                shareInput.value = String(Math.max(0, Math.floor(Number(shareInput.value) || 0)));
                updateTradeSharePercent(shareInput);
                showToast('Shares trade in whole numbers, so that was rounded down.');
            }
            updateMarketActionState();
        }
    });
    document.addEventListener('input', (event) => {
        if (event.target.closest('.buy-shares-form input')) updateBuySharesTotal(event.target);
        if (event.target.closest('#player1Assets .trade-new-shares-input, #player2Assets .trade-new-shares-input')) updateMarketActionState();
        if (event.target.closest('#player1Assets .trade-share-input, #player2Assets .trade-share-input')) {
            updateTradeSharePercent(event.target);
            updateMarketActionState();
        }
    });

    RuleProposals.bind();
    document.getElementById('executeTradeBtn')?.addEventListener('click', executeTransaction);
    document.getElementById('makePaymentBtn')?.addEventListener('click', makePayment);
    document.getElementById('confirm-purchase-btn')?.addEventListener('click', confirmPurchase);
    document.getElementById('start-auction-btn')?.addEventListener('click', startAuctionFromPurchase);
    document.getElementById('create-ipo-btn')?.addEventListener('click', createIPO);
    document.getElementById('add-to-corp-btn')?.addEventListener('click', submitAddToCorporation);
    document.getElementById('addToCorpModal')?.addEventListener('change', renderAddToCorpChoices);
    document.getElementById('add-cash-to-corp-btn')?.addEventListener('click', submitAddCashToCorporation);
    document.getElementById('addCashToCorpModal')?.addEventListener('change', renderAddCashToCorpChoices);
    document.getElementById('addCashToCorpAmount')?.addEventListener('input', renderAddCashToCorpChoices);
    CorporationDesk.bind();
    document.getElementById('debtAction')?.addEventListener('change', toggleDebtForm);
    document.getElementById('debtIssuer')?.addEventListener('change', renderBorrowingLimit);
    document.getElementById('loanOutlook')?.addEventListener('click', handleOutlookClick);
    ['loanAmount', 'loanTerm', 'loanAutopay'].forEach(id => {
        document.getElementById(id)?.addEventListener(id === 'loanAmount' ? 'input' : 'change', () => {
            renderLoanTerms('loan');
            renderBorrowingLimit();
        });
    });
    ['refinanceTerm', 'refinanceAutopay'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            renderLoanTerms('refinance');
            updateRefinanceSummary();
        });
    });
    document.getElementById('loanList')?.addEventListener('click', handleLoanListClick);
    document.getElementById('loanList')?.addEventListener('change', handleLoanAutopayChange);
    document.getElementById('refinanceAmount')?.addEventListener('input', () => renderLoanTerms('refinance'));
    document.getElementById('refinanceBorrower')?.addEventListener('change', renderRefinanceDebtOptions);
    document.getElementById('debtsToRefinance')?.addEventListener('change', handleRefinanceSelectionChange);
    document.getElementById('refinanceAmount')?.addEventListener('input', updateRefinanceSummary);
    document.getElementById('process-debt-btn')?.addEventListener('click', processDebt);
    document.getElementById('confirm-house-purchase-btn')?.addEventListener('click', confirmHousePurchase);
    document.getElementById('back-to-lobby-btn')?.addEventListener('click', () => {
        window.location.href = 'lobby.html';
    });
    document.getElementById('dismiss-hotseat-btn')?.addEventListener('click', dismissHotseatInterstitial);
    document.getElementById('move-device-btn')?.addEventListener('click', openMoveDeviceModal);
    document.getElementById('turn-alerts-btn')?.addEventListener('click', openTurnAlertsModal);
    document.getElementById('turnAlertsActions')?.addEventListener('click', handleTurnAlertsAction);
    document.getElementById('turnAlertsPrompt')?.addEventListener('click', handleTurnAlertsPromptAction);
    document.getElementById('share-move-device-btn')?.addEventListener('click', shareMoveDeviceLink);
}

// Render / refresh the Board tab content
function renderBoardTab() {
    const el = document.getElementById('boardContent');
    if (!el || !currentGame || !currentUser) return;
    el.innerHTML = renderBoard(currentGame.game_state, currentUser.id, recentGameEvents);
    animateBoardTokens(currentGame.game_state);
}
