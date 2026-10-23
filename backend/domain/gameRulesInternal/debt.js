// Player and corporation debt: borrowing capacity, issue, pay, refinance,
// autopay, and the per-turn loan payments (terms and schedule maths live in
// loans.js).

const { v4: uuidv4 } = require('uuid');
const loans = require('./loans');
const { HOUSE_COSTS } = require('./board');
const { makeEvent, log, roundCents, positiveNumber, GameRuleError } = require('./util');
const {
    calculateCorporationAssetValue,
    calculateCorporationShareValue,
    recordCashFlow,
} = require('./ledger');
const { controlsCorporation, hasMajorityShares } = require('./corporations');

// Lenders keep a 10% equity cushion across the whole portfolio: a borrower's
// loans may total at most 90% of the book value of what they own. For a player
// that is their properties (price plus buildings) and their shares at book value
// (corporation NAV per share); for a corporation, its properties. No property is
// pledged to a particular loan. Loans made before a rule change stand.
const MAX_LOAN_TO_VALUE = 0.9;

function propertyBookValue(prop) {
    return Number(prop.price || 0) + Number(prop.houses || 0) * (HOUSE_COSTS[prop.color] || 0);
}

function portfolioBookValue(state, borrower) {
    // A corporation's properties are valued as in its NAV.
    if (!borrower.userId) return calculateCorporationAssetValue(state, borrower);
    const propertyValue = state.properties
        .filter(prop => prop.ownerId === borrower.userId)
        .reduce((sum, prop) => sum + propertyBookValue(prop), 0);
    const shareValue = state.corporations.reduce((sum, corp) => {
        const holding = (corp.shareholders || []).find(s => s.userId === borrower.userId);
        return sum + Number(holding?.shares || 0) * calculateCorporationShareValue(state, corp);
    }, 0);
    return propertyValue + shareValue;
}

// What the borrower can still borrow; loans being refinanced don't count as owed.
function borrowingCapacity(state, borrower, exceptDebts = new Set()) {
    const bookValue = roundCents(portfolioBookValue(state, borrower));
    const owed = roundCents((borrower.debts || [])
        .filter(debt => !exceptDebts.has(debt))
        .reduce((sum, debt) => sum + Number(debt.principal || 0), 0));
    const limit = roundCents(bookValue * MAX_LOAN_TO_VALUE);
    return { bookValue, owed, limit, available: Math.max(0, roundCents(limit - owed)) };
}

function requireBorrowingCapacity(state, borrower, amount, exceptDebts) {
    const capacity = borrowingCapacity(state, borrower, exceptDebts);
    if (amount > capacity.available) {
        const owes = capacity.owed > 0 ? `, less the $${capacity.owed.toFixed(2)} already owed` : '';
        throw new GameRuleError(400, `You can borrow up to $${capacity.available.toFixed(2)}: loans can total 90% of the $${capacity.bookValue.toFixed(2)} book value of ${borrower.userId ? 'your properties and shares' : 'the corporation\'s properties'}${owes}.`);
    }
}

// The borrower picks the term; the rate for that term was set by the host when
// the game started. Without a term (older clients, agents) a loan runs 10 turns.
function loanTerms(state, payload) {
    const termTurns = payload.termTurns === undefined || payload.termTurns === null || payload.termTurns === ''
        ? loans.LEGACY_LOAN_TERM
        : Number(payload.termTurns);
    if (!loans.LOAN_TERMS.includes(termTurns)) {
        throw new GameRuleError(400, `Choose a loan term of ${loans.LOAN_TERMS.join(', ').replace(/, (\d+)$/, ' or $1')} turns.`);
    }
    return {
        termTurns,
        turnsRemaining: termTurns,
        interestRate: Number(state.settings.loanRates[termTurns]),
        autopay: payload.autopay !== false,
    };
}

