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
let previousDiceSignature = null;

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
                ${isSpectator ? renderSpectatorNote() : (paused ? renderPausedActions(gameState) : (isMyTurn ? renderActionButtons(landing) : renderNonTurnActions()))}
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

function getPlayerColor(player) {
    const index = currentGame?.game_state?.players?.findIndex(p => p.userId === player?.userId) ?? -1;
    return PLAYER_COLORS[Math.max(index, 0) % PLAYER_COLORS.length];
}

function renderTurnTicket(gameState, currentPlayer, landing, isMyTurn, paused) {
    const { hasRolled, hasMoved, rollAgain } = getRollState(gameState, currentPlayer);
    const dice = hasMoved ? gameState.lastDiceRoll : null;
    const diceSignature = `${gameState.currentPlayerIndex}|${hasRolled}|${Array.isArray(dice) ? dice.join(',') : ''}`;
    const rolling = !!dice && previousDiceSignature !== null && previousDiceSignature !== diceSignature;
    previousDiceSignature = diceSignature;

    const me = currentPlayerData || currentPlayer;
    const myNetWorth = getPlayerNetWorth(me);
    const visibleTitle = gameState.ended ? 'Game over' : (isMyTurn ? 'Your turn' : `${currentPlayer.name}'s turn`);
    let status;
    if (gameState.ended) status = 'Final standings are in the Game Over summary';
    else if (paused) status = 'Paused by the host';
    else if (rollAgain) status = `Doubles! Now on ${BOARD_SQUARES[currentPlayer.position || 0]?.name || 'the board'}, ${isMyTurn ? 'roll again' : 'rolling again'}`;
    else if (currentPlayer.inJail && !hasRolled) status = isMyTurn ? 'In Jail. Roll doubles, pay $50, or use a card.' : 'In Jail, deciding how to get out';
    else if (!hasRolled) status = isMyTurn ? 'Roll to move' : 'About to roll';
    else status = `Rolled ${dice ? dice[0] + dice[1] : ''}, now on ${BOARD_SQUARES[currentPlayer.position || 0]?.name || 'the board'}`;

    return `
        <section class="game-header turn-ticket${isMyTurn ? ' is-mine' : ''}${paused ? ' is-paused' : ''}" style="--turn-color:${escapeHtml(getPlayerColor(currentPlayer))}">
            <div class="ticket-top">
                <span class="avatar" style="--token-color:${escapeHtml(getPlayerColor(currentPlayer))}" aria-hidden="true">${escapeHtml(playerInitials(currentPlayer.name))}</span>
                <div class="ticket-heading">
                    <h2 class="ticket-title"><span class="sr-only">Current Turn: ${escapeHtml(currentPlayer.name)}</span><span aria-hidden="true">${escapeHtml(visibleTitle)}</span></h2>
                    <span class="ticket-status ${isMyTurn && !paused ? 'turn-indicator' : 'waiting-indicator'}">${escapeHtml(status)}</span>
                </div>
                ${renderDicePair(dice, { rolling })}
            </div>
            <div class="ticket-money">
                <div>
                    <span class="ticket-money-label">Your cash</span>
                    <strong class="ticket-cash${Number(me.cash) < 0 ? ' is-negative' : ''}">${formatMoney(me.cash)}</strong>
                </div>
                <div class="ticket-side">
                    Net worth
                    <strong>${formatMoney(Math.round(myNetWorth))}</strong>
                </div>
            </div>
            ${renderTurnChecklist(gameState, currentPlayer, landing, isMyTurn)}
        </section>
    `;
}

function renderLandingSummary(landing, currentPlayer, isMyTurn) {
    const square = BOARD_SQUARES[currentPlayer.position || 0] || {};
    const who = isMyTurn ? 'You are on' : `${currentPlayer.name} is on`;
    return `
        <div class="landing-summary ${landing.canBuy ? 'can-buy' : ''}" style="--square-color:${escapeHtml(square.color || 'var(--rule-strong)')}">
            <span class="landing-deed" aria-hidden="true"></span>
            <div class="landing-copy">
                <span class="landing-label">${escapeHtml(who)}</span>
                <strong>${escapeHtml(landing.squareName)}</strong>
                <p>${escapeHtml(landing.detail)}</p>
            </div>
            ${landing.canBuy && landing.price ? `<span class="landing-price">${formatMoney(landing.price)}</span>` : ''}
        </div>
    `;
}

function getPlayerNetWorth(player) {
    if (!player) return 0;
    const ownedProperties = getOwnedPropertyDetails(player);
    const totalPropertyValue = ownedProperties.reduce((sum, p) => sum + propertyAssetValue(p), 0);
    return Number(player.cash || 0) + totalPropertyValue + getPlayerCorporationValue(player) - getDebtTotal(player.debts);
}

function renderPauseBanner(gameState) {
    if (!gameState?.paused) return '';
    const pause = gameState.pause || {};
    const pausedBy = pause.pausedByName || 'Host';
    const reason = pause.reason || 'Host paused the game';
    const time = pause.pausedAt ? `Paused ${formatTimeAgo(pause.pausedAt)}.` : '';
    return `
        <div class="pause-panel" id="pausePanel">
            <div>
                <span class="pause-label">Game Paused</span>
                <strong>${escapeHtml(reason)}</strong>
            </div>
            <p>${escapeHtml(`${pausedBy} paused the session. ${time}`.trim())}</p>
        </div>
    `;
}

function renderCashWarning(currentPlayer, isMyTurn) {
    if (!currentPlayer || currentPlayer.bankrupt) return '';
    const outlook = TurnEndOutlook.forPlayer(currentGame.game_state, currentPlayer);
    const { claim, unpaid, loanPayments, maturing, cash, cashAfter } = outlook;
    const shortfall = formatMoney(outlook.shortfall);
    const loanNote = loanPayments > 0 ? `, then ${formatMoney(loanPayments)} in loan payments` : '';
    let message;
    let tone = 'danger';

    if (claim) {
        const owed = formatMoney(unpaid);
        const creditor = claim.creditorName || 'the creditor';
        if (outlook.settlesClaim) {
            tone = '';
            message = isMyTurn
                ? `You owe ${owed} to ${creditor}. End Turn pays it from your cash${loanNote}, leaving you ${formatMoney(cashAfter)}.`
                : `${currentPlayer.name} owes ${owed} to ${creditor}. It will be paid from their cash when they end the turn.`;
        } else if (!outlook.creditorActive) {
            message = isMyTurn
                ? `You have ${owed} unpaid to ${creditor}, who is out of the game, so End Turn will declare bankruptcy.`
                : `${currentPlayer.name} has ${owed} unpaid to ${creditor}, who is out of the game.`;
        } else {
            message = isMyTurn
                ? `You have ${owed} unpaid to ${creditor}. Raise ${shortfall} more before ending your turn or End Turn will declare bankruptcy.`
                : `${currentPlayer.name} has ${owed} unpaid to ${creditor} and must raise ${shortfall} more before ending the turn.`;
        }
    } else if (cash < 0) {
        message = isMyTurn
            ? `You are ${formatMoney(-cash)} below zero. Raise ${shortfall} before ending your turn or End Turn will declare bankruptcy.`
            : `${currentPlayer.name} is ${formatMoney(-cash)} below zero and must recover before ending the turn.`;
    } else if (cashAfter < 0) {
        message = isMyTurn
            ? `${formatMoney(maturing)} of loans come due when you end your turn. Raise ${shortfall} more or End Turn will declare bankruptcy.`
            : `${currentPlayer.name} has ${formatMoney(maturing)} of loans coming due and must raise ${shortfall} before ending the turn.`;
    } else if (maturing > 0 && isMyTurn) {
        tone = '';
        message = `End Turn repays ${formatMoney(maturing)} of loans that come due, leaving you ${formatMoney(cashAfter)}.`;
    } else {
        return '';
    }
    return `<div class="turn-warning${tone ? ` ${tone}` : ''}">${escapeHtml(message)}</div>`;
}

function renderAuctionPanel(gameState) {
    const auction = gameState.auction;
    if (!auction || auction.status !== 'open') return '';
    const property = gameState.properties.find(prop => prop.id === auction.propertyId);
    const currentBid = Number(auction.currentBid || 0);
    const passed = (auction.passedPlayerIds || []).includes(currentUser.id);
    const isHighBidder = auction.highBidderId === currentUser.id;
    const currentPlayer = gameState.players.find(player => player.userId === currentUser.id);
    const canAct = currentPlayer && !currentPlayer.bankrupt && !passed && !isHighBidder;
    const isHost = isRoomHost();
    const minBid = currentBid + 1;
    const status = auction.highBidderName
        ? `High bid: $${currentBid.toFixed(2)} by ${auction.highBidderName}`
        : 'No bids yet';
    const expiryText = formatAuctionExpiry(auction.expiresAt);
    const actionState = passed
        ? '<p class="auction-note">You passed on this auction.</p>'
        : (isHighBidder
            ? '<p class="auction-note">You are the current high bidder.</p>'
            : '');

    return `
        <div class="auction-panel" id="auctionPanel">
            <div class="auction-header">
                <div>
                    <span class="auction-label">Property Auction</span>
                    <h3>${propertyDot(auction.propertyId)}${escapeHtml(auction.propertyName || property?.name || 'Property')}</h3>
                </div>
                <strong>${escapeHtml(status)}</strong>
            </div>
            <p>${escapeHtml(auction.startedByName || 'A player')} started this auction. Resolve it before the turn can continue.</p>
            ${expiryText ? `<p class="auction-note">${escapeHtml(expiryText)}</p>` : ''}
            ${actionState}
            ${canAct ? `
                <div class="auction-actions">
                    <input type="number" id="auctionBidAmount" min="${minBid}" step="1" value="${minBid}" aria-label="Auction bid amount">
                    <button class="btn btn-success btn-sm" data-game-action="place-auction-bid">Bid</button>
                    <button class="btn btn-secondary btn-sm" data-game-action="pass-auction">Pass</button>
                </div>
            ` : ''}
            ${isHost ? `
                <div class="auction-host-actions">
                    <button class="btn btn-danger btn-sm" data-game-action="host-cancel-auction">Cancel Auction</button>
                </div>
            ` : ''}
        </div>
    `;
}

// Whole seconds until an ISO time (0 once it has passed), or null if unset or invalid.
function secondsUntil(isoTime) {
    if (!isoTime) return null;
    const time = new Date(isoTime).getTime();
    if (Number.isNaN(time)) return null;
    return Math.max(Math.ceil((time - Date.now()) / 1000), 0);
}

function formatAuctionExpiry(expiresAt) {
    const seconds = secondsUntil(expiresAt);
    if (seconds === null) return '';
    if (seconds <= 0) return 'Auction timeout reached. The next action will resolve it.';
    return `Timeout if idle for ${seconds}s more.`;
}

