// Building houses and hotels on complete colour sets (the house sheet), for
// yourself or for an LLC you run.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// Pending house selections { propertyId: deltaCount }
let pendingHouseSelections = {};
let houseModalRender = null;

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
                        ${renderDevelopmentIcons({ ...prop, houses: newHouses })}
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
