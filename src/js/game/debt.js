// The debt sheet: borrow (personally or for an LLC you run), pay down, refinance.
// Part of the game page; reads game.js's state.

// Open Debt Modal
async function openDebtModal() {
    document.getElementById('debtAction').value = 'issue';
    const rate = Number(currentGame.game_state.settings?.interestRate || 5);
    document.getElementById('loanRate').value = String(rate);
    document.getElementById('loanRateDisplay').textContent = `${rate}% per turn`;
    document.getElementById('debtIssuer').innerHTML = debtIssuerOptionsHtml();
    document.getElementById('loanAmount').value = '';
    document.getElementById('settlementAmount').value = '';
    document.getElementById('refinanceAmount').value = '';
    renderDebtCollateralOptions();
    renderSettleDebtOptions();
    renderRefinanceDebtOptions();
    toggleDebtForm();

    openModal('debtModal');
}

function debtIssuerOptionsHtml() {
    const corporationOptions = getEligibleDebtCorporations().map(corp =>
        `<option value="corporation:${escapeHtml(corp.id)}">${escapeHtml(corp.ticker)} Corporation</option>`
    );
    return [
        '<option value="player">Personal</option>',
        ...corporationOptions,
    ].join('');
}

function getEligibleDebtCorporations() {
    const gameState = currentGame.game_state;
    return (gameState.corporations || []).filter(corp => canManageCorporationDebtUi(corp, currentUser.id));
}

function canManageCorporationDebtUi(corp, userId) {
    if (!corp || !userId) return false;
    return corp.chairmanId === userId || hasMajoritySharesUi(corp, userId);
}

function renderDebtCollateralOptions() {
    const issuer = document.getElementById('debtIssuer')?.value || 'player';
    let assets = currentPlayerData.properties || [];
    if (issuer.startsWith('corporation:')) {
        const corpId = issuer.split(':')[1];
        const corp = currentGame.game_state.corporations.find(item => item.id === corpId);
        assets = corp ? (corp.assets || []) : [];
    }

    renderCollateralAssetList('collateralAssets', assets);
}

