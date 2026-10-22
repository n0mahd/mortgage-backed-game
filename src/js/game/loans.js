// Loan display helpers for the Debt page, player cards and corporation cards.
//
// Mirrors backend/domain/gameRulesInternal/loans.js: terms, the host's rate per
// term, and the installment that pays a loan off on schedule. The server is
// authoritative and sends each loan's nextPayment; this file only quotes new
// loans and words the status of existing ones. Classic browser script, no build.
(function (global) {
    'use strict';

    const LOAN_TERMS = [5, 10, 15];
    const DEFAULT_LOAN_RATES = { 5: 4, 10: 5, 15: 6 };

    function loanRates(gameState) {
        const rates = gameState?.settings?.loanRates || {};
        return Object.fromEntries(LOAN_TERMS.map(term => [term, Number(rates[term] ?? DEFAULT_LOAN_RATES[term])]));
    }

    function roundCents(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    function scheduledPayment(balance, ratePercent, turns) {
        const rate = Number(ratePercent || 0) / 100;
        if (!(balance > 0)) return 0;
        if (turns <= 1) return roundCents(balance * (1 + rate));
        if (rate === 0) return roundCents(balance / turns);
        return roundCents(balance * rate / (1 - Math.pow(1 + rate, -turns)));
    }

    // What a new loan costs with autopay on: the payment each turn and the total repaid.
    function loanQuote(amount, ratePercent, turns) {
        const payment = scheduledPayment(amount, ratePercent, turns);
        return { payment, total: roundCents(payment * turns) };
    }

    // dueThisTurn: the borrower (or the corporation's chairman) is on turn now, so
    // a loan on its last turn is due when they end this turn.
    function loanStatus(debt, { dueThisTurn = false } = {}) {
        const turnsLeft = Math.max(1, Number(debt.turnsRemaining || 1));
        const balance = Number(debt.principal || 0);
        const nextPayment = Number(debt.nextPayment || 0);
        return {
            balance,
            turnsLeft,
            dueInFull: turnsLeft === 1,
            nextPayment,
            interestNext: roundCents(balance * Number(debt.interestRate || 0) / 100),
            autopay: debt.autopay !== false,
            termLabel: `${Number(debt.termTurns || 10)}-turn loan at ${Number(debt.interestRate || 0)}% per turn`,
            dueThisTurn: turnsLeft === 1 && dueThisTurn,
            turnsLabel: turnsLeft === 1 ? (dueThisTurn ? 'Due this turn' : 'Due next turn') : `${turnsLeft} turns left`,
        };
    }

    global.LoanMath = { LOAN_TERMS, loanRates, scheduledPayment, loanQuote, loanStatus };
})(window);
