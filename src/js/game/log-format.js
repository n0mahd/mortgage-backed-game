// Game log wording: turns stored game events into the sentences shown in the
// Recent events tab, sorts each event into a category (icon, label, filters),
// and renders the log turn by turn.
// Part of the game page; plain top-level functions, loaded before game.js.

// Event categories: the icon and label on each log row, and the Recent events
// filters (see LOG_EVENT_FILTERS) each category shows under.
const LOG_EVENT_CATEGORIES = {
    dice: { label: 'Dice', icon: '🎲', filters: ['moves'] },
    go: { label: 'GO', icon: '🏁', filters: ['moves', 'money'] },
    card: { label: 'Card', icon: '🃏', filters: ['moves'] },
    jail: { label: 'Jail', icon: '🚔', filters: ['moves'] },
    purchase: { label: 'Purchase', icon: '🏠', filters: ['property', 'money'] },
    houses: { label: 'Houses', icon: '🏗️', filters: ['property', 'money'] },
    auction: { label: 'Auction', icon: '🔨', filters: ['property'] },
    payment: { label: 'Payment', icon: '💸', filters: ['money'] },
    trade: { label: 'Trade', icon: '🤝', filters: ['trades'] },
    company: { label: 'Company', icon: '📈', filters: ['companies'] },
    loan: { label: 'Loan', icon: '🏦', filters: ['companies'] },
    bankrupt: { label: 'Bankrupt', icon: '💥', filters: ['money'] },
    rules: { label: 'Rules', icon: '📜', filters: ['rules'] },
    turn: { label: 'Turn', icon: '⏭️', filters: [] },
    game: { label: 'Game', icon: '🎮', filters: [] },
    other: { label: 'Event', icon: '•', filters: [] },
};

// The Recent events filter row, in order. 'all' shows everything.
const LOG_EVENT_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'money', label: 'Money' },
    { key: 'moves', label: 'Moves' },
    { key: 'property', label: 'Property' },
    { key: 'trades', label: 'Trades' },
    { key: 'companies', label: 'Companies & loans' },
    { key: 'rules', label: 'Rules' },
];

const LOG_EVENT_TYPE_CATEGORY = {
    dice_roll: 'dice',
    pass_go: 'go',
    card_draw: 'card',
    jail_fine_paid: 'jail',
    jail_card_used: 'jail',
    property_purchase: 'purchase',
    house_purchase: 'houses',
    property_auction_started: 'auction',
    property_auction_bid: 'auction',
    property_auction_passed: 'auction',
    property_auction_won: 'auction',
    property_auction_no_sale: 'auction',
    property_auction_canceled: 'auction',
    forced_payment: 'payment',
    tax_payment: 'payment',
    payment: 'payment',
    bankruptcy_claim_payment: 'payment',
    bankruptcy_claim_settled: 'payment',
    trade_offer_proposed: 'trade',
    trade_offer_accepted: 'trade',
    trade_offer_canceled: 'trade',
    trade_offer_expired: 'trade',
    transaction: 'trade',
    ipo_created: 'company',
    corporation_assets_added: 'company',
    share_purchase: 'company',
    chairman_changed: 'company',
    chairman_vacated: 'company',
    chairman_vote_proposed: 'company',
    chairman_vote_supported: 'company',
    rent_policy_changed: 'company',
    rent_policy_vote_proposed: 'company',
    rent_policy_vote_supported: 'company',
    rent_policy_vote_rejected: 'company',
    dividend_paid: 'company',
    rent_distributed: 'company',
    property_offer_made: 'company',
    property_offer_countered: 'company',
    property_offer_accepted: 'company',
    property_offer_closed: 'company',
    corporation_insolvent: 'company',
    debt_issued: 'loan',
    debt_payment: 'loan',
    debt_refinanced: 'loan',
    debt_autopay: 'loan',
    loan_matured: 'loan',
    interest_accrual: 'loan',
    bankruptcy: 'bankrupt',
    bankruptcy_liquidation: 'bankrupt',
    rule_change_proposed: 'rules',
    rule_change_supported: 'rules',
    rule_change_rejected: 'rules',
    rule_change_withdrawn: 'rules',
    rule_change_expired: 'rules',
    rule_change_passed: 'rules',
    turn_end: 'turn',
    game_started: 'game',
    game_ended: 'game',
    game_paused: 'game',
    game_resumed: 'game',
};

// Events that belong to a second filter as well as their category's.
const LOG_EVENT_EXTRA_FILTERS = {
    jail_fine_paid: ['money'],
    dividend_paid: ['money'],
    rent_distributed: ['money'],
    property_offer_made: ['trades'],
    property_offer_countered: ['trades'],
    property_offer_accepted: ['trades'],
    property_offer_closed: ['trades'],
};

