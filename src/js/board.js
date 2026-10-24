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
    // Bottom row: pos 0–10 (left → right)
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

function getGridCoords(position) {
    if (position <= 10) {
        return { row: 11, col: position + 1 };         // Bottom row
    } else if (position <= 19) {
        return { row: 21 - position, col: 1 };          // Left column
    } else if (position <= 29) {
        return { row: 1, col: position - 19 };          // Top row
    } else {
        return { row: position - 29, col: 11 };         // Right column
    }
}

function getEdgeClass(position) {
    if (position <= 10)  return 'bottom-row';
    if (position <= 19)  return 'left-col';
    if (position <= 29)  return 'top-row';
    return 'right-col';
}

function renderSquare(square, gameState, currentUserId, playerIndex) {
    const { row, col } = getGridCoords(square.position);
    const edgeClass = getEdgeClass(square.position);
    const isCorner = [0, 10, 20, 30].includes(square.position);

    // Players on this square
    const playersHere = gameState.players
        .filter(p => !p.bankrupt && (p.position || 0) === square.position);

    const tokenHtml = playersHere.map((p, i) => {
        const pIdx = gameState.players.indexOf(p);
        const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
        const initials = escapeHtml(p.name.substring(0, 2).toUpperCase());
        const playerName = escapeHtml(p.name);
        const isCurrent = p.userId === currentUserId;
        return `<div class="player-token${isCurrent ? ' current-user-token' : ''}" style="background:${color}" title="${playerName}">${initials}</div>`;
    }).join('');

    // Houses/hotel on property
    let houseHtml = '';
    if (square.propertyId) {
        const prop = gameState.properties && gameState.properties.find(p => p.id === square.propertyId);
        if (prop && prop.houses > 0) {
            if (prop.houses === 5) {
                houseHtml = `<div class="house-indicators"><div class="hotel-icon" title="Hotel">H</div></div>`;
            } else {
                const dots = Array(prop.houses).fill('<div class="house-icon"></div>').join('');
                houseHtml = `<div class="house-indicators">${dots}</div>`;
            }
        }
    }

    // Ownership indicator
    let ownerDot = '';
    if (square.propertyId) {
        const prop = gameState.properties && gameState.properties.find(p => p.id === square.propertyId);
        if (prop && prop.ownerId) {
            const owner = describeOwner(gameState, prop.ownerId, prop.ownerName);
            const ownerColor = owner.playerIndex >= 0 ? PLAYER_COLORS[owner.playerIndex % PLAYER_COLORS.length] : '#888';
            ownerDot = `<div class="owner-dot${owner.corporation ? ' owner-dot-corp' : ''}" style="background:${ownerColor}" title="Owned by ${escapeHtml(owner.label)}"></div>`;
        }
    }

    // Color band
    let colorBandHtml = '';
    if (square.color) {
        colorBandHtml = `<div class="color-band" style="background:${square.color}"></div>`;
    }

    // Type class
    const typeClass = {
        'chance':          'chance',
        'community_chest': 'community-chest',
        'tax':             'tax',
        'railroad':        'railroad',
        'go':              'go',
        'free_parking':    'free-parking',
        'go_to_jail':      'go-to-jail',
        'jail':            'jail',
    }[square.type] || '';

    const cornerClass = isCorner ? ' corner' : '';

    // Short name for display
    const displayName = square.name.length > 14
        ? square.name.substring(0, 13) + '…'
        : square.name;
    const safeName = escapeHtml(square.name);
    const safeDisplayName = escapeHtml(displayName);

    return `<div class="board-square ${edgeClass}${cornerClass} ${typeClass}"
                 style="grid-row:${row};grid-column:${col};"
                 title="${safeName}">
        ${colorBandHtml}
        <div class="square-name">${safeDisplayName}</div>
        ${ownerDot}
        ${houseHtml}
        <div class="player-tokens">${tokenHtml}</div>
    </div>`;
}

function getSquareProperty(square, gameState) {
    if (!square.propertyId || !gameState.properties) return null;
    return gameState.properties.find(p => p.id === square.propertyId) || null;
}

function getPlayersOnSquare(gameState, position) {
    return gameState.players.filter(p => !p.bankrupt && (p.position || 0) === position);
}

