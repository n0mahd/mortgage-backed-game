// Board data and rendering for Mortgage Backed Monopoly
// Must be loaded before game.js

// CSS colours keyed by the colour name used in MONOPOLY_PROPERTIES
const PROP_COLORS = {
    'Brown':      '#8B4513',
    'Light Blue': '#87CEEB',
    'Pink':       '#E91E8C',
    'Orange':     '#F97C2A',
    'Red':        '#E74C3C',
    'Yellow':     '#F1C40F',
    'Green':      '#27AE60',
    'Dark Blue':  '#2C3E9E',
    'Railroad':   '#444444',
    'Utility':    '#888888',
};

const BOARD_SQUARES = [
    // Bottom row: pos 0–10 (GO bottom-right, play runs clockwise)
    { position: 0,  name: 'GO',                  type: 'go',              propertyId: null,     taxAmount: 0,   color: null },
    { position: 1,  name: 'Mediterranean Ave',    type: 'property',        propertyId: 'prop-0', taxAmount: 0,   color: PROP_COLORS['Brown'] },
    { position: 2,  name: 'Community Chest',      type: 'community_chest', propertyId: null,     taxAmount: 0,   color: null },
    { position: 3,  name: 'Baltic Ave',           type: 'property',        propertyId: 'prop-1', taxAmount: 0,   color: PROP_COLORS['Brown'] },
    { position: 4,  name: 'Income Tax',           type: 'tax',             propertyId: null,     taxAmount: 200, color: null },
    { position: 5,  name: 'Reading Railroad',      type: 'railroad',        propertyId: 'prop-9', taxAmount: 0,   color: PROP_COLORS['Railroad'] },
    { position: 6,  name: 'Oriental Ave',         type: 'property',        propertyId: 'prop-2', taxAmount: 0,   color: PROP_COLORS['Light Blue'] },
    { position: 7,  name: 'Chance',               type: 'chance',          propertyId: null,     taxAmount: 0,   color: null },
    { position: 8,  name: 'Vermont Ave',          type: 'property',        propertyId: 'prop-3', taxAmount: 0,   color: PROP_COLORS['Light Blue'] },
    { position: 9,  name: 'Connecticut Ave',      type: 'property',        propertyId: 'prop-4', taxAmount: 0,   color: PROP_COLORS['Light Blue'] },
    { position: 10, name: 'Jail / Just Visiting', type: 'jail',            propertyId: null,     taxAmount: 0,   color: null },
    // Left column: pos 11–19 (bottom → top)
    { position: 11, name: 'St. Charles Pl.',      type: 'property',        propertyId: 'prop-5',  taxAmount: 0,  color: PROP_COLORS['Pink'] },
    { position: 12, name: 'Electric Company',     type: 'utility',         propertyId: 'prop-6',  taxAmount: 0,  color: PROP_COLORS['Utility'] },
    { position: 13, name: 'States Ave',           type: 'property',        propertyId: 'prop-7',  taxAmount: 0,  color: PROP_COLORS['Pink'] },
    { position: 14, name: 'Virginia Ave',         type: 'property',        propertyId: 'prop-8',  taxAmount: 0,  color: PROP_COLORS['Pink'] },
    { position: 15, name: 'Pennsylvania RR',       type: 'railroad',        propertyId: 'prop-16', taxAmount: 0,  color: PROP_COLORS['Railroad'] },
    { position: 16, name: 'St. James Place',      type: 'property',        propertyId: 'prop-10', taxAmount: 0,  color: PROP_COLORS['Orange'] },
    { position: 17, name: 'Community Chest',      type: 'community_chest', propertyId: null,      taxAmount: 0,  color: null },
    { position: 18, name: 'Tennessee Ave',        type: 'property',        propertyId: 'prop-11', taxAmount: 0,  color: PROP_COLORS['Orange'] },
    { position: 19, name: 'New York Ave',         type: 'property',        propertyId: 'prop-12', taxAmount: 0,  color: PROP_COLORS['Orange'] },
    // Top row: pos 20–29 (left → right)
    { position: 20, name: 'Free Parking',         type: 'free_parking',    propertyId: null,      taxAmount: 0,  color: null },
    { position: 21, name: 'Kentucky Ave',         type: 'property',        propertyId: 'prop-13', taxAmount: 0,  color: PROP_COLORS['Red'] },
    { position: 22, name: 'Chance',               type: 'chance',          propertyId: null,      taxAmount: 0,  color: null },
    { position: 23, name: 'Indiana Ave',          type: 'property',        propertyId: 'prop-14', taxAmount: 0,  color: PROP_COLORS['Red'] },
    { position: 24, name: 'Illinois Ave',         type: 'property',        propertyId: 'prop-15', taxAmount: 0,  color: PROP_COLORS['Red'] },
    { position: 25, name: 'B.&O. Railroad',        type: 'railroad',        propertyId: 'prop-27', taxAmount: 0,  color: PROP_COLORS['Railroad'] },
    { position: 26, name: 'Atlantic Ave',         type: 'property',        propertyId: 'prop-17', taxAmount: 0,  color: PROP_COLORS['Yellow'] },
    { position: 27, name: 'Ventnor Ave',          type: 'property',        propertyId: 'prop-18', taxAmount: 0,  color: PROP_COLORS['Yellow'] },
    { position: 28, name: 'Water Works',          type: 'utility',         propertyId: 'prop-19', taxAmount: 0,  color: PROP_COLORS['Utility'] },
    { position: 29, name: 'Marvin Gardens',       type: 'property',        propertyId: 'prop-20', taxAmount: 0,  color: PROP_COLORS['Yellow'] },
    // Right column: pos 30–39 (top → bottom)
    { position: 30, name: 'Go to Jail',           type: 'go_to_jail',      propertyId: null,      taxAmount: 0,  color: null },
    { position: 31, name: 'Pacific Ave',          type: 'property',        propertyId: 'prop-21', taxAmount: 0,  color: PROP_COLORS['Green'] },
    { position: 32, name: 'N. Carolina Ave',      type: 'property',        propertyId: 'prop-22', taxAmount: 0,  color: PROP_COLORS['Green'] },
    { position: 33, name: 'Community Chest',      type: 'community_chest', propertyId: null,      taxAmount: 0,  color: null },
    { position: 34, name: 'Pennsylvania Ave',     type: 'property',        propertyId: 'prop-23', taxAmount: 0,  color: PROP_COLORS['Green'] },
    { position: 35, name: 'Short Line RR',        type: 'railroad',        propertyId: 'prop-24', taxAmount: 0,  color: PROP_COLORS['Railroad'] },
    { position: 36, name: 'Chance',               type: 'chance',          propertyId: null,      taxAmount: 0,  color: null },
    { position: 37, name: 'Park Place',           type: 'property',        propertyId: 'prop-25', taxAmount: 0,  color: PROP_COLORS['Dark Blue'] },
    { position: 38, name: 'Luxury Tax',           type: 'tax',             propertyId: null,      taxAmount: 100, color: null },
    { position: 39, name: 'Boardwalk',            type: 'property',        propertyId: 'prop-26', taxAmount: 0,  color: PROP_COLORS['Dark Blue'] },
];

