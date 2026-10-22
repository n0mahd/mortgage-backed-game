'use strict';

// Loan terms, rates and the per-turn schedule. Pure math on debt records; the
// engine decides who pays, from which cash, and what happens when they can't.
//
// A loan runs for a fixed number of the borrower's turns. Each End Turn charges
// one turn of interest on the balance, takes the scheduled installment when
// autopay is on, and counts down. The installment is recomputed every turn so
// the loan is paid off exactly at maturity: skipped payments make later ones
// bigger, extra payments make them smaller, and the last installment is the
// whole balance. Interest that isn't paid is added to the balance and compounds.

const LOAN_TERMS = [5, 10, 15];
const DEFAULT_LOAN_RATES = { 5: 4, 10: 5, 15: 6 };
const MAX_LOAN_RATE = 25;
// Loans made before terms existed get this term from the moment they are next loaded.
const LEGACY_LOAN_TERM = 10;

function roundCents(value) {
    return Math.round(Number(value) * 100) / 100;
}

// Returns the host's rates per term, or an error message players can read.
function validateLoanRates(raw) {
    const rates = {};
    for (const term of LOAN_TERMS) {
        const value = raw && raw[term] !== undefined && raw[term] !== '' ? Number(raw[term]) : DEFAULT_LOAN_RATES[term];
        if (!Number.isFinite(value) || value < 0 || value > MAX_LOAN_RATE) {
            return { error: `The ${term}-turn rate must be between 0% and ${MAX_LOAN_RATE}% per turn.` };
        }
        rates[term] = Math.round(value * 100) / 100;
    }
    return { rates };
}

function normalizeLoanRates(raw) {
    const { rates } = validateLoanRates(raw);
    return rates || { ...DEFAULT_LOAN_RATES };
}

function normalizeDebt(debt) {
    debt.principal = Number(debt.principal || 0);
    debt.interestRate = Number(debt.interestRate || 0);
    debt.termTurns = LOAN_TERMS.includes(Number(debt.termTurns)) ? Number(debt.termTurns) : LEGACY_LOAN_TERM;
    const remaining = Number(debt.turnsRemaining);
    debt.turnsRemaining = Number.isInteger(remaining) && remaining > 0 ? remaining : debt.termTurns;
    debt.autopay = debt.autopay !== false;
    return debt;
}

// The installment that keeps the loan on schedule, charged at the end of the
// borrower's next turn (this turn's interest included).
function scheduledPayment({ principal, interestRate, turnsRemaining }) {
    const balance = Number(principal || 0);
    const rate = Number(interestRate || 0) / 100;
    const turns = Math.max(1, Number(turnsRemaining || 1));
    if (balance <= 0) return 0;
    if (turns === 1) return roundCents(balance * (1 + rate));
    if (rate === 0) return roundCents(balance / turns);
    return roundCents(balance * rate / (1 - Math.pow(1 + rate, -turns)));
}

// One turn of a loan: charge interest, take the installment (autopay, as far as
// cash allows) and count down. At maturity the whole balance is taken whether or
// not there is cash for it; the caller deals with a negative balance.
function serviceLoan(debt, cashAvailable) {
    const due = scheduledPayment(debt);
    const interest = roundCents(debt.principal * debt.interestRate / 100);
    debt.principal = roundCents(debt.principal + interest);
    debt.turnsRemaining -= 1;
    const matured = debt.turnsRemaining <= 0;
    let paid = 0;
    if (matured) paid = debt.principal;
    else if (debt.autopay) paid = Math.min(due, debt.principal, Math.max(0, roundCents(cashAvailable)));
    debt.principal = roundCents(debt.principal - paid);
    return { interest, paid, matured, unpaidInterest: roundCents(Math.max(0, interest - paid)) };
}

module.exports = {
    LOAN_TERMS,
    DEFAULT_LOAN_RATES,
    MAX_LOAN_RATE,
    LEGACY_LOAN_TERM,
    validateLoanRates,
    normalizeLoanRates,
    normalizeDebt,
    scheduledPayment,
    serviceLoan,
};
