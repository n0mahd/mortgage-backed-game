// The Debt sheet: your loans and your LLCs' (balances, autopay, payments), new
// loans and refinancing. Loan terms, quotes and status wording come from
// loans.js (LoanMath), which mirrors the server's loan rules.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// Debt page: your loans (balances, autopay, payments), new loans and refinancing.
function openDebtModal() {
    const isMyTurn = isCurrentUsersTurn();
    const select = document.getElementById('debtAction');
    select.querySelectorAll('option[value="issue"], option[value="refinance"]').forEach(option => {
        option.disabled = !isMyTurn;
    });
    select.value = isMyTurn && !getManagedLoans().length ? 'issue' : 'loans';
    const rates = LoanMath.loanRates(currentGame.game_state);
    document.getElementById('loanRatesHint').textContent =
        `Rates this game: ${LoanMath.LOAN_TERMS.map(term => `${term} turns at ${rates[term]}%`).join(', ')} per turn. Each payment includes interest; the whole balance is due when the term ends.`;
    document.getElementById('debtIssuer').innerHTML = debtIssuerOptionsHtml();
    document.getElementById('loanAmount').value = '';
    document.getElementById('loanAutopay').checked = true;
    renderLoanList();
    renderBorrowingLimit();
    renderLoanTerms('loanTerms', 'loanAmount');
    renderRefinanceBorrowerOptions();
    toggleDebtForm();

    openModal('debtModal');
}

// Loans you can manage: your own, then those of corporations you run.
function getManagedLoans() {
    const own = getPersonalDebts().map(debt => ({ debt, corp: null }));
    const corporate = getEligibleDebtCorporations()
        .filter(corp => !ShareDeals.isInsolvent(corp))
        .flatMap(corp => (corp.debts || []).map(debt => ({ debt, corp })));
    return [...own, ...corporate];
}

function renderLoanList() {
    const container = document.getElementById('loanList');
    if (!container) return;
    const loans = getManagedLoans();
    if (!loans.length) {
        container.innerHTML = '<p class="empty-state">No loans. Choose "Take a new loan" to borrow against a property.</p>';
        return;
    }
    const isMyTurn = isCurrentUsersTurn();
    container.innerHTML = loans.map(({ debt, corp }) => renderLoanRow(debt, corp, isMyTurn)).join('');
}

function renderLoanRow(debt, corp, isMyTurn) {
    // A corporation's loans count down on its chairman's turn.
    const status = LoanMath.loanStatus(debt, { dueThisTurn: isMyTurn && (!corp || corp.chairmanId === currentUser.id) });
    const cash = corp ? Number(corp.cash || 0) : Number(currentPlayerData?.cash || 0);
    const borrower = corp ? `${corp.ticker} (corporation)` : 'Personal';
    const autopayId = `loan-autopay-${debt.id}`;
    const amountId = `loan-pay-${debt.id}`;
    const ids = `data-debt-id="${escapeHtml(debt.id)}" data-corp-id="${escapeHtml(corp ? corp.id : '')}"`;
    let schedule;
    if (status.dueInFull) {
        const when = status.dueThisTurn ? 'when you end this turn' : `at the end of ${corp ? 'the chairman\'s' : 'your'} next turn`;
        schedule = `${formatMoney(status.nextPayment)} is due in full ${when}. If there isn't the cash, ${corp ? `${corp.ticker} becomes insolvent` : 'you go bankrupt'}.`;
    } else if (status.autopay) {
        schedule = `Autopay takes ${formatMoney(status.nextPayment)} at the end of ${corp ? 'the chairman\'s' : 'your'} turn.`;
    } else {
        schedule = `Autopay is off. Next scheduled payment ${formatMoney(status.nextPayment)}; anything unpaid adds ${formatMoney(status.interestNext)} interest to the balance.`;
    }
    const payDisabled = isMyTurn ? '' : ' disabled';
    return `
        <article class="loan-row${status.dueInFull ? ' is-due' : ''}" ${ids}>
            <div class="loan-row-head">
                <span class="loan-balance">${formatMoney(status.balance)}</span>
                <span class="badge ${status.dueInFull ? 'badge-danger' : 'badge-info'}">${escapeHtml(status.turnsLabel)}</span>
            </div>
            <p class="debt-detail">${escapeHtml(borrower)} · ${escapeHtml(status.termLabel)}</p>
            <p class="loan-schedule">${escapeHtml(schedule)}</p>
            <div class="asset-list">
                <div class="asset-checkbox">
                    <input type="checkbox" role="switch" id="${escapeHtml(autopayId)}" data-loan-autopay ${ids}${status.autopay ? ' checked' : ''}${status.dueInFull ? ' disabled' : ''}>
                    <label for="${escapeHtml(autopayId)}">Autopay</label>
                </div>
            </div>
            <div class="loan-pay">
                <label class="field-label" for="${escapeHtml(amountId)}">Pay an amount</label>
                <div class="inline-action-row">
                    <input type="number" inputmode="decimal" min="0" step="0.01" id="${escapeHtml(amountId)}" placeholder="Up to ${escapeHtml(formatMoney(Math.min(cash, status.balance)))}"${payDisabled}>
                    <button type="button" class="btn btn-secondary btn-sm" data-loan-pay ${ids}${payDisabled}>Pay</button>
                </div>
                <button type="button" class="btn btn-success btn-sm btn-block" data-loan-payoff ${ids}${payDisabled || (cash < status.balance ? ' disabled' : '')}>Pay off ${formatMoney(status.balance)}</button>
                ${isMyTurn ? (cash < status.balance ? `<p class="debt-detail">Paying off needs ${formatMoney(status.balance)}; ${corp ? `${corp.ticker} has` : 'you have'} ${formatMoney(cash)}.</p>` : '') : '<p class="debt-detail">You can make payments on your turn. Autopay can be changed any time.</p>'}
            </div>
        </article>
    `;
}