function describeLoan(amount, terms) {
    return `$${amount.toFixed(2)} over ${terms.termTurns} turns at ${terms.interestRate}%${terms.autopay ? '' : ', autopay off'}`;
}

function issueDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const terms = loanTerms(state, payload);
    const { interestRate, termTurns } = terms;
    const issuerType = payload.issuerType === 'corporation' ? 'corporation' : 'player';
    if (issuerType === 'corporation') {
        const corp = state.corporations.find(c => c.id === payload.corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (corp.insolvent) throw new GameRuleError(400, 'Corporation is insolvent');
        if (!controlsCorporation(corp, player.userId)) {
            throw new GameRuleError(403, 'Only the chairman or controlling shareholder can issue corporation debt');
        }
        requireBorrowingCapacity(state, corp, amount);
        corp.debts.push({ id: `debt-${uuidv4()}`, principal: amount, ...terms, issueDate: new Date().toISOString(), issuerType: 'corporation' });
        corp.cash = Number(corp.cash || 0) + amount;
        recordCashFlow(state, null, corp.id, amount);
        events.push(makeEvent(player, 'debt_issued', { issuer: `[${corp.ticker}]`, actor: player.name, amount, interestRate, termTurns }));
        log(state, `${player.name} borrowed for ${corp.ticker}: ${describeLoan(amount, terms)}.`);
        return;
    }
    requireBorrowingCapacity(state, player, amount);
    player.debts.push({ id: `debt-${uuidv4()}`, principal: amount, ...terms, issueDate: new Date().toISOString(), issuerType: 'player' });
    player.cash += amount;
    recordCashFlow(state, null, player.userId, amount);
    events.push(makeEvent(player, 'debt_issued', { issuer: player.name, amount, interestRate, termTurns }));
    log(state, `${player.name} borrowed ${describeLoan(amount, terms)}.`);
}

function refinanceDebt(state, player, payload, events) {
    const amount = positiveNumber(payload.amount, 'amount');
    const terms = loanTerms(state, payload);
    const { interestRate, termTurns } = terms;

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

    // The loans being replaced don't count against the limit for the new one.
    requireBorrowingCapacity(state, player, amount, new Set(selectedDebts));

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
        ...terms,
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
        termTurns,
        refinancedDebtCount: selectedDebts.length,
    }));
    log(state, `${player.name} refinanced ${selectedDebts.length} debt(s) into ${describeLoan(amount, terms)} and received $${netProceeds.toFixed(2)} net cash`);
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

// A loan and the account that owes it: the player's own, or a corporation's
// that the player runs (payload.corpId).
function findBorrowerLoan(state, player, payload) {
    if (payload.corpId) {
        const corp = state.corporations.find(c => c.id === payload.corpId);
        if (!corp) throw new GameRuleError(404, 'Corporation not found');
        if (!controlsCorporation(corp, player.userId)) {
            throw new GameRuleError(403, 'Only the chairman or controlling shareholder can manage corporation debt');
        }
        const debt = corp.debts.find(d => d.id === payload.debtId);
        if (!debt) throw new GameRuleError(404, 'Debt not found');
        return { debt, account: corp, cashFlowId: corp.id, name: corp.ticker, eventName: `[${corp.ticker}]` };
    }
    const debt = player.debts.find(d => d.id === payload.debtId) || player.debts[Number(payload.debtIndex)];
    if (!debt) throw new GameRuleError(404, 'Debt not found');
    return { debt, account: player, cashFlowId: player.userId, name: player.name, eventName: player.name };
}

