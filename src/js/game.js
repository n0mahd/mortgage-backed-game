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
        const storedTokens = sessionStorage.getItem('hotseat_tokens');
        if (storedTokens) {
            isHotseatMode = true;
            hotseatTokens = JSON.parse(storedTokens);
        }

        // Get current user (player 1's token is already in localStorage for hotseat)
        const user = await getCurrentUser();
        if (!user) {
            window.location.href = 'auth.html';
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
                <div style="text-align:center;padding:40px 20px;">
                    <p style="color:#e74c3c;font-size:1.1rem;margin-bottom:16px;">
                        Failed to load game: ${escapeHtml(error.message)}
                    </p>
                    <button class="btn btn-primary" data-reload-page>Try again</button>
                    <a href="lobby.html" class="btn btn-secondary">Back to Lobby</a>
                </div>`;
            gameContent.querySelector('[data-reload-page]')?.addEventListener('click', () => window.location.reload());
        }
    }
});

// Load game and room data
async function loadGameData(roomId) {
    try {
        // Load room data
        const room = await apiFetch(`/rooms/${roomId}`);
        if (!room) throw new Error('Room not found');

        currentRoom = room;

        // Display room info
        document.getElementById('room-code').textContent = `Room: ${room.invite_code}`;

        // Load game data
        const game = await apiFetch(`/games/by-room/${roomId}`);
        if (!game) throw new Error('Game not found for this room');

        currentGame = game;
        lastGameSyncAt = Date.now();
        document.getElementById('move-device-btn')?.toggleAttribute('hidden', isHotseatMode);

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
    }, () => resyncGame());

    // Phones drop the socket when the screen locks or the browser goes to the
    // background, so catch up whenever the page comes back.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resyncGame();
    });
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) resyncGame();
    });
    window.addEventListener('online', () => resyncGame());
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        const connected = gameChannel?.isConnected();
        if (!connected || Date.now() - lastGameSyncAt > GAME_RESYNC_CONNECTED_MS) resyncGame();
    }, GAME_RESYNC_CHECK_MS);
}

// Fetch the latest game and apply it only if it is newer than what is shown.
function resyncGame() {
    if (!currentRoom || gameActionInFlight) return Promise.resolve();
    if (gameResyncInFlight) return gameResyncInFlight;
    gameResyncInFlight = (async () => {
        try {
            const game = await apiFetch(`/games/by-room/${currentRoom.id}`);
            lastGameSyncAt = Date.now();
            if (Number(game.state_version ?? 0) > Number(currentGame?.state_version ?? -1)) {
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
    if (!wasMyTurn && isMyTurnIn(game) && !isHotseatMode && window.TurnAlert) {
        window.TurnAlert.buzz();
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
    document.body.classList.toggle('game-paused', paused);

    const orderedPlayers = [
        ...gameState.players.filter(p => p.userId === currentUser.id),
        ...gameState.players.filter(p => p.userId !== currentUser.id)
    ];

    gameContent.innerHTML = `
        <div class="game-header">
            <h2>Current Turn: ${escapeHtml(currentPlayer.name)}</h2>
            ${paused ? '<p class="waiting-indicator">Game paused by host</p>' : (isMyTurn ? '<p class="turn-indicator">It\'s your turn!</p>' : '<p class="waiting-indicator">Waiting for other players...</p>')}
            <div class="landing-summary ${landing.canBuy ? 'can-buy' : ''}">
                <div>
                    <span class="landing-label">${escapeHtml(landing.label)}</span>
                    <strong>${escapeHtml(landing.squareName)}</strong>
                </div>
                <p>${escapeHtml(landing.detail)}</p>
            </div>
            ${renderCashWarning(currentPlayer, isMyTurn)}
            ${renderPauseBanner(gameState)}
            ${renderLastCardSummary(gameState, currentPlayer)}
            ${renderTurnChecklist(gameState, currentPlayer, landing, isMyTurn)}
        </div>

        <div class="players-grid">
            ${orderedPlayers.map(player => renderPlayerCard(player, player.userId === currentUser.id)).join('')}
        </div>

        ${renderAuctionPanel(gameState)}

        ${paused ? renderPausedActions(gameState) : (isMyTurn ? renderActionButtons() : renderNonTurnActions())}

        <div class="recent-log">
            <h3>Recent Actions</h3>
            <div class="log-entries">
                ${gameState.gameLog.slice(-5).reverse().map(entry => `
                    <div class="log-entry">
                        <span class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                        <span class="log-message">${entry.message}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    updateTurnBanner();
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
    const claim = getBankruptcyClaimForPlayer(currentPlayer?.userId);
    if (!currentPlayer || currentPlayer.bankrupt || (Number(currentPlayer.cash || 0) >= 0 && !claim)) return '';
    if (claim) {
        const unpaid = Number(claim.unpaidAmount || 0).toFixed(2);
        const creditor = claim.creditorName || 'the creditor';
        const message = isMyTurn
            ? `You have $${unpaid} unpaid to ${creditor}. Raise cash before ending your turn or End Turn will declare bankruptcy.`
            : `${currentPlayer.name} has $${unpaid} unpaid to ${creditor} and must resolve it before ending the turn.`;
        return `<div class="turn-warning danger">${escapeHtml(message)}</div>`;
    }
    const amount = Math.abs(Number(currentPlayer.cash || 0)).toFixed(2);
    const message = isMyTurn
        ? `You are $${amount} below zero. Recover before ending your turn or End Turn will declare bankruptcy.`
        : `${currentPlayer.name} is $${amount} below zero and must recover before ending the turn.`;
    return `<div class="turn-warning danger">${escapeHtml(message)}</div>`;
}

function getBankruptcyClaimForPlayer(playerId) {
    if (!playerId || !currentGame?.game_state?.bankruptcyClaims) return null;
    const claim = currentGame.game_state.bankruptcyClaims[playerId];
    return claim && Number(claim.unpaidAmount || 0) > 0 ? claim : null;
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
    const isHost = currentRoom && currentUser.id === currentRoom.host_id;
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
                    <h3>${escapeHtml(auction.propertyName || property?.name || 'Property')}</h3>
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

function formatAuctionExpiry(expiresAt) {
    if (!expiresAt) return '';
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime())) return '';
    const seconds = Math.max(Math.ceil((expiry.getTime() - Date.now()) / 1000), 0);
    if (seconds <= 0) return 'Auction timeout reached. The next action will resolve it.';
    return `Timeout if idle for ${seconds}s more.`;
}

function renderTurnChecklist(gameState, currentPlayer, landing, isMyTurn) {
    const hasRolled = !!currentPlayer.diceRolled;
    const ended = !!gameState.ended;
    const waitingForJailChoice = currentPlayer.inJail && !hasRolled;
    const items = [
        {
            label: waitingForJailChoice ? 'Jail' : 'Roll',
            state: hasRolled ? 'complete' : (isMyTurn ? 'current' : 'upcoming'),
            detail: hasRolled
                ? formatDiceLabel(gameState.lastDiceRoll)
                : (waitingForJailChoice ? 'Roll doubles, pay fine, or use card' : 'Waiting for dice'),
        },
        {
            label: 'Resolve',
            state: !hasRolled ? 'upcoming' : (landing.canBuy ? 'current' : 'complete'),
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

    return `
        <div class="turn-checklist" aria-label="Turn progress">
            ${items.map(item => `
                <div class="turn-step ${item.state}">
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

function getLandingSummary(gameState, player) {
    const position = player.position || 0;
    const square = BOARD_SQUARES[position] || BOARD_SQUARES[0];
    const dice = Array.isArray(gameState.lastDiceRoll) ? gameState.lastDiceRoll : null;
    const label = dice ? `Rolled ${dice[0]} + ${dice[1]}` : `Position ${position}`;
    const property = square.propertyId
        ? gameState.properties.find(prop => prop.id === square.propertyId)
        : null;
    const isBuyableSquare = ['property', 'railroad', 'utility'].includes(square.type);
    const canBuy = !!(isBuyableSquare && property && !property.ownerId);

    if (canBuy) {
        return {
            label,
            squareName: square.name,
            detail: `Unowned ${square.type.replace('_', ' ')}. You can buy it for $${property.price}.`,
            canBuy,
        };
    }

    if (isBuyableSquare && property && property.ownerId) {
        const owner = gameState.players.find(p => p.userId === property.ownerId);
        const ownerName = owner ? owner.name : property.ownerName || 'another player';
        return {
            label,
            squareName: square.name,
            detail: property.ownerId === player.userId ? 'You already own this square.' : `Owned by ${ownerName}.`,
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
        label,
        squareName: square.name,
        detail: detailsByType[square.type] || 'No purchasable property on this square.',
        canBuy: false,
    };
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
    const square = (typeof BOARD_SQUARES !== 'undefined' ? BOARD_SQUARES : [])
        .find(item => item.propertyId === propertyId);
    return square ? square.position : 999;
}

function propertyAssetValue(property) {
    if (property.value != null && Number.isFinite(Number(property.value))) {
        return Number(property.value);
    }
    return Number(property.price || 0) + Number(property.houses || 0) * (HOUSE_COSTS[property.color] || 0);
}

function getPropertyColorValue(color) {
    if (typeof PROP_COLORS !== 'undefined' && PROP_COLORS[color]) return PROP_COLORS[color];
    if (color && !color.includes(' ')) return color;
    return '#64748b';
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
        <div class="player-properties">
            <div class="player-section-heading">
                <h4>Properties</h4>
                <span>${ownedProperties.length} owned &middot; $${totalValue.toFixed(0)} value</span>
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
                        <div class="owned-property-row" style="--property-color:${escapeAttr(color)};--property-ink:${escapeAttr(ink)};">
                            ${getPropertyIconHtml(property)}
                            <div class="owned-property-copy">
                                <div class="owned-property-title">
                                    <strong>${escapeHtml(property.name)}</strong>
                                </div>
                                <div class="owned-property-meta">
                                    <span>${escapeHtml(typeLabel)}</span>
                                    <span>Value $${propertyAssetValue(property).toFixed(0)}</span>
                                </div>
                                <div class="owned-property-chips">
                                    <span class="owned-property-chip set-chip ${groupClass}">${escapeHtml(groupStatus.label)}</span>
                                    <span class="owned-property-chip development-chip">
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
    const totalPropertyValue = ownedProperties.reduce((sum, p) => sum + propertyAssetValue(p), 0);
    const corporationValue = getPlayerCorporationValue(player);
    const debtTotal = getDebtTotal(player.debts);
    const netWorth = player.cash + totalPropertyValue + corporationValue - debtTotal;
    const cashFlow = getEntityCashFlow(player.userId);
    const bankruptBadge = player.bankrupt ? '<span class="badge badge-danger">Bankrupt</span>' : '';
    const jailBadges = [
        player.inJail ? '<span class="badge badge-warning">In jail</span>' : '',
        player.hasGetOutOfJailCard ? '<span class="badge">Get Out of Jail Free card</span>' : '',
    ].join('');
    const cardClass = player.bankrupt ? 'bankrupt' : '';

    const cardDetails = `
        <div class="player-stats">
            <div class="stat">
                <span class="stat-label">Cash:</span>
                <span class="stat-value">$${player.cash.toFixed(2)}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Properties:</span>
                <span class="stat-value">${ownedProperties.length}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Net Worth:</span>
                <span class="stat-value">$${netWorth.toFixed(2)}</span>
            </div>
        </div>
        <div class="cash-flow-summary">
            <div><span>Paid this turn</span><strong>$${cashFlow.paid.toFixed(2)}</strong></div>
            <div><span>Received this turn</span><strong>$${cashFlow.received.toFixed(2)}</strong></div>
            <div><span>Received between turns</span><strong>$${cashFlow.receivedBetweenTurns.toFixed(2)}</strong></div>
        </div>
        ${ownedProperties.length > 0 ? `
            ${renderOwnedProperties(player, ownedProperties)}
        ` : ''}
        ${player.corporations.length > 0 ? `
            <div class="player-corporations">
                <h4>Corporations:</h4>
                ${player.corporations.map(c => `
                    <div class="corp-badge">
                        ${escapeHtml(c.ticker)} (${c.sharesOwned}/${c.totalShares} shares, ${ownershipPercent(c.sharesOwned, c.totalShares)}%)
                        <span class="corp-assets-owned">NAV: $${getPlayerCorporationShareValue(c).toFixed(2)}/share</span>
                        ${c.insolvent ? '<span class="badge badge-danger">Insolvent</span>' : ''}
                        ${renderCorporationAssetSummary(c.id)}
                    </div>
                `).join('')}
            </div>
        ` : ''}
        ${player.debts.length > 0 ? `
            <div class="player-debts">
                <h4>Debts:</h4>
                ${player.debts.map(d => `
                    <div class="debt-badge">
                        $${Number(d.principal || 0).toFixed(2)} @ ${Number(d.interestRate || 0)}%
                        <span>Interest next turn: $${interestPayment(d).toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;

    if (isCurrentUser) {
        return `
            <div class="player-card current-user ${cardClass}">
                <div class="player-header">
                    <h3>${escapeHtml(player.name)}</h3>
                    <span class="badge">You</span>
                    ${bankruptBadge}
                    ${jailBadges}
                </div>
                ${cardDetails}
            </div>
        `;
    }

    return `
        <div class="player-card player-card-other collapsed ${cardClass}" data-player-id="${player.userId}">
            <div class="player-card-summary">
                <span class="player-name-sm">${escapeHtml(player.name)}</span>
                ${bankruptBadge}
                ${jailBadges}
                <span class="player-stat-sm">$${player.cash.toFixed(0)}</span>
                <span class="player-stat-sm">NW: $${netWorth.toFixed(0)}</span>
                <span class="player-card-chevron">▼</span>
            </div>
            <div class="player-card-details" style="display:none;">
                <div class="player-header">
                    <h3>${escapeHtml(player.name)}</h3>
                </div>
                ${cardDetails}
            </div>
        </div>
    `;
}

function getDebtTotal(debts) {
    return (debts || []).reduce((sum, debt) => sum + Number(debt.principal || 0), 0);
}

function interestPayment(debt) {
    return Number(debt.principal || 0) * (Number(debt.interestRate || 0) / 100);
}

function getPlayerCorporationValue(player) {
    return (player.corporations || []).reduce((sum, corp) => {
        return sum + Number(corp.sharesOwned || 0) * getPlayerCorporationShareValue(corp);
    }, 0);
}

function getPlayerCorporationShareValue(playerCorp) {
    if (Number.isFinite(Number(playerCorp.shareValue))) return Number(playerCorp.shareValue);
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === playerCorp.id);
    return corp ? getCorporationShareValue(corp) : Number(playerCorp.pricePerShare || 0);
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

function getCorporationDebtValue(corp) {
    return (corp.debts || []).reduce((sum, debt) => sum + Number(debt.principal || 0), 0);
}

function getCorporationNetAssetValue(corp) {
    if (corp.insolvent || corp.status === 'insolvent') return 0;
    return getCorporationAssetValue(corp) + Number(corp.cash || 0) - getCorporationDebtValue(corp);
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
        .map(asset => escapeHtml(asset.name))
        .join(', ');
    return `<span class="corp-assets-owned">Assets: ${assets}</span>`;
}

function getMyShares(corp) {
    const holder = (corp.shareholders || []).find(item => item.userId === currentUser.id);
    return holder ? Number(holder.shares || 0) : 0;
}

function getListedShares(corp) {
    return Math.max(0, Number(corp.availableShares || 0));
}

function getTreasuryListedShares(corp) {
    return Math.min(Math.max(0, Number(corp.treasuryShares || 0)), getListedShares(corp));
}

function getFounderListedShares(corp) {
    return Math.max(0, getListedShares(corp) - getTreasuryListedShares(corp));
}

function getBuyableListedShares(corp, userId) {
    if (corp.founderId === userId) return getTreasuryListedShares(corp);
    return getListedShares(corp);
}

function togglePlayerCard(summaryEl) {
    const details = summaryEl.nextElementSibling;
    const chevron = summaryEl.querySelector('.player-card-chevron');
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    chevron.textContent = isOpen ? '▼' : '▲';
    summaryEl.closest('.player-card').classList.toggle('collapsed', isOpen);
}

function renderImprovePropertiesButton(gameState, player, auctionOpen) {
    const completeGroupProperties = getCompleteGroupProperties(player.userId, gameState);
    if (!completeGroupProperties.length) return '';

    const hasAvailableImprovement = completeGroupProperties.some(prop => Number(prop.houses || 0) < 5);
    if (!hasAvailableImprovement) {
        return '<button class="btn btn-secondary btn-sm" disabled title="All complete color groups already have hotels">Hotels Built</button>';
    }

    if (auctionOpen) {
        return '<button class="btn btn-secondary btn-sm" disabled title="Resolve auction before buying houses or hotels">Buy Houses / Hotels</button>';
    }

    return '<button class="btn btn-success btn-sm" data-game-action="open-house">Buy Houses / Hotels</button>';
}

// Render action buttons for current player's turn
function renderActionButtons() {
    const gameState = currentGame.game_state;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const hasRolled = currentPlayer.diceRolled;
    const isHost = currentUser.id === currentRoom.host_id;
    const landing = getLandingSummary(gameState, currentPlayer);
    const endTurnLabel = Number(currentPlayer.cash || 0) < 0 || getBankruptcyClaimForPlayer(currentPlayer.userId) ? 'Declare Bankruptcy' : 'End Turn';
    const auctionOpen = gameState.auction?.status === 'open';
    const waitingForJailChoice = currentPlayer.inJail && !hasRolled;
    const rollButtonLabel = waitingForJailChoice ? '🎲 Roll for Doubles' : '🎲 Roll Dice';
    const jailChoiceButtons = waitingForJailChoice ? `
        <button class="btn btn-warning btn-sm" data-game-action="pay-jail-fine">Pay $50 Fine</button>
        ${currentPlayer.hasGetOutOfJailCard ? '<button class="btn btn-success btn-sm" data-game-action="use-jail-card">Use Jail Card</button>' : ''}
    ` : '';
    const buyButton = landing.canBuy
        ? '<button class="btn btn-success btn-sm action-btn-buy" data-game-action="open-buy-property">Buy Property</button>'
        : `<button class="btn btn-secondary btn-sm action-btn-buy" disabled title="${escapeHtml(landing.detail)}">${escapeHtml(buyUnavailableLabel(landing))}</button>`;
    const improveButton = renderImprovePropertiesButton(gameState, currentPlayer, auctionOpen);
    return `
        <div class="action-buttons">
            ${!hasRolled ? `<button class="btn btn-primary" style="margin-bottom:8px;width:100%;" data-game-action="roll-dice">${rollButtonLabel}</button>` : ''}
            <div class="action-btn-secondary-group">
                ${jailChoiceButtons}
                ${auctionOpen ? '<button class="btn btn-secondary btn-sm action-btn-buy" disabled>Auction Open</button>' : buyButton}
                ${improveButton}
                <button class="btn btn-secondary btn-sm" data-game-action="open-ipo" ${auctionOpen ? 'disabled' : ''}>Create IPO</button>
                <button class="btn btn-secondary btn-sm" data-game-action="open-debt" ${auctionOpen ? 'disabled' : ''}>Manage Debt</button>
                <button class="btn btn-secondary btn-sm" data-game-action="open-corporation">Corporations</button>
                <button class="btn btn-success action-btn-end-turn" data-game-action="end-turn" ${!hasRolled || auctionOpen ? `disabled title="${auctionOpen ? 'Resolve auction before ending your turn' : 'Roll before ending your turn'}"` : ''}>${escapeHtml(auctionOpen ? 'Resolve Auction' : endTurnLabel)}</button>
                ${isHost ? '<button class="btn btn-warning btn-sm" data-game-action="host-pause">Pause Game</button>' : ''}
                ${isHost ? '<button class="btn btn-danger btn-sm" data-game-action="host-end">End Game</button>' : ''}
            </div>
        </div>
    `;
}

function buyUnavailableLabel(landing) {
    if (landing.detail.startsWith('Owned by')) return 'Property Owned';
    if (landing.detail.startsWith('You already own')) return 'Already Yours';
    return 'No Property to Buy';
}

function renderNonTurnActions() {
    const isHost = currentUser.id === currentRoom.host_id;
    return `
        <div class="action-buttons">
            <div class="action-btn-secondary-group">
                <button class="btn btn-secondary btn-sm" data-game-action="open-corporation">Corporations</button>
                ${isHost ? '<button class="btn btn-warning btn-sm" data-game-action="host-pause">Pause Game</button>' : ''}
                ${isHost ? '<button class="btn btn-danger btn-sm" data-game-action="host-end">End Game</button>' : ''}
            </div>
        </div>
    `;
}

function renderPausedActions() {
    const isHost = currentUser.id === currentRoom.host_id;
    return `
        <div class="action-buttons paused-actions">
            <div class="action-btn-secondary-group">
                <button class="btn btn-secondary btn-sm" data-game-action="open-corporation">Corporations</button>
                ${isHost ? '<button class="btn btn-success btn-sm" data-game-action="host-resume">Resume Game</button>' : ''}
                ${isHost ? '<button class="btn btn-danger btn-sm" data-game-action="host-end">End Game</button>' : ''}
            </div>
        </div>
    `;
}

// Format a game event into a human-readable string
function formatLogEvent(type, data) {
    switch (type) {
        case 'property_purchase':
            return `${data.buyer} purchased ${data.property} for $${Number(data.price).toFixed(2)}`;
        case 'ipo_created':
            return `${data.founder} created IPO ${data.ticker} — ${data.founderShares || data.shares} founder-owned shares listed at $${Number(data.pricePerShare).toFixed(2)}/share`;
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
            return `${data.actor ? `${data.actor} issued` : `${data.issuer} issued`} debt${data.actor ? ` under ${data.issuer}` : ''} of $${Number(data.amount).toFixed(2)} at ${data.interestRate}% interest`;
        case 'debt_payment':
            return `${data.payer} paid $${Number(data.amount).toFixed(2)} towards their debt`;
        case 'debt_refinanced':
            return `${data.borrower} refinanced ${data.refinancedDebtCount} debt(s) into $${Number(data.amount).toFixed(2)} at ${data.interestRate}% interest and received $${Number(data.netProceeds || 0).toFixed(2)} net cash`;
        case 'interest_accrual':
            return `${data.player} was charged $${Number(data.interestCharged).toFixed(2)} in interest`;
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

// Load game log from events table
async function loadGameLog() {
    try {
        const events = await apiFetch(`/games/${currentGame.id}/events`);

        const logContainer = document.getElementById('full-game-log');
        logContainer.innerHTML = events.map(event => `
            <div class="log-entry">
                <span class="log-time">${escapeHtml(new Date(event.created_at).toLocaleString())}</span>
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

// Open Buy Property Modal
async function openBuyPropertyModal() {
    const gameState = currentGame.game_state;
    const position = currentPlayerData.position || 0;
    const square = BOARD_SQUARES[position];

    if (!square || square.propertyId === null) {
        selectedPropertyId = null;
        document.getElementById('availableProperties').innerHTML =
            '<p style="color:#c0392b;padding:12px;">You must land on a property square to buy it.</p>';
        openModal('buyPropertyModal');
        return;
    }

    const property = gameState.properties.find(p => p.id === square.propertyId);

    if (!property || property.ownerId) {
        selectedPropertyId = null;
        document.getElementById('availableProperties').innerHTML =
            '<p style="color:#c0392b;padding:12px;">This property is already owned.</p>';
        openModal('buyPropertyModal');
        return;
    }

    const propertiesHtml = `
        <div class="property-card selected" data-property-id="${escapeAttr(property.id)}">
            <div class="property-color" style="background-color: ${property.color}"></div>
            <div class="property-name">${escapeHtml(property.name)}</div>
            <div class="property-price">$${property.price}</div>
        </div>
    `;

    selectedPropertyId = property.id;
    document.getElementById('purchasePrice').value = property.price;
    document.getElementById('purchasePriceDisplay').textContent = `$${Number(property.price).toFixed(2)}`;
    document.getElementById('availableProperties').innerHTML = propertiesHtml;
    openModal('buyPropertyModal');
}

let selectedPropertyId = null;

function selectProperty(propertyId) {
    selectedPropertyId = propertyId;
    document.querySelectorAll('.property-card').forEach(card => {
        card.classList.remove('selected');
    });
    const selectedCard = Array.from(document.querySelectorAll('.property-card'))
        .find(card => card.dataset.propertyId === propertyId);
    if (selectedCard) selectedCard.classList.add('selected');

    const property = currentGame.game_state.properties.find(p => p.id === propertyId);
    document.getElementById('purchasePrice').value = property.price;
    document.getElementById('purchasePriceDisplay').textContent = `$${Number(property.price).toFixed(2)}`;
}

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

    const purchasePrice = property.price;

    try {
        await performGameAction('buy_property', {});
        closeModal('buyPropertyModal');
        selectedPropertyId = null;

    } catch (error) {
        console.error('Error purchasing property:', error);
        alert('Failed to purchase property');
    }
}

async function startAuctionFromPurchase() {
    try {
        await performGameAction('start_auction', {});
        closeModal('buyPropertyModal');
        selectedPropertyId = null;
    } catch (error) {
        console.error('Error starting auction:', error);
        alert(error.message || 'Failed to start auction');
    }
}

async function placeAuctionBid() {
    const input = document.getElementById('auctionBidAmount');
    const amount = parseFloat(input?.value);
    if (!amount || amount <= 0) {
        alert('Enter a bid amount greater than $0.');
        return;
    }

    try {
        await performGameAction('place_bid', { amount });
    } catch (error) {
        console.error('Error placing auction bid:', error);
        alert(error.message || 'Failed to place bid');
    }
}

async function passAuction() {
    try {
        await performGameAction('pass_auction', {});
    } catch (error) {
        console.error('Error passing auction:', error);
        alert(error.message || 'Failed to pass auction');
    }
}

async function hostCancelAuction() {
    if (!confirm('Cancel this auction? No property or cash will move.')) return;
    try {
        await performGameAction('host_cancel_auction', {});
    } catch (error) {
        console.error('Error canceling auction:', error);
        alert(error.message || 'Failed to cancel auction');
    }
}

// Open IPO Modal
async function openIPOModal() {
    const assetsHtml = currentPlayerData.properties.map(p => `
        <div class="asset-checkbox">
            <input type="checkbox" id="ipo-asset-${escapeAttr(p.id)}" value="${escapeAttr(p.id)}">
            <label for="ipo-asset-${escapeAttr(p.id)}">${escapeHtml(p.name)} ($${p.value})</label>
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

    try {
        await performGameAction('create_ipo', {
            ticker,
            totalShares: numShares,
            pricePerShare,
            assetIds: selectedAssets.map(asset => asset.id),
        });
        closeModal('ipoModal');

    } catch (error) {
        console.error('Error creating IPO:', error);
        alert('Failed to create IPO');
    }
}

// Open Debt Modal
async function openDebtModal() {
    document.getElementById('debtAction').value = 'issue';
    const rate = Number(currentGame.game_state.settings?.interestRate || 5);
    document.getElementById('loanRate').value = String(rate);
    document.getElementById('loanRateDisplay').textContent = `${rate}% per turn`;
    document.getElementById('debtIssuer').innerHTML = debtIssuerOptionsHtml();
    document.getElementById('loanAmount').value = '';
    document.getElementById('settlementAmount').value = '';
    document.getElementById('refinanceAmount').value = '';
    renderDebtCollateralOptions();
    renderSettleDebtOptions();
    renderRefinanceDebtOptions();
    toggleDebtForm();

    openModal('debtModal');
}

function debtIssuerOptionsHtml() {
    const corporationOptions = getEligibleDebtCorporations().map(corp =>
        `<option value="corporation:${escapeAttr(corp.id)}">${escapeHtml(corp.ticker)} Corporation</option>`
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

function renderDebtCollateralOptions() {
    const issuer = document.getElementById('debtIssuer')?.value || 'player';
    let assets = currentPlayerData.properties || [];
    if (issuer.startsWith('corporation:')) {
        const corpId = issuer.split(':')[1];
        const corp = currentGame.game_state.corporations.find(item => item.id === corpId);
        assets = corp ? (corp.assets || []) : [];
    }

    renderCollateralAssetList('collateralAssets', assets);
}

function renderCollateralAssetList(containerId, assets, selectedIds = new Set()) {
    const assetsHtml = assets.map(p => {
        const checkboxId = `${containerId}-${p.id}`;
        const checked = selectedIds.has(p.id) ? ' checked' : '';
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${escapeAttr(checkboxId)}" value="${escapeAttr(p.id)}"${checked}>
            <label for="${escapeAttr(checkboxId)}">${escapeHtml(p.name)} ($${Number(p.value || p.price || 0).toFixed(2)})</label>
        </div>
    `;
    }).join('');

    document.getElementById(containerId).innerHTML = assetsHtml || '<p class="empty-state">No collateral assets available</p>';
}

function renderSettleDebtOptions() {
    const debtsHtml = getPersonalDebts().map((debt, index) => `
        <option value="${index}">${debtOptionLabel(debt, index)}</option>
    `).join('');

    document.getElementById('debtToSettle').innerHTML = debtsHtml || '<option value="">No debts to settle</option>';
    updateSettlementFullAmountState();
}

function renderRefinanceDebtOptions() {
    const debts = getPersonalDebts();
    const debtsHtml = debts.map((debt, index) => `
        <div class="asset-checkbox debt-choice">
            <input type="checkbox" id="refinance-debt-${index}" value="${index}" data-debt-id="${escapeAttr(debt.id || '')}">
            <label for="refinance-debt-${index}">
                ${debtOptionLabel(debt, index)}
                ${debtCollateralText(debt)}
            </label>
        </div>
    `).join('');

    document.getElementById('debtsToRefinance').innerHTML = debtsHtml || '<p class="empty-state">No debts to refinance</p>';
    renderRefinanceCollateralOptions();
    updateRefinanceSummary();
}

function getPersonalDebts() {
    return Array.isArray(currentPlayerData?.debts) ? currentPlayerData.debts : [];
}

function debtPrincipal(debt) {
    return Number(debt?.principal || 0);
}

function debtOptionLabel(debt, index) {
    return `Loan #${index + 1}: $${debtPrincipal(debt).toFixed(2)} @ ${Number(debt?.interestRate || 0)}%`;
}

function debtCollateralText(debt) {
    const collateral = Array.isArray(debt?.collateral) ? debt.collateral : [];
    if (!collateral.length) return '';
    const names = collateral.map(asset => escapeHtml(asset.name || asset.id || 'Asset')).join(', ');
    return `<span class="debt-detail">Backed by: ${names}</span>`;
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

function renderRefinanceCollateralOptions() {
    const selectedCollateralIds = new Set();
    getSelectedRefinanceDebtItems().forEach(item => {
        (Array.isArray(item.debt.collateral) ? item.debt.collateral : []).forEach(asset => {
            if (asset?.id) selectedCollateralIds.add(asset.id);
        });
    });
    renderCollateralAssetList('refinanceCollateralAssets', currentPlayerData.properties || [], selectedCollateralIds);
}

function updateSettlementFullAmountState() {
    const debtIndex = parseInt(document.getElementById('debtToSettle').value, 10);
    const debt = getPersonalDebts()[debtIndex];
    const button = document.getElementById('payFullDebtBtn');
    if (!button) return;
    button.disabled = !debt;
}

function fillFullSettlementAmount() {
    const debtIndex = parseInt(document.getElementById('debtToSettle').value, 10);
    const debt = getPersonalDebts()[debtIndex];
    if (!debt) return;
    const input = document.getElementById('settlementAmount');
    input.value = debtPrincipal(debt).toFixed(2);
    input.focus();
}

function updateRefinanceSummary() {
    const summary = document.getElementById('refinanceSummary');
    if (!summary) return;
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

function toggleDebtForm() {
    const action = document.getElementById('debtAction').value;
    document.getElementById('issueDebtForm').style.display = action === 'issue' ? 'block' : 'none';
    document.getElementById('settleDebtForm').style.display = action === 'settle' ? 'block' : 'none';
    document.getElementById('refinanceDebtForm').style.display = action === 'refinance' ? 'block' : 'none';
    if (action === 'settle') updateSettlementFullAmountState();
    if (action === 'refinance') updateRefinanceSummary();
}

async function processDebt() {
    const action = document.getElementById('debtAction').value;

    if (action === 'issue') {
        await issueDebt();
    } else if (action === 'settle') {
        await settleDebt();
    } else if (action === 'refinance') {
        await refinanceDebt();
    }
}

async function issueDebt() {
    const loanAmount = parseFloat(document.getElementById('loanAmount').value);
    const interestRate = Number(currentGame.game_state.settings?.interestRate || document.getElementById('loanRate').value || 5);
    const issuer = document.getElementById('debtIssuer').value || 'player';
    const issuerType = issuer.startsWith('corporation:') ? 'corporation' : 'player';
    const corpId = issuerType === 'corporation' ? issuer.split(':')[1] : null;

    const selectedCollateral = Array.from(document.querySelectorAll('#collateralAssets input:checked'))
        .map(cb => cb.value);

    if (!loanAmount) {
        alert('Please enter a loan amount');
        return;
    }

    try {
        await performGameAction('issue_debt', {
            amount: loanAmount,
            interestRate,
            issuerType,
            corpId,
            collateralIds: selectedCollateral,
        });
        closeModal('debtModal');

    } catch (error) {
        console.error('Error issuing debt:', error);
        alert('Failed to issue debt');
    }
}

async function settleDebt() {
    const debtIndex = parseInt(document.getElementById('debtToSettle').value, 10);
    const paymentAmount = parseFloat(document.getElementById('settlementAmount').value);

    if (isNaN(debtIndex) || !paymentAmount) {
        alert('Please select a debt and enter payment amount');
        return;
    }

    if (currentPlayerData.cash < paymentAmount) {
        alert('Insufficient funds');
        return;
    }

    try {
        const debt = currentPlayerData.debts[debtIndex];
        await performGameAction('pay_debt', {
            debtId: debt && debt.id,
            debtIndex,
            amount: paymentAmount,
        });
        closeModal('debtModal');

    } catch (error) {
        console.error('Error settling debt:', error);
        alert('Failed to settle debt');
    }
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

    const selectedCollateral = Array.from(document.querySelectorAll('#refinanceCollateralAssets input:checked'))
        .map(cb => cb.value);

    try {
        await performGameAction('refinance_debt', {
            amount: refinanceAmount,
            debtIds: selectedItems.map(item => item.debt.id).filter(Boolean),
            debtIndexes: selectedItems.map(item => item.index),
            collateralIds: selectedCollateral,
        });
        closeModal('debtModal');

    } catch (error) {
        console.error('Error refinancing debt:', error);
        alert('Failed to refinance debt');
    }
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
        const isInsolvent = !!corp.insolvent || corp.status === 'insolvent';
        const buyableShares = getBuyableListedShares(corp, currentUser.id);
        const canBuy = isMyTurn && buyableShares > 0 && !isInsolvent;
        const governanceHtml = renderChairmanGovernance(corp);
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
            ${canBuy ? `
                <div class="buy-shares-form" style="margin-top: 10px; padding: 10px; background: #f0f4ff; border-radius: 6px;">
                    <label>${buyLabel} (max ${buyableShares}):</label>
                    <input type="number" id="buyShares-${escapeAttr(corp.id)}" min="1" max="${buyableShares}" value="1" style="width: 80px; margin: 0 8px;">
                    <button class="btn btn-primary" style="padding: 4px 12px; font-size: 0.9rem;" data-game-action="buy-shares" data-corp-id="${escapeAttr(corp.id)}">Buy</button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('');

    document.getElementById('corporationList').innerHTML = corporationsHtml || '<p>No corporations created yet</p>';
    openModal('corporationModal');
}

function renderChairmanGovernance(corp) {
    if (corp.insolvent || corp.status === 'insolvent') {
        return `
            <div class="chairman-governance">
                <h4>Chairman Governance</h4>
                <p class="empty-state">Governance closed after insolvency.</p>
            </div>
        `;
    }
    const myShares = sharesForUi(corp, currentUser.id);
    const candidates = chairmanCandidateOptions(corp);
    const voteOptions = candidates.map(player =>
        `<option value="${escapeAttr(player.userId)}">${escapeHtml(player.name)}</option>`
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
                    ${canSupport ? `<button class="btn btn-primary btn-sm" data-game-action="support-chairman-vote" data-corp-id="${escapeAttr(corp.id)}" data-vote-id="${escapeAttr(vote.id)}">Support</button>` : ''}
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
                    <select id="chairmanMajority-${escapeAttr(corp.id)}">${voteOptions}</select>
                    <button class="btn btn-primary btn-sm" data-game-action="change-chairman-majority" data-corp-id="${escapeAttr(corp.id)}">Change Chairman</button>
                </div>
            ` : ''}
            ${myShares > 0 ? `
                <div class="governance-control">
                    <label>Propose vote:</label>
                    <select id="chairmanVoteCandidate-${escapeAttr(corp.id)}">${voteOptions}</select>
                    <button class="btn btn-secondary btn-sm" data-game-action="propose-chairman-vote" data-corp-id="${escapeAttr(corp.id)}">Propose</button>
                </div>
            ` : ''}
            <div class="chairman-votes">
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
        sharesForUi(corp, player.userId) > 0
    );
}

function majorityHolderName(corp) {
    const holder = (corp.shareholders || []).find(shareholder => hasMajoritySharesUi(corp, shareholder.userId));
    return holder ? holder.name : null;
}

function sharesForUi(corp, userId) {
    const holder = (corp.shareholders || []).find(shareholder => shareholder.userId === userId);
    return Number(holder?.shares || 0);
}

function hasMajoritySharesUi(corp, userId) {
    return sharesForUi(corp, userId) > Number(corp.totalShares || 0) / 2;
}

function majorityThresholdUi(corp) {
    return Math.floor(Number(corp.totalShares || 0) / 2) + 1;
}

function voteSupportSharesUi(corp, vote) {
    return (vote.supporters || []).reduce((sum, supporter) => sum + sharesForUi(corp, supporter.userId), 0);
}

async function changeChairmanByMajority(corpId) {
    const candidateUserId = document.getElementById(`chairmanMajority-${corpId}`).value;
    try {
        await performGameAction('change_chairman', { corpId, candidateUserId });
        await openCorporationModal();
    } catch (error) {
        console.error('Error changing chairman:', error);
        alert('Failed to change chairman');
    }
}

async function proposeChairmanVote(corpId) {
    const candidateUserId = document.getElementById(`chairmanVoteCandidate-${corpId}`).value;
    try {
        await performGameAction('propose_chairman_vote', { corpId, candidateUserId });
        await openCorporationModal();
    } catch (error) {
        console.error('Error proposing chairman vote:', error);
        alert('Failed to propose chairman vote');
    }
}

async function supportChairmanVote(corpId, voteId) {
    try {
        await performGameAction('support_chairman_vote', { corpId, voteId });
        await openCorporationModal();
    } catch (error) {
        console.error('Error supporting chairman vote:', error);
        alert('Failed to support chairman vote');
    }
}

async function buyShares(corpId) {
    const gameState = currentGame.game_state;
    const corp = gameState.corporations.find(c => c.id === corpId);
    if (!corp) return;
    if (corp.insolvent || corp.status === 'insolvent') {
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

    try {
        await performGameAction('buy_shares', { corpId, shares: numShares });
        closeModal('corporationModal');

    } catch (error) {
        console.error('Error buying shares:', error);
        alert(error.message || 'Failed to buy shares');
    }
}

// End turn
async function endTurn() {
    try {
        const beforeUserId = currentUser.id;
        await performGameAction('end_turn', {});
        const gameState = currentGame.game_state;
        const nextPlayer = gameState.players[gameState.currentPlayerIndex];
        if (gameState.ended) return;

        // --- Hotseat: show pass-device screen before next player takes over ---
        if (isHotseatMode && nextPlayer && nextPlayer.userId !== beforeUserId) {
            showHotseatInterstitial(nextPlayer.name);
        }

    } catch (error) {
        console.error('Error ending turn:', error);
        alert(error.message || 'Failed to end turn');
    }
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
    localStorage.setItem('auth_token', record.token);

    // Update in-memory identity without an extra API round-trip
    currentUser = { id: record.userId, email: null, is_anonymous: true };
    currentPlayerData = gameState.players.find(p => p.userId === currentUser.id);

    // Re-render from the new player's perspective
    renderGameState(gameState);
    document.getElementById('hotseat-interstitial').style.display = 'none';
}

// End Game - compute net worth and show winner screen
async function triggerEndGame(gameState, reason) {
    try {
        await performGameAction('host_end_game', {});
        showWinnerFromState(currentGame.game_state, reason);

    } catch (error) {
        console.error('Error ending game:', error);
        alert('Failed to end game: ' + error.message);
    }
}

// Host-triggered end game
async function hostEndGame() {
    if (!confirm('End the game now and declare a winner by net worth?')) return;
    const gameState = currentGame.game_state;
    await triggerEndGame(gameState, 'Host ended the game.');
}

async function hostPauseGame() {
    if (!confirm('Pause the game for everyone? Players will not be able to take normal actions until the host resumes.')) return;
    try {
        await performGameAction('host_pause_game', { reason: 'Host paused the game' });
        showToast('Game paused.');
    } catch (error) {
        console.error('Error pausing game:', error);
        showToast(error.message || 'Failed to pause game.');
    }
}

async function hostResumeGame() {
    if (!confirm('Resume the game for everyone?')) return;
    try {
        await performGameAction('host_resume_game', {});
        showToast('Game resumed.');
    } catch (error) {
        console.error('Error resuming game:', error);
        showToast(error.message || 'Failed to resume game.');
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
        sessionStorage.removeItem('hotseat_tokens');
        if (currentRoom && currentRoom.invite_code) clearHotseatResume(currentRoom.invite_code);
    }
    const winner = standings[0];
    const standingsHtml = standings.map((p, i) => `
        <div class="standings-row ${p.bankrupt ? 'bankrupt' : ''}">
            <span class="rank">#${i + 1}</span>
            <span class="player-name">${escapeHtml(p.name)}${p.bankrupt ? ' (bankrupt)' : ''}</span>
            <span class="net-worth">$${Number(p.netWorth || 0).toFixed(2)}</span>
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
    modal.style.display = 'flex';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
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
    const isMyTurn = currentPlayer && currentPlayer.userId === currentUser.id;
    banner.style.display = isMyTurn ? 'flex' : 'none';
    const onGameTab = document.getElementById('game')?.classList.contains('active');
    const goBtn = banner.querySelector('button');
    if (goBtn) goBtn.style.display = onGameTab ? 'none' : '';
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

        const propertyCard = event.target.closest('.property-card[data-property-id]');
        if (propertyCard) {
            selectProperty(propertyCard.dataset.propertyId);
            return;
        }

        const actionButton = event.target.closest('[data-game-action]');
        if (actionButton) runGameAction(actionButton);
    });

    document.addEventListener('change', (event) => {
        if (event.target.closest('#player1Assets, #player2Assets')) {
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

async function shareMoveDeviceLink() {
    const link = document.getElementById('moveDeviceLink').value;
    if (!link) return;
    try {
        await navigator.clipboard.writeText(link);
        showToast('Link copied');
    } catch {
        const linkEl = document.getElementById('moveDeviceLink');
        linkEl.focus();
        linkEl.select();
        showToast('Select the link and copy it');
    }
}

function runGameAction(button) {
    if (!window.GameActionDispatcher) {
        console.warn('Game action dispatcher is not loaded:', button.dataset.gameAction);
        return;
    }
    window.GameActionDispatcher.run(button);
}

function populatePlayerDropdowns() {
    const gameState = currentGame.game_state;

    const player1Select = document.getElementById('player1Select');
    const player2Select = document.getElementById('player2Select');
    const paymentFromPlayer = document.getElementById('paymentFromPlayer');
    const paymentToPlayer = document.getElementById('paymentToPlayer');
    if (!player1Select || !player2Select || !paymentFromPlayer || !paymentToPlayer) return;

    const playersHtml = gameState.players.map(p =>
        `<option value="${escapeAttr(p.userId)}">${escapeHtml(p.name)}</option>`
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

    const assetsHtml = player.properties.map(p => `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeAttr(p.id)}" value="${escapeAttr(p.id)}">
            <label for="${playerNumber}-asset-${escapeAttr(p.id)}">${tradeAssetSwatch(p.id)}${escapeHtml(p.name)} ($${p.value})</label>
        </div>
    `).join('');
    const jailCardHtml = player.hasGetOutOfJailCard ? `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}" value="${GAME_JAIL_CARD_ASSET_ID}">
            <label for="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}">Get Out of Jail Free card</label>
        </div>
    ` : '';

    document.getElementById(assetsId).innerHTML = (assetsHtml + jailCardHtml) || '<p>No properties</p>';
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
    const player1Assets = document.querySelectorAll('#player1Assets input:checked').length;
    const player2Assets = document.querySelectorAll('#player2Assets input:checked').length;

    const tradeHasOffer = player1Cash > 0 || player2Cash > 0 || player1Assets > 0 || player2Assets > 0;
    const tradeValid = player1Id && player2Id && player1Id !== player2Id && [player1Id, player2Id].includes(currentUser.id) && tradeHasOffer;
    const paymentValid = fromPlayerId && toPlayerId && fromPlayerId !== toPlayerId && fromPlayerId === currentUser.id && paymentAmount > 0;

    if (tradeBtn) tradeBtn.disabled = !tradeValid;
    if (paymentBtn) paymentBtn.disabled = !paymentValid;
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
        const isHost = currentRoom && currentUser.id === currentRoom.host_id;
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
                <div class="trade-offer-sides">
                    <div>
                        <h4>${escapeHtml(offer.player1Name)} gives</h4>
                        ${renderTradeOfferSide(offer.player1Cash, offer.player1AssetIds)}
                    </div>
                    <div>
                        <h4>${escapeHtml(offer.player2Name)} gives</h4>
                        ${renderTradeOfferSide(offer.player2Cash, offer.player2AssetIds)}
                    </div>
                </div>
                ${hasActions ? `
                    <div class="trade-offer-actions">
                        ${canAccept ? `<button class="btn btn-success btn-sm" data-game-action="accept-trade-offer" data-offer-id="${escapeAttr(offer.id)}">Accept</button>` : ''}
                        ${canCancel ? `<button class="btn btn-secondary btn-sm" data-game-action="cancel-trade-offer" data-offer-id="${escapeAttr(offer.id)}">${expired ? 'Clear Expired' : (canAccept ? 'Decline' : 'Cancel')}</button>` : ''}
                        ${canHostCancel ? `<button class="btn btn-danger btn-sm" data-game-action="host-cancel-trade-offer" data-offer-id="${escapeAttr(offer.id)}">${expired ? 'Clear Expired' : 'Host Cancel'}</button>` : ''}
                    </div>
                ` : `<p class="empty-state">${canClearExpired ? 'Clear this expired offer from the involved player view.' : 'Waiting on the involved players'}</p>`}
            </div>
        `;
    }).join('');
}

function renderTradeOfferSide(cash, assetIds) {
    const lines = [];
    if (Number(cash || 0) > 0) lines.push(`<li class="trade-asset-line">${tradeAssetSwatch(null)}${escapeHtml(`$${Number(cash).toFixed(2)}`)}</li>`);
    (assetIds || []).forEach(id => {
        lines.push(`<li class="trade-asset-line">${tradeAssetSwatch(id)}${escapeHtml(tradeAssetName(id))}</li>`);
    });
    if (lines.length === 0) return '<p class="empty-state">Nothing</p>';
    return `<ul class="trade-asset-list">${lines.join('')}</ul>`;
}

function tradeAssetProperty(assetId) {
    return currentGame?.game_state?.properties?.find(prop => prop.id === assetId) || null;
}

function tradeAssetName(assetId) {
    if (assetId === GAME_JAIL_CARD_ASSET_ID) return 'Get Out of Jail Free card';
    const property = tradeAssetProperty(assetId);
    return property ? property.name : assetId;
}

// Color chip showing which group a traded asset belongs to; cash and cards get a hidden spacer chip.
function tradeAssetSwatch(assetId) {
    const property = assetId ? tradeAssetProperty(assetId) : null;
    if (!property) return '<span class="trade-asset-swatch neutral" aria-hidden="true"></span>';
    const color = getPropertyColorValue(property.color);
    return `<span class="trade-asset-swatch" style="--property-color:${escapeAttr(color)};" title="${escapeAttr(property.color || '')}" aria-hidden="true"></span>`;
}

function formatTradeOfferAge(createdAt) {
    if (!createdAt) return 'pending';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 'pending';
    return `sent ${formatTimeAgo(createdAt)}`;
}

function formatTradeOfferExpiry(expiresAt) {
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime())) return '';
    const seconds = Math.max(Math.ceil((expiry.getTime() - Date.now()) / 1000), 0);
    if (seconds <= 0) return 'expired';
    if (seconds < 60) return `expires in ${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    return `expires in ${minutes}m`;
}

function isTradeOfferExpiredForDisplay(offer) {
    if (!offer?.expiresAt) return false;
    const expiry = new Date(offer.expiresAt);
    return !Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now();
}

function actionEventsInclude(result, type) {
    return Array.isArray(result?.events) && result.events.some(event => event.type === type);
}

async function acceptTradeOffer(offerId) {
    try {
        const result = await performGameAction('accept_trade', { offerId });
        if (actionEventsInclude(result, 'trade_offer_expired')) {
            showMarketStatus('Trade offer expired before it could be accepted.', 'error');
        } else {
            showMarketStatus('Trade accepted and executed.', 'success');
        }
    } catch (error) {
        console.error('Error accepting trade offer:', error);
        showMarketStatus(error.message || 'Failed to accept trade offer.', 'error');
    }
}

async function cancelTradeOffer(offerId) {
    try {
        const result = await performGameAction('cancel_trade', { offerId });
        if (actionEventsInclude(result, 'trade_offer_expired')) {
            showMarketStatus('Trade offer expired and was cleared.', 'success');
        } else {
            showMarketStatus('Trade offer updated.', 'success');
        }
    } catch (error) {
        console.error('Error canceling trade offer:', error);
        showMarketStatus(error.message || 'Failed to update trade offer.', 'error');
    }
}

async function hostCancelTradeOffer(offerId) {
    if (!confirm('Cancel this trade offer as host? No cash or properties will move.')) return;
    try {
        const result = await performGameAction('host_cancel_trade_offer', { offerId });
        if (actionEventsInclude(result, 'trade_offer_expired')) {
            showMarketStatus('Trade offer expired and was cleared.', 'success');
        } else {
            showMarketStatus('Trade offer canceled by host.', 'success');
        }
    } catch (error) {
        console.error('Error host-canceling trade offer:', error);
        showMarketStatus(error.message || 'Failed to cancel trade offer.', 'error');
    }
}

async function executeTransaction() {
    const player1Id = document.getElementById('player1Select').value;
    const player2Id = document.getElementById('player2Select').value;
    const player1Cash = parseFloat(document.getElementById('player1Cash').value) || 0;
    const player2Cash = parseFloat(document.getElementById('player2Cash').value) || 0;

    const player1Assets = Array.from(document.querySelectorAll('#player1Assets input:checked'))
        .map(cb => cb.value);
    const player2Assets = Array.from(document.querySelectorAll('#player2Assets input:checked'))
        .map(cb => cb.value);

    if (player1Id === player2Id) {
        showMarketStatus('Choose two different players for a trade.', 'error');
        return;
    }
    if (![player1Id, player2Id].includes(currentUser.id)) {
        showMarketStatus('Your trade must include you.', 'error');
        return;
    }
    if (player1Cash <= 0 && player2Cash <= 0 && player1Assets.length === 0 && player2Assets.length === 0) {
        showMarketStatus('Add cash, property, or a Get Out of Jail Free card before proposing a trade.', 'error');
        return;
    }

    try {
        await performGameAction('propose_trade', {
            player1Id,
            player2Id,
            player1Cash,
            player2Cash,
            player1AssetIds: player1Assets,
            player2AssetIds: player2Assets,
        });
        showMarketStatus('Trade proposal sent. It will execute when the other player accepts.', 'success');

        // Reset form
        document.getElementById('player1Cash').value = 0;
        document.getElementById('player2Cash').value = 0;
        updatePlayerAssets('player1');
        updatePlayerAssets('player2');
        updateMarketActionState();

    } catch (error) {
        console.error('Error executing transaction:', error);
        showMarketStatus(error.message || 'Failed to execute transaction.', 'error');
    }
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

    try {
        await performGameAction('manual_payment', { fromPlayerId, toPlayerId, amount });
        showMarketStatus('Payment completed successfully.', 'success');
        document.getElementById('paymentAmount').value = '';
        updateMarketActionState();

    } catch (error) {
        console.error('Error making payment:', error);
        showMarketStatus(error.message || 'Failed to make payment.', 'error');
    }
}

// ============================================================
// BOARD TAB FUNCTIONS
// ============================================================

// Pending house selections { propertyId: deltaCount }
let pendingHouseSelections = {};
let houseModalRender = null;

// Show a brief toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px',
        'background:#2c3e50', 'color:#fff',
        'padding:12px 20px', 'border-radius:8px',
        'z-index:9999', 'font-size:0.9rem',
        'box-shadow:0 4px 12px rgba(0,0,0,0.25)',
        'max-width:320px', 'word-wrap:break-word'
    ].join(';');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

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
    try {
        const payload = Array.isArray(window.__E2E_NEXT_DICE)
            ? { testDice: window.__E2E_NEXT_DICE.splice(0, 2) }
            : {};
        await performGameAction('roll_dice', payload);
    } catch (error) {
        console.error('Error rolling dice:', error);
        alert(error.message || 'Failed to roll dice');
    }
}

async function payJailFine() {
    if (!currentGame || !currentUser) return;
    try {
        await performGameAction('pay_jail_fine', {});
    } catch (error) {
        console.error('Error paying Jail fine:', error);
        alert(error.message || 'Failed to pay Jail fine');
    }
}

async function useJailCard() {
    if (!currentGame || !currentUser) return;
    try {
        await performGameAction('use_get_out_of_jail_card', {});
    } catch (error) {
        console.error('Error using Get Out of Jail Free card:', error);
        alert(error.message || 'Failed to use Jail card');
    }
}

// ---------------------------------------------------------------
// House purchase
// ---------------------------------------------------------------
function openHouseModal() {
    if (!currentGame || !currentUser) return;
    const gameState = currentGame.game_state;
    const myProps = getCompleteGroupProperties(currentUser.id, gameState);
    if (!myProps.length) {
        showToast('Own a complete color group before buying houses or hotels.');
        return;
    }

    pendingHouseSelections = {};
    myProps.forEach(p => { pendingHouseSelections[p.id] = 0; });

    function renderHouseModal() {
        const myPlayer = gameState.players.find(p => p.userId === currentUser.id);
        const cash = myPlayer ? myPlayer.cash : 0;
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
                        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${PROP_COLORS[prop.color]};margin-right:6px;vertical-align:middle;"></span>
                        <strong>${escapeHtml(prop.name)}</strong>
                        <span style="color:#888;margin-left:6px;font-size:0.8rem;">($${costPer}/improvement)</span>
                    </div>
                    <div class="house-count-control">
                        <button data-game-action="adjust-house" data-property-id="${escapeAttr(prop.id)}" data-delta="-1" ${delta <= 0 ? 'disabled' : ''}>−</button>
                        <span style="min-width:72px;text-align:center;">${escapeHtml(developmentLabel)}</span>
                        <button data-game-action="adjust-house" data-property-id="${escapeAttr(prop.id)}" data-delta="1" ${isAtHotel ? 'disabled' : ''}>+</button>
                    </div>
                </div>`;
        }).join('');

        document.getElementById('houseModalProperties').innerHTML = rowsHtml;
        document.getElementById('houseModalTotal').textContent =
            `Total cost: $${totalCost}  |  Cash available: $${Math.round(cash)}`;
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

    try {
        const selections = Object.fromEntries(Object.entries(pendingHouseSelections).filter(([, delta]) => delta > 0));
        if (Object.keys(selections).length === 0) {
            showToast('No houses selected.');
            return;
        }
        await performGameAction('buy_houses', { selections });
        pendingHouseSelections = {};
        houseModalRender = null;
        closeModal('houseModal');

    } catch (error) {
        console.error('Error buying houses:', error);
        alert('Failed to purchase houses');
    }
}
