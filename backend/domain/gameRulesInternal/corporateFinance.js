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

// Mergers. The target's owners get a stake (a percent) of the merged company
// plus cash. The stake becomes new acquirer shares: holding p% of the merged
// company means newShares / (acquirerShares + newShares) = p / 100.
const MAX_MERGER_STAKE_PERCENT = 95;

function mergerNewShares(stakePercent, acquirerShares) {
    const percent = Number(stakePercent);
    const shares = Number(acquirerShares);
    if (!(percent > 0) || !(shares > 0) || percent >= 100) return 0;
    return Math.round((percent * shares) / (100 - percent));
}

// The stake that gives the target's owners exactly what their shares are
// worth today, so their net worth doesn't move: (owners' value - cash) /
// (acquirer + target - cash). The owners' value is the target's worth times the
// share of it players hold; shares in its treasury get nothing, so their slice
// goes to the acquirer's holders. 0 when the cash alone covers it; null when the
// merged company would be worth $0 or less.
function fairMergerStakePercent(acquirerValue, targetValue, cash, ownersValue = targetValue) {
    const merged = Number(acquirerValue) + Number(targetValue) - Number(cash);
    if (!(merged > 0)) return null;
    const percent = ((Number(ownersValue) - Number(cash)) / merged) * 100;
    return Math.min(Math.max(0, percent), MAX_MERGER_STAKE_PERCENT);
}

// Splits `total` whole shares in proportion to each holder's shares, by
// largest remainder, so the parts add up exactly. Ties go to the bigger holder.
function splitWholeShares(total, holders) {
    const count = Math.max(0, Math.floor(Number(total || 0)));
    const base = holders.reduce((sum, holder) => sum + Math.max(0, Number(holder.shares || 0)), 0);
    if (count === 0 || base <= 0) return holders.map(holder => ({ ...holder, newShares: 0 }));
    const parts = holders.map((holder, index) => {
        const exact = (count * Math.max(0, Number(holder.shares || 0))) / base;
        return { holder, index, whole: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let left = count - parts.reduce((sum, part) => sum + part.whole, 0);
    [...parts]
        .sort((a, b) => (b.remainder - a.remainder) || (Number(b.holder.shares) - Number(a.holder.shares)) || (a.index - b.index))
        .forEach(part => {
            if (left > 0) { part.whole += 1; left -= 1; }
        });
    return parts.map(part => ({ ...part.holder, newShares: part.whole }));
}

module.exports = {
    MAX_MERGER_STAKE_PERCENT,
    mergerNewShares,
    fairMergerStakePercent,
    splitWholeShares,
    RENT_POLICIES,
    DEFAULT_RENT_POLICY,
    DEFAULT_CORPORATION_SHARES,
    normalizeRentPolicy,
    splitByShares,
    shareholderRentDue,
    sharesForPrice,
};