function renderCollateralAssetList(containerId, assets, selectedIds = new Set()) {
    const assetsHtml = assets.map(p => {
        const checkboxId = `${containerId}-${p.id}`;
        const checked = selectedIds.has(p.id) ? ' checked' : '';
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${escapeHtml(checkboxId)}" value="${escapeHtml(p.id)}"${checked}>
            <label for="${escapeHtml(checkboxId)}">${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value || p.price || 0)}</span></label>
        </div>
    `;
    }).join('');

    document.getElementById(containerId).innerHTML = assetsHtml || '<p class="empty-state">No collateral assets available</p>';
}

function renderSettleDebtOptions() {
    const debtsHtml = getPersonalDebts().map((debt, index) => `
        <option value="${index}">${debtOptionLabel(debt, index)}</option>
    `).join('');

    document.getElementById('debtToSettle').innerHTML = debtsHtml || '<option value="">No debts to settle</option>';
    updateSettlementFullAmountState();
}

function renderRefinanceDebtOptions() {
    const debts = getPersonalDebts();
    const debtsHtml = debts.map((debt, index) => `
        <div class="asset-checkbox">
            <input type="checkbox" id="refinance-debt-${index}" value="${index}" data-debt-id="${escapeHtml(debt.id || '')}">
            <label for="refinance-debt-${index}">
                ${debtOptionLabel(debt, index)}
                ${debtCollateralText(debt)}
            </label>
        </div>
    `).join('');

    document.getElementById('debtsToRefinance').innerHTML = debtsHtml || '<p class="empty-state">No debts to refinance</p>';
    renderRefinanceCollateralOptions();
    updateRefinanceSummary();
}

function getPersonalDebts() {
    return Array.isArray(currentPlayerData?.debts) ? currentPlayerData.debts : [];
}

function debtPrincipal(debt) {
    return Number(debt?.principal || 0);
}

function debtOptionLabel(debt, index) {
    return `Loan #${index + 1}: $${debtPrincipal(debt).toFixed(2)} @ ${Number(debt?.interestRate || 0)}%`;
}

function debtCollateralText(debt) {
    const collateral = Array.isArray(debt?.collateral) ? debt.collateral : [];
    if (!collateral.length) return '';
    const names = collateral.map(asset => escapeHtml(asset.name || asset.id || 'Asset')).join(', ');
    return `<span class="debt-detail">Backed by: ${names}</span>`;
}

function getSelectedRefinanceDebtItems() {
    const debts = getPersonalDebts();
    return Array.from(document.querySelectorAll('#debtsToRefinance input:checked'))
        .map(input => Number(input.value))
        .filter(index => Number.isInteger(index) && debts[index])
        .map(index => ({ index, debt: debts[index] }));
}

function getRefinancePayoffAmount() {
    return getSelectedRefinanceDebtItems()
        .reduce((sum, item) => sum + debtPrincipal(item.debt), 0);
}

function renderRefinanceCollateralOptions() {
    const selectedCollateralIds = new Set();
    getSelectedRefinanceDebtItems().forEach(item => {
        (Array.isArray(item.debt.collateral) ? item.debt.collateral : []).forEach(asset => {
            if (asset?.id) selectedCollateralIds.add(asset.id);
        });
    });
    renderCollateralAssetList('refinanceCollateralAssets', currentPlayerData.properties || [], selectedCollateralIds);
}

function updateSettlementFullAmountState() {
    const debtIndex = parseInt(document.getElementById('debtToSettle').value, 10);
    const debt = getPersonalDebts()[debtIndex];
    const button = document.getElementById('payFullDebtBtn');
    if (!button) return;
    button.disabled = !debt;
}

function fillFullSettlementAmount() {
    const debtIndex = parseInt(document.getElementById('debtToSettle').value, 10);
    const debt = getPersonalDebts()[debtIndex];
    if (!debt) return;
    const input = document.getElementById('settlementAmount');
    input.value = debtPrincipal(debt).toFixed(2);
    input.focus();
}

function updateRefinanceSummary() {
    const summary = document.getElementById('refinanceSummary');
    if (!summary) return;
    const selectedCount = getSelectedRefinanceDebtItems().length;
    const payoffAmount = getRefinancePayoffAmount();
    const newLoanAmount = parseFloat(document.getElementById('refinanceAmount').value);
    const netCash = Number.isFinite(newLoanAmount) ? newLoanAmount - payoffAmount : 0;
    summary.classList.toggle('debt-flow-warning', selectedCount > 0 && Number.isFinite(newLoanAmount) && netCash <= 0);

    if (!selectedCount) {
        summary.textContent = 'Selected payoff: $0.00';
        return;
    }

    const netText = Number.isFinite(newLoanAmount) ? `$${netCash.toFixed(2)}` : '$0.00';
    summary.textContent = `Selected payoff: $${payoffAmount.toFixed(2)} | Net new cash: ${netText}`;
}

function toggleDebtForm() {
    const action = document.getElementById('debtAction').value;
    document.getElementById('issueDebtForm').style.display = action === 'issue' ? 'block' : 'none';
    document.getElementById('settleDebtForm').style.display = action === 'settle' ? 'block' : 'none';
    document.getElementById('refinanceDebtForm').style.display = action === 'refinance' ? 'block' : 'none';
    if (action === 'settle') updateSettlementFullAmountState();
    if (action === 'refinance') updateRefinanceSummary();
}

async function processDebt() {
    const action = document.getElementById('debtAction').value;

    if (action === 'issue') {
        await issueDebt();
    } else if (action === 'settle') {
        await settleDebt();
    } else if (action === 'refinance') {
        await refinanceDebt();
    }
}

async function issueDebt() {
    const loanAmount = parseFloat(document.getElementById('loanAmount').value);
    const interestRate = Number(currentGame.game_state.settings?.interestRate || document.getElementById('loanRate').value || 5);
    const issuer = document.getElementById('debtIssuer').value || 'player';
    const issuerType = issuer.startsWith('corporation:') ? 'corporation' : 'player';
    const corpId = issuerType === 'corporation' ? issuer.split(':')[1] : null;

    const selectedCollateral = Array.from(document.querySelectorAll('#collateralAssets input:checked'))
        .map(cb => cb.value);

    if (!loanAmount) {
        alert('Please enter a loan amount');
        return;
    }

    await submitGameAction('issue_debt', {
        amount: loanAmount,
        interestRate,
        issuerType,
        corpId,
        collateralIds: selectedCollateral,
    }, {
        errorText: 'Failed to issue debt',
        alwaysErrorText: true,
        onSaved: () => closeModal('debtModal'),
    });
}

async function settleDebt() {
    const debtIndex = parseInt(document.getElementById('debtToSettle').value, 10);
    const paymentAmount = parseFloat(document.getElementById('settlementAmount').value);

    if (isNaN(debtIndex) || !paymentAmount) {
        alert('Please select a debt and enter payment amount');
        return;
    }

    if (currentPlayerData.cash < paymentAmount) {
        alert('Insufficient funds');
        return;
    }

    const debt = currentPlayerData.debts[debtIndex];
    await submitGameAction('pay_debt', {
        debtId: debt && debt.id,
        debtIndex,
        amount: paymentAmount,
    }, {
        errorText: 'Failed to settle debt',
        alwaysErrorText: true,
        onSaved: () => closeModal('debtModal'),
    });
}

async function refinanceDebt() {
    const selectedItems = getSelectedRefinanceDebtItems();
    const refinanceAmount = parseFloat(document.getElementById('refinanceAmount').value);
    const payoffAmount = getRefinancePayoffAmount();

    if (!selectedItems.length) {
        alert('Please select at least one debt to refinance');
        return;
    }

    if (!refinanceAmount) {
        alert('Please enter a new loan amount');
        return;
    }

    if (refinanceAmount <= payoffAmount) {
        alert('New loan amount must be greater than the selected payoff amount');
        return;
    }

    const selectedCollateral = Array.from(document.querySelectorAll('#refinanceCollateralAssets input:checked'))
        .map(cb => cb.value);

    await submitGameAction('refinance_debt', {
        amount: refinanceAmount,
        debtIds: selectedItems.map(item => item.debt.id).filter(Boolean),
        debtIndexes: selectedItems.map(item => item.index),
        collateralIds: selectedCollateral,
    }, {
        errorText: 'Failed to refinance debt',
        alwaysErrorText: true,
        onSaved: () => closeModal('debtModal'),
    });
}