function findManagedLoan(element) {
    const debtId = element.dataset.debtId;
    const corpId = element.dataset.corpId || null;
    return getManagedLoans().find(item => item.debt.id === debtId && (item.corp ? item.corp.id : null) === corpId) || null;
}

async function handleLoanListClick(event) {
    const button = event.target.closest('[data-loan-pay], [data-loan-payoff]');
    if (!button) return;
    const loan = findManagedLoan(button);
    if (!loan) return;
    let amount;
    if (button.hasAttribute('data-loan-payoff')) {
        amount = Number(loan.debt.principal || 0);
    } else {
        amount = parseFloat(document.getElementById(`loan-pay-${loan.debt.id}`).value);
        if (!(amount > 0)) {
            alert('Enter an amount to pay.');
            return;
        }
    }
    await submitGameAction('pay_debt', { debtId: loan.debt.id, corpId: loan.corp ? loan.corp.id : undefined, amount }, {
        errorText: 'Failed to pay the loan',
        onSaved: renderLoanList,
    });
}

async function handleLoanAutopayChange(event) {
    const input = event.target.closest('[data-loan-autopay]');
    if (!input) return;
    const loan = findManagedLoan(input);
    if (!loan) return;
    await submitGameAction('set_debt_autopay', { debtId: loan.debt.id, corpId: loan.corp ? loan.corp.id : undefined, autopay: input.checked }, {
        errorText: 'Failed to change autopay',
    });
    // Redraw either way, so a refused change puts the switch back.
    renderLoanList();
}

// Term choices with what each costs at the amount typed: the payment each turn and the total.
function renderLoanTerms(containerId, amountInputId) {
    const container = document.getElementById(containerId);
    const selected = container.querySelector('input:checked')?.value || '10';
    const amount = parseFloat(document.getElementById(amountInputId).value);
    const rates = LoanMath.loanRates(currentGame.game_state);
    container.innerHTML = LoanMath.LOAN_TERMS.map(term => {
        const id = `${containerId}-${term}`;
        const quote = amount > 0 ? LoanMath.loanQuote(amount, rates[term], term) : null;
        const detail = quote
            ? `${formatMoney(quote.payment)} a turn, ${formatMoney(quote.total)} in total`
            : 'Enter an amount to see the payments';
        return `
            <div class="asset-checkbox">
                <input type="radio" name="${escapeHtml(containerId)}" id="${escapeHtml(id)}" value="${term}"${String(term) === selected ? ' checked' : ''}>
                <label for="${escapeHtml(id)}">${term} turns at ${rates[term]}% per turn<span class="debt-detail">${escapeHtml(detail)}</span></label>
            </div>
        `;
    }).join('');
}