function payDebt(state, player, payload, events) {
    let amount = positiveNumber(payload.amount, 'amount');
    const { debt, account, cashFlowId, name, eventName } = findBorrowerLoan(state, player, payload);
    // Paying more than is owed only settles the debt; the rest stays in cash.
    amount = Math.min(amount, roundCents(debt.principal));
    if (Number(account.cash || 0) < amount) throw new GameRuleError(400, 'Insufficient funds');
    account.cash = roundCents(Number(account.cash || 0) - amount);
    debt.principal = roundCents(debt.principal - amount);
    recordCashFlow(state, cashFlowId, null, amount);
    const paidOff = debt.principal < 0.005;
    if (paidOff) account.debts = account.debts.filter(d => d !== debt);
    events.push(makeEvent(player, 'debt_payment', { payer: eventName, amount, paidOff }));
    log(state, paidOff
        ? `${name} paid off a loan ($${amount.toFixed(2)}).`
        : `${name} paid $${amount.toFixed(2)} towards a loan.`);
}

function setDebtAutopay(state, player, payload, events) {
    const { debt, name, eventName } = findBorrowerLoan(state, player, payload);
    if (typeof payload.autopay !== 'boolean') throw new GameRuleError(400, 'Choose autopay on or off');
    if (debt.autopay === payload.autopay) return;
    debt.autopay = payload.autopay;
    events.push(makeEvent(player, 'debt_autopay', { borrower: eventName, autopay: debt.autopay }));
    log(state, `${name} turned autopay ${debt.autopay ? 'on' : 'off'} for a loan.`);
}

// A corporation's loans count down on its chairman's turns (or, with the chair
// vacant, its majority holder's), once per round.
function loanServicerId(corp) {
    if (corp.chairmanId) return corp.chairmanId;
    const majority = (corp.shareholders || []).find(holder => hasMajorityShares(corp, holder.userId));
    return majority ? majority.userId : null;
}

// End-of-turn loan servicing for one borrower (a player or a corporation): see
// loans.js. A loan that matures takes its whole balance from cash; when the cash
// isn't there the account goes negative and the caller's bankruptcy or
// insolvency check takes over. Returns the interest charged.
// Events name a corporation as [TICKER], like debt_issued does.
function serviceLoans(state, actor, account, cashFlowId, name, events, eventName = name) {
    let interestCharged = 0;
    let paid = 0;
    let unpaidInterest = 0;
    (account.debts || []).forEach(debt => {
        const result = loans.serviceLoan(debt, account.cash);
        interestCharged += result.interest;
        unpaidInterest += result.unpaidInterest;
        if (result.matured) {
            const repaid = Number(account.cash || 0) >= result.paid;
            events.push(makeEvent(actor, 'loan_matured', { borrower: eventName, amount: result.paid, repaid }));
            log(state, repaid
                ? `${name} repaid a loan in full at maturity ($${result.paid.toFixed(2)}).`
                : `${name} couldn't repay a $${result.paid.toFixed(2)} loan that came due.`);
        }
        account.cash = roundCents(Number(account.cash || 0) - result.paid);
        paid += result.paid;
    });
    account.debts = (account.debts || []).filter(debt => debt.turnsRemaining > 0 && debt.principal >= 0.005);
    interestCharged = roundCents(interestCharged);
    paid = roundCents(paid);
    unpaidInterest = roundCents(unpaidInterest);
    if (paid > 0) recordCashFlow(state, cashFlowId, null, paid);
    if (interestCharged > 0 || paid > 0) {
        events.push(makeEvent(actor, 'interest_accrual', { player: eventName, interestCharged, paid, unpaidInterest }));
        const parts = [];
        parts.push(paid > 0
            ? `${name} paid $${paid.toFixed(2)} on loans (interest this turn: $${interestCharged.toFixed(2)})`
            : `${name} paid nothing on loans this turn`);
        if (unpaidInterest > 0) parts.push(`$${unpaidInterest.toFixed(2)} of unpaid interest was added to the balance`);
        log(state, `${parts.join('; ')}.`);
    }
    return interestCharged;
}

module.exports = {
    propertyBookValue,
    borrowingCapacity,
    issueDebt,
    refinanceDebt,
    payDebt,
    setDebtAutopay,
    loanServicerId,
    serviceLoans,
};
