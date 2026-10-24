// The Debt sheet: your loans and your corporations' (balances, autopay,
// payments), new loans and refinancing. Loan terms, quotes and status wording
// come from loans.js (LoanMath), which mirrors the server's loan rules; the End
// Turn previews and the limit sum are in debt-outlook.js.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// Debt page: your loans (balances, autopay, payments), new loans and refinancing.
function openDebtModal() {
    const isMyTurn = isCurrentUsersTurn();
    const select = document.getElementById('debtAction');
    select.querySelectorAll('option[value="issue"], option[value="refinance"]').forEach(option => {
        option.disabled = !isMyTurn;
    });
    select.value = isMyTurn && !getManagedLoans().length ? 'issue' : 'loans';
    document.getElementById('loanRatesHint').textContent =
        `Loans this game cost ${LoanMath.loanRate(currentGame.game_state)}% interest per turn, for 1 to ${LoanMath.MAX_LOAN_TERM} turns. Paying the loan down every turn clears it by the last turn; with interest only, the whole balance is due then.`;
    document.getElementById('debtIssuer').innerHTML = debtIssuerOptionsHtml();
    document.getElementById('loanAmount').value = '';
    ['loan', 'refinance'].forEach(prefix => {
        fillLoanTermOptions(`${prefix}Term`);
        document.getElementById(`${prefix}Term`).value = String(LoanMath.DEFAULT_LOAN_TERM);
        document.getElementById(`${prefix}Autopay`).value = 'pay_down';
    });
    renderLoanList();
    renderBorrowingLimit();
    renderLoanTerms('loan');
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
    renderEndTurnOutlook();
    const loans = getManagedLoans();
    if (!loans.length) {
        container.innerHTML = '<p class="empty-state">No loans. Choose "Take a new loan" to borrow against a property.</p>';
        return;
    }
    const isMyTurn = isCurrentUsersTurn();
    container.innerHTML = loans.map(({ debt, corp }) => renderLoanRow(debt, corp, isMyTurn)).join('');
}

