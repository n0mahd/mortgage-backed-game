// The Debt sheet's End Turn previews: what each borrower's next End Turn does to
// its cash ("When you end this turn"), what it would do after a new loan or a
// refinance, and the borrowing limit as a sum. The End Turn sums come from
// TurnEndOutlook, which mirrors the server's endTurn, so the sheet and the turn
// screen's warnings agree. Part of the game page; reads game.js's state and
// debt.js's helpers.

// Every borrower whose loans you manage: you, then the corporations you run.
// The key matches the Borrow as and Loans of selects.
function debtBorrowers() {
    const corporations = getEligibleDebtCorporations()
        .filter(corp => !ShareDeals.isInsolvent(corp))
        .map(corp => ({ key: `corporation:${corp.id}`, name: corp.ticker, account: corp, corp }));
    return [{ key: 'player', name: 'You', account: currentPlayerData, corp: null }, ...corporations];
}

function sumPrincipal(debts) {
    return (debts || []).reduce((sum, debt) => sum + debtPrincipal(debt), 0);
}

// A loan as it would stand right after being taken: End Turn charges its first
// turn and takes what its autopay mode pays.
function proposedLoan(amount, termTurns, autopay) {
    const interestRate = LoanMath.loanRate(currentGame.game_state);
    return {
        principal: amount,
        interestRate,
        termTurns,
        turnsRemaining: termTurns,
        autopay,
        nextPayment: LoanMath.autopayPayment(amount, interestRate, termTurns, autopay),
        installment: LoanMath.scheduledPayment(amount, interestRate, termTurns),
        interestDue: LoanMath.interestDue(amount, interestRate),
    };
}

// What the borrower's next End Turn does, optionally with its cash and loans
// changed first. failing: the player goes bankrupt or the corporation insolvent.
function borrowerOutlook(borrower, changes = {}) {
    const account = { ...borrower.account, ...changes };
    if (borrower.corp) {
        const outlook = TurnEndOutlook.forCompany(account);
        return { ...outlook, failing: outlook.goesInsolvent, owed: sumPrincipal(account.debts), claim: null };
    }
    const outlook = TurnEndOutlook.forPlayer(currentGame.game_state, account);
    return { ...outlook, failing: outlook.goesBankrupt, owed: sumPrincipal(account.debts) };
}

function signedMoney(value) {
    return `${value < 0 ? '−' : ''}${formatMoney(Math.abs(value))}`;
}

function outlookRow(label, value, className = '') {
    return `<div class="outlook-row${className ? ` ${className}` : ''}"><dt>${escapeHtml(label)}</dt> <dd>${escapeHtml(value)}</dd></div>`;
}

// "When you end this turn": one card per borrower with loans (you also with an unpaid claim).
function renderEndTurnOutlook() {
    const container = document.getElementById('loanOutlook');
    if (!container) return;
    const isMyTurn = isCurrentUsersTurn();
    const cards = debtBorrowers()
        .filter(borrower => (borrower.account?.debts || []).length || (!borrower.corp && borrowerOutlook(borrower).claim))
        .map(borrower => renderOutlookCard(borrower, isMyTurn));
    container.hidden = !cards.length;
    container.innerHTML = cards.length
        ? `<h3 class="outlook-title">${isMyTurn ? 'When you end this turn' : 'When you end your next turn'}</h3>${cards.join('')}`
        : '';
}

function renderOutlookCard(borrower, isMyTurn) {
    const outlook = borrowerOutlook(borrower);
    const { corp } = borrower;
    const serviced = !corp || TurnEndOutlook.servicesLoansOf(corp, currentUser.id);
    let badge;
    if (outlook.failing) badge = `<span class="badge badge-danger">Short ${formatMoney(outlook.shortfall)}</span>`;
    else if (outlook.maturing > 0 || outlook.loanPayments > 0 || outlook.claim) badge = '<span class="badge">Covered</span>';
    else badge = '<span class="badge badge-info">Nothing taken</span>';

    const rows = [outlookRow('Cash', formatMoney(outlook.cash))];
    if (outlook.claim) rows.push(outlookRow(`Owed to ${outlook.claim.creditorName || 'a creditor'}`, signedMoney(-outlook.unpaid)));
    if (outlook.maturing > 0) rows.push(outlookRow('Loans due in full', signedMoney(-outlook.maturing)));
    const installments = outlook.loanPayments - outlook.maturing;
    if (installments > 0.004) rows.push(outlookRow('Autopay payments', signedMoney(-installments)));
    if (outlook.interestAdded > 0.004) rows.push(outlookRow('Unpaid interest added to loans', `+${formatMoney(outlook.interestAdded)}`, 'is-note'));
    rows.push(outlookRow('Cash after End Turn', signedMoney(outlook.cashAfter), 'is-total'));

    let advice = '';
    let actions = '';
    if (outlook.failing) {
        const consequence = corp ? `${corp.ticker} becomes insolvent and is closed` : 'you go bankrupt';
        advice = `<p class="outlook-advice">Without ${formatMoney(outlook.shortfall)} more, ${consequence}. Refinance the loan that's due, or borrow at least ${formatMoney(outlook.shortfall)}.</p>`;
        if (isMyTurn) {
            const key = escapeHtml(borrower.key);
            actions = `<div class="outlook-actions">
                ${outlook.maturing > 0 ? `<button type="button" class="btn btn-primary btn-sm" data-outlook-refinance="${key}">Refinance due loan</button>` : ''}
                <button type="button" class="btn btn-secondary btn-sm" data-outlook-borrow="${key}">Borrow ${formatMoney(outlook.shortfall)}</button>
            </div>`;
        }
    }
    const servicedNote = serviced ? '' : '<p class="debt-detail">Its loans are paid when its chairman ends their turn.</p>';
    return `
        <section class="outlook-card${outlook.failing ? ' is-short' : ''}" data-outlook-borrower="${escapeHtml(borrower.key)}">
            <div class="outlook-head"><span class="outlook-name">${escapeHtml(borrower.name)}</span>${badge}</div>
            ${servicedNote}
            <dl class="outlook-rows">${rows.join('')}</dl>
            ${advice}${actions}
        </section>
    `;
}

