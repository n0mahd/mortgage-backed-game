'use strict';

// Loan terms, the rate and the per-turn schedule. Pure math on debt records; the
// engine decides who pays, from which cash, and what happens when they can't.
//
// The host sets one interest rate per turn for the game. A borrower picks how
// many of their turns the loan runs (1 to 30) and what autopay takes at each End
// Turn:
// - pay_down: the installment that pays the loan off exactly at maturity. It is
//   recomputed every turn, so skipped payments make later ones bigger and extra
//   payments make them smaller; paying every installment leaves nothing owed.
// - interest_only: that turn's interest, so the balance stays where it is.
// - off: nothing. Interest that isn't paid is added to the balance and compounds.
// Each End Turn charges one turn of interest on the balance, takes the autopay
// payment and counts down. On the last turn the whole balance is due.

const MIN_LOAN_TERM = 1;
const MAX_LOAN_TERM = 30;
const DEFAULT_LOAN_TERM = 10;
const DEFAULT_LOAN_RATE = 5;
const MAX_LOAN_RATE = 25;
const AUTOPAY_MODES = ['pay_down', 'interest_only', 'off'];
const DEFAULT_AUTOPAY = 'pay_down';

function roundCents(value) {
    return Math.round(Number(value) * 100) / 100;
}

function isLoanTerm(value) {
    return Number.isInteger(value) && value >= MIN_LOAN_TERM && value <= MAX_LOAN_TERM;
}

// Returns the host's rate per turn, or an error message players can read.
// Games set up before the single rate used the 10-turn rate of their old table.
function validateLoanRate(raw, legacyRates) {
    const given = raw !== undefined && raw !== null && raw !== '';
    const legacy = legacyRates && legacyRates[DEFAULT_LOAN_TERM] !== undefined ? Number(legacyRates[DEFAULT_LOAN_TERM]) : DEFAULT_LOAN_RATE;
    const value = given ? Number(raw) : legacy;
    if (!Number.isFinite(value) || value < 0 || value > MAX_LOAN_RATE) {
        return { error: `The loan rate must be between 0% and ${MAX_LOAN_RATE}% per turn.` };
    }
    return { rate: Math.round(value * 100) / 100 };
}

function normalizeLoanRate(raw, legacyRates) {
    const { rate } = validateLoanRate(raw, legacyRates);
    return rate === undefined ? DEFAULT_LOAN_RATE : rate;
}

// Accepts a mode name, or the booleans of the old on/off switch.
function parseAutopay(value) {
    if (value === true) return 'pay_down';
    if (value === false) return 'off';
    return AUTOPAY_MODES.includes(value) ? value : null;
}

function normalizeDebt(debt) {
    debt.principal = Number(debt.principal || 0);
    debt.interestRate = Number(debt.interestRate || 0);
    const term = Number(debt.termTurns);
    debt.termTurns = isLoanTerm(term) ? term : DEFAULT_LOAN_TERM;
    const remaining = Number(debt.turnsRemaining);
    debt.turnsRemaining = Number.isInteger(remaining) && remaining > 0 ? Math.min(remaining, debt.termTurns) : debt.termTurns;
    debt.autopay = parseAutopay(debt.autopay === undefined ? DEFAULT_AUTOPAY : debt.autopay) || DEFAULT_AUTOPAY;
    return debt;
}

// One turn of interest on the balance.
function interestDue({ principal, interestRate }) {
    return roundCents(Number(principal || 0) * Number(interestRate || 0) / 100);
}

// The pay-down installment that keeps the loan on schedule, charged at the end
// of the borrower's next turn (this turn's interest included).
function scheduledPayment({ principal, interestRate, turnsRemaining }) {
    const balance = Number(principal || 0);
    const rate = Number(interestRate || 0) / 100;
    const turns = Math.max(1, Number(turnsRemaining || 1));
    if (balance <= 0) return 0;
    if (turns === 1) return roundCents(balance * (1 + rate));
    if (rate === 0) return roundCents(balance / turns);
    return roundCents(balance * rate / (1 - Math.pow(1 + rate, -turns)));
}

// What the next End Turn takes for this loan, given its autopay mode. On the
// last turn that is the whole balance plus interest, whatever the mode.
function autopayPayment(debt) {
    if (Number(debt.turnsRemaining || 1) <= 1) return scheduledPayment(debt);
    if (debt.autopay === 'pay_down') return scheduledPayment(debt);
    if (debt.autopay === 'interest_only') return interestDue(debt);
    return 0;
}

// One turn of a loan: charge interest, take the autopay payment (as far as cash
// allows) and count down. At maturity the whole balance is taken whether or not
// there is cash for it; the caller deals with a negative balance.
function serviceLoan(debt, cashAvailable) {
    const due = autopayPayment(debt);
    const interest = interestDue(debt);
    debt.principal = roundCents(debt.principal + interest);
    debt.turnsRemaining -= 1;
    const matured = debt.turnsRemaining <= 0;
    let paid = 0;
    if (matured) paid = debt.principal;
    else paid = Math.min(due, debt.principal, Math.max(0, roundCents(cashAvailable)));
    debt.principal = roundCents(debt.principal - paid);
    return { interest, paid, matured, unpaidInterest: roundCents(Math.max(0, interest - paid)) };
}

module.exports = {
    MIN_LOAN_TERM,
    MAX_LOAN_TERM,
    DEFAULT_LOAN_TERM,
    DEFAULT_LOAN_RATE,
    MAX_LOAN_RATE,
    AUTOPAY_MODES,
    isLoanTerm,
    validateLoanRate,
    normalizeLoanRate,
    parseAutopay,
    normalizeDebt,
    interestDue,
    scheduledPayment,
    autopayPayment,
    serviceLoan,
};