function renderTurnChecklist(gameState, currentPlayer, landing, isMyTurn) {
    const { hasRolled, hasMoved, rollAgain } = getRollState(gameState, currentPlayer);
    const ended = !!gameState.ended;
    const waitingForJailChoice = currentPlayer.inJail && !hasRolled;
    const items = [
        {
            label: waitingForJailChoice ? 'Jail' : 'Roll',
            state: hasMoved && !(rollAgain && !landing.canBuy) ? 'complete' : (isMyTurn ? 'current' : 'upcoming'),
            detail: hasMoved
                ? `${formatDiceLabel(gameState.lastDiceRoll)}${rollAgain ? ', roll again' : ''}`
                : (waitingForJailChoice ? 'Roll doubles, pay fine, or use card' : 'Waiting for dice'),
        },
        {
            label: 'Resolve',
            state: !hasMoved ? 'upcoming' : (landing.canBuy || gameState.auction?.status === 'open' ? 'current' : 'complete'),
            detail: landing.canBuy ? 'Property available' : landing.squareName,
        },
        {
            label: 'Actions',
            state: hasRolled && !ended ? 'current' : 'upcoming',
            detail: 'Assets, debt, market',
        },
        {
            label: 'End',
            state: ended ? 'complete' : (hasRolled && isMyTurn ? 'current' : 'upcoming'),
            detail: 'Interest and next player',
        },
    ];

    let currentSeen = false;
    items.forEach(item => {
        if (item.state !== 'current') return;
        if (currentSeen) item.state = 'upcoming';
        currentSeen = true;
    });

    return `
        <div class="turn-checklist" aria-label="Turn progress">
            ${items.map(item => `
                <div class="turn-step ${item.state}"${item.state === 'current' ? ' aria-current="step"' : ''}>
                    <span>${escapeHtml(item.label)}</span>
                    <strong>${escapeHtml(item.detail)}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function formatDiceLabel(dice) {
    if (!Array.isArray(dice) || dice.length < 2) return 'Rolled';
    return `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}`;
}

// diceRolled means the move is finished. After doubles it stays false so the player
// can roll again, but they have still landed: lastDiceRoll is set for this turn.
function getRollState(gameState, player) {
    const hasRolled = !!player.diceRolled;
    const hasMoved = hasRolled || Array.isArray(gameState.lastDiceRoll);
    return { hasRolled, hasMoved, rollAgain: hasMoved && !hasRolled };
}

function getLandingSummary(gameState, player) {
    const position = player.position || 0;
    const square = BOARD_SQUARES[position] || BOARD_SQUARES[0];
    const property = square.propertyId
        ? gameState.properties.find(prop => prop.id === square.propertyId)
        : null;
    const isBuyableSquare = ['property', 'railroad', 'utility'].includes(square.type);
    const unowned = !!(isBuyableSquare && property && !property.ownerId);
    const canBuy = unowned && getRollState(gameState, player).hasMoved;

    if (unowned && !canBuy) {
        return {
            squareName: square.name,
            detail: `Unowned ${square.type.replace('_', ' ')}. You can only buy where you land, so roll first.`,
            canBuy,
        };
    }

    if (canBuy) {
        return {
            squareName: square.name,
            detail: `Unowned ${square.type.replace('_', ' ')}. Buy it or send it to auction.`,
            canBuy,
            price: property.price,
        };
    }

    if (isBuyableSquare && property && property.ownerId) {
        const ownerName = describeOwner(gameState, property.ownerId, property.ownerName).label;
        return {
            squareName: square.name,
            detail: property.ownerId === player.userId ? 'You already own this square.' : `Owned by ${ownerName}.${corporationRentNote(gameState, property.ownerId, player.userId)}`,
            canBuy: false,
        };
    }

    const detailsByType = {
        go: 'Collect salary when you pass GO.',
        community_chest: 'Community Chest effect is applied automatically.',
        chance: 'Chance effect is applied automatically.',
        tax: `Tax square. Amount: $${square.taxAmount || 0}.`,
        jail: player.inJail ? 'You are in Jail.' : 'Just visiting.',
        free_parking: 'Free Parking.',
        go_to_jail: 'Go directly to Jail.',
    };

    return {
        squareName: square.name,
        detail: detailsByType[square.type] || 'No purchasable property on this square.',
        canBuy: false,
    };
}

// " MBS is in Payout: your 30% stake cut the rent to 70%." for a company square.
function corporationRentNote(gameState, ownerId, userId) {
    const corp = (gameState.corporations || []).find(c => c.id === ownerId);
    if (!corp || ShareDeals.isInsolvent(corp)) return '';
    if (corp.rentPolicy !== 'payout') return ` ${corp.ticker} is reinvesting: rent goes into its treasury.`;
    const mine = ShareDeals.sharesHeld(corp, userId);
    if (mine <= 0) return ` ${corp.ticker} is in Payout: rent goes to its shareholders.`;
    const total = Number(corp.totalShares || 0);
    return ` ${corp.ticker} is in Payout: your ${ShareDeals.percent(mine, total)} stake cuts the rent to ${ShareDeals.percent(total - mine, total)}.`;
}

function renderLastCardSummary(gameState, player) {
    const lastCard = normalizeLastCardDrawn(gameState.lastCardDrawn);
    if (!lastCard || lastCard.playerId !== player.userId) return '';
    return `
        <div class="card-effect-summary">
            <span>${escapeHtml(deckDisplayName(lastCard.deckType))}</span>
            <strong>${escapeHtml(lastCard.card)}</strong>
            <p>${escapeHtml(lastCard.effect ? `Applied: ${lastCard.effect}.` : 'Card effect was applied automatically.')}</p>
        </div>
    `;
}

function normalizeLastCardDrawn(card) {
    if (!card) return null;
    if (card.card || card.playerId || card.effect) return card;
    return { card: card.text || 'Card drawn', deckType: 'card', playerId: null, effect: null };
}

function deckDisplayName(deckType) {
    if (deckType === 'chance') return 'Chance';
    if (deckType === 'community_chest') return 'Community Chest';
    return 'Card';
}

const PROPERTY_GROUP_SIZES = {
    'Brown': 2,
    'Light Blue': 3,
    'Pink': 3,
    'Orange': 3,
    'Red': 3,
    'Yellow': 3,
    'Green': 3,
    'Dark Blue': 2,
    'Railroad': 4,
    'Utility': 2,
};

function getOwnedPropertyDetails(player) {
    const allProperties = currentGame?.game_state?.properties || [];
    const playerProperties = Array.isArray(player.properties) ? player.properties : [];
    const ownedFromState = allProperties.filter(prop => prop.ownerId === player.userId);

    const properties = ownedFromState.length || !playerProperties.length
        ? ownedFromState
        : playerProperties.map(prop => {
            const fullProperty = allProperties.find(item => item.id === prop.id) || {};
            return { ...fullProperty, ...prop, ownerId: player.userId, ownerName: player.name };
        });

    return properties
        .map(prop => ({
            ...prop,
            houses: Number(prop.houses || 0),
            price: Number(prop.price ?? prop.value ?? 0),
        }))
        .sort((a, b) => getPropertyBoardPosition(a.id) - getPropertyBoardPosition(b.id));
}

function getPropertyBoardPosition(propertyId) {
    const square = BOARD_SQUARES.find(item => item.propertyId === propertyId);
    return square ? square.position : 999;
}

function propertyAssetValue(property) {
    if (property.value != null && Number.isFinite(Number(property.value))) {
        return Number(property.value);
    }
    return Number(property.price || 0) + Number(property.houses || 0) * (HOUSE_COSTS[property.color] || 0);
}

function getPropertyColorValue(color) {
    if (PROP_COLORS[color]) return PROP_COLORS[color];
    if (color && !color.includes(' ')) return color;
    return '#64748b';
}

// Small swatch in the property's board color, shown before its name wherever properties are listed.
function propertyDot(propertyId) {
    const property = currentGame?.game_state?.properties?.find(prop => prop.id === propertyId);
    if (!property) return '';
    return `<span class="property-dot" style="--property-color:${escapeHtml(getPropertyColorValue(property.color))};" aria-hidden="true"></span>`;
}

function getReadableTextColor(colorValue) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(colorValue || '');
    if (!match) return '#ffffff';
    const r = parseInt(match[1], 16);
    const g = parseInt(match[2], 16);
    const b = parseInt(match[3], 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) > 150 ? '#1f2933' : '#ffffff';
}

function getPropertyKind(property) {
    if (property.color === 'Railroad') return 'Railroad';
    if (property.color === 'Utility') return 'Utility';
    return 'Street';
}

function getPropertyTypeLabel(property) {
    const kind = getPropertyKind(property);
    if (kind !== 'Street') return kind;
    return `${property.color || 'Property'} street`;
}

function getPropertyIconHtml(property) {
    const kind = getPropertyKind(property).toLowerCase();
    const icon = kind === 'railroad' ? 'RR' : (kind === 'utility' ? '&#9889;' : '');
    return `<span class="owned-property-icon type-${kind}" aria-hidden="true">${icon}</span>`;
}

function getPropertyGroupStatus(property, allProperties, ownedProperties, ownerId) {
    const color = property.color || 'Property';
    const fullGroup = allProperties.filter(prop => prop.color === color);
    const total = fullGroup.length || PROPERTY_GROUP_SIZES[color] || 1;
    const owned = fullGroup.length
        ? fullGroup.filter(prop => prop.ownerId === ownerId).length
        : ownedProperties.filter(prop => prop.color === color).length;
    const complete = total > 0 && owned === total;
    const kind = getPropertyKind(property);
    const label = complete
        ? (kind === 'Street' ? 'Monopoly' : 'Complete set')
        : `${owned}/${total} set`;
    return { owned, total, complete, label };
}

function getPropertyDevelopmentLabel(property) {
    const houses = Number(property.houses || 0);
    if (getPropertyKind(property) !== 'Street') return 'No buildings';
    if (houses === 5) return 'Hotel';
    if (houses > 0) return `${houses} house${houses === 1 ? '' : 's'}`;
    return 'No houses';
}

function renderDevelopmentIcons(property) {
    const houses = Number(property.houses || 0);
    if (getPropertyKind(property) !== 'Street') {
        return '<span class="building-na" aria-hidden="true"></span>';
    }
    if (houses === 5) {
        return '<span class="hotel-pip" aria-hidden="true"></span>';
    }
    if (houses > 0) {
        return Array.from({ length: houses }, () => '<span class="house-pip" aria-hidden="true"></span>').join('');
    }
    return '<span class="empty-house-pip" aria-hidden="true"></span>';
}

function getPropertyRentLabel(property, allProperties, ownedProperties, ownerId) {
    const groupStatus = getPropertyGroupStatus(property, allProperties, ownedProperties, ownerId);
    const rent = Array.isArray(property.rent) ? property.rent : [];
    if (property.color === 'Utility') {
        return `Rent ${groupStatus.complete ? '10x' : '4x'} dice`;
    }
    if (property.color === 'Railroad') {
        return `Rent $${Number(rent[Math.max(0, groupStatus.owned - 1)] || rent[0] || 0)}`;
    }

    const houses = Number(property.houses || 0);
    const baseRent = Number(rent[0] || 0);
    const currentRent = houses > 0
        ? Number(rent[houses] || baseRent)
        : (groupStatus.complete ? baseRent * 2 : baseRent);
    return `Rent $${currentRent}`;
}

