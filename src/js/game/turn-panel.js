// The top of the Game tab: turn ticket (with its stub and the final standings),
// warnings, auction panel, the action dock (renderActionButtons), the row of move
// tools (renderMoveTools) and host controls. The square in play is square-card.js.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// The last dice shown, so the dice only animate when a new roll arrives.
let previousDiceSignature = null;

function turnDiceState(gameState, currentPlayer) {
    const { hasRolled, hasMoved } = getRollState(gameState, currentPlayer);
    const dice = hasMoved ? gameState.lastDiceRoll : null;
    const diceSignature = `${gameState.currentPlayerIndex}|${hasRolled}|${Array.isArray(dice) ? dice.join(',') : ''}`;
    const rolling = !!dice && previousDiceSignature !== null && previousDiceSignature !== diceSignature;
    previousDiceSignature = diceSignature;
    return { dice, rolling };
}

function playerAvatarHtml(player, extraClass = '') {
    return `<span class="avatar${extraClass ? ` ${extraClass}` : ''}" style="--token-color:${escapeHtml(getPlayerColor(player))}" aria-hidden="true">${escapeHtml(playerInitials(player.name))}</span>`;
}

// The banknote: your cash and net worth, the only place they appear. On your turn it
// also says what kind of turn it is and holds the dice; before you roll its stub shows
// the money that moved since your last turn. Off your turn a strip in the current
// player's colour says whose turn it is, above a compact note with your cash.
function renderTurnTicket(gameState, currentPlayer, isMyTurn, paused) {
    if (gameState.ended) return renderFinalTicket(gameState);
    const { dice, rolling } = turnDiceState(gameState, currentPlayer);
    const me = currentPlayerData;
    const pausedClass = paused ? ' is-paused' : '';
    const turnLabel = `<span class="sr-only">Current Turn: ${escapeHtml(currentPlayer.name)}</span>`;

    if (!isMyTurn) {
        const strip = `
            <div class="turn-strip${pausedClass}" style="--turn-color:${escapeHtml(getPlayerColor(currentPlayer))}">
                ${playerAvatarHtml(currentPlayer, 'sm')}
                <strong class="turn-strip-title waiting-indicator">${turnLabel}<span aria-hidden="true">${escapeHtml(`${currentPlayer.name}'s turn`)}</span></strong>
                ${currentPlayer.inJail ? '<span class="badge badge-gold">In Jail</span>' : ''}
                ${dice ? renderDicePair(dice, { rolling }) : ''}
            </div>`;
        if (!me) return strip;
        return `${strip}
            <section class="game-header turn-ticket is-compact${pausedClass}">
                ${renderTicketMoney(me, true)}
            </section>`;
    }

    const { hasRolled, hasMoved, rollAgain } = getRollState(gameState, currentPlayer);
    const inJail = currentPlayer.inJail;
    const title = inJail ? 'In Jail' : (rollAgain ? 'Doubles!' : 'Your turn');
    const jailTurn = Math.min(Number(currentPlayer.jailTurns || 0), 2);
    const tries = inJail && !hasRolled ? `
        <span class="jail-tries" role="img" aria-label="Jail turn ${jailTurn + 1} of 3">
            ${[0, 1, 2].map(i => `<i class="${i < jailTurn ? 'is-used' : ''}${i === jailTurn ? ' is-now' : ''}"></i>`).join('')}
        </span>` : '';
    return `
        <section class="game-header turn-ticket is-mine${pausedClass}" style="--turn-color:${escapeHtml(getPlayerColor(currentPlayer))}">
            <div class="ticket-top">
                ${playerAvatarHtml(currentPlayer)}
                <div class="ticket-heading">
                    <h2 class="ticket-title ${paused ? 'waiting-indicator' : 'turn-indicator'}">${turnLabel}<span aria-hidden="true">${escapeHtml(title)}</span></h2>
                    ${tries}
                </div>
                ${renderDicePair(dice, { rolling })}
            </div>
            ${renderTicketMoney(me || currentPlayer, false)}
            ${hasMoved ? '' : renderTicketStub(gameState, currentPlayer.userId)}
        </section>
    `;
}

function renderTicketMoney(player, compact) {
    return `
        <div class="ticket-money">
            ${compact ? playerAvatarHtml(player, 'sm') : ''}
            <strong class="ticket-cash${Number(player.cash) < 0 ? ' is-negative' : ''}"><span class="sr-only">Your cash </span>${formatMoney(player.cash)}</strong>
            <div class="ticket-side">
                Net worth
                <strong>${formatMoney(Math.round(getPlayerNetWorth(player)))}</strong>
            </div>
        </div>`;
}

// Game over: the standings stay on the ticket, from the state, so a reload keeps them.
function renderFinalTicket(gameState) {
    const standings = finalStandingsFrom(gameState);
    const winner = standings[0];
    const draw = standings.length > 0 && standings.every(row => row.bankrupt);
    const playerFor = row => gameState.players.find(p => (row.userId && p.userId === row.userId) || p.name === row.name) || { name: row.name };
    const title = !winner ? 'Game over' : (draw ? "It's a draw" : `${winner.name} won`);
    return `
        <section class="game-header turn-ticket is-final"${winner && !draw ? ` style="--turn-color:${escapeHtml(getPlayerColor(playerFor(winner)))}"` : ''}>
            <div class="ticket-top">
                ${winner && !draw ? playerAvatarHtml(playerFor(winner)) : ''}
                <div class="ticket-heading"><h2 class="ticket-title">${escapeHtml(title)}</h2></div>
            </div>
            <ol class="ticket-standings" aria-label="Final standings">
                ${standings.map((row, i) => {
                    const player = playerFor(row);
                    const classes = [
                        i === 0 && !draw ? 'is-winner' : '',
                        row.bankrupt ? 'is-out' : '',
                        player.userId && player.userId === currentUser?.id ? 'is-you' : '',
                    ].filter(Boolean).join(' ');
                    return `
                        <li class="ticket-standing ${classes}">
                            <span class="ticket-rank">${row.bankrupt ? '–' : i + 1}</span>
                            ${playerAvatarHtml(player, 'sm')}
                            <span class="ticket-standing-name">${escapeHtml(row.name)}${row.bankrupt ? '<span class="sr-only"> (bankrupt)</span>' : ''}</span>
                            <span class="ticket-standing-worth">${formatMoney(Math.round(Number(row.netWorth || 0)))}</span>
                        </li>`;
                }).join('')}
            </ol>
        </section>
    `;
}

function finalStandingsFrom(gameState) {
    return gameState.standings || gameState.players.map(player => ({
        userId: player.userId,
        name: player.name,
        netWorth: player.netWorth || player.cash,
        bankrupt: player.bankrupt
    })).sort((a, b) => b.netWorth - a.netWorth);
}

// The reason the engine records when the host gives none (turns.js pauseGame).
const DEFAULT_PAUSE_REASON = 'Host paused the game';

function renderPauseBanner(gameState) {
    if (!gameState?.paused) return '';
    const pause = gameState.pause || {};
    const pausedBy = pause.pausedByName || 'The host';
    const time = pause.pausedAt ? ` ${formatTimeAgo(pause.pausedAt)}` : '';
    // The default reason only repeats that the host paused; a typed one says why.
    const reason = pause.reason && pause.reason !== DEFAULT_PAUSE_REASON ? pause.reason : '';
    return `
        <div class="pause-panel" id="pausePanel">
            <strong>${escapeHtml(`${pausedBy} paused the game${time}.`)}</strong>
            ${reason ? `<p>${escapeHtml(reason)}</p>` : ''}
        </div>
    `;
}

function renderCashWarning(currentPlayer, isMyTurn) {
    if (!currentPlayer || currentPlayer.bankrupt) return '';
    return renderPersonalCashWarning(currentPlayer, isMyTurn) + (isMyTurn ? renderCompanyLoanWarnings(currentPlayer) : '');
}

// Corporations whose loans End Turn services for this chairman.
function renderCompanyLoanWarnings(currentPlayer) {
    return TurnEndOutlook.forCompanies(currentGame.game_state, currentPlayer).map(company => {
        let message;
        let tone = 'danger';
        if (company.goesInsolvent) {
            message = `${company.ticker} is ${formatMoney(-company.cashAfter)} short of the ${formatMoney(company.maturing)} of loans that come due when you end your turn, or it closes.`;
        } else if (company.shortAutopay) {
            tone = '';
            message = `${company.ticker} doesn't have the cash for its full loan payment. End Turn adds the rest to its loan as unpaid interest.`;
        } else if (company.maturing > 0) {
            tone = '';
            message = `End Turn repays ${formatMoney(company.maturing)} of ${company.ticker}'s loans that come due, leaving it ${formatMoney(company.cashAfter)}.`;
        } else {
            return '';
        }
        return `<div class="turn-warning${tone ? ` ${tone}` : ''}">${escapeHtml(message)}</div>`;
    }).join('');
}

