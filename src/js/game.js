// Game Room JavaScript - Multiplayer Monopoly Game Logic

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
const ACTION_RETRY_DELAYS_MS = [500, 1500, 3000];

// Hotseat mode (same-device local play)
let isHotseatMode = false;
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

        // Load room and game data
        await loadGameData(roomId);

        // Set up real-time subscriptions
        setupRealtimeSubscriptions();

        // Set up UI event listeners
        setupUIListeners();

    } catch (error) {
        console.error('Error initializing game:', error);
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

        if (!currentPlayerData) {
            throw new Error('You are not a player in this game');
        }

        document.getElementById('user-email').textContent =
            currentUser.email || (currentPlayerData && currentPlayerData.name) || 'Guest';

        // Render game state
        renderGameState(gameState);

        // Load game log
        await loadGameLog();

    } catch (error) {
        console.error('Error loading game data:', error);
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
    });
    RejoinPrompts.watch(currentRoom.id);

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

    if (gameState.ended && !options.suppressWinner) {
        showWinnerFromState(gameState, winnerReasonFromState(gameState));
    }
}

// Render complete game state
function renderGameState(gameState) {
    const gameContent = document.getElementById('gameContent');

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = currentPlayer.userId === currentUser.id;
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
                ${paused ? renderPausedActions(gameState) : (isMyTurn ? renderActionButtons(landing) : renderNonTurnActions())}
            </div>

            <div>
                <div class="section-heading">
                    <h3>Players</h3>
                    <span>${gameState.players.filter(p => !p.bankrupt).length} still solvent</span>
                </div>
                <div class="players-grid">
                    ${orderedPlayers.map(player => renderPlayerCard(player, player.userId === currentUser.id)).join('')}
                </div>

                <div class="recent-log">
                    <div class="section-heading"><h3>Recent actions</h3></div>
                    <div class="log-entries">
                        ${gameState.gameLog.slice(-5).reverse().map(entry => `
                            <div class="log-entry">
                                <span class="log-time">${new Date(entry.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                                <span class="log-message">${escapeHtml(entry.message)}</span>
                            </div>
                        `).join('') || '<div class="log-entry"><span class="log-message empty-state">No moves yet.</span></div>'}
                    </div>
                </div>

                ${renderHostPanel(gameState)}
            </div>
        </div>
    `;

    updateTurnBanner();
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

        const logContainer = document.getElementById('full-game-log');
        logContainer.innerHTML = events.map(event => `
            <div class="log-entry">
                <span class="log-time">${escapeHtml(formatLogTimestamp(event.created_at))}</span>
                <span class="log-message">${escapeHtml(formatLogEvent(event.event_type, event.event_data))}</span>
            </div>
        `).join('');

    } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            console.warn('Unable to refresh game log:', error.message);
        } else {
            console.error('Error loading game log:', error);
        }
    }
}

// Open IPO Modal
async function openIPOModal() {
    const assetsHtml = currentPlayerData.properties.map(p => `
        <div class="asset-checkbox">
            <input type="checkbox" id="ipo-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="ipo-asset-${escapeHtml(p.id)}">${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span></label>
        </div>
    `).join('');

    document.getElementById('ipoAssets').innerHTML = assetsHtml;
    openModal('ipoModal');
}

async function createIPO() {
    const ticker = document.getElementById('ipoTicker').value.toUpperCase();
    const numShares = parseInt(document.getElementById('ipoShares').value);
    const pricePerShare = parseFloat(document.getElementById('ipoPrice').value);

    if (!ticker || !numShares || !pricePerShare) {
        alert('Please fill in all fields');
        return;
    }

    const selectedAssets = Array.from(document.querySelectorAll('#ipoAssets input:checked'))
        .map(cb => currentPlayerData.properties.find(p => p.id === cb.value));

    if (selectedAssets.length === 0) {
        alert('Please select at least one asset');
        return;
    }

    await submitGameAction('create_ipo', {
        ticker,
        totalShares: numShares,
        pricePerShare,
        assetIds: selectedAssets.map(asset => asset.id),
    }, {
        errorText: 'Failed to create IPO',
        alwaysErrorText: true,
        onSaved: () => closeModal('ipoModal'),
    });
}

// Open Corporation Modal
async function openCorporationModal() {
    const gameState = currentGame.game_state;
    const isMyTurn = gameState.players[gameState.currentPlayerIndex].userId === currentUser.id;

    const corporationsHtml = gameState.corporations.map(corp => {
        const shareholders = Array.isArray(corp.shareholders) ? corp.shareholders : [];
        const assets = Array.isArray(corp.assets) ? corp.assets : [];
        const debts = Array.isArray(corp.debts) ? corp.debts : [];
        const myShares = shareholders.find(s => s.userId === currentUser.id);
        const listedShares = getListedShares(corp);
        const treasuryListedShares = getTreasuryListedShares(corp);
        const founderListedShares = getFounderListedShares(corp);
        const isFounder = corp.founderId === currentUser.id;
        const isInsolvent = ShareDeals.isInsolvent(corp);
        const buyableShares = getBuyableListedShares(corp, currentUser.id);
        const canBuy = isMyTurn && buyableShares > 0 && !isInsolvent;
        const governanceHtml = renderChairmanGovernance(corp);
        const canOfferProperty = !isInsolvent && !!corp.chairmanId && corp.chairmanId !== currentUser.id
            && (currentPlayerData?.properties || []).length > 0 && !currentPlayerData?.bankrupt;
        const pricePerShare = Number(corp.pricePerShare || 0);
        const netAssetValue = getCorporationNetAssetValue(corp);
        const shareValue = getCorporationShareValue(corp);
        const shareholderRows = shareholders.length
            ? shareholders.map(s => `<li>${escapeHtml(s.name)}: ${s.shares} shares (${ownershipPercent(s.shares, corp.totalShares)}%)</li>`).join('')
            : '<li>No active shareholders</li>';
        const debtRows = debts.length
            ? debts.map(d => `<li>$${Number(d.principal || 0).toFixed(2)} @ ${Number(d.interestRate || 0)}% (interest next turn: $${interestPayment(d).toFixed(2)})</li>`).join('')
            : '<li>No corporation debt</li>';
        const listingDetails = listedShares > 0
            ? `<p>Listed Shares: ${listedShares} (${founderListedShares} founder, ${treasuryListedShares} treasury)</p>`
            : '<p>Listed Shares: 0</p>';
        const buyLabel = isFounder ? 'Buy treasury shares' : 'Buy listed shares';

        return `
        <div class="corporation-card">
            <h3>${escapeHtml(corp.ticker)} - ${escapeHtml(corp.name)} ${isInsolvent ? '<span class="badge badge-danger">Insolvent</span>' : ''}</h3>
            <p>Founder: ${escapeHtml(corp.founderName)}</p>
            <p>Chairman: ${escapeHtml(isInsolvent ? 'Closed' : (corp.chairmanName || corp.founderName || 'Unassigned'))}</p>
            <p>Majority holder: ${escapeHtml(majorityHolderName(corp) || 'None')}</p>
            <p>Treasury Cash: $${Number(corp.cash || 0).toFixed(2)}</p>
            <p>Total Shares: ${corp.totalShares} | Asking: $${pricePerShare.toFixed(2)}/share | NAV: $${shareValue.toFixed(2)}/share</p>
            <p>Net Asset Value: $${netAssetValue.toFixed(2)}</p>
            ${listingDetails}
            ${isInsolvent ? '<p class="corp-status-warning">This corporation is closed after treasury insolvency. Properties returned to the Bank; shares, debt, and governance were wiped.</p>' : ''}
            <h4>Assets:</h4>
            <ul>
                ${assets.map(a => `<li>${escapeHtml(a.name)} ($${Number(a.value || 0).toFixed(2)})</li>`).join('') || '<li>No assets</li>'}
            </ul>
            <h4>Shareholders:</h4>
            <ul>
                ${shareholderRows}
            </ul>
            <h4>Debt:</h4>
            <ul>
                ${debtRows}
            </ul>
            ${governanceHtml}
            ${myShares ? `<p><strong>Your shares:</strong> ${myShares.shares}</p>` : ''}
            ${canOfferProperty ? `
                <div class="offer-property-for-shares">
                    <button class="btn btn-success" data-game-action="offer-property-for-shares" data-corp-id="${escapeHtml(corp.id)}">Offer a property for ${escapeHtml(corp.ticker)} shares</button>
                    <small>Put one of your properties into ${escapeHtml(corp.ticker)} in exchange for part of its ${Number(corp.totalShares || 0)} shares. ${escapeHtml(corp.chairmanName || 'The chairman')} has to accept.</small>
                </div>
            ` : ''}
            ${canBuy ? `
                <div class="buy-shares-form">
                    <label for="buyShares-${escapeHtml(corp.id)}">${buyLabel} (up to ${buyableShares})</label>
                    <input type="number" inputmode="numeric" id="buyShares-${escapeHtml(corp.id)}" min="1" max="${buyableShares}" value="1">
                    <button class="btn btn-primary" data-game-action="buy-shares" data-corp-id="${escapeHtml(corp.id)}">Buy</button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('');

    document.getElementById('corporationList').innerHTML = corporationsHtml || '<p class="empty-state">No corporations yet. Create an IPO on your turn to start one.</p>';
    openModal('corporationModal');
}

function renderChairmanGovernance(corp) {
    if (ShareDeals.isInsolvent(corp)) {
        return `
            <div class="chairman-governance">
                <h4>Chairman Governance</h4>
                <p class="empty-state">Governance closed after insolvency.</p>
            </div>
        `;
    }
    const myShares = ShareDeals.sharesHeld(corp, currentUser.id);
    const candidates = chairmanCandidateOptions(corp);
    const voteOptions = candidates.map(player =>
        `<option value="${escapeHtml(player.userId)}">${escapeHtml(player.name)}</option>`
    ).join('');
    const required = majorityThresholdUi(corp);
    const openVotes = (corp.chairmanVotes || []).filter(vote => vote.status === 'open');
    const openVotesHtml = openVotes.length
        ? openVotes.map(vote => {
            const supportedShares = voteSupportSharesUi(corp, vote);
            const alreadySupported = (vote.supporters || []).some(supporter => supporter.userId === currentUser.id);
            const canSupport = myShares > 0 && !alreadySupported;
            return `
                <div class="chairman-vote-row">
                    <div>
                        <strong>${escapeHtml(vote.candidateName)}</strong>
                        <span>${supportedShares}/${corp.totalShares} shares supporting, ${required} needed</span>
                    </div>
                    ${canSupport ? `<button class="btn btn-primary btn-sm" data-game-action="support-chairman-vote" data-corp-id="${escapeHtml(corp.id)}" data-vote-id="${escapeHtml(vote.id)}">Support</button>` : ''}
                </div>
            `;
        }).join('')
        : '<p class="empty-state">No open chairman votes</p>';

    return `
        <div class="chairman-governance">
            <h4>Chairman Governance</h4>
            <p>Changing chairman requires ${required}/${corp.totalShares} shares.</p>
            ${hasMajoritySharesUi(corp, currentUser.id) ? `
                <div class="governance-control">
                    <label>Majority change:</label>
                    <select id="chairmanMajority-${escapeHtml(corp.id)}">${voteOptions}</select>
                    <button class="btn btn-primary btn-sm" data-game-action="change-chairman-majority" data-corp-id="${escapeHtml(corp.id)}">Change Chairman</button>
                </div>
            ` : ''}
            ${myShares > 0 ? `
                <div class="governance-control">
                    <label>Propose vote:</label>
                    <select id="chairmanVoteCandidate-${escapeHtml(corp.id)}">${voteOptions}</select>
                    <button class="btn btn-secondary btn-sm" data-game-action="propose-chairman-vote" data-corp-id="${escapeHtml(corp.id)}">Propose</button>
                </div>
            ` : ''}
            <div>
                ${openVotesHtml}
            </div>
        </div>
    `;
}

function chairmanCandidateOptions(corp) {
    const players = currentGame.game_state.players || [];
    return players.filter(player =>
        player.userId === corp.chairmanId ||
        player.userId === corp.founderId ||
        ShareDeals.sharesHeld(corp, player.userId) > 0
    );
}

function majorityHolderName(corp) {
    const holder = (corp.shareholders || []).find(shareholder => hasMajoritySharesUi(corp, shareholder.userId));
    return holder ? holder.name : null;
}

function hasMajoritySharesUi(corp, userId) {
    return ShareDeals.sharesHeld(corp, userId) > Number(corp.totalShares || 0) / 2;
}

function majorityThresholdUi(corp) {
    return Math.floor(Number(corp.totalShares || 0) / 2) + 1;
}

function voteSupportSharesUi(corp, vote) {
    return (vote.supporters || []).reduce((sum, supporter) => sum + ShareDeals.sharesHeld(corp, supporter.userId), 0);
}

async function changeChairmanByMajority(corpId) {
    const candidateUserId = document.getElementById(`chairmanMajority-${corpId}`).value;
    await submitGameAction('change_chairman', { corpId, candidateUserId }, {
        errorText: 'Failed to change chairman',
        alwaysErrorText: true,
        onSaved: openCorporationModal,
    });
}

async function proposeChairmanVote(corpId) {
    const candidateUserId = document.getElementById(`chairmanVoteCandidate-${corpId}`).value;
    await submitGameAction('propose_chairman_vote', { corpId, candidateUserId }, {
        errorText: 'Failed to propose chairman vote',
        alwaysErrorText: true,
        onSaved: openCorporationModal,
    });
}

async function supportChairmanVote(corpId, voteId) {
    await submitGameAction('support_chairman_vote', { corpId, voteId }, {
        errorText: 'Failed to support chairman vote',
        alwaysErrorText: true,
        onSaved: openCorporationModal,
    });
}

async function buyShares(corpId) {
    const gameState = currentGame.game_state;
    const corp = gameState.corporations.find(c => c.id === corpId);
    if (!corp) return;
    if (ShareDeals.isInsolvent(corp)) {
        alert('This corporation is insolvent and cannot sell shares.');
        return;
    }

    const numShares = parseInt(document.getElementById(`buyShares-${corpId}`).value);
    const totalCost = numShares * Number(corp.pricePerShare || 0);
    const buyableShares = getBuyableListedShares(corp, currentUser.id);

    if (!numShares || numShares < 1 || numShares > buyableShares) {
        alert(`Enter a valid number of shares (1-${buyableShares})`);
        return;
    }

    if (currentPlayerData.cash < totalCost) {
        alert(`Insufficient funds. Cost: $${totalCost.toFixed(2)}, You have: $${currentPlayerData.cash.toFixed(2)}`);
        return;
    }

    await submitGameAction('buy_shares', { corpId, shares: numShares }, {
        errorText: 'Failed to buy shares',
        onSaved: () => closeModal('corporationModal'),
    });
}

// End turn
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
    try {
        if (await performGameAction('host_end_game', {})) {
            showWinnerFromState(currentGame.game_state, 'Host ended the game.');
        }
    } catch (error) {
        console.error('Error ending game:', error);
        alert('Failed to end game: ' + error.message);
    }
}

async function hostPauseGame() {
    if (!confirm('Pause the game for everyone? Players will not be able to take normal actions until the host resumes.')) return;
    await submitGameAction('host_pause_game', { reason: 'Host paused the game' }, {
        errorText: 'Failed to pause game.',
        showError: showToast,
        onSaved: () => showToast('Game paused.'),
    });
}

async function hostResumeGame() {
    if (!confirm('Resume the game for everyone?')) return;
    await submitGameAction('host_resume_game', {}, {
        errorText: 'Failed to resume game.',
        showError: showToast,
        onSaved: () => showToast('Game resumed.'),
    });
}

// Sends a game action from a button or form and tells the player if it failed.
// onSaved(result) runs only once the server saved the action: performGameAction
// returns null after a conflict, which it has already explained. On failure the
// player sees the server's message, or errorText when there is none; with
// alwaysErrorText they always see errorText. showError defaults to alert.
async function submitGameAction(type, payload, { errorText, alwaysErrorText = false, onSaved, showError = alert } = {}) {
    try {
        const result = await performGameAction(type, payload);
        if (result && onSaved) await onSaved(result);
        return result;
    } catch (error) {
        console.error(`Game action ${type} failed:`, error);
        showError(alwaysErrorText ? errorText : (error.message || errorText));
        return null;
    }
}

async function performGameAction(type, payload = {}) {
    if (gameActionInFlight) return null;

    gameActionInFlight = true;
    setGameActionUiBusy(true);

    try {
        // One actionId for every retry: the server applies an action once and
        // replays the saved result if the same id arrives again.
        const body = JSON.stringify({
            actionId: makeActionId(),
            type,
            payload,
            expectedVersion: currentGame.state_version
        });
        const result = await postGameActionWithRetry(body);
        try {
            const events = result.events || [];
            const sequenceWinnerAfterLiquidation = !!result.game?.game_state?.ended && hasLiquidationEvent(events);
            await applyGameUpdate(result.game, { force: true, suppressWinner: sequenceWinnerAfterLiquidation });
            const liquidationShown = showLiquidationSummaryFromEvents(events);
            if (sequenceWinnerAfterLiquidation && liquidationShown) {
                pendingWinnerStateAfterLiquidation = result.game.game_state;
            } else if (sequenceWinnerAfterLiquidation) {
                showWinnerFromState(result.game.game_state, winnerReasonFromState(result.game.game_state));
            }
        } catch (renderError) {
            // The action was saved; a display problem must not be reported as a failed move.
            console.error('Error showing game update:', renderError);
        }
        return result;
    } catch (error) {
        if (error.status === 409) {
            await refreshCurrentGame();
            alert('The game changed before your action was saved. Review the latest state and try again.');
            return null;
        }
        if (!error.status) {
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

function isRetryableActionError(error) {
    return !error.status || [502, 503, 504].includes(error.status);
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
    document.getElementById('winnerName').textContent = winner ? winner.name : 'Game Over';
    document.getElementById('winnerReason').textContent = reason || '';
    document.getElementById('finalStandings').innerHTML = standingsHtml;
    openModal('winnerModal');
}

function winnerReasonFromState(gameState) {
    return gameState?.gameLog?.length ? gameState.gameLog[gameState.gameLog.length - 1].message : 'Game over';
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

    const title = `${data.player || 'Player'} Bankruptcy Summary`;
    const summary = `${data.player || 'The player'} went bankrupt${data.creditor ? ` owing ${data.creditor}` : ''}. Direct properties were ${data.assetDestinationType === 'bank' ? 'returned to' : 'transferred to'} ${destination}.`;
    const rows = [
        ['Cause', reason],
        ['Properties', propertyNames.length ? `${propertyNames.join(', ')} to ${destination}; houses/hotels cleared` : 'No direct properties moved'],
        ['Shares', [returnedShares, transferredShares].filter(Boolean).join('; ') || 'No player-held shares moved'],
        ['Debts', 'Personal debts cleared'],
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
        if (transferred && item.to) return `${shares} ${ticker} share(s) to ${item.to}`;
        return `${shares} ${ticker} share(s) returned to availability`;
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

    updateTurnBanner();
}

function updateTurnBanner() {
    const banner = document.getElementById('turn-banner');
    if (!banner || !currentGame || !currentUser) return;
    const gameState = currentGame.game_state;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = !!currentPlayer && currentPlayer.userId === currentUser.id && !gameState.paused && !gameState.ended;
    const onGameTab = document.getElementById('game')?.classList.contains('active');
    banner.style.display = isMyTurn && !onGameTab ? 'flex' : 'none';

    const gameTab = document.querySelector('.nav-tab[data-section="game"]');
    if (gameTab) {
        let dot = gameTab.querySelector('.tab-dot');
        if (isMyTurn && !dot) {
            dot = document.createElement('span');
            dot.className = 'tab-dot';
            dot.setAttribute('aria-hidden', 'true');
            gameTab.appendChild(dot);
        } else if (!isMyTurn && dot) {
            dot.remove();
        }
    }
}

function switchToGameTab() {
    const gameTabBtn = document.querySelector('.nav-tab[data-section="game"]');
    if (gameTabBtn) gameTabBtn.click();
}

// Set up UI listeners for Market section
function setupUIListeners() {
    bindStaticGameControls();
    // Populate player dropdowns
    populatePlayerDropdowns();
    window.addEventListener('resize', scaleBoardToFit);
}

function bindStaticGameControls() {
    document.querySelector('.nav-tabs')?.addEventListener('click', (event) => {
        const tab = event.target.closest('.nav-tab[data-section]');
        if (tab) showSection(tab, tab.dataset.section);
    });

    document.addEventListener('click', (event) => {
        const closeButton = event.target.closest('[data-close-modal]');
        if (closeButton) {
            closeModal(closeButton.dataset.closeModal);
            return;
        }

        const playerSummary = event.target.closest('.player-card-summary');
        if (playerSummary) {
            togglePlayerCard(playerSummary);
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

    // A hairline appears under the app bar once content scrolls beneath it.
    const appBar = document.querySelector('.app-bar');
    if (appBar) {
        window.addEventListener('scroll', () => {
            appBar.classList.toggle('is-scrolled', window.scrollY > 4);
        }, { passive: true });
    }

    document.addEventListener('change', (event) => {
        if (event.target.closest('#player1Assets, #player2Assets, #player1Destination, #player2Destination')) {
            updateMarketActionState();
        }
    });
    document.addEventListener('input', (event) => {
        if (event.target.closest('#player1Assets .trade-share-input, #player2Assets .trade-share-input')) {
            updateTradeSharePercent(event.target);
            updateMarketActionState();
        }
    });

    document.getElementById('go-to-actions-btn')?.addEventListener('click', switchToGameTab);
    document.getElementById('executeTradeBtn')?.addEventListener('click', executeTransaction);
    document.getElementById('makePaymentBtn')?.addEventListener('click', makePayment);
    document.getElementById('confirm-purchase-btn')?.addEventListener('click', confirmPurchase);
    document.getElementById('start-auction-btn')?.addEventListener('click', startAuctionFromPurchase);
    document.getElementById('create-ipo-btn')?.addEventListener('click', createIPO);
    document.getElementById('debtAction')?.addEventListener('change', toggleDebtForm);
    document.getElementById('debtIssuer')?.addEventListener('change', renderDebtCollateralOptions);
    document.getElementById('debtToSettle')?.addEventListener('change', updateSettlementFullAmountState);
    document.getElementById('payFullDebtBtn')?.addEventListener('click', fillFullSettlementAmount);
    document.getElementById('debtsToRefinance')?.addEventListener('change', () => {
        renderRefinanceCollateralOptions();
        updateRefinanceSummary();
    });
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
    document.getElementById('share-move-device-btn')?.addEventListener('click', shareMoveDeviceLink);
}

// ---------------------------------------------------------------
// Play on another device: a one-time code signs the other browser in as
// this player. Hotseat games share one device, so they hide the button.
// ---------------------------------------------------------------
async function openMoveDeviceModal() {
    const codeEl = document.getElementById('moveDeviceCode');
    const linkEl = document.getElementById('moveDeviceLink');
    const expiryEl = document.getElementById('moveDeviceExpiry');
    codeEl.textContent = '…';
    linkEl.value = '';
    expiryEl.textContent = '';
    openModal('moveDeviceModal');
    try {
        const { code, expiresAt } = await requestDeviceTransferCode();
        const link = new URL('index.html', window.location.href);
        link.searchParams.set('transfer', code);
        codeEl.textContent = `${code.slice(0, 4)} ${code.slice(4)}`;
        linkEl.value = link.toString();
        const minutes = Math.max(1, Math.round((new Date(expiresAt) - Date.now()) / 60000));
        expiryEl.textContent = `Works once, for the next ${minutes} minutes. Anyone with this code can play as you, so only share it with yourself.`;
    } catch (error) {
        codeEl.textContent = '';
        expiryEl.textContent = error.message || 'Could not create a code. Try again.';
    }
}

// ---------------------------------------------------------------
// Turn alerts (push notifications). See src/js/turn-notifications.js.
// ---------------------------------------------------------------
const TURN_ALERT_HINT = "Get a buzz when it's your turn and the game isn't open.";

function turnAlertCopy(state) {
    const standalone = TurnNotifications.isStandalone();
    switch (state) {
        case 'needs-home-screen':
            return {
                hint: `${TURN_ALERT_HINT} On iPhone, that needs the game on your Home Screen.`,
                note: "Adding it puts a Mortgage icon next to your apps that opens this game full screen. It's a shortcut to the site, not an App Store app, so there's nothing to download.",
                actions: [['add-to-home-screen', 'Add to Home Screen', 'btn-primary'], ['close', 'Not now', 'btn-secondary']],
            };
        case 'off':
            return {
                hint: TURN_ALERT_HINT,
                actions: [['enable', 'Turn on alerts', 'btn-primary'], ['close', 'Not now', 'btn-secondary']],
            };
        case 'on':
            return {
                hint: "Alerts are on for this device. You'll get one when it's your turn and the game isn't open.",
                actions: [['test', 'Send a test alert', 'btn-secondary'], ['disable', 'Turn off alerts', 'btn-secondary'], ['close', 'Done', 'btn-secondary']],
            };
        case 'denied':
            return {
                hint: standalone
                    ? 'Notifications are off for Mortgage. Turn them on in Settings, Notifications, Mortgage, then come back here.'
                    : "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here.",
                actions: [['close', 'Done', 'btn-secondary']],
            };
        case 'unsupported':
            return {
                hint: "This browser can't show alerts. On iPhone, open the game in Safari and add it to your Home Screen. On Android, use Chrome.",
                actions: [['close', 'Done', 'btn-secondary']],
            };
        default:
            return {
                hint: "Alerts aren't available right now. Try again later.",
                actions: [['close', 'Done', 'btn-secondary']],
            };
    }
}

function setText(id, text) {
    const element = document.getElementById(id);
    element.textContent = text || '';
    element.hidden = !text;
}

async function renderTurnAlerts(statusMessage) {
    const actions = document.getElementById('turnAlertsActions');
    actions.innerHTML = '';
    setText('turnAlertsHint', 'Checking this device…');
    setText('turnAlertsNote', '');
    const state = await TurnNotifications.status().catch(() => 'unavailable');
    const copy = turnAlertCopy(state);
    setText('turnAlertsHint', copy.hint);
    setText('turnAlertsNote', copy.note);
    setText('turnAlertsStatus', statusMessage);
    actions.innerHTML = copy.actions.map(([action, label, style]) =>
        `<button class="btn ${style}" data-turn-alerts="${action}">${escapeHtml(label)}</button>`
    ).join('');
    document.getElementById('turn-alerts-btn')?.classList.toggle('is-on', state === 'on');
}

async function openTurnAlertsModal() {
    openModal('turnAlertsModal');
    await renderTurnAlerts();
}

async function refreshTurnAlertsButton() {
    if (isHotseatMode) return;
    const state = await TurnNotifications.status().catch(() => 'unavailable');
    document.getElementById('turn-alerts-btn')?.classList.toggle('is-on', state === 'on');
}

async function handleTurnAlertsAction(event) {
    const button = event.target.closest('[data-turn-alerts]');
    if (!button) return;
    const action = button.dataset.turnAlerts;
    if (action === 'close') {
        closeModal('turnAlertsModal');
        return;
    }
    button.disabled = true;
    try {
        switch (action) {
            case 'add-to-home-screen':
                await TurnNotifications.openAddToHomeScreen();
                return;
            case 'enable':
                await TurnNotifications.enable();
                await renderTurnAlerts('Alerts turned on.');
                return;
            case 'test': {
                const { sent } = await TurnNotifications.sendTest();
                await renderTurnAlerts(sent ? 'Test alert sent. It should arrive in a few seconds.' : "The test alert didn't reach this device. Turn alerts off and on again.");
                return;
            }
            case 'disable':
                await TurnNotifications.disable();
                await renderTurnAlerts('Alerts turned off for this device.');
                return;
        }
    } catch (error) {
        await renderTurnAlerts(error.message || "That didn't work. Try again.");
    }
}

async function shareMoveDeviceLink() {
    const link = document.getElementById('moveDeviceLink').value;
    if (!link) return;
    if (await copyText(link)) {
        showToast('Link copied');
        return;
    }
    const linkEl = document.getElementById('moveDeviceLink');
    linkEl.focus();
    linkEl.select();
    showToast('Select the link and copy it');
}

function populatePlayerDropdowns() {
    const gameState = currentGame.game_state;

    const player1Select = document.getElementById('player1Select');
    const player2Select = document.getElementById('player2Select');
    const paymentFromPlayer = document.getElementById('paymentFromPlayer');
    const paymentToPlayer = document.getElementById('paymentToPlayer');
    if (!player1Select || !player2Select || !paymentFromPlayer || !paymentToPlayer) return;

    const playersHtml = gameState.players.map(p =>
        `<option value="${escapeHtml(p.userId)}">${escapeHtml(p.name)}</option>`
    ).join('');

    const previous = {
        player1: player1Select.value,
        player2: player2Select.value,
        paymentFrom: paymentFromPlayer.value,
        paymentTo: paymentToPlayer.value,
    };
    const firstOtherId = getFirstOtherPlayerId(currentUser.id) || gameState.players[0]?.userId || '';

    player1Select.innerHTML = playersHtml;
    player2Select.innerHTML = playersHtml;
    paymentFromPlayer.innerHTML = playersHtml;
    paymentToPlayer.innerHTML = playersHtml;

    setSelectValue(player1Select, previous.player1 || currentUser.id, currentUser.id);
    setSelectValue(player2Select, previous.player2 || firstOtherId, firstOtherId || currentUser.id);
    setSelectValue(paymentFromPlayer, currentUser.id, currentUser.id);
    setSelectValue(paymentToPlayer, previous.paymentTo || firstOtherId, firstOtherId || currentUser.id);
    paymentFromPlayer.disabled = true;
    enforceDistinctPlayers(player1Select, player2Select);
    enforceDistinctPlayers(paymentFromPlayer, paymentToPlayer);

    if (!player1Select.dataset.assetsBound) {
        player1Select.addEventListener('change', () => {
            enforceDistinctPlayers(player1Select, player2Select);
            updatePlayerAssets('player1');
            updatePlayerAssets('player2');
            updateMarketActionState();
        });
        player1Select.dataset.assetsBound = 'true';
    }
    if (!player2Select.dataset.assetsBound) {
        player2Select.addEventListener('change', () => {
            enforceDistinctPlayers(player2Select, player1Select);
            updatePlayerAssets('player1');
            updatePlayerAssets('player2');
            updateMarketActionState();
        });
        player2Select.dataset.assetsBound = 'true';
    }
    if (!paymentToPlayer.dataset.paymentBound) {
        paymentToPlayer.addEventListener('change', () => {
            enforceDistinctPlayers(paymentFromPlayer, paymentToPlayer);
            updateMarketActionState();
        });
        paymentToPlayer.dataset.paymentBound = 'true';
    }
    ['player1Cash', 'player2Cash', 'paymentAmount'].forEach(id => {
        const input = document.getElementById(id);
        if (input && !input.dataset.marketBound) {
            input.addEventListener('input', updateMarketActionState);
            input.dataset.marketBound = 'true';
        }
    });

    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    renderTradeOffers();
    updateMarketActionState();
}

function setSelectValue(select, preferredValue, fallbackValue) {
    if (!select) return;
    const values = Array.from(select.options).map(option => option.value);
    if (values.includes(preferredValue)) {
        select.value = preferredValue;
    } else if (values.includes(fallbackValue)) {
        select.value = fallbackValue;
    } else if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

function getFirstOtherPlayerId(userId) {
    return currentGame?.game_state?.players?.find(player => player.userId !== userId)?.userId || null;
}

function enforceDistinctPlayers(primarySelect, secondarySelect) {
    if (!primarySelect || !secondarySelect || primarySelect.value !== secondarySelect.value) return;
    const replacement = Array.from(secondarySelect.options).find(option => option.value !== primarySelect.value);
    if (replacement) secondarySelect.value = replacement.value;
}

function updatePlayerAssets(playerNumber) {
    const gameState = currentGame.game_state;
    const selectId = playerNumber === 'player1' ? 'player1Select' : 'player2Select';
    const assetsId = playerNumber === 'player1' ? 'player1Assets' : 'player2Assets';

    const userId = document.getElementById(selectId).value;
    const player = gameState.players.find(p => p.userId === userId);

    if (!player) return;
    const container = document.getElementById(assetsId);
    // Game updates re-render this form; keep what the player already picked.
    const kept = container.dataset.playerId === userId ? {
        checked: new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value)),
        shares: new Map(Array.from(container.querySelectorAll('.trade-share-input')).map(input => [input.dataset.corpId, input.value])),
    } : null;

    const assetsHtml = player.properties.map(p => `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="${playerNumber}-asset-${escapeHtml(p.id)}">${tradeAssetDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span></label>
        </div>
    `).join('');
    const jailCardHtml = player.hasGetOutOfJailCard ? `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}" value="${GAME_JAIL_CARD_ASSET_ID}">
            <label for="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}">Get Out of Jail Free card</label>
        </div>
    ` : '';

    const sharesHtml = (player.corporations || [])
        .filter(corp => Number(corp.sharesOwned || 0) > 0 && !corp.insolvent)
        .map(corp => {
            const inputId = `${playerNumber}-shares-${escapeHtml(corp.id)}`;
            return `
                <div class="asset-checkbox asset-shares">
                    <input type="number" class="trade-share-input" id="${inputId}" data-corp-id="${escapeHtml(corp.id)}" data-total-shares="${Number(corp.totalShares)}" min="0" max="${Number(corp.sharesOwned)}" step="1" value="0">
                    <label for="${inputId}">${escapeHtml(corp.ticker)} shares (holds ${Number(corp.sharesOwned)} of ${Number(corp.totalShares)})</label>
                    <span class="trade-share-pct" aria-live="polite"></span>
                </div>
            `;
        }).join('');

    container.innerHTML = (assetsHtml + sharesHtml + jailCardHtml) || '<p class="empty-state">No properties or shares to offer</p>';
    container.dataset.playerId = userId;
    if (kept) {
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = kept.checked.has(input.value); });
        container.querySelectorAll('.trade-share-input').forEach(input => {
            if (kept.shares.has(input.dataset.corpId)) input.value = kept.shares.get(input.dataset.corpId);
        });
    }
    container.querySelectorAll('.trade-share-input').forEach(updateTradeSharePercent);
    renderTradeDestination(playerNumber);
}

// "= 25% of MBS" next to a share-count box.
function updateTradeSharePercent(input) {
    const label = input.parentElement?.querySelector('.trade-share-pct');
    if (!label) return;
    const shares = Math.floor(Number(input.value) || 0);
    label.textContent = shares > 0 ? `= ${ShareDeals.percent(shares, input.dataset.totalShares)}` : '';
}

function otherTradeSide(playerNumber) {
    return playerNumber === 'player1' ? 'player2' : 'player1';
}

// Lets a side put its properties into an LLC the other player runs, so a
// property can be traded for a stake in that LLC.
function renderTradeDestination(playerNumber) {
    const container = document.getElementById(`${playerNumber}Destination`);
    if (!container) return;
    const gameState = currentGame.game_state;
    const giver = gameState.players.find(p => p.userId === document.getElementById(`${playerNumber}Select`)?.value);
    const receiver = gameState.players.find(p => p.userId === document.getElementById(`${otherTradeSide(playerNumber)}Select`)?.value);
    const corps = giver && receiver && giver.userId !== receiver.userId && (giver.properties || []).length
        ? ShareDeals.corporationsRunBy(gameState, receiver.userId)
        : [];
    const previous = container.dataset.receiverId === receiver?.userId ? selectedTradeDestination(playerNumber) : null;
    container.dataset.receiverId = receiver?.userId || '';
    if (!corps.length) {
        container.innerHTML = '';
        return;
    }
    const giverName = giver.userId === currentUser.id ? 'your' : `${giver.name}'s`;
    const option = (value, title, detail) => `
        <label class="trade-destination-option">
            <input type="radio" name="${playerNumber}-destination" value="${escapeHtml(value)}"${value === (previous || '') ? ' checked' : ''}>
            <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
        </label>
    `;
    container.innerHTML = `
        <p class="trade-destination-title">Where should ${escapeHtml(giverName)} properties go?</p>
        ${option('', `To ${receiver.name}`, `${receiver.name} owns them outright.`)}
        ${corps.map(corp => option(corp.id, `Into ${corp.ticker} (${receiver.name} runs it)`, `${corp.ticker} owns them and collects the rent, so every ${corp.ticker} share is worth more. Ask for ${corp.ticker} shares in return.`)).join('')}
    `;
}

function selectedTradeDestination(playerNumber) {
    return document.querySelector(`#${playerNumber}Destination input:checked`)?.value || null;
}

// The Market form as propose_trade terms.
function collectTradeTerms() {
    const value = id => parseFloat(document.getElementById(id)?.value) || 0;
    const assets = assetsId => Array.from(document.querySelectorAll(`#${assetsId} input[type="checkbox"]:checked`)).map(cb => cb.value);
    return {
        player1Id: document.getElementById('player1Select')?.value,
        player2Id: document.getElementById('player2Select')?.value,
        player1Cash: value('player1Cash'),
        player2Cash: value('player2Cash'),
        player1AssetIds: assets('player1Assets'),
        player2AssetIds: assets('player2Assets'),
        player1Shares: selectedTradeShares('player1Assets'),
        player2Shares: selectedTradeShares('player2Assets'),
        player1PropertiesToCorpId: selectedTradeDestination('player1'),
        player2PropertiesToCorpId: selectedTradeDestination('player2'),
    };
}

function summarizeShareDeal(terms) {
    return ShareDeals.summarize(currentGame.game_state, terms, currentUser.id, {
        netAssetValue: getCorporationNetAssetValue,
        jailCardId: GAME_JAIL_CARD_ASSET_ID,
    });
}

function tradeInvolvesLLC(terms) {
    return (terms.player1Shares || []).length > 0 || (terms.player2Shares || []).length > 0
        || (!!terms.player1PropertiesToCorpId && (terms.player1AssetIds || []).length > 0)
        || (!!terms.player2PropertiesToCorpId && (terms.player2AssetIds || []).length > 0);
}

function renderShareDealSummary(summary, options = {}) {
    const rows = summary.rows.map(row => `
        <tr><td>${escapeHtml(row.label)}</td><td class="${escapeHtml(row.tone || '')}">${escapeHtml(row.value)}</td></tr>
    `).join('');
    const even = options.showEven && summary.evenShares ? `
        <p class="share-deal-even">An even trade is ${summary.evenShares.shares} of ${summary.evenShares.total} ${escapeHtml(summary.evenShares.ticker)} shares (${escapeHtml(ShareDeals.percent(summary.evenShares.shares, summary.evenShares.total))}).
        <button type="button" class="btn btn-secondary btn-sm" data-game-action="use-even-shares">Use ${summary.evenShares.shares}</button></p>
    ` : '';
    return `
        <div class="share-deal-summary">
            ${summary.sentences.map(sentence => `<p class="share-deal-sentence">${escapeHtml(sentence)}</p>`).join('')}
            ${rows ? `<table class="share-deal-table">${rows}</table>` : ''}
            ${summary.warnings.map(warning => `<p class="share-deal-warning">${escapeHtml(warning)}</p>`).join('')}
            ${even}
        </div>
    `;
}

function renderTradePreview() {
    const preview = document.getElementById('tradePreview');
    if (!preview || !currentGame) return;
    const terms = collectTradeTerms();
    if (!tradeInvolvesLLC(terms)) {
        preview.hidden = true;
        preview.innerHTML = '';
        preview.dataset.html = '';
        return;
    }
    preview.hidden = false;
    // Only re-render on a real change, so a click on "Use N" isn't swallowed
    // when the share box's blur fires a change event first.
    const html = `<h4>Your offer</h4>${renderShareDealSummary(summarizeShareDeal(terms), { showEven: true })}`;
    if (preview.dataset.html !== html) {
        preview.innerHTML = html;
        preview.dataset.html = html;
    }
}

// Fills the share box for the even split suggested in the preview.
function useEvenShares() {
    const terms = collectTradeTerms();
    const summary = summarizeShareDeal(terms);
    if (!summary.evenShares) return;
    const giverSide = terms.player1PropertiesToCorpId ? 'player2' : 'player1';
    const corpId = terms.player1PropertiesToCorpId || terms.player2PropertiesToCorpId;
    const input = document.querySelector(`#${giverSide}Assets .trade-share-input[data-corp-id="${CSS.escape(corpId)}"]`);
    if (!input) return;
    input.value = Math.min(summary.evenShares.shares, Number(input.max) || summary.evenShares.shares);
    updateTradeSharePercent(input);
    updateMarketActionState();
}

// From the Corporations modal: start a trade that puts one of your properties
// into this LLC in exchange for its shares.
function offerPropertyForShares(corpId) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === corpId);
    if (!corp || !corp.chairmanId) return;
    closeModal('corporationModal');
    const marketTab = document.querySelector('.nav-tab[data-section="market"]');
    if (marketTab) showSection(marketTab, 'market');
    document.getElementById('player1Select').value = currentUser.id;
    document.getElementById('player2Select').value = corp.chairmanId;
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    const radio = document.querySelector(`#player1Destination input[value="${CSS.escape(corp.id)}"]`);
    if (radio) radio.checked = true;
    updateMarketActionState();
    const shareInput = document.querySelector(`#player2Assets .trade-share-input[data-corp-id="${CSS.escape(corp.id)}"]`);
    showMarketStatus(`Tick the property you're offering, then enter how many ${corp.ticker} shares you want back.`, 'info');
    document.querySelector('#market .transaction-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    shareInput?.focus({ preventScroll: true });
}