const PLAYER_COLORS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#34495e'
];

const HOUSE_COSTS = {
    'Brown': 50, 'Light Blue': 50, 'Pink': 100, 'Orange': 100,
    'Red': 150, 'Yellow': 150, 'Green': 200, 'Dark Blue': 200
};

function getSquareProperty(square, gameState) {
    if (!square.propertyId || !gameState.properties) return null;
    return gameState.properties.find(p => p.id === square.propertyId) || null;
}

// Who owns a property, for display. Corporations own property under their own id;
// they show as "TICKER (Chair's corporation)" in their chairman's color.
function describeOwner(gameState, ownerId, fallbackName) {
    const players = gameState.players || [];
    const playerIndex = players.findIndex(p => p.userId === ownerId);
    if (playerIndex >= 0) return { label: players[playerIndex].name, playerIndex, corporation: null };
    const corp = (gameState.corporations || []).find(c => c.id === ownerId);
    if (corp) {
        const chairIndex = players.findIndex(p => p.userId === corp.chairmanId);
        const chair = corp.chairmanName || players[chairIndex]?.name;
        return { label: chair ? `${corp.ticker} (${chair}'s corporation)` : `${corp.ticker} corporation`, playerIndex: chairIndex, corporation: corp };
    }
    return { label: fallbackName || 'another player', playerIndex: -1, corporation: null };
}