function renderOwnedProperties(player, ownedProperties) {
    if (!ownedProperties.length) return '';
    const allProperties = currentGame?.game_state?.properties || [];
    const totalValue = ownedProperties.reduce((sum, prop) => sum + propertyAssetValue(prop), 0);

    return `
        <div>
            <div class="player-section-heading">
                <h4>Properties</h4>
                <span>${ownedProperties.length} owned, worth ${formatMoney(Math.round(totalValue))}</span>
            </div>
            <div class="owned-property-list">
                ${ownedProperties.map(property => {
                    const color = getPropertyColorValue(property.color);
                    const ink = getReadableTextColor(color);
                    const groupStatus = getPropertyGroupStatus(property, allProperties, ownedProperties, player.userId);
                    const typeLabel = getPropertyTypeLabel(property);
                    const developmentLabel = getPropertyDevelopmentLabel(property);
                    const rentLabel = getPropertyRentLabel(property, allProperties, ownedProperties, player.userId);
                    const groupClass = groupStatus.complete ? 'complete' : 'partial';

                    return `
                        <div class="owned-property-row" style="--property-color:${escapeHtml(color)};--property-ink:${escapeHtml(ink)};">
                            ${getPropertyIconHtml(property)}
                            <div class="owned-property-copy">
                                <div class="owned-property-title">
                                    <strong>${escapeHtml(property.name)}</strong>
                                </div>
                                <div class="owned-property-meta">
                                    <span>${escapeHtml(typeLabel)}</span>
                                    <span>Value ${formatMoney(propertyAssetValue(property))}</span>
                                </div>
                                <div class="owned-property-chips">
                                    <span class="owned-property-chip set-chip ${groupClass}">${escapeHtml(groupStatus.label)}</span>
                                    <span class="owned-property-chip">
                                        <span class="development-icons">${renderDevelopmentIcons(property)}</span>
                                        ${escapeHtml(developmentLabel)}
                                    </span>
                                    <span class="owned-property-chip rent-chip">${escapeHtml(rentLabel)}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// Render individual player card
function renderPlayerCard(player, isCurrentUser) {
    const ownedProperties = getOwnedPropertyDetails(player);
    const netWorth = getPlayerNetWorth(player);
    const cashFlow = getEntityCashFlow(player.userId);
    const bankruptBadge = player.bankrupt ? '<span class="badge badge-danger">Bankrupt</span>' : '';
    const jailBadge = player.inJail && !player.bankrupt ? '<span class="badge badge-gold">In Jail</span>' : '';
    const jailCardBadge = player.hasGetOutOfJailCard ? '<span class="badge badge-gold">Get Out of Jail Free card</span>' : '';
    const gameState = currentGame?.game_state;
    const isTurnPlayer = gameState && gameState.players[gameState.currentPlayerIndex]?.userId === player.userId;
    const cardClass = [player.bankrupt ? 'bankrupt' : '', isTurnPlayer ? 'is-turn-player' : ''].join(' ').trim();
    const hasCashFlow = cashFlow.paid || cashFlow.received || cashFlow.receivedBetweenTurns;

    const cardDetails = `
        <div class="player-stats">
            <div class="stat">
                <span class="stat-label">Cash</span>
                <span class="stat-value${Number(player.cash) < 0 ? ' is-negative' : ''}">${formatMoney(player.cash)}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Properties</span>
                <span class="stat-value">${ownedProperties.length}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Net worth</span>
                <span class="stat-value">${formatMoney(Math.round(netWorth))}</span>
            </div>
        </div>
        ${hasCashFlow ? `
            <div class="cash-flow-summary">
                <div><span>Paid this turn</span><strong>${formatMoney(cashFlow.paid)}</strong></div>
                <div><span>Received this turn</span><strong>${formatMoney(cashFlow.received)}</strong></div>
                <div><span>Received between turns</span><strong>${formatMoney(cashFlow.receivedBetweenTurns)}</strong></div>
            </div>
        ` : ''}
        ${ownedProperties.length > 0 ? renderOwnedProperties(player, ownedProperties) : ''}
        ${player.corporations.length > 0 ? `
            <div class="player-corporations">
                <h4>Corporations</h4>
                ${player.corporations.map(c => `
                    <div class="corp-badge">
                        ${escapeHtml(c.ticker)}: ${ShareDeals.count(c.sharesOwned)} of ${ShareDeals.count(c.totalShares)} shares (${ownershipPercent(c.sharesOwned, c.totalShares)}%)
                        <span class="corp-assets-owned">NAV: ${ShareDeals.perShare(getPlayerCorporationShareValue(c))}/share</span>
                        ${c.insolvent ? '<span class="badge badge-danger">Insolvent</span>' : ''}
                        ${renderCorporationAssetSummary(c.id)}
                    </div>
                `).join('')}
            </div>
        ` : ''}
        ${player.debts.length > 0 ? `
            <div class="player-debts">
                <h4>Debts</h4>
                ${player.debts.map(d => `
                    <div class="debt-badge">
                        ${formatMoney(d.principal)} · ${escapeHtml(LoanMath.loanStatus(d, { dueThisTurn: isPlayersTurn(player) }).turnsLabel)}
                        <span>${escapeHtml(loanPaymentNote(d, isPlayersTurn(player)))}</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;

    if (isCurrentUser) {
        return `
            <div class="player-card current-user ${cardClass}">
                <div class="player-header">
                    <span class="avatar" style="--token-color:${escapeHtml(getPlayerColor(player))}" aria-hidden="true">${escapeHtml(playerInitials(player.name))}</span>
                    <h3>${escapeHtml(player.name)}</h3>
                    <span class="badge">You</span>
                    ${bankruptBadge}${jailBadge}${jailCardBadge}
                </div>
                ${cardDetails}
            </div>
        `;
    }

    const square = BOARD_SQUARES[player.position || 0];
    return `
        <div class="player-card player-card-other collapsed ${cardClass}" data-player-id="${player.userId}">
            <div class="player-card-summary" role="button" tabindex="0" aria-expanded="false">
                <span class="avatar" style="--token-color:${escapeHtml(getPlayerColor(player))}" aria-hidden="true">${escapeHtml(playerInitials(player.name))}</span>
                <span class="player-name-sm">${escapeHtml(player.name)}<small>${player.bankrupt ? 'Bankrupt' : (player.inJail ? 'In Jail' : escapeHtml(square ? square.name : ''))}</small></span>
                <span class="player-stat-sm">${formatMoney(player.cash)}</span>
                <svg class="player-card-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>
            </div>
            <div class="player-card-details" style="display:none;">
                <div class="player-header">
                    <h3>${escapeHtml(player.name)}</h3>
                    ${bankruptBadge}${jailBadge}${jailCardBadge}
                </div>
                ${cardDetails}
            </div>
        </div>
    `;
}

function getDebtTotal(debts) {
    return (debts || []).reduce((sum, debt) => sum + Number(debt.principal || 0), 0);
}

// One line on what a loan does at the borrower's next End Turn.
function loanPaymentNote(debt, dueThisTurn = false) {
    const status = LoanMath.loanStatus(debt, { dueThisTurn });
    if (status.dueInFull) return `${formatMoney(status.nextPayment)} due in full ${status.dueThisTurn ? 'at End Turn' : 'next turn'}`;
    return status.autopay
        ? `Autopay ${formatMoney(status.nextPayment)} next turn at ${Number(debt.interestRate || 0)}%`
        : `Autopay off: ${formatMoney(status.interestNext)} interest added next turn`;
}

function getPlayerCorporationValue(player) {
    return (player.corporations || []).reduce((sum, corp) => {
        return sum + Number(corp.sharesOwned || 0) * getPlayerCorporationShareValue(corp);
    }, 0);
}

function getPlayerCorporationShareValue(playerCorp) {
    if (Number.isFinite(Number(playerCorp.shareValue))) return Number(playerCorp.shareValue);
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === playerCorp.id);
    return corp ? getCorporationShareValue(corp) : 0;
}

function getCorporationAssetValue(corp) {
    const properties = currentGame?.game_state?.properties || [];
    const assetIds = new Set((corp.assets || []).map(asset => asset.id));
    const propertyValue = properties
        .filter(prop => prop.ownerId === corp.id)
        .reduce((sum, prop) => {
            assetIds.delete(prop.id);
            return sum + Number(prop.price || 0) + Number(prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0);
        }, 0);
    const fallbackAssetValue = (corp.assets || [])
        .filter(asset => assetIds.has(asset.id))
        .reduce((sum, asset) => sum + Number(asset.value || 0), 0);
    return propertyValue + fallbackAssetValue;
}

function getCorporationNetAssetValue(corp) {
    if (ShareDeals.isInsolvent(corp)) return 0;
    return getCorporationAssetValue(corp) + Number(corp.cash || 0) - getDebtTotal(corp.debts);
}

function getCorporationShareValue(corp) {
    const totalShares = Number(corp.totalShares || 0);
    if (totalShares <= 0) return 0;
    return Math.max(0, getCorporationNetAssetValue(corp)) / totalShares;
}

function getEntityCashFlow(entityId) {
    const flow = currentGame?.game_state?.turnCashFlow?.[entityId] || {};
    return {
        paid: Number(flow.paid || 0),
        received: Number(flow.received || 0),
        receivedBetweenTurns: Number(flow.receivedBetweenTurns || 0),
    };
}

function ownershipPercent(sharesOwned, totalShares) {
    const total = Number(totalShares || 0);
    if (!total) return '0.0';
    return ((Number(sharesOwned || 0) / total) * 100).toFixed(1);
}

function renderCorporationAssetSummary(corpId) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === corpId);
    if (!corp || !Array.isArray(corp.assets) || corp.assets.length === 0) return '';
    const assets = corp.assets
        .map(asset => `${propertyDot(asset.id)}${escapeHtml(asset.name)}`)
        .join(', ');
    return `<span class="corp-assets-owned">Assets: ${assets}</span>`;
}

function getListedShares(corp) {
    return Math.max(0, Number(corp.availableShares || 0));
}

function getTreasuryListedShares(corp) {
    return Math.min(Math.max(0, Number(corp.treasuryShares || 0)), getListedShares(corp));
}

// Only an LLC's own treasury shares sell at its price; shares a player holds
// change hands only through a trade offer they accept.
function getBuyableListedShares(corp) {
    return getTreasuryListedShares(corp);
}

function togglePlayerCard(summaryEl) {
    const details = summaryEl.nextElementSibling;
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    summaryEl.setAttribute('aria-expanded', String(!isOpen));
    summaryEl.closest('.player-card').classList.toggle('collapsed', isOpen);
}

function renderImprovePropertiesButton(gameState, player, auctionOpen) {
    const ownGroups = getCompleteGroupProperties(player.userId, gameState);
    const corpGroups = ShareDeals.corporationsRunBy(gameState, player.userId)
        .flatMap(corp => getCompleteGroupProperties(corp.id, gameState));
    const completeGroupProperties = [...ownGroups, ...corpGroups];
    if (!completeGroupProperties.length) return '';

    const hasAvailableImprovement = completeGroupProperties.some(prop => Number(prop.houses || 0) < 5);
    if (!hasAvailableImprovement) {
        return '<button class="btn btn-secondary btn-sm" disabled title="All complete color groups already have hotels">Hotels Built<small>Every set is maxed out</small></button>';
    }

    if (auctionOpen) {
        return '<button class="btn btn-secondary btn-sm" disabled title="Resolve auction before buying houses or hotels">Build Houses<small>After the auction</small></button>';
    }

    const hint = ownGroups.length ? 'You own a full set' : 'Your company owns a full set';
    return `<button class="btn btn-success btn-sm is-featured" data-game-action="open-house">Build Houses<small>${hint}</small></button>`;
}

// Your turn: the dock holds the move the game needs next; optional moves sit in the grid.
// landing is getLandingSummary() for the current player.
function renderActionButtons(landing) {
    const gameState = currentGame.game_state;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const { hasRolled, rollAgain } = getRollState(gameState, currentPlayer);
    const turnEnd = TurnEndOutlook.forPlayer(gameState, currentPlayer);
    const owesMoney = turnEnd.goesBankrupt;
    const endTurnLabel = owesMoney
        ? 'Declare Bankruptcy'
        : (turnEnd.settlesClaim ? `Pay ${formatMoney(turnEnd.unpaid)} & End Turn` : 'End Turn');
    const auctionOpen = gameState.auction?.status === 'open';
    const waitingForJailChoice = currentPlayer.inJail && !hasRolled;
    const rollButtonLabel = waitingForJailChoice ? 'Roll for Doubles' : (rollAgain ? 'Roll Again' : 'Roll Dice');
    const buyInDock = landing.canBuy && !auctionOpen;

    const jailChoiceButtons = waitingForJailChoice ? `
        <div class="dock-row dock-row-choices">
            <button class="btn btn-warning btn-sm" data-game-action="pay-jail-fine">Pay $50 Fine</button>
            ${currentPlayer.hasGetOutOfJailCard ? '<button class="btn btn-secondary btn-sm" data-game-action="use-jail-card">Use Jail Card</button>' : ''}
        </div>
    ` : '';
    const endTurnClass = owesMoney ? 'btn-danger' : (hasRolled && !buyInDock ? 'btn-success' : 'btn-secondary');
    const endTurnDisabled = !hasRolled || auctionOpen
        ? `disabled title="${auctionOpen ? 'Resolve auction before ending your turn' : 'Roll before ending your turn'}"`
        : '';
    // After doubles on an unowned property, Buy takes the primary slot and Roll Again
    // takes End Turn's, which stays unavailable until the final roll anyway.
    const rollAgainButton = rollAgain && buyInDock
        ? `<button class="btn btn-secondary" data-game-action="roll-dice">${rollButtonLabel}</button>`
        : '';
    const endTurnButton = rollAgainButton || `<button class="btn ${endTurnClass} action-btn-end-turn" data-game-action="end-turn" ${endTurnDisabled}>${escapeHtml(auctionOpen ? 'Resolve Auction' : endTurnLabel)}</button>`;
    const primaryButton = buyInDock
        ? `<button class="btn btn-success action-btn-buy" data-game-action="open-buy-property">Buy for ${formatMoney(landing.price)}</button>`
        : (!hasRolled && !auctionOpen ? `<button class="btn btn-primary" data-game-action="roll-dice">${rollButtonLabel}</button>` : '');

    const buyTile = buyInDock || (!hasRolled && !auctionOpen) ? '' : (auctionOpen
        ? '<button class="btn btn-secondary btn-sm action-btn-buy" disabled>Auction Open<small>Bid in the panel above</small></button>'
        : `<button class="btn btn-secondary btn-sm action-btn-buy" disabled title="${escapeHtml(landing.detail)}">${escapeHtml(buyUnavailableLabel(landing))}<small>${escapeHtml(landing.squareName)}</small></button>`);

    return `
        <div class="action-buttons turn-dock">
            <div class="dock-inner">
                ${jailChoiceButtons}
                <div class="dock-row">
                    ${endTurnButton}
                    ${primaryButton}
                </div>
            </div>
        </div>
        ${renderMovesGrid(`
            ${renderImprovePropertiesButton(gameState, currentPlayer, auctionOpen)}
            <button class="btn btn-secondary btn-sm" data-game-action="open-ipo" ${auctionOpen ? 'disabled' : ''}>Create IPO<small>Take properties public</small></button>
            <button class="btn btn-secondary btn-sm" data-game-action="open-debt" ${auctionOpen ? 'disabled' : ''}>Manage Debt<small>Borrow, repay, refinance</small></button>
            ${renderCorporationsButton()}
            ${buyTile}
        `)}
    `;
}

function renderMovesGrid(buttonsHtml) {
    return `
        <section class="moves">
            <div class="section-heading"><h3>Moves</h3></div>
            <div class="action-btn-secondary-group moves-grid">${buttonsHtml}</div>
        </section>
    `;
}

function buyUnavailableLabel(landing) {
    if (landing.detail.startsWith('Owned by')) return 'Property Owned';
    if (landing.detail.startsWith('You already own')) return 'Already Yours';
    return 'No Property to Buy';
}

// Flags property offers waiting for this player (as offerer or chairman).
function renderCorporationsButton() {
    const waiting = CorporationDesk.offersAwaiting(currentUser.id).length;
    const hint = waiting ? `${waiting} waiting for your answer` : 'Shares and chairmen';
    return `<button class="btn btn-secondary btn-sm${waiting ? ' is-featured' : ''}" data-game-action="open-corporation">Corporations<small>${hint}</small></button>`;
}

function renderNonTurnActions() {
    const loansButton = getManagedLoans().length
        ? '<button class="btn btn-secondary btn-sm" data-game-action="open-debt">Your Loans<small>Balances and autopay</small></button>'
        : '';
    return renderMovesGrid(`
        ${loansButton}
        ${renderCorporationsButton()}
        <button class="btn btn-secondary btn-sm" data-switch-section="market">Trade or pay<small>Opens the market</small></button>
    `);
}

function renderSpectatorNote() {
    return `
        <section class="moves">
            <div class="section-heading"><h3>Watching</h3></div>
            <p class="empty-state">You're hosting this game without a seat. The players move on their own; host controls are below.</p>
        </section>
    `;
}

function renderPausedActions() {
    return renderMovesGrid(`
        ${renderCorporationsButton()}
    `);
}

// Host-only controls, kept away from turn actions so End Game is never a slip of the thumb.
function renderHostPanel(gameState) {
    const isHost = isRoomHost();
    if (!isHost || gameState.ended) return '';
    const paused = !!gameState.paused;
    return `
        <section class="host-panel" aria-label="Host controls">
            <h3>Host controls</h3>
            <p>Only you can see these. They affect every player.</p>
            <div class="host-actions">
                ${paused
                    ? '<button class="btn btn-success btn-sm" data-game-action="host-resume">Resume Game</button>'
                    : '<button class="btn btn-warning btn-sm" data-game-action="host-pause">Pause Game</button>'}
                <button class="btn btn-danger btn-sm" data-game-action="host-end">End Game</button>
            </div>
        </section>
    `;
}

// Format a game event into a human-readable string
function formatLogEvent(type, data) {
    switch (type) {
        case 'property_purchase':
            if (data.actor) return `${data.actor} bought ${data.property} for ${data.buyer} for $${Number(data.price).toFixed(2)}`;
            return `${data.buyer} purchased ${data.property} for $${Number(data.price).toFixed(2)}`;
        case 'rent_policy_changed': {
            const label = data.policy === 'payout' ? 'Payout: rent goes to its shareholders' : 'Reinvest: rent stays in its treasury';
            return data.method === 'unanimous'
                ? `Every ${data.ticker} shareholder agreed: ${data.ticker} switched to ${label}`
                : `${data.actor} switched ${data.ticker} to ${label} (locked for their next ${data.lockedTurns || 5} turns)`;
        }
        case 'rent_policy_vote_proposed':
            return `${data.actor} asked every ${data.ticker} shareholder to switch it to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'rent_policy_vote_supported':
            return `${data.actor} agreed to switch ${data.ticker} to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'rent_policy_vote_rejected':
            return `${data.actor} rejected switching ${data.ticker} to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'dividend_paid':
            return `${data.ticker} paid a $${Number(data.amount).toFixed(2)} dividend: ${formatPayouts(data.payouts)}`;
        case 'rent_distributed':
            return `${data.ticker} passed ${data.payer}'s rent to its shareholders: ${formatPayouts(data.payouts)}`;
        case 'property_offer_made':
            return `${data.offerer} offered ${(data.properties || []).join(', ')} to ${data.ticker} for $${Number(data.price).toFixed(2)} in ${data.payWith === 'cash' ? 'treasury cash' : 'new shares'}`;
        case 'property_offer_countered':
            return `${data.actor} countered: ${(data.properties || []).join(', ')} to ${data.ticker} for $${Number(data.price).toFixed(2)}`;
        case 'property_offer_accepted':
            return `${data.ticker} took ${(data.properties || []).join(', ')} from ${data.offerer} for ${Number(data.newShares) > 0 ? `${ShareDeals.count(data.newShares)} new shares` : `$${Number(data.price).toFixed(2)}`}`;
        case 'property_offer_closed':
            return `The offer of ${(data.properties || []).join(', ')} to ${data.ticker} was ${data.status === 'expired' ? 'left to expire' : data.status}`;
        case 'ipo_created':
            return `${data.founder} created IPO ${data.ticker}: ${ShareDeals.count(data.founderShares || data.shares)} shares held by ${data.founder}`;
        case 'corporation_assets_added': {
            const names = Array.isArray(data.properties) ? data.properties.join(', ') : 'property';
            const shares = Number(data.newShares || 0);
            return `${data.actor} put ${names} into ${data.ticker}${shares ? ` for ${ShareDeals.count(shares)} new share${shares === 1 ? '' : 's'} (${data.ticker} now has ${ShareDeals.count(data.totalShares)})` : ''}`;
        }
        case 'share_purchase': {
            const founderShares = Number(data.founderShares || 0);
            const treasuryShares = Number(data.treasuryShares || 0);
            const parts = [];
            if (founderShares > 0) parts.push(`${founderShares} from founder`);
            if (treasuryShares > 0) parts.push(`${treasuryShares} from treasury`);
            const source = parts.length ? ` (${parts.join(', ')})` : '';
            return `${data.buyer} bought ${data.shares} share(s) of ${data.ticker}${source} for $${Number(data.totalCost).toFixed(2)}`;
        }
        case 'chairman_changed':
            if (data.method === 'bankruptcy') return `${data.ticker} chairman changed to ${data.chairman} after bankruptcy`;
            return `${data.ticker} chairman changed to ${data.chairman} by ${data.method === 'vote' ? `${data.supportedShares} supporting shares` : 'majority control'}`;
        case 'chairman_vacated':
            return `${data.ticker} chairman seat is vacant after ${data.formerChairman}'s bankruptcy`;
        case 'chairman_vote_proposed':
            return `${data.ticker} chairman vote proposed for ${data.candidate}`;
        case 'chairman_vote_supported':
            return `${data.supporter} supported ${data.candidate} for ${data.ticker} chairman`;
        case 'debt_issued':
            return `${data.actor ? `${data.actor} borrowed for ${data.issuer}` : `${data.issuer} borrowed`} $${Number(data.amount).toFixed(2)}${data.termTurns ? ` over ${data.termTurns} turns` : ''} at ${data.interestRate}% per turn`;
        case 'debt_payment':
            return data.paidOff
                ? `${data.payer} paid off a loan ($${Number(data.amount).toFixed(2)})`
                : `${data.payer} paid $${Number(data.amount).toFixed(2)} towards a loan`;
        case 'debt_refinanced':
            return `${data.borrower} refinanced ${data.refinancedDebtCount} debt(s) into $${Number(data.amount).toFixed(2)}${data.termTurns ? ` over ${data.termTurns} turns` : ''} at ${data.interestRate}% per turn and received $${Number(data.netProceeds || 0).toFixed(2)} net cash`;
        case 'debt_autopay':
            return `${data.borrower} turned autopay ${data.autopay ? 'on' : 'off'} for a loan`;
        case 'loan_matured':
            return data.repaid
                ? `${data.borrower} repaid a loan in full at maturity ($${Number(data.amount).toFixed(2)})`
                : `${data.borrower} couldn't repay a $${Number(data.amount).toFixed(2)} loan that came due`;
        case 'interest_accrual':
            return data.paid !== undefined
                ? `${data.player} paid $${Number(data.paid).toFixed(2)} on loans (interest this turn: $${Number(data.interestCharged).toFixed(2)})`
                : `${data.player} was charged $${Number(data.interestCharged).toFixed(2)} in interest`;
        case 'corporation_insolvent': {
            const propertyCount = Array.isArray(data.releasedProperties) ? data.releasedProperties.length : 0;
            const sharePositions = Array.isArray(data.wipedSharePositions) ? data.wipedSharePositions.length : 0;
            const debtCount = Array.isArray(data.clearedDebts) ? data.clearedDebts.length : 0;
            return `${data.ticker} became insolvent; ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} returned to the Bank, ${sharePositions} shareholder position(s) wiped, ${debtCount} debt(s) cleared`;
        }
        case 'game_paused':
            return `${data.actor || 'Host'} paused the game${data.reason ? `: ${data.reason}` : ''}`;
        case 'game_resumed':
            return `${data.actor || 'Host'} resumed the game`;
        case 'forced_payment':
            if (Number(data.unpaidAmount || 0) > 0) {
                return `${data.from} owed $${Number(data.amountOwed || 0).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}; paid $${Number(data.amount || 0).toFixed(2)}, $${Number(data.unpaidAmount || 0).toFixed(2)} unpaid`;
            }
            if (data.fullRent) {
                return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to} for ${data.reason} (full rent $${Number(data.fullRent).toFixed(2)}, less their ${data.ownPercent}% stake)`;
            }
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}`;
        case 'jail_fine_paid':
            return `${data.player} paid $${Number(data.amount).toFixed(2)} to leave Jail`;
        case 'jail_card_used':
            return `${data.player} used a Get Out of Jail Free card`;
        case 'tax_payment':
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}`;
        case 'bankruptcy_claim_payment':
            return `${data.player} paid $${Number(data.amount).toFixed(2)} toward ${data.reason} owed to ${data.creditor}`;
        case 'bankruptcy_claim_settled':
            return `${data.player} settled ${data.reason} owed to ${data.creditor}`;
        case 'bankruptcy':
            return `${data.player} has gone BANKRUPT${data.creditor ? ` owing ${data.creditor}` : ''}`;
        case 'bankruptcy_liquidation': {
            const propertyCount = Array.isArray(data.releasedProperties) ? data.releasedProperties.length : 0;
            const shares = (data.returnedSharePositions || []).reduce((sum, item) => sum + Number(item.shares || 0), 0);
            const transferredShares = (data.transferredSharePositions || []).reduce((sum, item) => sum + Number(item.shares || 0), 0);
            const destination = data.assetDestinationName || 'the Bank';
            return `${data.player} liquidation: ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} to ${destination}, ${shares} share(s) returned, ${transferredShares} share(s) transferred`;
        }
        case 'turn_end':
            return `${data.player} ended their turn — it's now ${data.nextPlayer}'s turn`;
        case 'trade_offer_proposed':
            return `${data.proposer} proposed a trade with ${data.recipient}`;
        case 'trade_offer_accepted':
            return `${data.accepter} accepted ${data.proposer}'s trade offer`;
        case 'trade_offer_canceled':
            return `${data.actor} ${data.status === 'declined' ? 'declined' : 'canceled'} a trade offer`;
        case 'transaction':
            return `Trade: ${data.player1} ↔ ${data.player2} ($${data.player1Cash} + ${data.player1Assets} assets ↔ $${data.player2Cash} + ${data.player2Assets} assets)`;
        case 'payment':
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}`;
        case 'game_started':
            return 'Game started';
        case 'game_ended':
            return `Game over — ${data.reason}`;
        case 'house_purchase':
            return `${data.player} bought houses/hotels for $${Number(data.cost).toFixed(2)}`;
        case 'property_auction_started':
            return `${data.startedBy} started an auction for ${data.property}`;
        case 'property_auction_bid':
            return `${data.bidder} bid $${Number(data.amount).toFixed(2)} for ${data.property}`;
        case 'property_auction_passed':
            return `${data.player} passed on ${data.property}`;
        case 'property_auction_won':
            return `${data.winner} won ${data.property} at auction for $${Number(data.amount).toFixed(2)}${data.reason === 'timeout' ? ' after timeout' : ''}`;
        case 'property_auction_no_sale':
            return `Auction ended with no sale for ${data.property}${data.reason === 'timeout' ? ' after timeout' : ''}`;
        case 'property_auction_canceled':
            return `${data.actor} canceled the auction for ${data.property}`;
        case 'dice_roll':
            if (data.sentToJail) return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} — sent to Jail`;
            if (data.inJail) return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} and stayed in Jail`;
            return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} — moved to ${data.square}${data.isDoubles ? ' (doubles!)' : ''}`;
        case 'card_draw':
            return `${data.player} drew ${deckDisplayName(data.deckType)}: "${data.card}"${data.effect ? ` Applied: ${data.effect}.` : ''}`;
        case 'pass_go':
            return `${data.player} passed GO — collected $${data.amount}`;
        default:
            return `${type}: ${JSON.stringify(data)}`;
    }
}