function renderMobileTokens(players, gameState, currentUserId) {
    if (players.length === 0) return '';
    return `<div class="mobile-square-tokens">
        ${players.map(p => {
            const pIdx = gameState.players.indexOf(p);
            const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
            const initials = escapeHtml(p.name.substring(0, 2).toUpperCase());
            const label = escapeHtml(p.name);
            return `<span class="mobile-player-token${p.userId === currentUserId ? ' is-you' : ''}"
                style="--token-color:${color}" title="${label}">${initials}</span>`;
        }).join('')}
    </div>`;
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

function renderMobileSquareMeta(square, property, gameState) {
    if (property) {
        const owner = property.ownerId ? escapeHtml(gameState ? describeOwner(gameState, property.ownerId, property.ownerName).label : (property.ownerName || '')) : 'Unowned';
        const price = property.price != null ? `$${property.price}` : '';
        const houses = property.houses > 0 ? renderDevelopmentIcons(property) : '';
        return `<div class="mobile-square-meta">
            <span>${owner}</span>
            ${price ? `<span>${price}</span>` : ''}
            ${houses}
        </div>`;
    }

    const typeLabels = {
        go: 'Collect salary',
        chance: 'Draw Chance',
        community_chest: 'Draw Community Chest',
        tax: square.taxAmount ? `Tax $${square.taxAmount}` : 'Tax',
        railroad: 'Railroad',
        utility: 'Utility',
        jail: 'Jail',
        free_parking: 'Free Parking',
        go_to_jail: 'Go to Jail',
    };
    return `<div class="mobile-square-meta"><span>${typeLabels[square.type] || escapeHtml(square.type)}</span></div>`;
}

function renderMobileBoardSquare(square, gameState, currentUserId, options = {}) {
    const property = getSquareProperty(square, gameState);
    const playersHere = getPlayersOnSquare(gameState, square.position);
    const colorStyle = square.color ? ` style="--square-color:${square.color}"` : '';
    const ownedClass = property && property.ownerId ? ' is-owned' : '';
    const currentClass = options.current ? ' is-current-square' : '';
    const upcomingClass = options.upcoming ? ' is-upcoming-square' : '';

    return `<div class="mobile-board-square${ownedClass}${currentClass}${upcomingClass}"${colorStyle}>
        <div class="mobile-square-main">
            <span class="mobile-square-position">${square.position}</span>
            <div class="mobile-square-copy">
                <div class="mobile-square-name">${escapeHtml(square.name)}</div>
                ${renderMobileSquareMeta(square, property, gameState)}
            </div>
            ${renderMobileTokens(playersHere, gameState, currentUserId)}
        </div>
    </div>`;
}

function renderMobileBoard(gameState, currentUserId, controlsHtml, diceHtml, cardHtml) {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const myPlayer = gameState.players.find(p => p.userId === currentUserId);
    const focusPlayer = myPlayer || currentPlayer || gameState.players[0];
    const focusPosition = focusPlayer ? (focusPlayer.position || 0) : 0;
    const focusSquare = BOARD_SQUARES[focusPosition] || BOARD_SQUARES[0];
    const currentTurnName = currentPlayer ? escapeHtml(currentPlayer.name) : 'Waiting';

    const upcomingHtml = Array.from({ length: 5 }, (_, i) => {
        const square = BOARD_SQUARES[(focusPosition + i + 1) % BOARD_SQUARES.length];
        return renderMobileBoardSquare(square, gameState, currentUserId, { upcoming: true });
    }).join('');

    const trackHtml = BOARD_SQUARES.map(square => {
        const isCurrent = square.position === focusPosition;
        return renderMobileBoardSquare(square, gameState, currentUserId, { current: isCurrent });
    }).join('');

    const playersHtml = gameState.players.map((p, i) => {
        const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        const square = BOARD_SQUARES[p.position || 0] || BOARD_SQUARES[0];
        const currentClass = i === gameState.currentPlayerIndex ? ' is-turn-player' : '';
        const youClass = p.userId === currentUserId ? ' is-you' : '';
        return `<div class="mobile-board-player${currentClass}${youClass}">
            <span class="mobile-player-dot" style="--token-color:${color}"></span>
            <div>
                <div class="mobile-player-name">${escapeHtml(p.name)}${p.userId === currentUserId ? ' <span>You</span>' : ''}</div>
                <div class="mobile-player-location">${escapeHtml(square.name)}</div>
            </div>
            <strong>$${Math.round(p.cash || 0)}</strong>
        </div>`;
    }).join('');

    return `<div class="mobile-board-view">
        <section class="mobile-board-hero">
            <div>
                <p class="mobile-board-label">${focusPlayer && focusPlayer.userId === currentUserId ? 'Your position' : 'Current position'}</p>
                <h2>${escapeHtml(focusSquare.name)}</h2>
                ${renderMobileSquareMeta(focusSquare, getSquareProperty(focusSquare, gameState), gameState)}
            </div>
            ${renderMobileTokens(getPlayersOnSquare(gameState, focusSquare.position), gameState, currentUserId)}
        </section>

        <section class="mobile-board-turn">
            <div>
                <p class="mobile-board-label">Turn</p>
                <strong>${currentTurnName}</strong>
            </div>
            ${diceHtml}
        </section>

        ${controlsHtml ? `<div class="mobile-board-controls">${controlsHtml}</div>` : ''}
        ${cardHtml ? `<section class="mobile-board-card">${cardHtml}</section>` : ''}

        <section class="mobile-board-section">
            <div class="mobile-board-section-header">
                <h3>Coming Up</h3>
                <span>next 5 spaces</span>
            </div>
            <div class="mobile-board-upcoming">${upcomingHtml}</div>
        </section>

        <section class="mobile-board-section">
            <div class="mobile-board-section-header">
                <h3>Players</h3>
                <span>${gameState.players.length} active</span>
            </div>
            <div class="mobile-board-players">${playersHtml}</div>
        </section>

        <section class="mobile-board-section">
            <div class="mobile-board-section-header">
                <h3>Full Track</h3>
                <span>0-39</span>
            </div>
            <div class="mobile-board-track">${trackHtml}</div>
        </section>
    </div>`;
}

function renderBoard(gameState, currentUserId) {
    if (!gameState) return '<p>Loading board...</p>';

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = currentPlayer && currentPlayer.userId === currentUserId;
    const myPlayer = gameState.players.find(p => p.userId === currentUserId);
    const myDiceRolled = myPlayer && myPlayer.diceRolled;

    // Dice display
    const dice = gameState.lastDiceRoll;
    const diceHtml = `<div class="dice-area">
               ${renderDicePair(dice)}
               ${dice ? `<span>= ${dice[0] + dice[1]}</span>` : ''}
           </div>`;

    // Roll button
    let rollBtnHtml = '';
    if (isMyTurn && !myDiceRolled) {
        rollBtnHtml = `<button class="btn btn-primary" data-game-action="roll-dice">Roll Dice</button>`;
    }

    // Buy Houses button
    let houseBtnHtml = '';
    if (isMyTurn && myPlayer) {
        const hasCompleteGroup = hasCompleteColorGroup(myPlayer.userId, gameState);
        if (hasCompleteGroup) {
            houseBtnHtml = `<button class="btn btn-secondary" data-game-action="open-house">Buy Houses</button>`;
        }
    }

    // Standing rows
    const standingsHtml = gameState.players.map((p, i) => {
        const isActive = i === gameState.currentPlayerIndex;
        const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        const jailNote = p.inJail ? ' (Jail)' : '';
        const bankruptNote = p.bankrupt ? ' (Bankrupt)' : '';
        return `<div class="board-standing-row${isActive ? ' active-turn' : ''}${p.inJail ? ' in-jail' : ''}">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>
            <span style="flex:1">${escapeHtml(p.name)}${jailNote}${bankruptNote}</span>
            <span>$${Math.round(p.cash)}</span>
            <span style="margin-left:8px;color:#888;font-size:0.7rem;">pos:${p.position || 0}</span>
        </div>`;
    }).join('');

    // Last card drawn (the engine stores its text as `card`; older saves used `text`)
    const lastCard = gameState.lastCardDrawn;
    const cardHtml = lastCard
        ? `<div class="board-card-text">"${escapeHtml(lastCard.card || lastCard.text)}"</div>`
        : '';

    // Center panel
    const centerHtml = `
        <div class="center-panel">
            <div style="text-align:center;font-weight:bold;color:#2c3e50;margin-bottom:4px;">
                ${currentPlayer ? `${escapeHtml(currentPlayer.name)}'s turn` : ''}
            </div>
            ${diceHtml}
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">
                ${rollBtnHtml}
                ${houseBtnHtml}
            </div>
            <div class="board-standings">${standingsHtml}</div>
            ${cardHtml}
        </div>`;

    // All 40 squares
    const squaresHtml = BOARD_SQUARES.map(sq => renderSquare(sq, gameState, currentUserId)).join('\n');
    const controlsHtml = `${rollBtnHtml}${houseBtnHtml}`;

    return `
        ${renderMobileBoard(gameState, currentUserId, controlsHtml, diceHtml, cardHtml)}
        <div class="board-tab-wrapper">
            <div class="board-grid">
                ${squaresHtml}
                ${centerHtml}
            </div>
        </div>`;
}

function scaleBoardToFit() {
    const wrapper = document.querySelector('.board-tab-wrapper');
    const grid = document.querySelector('.board-grid');
    if (!wrapper || !grid) return;
    if (window.matchMedia('(max-width: 899px)').matches) {
        grid.style.transform = '';
        grid.style.transformOrigin = '';
        wrapper.style.height = '';
        return;
    }
    const BOARD_SIZE = 668;
    const available = wrapper.clientWidth - 4;
    const scale = Math.min(1, available / BOARD_SIZE);
    if (scale < 1) {
        grid.style.transform = `scale(${scale})`;
        grid.style.transformOrigin = 'top left';
        wrapper.style.height = `${BOARD_SIZE * scale}px`;
    } else {
        grid.style.transform = '';
        grid.style.transformOrigin = '';
        wrapper.style.height = '';
    }
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
        BOARD_SQUARES, HOUSE_COSTS, PLAYER_COLORS,
    };
}
