// Buying the square you landed on (for yourself or an LLC you run), or sending
// it to auction, and bidding.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

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