// Share lots entered in a trade side, as [{ corpId, shares }].
function selectedTradeShares(assetsId) {
    return Array.from(document.querySelectorAll(`#${assetsId} .trade-share-input`))
        .map(input => ({ corpId: input.dataset.corpId, shares: Math.floor(Number(input.value) || 0) }))
        .filter(lot => lot.shares > 0);
}

function updateMarketActionState() {
    const tradeBtn = document.getElementById('executeTradeBtn');
    const paymentBtn = document.getElementById('makePaymentBtn');
    const player1Id = document.getElementById('player1Select')?.value;
    const player2Id = document.getElementById('player2Select')?.value;
    const fromPlayerId = document.getElementById('paymentFromPlayer')?.value;
    const toPlayerId = document.getElementById('paymentToPlayer')?.value;
    const player1Cash = parseFloat(document.getElementById('player1Cash')?.value) || 0;
    const player2Cash = parseFloat(document.getElementById('player2Cash')?.value) || 0;
    const paymentAmount = parseFloat(document.getElementById('paymentAmount')?.value) || 0;
    const player1Assets = document.querySelectorAll('#player1Assets input:checked').length + selectedTradeShares('player1Assets').length;
    const player2Assets = document.querySelectorAll('#player2Assets input:checked').length + selectedTradeShares('player2Assets').length;

    const tradeHasOffer = player1Cash > 0 || player2Cash > 0 || player1Assets > 0 || player2Assets > 0;
    const tradeValid = player1Id && player2Id && player1Id !== player2Id && [player1Id, player2Id].includes(currentUser.id) && tradeHasOffer;
    const paymentValid = fromPlayerId && toPlayerId && fromPlayerId !== toPlayerId && fromPlayerId === currentUser.id && paymentAmount > 0;

    if (tradeBtn) tradeBtn.disabled = !tradeValid;
    if (paymentBtn) paymentBtn.disabled = !paymentValid;
    renderTradePreview();
}

