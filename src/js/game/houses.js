// Building houses and hotels on complete colour sets (the house sheet).
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// Pending house selections { propertyId: deltaCount }
let pendingHouseSelections = {};
let houseModalRender = null;

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
        document.getElementById('houseModalTotal').textContent =
            `Total cost ${formatMoney(totalCost)}. You have ${formatMoney(cash)}.`;
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
    await submitGameAction('buy_houses', { selections }, {
        errorText: 'Failed to purchase houses',
        alwaysErrorText: true,
        onSaved: () => {
            pendingHouseSelections = {};
            houseModalRender = null;
            closeModal('houseModal');
        },
    });
}