function renderLoanRow(debt, corp, isMyTurn) {
    const status = LoanMath.loanStatus(debt, { dueThisTurn: loanDueOnMyTurn(corp, isMyTurn) });
    const cash = corp ? Number(corp.cash || 0) : Number(currentPlayerData?.cash || 0);
    const borrower = corp ? `${corp.ticker} (corporation)` : 'Personal';
    const autopayId = `loan-autopay-${debt.id}`;
    const whoseTurn = corp ? 'the chairman\'s' : 'your';
    const amountId = `loan-pay-${debt.id}`;
    const ids = `data-debt-id="${escapeHtml(debt.id)}" data-corp-id="${escapeHtml(corp ? corp.id : '')}"`;
    let schedule;
    if (status.dueInFull) {
        const when = status.dueThisTurn ? 'when you end this turn' : `at the end of ${corp ? 'the chairman\'s' : 'your'} next turn`;
        schedule = `${formatMoney(status.nextPayment)} is due in full ${when}. If there isn't the cash, ${corp ? `${corp.ticker} becomes insolvent` : 'you go bankrupt'}.`;
    } else if (status.autopay === 'pay_down') {
        schedule = `Autopay takes ${formatMoney(status.nextPayment)} at the end of ${whoseTurn} turn, paying the loan off in ${status.turnsLeft} turns.`;
    } else if (status.autopay === 'interest_only') {
        schedule = `Autopay takes the ${formatMoney(status.nextPayment)} interest at the end of ${whoseTurn} turn. The balance stays the same and is all due when the term ends.`;
    } else {
        schedule = `Autopay is off: ${formatMoney(status.interestNext)} interest is added to the balance at the end of ${whoseTurn} turn.`;
    }
    const autopayOptions = LoanMath.AUTOPAY_MODES.map(mode => {
        const amount = mode.value === 'pay_down' ? status.installment : mode.value === 'interest_only' ? status.interestNext : 0;
        const text = mode.value === 'off' ? mode.label : `${mode.label} · ${formatMoney(amount)}`;
        return `<option value="${mode.value}"${status.autopay === mode.value ? ' selected' : ''}>${escapeHtml(text)}</option>`;
    }).join('');
    const payDisabled = isMyTurn ? '' : ' disabled';
    return `
        <article class="loan-row${status.dueInFull ? ' is-due' : ''}" ${ids}>
            <div class="loan-row-head">
                <span class="loan-balance">${formatMoney(status.balance)}</span>
                <span class="badge ${status.dueInFull ? 'badge-danger' : 'badge-info'}">${escapeHtml(status.turnsLabel)}</span>
            </div>
            <p class="debt-detail">${escapeHtml(borrower)} · ${escapeHtml(status.termLabel)}</p>
            <p class="loan-schedule">${escapeHtml(schedule)}</p>
            <div class="loan-autopay">
                <label class="field-label" for="${escapeHtml(autopayId)}">Autopay each turn</label>
                <select id="${escapeHtml(autopayId)}" data-loan-autopay ${ids}${status.dueInFull ? ' disabled' : ''}>${autopayOptions}</select>
            </div>
            <div class="loan-pay">
                <label class="field-label" for="${escapeHtml(amountId)}">Pay an amount</label>
                <div class="inline-action-row">
                    <input type="number" inputmode="decimal" min="0" step="0.01" id="${escapeHtml(amountId)}" placeholder="Up to ${escapeHtml(formatMoney(Math.min(cash, status.balance)))}"${payDisabled}>
                    <button type="button" class="btn btn-secondary btn-sm" data-loan-pay ${ids}${payDisabled}>Pay</button>
                </div>
                <div class="loan-row-actions">
                    <button type="button" class="btn btn-success btn-sm" data-loan-payoff ${ids}${payDisabled || (cash < status.balance ? ' disabled' : '')}>Pay off ${formatMoney(status.balance)}</button>
                    <button type="button" class="btn ${status.dueInFull ? 'btn-primary' : 'btn-secondary'} btn-sm" data-loan-refinance ${ids}${payDisabled}>Refinance</button>
                </div>
                ${isMyTurn ? (cash < status.balance ? `<p class="debt-detail">Paying off needs ${formatMoney(status.balance)}; ${corp ? `${corp.ticker} has` : 'you have'} ${formatMoney(cash)}.</p>` : '') : '<p class="debt-detail">You can make extra payments on your turn. Autopay can be changed any time.</p>'}
            </div>
        </article>
    `;
}

// A corporation's loans count down on the turn of whoever services them (its chairman).
function loanDueOnMyTurn(corp, isMyTurn = isCurrentUsersTurn()) {
    return isMyTurn && (!corp || TurnEndOutlook.servicesLoansOf(corp, currentUser.id));
}

function findManagedLoan(element) {
    const debtId = element.dataset.debtId;
    const corpId = element.dataset.corpId || null;
    return getManagedLoans().find(item => item.debt.id === debtId && (item.corp ? item.corp.id : null) === corpId) || null;
}

async function handleLoanListClick(event) {
    const button = event.target.closest('[data-loan-pay], [data-loan-payoff], [data-loan-refinance]');
    if (!button) return;
    const loan = findManagedLoan(button);
    if (!loan) return;
    if (button.hasAttribute('data-loan-refinance')) {
        openRefinanceFor(loan.corp ? `corporation:${loan.corp.id}` : 'player', [loan.debt.id]);
        return;
    }
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
    await submitGameAction('set_debt_autopay', { debtId: loan.debt.id, corpId: loan.corp ? loan.corp.id : undefined, autopay: input.value }, {
        errorText: 'Failed to change autopay',
    });
    // Redraw either way, so a refused change puts the choice back.
    renderLoanList();
}

// The term dropdown: 1 to 30 turns.
function fillLoanTermOptions(selectId) {
    const select = document.getElementById(selectId);
    if (select.options.length) return;
    const terms = Array.from({ length: LoanMath.MAX_LOAN_TERM - LoanMath.MIN_LOAN_TERM + 1 }, (_, i) => LoanMath.MIN_LOAN_TERM + i);
    select.innerHTML = terms.map(term => `<option value="${term}">${term} turn${term === 1 ? '' : 's'}</option>`).join('');
}