function handleOutlookClick(event) {
    const refinance = event.target.closest('[data-outlook-refinance]');
    if (refinance) {
        const borrower = debtBorrowers().find(item => item.key === refinance.dataset.outlookRefinance);
        const due = (borrower?.account.debts || []).filter(debt => Number(debt.turnsRemaining || 0) <= 1);
        openRefinanceFor(refinance.dataset.outlookRefinance, due.map(debt => debt.id));
        return;
    }
    const borrow = event.target.closest('[data-outlook-borrow]');
    if (borrow) {
        const borrower = debtBorrowers().find(item => item.key === borrow.dataset.outlookBorrow);
        if (borrower) openNewLoanFor(borrower.key, borrowerOutlook(borrower).shortfall);
    }
}

// Before and after a new loan or a refinance: cash now, what End Turn takes,
// what is owed, and the cash left after End Turn.
// problem: why the server would refuse it (say, over the borrowing limit).
function renderDebtPreview(containerId, borrower, changes, problem = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!borrower || !changes) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }
    const before = borrowerOutlook(borrower);
    const after = borrowerOutlook(borrower, changes);
    const whose = borrower.corp ? borrower.corp.ticker : 'Your';
    const change = (from, to) => `${signedMoney(from)} → ${signedMoney(to)}`;
    const rows = [
        outlookRow(`${whose} cash`, change(before.cash, after.cash)),
        outlookRow('Taken at End Turn', change(before.loanPayments, after.loanPayments)),
        outlookRow('Total owed', change(before.owed, after.owed)),
        outlookRow('Cash after End Turn', `${signedMoney(after.cashAfter)} ${after.failing ? '✗' : '✓'}`, 'is-total'),
    ];
    const consequence = borrower.corp ? `${borrower.corp.ticker} would become insolvent` : 'you would go bankrupt';
    let verdict = after.failing
        ? `<p class="outlook-advice">Still ${formatMoney(after.shortfall)} short: ${consequence} at End Turn.</p>`
        : '';
    if (problem) verdict = `<p class="outlook-advice">${escapeHtml(problem)}</p>${verdict}`;
    container.hidden = false;
    container.classList.toggle('is-short', after.failing || Boolean(problem));
    container.innerHTML = `<dl class="outlook-rows">${rows.join('')}</dl>${verdict}`;
}

// What the borrower may still borrow; loans being refinanced (replacedOwed) don't count as owed.
function borrowingAvailable(account, replacedOwed = 0) {
    const borrowing = account?.borrowing;
    if (!borrowing) return Infinity;
    const owed = Math.max(0, Number(borrowing.owed || 0) - replacedOwed);
    return Math.max(0, Number(borrowing.limit || 0) - owed);
}

function overLimitProblem(account, amount, replacedOwed = 0) {
    const available = borrowingAvailable(account, replacedOwed);
    return amount > available + 0.005 ? `That's over the ${formatMoney(available)} you can borrow, so it would be refused.` : '';
}

// The borrowing limit as a sum: 90% of book value, less what is owed.
// replacedOwed: loans being refinanced, which don't count as owed.
function borrowingLimitHtml(account, corp, replacedOwed = 0) {
    const borrowing = account?.borrowing;
    if (!borrowing) return '';
    const owed = Math.max(0, Number(borrowing.owed || 0) - replacedOwed);
    const available = borrowingAvailable(account, replacedOwed);
    const whose = corp ? `${corp.ticker}'s properties` : 'your properties and shares';
    const rows = [outlookRow(`90% of the ${formatMoney(borrowing.bookValue)} book value of ${whose}`, formatMoney(borrowing.limit))];
    if (owed > 0) rows.push(outlookRow(replacedOwed > 0 ? 'Other loans owed' : 'Already owed', signedMoney(-owed)));
    rows.push(outlookRow('You can borrow up to', formatMoney(available), 'is-total'));
    return `<dl class="outlook-rows">${rows.join('')}</dl>`;
}