function showMarketStatus(message, type = 'info') {
    const el = document.getElementById('market-status');
    if (!el) {
        showToast(message);
        return;
    }
    el.textContent = message;
    el.className = `market-status ${type}`;
}

function renderTradeOffers() {
    const container = document.getElementById('tradeOffersList');
    if (!container || !currentGame) return;
    const offers = (currentGame.game_state.marketOffers || []).filter(offer => offer.status === 'pending');
    if (offers.length === 0) {
        container.innerHTML = '<p class="empty-state">No pending trade offers</p>';
        return;
    }

    container.innerHTML = offers.map(offer => {
        const participant = [offer.player1Id, offer.player2Id].includes(currentUser.id);
        const expired = isTradeOfferExpiredForDisplay(offer);
        const canAccept = !expired && participant && offer.proposedById !== currentUser.id;
        const canCancel = participant;
        const isHost = isRoomHost();
        const canHostCancel = isHost && !canCancel;
        const canClearExpired = expired && (participant || isHost);
        const hasActions = canAccept || canCancel || canHostCancel;
        return `
            <div class="trade-offer-card${expired ? ' trade-offer-expired' : ''}">
                <div class="trade-offer-header">
                    <strong>${escapeHtml(offer.proposedByName)} proposed a trade</strong>
                    <div class="trade-offer-meta">
                        <span>${escapeHtml(formatTradeOfferAge(offer.createdAt))}</span>
                        ${offer.expiresAt ? `<span>${escapeHtml(formatTradeOfferExpiry(offer.expiresAt))}</span>` : ''}
                    </div>
                </div>
                ${tradeInvolvesLLC(offer) ? renderShareDealSummary(summarizeShareDeal(offer)) : ''}
                <div class="trade-offer-sides">
                    <div>
                        <h4>${escapeHtml(offer.player1Name)} gives</h4>
                        ${renderTradeOfferSide(offer.player1Cash, offer.player1AssetIds, offer.player1Shares, offer.player1PropertiesToCorpId)}
                    </div>
                    <div>
                        <h4>${escapeHtml(offer.player2Name)} gives</h4>
                        ${renderTradeOfferSide(offer.player2Cash, offer.player2AssetIds, offer.player2Shares, offer.player2PropertiesToCorpId)}
                    </div>
                </div>
                ${hasActions ? `
                    <div class="trade-offer-actions">
                        ${canAccept ? `<button class="btn btn-success btn-sm" data-game-action="accept-trade-offer" data-offer-id="${escapeHtml(offer.id)}">Accept</button>` : ''}
                        ${canCancel ? `<button class="btn btn-secondary btn-sm" data-game-action="cancel-trade-offer" data-offer-id="${escapeHtml(offer.id)}">${expired ? 'Clear Expired' : (canAccept ? 'Decline' : 'Cancel')}</button>` : ''}
                        ${canHostCancel ? `<button class="btn btn-danger btn-sm" data-game-action="host-cancel-trade-offer" data-offer-id="${escapeHtml(offer.id)}">${expired ? 'Clear Expired' : 'Host Cancel'}</button>` : ''}
                    </div>
                ` : `<p class="empty-state">${canClearExpired ? 'Clear this expired offer from the involved player view.' : 'Waiting on the involved players'}</p>`}
            </div>
        `;
    }).join('');
}

