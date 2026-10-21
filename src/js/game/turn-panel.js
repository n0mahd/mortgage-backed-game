// The top of the Game tab: turn ticket, landing summary, warnings, auction panel,
// the action dock and moves grid (renderActionButtons), and host controls.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// The last dice shown, so the dice only animate when a new roll arrives.
let previousDiceSignature = null;

function renderTurnTicket(gameState, currentPlayer, landing, isMyTurn, paused) {
    const hasRolled = !!currentPlayer.diceRolled;
    const dice = hasRolled ? gameState.lastDiceRoll : null;
    const diceSignature = `${gameState.currentPlayerIndex}|${hasRolled}|${Array.isArray(dice) ? dice.join(',') : ''}`;
    const rolling = hasRolled && previousDiceSignature !== null && previousDiceSignature !== diceSignature;
    previousDiceSignature = diceSignature;

    const me = currentPlayerData || currentPlayer;
    const myNetWorth = getPlayerNetWorth(me);
    const visibleTitle = isMyTurn ? 'Your turn' : `${currentPlayer.name}'s turn`;
    let status;
    if (paused) status = 'Paused by the host';
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
    const { claim, unpaid, interest, cash, cashAfter } = outlook;
    const shortfall = formatMoney(Math.abs(cashAfter));
    const interestNote = interest > 0 ? ` after ${formatMoney(interest)} loan interest` : '';
    let message;
    let tone = 'danger';

    if (claim) {
        const owed = formatMoney(unpaid);
        const creditor = claim.creditorName || 'the creditor';
        if (outlook.settlesClaim) {
            tone = '';
            message = isMyTurn
                ? `You owe ${owed} to ${creditor}. End Turn pays it from your cash${interestNote}, leaving you ${formatMoney(cashAfter)}.`
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
            ? `You are ${formatMoney(-cash)} below zero. Raise ${shortfall}${interestNote} before ending your turn or End Turn will declare bankruptcy.`
            : `${currentPlayer.name} is ${formatMoney(-cash)} below zero and must recover before ending the turn.`;
    } else if (cashAfter < 0) {
        message = isMyTurn
            ? `${formatMoney(interest)} loan interest is due when you end your turn. Raise ${shortfall} more or End Turn will declare bankruptcy.`
            : `${currentPlayer.name} can't cover their loan interest and must raise ${shortfall} before ending the turn.`;
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
    const seconds = secondsUntil(expiresAt);
    if (seconds === null) return '';
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
            state: !hasRolled ? 'upcoming' : (landing.canBuy || gameState.auction?.status === 'open' ? 'current' : 'complete'),
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

function getLandingSummary(gameState, player) {
    const position = player.position || 0;
    const square = BOARD_SQUARES[position] || BOARD_SQUARES[0];
    const property = square.propertyId
        ? gameState.properties.find(prop => prop.id === square.propertyId)
        : null;
    const isBuyableSquare = ['property', 'railroad', 'utility'].includes(square.type);
    const canBuy = !!(isBuyableSquare && property && !property.ownerId);

    if (canBuy) {
        return {
            squareName: square.name,
            detail: `Unowned ${square.type.replace('_', ' ')}. Buy it or send it to auction.`,
            canBuy,
            price: property.price,
        };
    }

    if (isBuyableSquare && property && property.ownerId) {
        const owner = gameState.players.find(p => p.userId === property.ownerId);
        const ownerName = owner ? owner.name : property.ownerName || 'another player';
        return {
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

function renderImprovePropertiesButton(gameState, player, auctionOpen) {
    const completeGroupProperties = getCompleteGroupProperties(player.userId, gameState);
    if (!completeGroupProperties.length) return '';

    const hasAvailableImprovement = completeGroupProperties.some(prop => Number(prop.houses || 0) < 5);
    if (!hasAvailableImprovement) {
        return '<button class="btn btn-secondary btn-sm" disabled title="All complete color groups already have hotels">Hotels Built<small>Every set is maxed out</small></button>';
    }

    if (auctionOpen) {
        return '<button class="btn btn-secondary btn-sm" disabled title="Resolve auction before buying houses or hotels">Build Houses<small>After the auction</small></button>';
    }

    return '<button class="btn btn-success btn-sm is-featured" data-game-action="open-house">Build Houses<small>You own a full set</small></button>';
}

// Your turn: the dock holds the move the game needs next; optional moves sit in the grid.
// landing is getLandingSummary() for the current player.
function renderActionButtons(landing) {
    const gameState = currentGame.game_state;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const hasRolled = currentPlayer.diceRolled;
    const turnEnd = TurnEndOutlook.forPlayer(gameState, currentPlayer);
    const owesMoney = turnEnd.goesBankrupt;
    const endTurnLabel = owesMoney
        ? 'Declare Bankruptcy'
        : (turnEnd.settlesClaim ? `Pay ${formatMoney(turnEnd.unpaid)} & End Turn` : 'End Turn');
    const auctionOpen = gameState.auction?.status === 'open';
    const waitingForJailChoice = currentPlayer.inJail && !hasRolled;
    const rollButtonLabel = waitingForJailChoice ? 'Roll for Doubles' : 'Roll Dice';
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
    const endTurnButton = `<button class="btn ${endTurnClass} action-btn-end-turn" data-game-action="end-turn" ${endTurnDisabled}>${escapeHtml(auctionOpen ? 'Resolve Auction' : endTurnLabel)}</button>`;
    const primaryButton = !hasRolled
        ? `<button class="btn btn-primary" data-game-action="roll-dice">${rollButtonLabel}</button>`
        : (buyInDock ? `<button class="btn btn-success action-btn-buy" data-game-action="open-buy-property">Buy for ${formatMoney(landing.price)}</button>` : '');

    const buyTile = buyInDock || !hasRolled ? '' : (auctionOpen
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
            <button class="btn btn-secondary btn-sm" data-game-action="open-corporation">Corporations<small>Shares and chairmen</small></button>
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

function renderNonTurnActions() {
    return renderMovesGrid(`
        <button class="btn btn-secondary btn-sm" data-game-action="open-corporation">Corporations<small>Shares and chairmen</small></button>
        <button class="btn btn-secondary btn-sm" data-switch-section="market">Trade or pay<small>Opens the market</small></button>
    `);
}

function renderPausedActions() {
    return renderMovesGrid(`
        <button class="btn btn-secondary btn-sm" data-game-action="open-corporation">Corporations<small>Shares and chairmen</small></button>
    `);
}

// Host-only controls, kept away from turn actions so End Game is never a slip of the thumb.
function renderHostPanel(gameState) {
    if (!isRoomHost() || gameState.ended) return '';
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
