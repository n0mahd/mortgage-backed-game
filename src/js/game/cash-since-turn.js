// "Since your last turn" on the Game tab: every dollar that came in or went out
// of your cash between your turns, with where it came from (rent and who landed,
// dividends, cards, trades) and where it went.
// Reads state.cashLedger, state.turnStarts and state.turnNumber, written by
// recordCashFlow and startLedgerTurn in backend/domain/gameRulesInternal/ledger.js.
// Part of the game page; plain top-level functions, loaded before game.js.

const CASH_SINCE_ICONS = {
    rent: '🏠',
    rent_share: '📈',
    dividend: '📈',
    pass_go: '🏁',
    card: '🃏',
    tax: '🏛️',
    jail: '🔒',
    purchase: '🏠',
    houses: '🏗️',
    auction: '🔨',
    shares: '📈',
    company_cash: '📈',
    property_sale: '🏢',
    loan: '🏦',
    loan_payment: '🏦',
    trade: '🤝',
    payment: '💸',
    debt: '💸',
    merger: '🏢',
};

const CASH_SINCE_VISIBLE_ROWS = 6;

// The bank has no name in the ledger; companies are [TICKER].
function cashSinceParty(name) {
    return name || 'the Bank';
}

// Title and detail line for one ledger entry, from your side of it.
function describeCashSinceEntry(entry, incoming) {
    const other = cashSinceParty(incoming ? entry.fromName : entry.toName);
    const note = entry.note || '';
    switch (entry.kind) {
        case 'rent':
            return { title: incoming ? `Rent from ${other}` : `Rent to ${other}`, detail: note.replace(/^Rent: /, '') };
        case 'rent_share':
            return { title: `Rent share from ${other}`, detail: note.replace(/^Your share of \[?[^\]]*\]? rent: /, '') };
        case 'dividend':
            return { title: `Dividend from ${other}`, detail: '' };
        case 'card': {
            const colon = note.indexOf(': ');
            const deck = colon > 0 ? note.slice(0, colon) : 'Card';
            const text = colon > 0 ? note.slice(colon + 2) : note;
            const party = incoming ? entry.fromName : entry.toName;
            if (!party) return { title: `${deck} card`, detail: text };
            return incoming
                ? { title: `${deck} card: ${party} paid you`, detail: text }
                : { title: `${party}'s ${deck} card`, detail: text };
        }
        case 'trade':
            return { title: `Trade with ${other}`, detail: '' };
        case 'payment':
            return { title: incoming ? `Payment from ${other}` : `Payment to ${other}`, detail: note === 'Sent money' ? '' : note };
        case 'debt':
            return { title: incoming ? `Owed money from ${other}` : `Owed money to ${other}`, detail: note };
        case 'tax':
            return { title: 'Tax', detail: note };
        case 'jail':
            return { title: 'Jail', detail: note };
        case 'houses':
            return { title: 'Houses and hotels', detail: note.replace(/^Built on /, '') };
        case 'merger':
            return { title: incoming ? `Takeover payout from ${other}` : `Takeover cash to ${other}`, detail: note };
        case 'property_sale':
            return { title: `Sold to ${other}`, detail: note };
        default:
            return { title: note || 'Cash', detail: '' };
    }
}

// Which turns count as "between your turns" and which as "this turn".
function cashSinceWindow(gameState, userId) {
    const starts = gameState.turnStarts?.[userId];
    const current = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = !gameState.ended && current?.userId === userId;
    if (isMyTurn) {
        return { isMyTurn, betweenAfter: starts?.previous ?? 0, betweenBefore: starts?.current ?? Number(gameState.turnNumber || 1), hadTurn: starts?.previous != null };
    }
    return { isMyTurn, betweenAfter: starts?.current ?? 0, betweenBefore: Infinity, hadTurn: !!starts };
}

function cashSinceRows(gameState, userId) {
    const window = cashSinceWindow(gameState, userId);
    const between = [];
    const thisTurn = [];
    (gameState.cashLedger || []).forEach(entry => {
        const incoming = entry.toId === userId;
        if (!incoming && entry.fromId !== userId) return;
        const row = { entry, incoming, signed: incoming ? Number(entry.amount) : -Number(entry.amount) };
        const turn = Number(entry.turn || 0);
        if (turn > window.betweenAfter && turn < window.betweenBefore) between.push(row);
        else if (window.isMyTurn && turn === window.betweenBefore) thisTurn.push(row);
    });
    return { window, between: between.reverse(), thisTurn: thisTurn.reverse() };
}