// ── Board tab ──────────────────────────────────────────────────────
// A square board that fits the screen: names, prices and owners on desktop,
// colour, owner and buildings on phones (tap a square for its details in the
// centre). Tokens sit in their own layer so they can step square by square.

// Corners are BOARD_CORNER_UNITS wide; the 9 squares between them are 1 unit each.
const BOARD_CORNER_UNITS = 1.5;
const BOARD_UNITS = BOARD_CORNER_UNITS * 2 + 9;

// Square in focus in the centre (null: the square of whoever's turn it is).
let boardFocusPosition = null;
// Where each token was last drawn, so a move can be animated square by square.
let boardTokenPositions = new Map();
let boardTokenAnimation = 0;
let boardPreviousDice = null;

// Shorter labels for squares whose names don't fit on desktop squares.
const BOARD_SHORT_NAMES = {
    'Mediterranean Ave': 'Mediter­ranean', 'St. Charles Pl.': 'St. Charles', 'Pennsylvania RR': 'Penn. RR',
    'St. James Place': 'St. James', 'Community Chest': 'Chest', 'Pennsylvania Ave': 'Penn. Ave',
    'N. Carolina Ave': 'N. Carolina', 'Connecticut Ave': 'Connecti­cut', 'Electric Company': 'Electric Co.',
    'Reading Railroad': 'Reading RR', 'B.&O. Railroad': 'B&O RR', 'Short Line RR': 'Short Line',
    'Tennessee Ave': 'Tennes­see', 'Jail / Just Visiting': 'Jail',
};

const BOARD_GLYPHS = {
    chance: '<path d="M8.5 8.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5"/><circle cx="12" cy="18.5" r="0.6" fill="currentColor"/>',
    community_chest: '<rect x="3.5" y="9" width="17" height="10.5" rx="1.5"/><path d="M3.5 9a8.5 4.5 0 0 1 17 0M12 12v3"/>',
    railroad: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-2 2M15 20l2 2"/>',
    utility: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
};

// Grid row and column (1-11) of a square. GO is bottom-right and play runs
// clockwise, so every square sits next to the one before it.
function boardGridCell(position) {
    if (position === 0) return { row: 11, col: 11 };
    if (position < 10) return { row: 11, col: 11 - position };
    if (position === 10) return { row: 11, col: 1 };
    if (position < 20) return { row: 21 - position, col: 1 };
    if (position === 20) return { row: 1, col: 1 };
    if (position < 30) return { row: 1, col: position - 19 };
    if (position === 30) return { row: 1, col: 11 };
    return { row: position - 29, col: 11 };
}

function boardEdge(position) {
    if (position < 10) return 'bottom';
    if (position < 20) return 'left';
    if (position < 30) return 'top';
    return 'right';
}

// Where a token stands on a square, as a % of the board. On edge squares tokens sit
// on the inner edge, over the colour band, so the name and owner stay readable.
// Jailed players stand in the cell.
function boardTokenSpot(position, inJail) {
    const C = BOARD_CORNER_UNITS;
    const T = BOARD_UNITS;
    const INNER = C - 0.3; // depth of a token's centre from the board's outer edge
    let x;
    let y;
    if (position === 10) {
        [x, y] = inJail ? [C * 0.66, T - C + 0.62] : [0.3, T - C / 2];
    } else if (position === 0) [x, y] = [T - C / 2, T - C / 2];
    else if (position < 10) [x, y] = [T - C - (position - 0.5), T - INNER];
    else if (position < 20) [x, y] = [INNER, T - C - (position - 10.5)];
    else if (position === 20) [x, y] = [C / 2, C / 2];
    else if (position < 30) [x, y] = [C + (position - 20.5), INNER];
    else if (position === 30) [x, y] = [T - C / 2, C / 2];
    else [x, y] = [T - INNER, C + (position - 30.5)];
    return { x: (x / T) * 100, y: (y / T) * 100 };
}