function selectedLoanTerm(containerId) {
    return Number(document.querySelector(`#${containerId} input:checked`)?.value || 10);
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

// The borrowing limit the server worked out: all of a borrower's loans may reach
// 90% of the book value of their properties and shares (a corporation: its properties).
function selectedBorrower() {
    const issuer = document.getElementById('debtIssuer')?.value || 'player';
    if (!issuer.startsWith('corporation:')) return { account: currentPlayerData, corp: null };
    const corp = currentGame.game_state.corporations.find(item => item.id === issuer.split(':')[1]);
    return { account: corp, corp };
}

function borrowingLimitText(account, corp, replacedOwed = 0) {
    const borrowing = account?.borrowing;
    if (!borrowing) return '';
    const owed = Math.max(0, Number(borrowing.owed || 0) - replacedOwed);
    const available = Math.max(0, Number(borrowing.limit || 0) - owed);
    const whose = corp ? `${corp.ticker}'s properties` : 'your properties and shares';
    const owing = owed > 0 ? `, less ${formatMoney(owed)} already owed` : '';
    return `You can borrow up to ${formatMoney(available)}: 90% of the ${formatMoney(borrowing.bookValue)} book value of ${whose}${owing}.`;
}

function renderBorrowingLimit() {
    const { account, corp } = selectedBorrower();
    document.getElementById('loanLimit').textContent = borrowingLimitText(account, corp);
}

// Refinancing: pick a borrower (you, or a corporation you run), one or more of
// its loans, and the new loan amount. More than the selected balance pays out
// the difference; less pays the balance down from the borrower's cash.
function refinanceBorrowers() {
    const borrowers = [];
    if (getPersonalDebts().length) borrowers.push({ value: 'player', label: 'Personal', account: currentPlayerData, corp: null });
    getEligibleDebtCorporations()
        .filter(corp => !ShareDeals.isInsolvent(corp) && (corp.debts || []).length)
        .forEach(corp => borrowers.push({ value: `corporation:${corp.id}`, label: `${corp.ticker} (corporation)`, account: corp, corp }));
    return borrowers;
}

function selectedRefinanceBorrower() {
    const value = document.getElementById('refinanceBorrower')?.value;
    return refinanceBorrowers().find(borrower => borrower.value === value) || null;
}

function renderRefinanceBorrowerOptions() {
    const select = document.getElementById('refinanceBorrower');
    const previous = select.value;
    const borrowers = refinanceBorrowers();
    select.innerHTML = borrowers.map(borrower => `<option value="${escapeHtml(borrower.value)}">${escapeHtml(borrower.label)}</option>`).join('');
    if (borrowers.some(borrower => borrower.value === previous)) select.value = previous;
    document.getElementById('refinanceBorrowerGroup').style.display = borrowers.length > 1 ? '' : 'none';
    renderRefinanceDebtOptions();
}

function renderRefinanceDebtOptions() {
    const borrower = selectedRefinanceBorrower();
    const debts = borrower ? borrower.account.debts : [];
    const debtsHtml = debts.map((debt, index) => `
        <div class="asset-checkbox">
            <input type="checkbox" id="refinance-debt-${index}" value="${index}" data-debt-id="${escapeHtml(debt.id || '')}"${debts.length === 1 ? ' checked' : ''}>
            <label for="refinance-debt-${index}">
                ${debtOptionLabel(debt, index)}
            </label>
        </div>
    `).join('');

    document.getElementById('debtsToRefinance').innerHTML = debtsHtml || '<p class="empty-state">No loans to refinance. Loans you or your corporations take out appear here.</p>';
    document.getElementById('refinanceAmount').value = debts.length === 1 ? debtPrincipal(debts[0]).toFixed(2) : '';
    lastRefinancePayoff = getRefinancePayoffAmount();
    renderLoanTerms('refinanceTerms', 'refinanceAmount');
    updateRefinanceSummary();
}

// The amount starts at the selected balance (same loan, new term) until the
// player types their own.
let lastRefinancePayoff = 0;
function handleRefinanceSelectionChange() {
    const amountInput = document.getElementById('refinanceAmount');
    const typed = parseFloat(amountInput.value);
    const payoff = getRefinancePayoffAmount();
    if (!Number.isFinite(typed) || Math.abs(typed - lastRefinancePayoff) < 0.005) {
        amountInput.value = payoff > 0 ? payoff.toFixed(2) : '';
        renderLoanTerms('refinanceTerms', 'refinanceAmount');
    }
    lastRefinancePayoff = payoff;
    updateRefinanceSummary();
}

function getPersonalDebts() {
    return Array.isArray(currentPlayerData?.debts) ? currentPlayerData.debts : [];
}

function debtPrincipal(debt) {
    return Number(debt?.principal || 0);
}

function debtOptionLabel(debt, index) {
    const status = LoanMath.loanStatus(debt);
    return `Loan #${index + 1}: ${formatMoney(debtPrincipal(debt))}, ${escapeHtml(status.termLabel)}, ${escapeHtml(status.turnsLabel.toLowerCase())}`;
}

function getSelectedRefinanceDebtItems() {
    const debts = selectedRefinanceBorrower()?.account.debts || [];
    return Array.from(document.querySelectorAll('#debtsToRefinance input:checked'))
        .map(input => Number(input.value))
        .filter(index => Number.isInteger(index) && debts[index])
        .map(index => ({ index, debt: debts[index] }));
}

function getRefinancePayoffAmount() {
    return getSelectedRefinanceDebtItems()
        .reduce((sum, item) => sum + debtPrincipal(item.debt), 0);
}

// What the new amount does: cash out above the balance, or pay down from cash below it.
function updateRefinanceSummary() {
    const summary = document.getElementById('refinanceSummary');
    if (!summary) return;
    const borrower = selectedRefinanceBorrower();
    document.getElementById('refinanceLimit').textContent = borrower
        ? borrowingLimitText(borrower.account, borrower.corp, getRefinancePayoffAmount())
        : '';
    summary.classList.remove('debt-flow-warning');
    if (!borrower || !getSelectedRefinanceDebtItems().length) {
        summary.textContent = borrower ? 'Select the loans to replace.' : '';
        return;
    }
    const payoff = getRefinancePayoffAmount();
    const amount = parseFloat(document.getElementById('refinanceAmount').value);
    const whose = borrower.corp ? `${borrower.corp.ticker}'s` : 'your';
    const balance = `Selected balance ${formatMoney(payoff)}.`;
    if (!(amount > 0)) {
        summary.textContent = `${balance} Enter more to take out cash, or less to pay it down from ${whose} cash.`;
        return;
    }
    const difference = Math.round((amount - payoff) * 100) / 100;
    const cash = Number(borrower.account.cash || 0);
    if (difference > 0) {
        const available = Number(borrower.account.borrowing?.limit || 0)
            - Math.max(0, Number(borrower.account.borrowing?.owed || 0) - payoff);
        summary.textContent = `${balance} ${formatMoney(difference)} more is added to ${whose} cash.`;
        summary.classList.toggle('debt-flow-warning', borrower.account.borrowing && amount > available + 0.005);
    } else if (difference < 0) {
        const short = -difference > cash + 0.005;
        summary.textContent = `${balance} ${formatMoney(-difference)} is paid down from ${whose} cash${short ? `, which has only ${formatMoney(cash)}` : ''}.`;
        summary.classList.toggle('debt-flow-warning', short);
    } else {
        summary.textContent = `${balance} Same balance on a new term; no cash changes hands.`;
    }
}

function toggleDebtForm() {
    const action = document.getElementById('debtAction').value;
    document.getElementById('loansView').style.display = action === 'loans' ? 'block' : 'none';
    document.getElementById('issueDebtForm').style.display = action === 'issue' ? 'block' : 'none';
    document.getElementById('refinanceDebtForm').style.display = action === 'refinance' ? 'block' : 'none';
    const processButton = document.getElementById('process-debt-btn');
    processButton.style.display = action === 'loans' ? 'none' : '';
    processButton.textContent = action === 'refinance' ? 'Refinance' : 'Take loan';
    if (action === 'loans') renderLoanList();
    // Paying a loan off frees borrowing room; redraw it whenever the form opens.
    if (action === 'issue') renderBorrowingLimit();
    if (action === 'refinance') updateRefinanceSummary();
}

async function processDebt() {
    const action = document.getElementById('debtAction').value;

    if (action === 'issue') {
        await issueDebt();
    } else if (action === 'refinance') {
        await refinanceDebt();
    }
}

async function issueDebt() {
    const loanAmount = parseFloat(document.getElementById('loanAmount').value);
    const issuer = document.getElementById('debtIssuer').value || 'player';
    const issuerType = issuer.startsWith('corporation:') ? 'corporation' : 'player';
    const corpId = issuerType === 'corporation' ? issuer.split(':')[1] : null;

    if (!loanAmount) {
        alert('Please enter a loan amount');
        return;
    }

    await submitGameAction('issue_debt', {
        amount: loanAmount,
        termTurns: selectedLoanTerm('loanTerms'),
        autopay: document.getElementById('loanAutopay').checked,
        issuerType,
        corpId,
    }, {
        errorText: 'Failed to issue debt',
        onSaved: () => closeModal('debtModal'),
    });
}

async function refinanceDebt() {
    const borrower = selectedRefinanceBorrower();
    const selectedItems = getSelectedRefinanceDebtItems();
    const refinanceAmount = parseFloat(document.getElementById('refinanceAmount').value);

    if (!borrower || !selectedItems.length) {
        alert('Select at least one loan to refinance.');
        return;
    }

    if (!(refinanceAmount > 0)) {
        alert('Enter the new loan amount. To clear the loans instead, pay them off from Your loans.');
        return;
    }

    await submitGameAction('refinance_debt', {
        amount: refinanceAmount,
        termTurns: selectedLoanTerm('refinanceTerms'),
        debtIds: selectedItems.map(item => item.debt.id).filter(Boolean),
        corpId: borrower.corp ? borrower.corp.id : undefined,
    }, {
        errorText: 'Failed to refinance debt',
        onSaved: () => closeModal('debtModal'),
    });
}
