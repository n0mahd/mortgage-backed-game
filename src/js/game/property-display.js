// The Game tab's players list (renderSeatList): your deeds first, then every other
// player with their deed swatches and cash, each opening to one line per deed; and the
// property helpers it and other screens share (colours, set status, rent, houses).
// Part of the game page; reads game.js's currentGame.

function getPlayerColor(player) {
    const index = currentGame?.game_state?.players?.findIndex(p => p.userId === player?.userId) ?? -1;
    return PLAYER_COLORS[Math.max(index, 0) % PLAYER_COLORS.length];
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

// Green house pips or one red hotel pip, labelled for screen readers, so a
// count reads at a glance instead of as "2 houses".
function renderDevelopmentIcons(property) {
    const houses = Number(property.houses || 0);
    if (getPropertyKind(property) !== 'Street') {
        return '<span class="building-na" aria-hidden="true"></span>';
    }
    const label = escapeHtml(getPropertyDevelopmentLabel(property));
    const pips = houses === 5
        ? '<span class="hotel-pip"></span>'
        : houses > 0
            ? Array.from({ length: houses }, () => '<span class="house-pip"></span>').join('')
            : '<span class="empty-house-pip"></span>';
    return `<span class="development-icons" role="img" aria-label="${label}" title="${label}">${pips}</span>`;
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

// The board's short name for a property ("Baltic Ave"), for compact rows.
function propertyShortName(property) {
    return BOARD_SQUARES.find(square => square.propertyId === property.id)?.name || property.name;
}

// The rent a deed charges now, short: "$8", "$50", "4× dice".
function getPropertyRentShort(property, allProperties, ownerId) {
    const label = getPropertyRentLabel(property, allProperties, allProperties.filter(prop => prop.ownerId === ownerId), ownerId);
    return label.replace(/^Rent /, '').replace(/(\d+)x dice/, '$1× dice');
}

// Which seats are open in the players list, kept across re-renders for this page view.
// Your own seat starts open; others start closed.
const openSeatIds = new Set();
const closedSeatIds = new Set();

function seatIsOpen(userId, isMe) {
    if (isMe) return !closedSeatIds.has(userId);
    return openSeatIds.has(userId);
}

function renderSeatSwatches(properties) {
    if (!properties.length) return '<span class="seat-swatches"></span>';
    return `<span class="seat-swatches" aria-hidden="true">${properties.map(prop =>
        `<i style="--property-color:${escapeHtml(getPropertyColorValue(prop.color))}"></i>`).join('')}</span>`;
}

function renderDeedLines(player, properties) {
    const allProperties = currentGame?.game_state?.properties || [];
    return `
        <ul class="seat-deeds">
            ${properties.map(property => {
                const group = getPropertyGroupStatus(property, allProperties, properties, player.userId);
                return `
                    <li class="deed-line" style="--property-color:${escapeHtml(getPropertyColorValue(property.color))}">
                        <span class="deed-line-name">${escapeHtml(propertyShortName(property))}</span>
                        ${getPropertyKind(property) === 'Street' && Number(property.houses || 0) > 0 ? renderDevelopmentIcons(property) : ''}
                        ${group.complete ? '<span class="badge badge-gold">Set</span>' : `<span class="deed-line-set">${group.owned}/${group.total}</span>`}
                        <span class="deed-line-rent">${escapeHtml(getPropertyRentShort(property, allProperties, player.userId))}</span>
                    </li>`;
            }).join('')}
        </ul>`;
}

// One players list: your row first as "Your deeds" (your cash is on the ticket), then
// everyone else with their cash. A row with deeds opens to one line per deed.
function renderSeatList(gameState) {
    const me = gameState.players.find(p => p.userId === currentUser.id);
    const others = gameState.players.filter(p => p.userId !== currentUser.id);
    const turnPlayerId = !gameState.ended ? gameState.players[gameState.currentPlayerIndex]?.userId : null;
    const rows = [me ? renderSeat(me, true, turnPlayerId) : '', ...others.map(player => renderSeat(player, false, turnPlayerId))];
    return `<div class="group seat-list" aria-label="Players">${rows.join('')}</div>`;
}

function renderSeat(player, isMe, turnPlayerId) {
    const properties = getOwnedPropertyDetails(player);
    const open = properties.length > 0 && seatIsOpen(player.userId, isMe);
    const classes = ['seat', isMe ? 'is-me' : '', player.userId === turnPlayerId && !isMe ? 'is-turn' : '', player.bankrupt ? 'is-out' : '', open ? 'is-open' : '']
        .filter(Boolean).join(' ');
    const badges = player.bankrupt
        ? '<span class="badge badge-danger">Bankrupt</span>'
        : (player.inJail && !(isMe && player.userId === turnPlayerId) ? '<span class="badge badge-gold">In Jail</span>' : '')
            // In Jail on your turn, Use Card in the dock already says you have one.
            + (player.hasGetOutOfJailCard && !player.bankrupt && !(isMe && player.inJail && player.userId === turnPlayerId) ? '<span class="badge badge-gold">Jail card</span>' : '');
    const name = isMe ? 'Your deeds' : player.name;
    const inner = `
        ${playerAvatarHtml(player, 'sm')}
        <span class="seat-name">${escapeHtml(name)}${isMe ? `<span class="sr-only">, ${escapeHtml(player.name)}</span>` : ''}</span>
        ${badges}
        ${renderSeatSwatches(properties)}
        ${isMe ? '' : `<span class="seat-cash money${Number(player.cash) < 0 ? ' is-negative' : ''}">${formatMoney(player.cash)}</span>`}
        ${properties.length ? '<svg class="seat-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>' : ''}`;
    const row = properties.length
        ? `<button type="button" class="seat-row" data-seat-toggle="${escapeHtml(player.userId)}" aria-expanded="${open}">${inner}</button>`
        : `<div class="seat-row">${inner}</div>`;
    return `
        <div class="${classes}" data-player-id="${escapeHtml(player.userId)}">
            ${row}
            ${open ? renderDeedLines(player, properties) : ''}
        </div>`;
}

function toggleSeat(button) {
    const userId = button.dataset.seatToggle;
    const isMe = userId === currentUser?.id;
    const open = seatIsOpen(userId, isMe);
    if (isMe) {
        if (open) closedSeatIds.add(userId); else closedSeatIds.delete(userId);
    } else if (open) {
        openSeatIds.delete(userId);
    } else {
        openSeatIds.add(userId);
    }
    const seatList = button.closest('.seat-list');
    if (seatList && currentGame) seatList.outerHTML = renderSeatList(currentGame.game_state);
    document.querySelector(`.seat-list [data-seat-toggle="${CSS.escape(userId)}"]`)?.focus();
}