function renderPersonalCashWarning(currentPlayer, isMyTurn) {
    const outlook = TurnEndOutlook.forPlayer(currentGame.game_state, currentPlayer);
    const { claim, unpaid, loanPayments, maturing, cash, cashAfter } = outlook;
    const shortfall = formatMoney(outlook.shortfall);
    const loanNote = loanPayments > 0 ? `, then ${formatMoney(loanPayments)} in loan payments` : '';
    // How to avoid it and what happens if you don't, said once.
    const raiseIt = 'Borrow, sell or trade to raise it, or End Turn makes you bankrupt.';
    let message;
    let tone = 'danger';

    if (claim) {
        const owed = formatMoney(unpaid);
        const creditor = claim.creditorName || 'the creditor';
        const { rollAgain } = getRollState(currentGame.game_state, currentPlayer);
        if (rollAgain) {
            // Doubles: the claim is paid before the next roll, not at End Turn.
            const short = formatMoney(unpaid - cash);
            if (!outlook.creditorActive) {
                message = isMyTurn
                    ? `You owe ${creditor} ${owed}, but they're out of the game. You can't roll again; End Turn makes you bankrupt.`
                    : `${currentPlayer.name} owes ${creditor} ${owed}, but they're out of the game.`;
            } else if (cash >= unpaid) {
                tone = '';
                message = isMyTurn
                    ? `You owe ${owed} to ${creditor}. Roll Again pays it from your cash first, leaving you ${formatMoney(cash - unpaid)}.`
                    : `${currentPlayer.name} owes ${owed} to ${creditor}. It will be paid from their cash before they roll again.`;
            } else {
                message = isMyTurn
                    ? `You owe ${creditor} ${owed} and are ${short} short. Raise it to roll again, or End Turn makes you bankrupt.`
                    : `${currentPlayer.name} owes ${creditor} ${owed} and is ${short} short.`;
            }
        } else if (outlook.settlesClaim) {
            tone = '';
            message = isMyTurn
                ? `You owe ${owed} to ${creditor}. End Turn pays it from your cash${loanNote}, leaving you ${formatMoney(cashAfter)}.`
                : `${currentPlayer.name} owes ${owed} to ${creditor}. It will be paid from their cash when they end the turn.`;
        } else if (!outlook.creditorActive) {
            message = isMyTurn
                ? `You owe ${creditor} ${owed}, but they're out of the game, so End Turn makes you bankrupt.`
                : `${currentPlayer.name} owes ${creditor} ${owed}, but they're out of the game.`;
        } else {
            const short = outlook.shortfall === unpaid ? '' : ` and are ${shortfall} short`;
            message = isMyTurn
                ? `You owe ${creditor} ${owed}${short}. ${raiseIt}`
                : `${currentPlayer.name} owes ${creditor} ${owed} and is ${shortfall} short.`;
        }
    } else if (cash < 0) {
        message = isMyTurn
            ? `You're ${formatMoney(-cash)} below zero${outlook.shortfall === -cash ? '' : ` and need ${shortfall}`}. ${raiseIt}`
            : `${currentPlayer.name} is ${formatMoney(-cash)} below zero.`;
    } else if (cashAfter < 0) {
        message = isMyTurn
            ? `${formatMoney(maturing)} of loans come due when you end your turn and you're ${shortfall} short. ${raiseIt}`
            : `${currentPlayer.name} has ${formatMoney(maturing)} of loans coming due and is ${shortfall} short.`;
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
    startAuctionCountdown();
    // Bids are whole dollars: the lowest that beats the high bid.
    const minBid = Math.floor(currentBid) + 1;
    const status = auction.highBidderName
        ? `${isHighBidder ? 'You lead' : `${auction.highBidderName} leads`} at ${formatMoney(currentBid)}`
        : 'No bids yet';
    const expiryText = formatAuctionExpiry(auction);

    return `
        <div class="auction-panel" id="auctionPanel">
            <div class="auction-header">
                <div>
                    <span class="auction-label">Auction</span>
                    <h3>${propertyDot(auction.propertyId)}${escapeHtml(auction.propertyName || property?.name || 'Property')}</h3>
                </div>
                <strong class="${auction.highBidderName ? '' : 'is-empty'}">${escapeHtml(status)}</strong>
            </div>
            ${passed ? '<p class="auction-note">You passed</p>' : ''}
            ${canAct ? `
                <div class="auction-actions">
                    <input type="number" id="auctionBidAmount" min="${minBid}" step="1" inputmode="numeric" value="${minBid}" aria-label="Your bid in dollars">
                    <button class="btn btn-success btn-sm" data-game-action="place-auction-bid">Bid</button>
                    <button class="btn btn-secondary btn-sm" data-game-action="pass-auction">Pass</button>
                </div>
            ` : ''}
            ${expiryText ? `<p class="auction-expiry" id="auctionExpiry">${escapeHtml(expiryText)}</p>` : ''}
        </div>
    `;
}

// Bids and passes restart the clock; once it runs out the next action closes the
// auction (auctions.js), selling to the high bidder if there is one.
function formatAuctionExpiry(auction) {
    const seconds = secondsUntil(auction.expiresAt);
    if (seconds === null) return '';
    if (seconds <= 0) return "Time's up: the next move closes it.";
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return `Closes in ${clock} if no one bids or passes${auction.highBidderName ? '. High bid wins' : ''}.`;
}

// Ticks the auction clock each second between renders; stops once no auction is shown.
let auctionCountdownTimer = null;
function startAuctionCountdown() {
    if (auctionCountdownTimer) return;
    auctionCountdownTimer = setInterval(() => {
        const element = document.getElementById('auctionExpiry');
        const auction = currentGame?.game_state?.auction;
        if (!element || !auction || auction.status !== 'open') {
            clearInterval(auctionCountdownTimer);
            auctionCountdownTimer = null;
            return;
        }
        const text = formatAuctionExpiry(auction);
        if (element.textContent !== text) element.textContent = text;
    }, 1000);
}

// diceRolled means the move is finished. After doubles it stays false so the player
// can roll again, but they have still landed: lastDiceRoll is set for this turn.
function getRollState(gameState, player) {
    const hasRolled = !!player.diceRolled;
    const hasMoved = hasRolled || Array.isArray(gameState.lastDiceRoll);
    return { hasRolled, hasMoved, rollAgain: hasMoved && !hasRolled };
}

// The square the current player is on, and whether they can buy it now.
function getLandingSummary(gameState, player) {
    const square = BOARD_SQUARES[player.position || 0] || BOARD_SQUARES[0];
    const property = square.propertyId
        ? gameState.properties.find(prop => prop.id === square.propertyId)
        : null;
    const isBuyableSquare = ['property', 'railroad', 'utility'].includes(square.type);
    const canBuy = !!(isBuyableSquare && property && !property.ownerId) && getRollState(gameState, player).hasMoved;
    return { square, property, canBuy, price: canBuy ? Number(property.price) : 0 };
}

function renderLastCardSummary(gameState, player) {
    const lastCard = normalizeLastCardDrawn(gameState.lastCardDrawn);
    if (!lastCard || lastCard.playerId !== player.userId) return '';
    return `
        <div class="card-effect-summary">
            <span>${escapeHtml(deckDisplayName(lastCard.deckType))}</span>
            <strong>${escapeHtml(lastCard.card)}</strong>
            ${lastCard.effect ? `<p>${escapeHtml(lastCard.effect)}</p>` : ''}
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

// Your turn: the dock holds the moves the game needs next, each saying what it costs.
// landing is getLandingSummary() for the current player.
function renderActionButtons(landing) {
    const gameState = currentGame.game_state;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const { hasRolled, rollAgain } = getRollState(gameState, currentPlayer);
    const turnEnd = TurnEndOutlook.forPlayer(gameState, currentPlayer);
    const owesMoney = turnEnd.goesBankrupt;
    // Rent still owed after doubles is paid before rolling again (rollDice); a player who
    // can't pay it may only End Turn, which declares bankruptcy.
    const claimBeforeRoll = rollAgain && turnEnd.claim;
    const rollBlocked = !!claimBeforeRoll && (!turnEnd.creditorActive || turnEnd.cash < turnEnd.unpaid);
    const auctionOpen = gameState.auction?.status === 'open';
    const waitingForJailChoice = currentPlayer.inJail && !hasRolled;

    const endTurnLabel = owesMoney
        ? 'Declare Bankruptcy'
        : (turnEnd.settlesClaim ? `Pay ${formatMoney(turnEnd.unpaid)} & End Turn` : 'End Turn');
    const endTurnButton = variant => `<button class="btn ${owesMoney ? 'btn-danger' : variant} action-btn-end-turn" data-game-action="end-turn">${escapeHtml(endTurnLabel)}</button>`;
    const rollLabel = waitingForJailChoice ? 'Roll Doubles'
        : (claimBeforeRoll ? `Pay ${formatMoney(turnEnd.unpaid)} & Roll Again` : (rollAgain ? 'Roll Again' : 'Roll Dice'));
    const rollButton = variant => `<button class="btn ${variant}" data-game-action="roll-dice">${escapeHtml(rollLabel)}</button>`;

    // Buying: Auction and Buy $X. Buy needs the cash, unless a company you run can pay.
    const buyRow = () => {
        const runsCompanies = ShareDeals.corporationsRunBy(gameState, currentPlayer.userId).length > 0;
        const canPay = runsCompanies || Number(currentPlayer.cash) >= landing.price;
        return [
            '<button class="btn btn-secondary" data-game-action="start-auction">Auction</button>',
            canPay ? `<button class="btn btn-primary action-btn-buy" data-game-action="buy-property">Buy ${formatMoney(landing.price)}</button>` : '',
        ];
    };
    // An auction that ended without a sale leaves the square unowned: End Turn moves on.
    const auctionedAlready = gameState.auction?.status === 'no_sale' && gameState.auction.propertyId === landing.property?.id;

    const rows = [];
    if (auctionOpen) {
        // The dock would hold nothing usable, and on a phone it covers the auction's Bid and Pass.
    } else if (waitingForJailChoice) {
        rows.push([rollButton('btn-primary')]);
        rows.push([
            '<button class="btn btn-warning" data-game-action="pay-jail-fine">Pay $50</button>',
            currentPlayer.hasGetOutOfJailCard ? '<button class="btn btn-secondary" data-game-action="use-jail-card">Use Card</button>' : '',
        ]);
    } else if (rollBlocked) {
        rows.push([endTurnButton('btn-primary')]);
    } else if (!hasRolled) {
        if (landing.canBuy) {
            rows.push([rollButton('btn-secondary')]);
            rows.push(buyRow());
        } else {
            rows.push([rollButton('btn-primary')]);
        }
    } else if (landing.canBuy) {
        if (auctionedAlready) rows.push([endTurnButton('btn-primary')]);
        const buy = buyRow();
        rows.push(buy[1] ? buy : [endTurnButton('btn-secondary'), buy[0]]);
    } else {
        rows.push([endTurnButton('btn-primary')]);
    }

    const dock = rows.length ? `
        <div class="action-buttons turn-dock">
            <div class="dock-inner">
                ${rows.map(row => `<div class="dock-row">${row.join('')}</div>`).join('')}
            </div>
        </div>` : '';

    return `${dock}${renderMoveTools(gameState, currentPlayer)}`;
}

// The moves open now, as one row of icon tools; nothing is shown disabled. Building,
// IPOs, loans and trades are open to every active player at any time (the engine
// turn-locks only movement), and an open auction holds all but trading.
const MOVE_TOOL_ICONS = {
    build: '<path d="M4 11l8-6 8 6v8H4z"/><path d="M10 19v-5h4v5"/>',
    trade: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
    borrow: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    ipo: '<path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>',
    corps: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
    vote: '<path d="M5 12l4 4 10-10"/><path d="M4 20h16"/>',
};

function renderMoveTool({ icon, label, name, action, section, featured, count }) {
    const target = action ? `data-game-action="${action}"` : `data-switch-section="${section}"`;
    const countBadge = count ? `<span class="move-tool-count">${count}<span class="sr-only"> waiting for your answer</span></span>` : '';
    return `
        <button type="button" class="move-tool${featured ? ' is-featured' : ''}" ${target} aria-label="${escapeHtml(name)}">
            <svg viewBox="0 0 24 24" aria-hidden="true">${MOVE_TOOL_ICONS[icon]}</svg>
            <span aria-hidden="true">${escapeHtml(label)}</span>
            ${countBadge}
        </button>`;
}

// Complete colour groups you (or a company you run) can still build on.
function canBuildHousesNow(gameState, player) {
    const ownGroups = getCompleteGroupProperties(player.userId, gameState);
    const corpGroups = ShareDeals.corporationsRunBy(gameState, player.userId)
        .flatMap(corp => getCompleteGroupProperties(corp.id, gameState));
    return [...ownGroups, ...corpGroups].some(prop => Number(prop.houses || 0) < 5);
}

function renderMoveTools(gameState, player, { paused = false } = {}) {
    const active = !!player && !player.bankrupt && !gameState.ended;
    const auctionOpen = gameState.auction?.status === 'open';
    const openMoves = active && !paused && !auctionOpen;
    const tradeWaiting = tradeProposalsAwaitingMe();
    const corpVotes = CorporationDesk.votesAwaiting(currentUser.id).length;
    const corporations = (gameState.corporations || []).filter(corp => !ShareDeals.isClosed(corp));
    const ownsProperty = !!player && gameState.properties.some(prop => prop.ownerId === player.userId);
    const otherPlayers = gameState.players.some(p => p.userId !== player?.userId && !p.bankrupt);

    const tools = [];
    if (openMoves && canBuildHousesNow(gameState, player)) {
        tools.push({ icon: 'build', label: 'Build', name: 'Build houses', action: 'open-house', featured: true });
    }
    if (tradeWaiting) {
        tools.push({ icon: 'trade', label: 'Trade', name: 'Trade proposals', action: 'open-trade-proposals', featured: true, count: tradeWaiting });
    } else if (active && !paused && otherPlayers) {
        tools.push({ icon: 'trade', label: 'Trade', name: 'Trade', section: 'market' });
    }
    if (openMoves) tools.push({ icon: 'borrow', label: 'Borrow', name: 'Borrow', action: 'open-debt' });
    if (openMoves && ownsProperty) tools.push({ icon: 'ipo', label: 'IPO', name: 'Create IPO', action: 'open-ipo' });
    if (corporations.length || corpVotes) {
        tools.push({ icon: 'corps', label: 'Corps', name: 'Corporations', action: 'open-corporation', featured: corpVotes > 0, count: corpVotes });
    }
    if (RuleProposals.needsMyVote()) {
        tools.push({ icon: 'vote', label: 'Vote', name: 'Rule proposal vote', action: 'open-rule-proposals', featured: true });
    }
    if (!tools.length) return '';
    return `<nav class="moves move-tools" aria-label="Moves">${tools.map(renderMoveTool).join('')}</nav>`;
}

// Off your turn: the same moves as on it, without rolling, buying or ending the turn.
function renderNonTurnActions() {
    return renderMoveTools(currentGame.game_state, currentPlayerData);
}

function renderSpectatorNote() {
    return `
        <section class="moves">
            <div class="section-heading"><h3>Watching</h3></div>
            <p class="empty-state">You're watching. Host controls are below.</p>
        </section>
    `;
}

function renderPausedActions() {
    return renderMoveTools(currentGame.game_state, currentPlayerData, { paused: true });
}

// Host-only controls, kept away from turn actions so End Game is never a slip of the thumb.
function renderHostPanel(gameState) {
    const isHost = isRoomHost();
    if (!isHost || gameState.ended) return '';
    const paused = !!gameState.paused;
    return `
        <section class="host-panel" aria-label="Host controls">
            <h3>Host controls</h3>
            <div class="host-actions">
                ${gameState.auction?.status === 'open' ? '<button class="btn btn-danger btn-sm" data-game-action="host-cancel-auction">Cancel Auction</button>' : ''}
                ${paused
                    ? '<button class="btn btn-success btn-sm" data-game-action="host-resume">Resume Game</button>'
                    : '<button class="btn btn-warning btn-sm" data-game-action="host-pause">Pause Game</button>'}
                <button class="btn btn-danger btn-sm" data-game-action="host-end">End Game</button>
            </div>
            <a class="quiet-link" href="lobby.html?manage=${encodeURIComponent(currentRoom ? currentRoom.id : '')}">Manage players</a>
        </section>
    `;
}
