'use strict';

// Share maths for running a corporation: splitting cash across a cap table,
// the shareholder's rent discount in Payout mode, and how many new shares a
// property is worth. Pure functions on numbers; the engine decides who pays,
// moves the cash and records the events.

const RENT_POLICIES = ['reinvest', 'payout'];
const DEFAULT_RENT_POLICY = 'reinvest';
// New corporations issue 12,000 shares: it splits evenly in halves, thirds,
// quarters, sixths and eighths, and is fine enough that a single property can
// be swapped for new shares.
const DEFAULT_CORPORATION_SHARES = 12000;
const MAX_CORPORATION_SHARES = 1000000;
// After the runner changes the rent policy on their own, it stays put for
// their next RENT_POLICY_COOLDOWN_TURNS turns unless every shareholder agrees.
const RENT_POLICY_COOLDOWN_TURNS = 5;

function roundCents(value) {
    return Math.round(Number(value) * 100) / 100;
}

function floorCents(value) {
    return Math.floor(Number(value) * 100 + 1e-6) / 100;
}

function normalizeRentPolicy(value) {
    return RENT_POLICIES.includes(value) ? value : DEFAULT_RENT_POLICY;
}

// Splits `amount` in proportion to each entry's shares, rounding each part down
// to the cent. Returns the parts and the total handed out; the few cents left
// over stay with whoever is splitting (the corporation treasury).
function splitByShares(amount, holders) {
    const total = holders.reduce((sum, holder) => sum + Math.max(0, Number(holder.shares || 0)), 0);
    if (!(amount > 0) || total <= 0) return { parts: [], paid: 0 };
    const parts = holders
        .map(holder => ({ ...holder, amount: floorCents((amount * Number(holder.shares || 0)) / total) }))
        .filter(part => part.amount > 0);
    return { parts, paid: roundCents(parts.reduce((sum, part) => sum + part.amount, 0)) };
}

// In Payout mode a shareholder skips their own slice of the rent: with 30% of
// the shares they pay 70%. Everyone else pays in full.
function shareholderRentDue(rent, holderShares, totalShares) {
    const total = Number(totalShares || 0);
    const held = Math.min(Math.max(0, Number(holderShares || 0)), total);
    if (total <= 0 || held <= 0) return roundCents(rent);
    return roundCents((Number(rent) * (total - held)) / total);
}

// New shares a price buys at the corporation's current value per share,
// rounded to the nearest whole share (half rounds up). Rounding can move up to
// half a share's value between the buyer and the existing holders; the
// previews say which way.
function sharesForPrice(price, totalShares, netAssetValue) {
    if (!(netAssetValue > 0) || !(totalShares > 0) || !(price > 0)) return 0;
    return Math.round((Number(price) * Number(totalShares)) / Number(netAssetValue));
}

module.exports = {
    RENT_POLICIES,
    DEFAULT_RENT_POLICY,
    DEFAULT_CORPORATION_SHARES,
    MAX_CORPORATION_SHARES,
    RENT_POLICY_COOLDOWN_TURNS,
    normalizeRentPolicy,
    splitByShares,
    shareholderRentDue,
    sharesForPrice,
};