// What the loan typed costs at the term and autopay chosen. prefix: 'loan' or 'refinance'.
function renderLoanTerms(prefix) {
    const amount = parseFloat(document.getElementById(`${prefix}Amount`).value);
    const turns = selectedLoanTerm(`${prefix}Term`);
    const autopay = document.getElementById(`${prefix}Autopay`).value;
    const rate = LoanMath.loanRate(currentGame.game_state);
    const quote = document.getElementById(`${prefix}TermQuote`);
    if (!(amount > 0)) {
        quote.textContent = 'Enter an amount to see the payments.';
        return;
    }
    const q = LoanMath.loanQuote(amount, rate, turns);
    if (turns === 1) {
        quote.textContent = `${formatMoney(q.finalPayment)} is due in full at the end of the turn.`;
    } else if (autopay === 'pay_down') {
        quote.textContent = `${formatMoney(q.payment)} a turn for ${turns} turns, ${formatMoney(q.total)} in total. Nothing is owed after the last payment.`;
    } else if (autopay === 'interest_only') {
        quote.textContent = `${formatMoney(q.interest)} interest a turn, then ${formatMoney(q.finalPayment)} on the last turn: ${formatMoney(q.interestOnlyTotal)} in total.`;
    } else {
        const owed = Math.round(amount * Math.pow(1 + rate / 100, turns) * 100) / 100;
        quote.textContent = `Nothing is taken until the last turn, when ${formatMoney(owed)} is due with the interest added (less anything you pay before then).`;
    }
}

function selectedLoanTerm(selectId) {
    return Number(document.getElementById(selectId)?.value || LoanMath.DEFAULT_LOAN_TERM);
}

function debtIssuerOptionsHtml() {
    return debtBorrowers().map(borrower =>
        `<option value="${escapeHtml(borrower.key)}">${escapeHtml(borrower.corp ? `${borrower.corp.ticker} Corporation` : 'Personal')}</option>`
    ).join('');
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
    return debtBorrowers().find(borrower => borrower.key === issuer) || debtBorrowers()[0];
}

// The limit, and what the loan typed would leave at End Turn.
function renderBorrowingLimit() {
    const borrower = selectedBorrower();
    document.getElementById('loanLimit').innerHTML = borrowingLimitHtml(borrower.account, borrower.corp);
    const shortfall = borrowerOutlook(borrower).shortfall;
    const hint = document.getElementById('loanShortfallHint');
    hint.hidden = !(shortfall > 0);
    hint.textContent = shortfall > 0
        ? `As things stand, ${borrower.corp ? `${borrower.corp.ticker} is` : 'you are'} ${formatMoney(shortfall)} short at End Turn: borrow at least that much${(borrower.account.debts || []).some(debt => Number(debt.turnsRemaining || 0) <= 1) ? ', or refinance the loan that\'s due instead' : ''}.`
        : '';
    const amount = parseFloat(document.getElementById('loanAmount').value);
    renderDebtPreview('loanPreview', borrower, amount > 0 ? {
        cash: Number(borrower.account.cash || 0) + amount,
        debts: [...(borrower.account.debts || []), proposedLoan(amount, selectedLoanTerm('loanTerm'), document.getElementById('loanAutopay').value)],
    } : null, amount > 0 ? overLimitProblem(borrower.account, amount) : '');
}

// Opens Take a new loan for a borrower, with an amount filled in.
function openNewLoanFor(key, amount) {
    document.getElementById('debtAction').value = 'issue';
    document.getElementById('debtIssuer').value = key;
    document.getElementById('loanAmount').value = amount > 0 ? (Math.ceil(amount * 100) / 100).toFixed(2) : '';
    renderLoanTerms('loan');
    toggleDebtForm();
    document.querySelector('#debtModal .modal-content').scrollTop = 0;
}

// Refinancing: pick a borrower (you, or a corporation you run), one or more of
// its loans, and the new loan amount. More than the selected balance pays out
// the difference; less pays the balance down from the borrower's cash.
function refinanceBorrowers() {
    return debtBorrowers().filter(borrower => (borrower.account?.debts || []).length);
}

function selectedRefinanceBorrower() {
    const value = document.getElementById('refinanceBorrower')?.value;
    return refinanceBorrowers().find(borrower => borrower.key === value) || null;
}