function boardPlayerColor(gameState, player) {
    const index = gameState.players.indexOf(player);
    return PLAYER_COLORS[(index >= 0 ? index : 0) % PLAYER_COLORS.length];
}

// The owner tag: initials (or a corporation's ticker) in the owner's colour.
function boardOwnerTag(gameState, property) {
    const owner = describeOwner(gameState, property.ownerId, property.ownerName);
    const color = owner.playerIndex >= 0 ? PLAYER_COLORS[owner.playerIndex % PLAYER_COLORS.length] : 'var(--ink-3)';
    const text = owner.corporation
        ? owner.corporation.ticker
        : playerInitials(owner.playerIndex >= 0 ? gameState.players[owner.playerIndex].name : owner.label);
    return `<span class="board-owner-tag" style="--owner-color:${color}" title="Owned by ${escapeHtml(owner.label)}">${escapeHtml(text)}</span>`;
}

function boardBuildings(property) {
    const houses = Number(property.houses || 0);
    if (houses === 5) return '<span class="board-hotel" role="img" aria-label="Hotel" title="Hotel">H</span>';
    if (houses > 0) {
        const label = `${houses} house${houses === 1 ? '' : 's'}`;
        return `<span class="board-house" role="img" aria-label="${label}" title="${label}">${houses}</span>`;
    }
    return '';
}

function renderBoardCell(square, gameState, focusPosition) {
    const { row, col } = boardGridCell(square.position);
    const property = getSquareProperty(square, gameState);
    const classes = ['board-cell', `edge-${boardEdge(square.position)}`, `type-${square.type.replace(/_/g, '-')}`];
    if (square.position % 10 === 0) classes.push('is-corner', `corner-${square.position}`);
    if (square.position === focusPosition) classes.push('is-focused');
    const style = `grid-row:${row};grid-column:${col}${square.color ? `;--set-color:${square.color}` : ''}`;
    const attrs = `class="${classes.join(' ')}" style="${style}" data-board-square="${square.position}" aria-label="${escapeHtml(square.name)}"`;

    if (square.position === 10) {
        return `<button type="button" ${attrs}>
            <span class="board-jail-cell"><span class="board-corner-title">Jail</span></span>
            <span class="board-corner-note">Just visiting</span>
        </button>`;
    }
    if (square.position % 10 === 0) {
        const titles = { 0: ['GO', 'Collect $200'], 20: ['Free Parking', ''], 30: ['Go to Jail', ''] };
        const [title, note] = titles[square.position];
        return `<button type="button" ${attrs}>
            <span class="board-corner-title">${title}</span>${note ? `<span class="board-corner-note">${note}</span>` : ''}
        </button>`;
    }

    const glyph = BOARD_GLYPHS[square.type]
        ? `<svg class="board-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BOARD_GLYPHS[square.type]}</svg>`
        : '';
    let detail = '';
    if (property && property.ownerId) detail = boardOwnerTag(gameState, property);
    else if (property) detail = `<span class="board-price">${formatMoney(property.price)}</span>`;
    else if (square.taxAmount) detail = `<span class="board-price is-tax">${formatMoney(square.taxAmount)}</span>`;

    return `<button type="button" ${attrs}>
        ${square.color && square.type === 'property' ? '<span class="board-set-band"></span>' : ''}
        <span class="board-cell-body">
            ${glyph}
            <span class="board-cell-name">${escapeHtml(BOARD_SHORT_NAMES[square.name] || square.name)}</span>
            ${detail}
            ${property ? boardBuildings(property) : ''}
        </span>
    </button>`;
}

