// The square in play on the Game tab, as a title deed under the turn ticket: a band
// in the square's colour with its name, who owns it and how much of the set, then
// either the rent ladder (when it's for sale, the rent that would apply highlighted)
// or a stamp with the money that moved for this landing (−$20, +$8), from your side.
// Shown once the current player has landed this turn; Chance, Community Chest and
// corner squares get no card. Rents come from state.properties (board.js on the server).
// The stamp reads this turn's entries in state.cashLedger (ledger.js recordCashFlow).
// Part of the game page; plain top-level functions, loaded before game.js.

const SQUARE_STREET_LADDER = [['Rent', 0], ['Set', 'set'], ['1 house', 1], ['Hotel', 5]];

function squareGroupNoun(color, count) {
    if (color === 'Railroad') return count === 1 ? 'railroad' : 'railroads';
    if (color === 'Utility') return count === 1 ? 'utility' : 'utilities';
    const noun = String(color || '').toLowerCase();
    return count === 1 ? noun : `${noun}s`;
}

// "2 of 3 reds", "brown set", "all 4 railroads", plus buildings.
function squareSetLine(gameState, property) {
    const group = gameState.properties.filter(prop => prop.color === property.color);
    const owned = group.filter(prop => prop.ownerId === property.ownerId).length;
    let line;
    if (owned === group.length) {
        line = property.color === 'Railroad' || property.color === 'Utility'
            ? `all ${group.length} ${squareGroupNoun(property.color, group.length)}`
            : `${String(property.color).toLowerCase()} set`;
        if (property.color === 'Utility' && group.length === 2) line = 'both utilities';
    } else {
        line = `${owned} of ${group.length} ${squareGroupNoun(property.color, group.length)}`;
    }
    const houses = Number(property.houses || 0);
    if (houses === 5) line += ' · hotel';
    else if (houses > 0) line += ` · ${houses} house${houses === 1 ? '' : 's'}`;
    return line;
}

function squareOwnerLabel(gameState, ownerId) {
    if (ownerId === currentUser?.id) return 'Yours';
    const owner = describeOwner(gameState, ownerId, null);
    return `${owner.corporation ? owner.corporation.ticker : owner.label}'s`;
}

function squareOwnerBadge(gameState, ownerId) {
    const player = gameState.players.find(p => p.userId === ownerId);
    if (player) return playerAvatarHtml(player, 'sm');
    const corp = (gameState.corporations || []).find(c => c.id === ownerId);
    return corp ? `<span class="square-card-ticker">${escapeHtml(corp.ticker)}</span>` : '';
}

// The rents a buyer would see; the cell that applies to the current player if they buy is lit.
function renderRentLadder(gameState, property, buyerId) {
    const rent = Array.isArray(property.rent) ? property.rent.map(Number) : [];
    const ownedAfter = gameState.properties
        .filter(prop => prop.color === property.color && (prop.ownerId === buyerId || prop.id === property.id)).length;
    const groupSize = gameState.properties.filter(prop => prop.color === property.color).length;
    let cells;
    if (property.color === 'Railroad') {
        cells = rent.map((amount, i) => ({ label: `${i + 1} RR`, value: formatMoney(amount), lit: i + 1 === ownedAfter }));
    } else if (property.color === 'Utility') {
        cells = [
            { label: '1 utility', value: '4× dice', lit: ownedAfter === 1 },
            { label: 'Both', value: '10× dice', lit: ownedAfter >= 2 },
        ];
    } else {
        const completes = ownedAfter === groupSize;
        cells = SQUARE_STREET_LADDER.map(([label, key]) => ({
            label,
            value: formatMoney(key === 'set' ? rent[0] * 2 : rent[key]),
            lit: key === 'set' ? completes : (key === 0 && !completes),
        }));
    }
    return `
        <div class="rent-ladder">
            ${cells.map(cell => `<div class="rent-ladder-step${cell.lit ? ' is-lit' : ''}"><span>${escapeHtml(cell.label)}</span><strong class="money">${escapeHtml(cell.value)}</strong></div>`).join('')}
        </div>`;
}

