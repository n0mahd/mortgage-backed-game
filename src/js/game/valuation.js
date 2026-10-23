// What things are worth: player net worth, property and LLC (corporation) values,
// debt totals, cash flow this turn, and listed shares. Display numbers only; the
// server decides real outcomes. Part of the game page; reads game.js's currentGame.

function getPlayerNetWorth(player) {
    if (!player) return 0;
    const ownedProperties = getOwnedPropertyDetails(player);
    const totalPropertyValue = ownedProperties.reduce((sum, p) => sum + propertyAssetValue(p), 0);
    return Number(player.cash || 0) + totalPropertyValue + getPlayerCorporationValue(player) - getDebtTotal(player.debts);
}

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
    const square = BOARD_SQUARES.find(item => item.propertyId === propertyId);
    return square ? square.position : 999;
}

function propertyAssetValue(property) {
    if (property.value != null && Number.isFinite(Number(property.value))) {
        return Number(property.value);
    }
    return Number(property.price || 0) + Number(property.houses || 0) * (HOUSE_COSTS[property.color] || 0);
}

function getDebtTotal(debts) {
    return (debts || []).reduce((sum, debt) => sum + Number(debt.principal || 0), 0);
}

function getPlayerCorporationValue(player) {
    return (player.corporations || []).reduce((sum, corp) => {
        return sum + Number(corp.sharesOwned || 0) * getPlayerCorporationShareValue(corp);
    }, 0);
}

function getPlayerCorporationShareValue(playerCorp) {
    if (Number.isFinite(Number(playerCorp.shareValue))) return Number(playerCorp.shareValue);
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === playerCorp.id);
    return corp ? getCorporationShareValue(corp) : 0;
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

function getCorporationNetAssetValue(corp) {
    if (ShareDeals.isInsolvent(corp)) return 0;
    return getCorporationAssetValue(corp) + Number(corp.cash || 0) - getDebtTotal(corp.debts);
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

function getListedShares(corp) {
    return Math.max(0, Number(corp.availableShares || 0));
}

function getTreasuryListedShares(corp) {
    return Math.min(Math.max(0, Number(corp.treasuryShares || 0)), getListedShares(corp));
}

// Only an LLC's own treasury shares sell at its price; shares a player holds
// change hands only through a trade offer they accept.
function getBuyableListedShares(corp) {
    return getTreasuryListedShares(corp);
}