function formatPayouts(payouts) {
    return (payouts || []).map(p => `$${Number(p.amount).toFixed(2)} to ${p.name}`).join(', ');
}

function formatLogTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const sameDay = date.toDateString() === new Date().toDateString();
    return date.toLocaleString([], sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
            logActionError('Error loading game log:', error);
        }
    }
}

// Open Buy Property Modal
async function openBuyPropertyModal() {
    const gameState = currentGame.game_state;
    const position = currentPlayerData.position || 0;
    const square = BOARD_SQUARES[position];

    if (!square || square.propertyId === null) {
        selectedPropertyId = null;
        document.getElementById('availableProperties').innerHTML =
            '<p class="turn-warning danger">Land on a property square to buy it.</p>';
        openModal('buyPropertyModal');
        return;
    }

    const property = gameState.properties.find(p => p.id === square.propertyId);

    if (!property || property.ownerId) {
        selectedPropertyId = null;
        document.getElementById('availableProperties').innerHTML =
            '<p class="turn-warning danger">Someone already owns this property.</p>';
        openModal('buyPropertyModal');
        return;
    }

    const propertiesHtml = `
        <div class="property-card" data-property-id="${escapeHtml(property.id)}">
            <div class="property-color" style="background-color: ${escapeHtml(getPropertyColorValue(property.color))}"></div>
            <div class="property-name">${escapeHtml(property.name)}</div>
            <div class="property-price">${formatMoney(property.price)}</div>
        </div>
    `;

    selectedPropertyId = property.id;
    document.getElementById('purchasePriceDisplay').textContent = `$${Number(property.price).toFixed(2)}`;
    document.getElementById('availableProperties').innerHTML = propertiesHtml;
    renderBuyForChoices(property);
    openModal('buyPropertyModal');
}

