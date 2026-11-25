// LLCs (corporations) outside the chairman's desk: the IPO sheet, adding more
// properties to an LLC you run, and the Corporations sheet (a list of every
// corporation, then one corporation's detail in tabs), chairman governance and
// share buying. The chairman's tools inside that sheet (rent
// policy, dividends, property offers) are corporation-desk.js; share-deal
// previews are share-deals.js.
// Part of the game page; reads game.js's state. Buttons run via action-dispatcher.js.

// Open IPO Modal
async function openIPOModal() {
    const assetsHtml = currentPlayerData.properties.map(p => {
        const built = groupHasBuildingsUi(p.color);
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="ipo-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"${built ? ` data-built-group="${escapeHtml(p.color)}"` : ''}>
            <label for="ipo-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span>${built ? ` <span class="debt-detail">Has buildings: goes in with the whole ${escapeHtml(p.color)} group</span>` : ''}</label>
        </div>
    `;
    }).join('');

    const container = document.getElementById('ipoAssets');
    container.innerHTML = assetsHtml;
    const runCorps = ShareDeals.corporationsRunBy(currentGame.game_state, currentUser.id);
    const existing = document.getElementById('ipoExistingCorps');
    existing.hidden = runCorps.length === 0;
    existing.innerHTML = runCorps.length ? `
        <small>Or add to:</small>
        ${runCorps.map(corp => `<button class="btn btn-secondary btn-sm" data-game-action="open-add-to-corporation" data-corp-id="${escapeHtml(corp.id)}">Add to ${escapeHtml(corp.ticker)}</button>`).join('')}
    ` : '';
    // A built group goes into an IPO whole, so ticking one street ticks the group.
    container.querySelectorAll('input[data-built-group]').forEach(input => {
        input.addEventListener('change', () => {
            container.querySelectorAll(`input[data-built-group="${CSS.escape(input.dataset.builtGroup)}"]`).forEach(other => { other.checked = input.checked; });
        });
    });
    openModal('ipoModal');
}

async function createIPO() {
    const ticker = document.getElementById('ipoTicker').value.toUpperCase();

    if (!ticker) {
        alert('Please enter a ticker symbol');
        return;
    }

    const selectedAssets = Array.from(document.querySelectorAll('#ipoAssets input:checked'))
        .map(cb => currentPlayerData.properties.find(p => p.id === cb.value));

    if (selectedAssets.length === 0) {
        alert('Please select at least one asset');
        return;
    }

    await submitGameAction('create_ipo', {
        ticker,
        assetIds: selectedAssets.map(asset => asset.id),
    }, {
        errorText: 'Failed to create IPO',
        onSaved: () => closeModal('ipoModal'),
    });
}

// A corporation's properties in board order, one block per colour group,
// each saying how much of the set the corporation holds.
function renderCorporationAssetGroups(assets) {
    if (!assets.length) return '<p class="empty-state">No assets</p>';
    const allProperties = currentGame.game_state.properties || [];
    const groups = new Map();
    [...assets]
        .sort((a, b) => getPropertyBoardPosition(a.id) - getPropertyBoardPosition(b.id))
        .forEach(asset => {
            const color = allProperties.find(prop => prop.id === asset.id)?.color || 'Property';
            if (!groups.has(color)) groups.set(color, []);
            groups.get(color).push(asset);
        });
    return `<div class="corp-asset-groups">${[...groups].map(([color, items]) => {
        const total = PROPERTY_GROUP_SIZES[color] || allProperties.filter(prop => prop.color === color).length || items.length;
        const setLabel = items.length >= total
            ? (color === 'Railroad' || color === 'Utility' ? 'Complete set' : 'Monopoly')
            : `${items.length} of ${total}`;
        return `
            <div class="corp-asset-group" style="--property-color:${escapeHtml(getPropertyColorValue(color))};">
                <div class="corp-asset-group-head">
                    <span>${escapeHtml(color)}</span>
                    <span class="corp-asset-set${items.length >= total ? ' complete' : ''}">${escapeHtml(setLabel)}</span>
                </div>
                ${items.map(asset => {
                    // The board's copy has the houses; its value counts them.
                    const property = allProperties.find(prop => prop.id === asset.id);
                    const value = property ? propertyAssetValue(property) : Number(asset.value || 0);
                    return `
                    <div class="corp-asset-row">
                        <span>${escapeHtml(asset.name)}${property ? boardBuildings(property) : ''}</span>
                        <span class="corp-asset-value">${formatMoney(value)}</span>
                    </div>
                `;
                }).join('')}
            </div>
        `;
    }).join('')}</div>`;
}

// The Corporations sheet has two levels: a list with one summary card per
// corporation, and one corporation's detail. On phones the detail is split
// into tabs; from 720px every panel shows, in two columns (CSS decides).
let corpSheetCorpId = null; // null shows the list
let corpSheetTab = 'overview';
const CORP_SHEET_TABS = ['overview', 'owners', 'assets', 'debt'];

// Opens (or re-renders) the sheet. With a corpId, shows that corporation;
// opened afresh without one, starts at the list. Re-rendering an open sheet
// after an action keeps the corporation and tab in view.
async function openCorporationModal(corpId) {
    const modal = document.getElementById('corporationModal');
    if (typeof corpId !== 'string' && corpId !== null) corpId = undefined;
    if (corpId !== undefined) {
        corpSheetCorpId = corpId;
        corpSheetTab = 'overview';
    } else if (!modal.classList.contains('active')) {
        corpSheetCorpId = null;
        corpSheetTab = 'overview';
    }
    const corporations = currentGame.game_state.corporations || [];
    const corp = corporations.find(item => item.id === corpSheetCorpId);
    if (!corp) corpSheetCorpId = null;
    modal.querySelector('.modal-content').classList.toggle('is-detail', !!corp);
    const list = document.getElementById('corporationList');
    list.innerHTML = corp ? renderCorporationDetail(corp) : renderCorporationSummaries(corporations);
    list.dataset.html = list.innerHTML;
    list.querySelectorAll('.buy-shares-form input').forEach(updateBuySharesTotal);
    openModal('corporationModal');
    if (corpId !== undefined) modal.querySelector('.modal-content').scrollTop = 0;
}

// Called on every game update: the open corporation sheets recalculate from
// the new state (share price, what treasury shares cost, new-share previews),
// keeping whatever the player has typed or ticked.
function refreshCorporationSheets() {
    const isOpen = id => document.getElementById(id)?.classList.contains('active');
    if (isOpen('corporationModal')) refreshCorporationModal();
    if (isOpen('addToCorpModal')) refreshAddToCorporation();
    if (isOpen('addCashToCorpModal')) refreshAddCashToCorporation();
    CorporationDesk.refreshPropertyOffer();
}

function refreshCorporationModal() {
    const list = document.getElementById('corporationList');
    const corporations = currentGame.game_state.corporations || [];
    const corp = corporations.find(item => item.id === corpSheetCorpId);
    if (!corp) corpSheetCorpId = null;
    const fresh = document.createElement('div');
    fresh.innerHTML = corp ? renderCorporationDetail(corp) : renderCorporationSummaries(corporations);
    if (list.dataset.html === fresh.innerHTML) return;
    const typed = new Map(Array.from(list.querySelectorAll('input[id], select[id], textarea[id]'))
        .filter(el => el.type !== 'checkbox' && el.type !== 'radio')
        .map(el => [el.id, el.value]));
    const focusedId = list.contains(document.activeElement) ? document.activeElement.id : null;
    document.querySelector('#corporationModal .modal-content').classList.toggle('is-detail', !!corp);
    list.innerHTML = fresh.innerHTML;
    list.dataset.html = fresh.innerHTML;
    typed.forEach((value, id) => {
        const el = document.getElementById(id);
        if (el && list.contains(el)) el.value = value;
    });
    list.querySelectorAll('.buy-shares-form input').forEach(updateBuySharesTotal);
    if (focusedId) document.getElementById(focusedId)?.focus();
}

// What a number of treasury shares costs: the exact value per share times the
// count, rounded to the cent only at the end, as the server charges it.
function updateBuySharesTotal(input) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === input.dataset.corpId);
    const out = document.getElementById(`buySharesTotal-${input.dataset.corpId}`);
    if (!corp || !out) return;
    const shares = Math.max(0, Math.floor(Number(input.value) || 0));
    const cost = Math.round(shares * getCorporationShareValue(corp) * 100) / 100;
    const text = shares > 0 ? `${ShareDeals.count(shares)} share${shares === 1 ? '' : 's'} (${ShareDeals.percent(shares, corp.totalShares)}) for ${formatMoney(cost)}` : '';
    if (out.textContent !== text) out.textContent = text;
}

function showCorporationList() {
    openCorporationModal(null);
}

// Switches the phone tab without re-rendering, so typed amounts survive.
function selectCorporationTab(tab) {
    if (!CORP_SHEET_TABS.includes(tab)) return;
    corpSheetTab = tab;
    const detail = document.querySelector('#corporationList .corp-detail');
    if (!detail) return;
    detail.dataset.corpTab = tab;
    detail.querySelectorAll('[data-corp-tab-button]').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    });
}

// Who owns what, as one bar: a segment per shareholder in their player colour.
function renderOwnersBar(corp) {
    const players = currentGame.game_state.players || [];
    const total = Number(corp.totalShares || 0);
    const segments = (corp.shareholders || [])
        .filter(holder => Number(holder.shares || 0) > 0 && total > 0)
        .map(holder => {
            const player = players.find(p => p.userId === holder.userId);
            const width = (Number(holder.shares) / total) * 100;
            return `<span style="--owner-color:${escapeHtml(getPlayerColor(player))};--owner-share:${width.toFixed(2)}%"></span>`;
        }).join('');
    return `<div class="corp-owners-bar" aria-hidden="true">${segments}</div>`;
}

// The company a merged corporation joined, by its ticker today. When the
// merger gave the buyer this company's own ticker, says so.
function mergedIntoLabel(corp) {
    const into = (currentGame.game_state.corporations || []).find(item => item.id === corp.mergedInto?.corpId);
    const ticker = into?.ticker || corp.mergedInto?.ticker || 'another company';
    if (ticker === corp.ticker && corp.mergedInto?.acquirerTicker) return `${corp.mergedInto.acquirerTicker} (now ${ticker})`;
    return ticker;
}

function corporationRoleLine(corp) {
    if (ShareDeals.isMerged(corp)) return `Merged into ${mergedIntoLabel(corp)}`;
    if (ShareDeals.isInsolvent(corp)) return 'Closed after insolvency';
    const mine = ShareDeals.sharesHeld(corp, currentUser.id);
    const stake = mine > 0 ? `you own ${ShareDeals.percent(mine, corp.totalShares)}` : "you don't own shares";
    if (ShareDeals.runsCorporation(corp, currentUser.id)) return `You're the chairman, ${stake}`;
    return `Chairman ${corp.chairmanName || corp.founderName || 'unassigned'}, ${stake}`;
}

function corporationStatusBadge(corp) {
    if (ShareDeals.isMerged(corp)) return `<span class="badge">Merged into ${escapeHtml(mergedIntoLabel(corp))}</span>`;
    if (ShareDeals.isInsolvent(corp)) return '<span class="badge badge-danger">Insolvent</span>';
    return corp.rentPolicy === 'payout'
        ? '<span class="badge badge-gold">Payout</span>'
        : '<span class="badge">Reinvest</span>';
}

function renderCorporationSummaries(corporations) {
    const header = '<div class="modal-header">Corporations</div>';
    if (!corporations.length) {
        return `${header}<p class="empty-state">No corporations yet. Create an IPO to start one.</p>`;
    }
    // Closed companies go last.
    const ordered = [...corporations].sort((a, b) => ShareDeals.isClosed(a) - ShareDeals.isClosed(b));
    const cards = ordered.map(corp => {
        const debt = getDebtTotal(corp.debts);
        const forSale = getTreasuryListedShares(corp);
        const waiting = CorporationDesk.waitingOnMe(corp);
        const facts = ShareDeals.isMerged(corp)
            ? `<span>Its properties, cash and loans moved to ${escapeHtml(mergedIntoLabel(corp))}</span>`
            : ShareDeals.isInsolvent(corp)
            ? '<span>Properties returned to the Bank</span>'
            : `<span>Worth <b>${formatMoney(getCorporationNetAssetValue(corp))}</b></span>
               <span>Cash <b>${formatMoney(Number(corp.cash || 0))}</b></span>
               ${debt > 0 ? `<span class="is-owed">Owes <b>${formatMoney(debt)}</b></span>` : ''}
               ${forSale > 0 ? `<span>${ShareDeals.count(forSale)} shares for sale</span>` : ''}`;
        return `
            <button type="button" class="corp-summary" data-game-action="open-corporation-detail" data-corp-id="${escapeHtml(corp.id)}">
                <span class="corp-summary-head">
                    <span class="corp-ticker">${escapeHtml(corp.ticker)}</span>
                    ${corporationStatusBadge(corp)}
                    ${ShareDeals.isMerged(corp) ? '' : `<span class="corp-summary-price">${ShareDeals.perShare(getCorporationShareValue(corp))}<small>a share</small></span>`}
                </span>
                ${ShareDeals.isMerged(corp) ? '' : `<span class="corp-summary-role">${escapeHtml(corporationRoleLine(corp))}</span>${renderOwnersBar(corp)}`}
                <span class="corp-summary-facts">${facts}</span>
                ${waiting.map(line => `<span class="corp-summary-waiting">${escapeHtml(line)}</span>`).join('')}
            </button>
        `;
    }).join('');
    return `${header}<div class="corp-summary-list">${cards}</div>`;
}

function renderCorporationStats(corp) {
    const debt = getDebtTotal(corp.debts);
    const tile = (label, value, extra = '') => `<div class="corp-stat${extra}"><span class="stat-label">${label}</span><span class="corp-stat-value">${value}</span></div>`;
    return `
        <div class="corp-stats">
            ${tile('Worth', formatMoney(getCorporationNetAssetValue(corp)))}
            ${tile('Share price', ShareDeals.perShare(getCorporationShareValue(corp)))}
            ${tile('Cash', formatMoney(Number(corp.cash || 0)))}
            ${debt > 0 ? tile('Owes', formatMoney(debt), ' is-owed') : ''}
        </div>
    `;
}

function renderCorporationOwners(corp) {
    const shareholders = (corp.shareholders || []).filter(holder => Number(holder.shares || 0) > 0);
    const players = currentGame.game_state.players || [];
    const rows = shareholders.length
        ? shareholders.map(holder => {
            const player = players.find(p => p.userId === holder.userId);
            const role = [
                holder.userId === corp.chairmanId ? 'chairman' : '',
                holder.userId === corp.founderId ? 'founder' : '',
            ].filter(Boolean).join(', ');
            return `
                <li class="corp-owner-row">
                    <span><i class="corp-owner-dot" style="--owner-color:${escapeHtml(getPlayerColor(player))}"></i>${escapeHtml(holder.userId === currentUser.id ? `${holder.name} (you)` : holder.name)}${role ? ` <small>${role}</small>` : ''}</span>
                    <span>${ShareDeals.count(holder.shares)} · ${ownershipPercent(holder.shares, corp.totalShares)}%</span>
                </li>
            `;
        }).join('')
        : '<li class="empty-state">No active shareholders</li>';
    const treasury = getTreasuryListedShares(corp);
    const treasuryRow = treasury > 0 ? `
                <li class="corp-owner-row">
                    <span>For sale</span>
                    <span>${ShareDeals.count(treasury)} · ${ownershipPercent(treasury, corp.totalShares)}%</span>
                </li>` : '';
    return `
        <h4>Owners</h4>
        ${renderOwnersBar(corp)}
        <ul class="corp-owner-list">${rows}${treasuryRow}</ul>
        ${renderChairmanGovernance(corp)}
    `;
}

// The chairman's Build houses and Borrow, repeated on the phone's Properties
// and Debt tabs; from 720px, where Chairman moves shows beside them, CSS hides
// the repeat.
function renderCorporationPanelMove(corp, button) {
    if (!ShareDeals.runsCorporation(corp, currentUser.id)) return '';
    return `<div class="moves-grid corp-moves corp-panel-move">${button}</div>`;
}

function renderCorporationDebts(corp) {
    const gameState = currentGame.game_state;
    const debts = Array.isArray(corp.debts) ? corp.debts : [];
    const rows = debts.length
        ? debts.map(d => {
            const dueThisTurn = gameState.players[gameState.currentPlayerIndex]?.userId === corp.chairmanId;
            const status = LoanMath.loanStatus(d, { dueThisTurn });
            return `<li>${formatMoney(d.principal)} · ${escapeHtml(status.turnsLabel.toLowerCase())} · ${escapeHtml(corpLoanAutopayLabel(status))}</li>`;
        }).join('')
        : '';
    return `<ul class="corp-debt-list">${rows}</ul>${ShareDeals.isClosed(corp) ? '' : renderCorporationPanelMove(corp, CorporationDesk.borrowButton(corp))}`;
}

// "autopay off", "pays $51.80 a turn", "due in full".
function corpLoanAutopayLabel(status) {
    if (status.dueInFull) return `${formatMoney(status.nextPayment)} due in full`;
    if (status.autopay === 'off') return 'autopay off';
    return `autopay ${formatMoney(status.nextPayment)}`;
}

// What the viewer can do here, by role: the chairman runs it; anyone with
// properties may offer one; anyone may buy treasury shares, at any time
// except during an auction or a pause (canMakeAnytimeMove).
function renderCorporationOverview(corp) {
    const canAct = canMakeAnytimeMove();
    if (ShareDeals.isMerged(corp)) {
        const summary = corp.mergerSummary || {};
        const paid = [
            summary.newShares > 0 ? `${ShareDeals.count(summary.newShares)} ${corp.mergedInto?.ticker || ''} shares` : '',
            summary.cash > 0 ? formatMoney(summary.cash) : '',
        ].filter(Boolean).join(' and ');
        return `<p class="corp-status-warning">${escapeHtml(corp.ticker)} merged into ${escapeHtml(mergedIntoLabel(corp))}. Its properties, cash and loans moved there${paid ? `, and its owners got ${escapeHtml(paid)}` : ''}.</p>`;
    }
    if (ShareDeals.isInsolvent(corp)) {
        return '<p class="corp-status-warning">This corporation is closed after treasury insolvency. Properties returned to the Bank; shares, debt, and governance were wiped.</p>';
    }
    const runsIt = ShareDeals.runsCorporation(corp, currentUser.id);
    const hasProperties = (currentPlayerData?.properties || []).length > 0 && !currentPlayerData?.bankrupt;
    const addMove = runsIt && hasProperties
        ? `<button class="btn btn-secondary btn-sm" data-game-action="open-add-to-corporation" data-corp-id="${escapeHtml(corp.id)}"${canAct ? '' : ' disabled'}>Add properties${canAct ? '' : `<small>${anytimeMoveHoldNote()}</small>`}</button>`
        : '';
    const hasCash = Number(currentPlayerData?.cash || 0) > 0 && !currentPlayerData?.bankrupt;
    const addCashMove = runsIt && hasCash
        ? `<button class="btn btn-secondary btn-sm" data-game-action="open-add-cash-to-corporation" data-corp-id="${escapeHtml(corp.id)}">Add cash</button>`
        : '';
    const buyable = getBuyableListedShares(corp);
    const listed = getTreasuryListedShares(corp);
    const shareValue = getCorporationShareValue(corp);
    const buyHtml = canAct && buyable > 0
        ? `
            <div class="buy-shares-form">
                <label for="buyShares-${escapeHtml(corp.id)}">Buy ${escapeHtml(corp.ticker)} shares at ${ShareDeals.perShare(shareValue)} each</label>
                <input type="number" inputmode="numeric" id="buyShares-${escapeHtml(corp.id)}" data-corp-id="${escapeHtml(corp.id)}" min="1" max="${buyable}" placeholder="Up to ${ShareDeals.count(buyable)} (${ShareDeals.percent(buyable, corp.totalShares)})">
                <span class="corp-hint" id="buySharesTotal-${escapeHtml(corp.id)}" aria-live="polite"></span>
                <button class="btn btn-primary" data-game-action="buy-shares" data-corp-id="${escapeHtml(corp.id)}">Buy</button>
            </div>
        `
        : (listed > 0
            ? `<p class="corp-hint">${ShareDeals.count(listed)} shares for sale at ${ShareDeals.perShare(shareValue)} each.${currentGame.game_state.auction?.status === 'open' ? ' You can buy them once the auction closes.' : ''}</p>`
            : '');
    return `
        ${CorporationDesk.renderPropertyOffers(corp)}
        ${CorporationDesk.renderRentPolicy(corp)}
        ${CorporationDesk.renderRunnerTools(corp, addMove + addCashMove)}
        ${buyHtml ? `<div class="corp-buy"><h4>Shares</h4>${buyHtml}</div>` : ''}
        ${CorporationDesk.renderOfferButton(corp)}
    `;
}

function renderCorporationDetail(corp) {
    // No loans, no Debt tab.
    const hasDebt = (corp.debts || []).length > 0;
    const tabKeys = CORP_SHEET_TABS.filter(key => key !== 'debt' || hasDebt);
    const tab = tabKeys.includes(corpSheetTab) ? corpSheetTab : 'overview';
    const labels = {
        overview: ShareDeals.runsCorporation(corp, currentUser.id) ? 'Run it' : 'Overview',
        owners: 'Owners',
        assets: 'Properties',
        debt: 'Debt',
    };
    const tabs = tabKeys.map(key => `
        <button type="button" class="segmented-option" role="tab" data-corp-tab-button data-game-action="corporation-tab" data-tab="${key}" aria-selected="${key === tab}">${labels[key]}</button>
    `).join('');
    return `
        <div class="corp-detail" data-corp-id="${escapeHtml(corp.id)}" data-corp-tab="${tab}">
            <button type="button" class="corp-back" data-game-action="corporation-list">‹ All corporations</button>
            <div class="corp-detail-head">
                <div>
                    <h3 class="corp-detail-title">${escapeHtml(corp.ticker)}${corp.name && corp.name !== `${corp.ticker} Corporation` ? ` <span>${escapeHtml(corp.name)}</span>` : ''}</h3>
                    <p class="corp-summary-role">${escapeHtml(corporationRoleLine(corp))}</p>
                </div>
                ${ShareDeals.isClosed(corp) ? corporationStatusBadge(corp) : ''}
            </div>
            ${renderCorporationStats(corp)}
            <div class="segmented corp-tabs" role="tablist" aria-label="${escapeHtml(corp.ticker)}">${tabs}</div>
            <div class="corp-detail-cols">
                <div class="corp-col">
                    <section class="corp-panel" data-corp-panel="overview">${renderCorporationOverview(corp)}</section>
                </div>
                <div class="corp-col">
                    <section class="corp-panel" data-corp-panel="owners">${renderCorporationOwners(corp)}</section>
                    <section class="corp-panel" data-corp-panel="assets">${ShareDeals.isClosed(corp) ? '' : renderCorporationPanelMove(corp, CorporationDesk.buildButton(corp))}<h4>Properties <span class="corp-heading-note">${(corp.assets || []).length}</span></h4>${renderCorporationAssetGroups(Array.isArray(corp.assets) ? corp.assets : [])}</section>
                    ${hasDebt ? `<section class="corp-panel" data-corp-panel="debt"><h4>Debt</h4>${renderCorporationDebts(corp)}</section>` : ''}
                </div>
            </div>
        </div>
    `;
}

function renderChairmanGovernance(corp) {
    if (ShareDeals.isClosed(corp)) {
        return `
            <div class="chairman-governance">
                <h4>Chairman</h4>
                <p class="empty-state">${ShareDeals.isMerged(corp) ? 'Closed after the merger.' : 'Governance closed after insolvency.'}</p>
            </div>
        `;
    }
    const myShares = ShareDeals.sharesHeld(corp, currentUser.id);
    const openVotes = (corp.chairmanVotes || []).filter(vote => vote.status === 'open');
    const nameOf = player => (player.userId === currentUser.id ? 'You' : player.name);
    const optionsFor = candidates => candidates.map(player =>
        `<option value="${escapeHtml(player.userId)}">${escapeHtml(nameOf(player))}</option>`
    ).join('');
    // The chairman is never a candidate, and a candidate with an open vote
    // is backed with Support on that vote instead.
    const majorityCandidates = chairmanCandidateOptions(corp);
    const voteCandidates = majorityCandidates.filter(player => !openVotes.some(vote => vote.candidateUserId === player.userId));
    const openVotesHtml = openVotes.map(vote => {
        const supportedShares = voteSupportSharesUi(corp, vote);
        const alreadySupported = (vote.supporters || []).some(supporter => supporter.userId === currentUser.id);
        const canSupport = myShares > 0 && !alreadySupported;
        const candidate = vote.candidateUserId === currentUser.id ? 'You' : vote.candidateName;
        return `
            <div class="chairman-vote-row">
                <div>
                    <strong>${escapeHtml(candidate)}</strong>
                    <span>${ShareDeals.percent(supportedShares, corp.totalShares)} backing, needs over 50%</span>
                </div>
                ${canSupport ? `<button class="btn btn-primary btn-sm" data-game-action="support-chairman-vote" data-corp-id="${escapeHtml(corp.id)}" data-vote-id="${escapeHtml(vote.id)}">Support</button>` : ''}
            </div>
        `;
    }).join('');
    const majorityControl = hasMajoritySharesUi(corp, currentUser.id) && majorityCandidates.length ? `
                <div class="governance-control">
                    <label for="chairmanMajority-${escapeHtml(corp.id)}">Make chairman</label>
                    <select id="chairmanMajority-${escapeHtml(corp.id)}">${optionsFor(majorityCandidates)}</select>
                    <button class="btn btn-primary btn-sm" data-game-action="change-chairman-majority" data-corp-id="${escapeHtml(corp.id)}">Change Chairman</button>
                </div>
            ` : '';
    const voteControl = myShares > 0 && voteCandidates.length ? `
                <div class="governance-control">
                    <label for="chairmanVoteCandidate-${escapeHtml(corp.id)}">Vote for chairman</label>
                    <select id="chairmanVoteCandidate-${escapeHtml(corp.id)}">${optionsFor(voteCandidates)}</select>
                    <button class="btn btn-secondary btn-sm" data-game-action="propose-chairman-vote" data-corp-id="${escapeHtml(corp.id)}">Propose</button>
                </div>
            ` : '';
    if (!openVotesHtml && !majorityControl && !voteControl) return '';
    return `
        <div class="chairman-governance">
            <h4>Chairman <span class="corp-heading-note">needs over 50%</span></h4>
            ${majorityControl}
            ${voteControl}
            ${openVotesHtml ? `<div>${openVotesHtml}</div>` : ''}
        </div>
    `;
}

// Who could replace the chairman: the founder and every shareholder, never
// the chairman themself.
function chairmanCandidateOptions(corp) {
    const players = currentGame.game_state.players || [];
    return players.filter(player => player.userId !== corp.chairmanId && !player.bankrupt && (
        player.userId === corp.founderId ||
        ShareDeals.sharesHeld(corp, player.userId) > 0
    ));
}

function majorityHolderName(corp) {
    const holder = (corp.shareholders || []).find(shareholder => hasMajoritySharesUi(corp, shareholder.userId));
    return holder ? holder.name : null;
}

function hasMajoritySharesUi(corp, userId) {
    return ShareDeals.sharesHeld(corp, userId) > Number(corp.totalShares || 0) / 2;
}

function majorityThresholdUi(corp) {
    return Math.floor(Number(corp.totalShares || 0) / 2) + 1;
}

function voteSupportSharesUi(corp, vote) {
    return (vote.supporters || []).reduce((sum, supporter) => sum + ShareDeals.sharesHeld(corp, supporter.userId), 0);
}

async function changeChairmanByMajority(corpId) {
    const candidateUserId = document.getElementById(`chairmanMajority-${corpId}`).value;
    await submitGameAction('change_chairman', { corpId, candidateUserId }, {
        errorText: 'Failed to change chairman',
        onSaved: () => openCorporationModal(),
    });
}

async function proposeChairmanVote(corpId) {
    const candidateUserId = document.getElementById(`chairmanVoteCandidate-${corpId}`).value;
    await submitGameAction('propose_chairman_vote', { corpId, candidateUserId }, {
        errorText: 'Failed to propose chairman vote',
        onSaved: () => openCorporationModal(),
    });
}

async function supportChairmanVote(corpId, voteId) {
    await submitGameAction('support_chairman_vote', { corpId, voteId }, {
        errorText: 'Failed to support chairman vote',
        onSaved: () => openCorporationModal(),
    });
}

async function buyShares(corpId) {
    const gameState = currentGame.game_state;
    const corp = gameState.corporations.find(c => c.id === corpId);
    if (!corp) return;
    if (ShareDeals.isClosed(corp)) {
        alert('This corporation is closed and cannot sell shares.');
        return;
    }

    const numShares = parseInt(document.getElementById(`buyShares-${corpId}`).value);
    const buyableShares = getBuyableListedShares(corp);

    if (!numShares || numShares < 1 || numShares > buyableShares) {
        alert(`Enter a valid number of shares (1-${buyableShares})`);
        return;
    }

    await submitGameAction('buy_shares', { corpId, shares: numShares }, {
        errorText: 'Failed to buy shares',
        onSaved: () => closeModal('corporationModal'),
    });
}

// Adding your own properties to a company you run (add_to_corporation). The
// server decides the share count; this only previews it.
let addToCorpId = null;
let addToCorpChoice = 'shares'; // the player's pick; shown when shares are possible

function openAddToCorporationModal(corpId) {
    const gameState = currentGame?.game_state;
    const corp = gameState?.corporations?.find(item => item.id === corpId);
    if (!corp) return;
    addToCorpId = corp.id;
    closeModal('corporationModal');
    closeModal('ipoModal');
    document.getElementById('addToCorpTitle').textContent = `Add properties to ${corp.ticker}`;
    const container = document.getElementById('addToCorpAssets');
    container.innerHTML = addToCorporationAssetsHtml(currentPlayerData?.properties || [], 'add-corp-asset');
    container.dataset.html = addToCorporationAssetsHtml(currentPlayerData?.properties || [], 'add-corp-asset');
    bindBuiltGroupChecks(container);
    document.getElementById('addToCorpShares').innerHTML = '';
    addToCorpChoice = 'shares';
    renderAddToCorpChoices();
    openModal('addToCorpModal');
}

// Your properties as add-to-company checkboxes. A built group goes in whole,
// so its streets carry data-built-group (see bindBuiltGroupChecks).
// Shared by the Add properties sheet and the Market form.
function addToCorporationAssetsHtml(properties, idPrefix) {
    return properties.map(p => {
        const built = groupHasBuildingsUi(p.color);
        const note = built ? `Has buildings: goes in with the whole ${p.color} group` : '';
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${idPrefix}-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"${built ? ` data-built-group="${escapeHtml(p.color)}"` : ''}>
            <label for="${idPrefix}-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span>${note ? ` <span class="debt-detail">${escapeHtml(note)}</span>` : ''}</label>
        </div>
    `;
    }).join('') || '<p class="empty-state">You have no properties to add.</p>';
}

// Ticking one street of a built group ticks the whole group.
function bindBuiltGroupChecks(container) {
    container.querySelectorAll('input[data-built-group]').forEach(input => {
        input.addEventListener('change', () => {
            container.querySelectorAll(`input[data-built-group="${CSS.escape(input.dataset.builtGroup)}"]:not(:disabled)`).forEach(other => { other.checked = input.checked; });
        });
    });
}

function selectedAddToCorpIds() {
    return Array.from(document.querySelectorAll('#addToCorpAssets input:checked')).map(cb => cb.value);
}

function addToCorpOptions(extra = {}) {
    return { netAssetValue: getCorporationNetAssetValue, ...extra };
}

// "What do you get back?" for putting properties (ids) or cash into a company
// you run: radios named radioName, and whether new shares end up chosen.
// Shared by the Add properties sheet and the Market's trade and Send money forms.
// cash is null for properties, or the amount being paid in.
// options.title: false where a "You get back" heading already asks it.
function addToCorporationReturn(corp, ids, choice, radioName, cash = null, options = {}) {
    const quote = ShareDeals.contributionQuote(currentGame.game_state, corp, currentUser.id, ids, addToCorpOptions({ cash: cash || 0 }));
    const canIssue = (ids.length > 0 || cash > 0) && quote.newShares > 0;
    const picked = canIssue ? choice : 'gift';
    const sharesDetail = canIssue
        ? `${ShareDeals.count(quote.newShares)} share${quote.newShares === 1 ? '' : 's'}`
        : (quote.noSharesReason || '');
    // A gift moves value to the other holders: name them.
    const others = (corp.shareholders || [])
        .filter(holder => holder.userId !== currentUser.id && Number(holder.shares || 0) > 0)
        .map(holder => holder.name);
    const giftDetail = others.length ? `${ShareDeals.list(others)} gain${others.length === 1 ? 's' : ''} too.` : '';
    const small = text => (text ? `<small>${escapeHtml(text)}</small>` : '');
    return {
        issueShares: picked === 'shares',
        html: `
            ${options.title === false ? '' : '<p class="trade-destination-title">What do you get back?</p>'}
            <label class="trade-destination-option">
                <input type="radio" name="${radioName}" value="shares"${picked === 'shares' ? ' checked' : ''}${canIssue ? '' : ' disabled'}>
                <span><strong>New ${escapeHtml(corp.ticker)} shares</strong>${small(sharesDetail)}</span>
            </label>
            <label class="trade-destination-option">
                <input type="radio" name="${radioName}" value="gift"${picked === 'gift' ? ' checked' : ''}>
                <span><strong>Nothing, it's a gift</strong>${small(giftDetail)}</span>
            </label>
        `,
    };
}

function addToCorporationPreviewHtml(corp, ids, issueShares, cash = 0) {
    if (!ids.length && !(cash > 0)) return '';
    const summary = ShareDeals.summarizeContribution(currentGame.game_state, corp, currentUser.id, ids, issueShares, addToCorpOptions({ cash }));
    return renderShareDealSummary({ ...summary, sentences: [] });
}

// Redraws the "what do you get back" choice and the preview whenever the
// ticked properties or the choice change.
// The Add properties sheet after a game update: your properties may have
// changed, and the company's value moves the share count. Ticks are kept.
function refreshAddToCorporation() {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === addToCorpId);
    if (!corp || !ShareDeals.runsCorporation(corp, currentUser.id)) {
        closeModal('addToCorpModal');
        return;
    }
    const container = document.getElementById('addToCorpAssets');
    const ticked = new Set(selectedAddToCorpIds());
    const html = addToCorporationAssetsHtml(currentPlayerData?.properties || [], 'add-corp-asset');
    if (container.dataset.html !== html) {
        container.innerHTML = html;
        container.dataset.html = html;
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = ticked.has(input.value); });
        bindBuiltGroupChecks(container);
    }
    renderAddToCorpChoices();
}

function renderAddToCorpChoices(event) {
    if (event?.target?.name === 'addToCorpReturn') addToCorpChoice = event.target.value;
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === addToCorpId);
    if (!corp) return;
    const ids = selectedAddToCorpIds();
    const choice = addToCorporationReturn(corp, ids, addToCorpChoice, 'addToCorpReturn');
    document.getElementById('addToCorpShares').innerHTML = choice.html;
    const preview = document.getElementById('addToCorpPreview');
    preview.hidden = ids.length === 0;
    preview.innerHTML = addToCorporationPreviewHtml(corp, ids, choice.issueShares);
    document.getElementById('add-to-corp-btn').disabled = ids.length === 0;
}

async function submitAddToCorporation() {
    const assetIds = selectedAddToCorpIds();
    if (!addToCorpId || !assetIds.length) return;
    const issueShares = document.querySelector('#addToCorpShares input:checked')?.value === 'shares';
    await submitGameAction('add_to_corporation', { corpId: addToCorpId, assetIds, issueShares }, {
        errorText: 'Failed to add properties',
        onSaved: () => closeModal('addToCorpModal'),
    });
}

// Putting your own cash into a company you run, for new shares at today's
// value per share or as a gift: manual_payment with toCorpId and issueShares,
// the same as Market > Send money. Payments are allowed any time. The server
// decides the share count; this only previews it.
let addCashToCorpId = null;
let addCashToCorpChoice = 'shares';

function openAddCashToCorporationModal(corpId) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === corpId);
    if (!corp) return;
    addCashToCorpId = corp.id;
    closeModal('corporationModal');
    document.getElementById('addCashToCorpTitle').textContent = `Add cash to ${corp.ticker}`;
    const input = document.getElementById('addCashToCorpAmount');
    input.value = '';
    input.max = Math.max(0, Number(currentPlayerData?.cash || 0));
    document.getElementById('addCashToCorpMax').textContent = `(you have ${formatMoney(currentPlayerData?.cash || 0)})`;
    const shares = document.getElementById('addCashToCorpShares');
    shares.innerHTML = '';
    delete shares.dataset.html;
    addCashToCorpChoice = 'shares';
    renderAddCashToCorpChoices();
    openModal('addCashToCorpModal');
}

function addCashToCorpAmount() {
    return parseFloat(document.getElementById('addCashToCorpAmount')?.value) || 0;
}

// The Add cash sheet after a game update: your cash and the company's value
// may have moved. The amount typed is kept.
function refreshAddCashToCorporation() {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === addCashToCorpId);
    if (!corp || ShareDeals.isClosed(corp)) {
        closeModal('addCashToCorpModal');
        return;
    }
    document.getElementById('addCashToCorpAmount').max = Math.max(0, Number(currentPlayerData?.cash || 0));
    document.getElementById('addCashToCorpMax').textContent = `(you have ${formatMoney(currentPlayerData?.cash || 0)})`;
    renderAddCashToCorpChoices();
}

function renderAddCashToCorpChoices(event) {
    if (event?.target?.name === 'addCashToCorpReturn') addCashToCorpChoice = event.target.value;
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === addCashToCorpId);
    if (!corp) return;
    const amount = addCashToCorpAmount();
    const choice = addToCorporationReturn(corp, [], addCashToCorpChoice, 'addCashToCorpReturn', amount);
    const shares = document.getElementById('addCashToCorpShares');
    if (shares.dataset.html !== choice.html) {
        shares.innerHTML = choice.html;
        shares.dataset.html = choice.html;
    }
    const preview = document.getElementById('addCashToCorpPreview');
    preview.hidden = !(amount > 0);
    preview.innerHTML = addToCorporationPreviewHtml(corp, [], choice.issueShares, amount);
    const covered = amount <= Number(currentPlayerData?.cash || 0);
    document.getElementById('addCashToCorpAmount').setAttribute('aria-invalid', String(!covered));
    document.getElementById('add-cash-to-corp-btn').disabled = !(amount > 0) || !covered;
}

async function submitAddCashToCorporation() {
    const amount = addCashToCorpAmount();
    if (!addCashToCorpId || !(amount > 0)) return;
    const issueShares = document.querySelector('#addCashToCorpShares input:checked')?.value === 'shares';
    await submitGameAction('manual_payment', { fromPlayerId: currentUser.id, toCorpId: addCashToCorpId, amount, issueShares }, {
        errorText: 'Failed to add cash',
        onSaved: () => closeModal('addCashToCorpModal'),
    });
}
