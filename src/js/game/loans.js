// Loan display helpers for the Debt page, player cards and corporation cards.
//
// Mirrors backend/domain/gameRulesInternal/loans.js: one host rate per turn,
// terms of 1 to 30 turns, the autopay modes, and the installment that pays a
// loan off on schedule. The server is authoritative and sends each loan's
// nextPayment (what autopay takes), installment and interestDue; this file only
// quotes new loans and words the status of existing ones. Classic browser
// script, no build.
(function (global) {
    'use strict';

    const MIN_LOAN_TERM = 1;
    const MAX_LOAN_TERM = 30;
    const DEFAULT_LOAN_TERM = 10;
    const DEFAULT_LOAN_RATE = 5;
    const AUTOPAY_MODES = [
        { value: 'pay_down', label: 'Pay down loan' },
        { value: 'interest_only', label: 'Interest only' },
        { value: 'off', label: 'Off' },
    ];

    // Games saved with a rate per term use their 10-turn rate, as the server does.
    function loanRate(gameState) {
        const settings = gameState?.settings || {};
        return Number(settings.loanRate ?? settings.loanRates?.[DEFAULT_LOAN_TERM] ?? DEFAULT_LOAN_RATE);
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

    function interestDue(balance, ratePercent) {
        return roundCents(Number(balance || 0) * Number(ratePercent || 0) / 100);
    }

    // What autopay takes at the next End Turn; the whole balance on the last turn.
    function autopayPayment(balance, ratePercent, turnsLeft, autopay) {
        if (turnsLeft <= 1 || autopay === 'pay_down') return scheduledPayment(balance, ratePercent, turnsLeft);
        return autopay === 'interest_only' ? interestDue(balance, ratePercent) : 0;
    }

    // What a new loan costs: paying it down every turn, or paying interest only
    // and then the balance on the last turn.
    function loanQuote(amount, ratePercent, turns) {
        const payment = scheduledPayment(amount, ratePercent, turns);
        const interest = interestDue(amount, ratePercent);
        const finalPayment = roundCents(amount + interest);
        return {
            payment,
            total: roundCents(payment * turns),
            interest,
            finalPayment,
            interestOnlyTotal: roundCents(interest * (turns - 1) + finalPayment),
        };
    }

    function autopayLabel(autopay) {
        return (AUTOPAY_MODES.find(mode => mode.value === autopay) || AUTOPAY_MODES[0]).label;
    }

    // dueThisTurn: the borrower (or the corporation's chairman) is on turn now, so
    // a loan on its last turn is due when they end this turn.
    function loanStatus(debt, { dueThisTurn = false } = {}) {
        const turnsLeft = Math.max(1, Number(debt.turnsRemaining || 1));
        const balance = Number(debt.principal || 0);
        const termTurns = Number(debt.termTurns || DEFAULT_LOAN_TERM);
        return {
            balance,
            turnsLeft,
            dueInFull: turnsLeft === 1,
            nextPayment: Number(debt.nextPayment || 0),
            installment: Number(debt.installment || 0),
            interestNext: Number(debt.interestDue ?? interestDue(balance, debt.interestRate)),
            autopay: debt.autopay || 'pay_down',
            termLabel: `${termTurns}-turn loan at ${Number(debt.interestRate || 0)}% per turn`,
            dueThisTurn: turnsLeft === 1 && dueThisTurn,
            turnsLabel: turnsLeft === 1 ? (dueThisTurn ? 'Due this turn' : 'Due next turn') : `${turnsLeft} turns left`,
        };
    }

    // One line on what a loan does at the borrower's next End Turn.
    function paymentNote(debt, dueThisTurn = false) {
        const status = loanStatus(debt, { dueThisTurn });
        const money = global.formatMoney;
        if (status.dueInFull) return `${money(status.nextPayment)} due in full ${status.dueThisTurn ? 'at End Turn' : 'next turn'}`;
        if (status.autopay === 'pay_down') return `Autopay ${money(status.nextPayment)} next turn at ${Number(debt.interestRate || 0)}%`;
        if (status.autopay === 'interest_only') return `Autopay ${money(status.nextPayment)} interest only next turn`;
        return `Autopay off: ${money(status.interestNext)} interest added next turn`;
    }

    global.LoanMath = {
        MIN_LOAN_TERM,
        MAX_LOAN_TERM,
        DEFAULT_LOAN_TERM,
        AUTOPAY_MODES,
        loanRate,
        scheduledPayment,
        interestDue,
        autopayPayment,
        loanQuote,
        autopayLabel,
        loanStatus,
        paymentNote,
    };
})(window);