// "Who's buying?": you, or a company you run, paying from its treasury.
function renderBuyForChoices(property) {
    const container = document.getElementById('buyForChoices');
    const gameState = currentGame.game_state;
    const corps = ShareDeals.corporationsRunBy(gameState, currentUser.id);
    container.hidden = corps.length === 0;
    if (!corps.length) {
        container.innerHTML = '';
        return;
    }
    const completes = corp => {
        const group = gameState.properties.filter(p => p.color === property.color);
        return group.length > 1 && group.every(p => p.id === property.id || p.ownerId === corp.id);
    };
    const option = (value, title, detail, disabled, checked) => `
        <label class="trade-destination-option">
            <input type="radio" name="buyFor" value="${escapeHtml(value)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
            <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
        </label>
    `;
    const myCash = Number(currentPlayerData?.cash || 0);
    container.innerHTML = `
        <p class="trade-destination-title">Who's buying?</p>
        ${option('', 'You', `Your cash ${formatMoney(myCash)} → ${formatMoney(myCash - property.price)}`, false, true)}
        ${corps.map(corp => {
            const cash = Number(corp.cash || 0);
            const short = cash < property.price;
            const detail = short
                ? `Treasury has ${formatMoney(cash)}, not enough.`
                : `Treasury ${formatMoney(cash)} → ${formatMoney(cash - property.price)}.${completes(corp) ? ` Completes the ${property.color} group for ${corp.ticker}.` : ''}`;
            return option(corp.id, corp.ticker, detail, short, false);
        }).join('')}
    `;
}

let selectedPropertyId = null;

async function confirmPurchase() {
    if (!selectedPropertyId) {
        alert('Please select a property');
        return;
    }

    // Re-validate: property must be at player's current position and unowned
    const position = currentPlayerData.position || 0;
    const square = BOARD_SQUARES[position];
    if (!square || square.propertyId !== selectedPropertyId) {
        alert('You can only buy the property you landed on.');
        return;
    }
    const gameState = currentGame.game_state;
    const property = gameState.properties.find(p => p.id === selectedPropertyId);
    if (!property || property.ownerId) {
        alert('This property is not available for purchase.');
        return;
    }

    const corpId = document.querySelector('#buyForChoices input[name="buyFor"]:checked')?.value || '';
    await submitGameAction('buy_property', corpId ? { corpId } : {}, {
        errorText: 'Failed to purchase property',
        onSaved: closeBuyPropertyModal,
    });
}

async function startAuctionFromPurchase() {
    await submitGameAction('start_auction', {}, {
        errorText: 'Failed to start auction',
        onSaved: closeBuyPropertyModal,
    });
}

function closeBuyPropertyModal() {
    closeModal('buyPropertyModal');
    selectedPropertyId = null;
}

async function placeAuctionBid() {
    const input = document.getElementById('auctionBidAmount');
    const amount = parseFloat(input?.value);
    if (!amount || amount <= 0) {
        alert('Enter a bid amount greater than $0.');
        return;
    }

    await submitGameAction('place_bid', { amount }, { errorText: 'Failed to place bid' });
}

async function passAuction() {
    await submitGameAction('pass_auction', {}, { errorText: 'Failed to pass auction' });
}

async function hostCancelAuction() {
    if (!confirm('Cancel this auction? No property or cash will move.')) return;
    await submitGameAction('host_cancel_auction', {}, { errorText: 'Failed to cancel auction' });
}

// The server refuses trades of streets in a colour group with buildings and
// IPOs of part of one; these show that rule before the player hits it.
function groupHasBuildingsUi(color) {
    if (!HOUSE_COSTS[color] || !currentGame) return false;
    return currentGame.game_state.properties.some(p => p.color === color && Number(p.houses || 0) > 0);
}