// Opens Refinance loans for a borrower with these loans ticked.
function openRefinanceFor(key, debtIds) {
    document.getElementById('debtAction').value = 'refinance';
    toggleDebtForm();
    document.getElementById('refinanceBorrower').value = key;
    document.getElementById('refinanceBorrowerGroup').style.display = refinanceBorrowers().length > 1 ? '' : 'none';
    renderRefinanceDebtOptions();
    document.querySelectorAll('#debtsToRefinance input[type="checkbox"]').forEach(input => {
        input.checked = debtIds.includes(input.dataset.debtId);
    });
    handleRefinanceSelectionChange();
    document.querySelector('#debtModal .modal-content').scrollTop = 0;
}

function renderRefinanceBorrowerOptions() {
    const select = document.getElementById('refinanceBorrower');
    const previous = select.value;
    const borrowers = refinanceBorrowers();
    select.innerHTML = borrowers.map(borrower => `<option value="${escapeHtml(borrower.key)}">${escapeHtml(borrower.corp ? `${borrower.corp.ticker} (corporation)` : 'Personal')}</option>`).join('');
    if (borrowers.some(borrower => borrower.key === previous)) select.value = previous;
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
                ${debtOptionLabel(debt, index, borrower.corp)}
            </label>
        </div>
    `).join('');

    document.getElementById('debtsToRefinance').innerHTML = debtsHtml || '<p class="empty-state">No loans to refinance. Loans you or your corporations take out appear here.</p>';
    document.getElementById('refinanceAmount').value = debts.length === 1 ? debtPrincipal(debts[0]).toFixed(2) : '';
    lastRefinancePayoff = getRefinancePayoffAmount();
    renderLoanTerms('refinance');
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
        renderLoanTerms('refinance');
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

function debtOptionLabel(debt, index, corp) {
    const status = LoanMath.loanStatus(debt, { dueThisTurn: loanDueOnMyTurn(corp) });
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
    const selected = getSelectedRefinanceDebtItems();
    document.getElementById('refinanceLimit').innerHTML = borrower
        ? borrowingLimitHtml(borrower.account, borrower.corp, getRefinancePayoffAmount())
        : '';
    summary.classList.remove('debt-flow-warning');
    renderRefinancePreview(borrower, selected);
    if (!borrower || !selected.length) {
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

// What the account would look like after the refinance, at the amount, term and autopay chosen.
function renderRefinancePreview(borrower, selected) {
    const amount = parseFloat(document.getElementById('refinanceAmount').value);
    if (!borrower || !selected.length || !(amount > 0)) {
        renderDebtPreview('refinancePreview', null, null);
        return;
    }
    const replaced = new Set(selected.map(item => item.debt));
    const payoff = sumPrincipal(selected.map(item => item.debt));
    const cash = Number(borrower.account.cash || 0);
    let problem = '';
    if (amount > payoff) problem = overLimitProblem(borrower.account, amount, payoff);
    else if (payoff - amount > cash + 0.005) problem = `Paying down ${formatMoney(payoff - amount)} needs more than the ${formatMoney(cash)} cash there is, so it would be refused.`;
    renderDebtPreview('refinancePreview', borrower, {
        cash: Number(borrower.account.cash || 0) + amount - payoff,
        debts: [
            ...(borrower.account.debts || []).filter(debt => !replaced.has(debt)),
            proposedLoan(amount, selectedLoanTerm('refinanceTerm'), document.getElementById('refinanceAutopay').value),
        ],
    }, problem);
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
    if (action === 'refinance') renderRefinanceBorrowerOptions();
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
        termTurns: selectedLoanTerm('loanTerm'),
        autopay: document.getElementById('loanAutopay').value,
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
        termTurns: selectedLoanTerm('refinanceTerm'),
        debtIds: selectedItems.map(item => item.debt.id).filter(Boolean),
        autopay: document.getElementById('refinanceAutopay').value,
        corpId: borrower.corp ? borrower.corp.id : undefined,
    }, {
        errorText: 'Failed to refinance debt',
        onSaved: () => closeModal('debtModal'),
    });
}