// Money that moved for the current player's landing on this property this turn,
// from the viewer's side: what they paid, what they got (rent or a Payout share),
// or, for a bystander, the rent itself.
function squareRentStamp(gameState, property, payerId, viewerId) {
    const ledger = Array.isArray(gameState.cashLedger) ? gameState.cashLedger : [];
    const turn = Number(gameState.turnNumber || 0);
    const forLanding = entry => Number(entry.turn) === turn && String(entry.note || '').endsWith(`landed on ${property.name}`);
    const rent = [...ledger].reverse().find(entry => entry.kind === 'rent' && entry.fromId === payerId && forLanding(entry));
    if (!rent) return null;
    if (viewerId === payerId) return { amount: -Number(rent.amount), tone: 'is-out' };
    if (rent.toId === viewerId) return { amount: Number(rent.amount), tone: 'is-in' };
    const share = ledger.filter(entry => entry.kind === 'rent_share' && entry.seq > rent.seq && entry.toId === viewerId && forLanding(entry))
        .reduce((sum, entry) => sum + Number(entry.amount), 0);
    if (share > 0) return { amount: share, tone: 'is-in' };
    return { amount: Number(rent.amount), tone: 'is-neutral' };
}

function squareTaxStamp(gameState, square, payerId, viewerId) {
    const ledger = Array.isArray(gameState.cashLedger) ? gameState.cashLedger : [];
    const turn = Number(gameState.turnNumber || 0);
    const tax = [...ledger].reverse().find(entry => entry.kind === 'tax' && entry.fromId === payerId
        && Number(entry.turn) === turn && entry.note === square.name);
    if (!tax) return null;
    return viewerId === payerId
        ? { amount: -Number(tax.amount), tone: 'is-out' }
        : { amount: Number(tax.amount), tone: 'is-neutral' };
}

function renderSquareStamp(stamp) {
    const text = stamp.tone === 'is-neutral' ? formatMoney(stamp.amount) : formatSignedMoney(stamp.amount);
    return `<div class="square-card-body has-stamp"><span class="square-stamp ${stamp.tone}">${escapeHtml(text)}</span></div>`;
}

function renderSquareCardShell({ name, kind, color, badge = '', body = '', plain = false }) {
    return `
        <section class="square-card${plain ? ' is-plain' : ''}"${color ? ` style="--square-color:${escapeHtml(color)};--square-ink:${escapeHtml(getReadableTextColor(color))}"` : ''} aria-label="${escapeHtml(name)}">
            <div class="square-card-band">
                <div class="square-card-title"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(kind)}</span></div>
                ${badge}
            </div>
            ${body}
        </section>`;
}

function renderSquareCard(gameState, currentPlayer) {
    if (gameState.ended || !currentPlayer || currentPlayer.inJail) return '';
    if (!getRollState(gameState, currentPlayer).hasMoved) return '';
    const square = BOARD_SQUARES[currentPlayer.position || 0];
    if (!square) return '';
    const viewerId = currentUser?.id;

    if (square.type === 'tax') {
        const stamp = squareTaxStamp(gameState, square, currentPlayer.userId, viewerId);
        return renderSquareCardShell({ name: square.name, kind: 'Tax', plain: true, body: stamp ? renderSquareStamp(stamp) : '' });
    }

    const property = square.propertyId ? gameState.properties.find(prop => prop.id === square.propertyId) : null;
    if (!property) return '';
    // An open auction for it has its own card.
    if (gameState.auction?.status === 'open' && gameState.auction.propertyId === property.id) return '';
    const color = getPropertyColorValue(property.color);
    const groupName = property.color === 'Railroad' || property.color === 'Utility' ? property.color : `${property.color} street`;

    if (!property.ownerId) {
        return renderSquareCardShell({
            name: propertyShortName(property),
            kind: `${groupName} · for sale`,
            color,
            body: `<div class="square-card-body">${renderRentLadder(gameState, property, currentPlayer.userId)}</div>`,
        });
    }

    const stamp = squareRentStamp(gameState, property, currentPlayer.userId, viewerId);
    return renderSquareCardShell({
        name: propertyShortName(property),
        kind: `${squareOwnerLabel(gameState, property.ownerId)} · ${squareSetLine(gameState, property)}`,
        color,
        badge: squareOwnerBadge(gameState, property.ownerId),
        body: stamp ? renderSquareStamp(stamp) : '',
    });
}