// Open IPO Modal
async function openIPOModal() {
    const assetsHtml = currentPlayerData.properties.map(p => {
        const built = groupHasBuildingsUi(p.color);
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="ipo-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"${built ? ` data-built-group="${escapeHtml(p.color)}"` : ''}>
            <label for="ipo-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span>${built ? ` <span class="debt-detail">Has buildings: goes in with the whole ${escapeHtml(p.color)} group</span>` : ''}</label>
        </div>
    `;
    }).join('');

    const container = document.getElementById('ipoAssets');
    container.innerHTML = assetsHtml;
    const runCorps = ShareDeals.corporationsRunBy(currentGame.game_state, currentUser.id);
    const existing = document.getElementById('ipoExistingCorps');
    existing.hidden = runCorps.length === 0;
    existing.innerHTML = runCorps.length ? `
        <small>Or add these properties to a company you already run:</small>
        ${runCorps.map(corp => `<button class="btn btn-secondary btn-sm" data-game-action="open-add-to-corporation" data-corp-id="${escapeHtml(corp.id)}">Add to ${escapeHtml(corp.ticker)}</button>`).join('')}
    ` : '';
    // A built group goes into an IPO whole, so ticking one street ticks the group.
    container.querySelectorAll('input[data-built-group]').forEach(input => {
        input.addEventListener('change', () => {
            container.querySelectorAll(`input[data-built-group="${CSS.escape(input.dataset.builtGroup)}"]`).forEach(other => { other.checked = input.checked; });
        });
    });
    openModal('ipoModal');
}

async function createIPO() {
    const ticker = document.getElementById('ipoTicker').value.toUpperCase();

    if (!ticker) {
        alert('Please enter a ticker symbol');
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
        assetIds: selectedAssets.map(asset => asset.id),
    }, {
        errorText: 'Failed to create IPO',
        onSaved: () => closeModal('ipoModal'),
    });
}

// Debt page: your loans (balances, autopay, payments), new loans and refinancing.
function openDebtModal() {
    const isMyTurn = isCurrentUsersTurn();
    const select = document.getElementById('debtAction');
    select.querySelectorAll('option[value="issue"], option[value="refinance"]').forEach(option => {
        option.disabled = !isMyTurn;
    });
    select.value = isMyTurn && !getManagedLoans().length ? 'issue' : 'loans';
    const rates = LoanMath.loanRates(currentGame.game_state);
    document.getElementById('loanRatesHint').textContent =
        `Rates this game: ${LoanMath.LOAN_TERMS.map(term => `${term} turns at ${rates[term]}%`).join(', ')} per turn. Each payment includes interest; the whole balance is due when the term ends.`;
    document.getElementById('debtIssuer').innerHTML = debtIssuerOptionsHtml();
    document.getElementById('loanAmount').value = '';
    document.getElementById('refinanceAmount').value = '';
    document.getElementById('loanAutopay').checked = true;
    renderLoanList();
    renderBorrowingLimit();
    renderLoanTerms('loanTerms', 'loanAmount');
    renderRefinanceDebtOptions();
    renderLoanTerms('refinanceTerms', 'refinanceAmount');
    toggleDebtForm();

    openModal('debtModal');
}

function isPlayersTurn(player) {
    const gameState = currentGame.game_state;
    return !!player && gameState.players[gameState.currentPlayerIndex]?.userId === player.userId;
}

function isCurrentUsersTurn() {
    return isPlayersTurn({ userId: currentUser.id });
}

// Loans you can manage: your own, then those of corporations you run.
function getManagedLoans() {
    const own = getPersonalDebts().map(debt => ({ debt, corp: null }));
    const corporate = getEligibleDebtCorporations()
        .filter(corp => !ShareDeals.isInsolvent(corp))
        .flatMap(corp => (corp.debts || []).map(debt => ({ debt, corp })));
    return [...own, ...corporate];
}

function renderLoanList() {
    const container = document.getElementById('loanList');
    if (!container) return;
    const loans = getManagedLoans();
    if (!loans.length) {
        container.innerHTML = '<p class="empty-state">No loans. Choose "Take a new loan" to borrow against a property.</p>';
        return;
    }
    const isMyTurn = isCurrentUsersTurn();
    container.innerHTML = loans.map(({ debt, corp }) => renderLoanRow(debt, corp, isMyTurn)).join('');
}

function renderLoanRow(debt, corp, isMyTurn) {
    // A corporation's loans count down on its chairman's turn.
    const status = LoanMath.loanStatus(debt, { dueThisTurn: isMyTurn && (!corp || corp.chairmanId === currentUser.id) });
    const cash = corp ? Number(corp.cash || 0) : Number(currentPlayerData?.cash || 0);
    const borrower = corp ? `${corp.ticker} (corporation)` : 'Personal';
    const autopayId = `loan-autopay-${debt.id}`;
    const amountId = `loan-pay-${debt.id}`;
    const ids = `data-debt-id="${escapeHtml(debt.id)}" data-corp-id="${escapeHtml(corp ? corp.id : '')}"`;
    let schedule;
    if (status.dueInFull) {
        const when = status.dueThisTurn ? 'when you end this turn' : `at the end of ${corp ? 'the chairman\'s' : 'your'} next turn`;
        schedule = `${formatMoney(status.nextPayment)} is due in full ${when}. If there isn't the cash, ${corp ? `${corp.ticker} becomes insolvent` : 'you go bankrupt'}.`;
    } else if (status.autopay) {
        schedule = `Autopay takes ${formatMoney(status.nextPayment)} at the end of ${corp ? 'the chairman\'s' : 'your'} turn.`;
    } else {
        schedule = `Autopay is off. Next scheduled payment ${formatMoney(status.nextPayment)}; anything unpaid adds ${formatMoney(status.interestNext)} interest to the balance.`;
    }
    const payDisabled = isMyTurn ? '' : ' disabled';
    return `
        <article class="loan-row${status.dueInFull ? ' is-due' : ''}" ${ids}>
            <div class="loan-row-head">
                <span class="loan-balance">${formatMoney(status.balance)}</span>
                <span class="badge ${status.dueInFull ? 'badge-danger' : 'badge-info'}">${escapeHtml(status.turnsLabel)}</span>
            </div>
            <p class="debt-detail">${escapeHtml(borrower)} · ${escapeHtml(status.termLabel)}</p>
            <p class="loan-schedule">${escapeHtml(schedule)}</p>
            <div class="asset-list">
                <div class="asset-checkbox">
                    <input type="checkbox" role="switch" id="${escapeHtml(autopayId)}" data-loan-autopay ${ids}${status.autopay ? ' checked' : ''}${status.dueInFull ? ' disabled' : ''}>
                    <label for="${escapeHtml(autopayId)}">Autopay</label>
                </div>
            </div>
            <div class="loan-pay">
                <label class="field-label" for="${escapeHtml(amountId)}">Pay an amount</label>
                <div class="inline-action-row">
                    <input type="number" inputmode="decimal" min="0" step="0.01" id="${escapeHtml(amountId)}" placeholder="Up to ${escapeHtml(formatMoney(Math.min(cash, status.balance)))}"${payDisabled}>
                    <button type="button" class="btn btn-secondary btn-sm" data-loan-pay ${ids}${payDisabled}>Pay</button>
                </div>
                <button type="button" class="btn btn-success btn-sm btn-block" data-loan-payoff ${ids}${payDisabled || (cash < status.balance ? ' disabled' : '')}>Pay off ${formatMoney(status.balance)}</button>
                ${isMyTurn ? (cash < status.balance ? `<p class="debt-detail">Paying off needs ${formatMoney(status.balance)}; ${corp ? `${corp.ticker} has` : 'you have'} ${formatMoney(cash)}.</p>` : '') : '<p class="debt-detail">You can make payments on your turn. Autopay can be changed any time.</p>'}
            </div>
        </article>
    `;
}

function findManagedLoan(element) {
    const debtId = element.dataset.debtId;
    const corpId = element.dataset.corpId || null;
    return getManagedLoans().find(item => item.debt.id === debtId && (item.corp ? item.corp.id : null) === corpId) || null;
}

async function handleLoanListClick(event) {
    const button = event.target.closest('[data-loan-pay], [data-loan-payoff]');
    if (!button) return;
    const loan = findManagedLoan(button);
    if (!loan) return;
    let amount;
    if (button.hasAttribute('data-loan-payoff')) {
        amount = Number(loan.debt.principal || 0);
    } else {
        amount = parseFloat(document.getElementById(`loan-pay-${loan.debt.id}`).value);
        if (!(amount > 0)) {
            alert('Enter an amount to pay.');
            return;
        }
    }
    await submitGameAction('pay_debt', { debtId: loan.debt.id, corpId: loan.corp ? loan.corp.id : undefined, amount }, {
        errorText: 'Failed to pay the loan',
        onSaved: renderLoanList,
    });
}

async function handleLoanAutopayChange(event) {
    const input = event.target.closest('[data-loan-autopay]');
    if (!input) return;
    const loan = findManagedLoan(input);
    if (!loan) return;
    await submitGameAction('set_debt_autopay', { debtId: loan.debt.id, corpId: loan.corp ? loan.corp.id : undefined, autopay: input.checked }, {
        errorText: 'Failed to change autopay',
    });
    // Redraw either way, so a refused change puts the switch back.
    renderLoanList();
}

// Term choices with what each costs at the amount typed: the payment each turn and the total.
function renderLoanTerms(containerId, amountInputId) {
    const container = document.getElementById(containerId);
    const selected = container.querySelector('input:checked')?.value || '10';
    const amount = parseFloat(document.getElementById(amountInputId).value);
    const rates = LoanMath.loanRates(currentGame.game_state);
    container.innerHTML = LoanMath.LOAN_TERMS.map(term => {
        const id = `${containerId}-${term}`;
        const quote = amount > 0 ? LoanMath.loanQuote(amount, rates[term], term) : null;
        const detail = quote
            ? `${formatMoney(quote.payment)} a turn, ${formatMoney(quote.total)} in total`
            : 'Enter an amount to see the payments';
        return `
            <div class="asset-checkbox">
                <input type="radio" name="${escapeHtml(containerId)}" id="${escapeHtml(id)}" value="${term}"${String(term) === selected ? ' checked' : ''}>
                <label for="${escapeHtml(id)}">${term} turns at ${rates[term]}% per turn<span class="debt-detail">${escapeHtml(detail)}</span></label>
            </div>
        `;
    }).join('');
}

function selectedLoanTerm(containerId) {
    return Number(document.querySelector(`#${containerId} input:checked`)?.value || 10);
}

function debtIssuerOptionsHtml() {
    const corporationOptions = getEligibleDebtCorporations().map(corp =>
        `<option value="corporation:${escapeHtml(corp.id)}">${escapeHtml(corp.ticker)} Corporation</option>`
    );
    return [
        '<option value="player">Personal</option>',
        ...corporationOptions,
    ].join('');
}

function getEligibleDebtCorporations() {
    const gameState = currentGame.game_state;
    return (gameState.corporations || []).filter(corp => canManageCorporationDebtUi(corp, currentUser.id));
}

function canManageCorporationDebtUi(corp, userId) {
    if (!corp || !userId) return false;
    return corp.chairmanId === userId || hasMajoritySharesUi(corp, userId);
}

// The borrowing limit the server worked out: all of a borrower's loans may reach
// 90% of the book value of their properties and shares (a corporation: its properties).
function selectedBorrower() {
    const issuer = document.getElementById('debtIssuer')?.value || 'player';
    if (!issuer.startsWith('corporation:')) return { account: currentPlayerData, corp: null };
    const corp = currentGame.game_state.corporations.find(item => item.id === issuer.split(':')[1]);
    return { account: corp, corp };
}

function borrowingLimitText(account, corp, replacedOwed = 0) {
    const borrowing = account?.borrowing;
    if (!borrowing) return '';
    const owed = Math.max(0, Number(borrowing.owed || 0) - replacedOwed);
    const available = Math.max(0, Number(borrowing.limit || 0) - owed);
    const whose = corp ? `${corp.ticker}'s properties` : 'your properties and shares';
    const owing = owed > 0 ? `, less ${formatMoney(owed)} already owed` : '';
    return `You can borrow up to ${formatMoney(available)}: 90% of the ${formatMoney(borrowing.bookValue)} book value of ${whose}${owing}.`;
}

function renderBorrowingLimit() {
    const { account, corp } = selectedBorrower();
    document.getElementById('loanLimit').textContent = borrowingLimitText(account, corp);
}

function renderRefinanceDebtOptions() {
    const debts = getPersonalDebts();
    const debtsHtml = debts.map((debt, index) => `
        <div class="asset-checkbox">
            <input type="checkbox" id="refinance-debt-${index}" value="${index}" data-debt-id="${escapeHtml(debt.id || '')}">
            <label for="refinance-debt-${index}">
                ${debtOptionLabel(debt, index)}
            </label>
        </div>
    `).join('');

    document.getElementById('debtsToRefinance').innerHTML = debtsHtml || '<p class="empty-state">No debts to refinance</p>';
    updateRefinanceSummary();
}

function getPersonalDebts() {
    return Array.isArray(currentPlayerData?.debts) ? currentPlayerData.debts : [];
}

function debtPrincipal(debt) {
    return Number(debt?.principal || 0);
}

function debtOptionLabel(debt, index) {
    const status = LoanMath.loanStatus(debt);
    return `Loan #${index + 1}: ${formatMoney(debtPrincipal(debt))}, ${escapeHtml(status.termLabel)}, ${escapeHtml(status.turnsLabel.toLowerCase())}`;
}

function getSelectedRefinanceDebtItems() {
    const debts = getPersonalDebts();
    return Array.from(document.querySelectorAll('#debtsToRefinance input:checked'))
        .map(input => Number(input.value))
        .filter(index => Number.isInteger(index) && debts[index])
        .map(index => ({ index, debt: debts[index] }));
}

function getRefinancePayoffAmount() {
    return getSelectedRefinanceDebtItems()
        .reduce((sum, item) => sum + debtPrincipal(item.debt), 0);
}

function updateRefinanceSummary() {
    const summary = document.getElementById('refinanceSummary');
    if (!summary) return;
    renderRefinanceLimit();
    const selectedCount = getSelectedRefinanceDebtItems().length;
    const payoffAmount = getRefinancePayoffAmount();
    const newLoanAmount = parseFloat(document.getElementById('refinanceAmount').value);
    const netCash = Number.isFinite(newLoanAmount) ? newLoanAmount - payoffAmount : 0;
    summary.classList.toggle('debt-flow-warning', selectedCount > 0 && Number.isFinite(newLoanAmount) && netCash <= 0);

    if (!selectedCount) {
        summary.textContent = 'Selected payoff: $0.00';
        return;
    }

    const netText = Number.isFinite(newLoanAmount) ? `$${netCash.toFixed(2)}` : '$0.00';
    summary.textContent = `Selected payoff: $${payoffAmount.toFixed(2)} | Net new cash: ${netText}`;
}

// The loans being refinanced don't count against the limit for the new one.
function renderRefinanceLimit() {
    document.getElementById('refinanceLimit').textContent = borrowingLimitText(currentPlayerData, null, getRefinancePayoffAmount());
}

function toggleDebtForm() {
    const action = document.getElementById('debtAction').value;
    document.getElementById('loansView').style.display = action === 'loans' ? 'block' : 'none';
    document.getElementById('issueDebtForm').style.display = action === 'issue' ? 'block' : 'none';
    document.getElementById('refinanceDebtForm').style.display = action === 'refinance' ? 'block' : 'none';
    const processButton = document.getElementById('process-debt-btn');
    processButton.style.display = action === 'loans' ? 'none' : '';
    processButton.textContent = action === 'refinance' ? 'Refinance' : 'Take loan';
    if (action === 'loans') renderLoanList();
    if (action === 'refinance') updateRefinanceSummary();
}

async function processDebt() {
    const action = document.getElementById('debtAction').value;

    if (action === 'issue') {
        await issueDebt();
    } else if (action === 'refinance') {
        await refinanceDebt();
    }
}

async function issueDebt() {
    const loanAmount = parseFloat(document.getElementById('loanAmount').value);
    const issuer = document.getElementById('debtIssuer').value || 'player';
    const issuerType = issuer.startsWith('corporation:') ? 'corporation' : 'player';
    const corpId = issuerType === 'corporation' ? issuer.split(':')[1] : null;

    if (!loanAmount) {
        alert('Please enter a loan amount');
        return;
    }

    await submitGameAction('issue_debt', {
        amount: loanAmount,
        termTurns: selectedLoanTerm('loanTerms'),
        autopay: document.getElementById('loanAutopay').checked,
        issuerType,
        corpId,
    }, {
        errorText: 'Failed to issue debt',
        onSaved: () => closeModal('debtModal'),
    });
}

async function refinanceDebt() {
    const selectedItems = getSelectedRefinanceDebtItems();
    const refinanceAmount = parseFloat(document.getElementById('refinanceAmount').value);
    const payoffAmount = getRefinancePayoffAmount();

    if (!selectedItems.length) {
        alert('Please select at least one debt to refinance');
        return;
    }

    if (!refinanceAmount) {
        alert('Please enter a new loan amount');
        return;
    }

    if (refinanceAmount <= payoffAmount) {
        alert('New loan amount must be greater than the selected payoff amount');
        return;
    }

    await submitGameAction('refinance_debt', {
        amount: refinanceAmount,
        termTurns: selectedLoanTerm('refinanceTerms'),
        debtIds: selectedItems.map(item => item.debt.id).filter(Boolean),
        debtIndexes: selectedItems.map(item => item.index),
    }, {
        errorText: 'Failed to refinance debt',
        onSaved: () => closeModal('debtModal'),
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
        const treasuryListedShares = getTreasuryListedShares(corp);
        const isInsolvent = ShareDeals.isInsolvent(corp);
        const buyableShares = getBuyableListedShares(corp);
        const canBuy = isMyTurn && buyableShares > 0 && !isInsolvent;
        const governanceHtml = renderChairmanGovernance(corp);
        const hasProperties = (currentPlayerData?.properties || []).length > 0 && !currentPlayerData?.bankrupt;
        const runsIt = ShareDeals.runsCorporation(corp, currentUser.id);
        const canAddProperty = runsIt && hasProperties;
        const netAssetValue = getCorporationNetAssetValue(corp);
        const shareValue = getCorporationShareValue(corp);
        const shareholderRows = shareholders.length
            ? shareholders.map(s => `<li>${escapeHtml(s.name)}: ${ShareDeals.count(s.shares)} shares (${ownershipPercent(s.shares, corp.totalShares)}%)</li>`).join('')
            : '<li>No active shareholders</li>';
        const debtRows = debts.length
            ? debts.map(d => {
                const dueThisTurn = gameState.players[gameState.currentPlayerIndex]?.userId === corp.chairmanId;
                const status = LoanMath.loanStatus(d, { dueThisTurn });
                return `<li>${formatMoney(d.principal)}, ${escapeHtml(status.termLabel)}: ${escapeHtml(status.turnsLabel.toLowerCase())}. ${escapeHtml(loanPaymentNote(d, dueThisTurn))}.</li>`;
            }).join('')
            : '<li>No corporation debt</li>';
        const listingDetails = treasuryListedShares > 0
            ? `<p>Treasury shares for sale: ${treasuryListedShares} at ${formatMoney(shareValue)} each (NAV)</p>`
            : '<p>No treasury shares for sale. To buy shares a player holds, make them an offer in the Market.</p>';
        const buyLabel = 'Buy treasury shares';

        return `
        <div class="corporation-card">
            <h3>${escapeHtml(corp.ticker)} - ${escapeHtml(corp.name)} ${isInsolvent ? '<span class="badge badge-danger">Insolvent</span>' : ''}</h3>
            <p>Founder: ${escapeHtml(corp.founderName)}</p>
            <p>Chairman: ${escapeHtml(isInsolvent ? 'Closed' : (corp.chairmanName || corp.founderName || 'Unassigned'))}</p>
            <p>Majority holder: ${escapeHtml(majorityHolderName(corp) || 'None')}</p>
            <p>Treasury Cash: $${Number(corp.cash || 0).toFixed(2)}</p>
            <p>Total Shares: ${ShareDeals.count(corp.totalShares)} | NAV: ${ShareDeals.perShare(shareValue)}/share</p>
            <p>Net Asset Value: $${netAssetValue.toFixed(2)}</p>
            ${listingDetails}
            ${isInsolvent ? '<p class="corp-status-warning">This corporation is closed after treasury insolvency. Properties returned to the Bank; shares, debt, and governance were wiped.</p>' : ''}
            ${CorporationDesk.renderRentPolicy(corp)}
            ${CorporationDesk.renderRunnerTools(corp)}
            ${CorporationDesk.renderPropertyOffers(corp)}
            <h4>Assets:</h4>
            <ul>
                ${assets.map(a => `<li>${propertyDot(a.id)}${escapeHtml(a.name)} ($${Number(a.value || 0).toFixed(2)})</li>`).join('') || '<li>No assets</li>'}
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
            ${CorporationDesk.renderOfferButton(corp)}
            ${canAddProperty ? `
                <div class="offer-property-for-shares">
                    <button class="btn btn-success" data-game-action="open-add-to-corporation" data-corp-id="${escapeHtml(corp.id)}"${isMyTurn ? '' : ' disabled'}>Add properties to ${escapeHtml(corp.ticker)}</button>
                    <small>${isMyTurn ? `Move more of your properties into ${escapeHtml(corp.ticker)}.` : 'You can do this on your turn.'}</small>
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
                        <span>${ShareDeals.count(supportedShares)}/${ShareDeals.count(corp.totalShares)} shares supporting, ${ShareDeals.count(required)} needed</span>
                    </div>
                    ${canSupport ? `<button class="btn btn-primary btn-sm" data-game-action="support-chairman-vote" data-corp-id="${escapeHtml(corp.id)}" data-vote-id="${escapeHtml(vote.id)}">Support</button>` : ''}
                </div>
            `;
        }).join('')
        : '<p class="empty-state">No open chairman votes</p>';

    return `
        <div class="chairman-governance">
            <h4>Chairman Governance</h4>
            <p>Changing chairman requires ${ShareDeals.count(required)}/${ShareDeals.count(corp.totalShares)} shares.</p>
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
        onSaved: openCorporationModal,
    });
}

async function proposeChairmanVote(corpId) {
    const candidateUserId = document.getElementById(`chairmanVoteCandidate-${corpId}`).value;
    await submitGameAction('propose_chairman_vote', { corpId, candidateUserId }, {
        errorText: 'Failed to propose chairman vote',
        onSaved: openCorporationModal,
    });
}

async function supportChairmanVote(corpId, voteId) {
    await submitGameAction('support_chairman_vote', { corpId, voteId }, {
        errorText: 'Failed to support chairman vote',
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
    const buyableShares = getBuyableListedShares(corp);

    if (!numShares || numShares < 1 || numShares > buyableShares) {
        alert(`Enter a valid number of shares (1-${buyableShares})`);
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
    await submitGameAction('host_end_game', {}, {
        errorText: 'Failed to end game',
        onSaved: () => showWinnerFromState(currentGame.game_state, 'Host ended the game.'),
    });
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
            logActionError('Error showing game update:', renderError);
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

// The server refusing an action (4xx) is part of play and was already shown to
// the player; only unexpected failures are console errors.
function logActionError(label, error) {
    const refused = error && error.status >= 400 && error.status < 500;
    (refused ? console.warn : console.error)(label, error);
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

    // Escape or a tap on the dimmed backdrop closes a dialog, like its Cancel button.
    // The Game Over dialog stays until the player chooses Back to Lobby.
    const dismissableModal = () => Array.from(document.querySelectorAll('.modal.active')).filter(modal => modal.id !== 'winnerModal').pop();
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
    document.getElementById('add-to-corp-btn')?.addEventListener('click', submitAddToCorporation);
    document.getElementById('addToCorpModal')?.addEventListener('change', renderAddToCorpChoices);
    CorporationDesk.bind();
    document.getElementById('debtAction')?.addEventListener('change', toggleDebtForm);
    document.getElementById('debtIssuer')?.addEventListener('change', renderBorrowingLimit);
    document.getElementById('loanList')?.addEventListener('click', handleLoanListClick);
    document.getElementById('loanList')?.addEventListener('change', handleLoanAutopayChange);
    document.getElementById('loanAmount')?.addEventListener('input', () => renderLoanTerms('loanTerms', 'loanAmount'));
    document.getElementById('refinanceAmount')?.addEventListener('input', () => renderLoanTerms('refinanceTerms', 'refinanceAmount'));
    document.getElementById('debtsToRefinance')?.addEventListener('change', () => {
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
            renderTradingAs('player1');
            renderTradingAs('player2');
            updatePlayerAssets('player1');
            updatePlayerAssets('player2');
            updateMarketActionState();
        });
        player1Select.dataset.assetsBound = 'true';
    }
    if (!player2Select.dataset.assetsBound) {
        player2Select.addEventListener('change', () => {
            enforceDistinctPlayers(player2Select, player1Select);
            renderTradingAs('player1');
            renderTradingAs('player2');
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

    ['player1', 'player2'].forEach(side => {
        const asSelect = document.getElementById(`${side}As`);
        if (asSelect && !asSelect.dataset.assetsBound) {
            asSelect.addEventListener('change', () => {
                updatePlayerAssets('player1');
                updatePlayerAssets('player2');
                updateMarketActionState();
            });
            asSelect.dataset.assetsBound = 'true';
        }
        renderTradingAs(side);
    });
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    renderTradeOffers();
    updateMarketActionState();
}

// "Trading as": a side's player can trade for a company they run, using its
// treasury cash, properties and treasury shares.
function renderTradingAs(side) {
    const group = document.getElementById(`${side}AsGroup`);
    const select = document.getElementById(`${side}As`);
    if (!group || !select) return;
    const userId = document.getElementById(`${side}Select`)?.value;
    const player = currentGame.game_state.players.find(p => p.userId === userId);
    const corps = player ? ShareDeals.corporationsRunBy(currentGame.game_state, userId) : [];
    const previous = select.dataset.playerId === userId ? select.value : '';
    group.hidden = corps.length === 0;
    select.innerHTML = [`<option value="">${escapeHtml(userId === currentUser.id ? 'Yourself' : (player?.name || 'Themselves'))}</option>`]
        .concat(corps.map(corp => `<option value="${escapeHtml(corp.id)}">${escapeHtml(corp.ticker)} (treasury ${formatMoney(corp.cash)})</option>`))
        .join('');
    select.dataset.playerId = userId || '';
    setSelectValue(select, previous, '');
}

function tradingAsCorp(side) {
    const corpId = document.getElementById(`${side}As`)?.value || '';
    return corpId ? currentGame.game_state.corporations.find(corp => corp.id === corpId) || null : null;
}

function setTradingAs(side, userId, corpId) {
    const select = document.getElementById(`${side}Select`);
    if (!select) return;
    select.value = userId;
    enforceDistinctPlayers(select, document.getElementById(`${otherTradeSide(side)}Select`));
    renderTradingAs('player1');
    renderTradingAs('player2');
    const asSelect = document.getElementById(`${side}As`);
    if (asSelect) asSelect.value = corpId || '';
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
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
    const corp = tradingAsCorp(playerNumber);
    const holderKey = corp ? `${userId}|${corp.id}` : userId;
    if (corp) {
        renderCorporationTradeAssets(container, playerNumber, corp, holderKey);
        renderTradeDestination(playerNumber);
        return;
    }
    // Game updates re-render this form; keep what the player already picked.
    const kept = container.dataset.playerId === holderKey ? {
        checked: new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value)),
        shares: new Map(Array.from(container.querySelectorAll('.trade-share-input')).map(input => [input.dataset.corpId, input.value])),
    } : null;

    // Streets in a built-up colour group can't be traded; show each such group
    // once, greyed out, with one note instead of repeating it on every street.
    const lockedGroups = new Map();
    player.properties.forEach(p => {
        if (!groupHasBuildingsUi(p.color)) return;
        if (!lockedGroups.has(p.color)) lockedGroups.set(p.color, []);
        lockedGroups.get(p.color).push(p);
    });
    const renderedGroups = new Set();
    const assetsHtml = player.properties.map(p => {
        if (lockedGroups.has(p.color)) {
            if (renderedGroups.has(p.color)) return '';
            renderedGroups.add(p.color);
            return `
        <div class="asset-locked-group">
            <p class="asset-locked-note">The ${escapeHtml(p.color)} group has buildings, so these can't be traded. IPO the group and sell shares instead.</p>
            ${lockedGroups.get(p.color).map(street => `
            <div class="asset-locked-row">${propertyDot(street.id)}${escapeHtml(street.name)}<span class="debt-detail">${formatMoney(street.value)}</span></div>`).join('')}
        </div>
    `;
        }
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="${playerNumber}-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span></label>
        </div>
    `;
    }).join('');
    const jailCardHtml = player.hasGetOutOfJailCard ? `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}" value="${GAME_JAIL_CARD_ASSET_ID}">
            <label for="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}">Get Out of Jail Free card</label>
        </div>
    ` : '';

    const sharesHtml = (player.corporations || [])
        .filter(corp => Number(corp.sharesOwned || 0) > 0 && !ShareDeals.isInsolvent(corp))
        .map(corp => {
            const inputId = `${playerNumber}-shares-${escapeHtml(corp.id)}`;
            return `
                <div class="asset-checkbox asset-shares">
                    <input type="number" class="trade-share-input" id="${inputId}" data-corp-id="${escapeHtml(corp.id)}" data-total-shares="${Number(corp.totalShares)}" min="0" max="${Number(corp.sharesOwned)}" step="1" value="0">
                    <label for="${inputId}">${escapeHtml(corp.ticker)} shares (holds ${ShareDeals.count(corp.sharesOwned)} of ${ShareDeals.count(corp.totalShares)})</label>
                    <span class="trade-share-pct" aria-live="polite"></span>
                </div>
            `;
        }).join('');

    container.innerHTML = (assetsHtml + sharesHtml + jailCardHtml) || '<p class="empty-state">No properties or shares to offer</p>';
    container.dataset.playerId = holderKey;
    if (kept) {
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = !input.disabled && kept.checked.has(input.value); });
        container.querySelectorAll('.trade-share-input').forEach(input => {
            if (kept.shares.has(input.dataset.corpId)) input.value = kept.shares.get(input.dataset.corpId);
        });
    }
    container.querySelectorAll('.trade-share-input').forEach(updateTradeSharePercent);
    renderTradeDestination(playerNumber);
}

// A company's side of a trade: the properties it owns (built groups stay put)
// and its own treasury shares.
function renderCorporationTradeAssets(container, playerNumber, corp, holderKey) {
    const gameState = currentGame.game_state;
    const kept = container.dataset.playerId === holderKey ? {
        checked: new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value)),
        shares: new Map(Array.from(container.querySelectorAll('.trade-share-input')).map(input => [input.dataset.corpId, input.value])),
    } : null;
    const props = gameState.properties.filter(p => p.ownerId === corp.id);
    const propsHtml = props.map(p => {
        const value = propertyAssetValue(p);
        if (groupHasBuildingsUi(p.color)) {
            return `<div class="asset-locked-row">${propertyDot(p.id)}${escapeHtml(p.name)}<span class="debt-detail">Built group: can't be traded</span></div>`;
        }
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="${playerNumber}-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(value)}</span></label>
        </div>`;
    }).join('');
    const treasury = Number(corp.treasuryShares || 0);
    const inputId = `${playerNumber}-shares-${escapeHtml(corp.id)}`;
    const sharesHtml = treasury > 0 ? `
        <div class="asset-checkbox asset-shares">
            <input type="number" class="trade-share-input" id="${inputId}" data-corp-id="${escapeHtml(corp.id)}" data-total-shares="${Number(corp.totalShares)}" min="0" max="${treasury}" step="1" value="0">
            <label for="${inputId}">${escapeHtml(corp.ticker)} treasury shares (has ${ShareDeals.count(treasury)} of ${ShareDeals.count(corp.totalShares)})</label>
            <span class="trade-share-pct" aria-live="polite"></span>
        </div>` : '';
    container.innerHTML = (propsHtml + sharesHtml) || `<p class="empty-state">${escapeHtml(corp.ticker)} has no properties or treasury shares to offer. It can still pay cash.</p>`;
    container.dataset.playerId = holderKey;
    if (kept) {
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = kept.checked.has(input.value); });
        container.querySelectorAll('.trade-share-input').forEach(input => {
            if (kept.shares.has(input.dataset.corpId)) input.value = kept.shares.get(input.dataset.corpId);
        });
    }
    container.querySelectorAll('.trade-share-input').forEach(updateTradeSharePercent);
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
    // A company side gives from, or receives into, its own books.
    const companySide = tradingAsCorp(playerNumber) || tradingAsCorp(otherTradeSide(playerNumber));
    const corps = !companySide && giver && receiver && giver.userId !== receiver.userId && (giver.properties || []).length
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
        player1CorpId: tradingAsCorp('player1')?.id || null,
        player2CorpId: tradingAsCorp('player2')?.id || null,
    };
}

function summarizeShareDeal(terms) {
    return ShareDeals.summarize(currentGame.game_state, terms, currentUser.id, {
        netAssetValue: getCorporationNetAssetValue,
        jailCardId: GAME_JAIL_CARD_ASSET_ID,
    });
}

function tradeInvolvesLLC(terms) {
    // Company-side trades read plainly from the two "gives" columns.
    if (terms.player1CorpId || terms.player2CorpId) return false;
    return (terms.player1Shares || []).length > 0 || (terms.player2Shares || []).length > 0
        || (!!terms.player1PropertiesToCorpId && (terms.player1AssetIds || []).length > 0)
        || (!!terms.player2PropertiesToCorpId && (terms.player2AssetIds || []).length > 0);
}

function renderShareDealSummary(summary, options = {}) {
    const rows = summary.rows.map(row => `
        <tr><td>${escapeHtml(row.label)}</td><td class="${escapeHtml(row.tone || '')}">${escapeHtml(row.value)}</td></tr>
    `).join('');
    const even = options.showEven && summary.evenShares ? `
        <p class="share-deal-even">An even trade is ${ShareDeals.count(summary.evenShares.shares)} of ${ShareDeals.count(summary.evenShares.total)} ${escapeHtml(summary.evenShares.ticker)} shares (${escapeHtml(ShareDeals.percent(summary.evenShares.shares, summary.evenShares.total))}).
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

// Adding your own properties to a company you run (add_to_corporation). The
// server decides the share count; this only previews it.
const MAX_CORPORATION_SHARES = 1000000;
let addToCorpId = null;
let addToCorpChoice = 'shares'; // the player's pick; shown when shares are possible

function openAddToCorporationModal(corpId) {
    const gameState = currentGame?.game_state;
    const corp = gameState?.corporations?.find(item => item.id === corpId);
    if (!corp) return;
    addToCorpId = corp.id;
    closeModal('corporationModal');
    closeModal('ipoModal');
    document.getElementById('addToCorpTitle').textContent = `Add properties to ${corp.ticker}`;
    document.getElementById('addToCorpHint').textContent = `${corp.ticker} will own them and collect their rent, so every ${corp.ticker} share is worth more.`;
    const container = document.getElementById('addToCorpAssets');
    container.innerHTML = (currentPlayerData?.properties || []).map(p => {
        const built = groupHasBuildingsUi(p.color);
        const note = built ? `Has buildings: goes in with the whole ${p.color} group` : '';
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="add-corp-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"${built ? ` data-built-group="${escapeHtml(p.color)}"` : ''}>
            <label for="add-corp-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span>${note ? ` <span class="debt-detail">${escapeHtml(note)}</span>` : ''}</label>
        </div>
    `;
    }).join('') || '<p class="empty-state">You have no properties to add.</p>';
    // A built group goes in whole, so ticking one street ticks the group.
    container.querySelectorAll('input[data-built-group]').forEach(input => {
        input.addEventListener('change', () => {
            container.querySelectorAll(`input[data-built-group="${CSS.escape(input.dataset.builtGroup)}"]:not(:disabled)`).forEach(other => { other.checked = input.checked; });
        });
    });
    document.getElementById('addToCorpShares').innerHTML = '';
    addToCorpChoice = 'shares';
    renderAddToCorpChoices();
    openModal('addToCorpModal');
}

function selectedAddToCorpIds() {
    return Array.from(document.querySelectorAll('#addToCorpAssets input:checked')).map(cb => cb.value);
}

function addToCorpOptions() {
    return { netAssetValue: getCorporationNetAssetValue, maxShares: MAX_CORPORATION_SHARES };
}

// Redraws the "what do you get back" choice and the preview whenever the
// ticked properties or the choice change.
function renderAddToCorpChoices(event) {
    if (event?.target?.name === 'addToCorpReturn') addToCorpChoice = event.target.value;
    const gameState = currentGame?.game_state;
    const corp = gameState?.corporations?.find(item => item.id === addToCorpId);
    if (!corp) return;
    const ids = selectedAddToCorpIds();
    const quote = ShareDeals.contributionQuote(gameState, corp, currentUser.id, ids, addToCorpOptions());
    const choices = document.getElementById('addToCorpShares');
    if (quote.otherShares <= 0) {
        // Sole owner: the property just moves inside the company.
        choices.innerHTML = '';
    } else {
        const canIssue = ids.length > 0 && quote.newShares > 0;
        const choice = canIssue ? addToCorpChoice : 'gift';
        const sharesDetail = canIssue
            ? `${ShareDeals.count(quote.newShares)} new share${quote.newShares === 1 ? '' : 's'} at today's value per share, so the other holders' stakes keep their value.`
            : (quote.noSharesReason || 'Pick a property to see how many shares it is worth.');
        choices.innerHTML = `
            <p class="trade-destination-title">What do you get back?</p>
            <label class="trade-destination-option">
                <input type="radio" name="addToCorpReturn" value="shares"${choice === 'shares' ? ' checked' : ''}${canIssue ? '' : ' disabled'}>
                <span><strong>New ${escapeHtml(corp.ticker)} shares</strong><small>${escapeHtml(sharesDetail)}</small></span>
            </label>
            <label class="trade-destination-option">
                <input type="radio" name="addToCorpReturn" value="gift"${choice === 'gift' ? ' checked' : ''}>
                <span><strong>Nothing, it's a gift</strong><small>Every ${escapeHtml(corp.ticker)} share rises in value, including the other holders'.</small></span>
            </label>
        `;
    }
    const issueShares = choices.querySelector('input:checked')?.value === 'shares';
    const preview = document.getElementById('addToCorpPreview');
    preview.hidden = ids.length === 0;
    preview.innerHTML = ids.length
        ? `<h4>Before you confirm</h4>${renderShareDealSummary(ShareDeals.summarizeContribution(gameState, corp, currentUser.id, ids, issueShares, addToCorpOptions()))}`
        : '';
    document.getElementById('add-to-corp-btn').disabled = ids.length === 0;
}

async function submitAddToCorporation() {
    const assetIds = selectedAddToCorpIds();
    if (!addToCorpId || !assetIds.length) return;
    const issueShares = document.querySelector('#addToCorpShares input:checked')?.value === 'shares';
    await submitGameAction('add_to_corporation', { corpId: addToCorpId, assetIds, issueShares }, {
        errorText: 'Failed to add properties',
        onSaved: () => closeModal('addToCorpModal'),
    });
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
    const tradeCashCovered = ['player1', 'player2'].map(updateTradeCashLimit).every(Boolean);
    const tradeValid = player1Id && player2Id && player1Id !== player2Id && [player1Id, player2Id].includes(currentUser.id)
        && tradeHasOffer && tradeCashCovered;
    const paymentValid = fromPlayerId && toPlayerId && fromPlayerId !== toPlayerId && fromPlayerId === currentUser.id && paymentAmount > 0;

    if (tradeBtn) tradeBtn.disabled = !tradeValid;
    if (paymentBtn) paymentBtn.disabled = !paymentValid;
    renderTradePreview();
}

// The most cash a trade side's player can put in: what they hold, never below zero.
function tradeCashMax(side) {
    const corp = tradingAsCorp(side);
    if (corp) return Math.max(0, Number(corp.cash) || 0);
    const userId = document.getElementById(`${side}Select`)?.value;
    const player = currentGame?.game_state?.players?.find(p => p.userId === userId);
    return Math.max(0, Number(player?.cash) || 0);
}

// Shows "(max $X)" next to a trade side's Cash and flags an amount above
// what that player holds. Returns whether the amount is covered.
function updateTradeCashLimit(side) {
    const input = document.getElementById(`${side}Cash`);
    const label = document.getElementById(`${side}CashMax`);
    if (!input || !label) return true;
    const max = tradeCashMax(side);
    const covered = (parseFloat(input.value) || 0) <= max;
    input.max = max;
    label.textContent = `(max ${formatMoney(max)})`;
    label.classList.toggle('is-over', !covered);
    input.setAttribute('aria-invalid', String(!covered));
    return covered;
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
                        <h4>${escapeHtml(tradeSideName(offer, 'player1'))} gives</h4>
                        ${renderTradeOfferSide(offer.player1Cash, offer.player1AssetIds, offer.player1Shares, offer.player1PropertiesToCorpId)}
                    </div>
                    <div>
                        <h4>${escapeHtml(tradeSideName(offer, 'player2'))} gives</h4>
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

function tradeSideName(offer, side) {
    const ticker = offer[`${side}CorpTicker`];
    const name = offer[`${side}Name`];
    return ticker ? `${ticker} (via ${name})` : name;
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
    const short = ['player1', 'player2'].find(side => terms[`${side}Cash`] > tradeCashMax(side));
    if (short) {
        const name = tradingAsCorp(short)?.ticker || document.getElementById(`${short}Select`)?.selectedOptions[0]?.textContent || 'That player';
        showMarketStatus(`${name} only has ${formatMoney(tradeCashMax(short))} in cash.`, 'error');
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

// Pending house selections { propertyId: deltaCount }
let pendingHouseSelections = {};
let houseModalRender = null;

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

// ---------------------------------------------------------------
// House purchase
// ---------------------------------------------------------------
// Who can build: you on your complete groups, or a company you run on the
// groups it owns whole, paid from its treasury.
function houseBuilders(gameState) {
    const builders = [];
    if (getCompleteGroupProperties(currentUser.id, gameState).length) {
        builders.push({ id: '', ownerId: currentUser.id, label: 'You' });
    }
    ShareDeals.corporationsRunBy(gameState, currentUser.id).forEach(corp => {
        if (getCompleteGroupProperties(corp.id, gameState).length) {
            builders.push({ id: corp.id, ownerId: corp.id, label: corp.ticker });
        }
    });
    return builders;
}

let houseBuildForCorpId = '';

function openHouseModal(corpId = null) {
    if (!currentGame || !currentUser) return;
    const gameState = currentGame.game_state;
    const builders = houseBuilders(gameState);
    if (!builders.length) {
        showToast('Own a complete color group before buying houses or hotels.');
        return;
    }
    const preferred = builders.find(b => b.id === (corpId || '')) || builders[0];
    houseBuildForCorpId = preferred.id;
    const select = document.getElementById('houseBuildFor');
    select.innerHTML = builders.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`).join('');
    select.value = houseBuildForCorpId;
    document.getElementById('houseBuildForGroup').hidden = builders.length < 2;
    select.onchange = () => {
        houseBuildForCorpId = select.value;
        resetHouseSelections();
        if (houseModalRender) houseModalRender();
    };

    function builderProps() {
        const builder = builders.find(b => b.id === houseBuildForCorpId) || builders[0];
        return getCompleteGroupProperties(builder.ownerId, gameState);
    }

    function resetHouseSelections() {
        pendingHouseSelections = {};
        builderProps().forEach(p => { pendingHouseSelections[p.id] = 0; });
    }
    resetHouseSelections();

    function renderHouseModal() {
        const corp = houseBuildForCorpId ? gameState.corporations.find(c => c.id === houseBuildForCorpId) : null;
        const myPlayer = gameState.players.find(p => p.userId === currentUser.id);
        const cash = corp ? Number(corp.cash || 0) : (myPlayer ? myPlayer.cash : 0);
        const myProps = builderProps();
        let totalCost = 0;
        Object.entries(pendingHouseSelections).forEach(([id, delta]) => {
            const prop = gameState.properties.find(p => p.id === id);
            if (prop) totalCost += delta * (HOUSE_COSTS[prop.color] || 0);
        });
        const rowsHtml = myProps.map(prop => {
            const delta = pendingHouseSelections[prop.id] || 0;
            const currentHouses = prop.houses || 0;
            const newHouses = currentHouses + delta;
            const costPer = HOUSE_COSTS[prop.color] || 0;
            const developmentLabel = getPropertyDevelopmentLabel({ ...prop, houses: newHouses });
            const isAtHotel = newHouses >= 5;
            return `
                <div class="house-property-row">
                    <div>
                        <span class="house-swatch" style="background:${escapeHtml(PROP_COLORS[prop.color])}"></span>
                        <strong>${escapeHtml(prop.name)}</strong>
                        <small>${formatMoney(costPer)} per improvement</small>
                    </div>
                    <div class="house-count-control">
                        <button data-game-action="adjust-house" data-property-id="${escapeHtml(prop.id)}" data-delta="-1" ${delta <= 0 ? 'disabled' : ''}>−</button>
                        <span>${escapeHtml(developmentLabel)}</span>
                        <button data-game-action="adjust-house" data-property-id="${escapeHtml(prop.id)}" data-delta="1" ${isAtHotel ? 'disabled' : ''}>+</button>
                    </div>
                </div>`;
        }).join('');

        document.getElementById('houseModalProperties').innerHTML = rowsHtml;
        document.getElementById('houseModalTotal').textContent = corp
            ? `Total cost ${formatMoney(totalCost)}, from the ${corp.ticker} treasury. It has ${formatMoney(cash)}.`
            : `Total cost ${formatMoney(totalCost)}. You have ${formatMoney(cash)}.`;
    }

    houseModalRender = renderHouseModal;

    renderHouseModal();
    openModal('houseModal');
}

function houseModalAdjust(propertyId, delta) {
    const gameState = currentGame?.game_state;
    if (!gameState) return;
    const prop = gameState.properties.find(p => p.id === propertyId);
    if (!prop) return;
    const current = pendingHouseSelections[propertyId] || 0;
    const newHouses = (prop.houses || 0) + current + delta;
    if (newHouses < (prop.houses || 0) || newHouses > 5) return;
    pendingHouseSelections[propertyId] = current + delta;
    if (houseModalRender) houseModalRender();
}

async function confirmHousePurchase() {
    if (!currentGame || !currentUser) return;

    const selections = Object.fromEntries(Object.entries(pendingHouseSelections).filter(([, delta]) => delta > 0));
    if (Object.keys(selections).length === 0) {
        showToast('No houses selected.');
        return;
    }
    await submitGameAction('buy_houses', houseBuildForCorpId ? { selections, corpId: houseBuildForCorpId } : { selections }, {
        errorText: 'Failed to purchase houses',
        onSaved: () => {
            pendingHouseSelections = {};
            houseModalRender = null;
            closeModal('houseModal');
        },
    });
}