// { key, label, icon, filters } for one stored event.
function logEventCategory(type, data) {
    // Add cash: a payment into a corporation the payer runs, for new shares.
    let key = LOG_EVENT_TYPE_CATEGORY[type] || 'other';
    if (type === 'payment' && data && Object.prototype.hasOwnProperty.call(data, 'newShares')) key = 'company';
    const category = LOG_EVENT_CATEGORIES[key];
    const filters = category.filters.concat(LOG_EVENT_EXTRA_FILTERS[type] || []);
    if (type === 'payment' && key === 'company') filters.push('money');
    return { key, label: category.label, icon: category.icon, filters };
}

function logEventMatchesFilter(event, filterKey) {
    if (!filterKey || filterKey === 'all') return true;
    return logEventCategory(event.event_type, event.event_data).filters.includes(filterKey);
}

// The category icon for a log row, labelled for screen readers.
function renderLogEventIcon(category) {
    return `<span class="log-icon" role="img" aria-label="${escapeHtml(category.label)}">${category.icon}</span>`;
}

// The sentence for an event as HTML, with dollar amounts in bold.
function formatLogEventHtml(type, data) {
    return escapeHtml(formatLogEvent(type, data))
        .replace(/\$\d[\d,]*(?:\.\d+)?/g, amount => `<strong class="log-amount">${amount}</strong>`);
}

// SQLite stores created_at as UTC 'YYYY-MM-DD HH:MM:SS' with no zone; read it as UTC.
function parseLogTime(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        return new Date(`${value.replace(' ', 'T')}Z`);
    }
    return new Date(value);
}

// The server sends events newest first by created_at, which has whole seconds;
// events from the same second come oldest first. Reverse each such run so the
// list is newest first throughout (a turn_end comes before the interest it charged).
function orderGameEventsNewestFirst(events) {
    const ordered = [];
    let run = [];
    (events || []).forEach(event => {
        if (run.length && run[0].created_at !== event.created_at) {
            ordered.push(...run.reverse());
            run = [];
        }
        run.push(event);
    });
    ordered.push(...run.reverse());
    return ordered;
}

