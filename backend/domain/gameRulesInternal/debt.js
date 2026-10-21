// Player and corporation debt: issue, pay, refinance.

const { v4: uuidv4 } = require('uuid');
const { uniqueIds, makeEvent, log, positiveNumber, GameRuleError } = require('./util');
const { recordCashFlow } = require('./ledger');
const { canManageCorporationDebt } = require('./corporations');

function issueDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const interestRate = positiveNumber(state.settings.interestRate, 'interestRate');
    if (interestRate > 100) throw new GameRuleError(400, 'Interest rate too high');
    const issuerType = payload.issuerType === 'corporation' ? 'corporation' : 'player';
    const collateralIds = Array.isArray(payload.collateralIds) ? payload.collateralIds : [];
    if (issuerType === 'corporation') {
        const corp = state.corporations.find(c => c.id === payload.corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
        if (!canManageCorporationDebt(corp, player.userId)) {
            throw new GameRuleError(403, 'Only the chairman or controlling shareholder can issue corporation debt');
        }
        const collateral = collateralIds.map(id => {
            const asset = corp.assets.find(item => item.id === id);
            if (!asset) throw new GameRuleError(400, 'Collateral must be owned by corporation');
            return { id: asset.id, name: asset.name, value: asset.value };
        });
        corp.debts.push({ id: `debt-${uuidv4()}`, principal: amount, interestRate, collateral, issueDate: new Date().toISOString(), issuerType: 'corporation' });
        corp.cash = Number(corp.cash || 0) + amount;
        recordCashFlow(state, null, corp.id, amount);
        events.push(makeEvent(player, 'debt_issued', { issuer: `[${corp.ticker}]`, actor: player.name, amount, interestRate }));
        log(state, `${player.name} issued debt under ${corp.ticker}: $${amount.toFixed(2)} @ ${interestRate}%`);
        return;
    }
    const collateral = collateralIds.map(id => {
        const prop = state.properties.find(p => p.id === id && p.ownerId === player.userId);
        if (!prop) throw new GameRuleError(400, 'Collateral must be owned by issuer');
        return { id: prop.id, name: prop.name, value: prop.price };
    });
    player.debts.push({ id: `debt-${uuidv4()}`, principal: amount, interestRate, collateral, issueDate: new Date().toISOString(), issuerType: 'player' });
    player.cash += amount;
    recordCashFlow(state, null, player.userId, amount);
    events.push(makeEvent(player, 'debt_issued', { issuer: player.name, amount, interestRate }));
    log(state, `${player.name} issued debt: $${amount.toFixed(2)} @ ${interestRate}%`);
}

function refinanceDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const interestRate = positiveNumber(state.settings.interestRate, 'interestRate');
    if (interestRate > 100) throw new GameRuleError(400, 'Interest rate too high');

    const selectedDebts = resolveSelectedPlayerDebts(player, payload);
    if (!selectedDebts.length) throw new GameRuleError(400, 'Select at least one debt to refinance');

    const payoffAmount = selectedDebts.reduce((sum, debt) => {
        const principal = Number(debt.principal || 0);
        if (!Number.isFinite(principal) || principal <= 0) {
            throw new GameRuleError(400, 'Selected debts must have positive principal');
        }
        return sum + principal;
    }, 0);

    if (amount <= payoffAmount) {
        throw new GameRuleError(400, 'Refinance amount must exceed selected debt principal');
    }

    const collateralIds = Array.isArray(payload.collateralIds) ? uniqueIds(payload.collateralIds) : [];
    const collateral = collateralIds.map(id => {
        const prop = state.properties.find(p => p.id === id && p.ownerId === player.userId);
        if (!prop) throw new GameRuleError(400, 'Collateral must be owned by issuer');
        return { id: prop.id, name: prop.name, value: prop.price };
    });

    const refinancedFrom = selectedDebts.map(debt => ({
        id: debt.id || null,
        principal: Number(debt.principal || 0),
        interestRate: Number(debt.interestRate || 0),
    }));
    const selectedDebtSet = new Set(selectedDebts);
    player.debts = player.debts.filter(debt => !selectedDebtSet.has(debt));

    const netProceeds = amount - payoffAmount;
    player.debts.push({
        id: `debt-${uuidv4()}`,
        principal: amount,
        interestRate,
        collateral,
        issueDate: new Date().toISOString(),
        issuerType: 'player',
        refinancedFrom,
    });
    player.cash += netProceeds;
    recordCashFlow(state, null, player.userId, amount);
    recordCashFlow(state, player.userId, null, payoffAmount);
    events.push(makeEvent(player, 'debt_refinanced', {
        borrower: player.name,
        amount,
        payoffAmount,
        netProceeds,
        interestRate,
        refinancedDebtCount: selectedDebts.length,
    }));
    log(state, `${player.name} refinanced ${selectedDebts.length} debt(s) into $${amount.toFixed(2)} @ ${interestRate}% and received $${netProceeds.toFixed(2)} net cash`);
}

function resolveSelectedPlayerDebts(player, payload) {
    const refs = [];
    if (Array.isArray(payload.debtIds)) {
        payload.debtIds.forEach(id => refs.push({ id }));
    }
    if (Array.isArray(payload.debtIndexes)) {
        payload.debtIndexes.forEach(index => refs.push({ index }));
    }
    if (payload.debtId) refs.push({ id: payload.debtId });
    if (payload.debtIndex !== undefined) refs.push({ index: payload.debtIndex });

    const selected = [];
    const seenIndexes = new Set();
    refs.forEach(ref => {
        const debt = ref.id
            ? player.debts.find(item => item.id === ref.id)
            : player.debts[Number(ref.index)];
        if (!debt) throw new GameRuleError(404, 'Debt not found');
        const index = player.debts.indexOf(debt);
        if (seenIndexes.has(index)) return;
        seenIndexes.add(index);
        selected.push(debt);
    });
    return selected;
}

function payDebt(state, player, payload, events) {
    const debt = player.debts.find(d => d.id === payload.debtId) || player.debts[Number(payload.debtIndex)];
    const amount = positiveNumber(payload.amount, 'amount');
    if (!debt) throw new GameRuleError(404, 'Debt not found');
    if (player.cash < amount) throw new GameRuleError(400, 'Insufficient funds');
    player.cash -= amount;
    debt.principal -= amount;
    recordCashFlow(state, player.userId, null, amount);
    if (debt.principal <= 0) player.debts = player.debts.filter(d => d !== debt);
    events.push(makeEvent(player, 'debt_payment', { payer: player.name, amount }));
    log(state, `${player.name} paid $${amount.toFixed(2)} towards debt`);
}

module.exports = {
    issueDebt,
    refinanceDebt,
    payDebt,
};