// Tokens, grouped per square and fanned out when several share one.
function renderBoardTokens(gameState, currentUserId, positionOf) {
    const groups = new Map();
    gameState.players.forEach(player => {
        if (player.bankrupt) return;
        const position = positionOf(player);
        const key = position === 10 && player.inJail ? 'cell' : String(position);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(player);
    });
    const current = gameState.players[gameState.currentPlayerIndex];
    let html = '';
    groups.forEach((players, key) => {
        players.forEach((player, i) => {
            const position = key === 'cell' ? 10 : Number(key);
            const spot = boardTokenSpot(position, key === 'cell');
            // Several tokens on one square spread out along its edge (around the middle on corners).
            const offset = (i - (players.length - 1) / 2) * 0.3;
            let dx = 0;
            let dy = 0;
            if (position % 10 === 0) {
                const angle = (i / players.length) * Math.PI * 2 - Math.PI / 4;
                if (players.length > 1) [dx, dy] = [Math.cos(angle) * 0.24, Math.sin(angle) * 0.24];
            } else if (position < 10 || (position > 20 && position < 30)) dx = offset;
            else dy = offset;
            const classes = ['board-token'];
            if (player === current && !gameState.ended) classes.push('is-turn');
            if (player.userId === currentUserId) classes.push('is-you');
            html += `<span class="${classes.join(' ')}" data-token-user="${escapeHtml(player.userId)}"
                style="--token-color:${boardPlayerColor(gameState, player)};--x:${spot.x.toFixed(3)}%;--y:${spot.y.toFixed(3)}%;--dx:${dx.toFixed(3)};--dy:${dy.toFixed(3)}"
                title="${escapeHtml(player.name)}">${escapeHtml(playerInitials(player.name))}</span>`;
        });
    });
    return html;
}

// The square in focus: its name and one line of what matters.
function renderBoardFocus(gameState, position) {
    const square = BOARD_SQUARES[position] || BOARD_SQUARES[0];
    const property = getSquareProperty(square, gameState);
    let facts;
    if (property && property.ownerId) {
        const owner = describeOwner(gameState, property.ownerId, property.ownerName);
        const owned = gameState.properties.filter(p => p.ownerId === property.ownerId);
        const parts = [escapeHtml(owner.label)];
        const houses = Number(property.houses || 0);
        if (houses) parts.push(houses === 5 ? 'Hotel' : `${houses} house${houses === 1 ? '' : 's'}`);
        parts.push(escapeHtml(getPropertyRentLabel(property, gameState.properties, owned, property.ownerId)));
        facts = parts.join(' · ');
    } else if (property) {
        facts = `For sale · ${formatMoney(property.price)}`;
    } else {
        const jailed = gameState.players.filter(p => p.inJail && !p.bankrupt).map(p => p.name);
        facts = {
            go: 'Collect $200 each time you pass',
            jail: jailed.length ? `In jail: ${escapeHtml(jailed.join(', '))}` : 'Just visiting',
            free_parking: 'Nothing happens here',
            go_to_jail: 'Go straight to jail',
            chance: 'Draw a Chance card',
            community_chest: 'Draw a Community Chest card',
            tax: `Pay ${formatMoney(square.taxAmount)} to the bank`,
        }[square.type] || '';
    }
    const swatch = square.color && square.type === 'property' ? `<span class="board-focus-swatch" style="--set-color:${square.color}"></span>` : '';
    return `<div class="board-focus">
        <h3 class="board-focus-name">${swatch}${escapeHtml(square.name)}</h3>
        <p class="board-focus-facts">${facts}</p>
    </div>`;
}

