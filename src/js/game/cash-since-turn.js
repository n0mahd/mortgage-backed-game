// "Since your last turn" on the turn ticket's stub, before you roll: the money that
// came in or went out of your cash between your turns, as one line with the net,
// opening to one line per payment when there were several.
// Reads state.cashLedger, state.turnStarts and state.turnNumber, written by
// recordCashFlow and startLedgerTurn in backend/domain/gameRulesInternal/ledger.js.
// Part of the game page; plain top-level functions, loaded before game.js.

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
            return { title: incoming ? `Rent from ${other}` : `Rent to ${other}`, detail: note.replace(/^Rent: .* landed on /, '') };
        case 'rent_share':
            return { title: `Rent share from ${other}`, detail: note.replace(/^Your share of .* rent: /, '') };
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

// The property a rent entry was for ("Rent: Bob landed on Baltic Avenue").
function cashSinceProperty(entry) {
    if (entry.kind !== 'rent' && entry.kind !== 'rent_share') return null;
    const match = /landed on (.+)$/.exec(entry.note || '');
    return (match && (currentGame?.game_state?.properties || []).find(prop => prop.name === match[1])) || null;
}

function renderStubLine({ title, detail, amount, color }) {
    return `
        <span class="ticket-stub-band"${color ? ` style="--stub-color:${escapeHtml(color)}"` : ''} aria-hidden="true"></span>
        <span class="ticket-stub-copy">
            <strong>${escapeHtml(title)}</strong>
            ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
        </span>
        <span class="ticket-stub-amount money ${amount < 0 ? 'is-out' : 'is-in'}">${formatSignedMoney(amount)}</span>`;
}

// Rent shows the square's colour band and its short name.
function stubLineFor(row) {
    const { title, detail } = describeCashSinceEntry(row.entry, row.incoming);
    const property = cashSinceProperty(row.entry);
    if (!property) return { title, detail, amount: row.signed, color: '' };
    const shortDetail = row.entry.kind === 'rent' ? propertyShortName(property) : detail;
    return { title, detail: shortDetail, amount: row.signed, color: getPropertyColorValue(property.color) };
}

// The ticket's tear-off stub on your turn before you roll. Nothing when no money moved.
function renderTicketStub(gameState, userId) {
    if (!userId || !Array.isArray(gameState.cashLedger)) return '';
    const { window, between } = cashSinceRows(gameState, userId);
    if (!window.isMyTurn || !between.length) return '';
    const caption = window.hadTurn ? 'Since your last turn' : 'Before your first turn';
    if (between.length === 1) {
        return `
            <div class="ticket-stub">
                <span class="ticket-stub-caption">${caption}</span>
                <div class="ticket-stub-row">${renderStubLine(stubLineFor(between[0]))}</div>
            </div>`;
    }
    const net = cashSinceTotals(between).net;
    return `
        <details class="ticket-stub">
            <summary class="ticket-stub-row">
                <span class="ticket-stub-caption">${caption}</span>
                ${renderStubLine({ title: `${between.length} payments`, amount: net })}
                <svg class="ticket-stub-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>
            </summary>
            <ul class="ticket-stub-list">
                ${between.map(row => `<li class="ticket-stub-row">${renderStubLine(stubLineFor(row))}</li>`).join('')}
            </ul>
        </details>`;
}