function renderTradeOfferSide(cash, assetIds, shareLots, intoCorpId) {
    const intoCorp = intoCorpId ? currentGame?.game_state?.corporations?.find(corp => corp.id === intoCorpId) : null;
    const tags = [];
    if (Number(cash || 0) > 0) {
        tags.push(renderTradeAssetTag(formatMoney(cash), 'Cash', 'cash'));
    }
    sortTradeAssetIds(assetIds).forEach(id => {
        const property = tradeAssetProperty(id);
        if (!property) {
            tags.push(renderTradeAssetTag(tradeAssetName(id), id === GAME_JAIL_CARD_ASSET_ID ? 'Card' : '', 'card'));
            return;
        }
        const group = intoCorp ? `Into ${intoCorp.ticker}` : (property.color || 'Property');
        tags.push(renderTradeAssetTag(property.name, group, 'property', getPropertyColorValue(property.color)));
    });
    (shareLots || []).forEach(lot => {
        tags.push(renderTradeAssetTag(tradeSharesName(lot), 'LLC shares', 'shares'));
    });
    if (tags.length === 0) return '<p class="empty-state">Nothing</p>';
    return `<ul class="trade-asset-list">${tags.join('')}</ul>`;
}

function renderTradeAssetTag(name, groupLabel, kind, color) {
    const style = color ? ` style="--property-color:${escapeHtml(color)};"` : '';
    return `
        <li class="trade-asset-tag ${kind}"${style}>
            <span class="trade-asset-name">${escapeHtml(name)}</span>
            ${groupLabel ? `<span class="trade-asset-group">${escapeHtml(groupLabel)}</span>` : ''}
        </li>
    `;
}