// Whose turn it is, the dice, and Roll Dice when that's the only move to make.
// Anything more involved (buying, jail, debts) sends the player to the Game tab.
function renderBoardTurn(gameState, currentUserId) {
    const current = gameState.players[gameState.currentPlayerIndex];
    if (!current) return '';
    const isMine = current.userId === currentUserId;
    const { hasRolled, rollAgain } = getRollState(gameState, current);
    const dice = Array.isArray(gameState.lastDiceRoll) ? gameState.lastDiceRoll : null;
    const diceKey = `${gameState.currentPlayerIndex}|${hasRolled}|${dice ? dice.join(',') : ''}`;
    const rolling = !!dice && boardPreviousDice !== null && boardPreviousDice !== diceKey;
    boardPreviousDice = diceKey;

    let label = isMine ? 'Your turn' : 'Now playing';
    if (gameState.ended) label = 'Game over';
    else if (gameState.paused) label = 'Paused by the host';
    let action = '';
    if (isMine && !gameState.ended && !gameState.paused) {
        const simpleRoll = !hasRolled && !rollAgain && !current.inJail && gameState.auction?.status !== 'open';
        action = simpleRoll
            ? '<button class="btn btn-gold btn-sm" data-game-action="roll-dice">Roll Dice</button>'
            : '<button class="btn btn-on-dark btn-sm" data-switch-section="game">Go to turn</button>';
    }
    return `<div class="board-turn">
        ${renderDicePair(dice, { rolling })}
        <div class="board-turn-copy">
            <span class="board-turn-label">${label}</span>
            <strong class="board-turn-name">${isMine ? 'You' : escapeHtml(current.name)}</strong>
        </div>
        ${action}
    </div>`;
}

function renderBoardPlayers(gameState, currentUserId) {
    return gameState.players.map((player, i) => {
        const square = BOARD_SQUARES[player.position || 0] || BOARD_SQUARES[0];
        const where = player.bankrupt ? 'Bankrupt' : (player.inJail ? 'In jail' : square.name);
        const classes = ['board-player'];
        if (i === gameState.currentPlayerIndex && !gameState.ended) classes.push('is-turn');
        if (player.bankrupt) classes.push('is-bankrupt');
        return `<button type="button" class="${classes.join(' ')}" data-board-square="${player.position || 0}">
            <span class="avatar" style="--token-color:${PLAYER_COLORS[i % PLAYER_COLORS.length]}" aria-hidden="true">${escapeHtml(playerInitials(player.name))}</span>
            <span class="board-player-name">${escapeHtml(player.name)}${player.userId === currentUserId ? ' <em>You</em>' : ''}</span>
            <span class="board-player-cash">${formatMoney(player.cash)}</span>
            <span class="board-player-where${player.inJail ? ' is-jail' : ''}">${escapeHtml(where)}</span>
        </button>`;
    }).join('');
}

const BOARD_LEGEND = `<p class="board-legend">
    <span><span class="board-owner-tag is-sample">AB</span> owner</span>
    <span><span class="board-owner-tag is-sample">TIC</span> corporation</span>
    <span><span class="board-house">3</span> houses</span>
    <span><span class="board-hotel">H</span> hotel</span>
    <span><span class="board-legend-band"></span> colour set</span>
</p>`;

// recentEvents: newest first, as loaded for the Recent events tab.
function renderBoard(gameState, currentUserId, recentEvents = []) {
    if (!gameState) return '<p>Loading board...</p>';
    const current = gameState.players[gameState.currentPlayerIndex];
    const focus = boardFocusPosition ?? (current ? current.position || 0 : 0);
    const lastCard = gameState.lastCardDrawn;
    const cardText = lastCard && boardFocusPosition === null ? (lastCard.card || lastCard.text) : '';
    const events = recentEvents.slice(0, 4).map(event => `<li>
        <time>${escapeHtml(formatLogTimestamp(event.created_at))}</time>
        <span>${escapeHtml(formatLogEvent(event.event_type, event.event_data))}</span>
    </li>`).join('');

    return `<div class="board-view">
        <div class="board-frame">
            ${BOARD_SQUARES.map(square => renderBoardCell(square, gameState, boardFocusPosition)).join('')}
            <div class="board-centre" data-board-centre>
                ${renderBoardTurn(gameState, currentUserId)}
                ${renderBoardFocus(gameState, focus)}
                ${cardText ? `<p class="board-card">“${escapeHtml(cardText)}”</p>` : ''}
            </div>
            <div class="board-tokens" aria-hidden="true">${renderBoardTokens(gameState, currentUserId, player => player.position || 0)}</div>
        </div>
        <aside class="board-side">
            <section>
                <h3 class="board-side-title">Players</h3>
                <div class="board-players">${renderBoardPlayers(gameState, currentUserId)}</div>
                ${BOARD_LEGEND}
            </section>
            ${events ? `<section class="board-events-panel">
                <h3 class="board-side-title">Recent events</h3>
                <ul class="board-events">${events}</ul>
            </section>` : ''}
        </aside>
    </div>`;
}

