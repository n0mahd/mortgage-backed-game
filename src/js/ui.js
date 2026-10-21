// Shared DOM and presentation helpers for the "Term Sheet" design system:
// escaping, money, dice, toasts, copy to clipboard, page-load errors.
// Classic script: load after api.js and before page scripts. See documents/design-system.md.

// Safe for HTML text and quoted attribute values alike.
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

function showPageLoadError(message) {
    const container = document.querySelector('.container') || document.body;
    const notice = document.createElement('div');
    notice.className = 'turn-warning danger';
    notice.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = message;
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary btn-sm';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => window.location.reload());
    notice.append(text, retry);
    container.prepend(notice);
}

// Copies text to the clipboard. Resolves true when it worked; older browsers
// fall back to execCommand('copy') on a hidden textarea.
async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {}
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
}

// $1,500 for whole amounts, $1,512.50 when cents matter. Negative values keep the sign.
function formatMoney(value) {
    const amount = Number(value || 0);
    const hasCents = Math.round(amount * 100) % 100 !== 0;
    const formatted = Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: 2,
    });
    return `${amount < 0 ? '−' : ''}$${formatted}`;
}

function playerInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : String(parts[0] || '?').slice(0, 2);
    return letters.toUpperCase();
}

// Pip layout per face on a 3x3 grid (cells 1-9, reading order).
const DIE_PIP_CELLS = {
    1: [5],
    2: [3, 7],
    3: [3, 5, 7],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
};

function renderDieFace(value, extraClass = '') {
    const face = Number(value);
    const cells = DIE_PIP_CELLS[face];
    if (!cells) {
        return `<span class="die-face is-blank ${extraClass}" aria-hidden="true"></span>`;
    }
    const pips = Array.from({ length: 9 }, (_, i) =>
        `<i class="${cells.includes(i + 1) ? 'pip' : ''}"></i>`
    ).join('');
    return `<span class="die-face ${extraClass}" aria-hidden="true">${pips}</span>`;
}

function renderDicePair(dice, { rolling = false } = {}) {
    const hasDice = Array.isArray(dice) && dice.length >= 2;
    const label = hasDice ? `Rolled ${dice[0]} and ${dice[1]}, total ${dice[0] + dice[1]}` : 'Not rolled yet';
    return `<span class="dice-pair${rolling ? ' is-rolling' : ''}" role="img" aria-label="${label}">
        ${renderDieFace(hasDice ? dice[0] : null)}${renderDieFace(hasDice ? dice[1] : null)}
    </span>`;
}

// Toasts stack at the top, under the status bar, and announce politely.
function showToast(message, tone = 'info') {
    let region = document.getElementById('toast-region');
    if (!region) {
        region = document.createElement('div');
        region.id = 'toast-region';
        region.className = 'toast-region';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${tone}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('is-leaving');
        setTimeout(() => toast.remove(), 260);
    }, 3500);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatMoney, playerInitials, renderDieFace, renderDicePair };
}