// Board order keeps each color group together in an offer.
function sortTradeAssetIds(assetIds) {
    return [...(assetIds || [])].sort((a, b) => getPropertyBoardPosition(a) - getPropertyBoardPosition(b));
}

function tradeAssetProperty(assetId) {
    return currentGame?.game_state?.properties?.find(prop => prop.id === assetId) || null;
}

function tradeAssetName(assetId) {
    if (assetId === GAME_JAIL_CARD_ASSET_ID) return 'Get Out of Jail Free card';
    const property = tradeAssetProperty(assetId);
    return property ? property.name : assetId;
}

function tradeSharesName(lot) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === lot.corpId);
    const shares = Number(lot.shares || 0);
    return `${shares} ${corp ? corp.ticker : 'LLC'} share${shares === 1 ? '' : 's'}`;
}

function tradeAssetDot(assetId) {
    const property = tradeAssetProperty(assetId);
    if (!property) return '';
    return `<span class="trade-asset-dot" style="--property-color:${escapeHtml(getPropertyColorValue(property.color))};" aria-hidden="true"></span>`;
}

function formatTradeOfferAge(createdAt) {
    if (!createdAt) return 'pending';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 'pending';
    return `sent ${formatTimeAgo(createdAt)}`;
}

function formatTradeOfferExpiry(expiresAt) {
    const seconds = secondsUntil(expiresAt);
    if (seconds === null) return '';
    if (seconds <= 0) return 'expired';
    if (seconds < 60) return `expires in ${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    return `expires in ${minutes}m`;
}

function isTradeOfferExpiredForDisplay(offer) {
    return secondsUntil(offer?.expiresAt) === 0;
}

function actionEventsInclude(result, type) {
    return Array.isArray(result?.events) && result.events.some(event => event.type === type);
}

function showMarketError(message) {
    showMarketStatus(message, 'error');
}

async function acceptTradeOffer(offerId) {
    await submitGameAction('accept_trade', { offerId }, {
        errorText: 'Failed to accept trade offer.',
        showError: showMarketError,
        onSaved: result => {
            if (actionEventsInclude(result, 'trade_offer_expired')) {
                showMarketStatus('Trade offer expired before it could be accepted.', 'error');
            } else {
                showMarketStatus('Trade accepted and executed.', 'success');
            }
        },
    });
}

async function cancelTradeOffer(offerId) {
    await submitGameAction('cancel_trade', { offerId }, {
        errorText: 'Failed to update trade offer.',
        showError: showMarketError,
        onSaved: result => showMarketStatus(actionEventsInclude(result, 'trade_offer_expired')
            ? 'Trade offer expired and was cleared.'
            : 'Trade offer updated.', 'success'),
    });
}

async function hostCancelTradeOffer(offerId) {
    if (!confirm('Cancel this trade offer as host? No cash or properties will move.')) return;
    await submitGameAction('host_cancel_trade_offer', { offerId }, {
        errorText: 'Failed to cancel trade offer.',
        showError: showMarketError,
        onSaved: result => showMarketStatus(actionEventsInclude(result, 'trade_offer_expired')
            ? 'Trade offer expired and was cleared.'
            : 'Trade offer canceled by host.', 'success'),
    });
}

async function executeTransaction() {
    const terms = collectTradeTerms();
    const { player1Id, player2Id, player1Cash, player2Cash } = terms;
    const player1Assets = terms.player1AssetIds;
    const player2Assets = terms.player2AssetIds;
    const player1Shares = terms.player1Shares;
    const player2Shares = terms.player2Shares;

    if (player1Id === player2Id) {
        showMarketStatus('Choose two different players for a trade.', 'error');
        return;
    }
    if (![player1Id, player2Id].includes(currentUser.id)) {
        showMarketStatus('Your trade must include you.', 'error');
        return;
    }
    if (player1Cash <= 0 && player2Cash <= 0 && player1Assets.length === 0 && player2Assets.length === 0
        && player1Shares.length === 0 && player2Shares.length === 0) {
        showMarketStatus('Add cash, property, shares, or a Get Out of Jail Free card before proposing a trade.', 'error');
        return;
    }

    await submitGameAction('propose_trade', terms, {
        errorText: 'Failed to execute transaction.',
        showError: showMarketError,
        onSaved: () => {
            showMarketStatus('Trade proposal sent. It will execute when the other player accepts.', 'success');
            resetTradeForm();
        },
    });
}

function resetTradeForm() {
    document.getElementById('player1Cash').value = 0;
    document.getElementById('player2Cash').value = 0;
    ['player1', 'player2'].forEach(side => {
        document.getElementById(`${side}Assets`).dataset.playerId = '';
        document.getElementById(`${side}Destination`).dataset.receiverId = '';
    });
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    updateMarketActionState();
}

async function makePayment() {
    const fromPlayerId = document.getElementById('paymentFromPlayer').value;
    const toPlayerId = document.getElementById('paymentToPlayer').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);

    if (!amount || amount <= 0) {
        showMarketStatus('Enter a payment amount greater than $0.', 'error');
        return;
    }
    if (fromPlayerId === toPlayerId) {
        showMarketStatus('Choose a different recipient.', 'error');
        return;
    }
    if (fromPlayerId !== currentUser.id) {
        showMarketStatus('Payments must be sent from your player.', 'error');
        return;
    }

    await submitGameAction('manual_payment', { fromPlayerId, toPlayerId, amount }, {
        errorText: 'Failed to make payment.',
        showError: showMarketError,
        onSaved: () => {
            showMarketStatus('Payment completed successfully.', 'success');
            document.getElementById('paymentAmount').value = '';
            updateMarketActionState();
        },
    });
}

// ============================================================
// BOARD TAB FUNCTIONS
// ============================================================

// Render / refresh the Board tab content
function renderBoardTab() {
    const el = document.getElementById('boardContent');
    if (!el || !currentGame || !currentUser) return;
    el.innerHTML = renderBoard(currentGame.game_state, currentUser.id);
    scaleBoardToFit();
}

// ---------------------------------------------------------------
// Dice rolling and movement
// ---------------------------------------------------------------
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