// After a render: tokens that moved forward start where they were and step to
// their new square one square at a time. Jumps (jail, cards that send you back)
// and the first render just appear.
function animateBoardTokens(gameState) {
    const previous = boardTokenPositions;
    boardTokenPositions = new Map(gameState.players.map(p => [p.userId, { position: p.position || 0, inJail: !!p.inJail }]));
    const animation = ++boardTokenAnimation;
    if (!previous.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gameState.players.forEach(player => {
        const before = previous.get(player.userId);
        const to = player.position || 0;
        if (!before || before.position === to || player.inJail) return;
        const steps = (to - before.position + 40) % 40;
        if (steps > 12) return;
        const token = Array.from(document.querySelectorAll('.board-token')).find(el => el.dataset.tokenUser === player.userId);
        if (!token) return;
        const place = position => {
            const spot = boardTokenSpot(position, false);
            token.style.setProperty('--x', `${spot.x}%`);
            token.style.setProperty('--y', `${spot.y}%`);
        };
        const finalX = token.style.getPropertyValue('--x');
        const finalY = token.style.getPropertyValue('--y');
        token.classList.add('is-moving');
        place(before.position);
        let step = 0;
        const hop = () => {
            if (animation !== boardTokenAnimation) return;
            step += 1;
            if (step >= steps) {
                token.style.setProperty('--x', finalX);
                token.style.setProperty('--y', finalY);
                token.classList.remove('is-moving');
                return;
            }
            place((before.position + step) % 40);
            setTimeout(hop, 170);
        };
        setTimeout(hop, 170);
    });
}

// Clicks on the board: a square (or a player) puts it in focus; the same square
// again, or the centre, goes back to the square of whoever's turn it is.
function handleBoardClick(event) {
    const target = event.target.closest('[data-board-square]');
    if (target) {
        const position = Number(target.dataset.boardSquare);
        boardFocusPosition = boardFocusPosition === position && target.classList.contains('board-cell') ? null : position;
        return true;
    }
    if (event.target.closest('[data-board-centre]') && !event.target.closest('button')) {
        boardFocusPosition = null;
        return true;
    }
    return false;
}

// Pointing at a square on desktop shows it in the centre without redrawing the board.
function previewBoardSquare(gameState, position) {
    const focus = document.querySelector('.board-focus');
    if (!focus) return;
    const shown = position ?? boardFocusPosition ?? (gameState.players[gameState.currentPlayerIndex]?.position || 0);
    focus.outerHTML = renderBoardFocus(gameState, shown);
    document.querySelectorAll('.board-cell.is-focused').forEach(cell => cell.classList.remove('is-focused'));
    if (position !== null) document.querySelector(`.board-cell[data-board-square="${position}"]`)?.classList.add('is-focused');
    const card = document.querySelector('.board-card');
    if (card) card.hidden = position !== null;
}

// Helper: does player own all properties in any colour group?
function hasCompleteColorGroup(userId, gameState) {
    const colors = [...new Set(
        gameState.properties
            .filter(p => p.color !== 'Railroad' && p.color !== 'Utility')
            .map(p => p.color)
    )];
    return colors.some(color => {
        const group = gameState.properties.filter(p => p.color === color);
        return group.length > 0 && group.every(p => p.ownerId === userId);
    });
}

// Return list of complete-group properties for a given player
function getCompleteGroupProperties(userId, gameState) {
    const colors = [...new Set(
        gameState.properties
            .filter(p => p.color !== 'Railroad' && p.color !== 'Utility')
            .map(p => p.color)
    )];
    const result = [];
    colors.forEach(color => {
        const group = gameState.properties.filter(p => p.color === color);
        if (group.length > 0 && group.every(p => p.ownerId === userId)) {
            result.push(...group);
        }
    });
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        hasCompleteColorGroup, getCompleteGroupProperties, describeOwner,
        boardGridCell, boardTokenSpot, BOARD_SQUARES, HOUSE_COSTS, PLAYER_COLORS,
    };
}