// The Recent events list: rows grouped by turn under a "<name>'s turn" heading,
// newest first. A turn_end closes a turn, so it becomes the heading of the turn
// it ended rather than a row. currentPlayerName heads the newest, unfinished turn.
function renderGameLogHtml(events, filterKey, currentPlayerName) {
    const groups = [];
    let group = { player: null, rows: [] };
    let firstTurnSeen = false;
    events.forEach(event => {
        if (event.event_type === 'turn_end') {
            const data = event.event_data || {};
            if (!firstTurnSeen) group.player = data.nextPlayer || currentPlayerName;
            firstTurnSeen = true;
            groups.push(group);
            group = { player: data.player || null, rows: [] };
            return;
        }
        if (logEventMatchesFilter(event, filterKey)) group.rows.push(event);
    });
    if (!firstTurnSeen) group.player = currentPlayerName;
    groups.push(group);

    const html = groups.filter(item => item.rows.length).map(item => `
        ${item.player ? `<div class="log-turn">${escapeHtml(item.player)}'s turn</div>` : ''}
        ${item.rows.map(renderGameLogRow).join('')}
    `).join('');
    if (html) return html;
    const filter = LOG_EVENT_FILTERS.find(item => item.key === filterKey);
    return `<p class="log-empty empty-state">${filter && filter.key !== 'all'
        ? `Nothing under ${escapeHtml(filter.label)} in the latest ${events.length} events.`
        : 'Nothing has happened yet.'}</p>`;
}

function renderGameLogRow(event) {
    const category = logEventCategory(event.event_type, event.event_data);
    return `<div class="log-entry log-cat-${category.key}">
        ${renderLogEventIcon(category)}
        <div class="log-body">
            <span class="log-meta"><span class="log-tag">${escapeHtml(category.label)}</span> <span class="log-time">${escapeHtml(formatLogTimestamp(event.created_at))}</span></span>
            <span class="log-message">${formatLogEventHtml(event.event_type, event.event_data)}</span>
        </div>
    </div>`;
}

// A house-rule value in log lines: Pass GO in dollars, the loan rate in percent.
function formatRuleLogValue(rule, value) {
    return rule === 'loanRate' ? `${Number(value)}%` : `$${Number(value)}`;
}

// Format a game event into a human-readable string
function formatLogEvent(type, data) {
    switch (type) {
        case 'rule_change_proposed':
            return `${data.actor} proposed changing ${data.label} from ${formatRuleLogValue(data.rule, data.from)} to ${formatRuleLogValue(data.rule, data.to)}`;
        case 'rule_change_supported':
            return `${data.actor} agreed to change ${data.label} to ${formatRuleLogValue(data.rule, data.to)}`;
        case 'rule_change_rejected':
            return `${data.actor} rejected ${data.proposer}'s rule change (${data.label} → ${formatRuleLogValue(data.rule, data.to)})`;
        case 'rule_change_withdrawn':
            return data.reason === 'bankrupt'
                ? `${data.actor}'s proposal to change ${data.label} was dropped: they are bankrupt`
                : `${data.actor} withdrew their proposal to change ${data.label}`;
        case 'rule_change_expired':
            return `The vote to change ${data.label} to ${formatRuleLogValue(data.rule, data.to)} expired`;
        case 'rule_change_passed':
            return `Rule change passed: ${data.label} ${formatRuleLogValue(data.rule, data.from)} → ${formatRuleLogValue(data.rule, data.to)} (proposed by ${data.proposer}, agreed by all)`;
        case 'property_purchase':
            if (data.actor) return `${data.actor} bought ${data.property} for ${data.buyer} for $${Number(data.price).toFixed(2)}`;
            return `${data.buyer} purchased ${data.property} for $${Number(data.price).toFixed(2)}`;
        case 'rent_policy_changed': {
            const label = data.policy === 'payout' ? 'Payout: rent goes to its shareholders' : 'Reinvest: rent stays in its treasury';
            return data.method === 'unanimous'
                ? `Every ${data.ticker} shareholder agreed: ${data.ticker} switched to ${label}`
                : `${data.actor} switched ${data.ticker} to ${label}`;
        }
        case 'rent_policy_vote_proposed':
            return `${data.actor} asked every ${data.ticker} shareholder to switch it to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'rent_policy_vote_supported':
            return `${data.actor} agreed to switch ${data.ticker} to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'rent_policy_vote_rejected':
            return `${data.actor} rejected switching ${data.ticker} to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'dividend_paid':
            return `${data.ticker} paid a $${Number(data.amount).toFixed(2)} dividend: ${formatPayouts(data.payouts)}`;
        case 'rent_distributed':
            return `${data.ticker} passed ${data.payer}'s rent to its shareholders: ${formatPayouts(data.payouts)}`;
        case 'property_offer_made':
            return `${data.offerer} offered ${(data.properties || []).join(', ')} to ${data.ticker} for $${Number(data.price).toFixed(2)} in ${data.payWith === 'cash' ? 'treasury cash' : 'new shares'}`;
        case 'property_offer_countered':
            return `${data.actor} countered: ${(data.properties || []).join(', ')} to ${data.ticker} for $${Number(data.price).toFixed(2)}`;
        case 'property_offer_accepted':
            return `${data.ticker} took ${(data.properties || []).join(', ')} from ${data.offerer} for ${Number(data.newShares) > 0 ? `${ShareDeals.count(data.newShares)} new shares` : `$${Number(data.price).toFixed(2)}`}`;
        case 'property_offer_closed':
            return `The offer of ${(data.properties || []).join(', ')} to ${data.ticker} was ${data.status === 'expired' ? 'left to expire' : data.status}`;
        case 'ipo_created':
            return `${data.founder} created IPO ${data.ticker}: ${ShareDeals.count(data.founderShares || data.shares)} shares held by ${data.founder}`;
        case 'corporation_assets_added': {
            const names = Array.isArray(data.properties) ? data.properties.join(', ') : 'property';
            const shares = Number(data.newShares || 0);
            return `${data.actor} put ${names} into ${data.ticker}${shares ? ` for ${ShareDeals.count(shares)} new share${shares === 1 ? '' : 's'} (${data.ticker} now has ${ShareDeals.count(data.totalShares)})` : ''}`;
        }
        case 'share_purchase': {
            const founderShares = Number(data.founderShares || 0);
            const treasuryShares = Number(data.treasuryShares || 0);
            const parts = [];
            if (founderShares > 0) parts.push(`${founderShares} from founder`);
            if (treasuryShares > 0) parts.push(`${treasuryShares} from treasury`);
            const source = parts.length ? ` (${parts.join(', ')})` : '';
            return `${data.buyer} bought ${data.shares} share(s) of ${data.ticker}${source} for $${Number(data.totalCost).toFixed(2)}`;
        }
        case 'chairman_changed':
            if (data.method === 'bankruptcy') return `${data.ticker} chairman changed to ${data.chairman} after bankruptcy`;
            return `${data.ticker} chairman changed to ${data.chairman} by ${data.method === 'vote' ? `${data.supportedShares} supporting shares` : 'majority control'}`;
        case 'chairman_vacated':
            return `${data.ticker} chairman seat is vacant after ${data.formerChairman}'s bankruptcy`;
        case 'chairman_vote_proposed':
            return `${data.ticker} chairman vote proposed for ${data.candidate}`;
        case 'chairman_vote_supported':
            return `${data.supporter} supported ${data.candidate} for ${data.ticker} chairman`;
        case 'debt_issued':
            return `${data.actor ? `${data.actor} borrowed for ${data.issuer}` : `${data.issuer} borrowed`} $${Number(data.amount).toFixed(2)}${data.termTurns ? ` over ${data.termTurns} turn${Number(data.termTurns) === 1 ? '' : 's'}` : ''} at ${data.interestRate}% per turn`;
        case 'debt_payment':
            return data.paidOff
                ? `${data.payer} paid off a loan ($${Number(data.amount).toFixed(2)})`
                : `${data.payer} paid $${Number(data.amount).toFixed(2)} towards a loan`;
        case 'debt_refinanced':
            return `${data.borrower} refinanced ${data.refinancedDebtCount} debt(s) into $${Number(data.amount).toFixed(2)}${data.termTurns ? ` over ${data.termTurns} turns` : ''} at ${data.interestRate}% per turn and ${Number(data.netProceeds || 0) < 0 ? `paid $${(-Number(data.netProceeds)).toFixed(2)} down from cash` : `received $${Number(data.netProceeds || 0).toFixed(2)} net cash`}`;
        case 'debt_autopay':
            if (typeof data.autopay === 'boolean') return `${data.borrower} turned autopay ${data.autopay ? 'on' : 'off'} for a loan`;
            return `${data.borrower} set autopay to ${LoanMath.autopayLabel(data.autopay).toLowerCase()} for a loan`;
        case 'loan_matured':
            return data.repaid
                ? `${data.borrower} repaid a loan in full at maturity ($${Number(data.amount).toFixed(2)})`
                : `${data.borrower} couldn't repay a $${Number(data.amount).toFixed(2)} loan that came due`;
        case 'interest_accrual':
            return data.paid !== undefined
                ? `${data.player} paid $${Number(data.paid).toFixed(2)} on loans (interest this turn: $${Number(data.interestCharged).toFixed(2)})`
                : `${data.player} was charged $${Number(data.interestCharged).toFixed(2)} in interest`;
        case 'corporation_insolvent': {
            const propertyCount = Array.isArray(data.releasedProperties) ? data.releasedProperties.length : 0;
            const sharePositions = Array.isArray(data.wipedSharePositions) ? data.wipedSharePositions.length : 0;
            const debtCount = Array.isArray(data.clearedDebts) ? data.clearedDebts.length : 0;
            return `${data.ticker} became insolvent; ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} returned to the Bank, ${sharePositions} shareholder position(s) wiped, ${debtCount} debt(s) cleared`;
        }
        case 'game_paused':
            return `${data.actor || 'Host'} paused the game${data.reason ? `: ${data.reason}` : ''}`;
        case 'game_resumed':
            return `${data.actor || 'Host'} resumed the game`;
        case 'forced_payment':
            if (Number(data.unpaidAmount || 0) > 0) {
                return `${data.from} owed $${Number(data.amountOwed || 0).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}; paid $${Number(data.amount || 0).toFixed(2)}, $${Number(data.unpaidAmount || 0).toFixed(2)} unpaid`;
            }
            if (data.fullRent) {
                return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to} for ${data.reason} (full rent $${Number(data.fullRent).toFixed(2)}, less their ${data.ownPercent}% stake)`;
            }
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}`;
        case 'jail_fine_paid':
            return `${data.player} paid $${Number(data.amount).toFixed(2)} to leave Jail`;
        case 'jail_card_used':
            return `${data.player} used a Get Out of Jail Free card`;
        case 'tax_payment':
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}`;
        case 'bankruptcy_claim_payment':
            return `${data.player} paid $${Number(data.amount).toFixed(2)} toward ${data.reason} owed to ${data.creditor}`;
        case 'bankruptcy_claim_settled':
            return `${data.player} settled ${data.reason} owed to ${data.creditor}`;
        case 'bankruptcy':
            return `${data.player} has gone BANKRUPT${data.creditor ? ` owing ${data.creditor}` : ''}`;
        case 'bankruptcy_liquidation': {
            const propertyCount = Array.isArray(data.releasedProperties) ? data.releasedProperties.length : 0;
            const shares = (data.returnedSharePositions || []).reduce((sum, item) => sum + Number(item.shares || 0), 0);
            const transferredShares = (data.transferredSharePositions || []).reduce((sum, item) => sum + Number(item.shares || 0), 0);
            const destination = data.assetDestinationName || 'the Bank';
            return `${data.player} liquidation: ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} to ${destination}, ${shares} share(s) returned, ${transferredShares} share(s) transferred`;
        }
        case 'turn_end':
            return `${data.player} ended their turn — it's now ${data.nextPlayer}'s turn`;
        case 'trade_offer_proposed':
            return data.counterOfferId
                ? `${data.proposer} countered ${data.recipient}'s trade offer`
                : `${data.proposer} proposed a trade with ${data.recipient}`;
        case 'trade_offer_accepted':
            return `${data.accepter} accepted ${data.proposer}'s trade offer`;
        case 'trade_offer_canceled':
            if (data.reason === 'host') return `${data.actor} canceled ${data.proposer}'s trade offer as host`;
            if (data.reason === 'bankruptcy') return `${data.proposer}'s trade offer was canceled: ${data.actor} is bankrupt`;
            return `${data.actor} ${data.status === 'declined' ? 'declined' : 'canceled'} ${data.proposer && data.proposer !== data.actor ? `${data.proposer}'s` : 'a'} trade offer`;
        case 'trade_offer_expired':
            return `${data.proposer}'s trade offer to ${data.recipient} expired`;
        case 'transaction':
            return `Trade: ${data.player1} ↔ ${data.player2} ($${data.player1Cash} + ${data.player1Assets} assets ↔ $${data.player2Cash} + ${data.player2Assets} assets)`;
        case 'payment':
            if (Object.prototype.hasOwnProperty.call(data, 'newShares')) {
                const shares = Number(data.newShares || 0);
                return `${data.from} put $${Number(data.amount).toFixed(2)} into ${data.to}${shares ? ` for ${ShareDeals.count(shares)} new share${shares === 1 ? '' : 's'} (${data.to} now has ${ShareDeals.count(data.totalShares)})` : ''}`;
            }
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}`;
        case 'game_started':
            return 'Game started';
        case 'game_ended':
            return `Game over — ${data.reason}`;
        case 'house_purchase':
            if (data.actor && data.actor !== data.player) return `${data.actor} built houses/hotels for ${data.player} for $${Number(data.cost).toFixed(2)} from its treasury`;
            return `${data.player} bought houses/hotels for $${Number(data.cost).toFixed(2)}`;
        case 'property_auction_started':
            return `${data.startedBy} started an auction for ${data.property}`;
        case 'property_auction_bid':
            return `${data.bidder} bid $${Number(data.amount).toFixed(2)} for ${data.property}`;
        case 'property_auction_passed':
            return `${data.player} passed on ${data.property}`;
        case 'property_auction_won':
            return `${data.winner} won ${data.property} at auction for $${Number(data.amount).toFixed(2)}${data.reason === 'timeout' ? ' after timeout' : ''}`;
        case 'property_auction_no_sale':
            return `Auction ended with no sale for ${data.property}${data.reason === 'timeout' ? ' after timeout' : ''}`;
        case 'property_auction_canceled':
            return `${data.actor} canceled the auction for ${data.property}`;
        case 'dice_roll':
            if (data.sentToJail) return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} — sent to Jail`;
            if (data.inJail) return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} and stayed in Jail`;
            return `${data.player} rolled ${data.die1}+${data.die2}=${data.total}${data.jailReleased ? ' — out of Jail,' : ' —'} moved to ${data.square}${data.isDoubles ? ' (doubles!)' : ''}`;
        case 'card_draw':
            return `${data.player} drew ${deckDisplayName(data.deckType)}: "${data.card}"${data.effect ? ` Applied: ${data.effect}.` : ''}`;
        case 'pass_go':
            return `${data.player} passed GO — collected $${data.amount}`;
        default:
            return `${type}: ${JSON.stringify(data)}`;
    }
}

function formatPayouts(payouts) {
    return (payouts || []).map(p => `$${Number(p.amount).toFixed(2)} to ${p.name}`).join(', ');
}

function formatLogTimestamp(value) {
    const date = parseLogTime(value);
    if (Number.isNaN(date.getTime())) return '';
    const sameDay = date.toDateString() === new Date().toDateString();
    return date.toLocaleString([], sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