function cashSinceTotals(rows) {
    return rows.reduce((totals, row) => {
        if (row.incoming) totals.in += row.signed;
        else totals.out -= row.signed;
        totals.net += row.signed;
        return totals;
    }, { in: 0, out: 0, net: 0 });
}

function formatSignedMoney(value) {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === 0) return formatMoney(0);
    return `${rounded > 0 ? '+' : '−'}${formatMoney(Math.abs(rounded))}`;
}

function renderCashSinceRow(row) {
    const { title, detail } = describeCashSinceEntry(row.entry, row.incoming);
    return `
        <li class="cash-since-row ${row.incoming ? 'is-in' : 'is-out'}">
            <span class="cash-since-icon" aria-hidden="true">${CASH_SINCE_ICONS[row.entry.kind] || '💸'}</span>
            <span class="cash-since-copy">
                <strong>${escapeHtml(title)}</strong>
                ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
            </span>
            <span class="cash-since-amount money">${formatSignedMoney(row.signed)}</span>
        </li>`;
}

function renderCashSinceList(rows) {
    const visible = rows.slice(0, CASH_SINCE_VISIBLE_ROWS);
    const hidden = rows.slice(CASH_SINCE_VISIBLE_ROWS);
    return `
        <ul class="cash-since-list">${visible.map(renderCashSinceRow).join('')}</ul>
        ${hidden.length ? `
            <details class="cash-since-more">
                <summary>${hidden.length} more</summary>
                <ul class="cash-since-list">${hidden.map(renderCashSinceRow).join('')}</ul>
            </details>` : ''}`;
}

// Open or collapsed is remembered on this device, so a re-render or reload keeps it.
const CASH_SINCE_OPEN_KEY = 'cash_since_open';

function cashSinceIsOpen() {
    try {
        return localStorage.getItem(CASH_SINCE_OPEN_KEY) !== 'false';
    } catch (error) {
        return true;
    }
}

// toggle doesn't bubble, so listen in the capture phase for the card's details.
document.addEventListener('toggle', event => {
    if (!event.target.classList || !event.target.classList.contains('cash-since')) return;
    try {
        localStorage.setItem(CASH_SINCE_OPEN_KEY, event.target.open ? 'true' : 'false');
    } catch (error) {
        // Private windows can refuse storage; the card still opens and closes.
    }
}, true);

function renderCashSinceNet(rows) {
    if (!rows.length) return '';
    const net = cashSinceTotals(rows).net;
    return `<strong class="cash-since-net money ${net < 0 ? 'is-out' : 'is-in'}">${formatSignedMoney(net)}</strong>`;
}

function renderCashSinceBody(rows, emptyText) {
    if (!rows.length) return `<p class="cash-since-empty">${escapeHtml(emptyText)}</p>`;
    const totals = cashSinceTotals(rows);
    return `
        <p class="cash-since-totals">In <span class="money">${formatMoney(totals.in)}</span> · Out <span class="money">${formatMoney(totals.out)}</span></p>
        ${renderCashSinceList(rows)}`;
}

// The Game tab card: a collapsible details whose summary keeps the heading and
// the net amount in view. Nothing for spectators or before the ledger exists.
function renderCashSinceTurn(gameState, userId) {
    if (!userId || !Array.isArray(gameState.cashLedger)) return '';
    if (!gameState.players.some(player => player.userId === userId)) return '';
    const { window, between, thisTurn } = cashSinceRows(gameState, userId);
    const heading = window.hadTurn ? (window.isMyTurn ? 'Since your last turn' : 'Since your turn ended') : 'Before your first turn';
    const thisTurnGroup = window.isMyTurn && thisTurn.length ? `
        <div class="cash-since-group">
            <div class="cash-since-head"><h3>This turn</h3>${renderCashSinceNet(thisTurn)}</div>
            ${renderCashSinceBody(thisTurn, '')}
        </div>` : '';
    return `
        <details class="cash-since"${cashSinceIsOpen() ? ' open' : ''}>
            <summary class="cash-since-summary">
                <h3>${escapeHtml(heading)}</h3>
                ${renderCashSinceNet(between)}
                <svg class="cash-since-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>
            </summary>
            <div class="cash-since-group cash-since-first">${renderCashSinceBody(between, 'No money in or out.')}</div>
            ${thisTurnGroup}
        </details>`;
}
