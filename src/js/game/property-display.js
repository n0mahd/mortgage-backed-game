// Player cards and owned-property rows on the Game tab: colours, set status, rent,
// houses, and the collapsible cards for other players.
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
                                        ${getPropertyKind(property) === 'Street'
                                            ? renderDevelopmentIcons(property)
                                            : escapeHtml(developmentLabel)}
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
                        <span>${escapeHtml(LoanMath.paymentNote(d, isPlayersTurn(player)))}</span>
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

function renderCorporationAssetSummary(corpId) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === corpId);
    if (!corp || !Array.isArray(corp.assets) || corp.assets.length === 0) return '';
    const assets = corp.assets
        .map(asset => `${propertyDot(asset.id)}${escapeHtml(asset.name)}`)
        .join(', ');
    return `<span class="corp-assets-owned">Assets: ${assets}</span>`;
}

function togglePlayerCard(summaryEl) {
    const details = summaryEl.nextElementSibling;
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    summaryEl.setAttribute('aria-expanded', String(!isOpen));
    summaryEl.closest('.player-card').classList.toggle('collapsed', isOpen);
}
