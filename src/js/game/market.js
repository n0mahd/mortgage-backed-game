// The Market tab: the trade form (each side a player or a company; you and a
// company you run turns it into adding properties to that company), its LLC
// share preview, pending trade offers, and sending money (to a player or into a
// company, for new shares if you run it). Also the share-deal
// summary table that the add-to-corporation and offer sheets reuse.
// Part of the game page; reads game.js's state. Offer buttons run via action-dispatcher.js.

// Market dropdowns list the players, then the companies. A company's option
// value is "corp:<id>": picking it trades for (or pays) the company itself,
// and its runner acts for it.
const MARKET_CORP_PREFIX = 'corp:';

function marketPartyOptionsHtml(gameState, excludeUserId = null) {
    const players = gameState.players.filter(p => p.userId !== excludeUserId);
    const playersHtml = players.map(p => `<option value="${escapeHtml(p.userId)}">${escapeHtml(p.userId === currentUser.id ? `${p.name} (you)` : p.name)}</option>`).join('');
    const corps = (gameState.corporations || []).filter(corp => corp.chairmanId && !ShareDeals.isInsolvent(corp));
    if (!corps.length) return playersHtml;
    const corpsHtml = corps.map(corp => {
        const owner = ShareDeals.runsCorporation(corp, currentUser.id) ? 'your company' : `${corp.chairmanName || 'chairman'}'s company`;
        return `<option value="${escapeHtml(MARKET_CORP_PREFIX + corp.id)}">${escapeHtml(corp.ticker)} (${escapeHtml(owner)})</option>`;
    }).join('');
    return `<optgroup label="Players">${playersHtml}</optgroup><optgroup label="Companies">${corpsHtml}</optgroup>`;
}

// A dropdown value as { value, userId, player, corp }: for a company, userId
// is whoever acts for it (you, if you run it; otherwise its chairman).
function marketPartyFromValue(value) {
    const gameState = currentGame.game_state;
    const playerById = id => gameState.players.find(p => p.userId === id) || null;
    if (!String(value || '').startsWith(MARKET_CORP_PREFIX)) {
        return { value, userId: value || '', player: playerById(value), corp: null };
    }
    const corp = (gameState.corporations || []).find(item => item.id === value.slice(MARKET_CORP_PREFIX.length)) || null;
    const userId = !corp ? '' : (ShareDeals.runsCorporation(corp, currentUser.id) ? currentUser.id : corp.chairmanId);
    return { value, userId, player: playerById(userId), corp };
}

function tradeSide(side) {
    return marketPartyFromValue(document.getElementById(`${side}Select`)?.value || '');
}

function tradeSideCorp(side) {
    return tradeSide(side).corp;
}

// What the trade form does with its two sides: 'trade', 'add' (your own
// properties into a company you run, no one else involved), or 'invalid'
// with the reason.
function tradeFormMode() {
    const one = tradeSide('player1');
    const two = tradeSide('player2');
    const invalid = reason => ({ kind: 'invalid', reason, one, two });
    if (!one.player || !two.player) return invalid('Choose who gives on each side.');
    if (one.value === two.value) return invalid('Choose two different sides for a trade.');
    if (one.userId !== two.userId) {
        return [one.userId, two.userId].includes(currentUser.id) ? { kind: 'trade', one, two } : invalid('Your trade must include you.');
    }
    if (one.userId !== currentUser.id) return invalid('Your trade must include you.');
    if (!one.corp && two.corp) return { kind: 'add', corp: two.corp, one, two };
    if (one.corp && !two.corp) return invalid(`You run ${one.corp.ticker}, so it can't give you anything personally. Pay a dividend instead.`);
    return invalid(`You run both ${one.corp.ticker} and ${two.corp.ticker}, so they can't trade with each other.`);
}

function populatePlayerDropdowns() {
    const gameState = currentGame.game_state;

    const player1Select = document.getElementById('player1Select');
    const player2Select = document.getElementById('player2Select');
    const paymentFromPlayer = document.getElementById('paymentFromPlayer');
    const paymentToPlayer = document.getElementById('paymentToPlayer');
    if (!player1Select || !player2Select || !paymentFromPlayer || !paymentToPlayer) return;

    const previous = {
        player1: player1Select.value,
        player2: player2Select.value,
        paymentTo: paymentToPlayer.value,
    };
    const firstOtherId = getFirstOtherPlayerId(currentUser.id) || gameState.players[0]?.userId || '';

    player1Select.innerHTML = marketPartyOptionsHtml(gameState);
    player2Select.innerHTML = marketPartyOptionsHtml(gameState);
    paymentFromPlayer.innerHTML = gameState.players.map(p => `<option value="${escapeHtml(p.userId)}">${escapeHtml(p.name)}</option>`).join('');
    paymentToPlayer.innerHTML = marketPartyOptionsHtml(gameState, currentUser.id);

    setSelectValue(player1Select, previous.player1 || currentUser.id, currentUser.id);
    setSelectValue(player2Select, previous.player2 || firstOtherId, firstOtherId || currentUser.id);
    setSelectValue(paymentFromPlayer, currentUser.id, currentUser.id);
    setSelectValue(paymentToPlayer, previous.paymentTo || firstOtherId, firstOtherId);
    paymentFromPlayer.disabled = true;
    enforceDistinctPlayers(player1Select, player2Select);

    if (!player1Select.dataset.assetsBound) {
        player1Select.addEventListener('change', () => {
            enforceDistinctPlayers(player1Select, player2Select);
            updatePlayerAssets('player1');
            updatePlayerAssets('player2');
            updateMarketActionState();
        });
        player1Select.dataset.assetsBound = 'true';
    }
    if (!player2Select.dataset.assetsBound) {
        player2Select.addEventListener('change', () => {
            enforceDistinctPlayers(player2Select, player1Select);
            updatePlayerAssets('player1');
            updatePlayerAssets('player2');
            updateMarketActionState();
        });
        player2Select.dataset.assetsBound = 'true';
    }
    if (!paymentToPlayer.dataset.paymentBound) {
        paymentToPlayer.addEventListener('change', updateMarketActionState);
        paymentToPlayer.dataset.paymentBound = 'true';
    }
    const paymentReturn = document.getElementById('paymentReturn');
    if (paymentReturn && !paymentReturn.dataset.paymentBound) {
        paymentReturn.addEventListener('change', event => {
            if (event.target.name === 'paymentReturnChoice') paymentReturnChoice = event.target.value;
            updateMarketActionState();
        });
        paymentReturn.dataset.paymentBound = 'true';
    }
    ['player1Cash', 'player2Cash', 'paymentAmount'].forEach(id => {
        const input = document.getElementById(id);
        if (input && !input.dataset.marketBound) {
            input.addEventListener('input', updateMarketActionState);
            input.dataset.marketBound = 'true';
        }
    });

    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    renderTradeOffers();
    updateMarketActionState();
}

// From a company's card: trade for that company (corpId) or yourself.
function setTradingAs(side, userId, corpId) {
    const select = document.getElementById(`${side}Select`);
    if (!select) return;
    select.value = corpId ? MARKET_CORP_PREFIX + corpId : userId;
    enforceDistinctPlayers(select, document.getElementById(`${otherTradeSide(side)}Select`));
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    updateMarketActionState();
}

function setSelectValue(select, preferredValue, fallbackValue) {
    if (!select) return;
    const values = Array.from(select.options).map(option => option.value);
    if (values.includes(preferredValue)) {
        select.value = preferredValue;
    } else if (values.includes(fallbackValue)) {
        select.value = fallbackValue;
    } else if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

function getFirstOtherPlayerId(userId) {
    return currentGame?.game_state?.players?.find(player => player.userId !== userId)?.userId || null;
}

function enforceDistinctPlayers(primarySelect, secondarySelect) {
    if (!primarySelect || !secondarySelect || primarySelect.value !== secondarySelect.value) return;
    const replacement = Array.from(secondarySelect.options).find(option => option.value !== primarySelect.value);
    if (replacement) secondarySelect.value = replacement.value;
}

function updatePlayerAssets(playerNumber) {
    const gameState = currentGame.game_state;
    const assetsId = playerNumber === 'player1' ? 'player1Assets' : 'player2Assets';

    const { userId, player, corp } = tradeSide(playerNumber);

    if (!player) return;
    const container = document.getElementById(assetsId);
    const mode = tradeFormMode();
    if (mode.kind === 'add') {
        renderAddToCorporationSide(container, playerNumber, mode.corp);
        return;
    }
    const holderKey = corp ? `${userId}|${corp.id}` : userId;
    if (corp) {
        renderCorporationTradeAssets(container, playerNumber, corp, holderKey);
        renderTradeDestination(playerNumber);
        return;
    }
    // Game updates re-render this form; keep what the player already picked.
    const kept = container.dataset.playerId === holderKey ? {
        checked: new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value)),
        shares: new Map(Array.from(container.querySelectorAll('.trade-share-input')).map(input => [input.dataset.corpId, input.value])),
    } : null;

    // Streets in a built-up colour group can't be traded; show each such group
    // once, greyed out, with one note instead of repeating it on every street.
    const lockedGroups = new Map();
    player.properties.forEach(p => {
        if (!groupHasBuildingsUi(p.color)) return;
        if (!lockedGroups.has(p.color)) lockedGroups.set(p.color, []);
        lockedGroups.get(p.color).push(p);
    });
    const renderedGroups = new Set();
    const assetsHtml = player.properties.map(p => {
        if (lockedGroups.has(p.color)) {
            if (renderedGroups.has(p.color)) return '';
            renderedGroups.add(p.color);
            return `
        <div class="asset-locked-group">
            <p class="asset-locked-note">The ${escapeHtml(p.color)} group has buildings, so these can't be traded. IPO the group and sell shares instead.</p>
            ${lockedGroups.get(p.color).map(street => `
            <div class="asset-locked-row">${propertyDot(street.id)}${escapeHtml(street.name)}<span class="debt-detail">${formatMoney(street.value)}</span></div>`).join('')}
        </div>
    `;
        }
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="${playerNumber}-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span></label>
        </div>
    `;
    }).join('');
    const jailCardHtml = player.hasGetOutOfJailCard ? `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}" value="${GAME_JAIL_CARD_ASSET_ID}">
            <label for="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}">Get Out of Jail Free card</label>
        </div>
    ` : '';

    const sharesHtml = (player.corporations || [])
        .filter(corp => Number(corp.sharesOwned || 0) > 0 && !ShareDeals.isInsolvent(corp))
        .map(corp => {
            const inputId = `${playerNumber}-shares-${escapeHtml(corp.id)}`;
            return `
                <div class="asset-checkbox asset-shares">
                    <input type="number" class="trade-share-input" id="${inputId}" data-corp-id="${escapeHtml(corp.id)}" data-total-shares="${Number(corp.totalShares)}" min="0" max="${Number(corp.sharesOwned)}" step="1" value="0">
                    <label for="${inputId}">${escapeHtml(corp.ticker)} shares (holds ${ShareDeals.count(corp.sharesOwned)} of ${ShareDeals.count(corp.totalShares)})</label>
                    <span class="trade-share-pct" aria-live="polite"></span>
                </div>
            `;
        }).join('');

    container.innerHTML = (assetsHtml + sharesHtml + jailCardHtml) || '<p class="empty-state">No properties or shares to offer</p>';
    container.dataset.playerId = holderKey;
    if (kept) {
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = !input.disabled && kept.checked.has(input.value); });
        container.querySelectorAll('.trade-share-input').forEach(input => {
            if (kept.shares.has(input.dataset.corpId)) input.value = kept.shares.get(input.dataset.corpId);
        });
    }
    container.querySelectorAll('.trade-share-input').forEach(updateTradeSharePercent);
    renderTradeDestination(playerNumber);
}

// You give, to a company you run: your properties, as in the Add properties
// sheet (a built group goes in whole). The company's side shows what you get
// back, drawn by renderTradeAddReturn.
function renderAddToCorporationSide(container, playerNumber, corp) {
    if (playerNumber === 'player2') {
        container.innerHTML = '';
        container.dataset.playerId = '';
        return;
    }
    const holderKey = `add|${corp.id}`;
    const kept = container.dataset.playerId === holderKey
        ? new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value))
        : null;
    container.innerHTML = addToCorporationAssetsHtml(tradeSide(playerNumber).player?.properties || [], `${playerNumber}-asset`);
    container.dataset.playerId = holderKey;
    if (kept) container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = kept.has(input.value); });
    bindBuiltGroupChecks(container);
    document.getElementById(`${playerNumber}Destination`).innerHTML = '';
}

let tradeAddChoice = 'shares'; // "What do you get back?" when adding to your company
let paymentReturnChoice = 'shares'; // the same, for cash sent to your company

// Shows the form for a trade or for adding to your own company: headings,
// cash boxes, "What do you get back?" and the button.
function renderTradeFormMode(mode) {
    const adding = mode.kind === 'add';
    document.getElementById('player1Heading').textContent = adding ? 'You put in' : 'You give';
    document.getElementById('player2Heading').textContent = adding ? 'You get back' : 'They give';
    ['player1', 'player2'].forEach(side => {
        const group = document.getElementById(`${side}CashGroup`);
        if (group) group.hidden = adding;
    });
    const button = document.getElementById('executeTradeBtn');
    if (button) button.textContent = adding ? `Add to ${mode.corp.ticker}` : (activeTradeCounter() ? 'Send Counteroffer' : 'Propose Transaction');
    renderTradeCounterBanner();
    if (!adding) {
        // Both sides are you (you and a company you run): say why that can't work.
        if (mode.kind === 'invalid' && mode.one.player && mode.one.userId === mode.two.userId) {
            const destination = document.getElementById('player2Destination');
            destination.innerHTML = `<p class="hint">${escapeHtml(mode.reason)}</p>`;
            destination.dataset.html = '';
        }
        return null;
    }
    const picked = document.querySelector('#player2Destination input[name="tradeAddReturn"]:checked:not(:disabled)');
    if (picked && !document.querySelector('#player2Destination input[name="tradeAddReturn"]:disabled')) tradeAddChoice = picked.value;
    const ids = Array.from(document.querySelectorAll('#player1Assets input[type="checkbox"]:checked')).map(cb => cb.value);
    const choice = addToCorporationReturn(mode.corp, ids, tradeAddChoice, 'tradeAddReturn');
    const turnNote = isCurrentUsersTurn() ? '' : `<p class="hint">You can add properties to ${escapeHtml(mode.corp.ticker)} on your turn.</p>`;
    const destination = document.getElementById('player2Destination');
    const html = choice.html + turnNote;
    if (destination.dataset.html !== html) {
        destination.innerHTML = html;
        destination.dataset.html = html;
    }
    return { ids, issueShares: choice.issueShares, html: addToCorporationPreviewHtml(mode.corp, ids, choice.issueShares) };
}

// A company's side of a trade: the properties it owns (built groups stay put)
// and its own treasury shares.
function renderCorporationTradeAssets(container, playerNumber, corp, holderKey) {
    const gameState = currentGame.game_state;
    const kept = container.dataset.playerId === holderKey ? {
        checked: new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value)),
        shares: new Map(Array.from(container.querySelectorAll('.trade-share-input')).map(input => [input.dataset.corpId, input.value])),
    } : null;
    const props = gameState.properties.filter(p => p.ownerId === corp.id);
    const propsHtml = props.map(p => {
        const value = propertyAssetValue(p);
        if (groupHasBuildingsUi(p.color)) {
            return `<div class="asset-locked-row">${propertyDot(p.id)}${escapeHtml(p.name)}<span class="debt-detail">Built group: can't be traded</span></div>`;
        }
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="${playerNumber}-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(value)}</span></label>
        </div>`;
    }).join('');
    const treasury = Number(corp.treasuryShares || 0);
    const inputId = `${playerNumber}-shares-${escapeHtml(corp.id)}`;
    const sharesHtml = treasury > 0 ? `
        <div class="asset-checkbox asset-shares">
            <input type="number" class="trade-share-input" id="${inputId}" data-corp-id="${escapeHtml(corp.id)}" data-total-shares="${Number(corp.totalShares)}" min="0" max="${treasury}" step="1" value="0">
            <label for="${inputId}">${escapeHtml(corp.ticker)} treasury shares (has ${ShareDeals.count(treasury)} of ${ShareDeals.count(corp.totalShares)})</label>
            <span class="trade-share-pct" aria-live="polite"></span>
        </div>` : '';
    container.innerHTML = (propsHtml + sharesHtml) || `<p class="empty-state">${escapeHtml(corp.ticker)} has no properties or treasury shares to offer. It can still pay cash.</p>`;
    container.dataset.playerId = holderKey;
    if (kept) {
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = kept.checked.has(input.value); });
        container.querySelectorAll('.trade-share-input').forEach(input => {
            if (kept.shares.has(input.dataset.corpId)) input.value = kept.shares.get(input.dataset.corpId);
        });
    }
    container.querySelectorAll('.trade-share-input').forEach(updateTradeSharePercent);
}

// "= 25% of MBS" next to a share-count box.
function updateTradeSharePercent(input) {
    const label = input.parentElement?.querySelector('.trade-share-pct');
    if (!label) return;
    const shares = Math.floor(Number(input.value) || 0);
    label.textContent = shares > 0 ? `= ${ShareDeals.percent(shares, input.dataset.totalShares)}` : '';
}

function otherTradeSide(playerNumber) {
    return playerNumber === 'player1' ? 'player2' : 'player1';
}

// Lets a side put its properties into an LLC the other player runs, so a
// property can be traded for a stake in that LLC.
function renderTradeDestination(playerNumber) {
    const container = document.getElementById(`${playerNumber}Destination`);
    if (!container) return;
    const gameState = currentGame.game_state;
    const giverSide = tradeSide(playerNumber);
    const receiverSide = tradeSide(otherTradeSide(playerNumber));
    const giver = giverSide.player;
    const receiver = receiverSide.player;
    container.dataset.html = '';
    // A company side gives from, or receives into, its own books.
    const companySide = giverSide.corp || receiverSide.corp;
    const corps = !companySide && giver && receiver && giver.userId !== receiver.userId && (giver.properties || []).length
        ? ShareDeals.corporationsRunBy(gameState, receiver.userId)
        : [];
    const previous = container.dataset.receiverId === receiver?.userId ? selectedTradeDestination(playerNumber) : null;
    container.dataset.receiverId = receiver?.userId || '';
    if (!corps.length) {
        container.innerHTML = '';
        return;
    }
    const giverName = giver.userId === currentUser.id ? 'your' : `${giver.name}'s`;
    const option = (value, title, detail) => `
        <label class="trade-destination-option">
            <input type="radio" name="${playerNumber}-destination" value="${escapeHtml(value)}"${value === (previous || '') ? ' checked' : ''}>
            <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
        </label>
    `;
    container.innerHTML = `
        <p class="trade-destination-title">Where should ${escapeHtml(giverName)} properties go?</p>
        ${option('', `To ${receiver.name}`, `${receiver.name} owns them outright.`)}
        ${corps.map(corp => option(corp.id, `Into ${corp.ticker} (${receiver.name} runs it)`, `${corp.ticker} owns them and collects the rent, so every ${corp.ticker} share is worth more. Ask for ${corp.ticker} shares in return.`)).join('')}
    `;
}

function selectedTradeDestination(playerNumber) {
    return document.querySelector(`#${playerNumber}Destination input:checked`)?.value || null;
}

// The Market form as propose_trade terms.
function collectTradeTerms() {
    const value = id => parseFloat(document.getElementById(id)?.value) || 0;
    const assets = assetsId => Array.from(document.querySelectorAll(`#${assetsId} input[type="checkbox"]:checked`)).map(cb => cb.value);
    return {
        player1Id: tradeSide('player1').userId,
        player2Id: tradeSide('player2').userId,
        player1Cash: value('player1Cash'),
        player2Cash: value('player2Cash'),
        player1AssetIds: assets('player1Assets'),
        player2AssetIds: assets('player2Assets'),
        player1Shares: selectedTradeShares('player1Assets'),
        player2Shares: selectedTradeShares('player2Assets'),
        player1PropertiesToCorpId: selectedTradeDestination('player1'),
        player2PropertiesToCorpId: selectedTradeDestination('player2'),
        player1CorpId: tradeSideCorp('player1')?.id || null,
        player2CorpId: tradeSideCorp('player2')?.id || null,
        counterOfferId: activeTradeCounter()?.id || null,
    };
}

function summarizeShareDeal(terms) {
    return ShareDeals.summarize(currentGame.game_state, terms, currentUser.id, {
        netAssetValue: getCorporationNetAssetValue,
        jailCardId: GAME_JAIL_CARD_ASSET_ID,
    });
}

function tradeInvolvesLLC(terms) {
    // Company-side trades read plainly from the two "gives" columns.
    if (terms.player1CorpId || terms.player2CorpId) return false;
    return (terms.player1Shares || []).length > 0 || (terms.player2Shares || []).length > 0
        || (!!terms.player1PropertiesToCorpId && (terms.player1AssetIds || []).length > 0)
        || (!!terms.player2PropertiesToCorpId && (terms.player2AssetIds || []).length > 0);
}

function renderShareDealSummary(summary, options = {}) {
    const rows = summary.rows.map(row => `
        <tr><td>${escapeHtml(row.label)}</td><td class="${escapeHtml(row.tone || '')}">${escapeHtml(row.value)}</td></tr>
    `).join('');
    const even = options.showEven && summary.evenShares ? `
        <p class="share-deal-even">An even trade is ${ShareDeals.count(summary.evenShares.shares)} of ${ShareDeals.count(summary.evenShares.total)} ${escapeHtml(summary.evenShares.ticker)} shares (${escapeHtml(ShareDeals.percent(summary.evenShares.shares, summary.evenShares.total))}).
        <button type="button" class="btn btn-secondary btn-sm" data-game-action="use-even-shares">Use ${summary.evenShares.shares}</button></p>
    ` : '';
    return `
        <div class="share-deal-summary">
            ${summary.sentences.map(sentence => `<p class="share-deal-sentence">${escapeHtml(sentence)}</p>`).join('')}
            ${rows ? `<table class="share-deal-table">${rows}</table>` : ''}
            ${summary.warnings.map(warning => `<p class="share-deal-warning">${escapeHtml(warning)}</p>`).join('')}
            ${even}
        </div>
    `;
}

// The preview under the form: adding to your company, or a trade with an LLC
// in it. addPreview is renderTradeFormMode's result in add mode.
function renderTradePreview(addPreview) {
    const preview = document.getElementById('tradePreview');
    if (!preview || !currentGame) return;
    const terms = collectTradeTerms();
    let html = '';
    if (addPreview) html = addPreview.html;
    else if (tradeInvolvesLLC(terms)) html = `<h4>Your offer</h4>${renderShareDealSummary(summarizeShareDeal(terms), { showEven: true })}`;
    preview.hidden = !html;
    // Only re-render on a real change, so a click on "Use N" isn't swallowed
    // when the share box's blur fires a change event first.
    if (preview.dataset.html !== html) {
        preview.innerHTML = html;
        preview.dataset.html = html;
    }
}

// Fills the share box for the even split suggested in the preview.
function useEvenShares() {
    const terms = collectTradeTerms();
    const summary = summarizeShareDeal(terms);
    if (!summary.evenShares) return;
    const giverSide = terms.player1PropertiesToCorpId ? 'player2' : 'player1';
    const corpId = terms.player1PropertiesToCorpId || terms.player2PropertiesToCorpId;
    const input = document.querySelector(`#${giverSide}Assets .trade-share-input[data-corp-id="${CSS.escape(corpId)}"]`);
    if (!input) return;
    input.value = Math.min(summary.evenShares.shares, Number(input.max) || summary.evenShares.shares);
    updateTradeSharePercent(input);
    updateMarketActionState();
}

// Market panes: New trade, Send money, Trade proposals, Past transactions.
const MARKET_PANES = ['trade', 'payment', 'proposals', 'history'];
let marketPane = null;

function bindMarketTabs() {
    const tablist = document.querySelector('.market-tabs');
    if (!tablist) return;
    tablist.addEventListener('click', event => {
        const tab = event.target.closest('[data-market-pane]');
        if (tab) showMarketPane(tab.dataset.marketPane);
    });
    tablist.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = MARKET_PANES[(MARKET_PANES.indexOf(marketPane) + step + MARKET_PANES.length) % MARKET_PANES.length];
        showMarketPane(next);
        document.getElementById(`marketTab-${next}`)?.focus();
    });
}

function showMarketPane(name) {
    if (!MARKET_PANES.includes(name)) return;
    marketPane = name;
    MARKET_PANES.forEach(pane => {
        const selected = pane === name;
        const tab = document.getElementById(`marketTab-${pane}`);
        tab?.setAttribute('aria-selected', String(selected));
        tab?.setAttribute('tabindex', selected ? '0' : '-1');
        document.getElementById(`marketPane-${pane}`)?.toggleAttribute('hidden', !selected);
    });
}

// Opens the Market tab on one pane, from elsewhere on the page.
function openMarketPane(name) {
    const marketTab = document.querySelector('.nav-tab[data-section="market"]');
    if (marketTab) showSection(marketTab, 'market');
    showMarketPane(name);
}

function pendingTradeOffers() {
    return (currentGame?.game_state?.marketOffers || []).filter(offer => offer.status === 'pending');
}

function hasTradeOfferAwaitingMe() {
    return pendingTradeOffers().some(offer => offer.recipientId === currentUser?.id && !isTradeOfferExpiredForDisplay(offer));
}

// The Market opens on New trade, or on Trade proposals while an offer is waiting
// on you. Otherwise the pane only changes when the player picks one.
function updateMarketTabs(pendingOffers) {
    const count = document.getElementById('marketProposalsCount');
    if (count) {
        count.textContent = String(pendingOffers.length);
        count.hidden = pendingOffers.length === 0;
    }
    if (!marketPane) showMarketPane(hasTradeOfferAwaitingMe() ? 'proposals' : 'trade');
}

// Called when the Market tab is opened from the tab bar.
function openMarketOnWaitingOffer() {
    if (hasTradeOfferAwaitingMe()) showMarketPane('proposals');
}

// From the Corporations modal: start a trade that puts one of your properties
// into this LLC in exchange for its shares.
function offerPropertyForShares(corpId) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === corpId);
    if (!corp || !corp.chairmanId) return;
    closeModal('corporationModal');
    openMarketPane('trade');
    document.getElementById('player1Select').value = currentUser.id;
    document.getElementById('player2Select').value = corp.chairmanId;
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    const radio = document.querySelector(`#player1Destination input[value="${CSS.escape(corp.id)}"]`);
    if (radio) radio.checked = true;
    updateMarketActionState();
    const shareInput = document.querySelector(`#player2Assets .trade-share-input[data-corp-id="${CSS.escape(corp.id)}"]`);
    showMarketStatus(`Tick the property you're offering, then enter how many ${corp.ticker} shares you want back.`, 'info');
    document.querySelector('#market .market-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    shareInput?.focus({ preventScroll: true });
}

// Share lots entered in a trade side, as [{ corpId, shares }].
function selectedTradeShares(assetsId) {
    return Array.from(document.querySelectorAll(`#${assetsId} .trade-share-input`))
        .map(input => ({ corpId: input.dataset.corpId, shares: Math.floor(Number(input.value) || 0) }))
        .filter(lot => lot.shares > 0);
}

function updateMarketActionState() {
    const tradeBtn = document.getElementById('executeTradeBtn');
    const paymentBtn = document.getElementById('makePaymentBtn');
    const player1Cash = parseFloat(document.getElementById('player1Cash')?.value) || 0;
    const player2Cash = parseFloat(document.getElementById('player2Cash')?.value) || 0;
    const player1Assets = document.querySelectorAll('#player1Assets input:checked').length + selectedTradeShares('player1Assets').length;
    const player2Assets = document.querySelectorAll('#player2Assets input:checked').length + selectedTradeShares('player2Assets').length;

    const mode = tradeFormMode();
    const addPreview = renderTradeFormMode(mode);
    let tradeValid = false;
    if (mode.kind === 'add') {
        tradeValid = addPreview.ids.length > 0 && isCurrentUsersTurn();
    } else if (mode.kind === 'trade') {
        const tradeHasOffer = player1Cash > 0 || player2Cash > 0 || player1Assets > 0 || player2Assets > 0;
        const tradeCashCovered = ['player1', 'player2'].map(updateTradeCashLimit).every(Boolean);
        tradeValid = tradeHasOffer && tradeCashCovered;
    }
    if (tradeBtn) tradeBtn.disabled = !tradeValid;
    if (paymentBtn) paymentBtn.disabled = !renderPaymentReturn().valid;
    renderTradePreview(addPreview);
}

// Send money: who gets it, and for a company you run, "What do you get back?".
function paymentTerms() {
    const to = marketPartyFromValue(document.getElementById('paymentToPlayer')?.value || '');
    const amount = parseFloat(document.getElementById('paymentAmount')?.value) || 0;
    const runsIt = !!to.corp && ShareDeals.runsCorporation(to.corp, currentUser.id);
    const issueShares = runsIt && document.querySelector('#paymentReturn input:checked')?.value === 'shares';
    return { to, amount, runsIt, issueShares };
}

function renderPaymentReturn() {
    const container = document.getElementById('paymentReturn');
    const preview = document.getElementById('paymentPreview');
    const terms = paymentTerms();
    let html = '';
    let previewHtml = '';
    if (terms.runsIt) {
        const choice = addToCorporationReturn(terms.to.corp, [], paymentReturnChoice, 'paymentReturnChoice', terms.amount);
        html = choice.html;
        previewHtml = addToCorporationPreviewHtml(terms.to.corp, [], choice.issueShares, terms.amount);
    } else if (terms.to.corp) {
        html = `<p class="hint">Goes into the ${escapeHtml(terms.to.corp.ticker)} treasury as a gift: every ${escapeHtml(terms.to.corp.ticker)} share rises in value. For shares in return, offer ${escapeHtml(terms.to.player?.name || 'its chairman')} a trade.</p>`;
    }
    if (container && container.dataset.html !== html) {
        container.innerHTML = html;
        container.dataset.html = html;
    }
    if (preview) {
        preview.hidden = !previewHtml;
        if (preview.dataset.html !== previewHtml) {
            preview.innerHTML = previewHtml;
            preview.dataset.html = previewHtml;
        }
    }
    const recipient = terms.to.corp ? !ShareDeals.isInsolvent(terms.to.corp) : (!!terms.to.player && terms.to.userId !== currentUser.id);
    return { valid: recipient && terms.amount > 0 };
}

// The most cash a trade side's player can put in: what they hold, never below zero.
function tradeCashMax(side) {
    const { corp, player } = tradeSide(side);
    if (corp) return Math.max(0, Number(corp.cash) || 0);
    return Math.max(0, Number(player?.cash) || 0);
}

// Shows "(max $X)" next to a trade side's Cash and flags an amount above
// what that player holds. Returns whether the amount is covered.
function updateTradeCashLimit(side) {
    const input = document.getElementById(`${side}Cash`);
    const label = document.getElementById(`${side}CashMax`);
    if (!input || !label) return true;
    const max = tradeCashMax(side);
    const covered = (parseFloat(input.value) || 0) <= max;
    input.max = max;
    label.textContent = `(max ${formatMoney(max)})`;
    label.classList.toggle('is-over', !covered);
    input.setAttribute('aria-invalid', String(!covered));
    return covered;
}

function showMarketStatus(message, type = 'info') {
    const el = document.getElementById('market-status');
    if (!el) {
        showToast(message);
        return;
    }
    el.textContent = message;
    el.className = `market-status ${type}`;
}

function renderTradeOffers() {
    const container = document.getElementById('tradeOffersList');
    if (!container || !currentGame) return;
    const offers = pendingTradeOffers();
    dropClosedTradeCounter();
    renderPastTrades();
    updateMarketTabs(offers);
    if (offers.length === 0) {
        container.innerHTML = '<p class="empty-state">No pending trade offers</p>';
        return;
    }

    container.innerHTML = offers.map(offer => {
        const participant = [offer.player1Id, offer.player2Id].includes(currentUser.id);
        const expired = isTradeOfferExpiredForDisplay(offer);
        const canAccept = !expired && participant && offer.proposedById !== currentUser.id;
        const canCancel = participant;
        const isHost = isRoomHost();
        const canHostCancel = isHost && !canCancel;
        const canClearExpired = expired && (participant || isHost);
        const hasActions = canAccept || canCancel || canHostCancel;
        return `
            <div class="trade-offer-card${expired ? ' trade-offer-expired' : ''}">
                <div class="trade-offer-header">
                    <strong>${escapeHtml(offer.proposedByName)} ${offer.counterToOfferId ? 'sent a counteroffer' : 'proposed a trade'}</strong>
                    <div class="trade-offer-meta">
                        <span>${escapeHtml(formatTradeOfferAge(offer.createdAt))}</span>
                        ${offer.expiresAt ? `<span>${escapeHtml(formatTradeOfferExpiry(offer.expiresAt))}</span>` : ''}
                    </div>
                </div>
                ${tradeInvolvesLLC(offer) ? renderShareDealSummary(summarizeShareDeal(offer)) : ''}
                <div class="trade-offer-sides">
                    <div>
                        <h4>${escapeHtml(tradeSideName(offer, 'player1'))} gives</h4>
                        ${renderTradeOfferSide(offer.player1Cash, offer.player1AssetIds, offer.player1Shares, offer.player1PropertiesToCorpId)}
                    </div>
                    <div>
                        <h4>${escapeHtml(tradeSideName(offer, 'player2'))} gives</h4>
                        ${renderTradeOfferSide(offer.player2Cash, offer.player2AssetIds, offer.player2Shares, offer.player2PropertiesToCorpId)}
                    </div>
                </div>
                ${hasActions ? `
                    <div class="trade-offer-actions">
                        ${canAccept ? `<button class="btn btn-success btn-sm" data-game-action="accept-trade-offer" data-offer-id="${escapeHtml(offer.id)}">Accept</button>` : ''}
                        ${canAccept ? `<button class="btn btn-secondary btn-sm" data-game-action="counter-trade-offer" data-offer-id="${escapeHtml(offer.id)}">Counter</button>` : ''}
                        ${canCancel ? `<button class="btn btn-secondary btn-sm" data-game-action="cancel-trade-offer" data-offer-id="${escapeHtml(offer.id)}">${expired ? 'Clear Expired' : (canAccept ? 'Decline' : 'Cancel')}</button>` : ''}
                        ${canHostCancel ? `<button class="btn btn-danger btn-sm" data-game-action="host-cancel-trade-offer" data-offer-id="${escapeHtml(offer.id)}">${expired ? 'Clear Expired' : 'Host Cancel'}</button>` : ''}
                    </div>
                ` : `<p class="empty-state">${canClearExpired ? 'Clear this expired offer from the involved player view.' : 'Waiting on the involved players'}</p>`}
            </div>
        `;
    }).join('');
}

const PAST_TRADES_PAGE = 10;
let pastTradesFilter = 'mine'; // 'mine', 'all', or a player's userId
let pastTradesShown = PAST_TRADES_PAGE;

// Every resolved trade offer in the game, newest first, each with how it ended.
// The filter picks your trades (the default), everyone's, or one player's.
function renderPastTrades() {
    const container = document.getElementById('pastTradesList');
    if (!container || !currentGame) return;
    const players = currentGame.game_state.players || [];
    renderPastTradesFilter(players);
    const involves = (offer, userId) => offer.player1Id === userId || offer.player2Id === userId;
    const past = (currentGame.game_state.marketOffers || [])
        .filter(offer => offer.status !== 'pending')
        .filter(offer => pastTradesFilter === 'all' || involves(offer, pastTradesFilter === 'mine' ? currentUser.id : pastTradesFilter))
        .sort((a, b) => String(b.resolvedAt || b.createdAt || '').localeCompare(String(a.resolvedAt || a.createdAt || '')));
    if (past.length === 0) {
        const name = players.find(p => p.userId === pastTradesFilter)?.name;
        const empty = pastTradesFilter === 'mine' ? "You haven't been in any finished trades yet."
            : pastTradesFilter === 'all' ? 'No past trades yet.'
            : `${name || 'This player'} hasn't been in any finished trades yet.`;
        container.innerHTML = `<p class="empty-state">${escapeHtml(empty)}</p>`;
        return;
    }
    const shown = past.slice(0, pastTradesShown);
    container.innerHTML = shown.map(offer => {
        const outcome = pastTradeOutcome(offer);
        const when = offer.resolvedAt ? formatTimeAgo(offer.resolvedAt) : '';
        return `
            <div class="trade-offer-card trade-history-card">
                <div class="trade-history-header">
                    <strong>${escapeHtml(offer.proposedByName)} to ${escapeHtml(offer.recipientName)}</strong>
                    <span class="badge${outcome.badgeClass ? ` ${outcome.badgeClass}` : ''}">${escapeHtml(outcome.label)}</span>
                </div>
                <div class="trade-offer-meta">
                    <span>${escapeHtml(outcome.detail)}</span>
                    ${when ? `<span>${escapeHtml(when)}</span>` : ''}
                </div>
                <div class="trade-offer-sides">
                    <div>
                        <h4>${escapeHtml(tradeSideName(offer, 'player1'))} gives</h4>
                        ${renderTradeOfferSide(offer.player1Cash, offer.player1AssetIds, offer.player1Shares, offer.player1PropertiesToCorpId)}
                    </div>
                    <div>
                        <h4>${escapeHtml(tradeSideName(offer, 'player2'))} gives</h4>
                        ${renderTradeOfferSide(offer.player2Cash, offer.player2AssetIds, offer.player2Shares, offer.player2PropertiesToCorpId)}
                    </div>
                </div>
            </div>
        `;
    }).join('') + (past.length > shown.length ? `
        <div class="trade-history-more">
            <p>Showing ${shown.length} of ${past.length} trades.</p>
            <button type="button" class="btn btn-secondary btn-sm" data-game-action="show-more-past-trades">Show more</button>
        </div>` : '');
}

function renderPastTradesFilter(players) {
    const select = document.getElementById('pastTradesFilter');
    if (!select) return;
    if (pastTradesFilter !== 'mine' && pastTradesFilter !== 'all' && !players.some(p => p.userId === pastTradesFilter)) {
        pastTradesFilter = 'mine';
    }
    const options = [['mine', 'Your trades'], ['all', 'Everyone'],
        ...players.filter(p => p.userId !== currentUser.id).map(p => [p.userId, `${p.name}'s trades`])];
    const html = options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    if (select.dataset.html !== html) {
        select.innerHTML = html;
        select.dataset.html = html;
    }
    select.value = pastTradesFilter;
    if (!select.dataset.bound) {
        select.addEventListener('change', () => {
            pastTradesFilter = select.value;
            pastTradesShown = PAST_TRADES_PAGE;
            renderPastTrades();
        });
        select.dataset.bound = 'true';
    }
}

function showMorePastTrades() {
    pastTradesShown += PAST_TRADES_PAGE;
    renderPastTrades();
}

function pastTradeOutcome(offer) {
    if (offer.status === 'accepted') {
        return { label: 'Accepted', badgeClass: '', detail: `${offer.acceptedByName || offer.recipientName} accepted` };
    }
    if (offer.status === 'declined') {
        return { label: 'Declined', badgeClass: 'badge-danger', detail: `${offer.resolvedByName || offer.recipientName} declined` };
    }
    if (offer.status === 'countered') {
        return { label: 'Countered', badgeClass: 'badge-info', detail: `${offer.resolvedByName || offer.recipientName} countered` };
    }
    if (offer.status === 'expired') {
        return { label: 'Expired', badgeClass: 'badge-gold', detail: 'No answer in time' };
    }
    if (offer.cancelReason === 'host') {
        return { label: 'Canceled', badgeClass: 'badge-info', detail: 'Canceled by the host' };
    }
    if (offer.cancelReason === 'bankruptcy') {
        return { label: 'Canceled', badgeClass: 'badge-info', detail: `Canceled when ${offer.resolvedByName || 'a player'} went bankrupt` };
    }
    return { label: 'Canceled', badgeClass: 'badge-info', detail: `${offer.resolvedByName || offer.proposedByName} canceled` };
}

function tradeSideName(offer, side) {
    const ticker = offer[`${side}CorpTicker`];
    const name = offer[`${side}Name`];
    return ticker ? `${ticker} (via ${name})` : name;
}

function renderTradeOfferSide(cash, assetIds, shareLots, intoCorpId) {
    const intoCorp = intoCorpId ? currentGame?.game_state?.corporations?.find(corp => corp.id === intoCorpId) : null;
    const tags = [];
    if (Number(cash || 0) > 0) {
        tags.push(renderTradeAssetTag(formatMoney(cash), 'Cash', 'cash'));
    }
    sortTradeAssetIds(assetIds).forEach(id => {
        const property = tradeAssetProperty(id);
        if (!property) {
            tags.push(renderTradeAssetTag(tradeAssetName(id), id === GAME_JAIL_CARD_ASSET_ID ? 'Card' : '', 'card'));
            return;
        }
        const group = intoCorp ? `Into ${intoCorp.ticker}` : (property.color || 'Property');
        tags.push(renderTradeAssetTag(property.name, group, 'property', getPropertyColorValue(property.color)));
    });
    (shareLots || []).forEach(lot => {
        tags.push(renderTradeAssetTag(tradeSharesName(lot), 'LLC shares', 'shares'));
    });
    if (tags.length === 0) return '<p class="empty-state">Nothing</p>';
    return `<ul class="trade-asset-list">${tags.join('')}</ul>`;
}

function renderTradeAssetTag(name, groupLabel, kind, color) {
    const style = color ? ` style="--property-color:${escapeHtml(color)};"` : '';
    return `
        <li class="trade-asset-tag ${kind}"${style}>
            <span class="trade-asset-name">${escapeHtml(name)}</span>
            ${groupLabel ? `<span class="trade-asset-group">${escapeHtml(groupLabel)}</span>` : ''}
        </li>
    `;
}

// Board order keeps each color group together in an offer.
function sortTradeAssetIds(assetIds) {
    return [...(assetIds || [])].sort((a, b) => getPropertyBoardPosition(a) - getPropertyBoardPosition(b));
}

function tradeAssetProperty(assetId) {
    return currentGame?.game_state?.properties?.find(prop => prop.id === assetId) || null;
}

function tradeAssetName(assetId) {
    if (assetId === GAME_JAIL_CARD_ASSET_ID) return 'Get Out of Jail Free card';
    const property = tradeAssetProperty(assetId);
    return property ? property.name : assetId;
}

function tradeSharesName(lot) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === lot.corpId);
    const shares = Number(lot.shares || 0);
    return `${shares} ${corp ? corp.ticker : 'LLC'} share${shares === 1 ? '' : 's'}`;
}

function formatTradeOfferAge(createdAt) {
    if (!createdAt) return 'pending';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 'pending';
    return `sent ${formatTimeAgo(createdAt)}`;
}

function formatTradeOfferExpiry(expiresAt) {
    const seconds = secondsUntil(expiresAt);
    if (seconds === null) return '';
    if (seconds <= 0) return 'expired';
    if (seconds < 60) return `expires in ${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    return `expires in ${minutes}m`;
}

function isTradeOfferExpiredForDisplay(offer) {
    return secondsUntil(offer?.expiresAt) === 0;
}

function actionEventsInclude(result, type) {
    return Array.isArray(result?.events) && result.events.some(event => event.type === type);
}

function showMarketError(message) {
    showMarketStatus(message, 'error');
}

// Countering: the trade form opens with an offer's terms, your side under You give.
// Sending it closes the original as countered (propose_trade with counterOfferId).
let tradeCounterOfferId = null;

function tradeOfferById(offerId) {
    return (currentGame?.game_state?.marketOffers || []).find(offer => offer.id === offerId) || null;
}

// The offer being countered, while the form is still between the same two players.
function activeTradeCounter() {
    const offer = tradeCounterOfferId ? tradeOfferById(tradeCounterOfferId) : null;
    if (!offer || offer.status !== 'pending') return null;
    const formPlayers = [tradeSide('player1').userId, tradeSide('player2').userId].sort().join('|');
    return formPlayers === [offer.player1Id, offer.player2Id].sort().join('|') ? offer : null;
}

function counterTradeOffer(offerId) {
    const offer = tradeOfferById(offerId);
    if (!offer || offer.status !== 'pending') {
        showMarketError('That offer is no longer open.');
        return;
    }
    const mine = offer.player1Id === currentUser.id ? 'player1' : 'player2';
    const theirs = otherTradeSide(mine);
    const partyValue = side => (offer[`${side}CorpId`] ? MARKET_CORP_PREFIX + offer[`${side}CorpId`] : offer[`${side}Id`]);
    setSelectValue(document.getElementById('player1Select'), partyValue(mine), currentUser.id);
    setSelectValue(document.getElementById('player2Select'), partyValue(theirs), offer.proposedById);
    ['player1', 'player2'].forEach(side => {
        document.getElementById(`${side}Assets`).dataset.playerId = '';
        document.getElementById(`${side}Destination`).dataset.receiverId = '';
    });
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    [['player1', mine], ['player2', theirs]].forEach(([formSide, offerSide]) => {
        document.getElementById(`${formSide}Cash`).value = Number(offer[`${offerSide}Cash`] || 0);
        (offer[`${offerSide}AssetIds`] || []).forEach(id => {
            const box = document.getElementById(`${formSide}-asset-${id}`);
            if (box && !box.disabled) box.checked = true;
        });
        (offer[`${offerSide}Shares`] || []).forEach(lot => {
            const input = document.querySelector(`#${formSide}Assets .trade-share-input[data-corp-id="${CSS.escape(lot.corpId)}"]`);
            if (input) input.value = Number(lot.shares || 0);
        });
        document.querySelectorAll(`#${formSide}Assets .trade-share-input`).forEach(updateTradeSharePercent);
        const intoCorpId = offer[`${offerSide}PropertiesToCorpId`] || '';
        const destination = document.querySelector(`#${formSide}Destination input[value="${CSS.escape(intoCorpId)}"]`);
        if (destination) destination.checked = true;
    });
    tradeCounterOfferId = offer.id;
    showMarketPane('trade');
    updateMarketActionState();
    showMarketStatus('');
    document.querySelector('#market .market-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stopTradeCounter() {
    tradeCounterOfferId = null;
    resetTradeForm();
    showMarketStatus('');
}

// The offer closed (accepted elsewhere, withdrawn, expired) while you were countering.
function dropClosedTradeCounter() {
    if (!tradeCounterOfferId) return;
    const offer = tradeOfferById(tradeCounterOfferId);
    if (offer && offer.status === 'pending') return;
    tradeCounterOfferId = null;
    renderTradeCounterBanner();
    // Your own counter just closed it; the send confirms that.
    if (offer?.status === 'countered' && offer.resolvedById === currentUser.id) return;
    const whose = offer?.proposedByName ? `${offer.proposedByName}'s offer` : 'That offer';
    showMarketStatus(`${whose} is no longer open, so sending this makes a new trade proposal.`, 'info');
}

function renderTradeCounterBanner() {
    const banner = document.getElementById('tradeCounterBanner');
    if (!banner) return;
    const offer = activeTradeCounter();
    banner.hidden = !offer;
    if (!offer) return;
    banner.querySelector('.trade-counter-text').textContent = `Countering ${offer.proposedByName}'s offer. Change the terms below and send it back. Their offer stays open until you do.`;
}

async function acceptTradeOffer(offerId) {
    await submitGameAction('accept_trade', { offerId }, {
        errorText: 'Failed to accept trade offer.',
        showError: showMarketError,
        onSaved: result => {
            if (actionEventsInclude(result, 'trade_offer_expired')) {
                showMarketStatus('Trade offer expired before it could be accepted.', 'error');
            } else {
                showMarketStatus('Trade accepted and executed.', 'success');
            }
        },
    });
}

async function cancelTradeOffer(offerId) {
    await submitGameAction('cancel_trade', { offerId }, {
        errorText: 'Failed to update trade offer.',
        showError: showMarketError,
        onSaved: result => showMarketStatus(actionEventsInclude(result, 'trade_offer_expired')
            ? 'Trade offer expired and was cleared.'
            : 'Trade offer updated.', 'success'),
    });
}

async function hostCancelTradeOffer(offerId) {
    if (!confirm('Cancel this trade offer as host? No cash or properties will move.')) return;
    await submitGameAction('host_cancel_trade_offer', { offerId }, {
        errorText: 'Failed to cancel trade offer.',
        showError: showMarketError,
        onSaved: result => showMarketStatus(actionEventsInclude(result, 'trade_offer_expired')
            ? 'Trade offer expired and was cleared.'
            : 'Trade offer canceled by host.', 'success'),
    });
}

async function executeTransaction() {
    const mode = tradeFormMode();
    if (mode.kind === 'add') {
        await submitTradeAddToCorporation(mode.corp);
        return;
    }
    if (mode.kind === 'invalid') {
        showMarketStatus(mode.reason, 'error');
        return;
    }
    const terms = collectTradeTerms();
    if (terms.player1Cash <= 0 && terms.player2Cash <= 0 && terms.player1AssetIds.length === 0 && terms.player2AssetIds.length === 0
        && terms.player1Shares.length === 0 && terms.player2Shares.length === 0) {
        showMarketStatus('Add cash, property, shares, or a Get Out of Jail Free card before proposing a trade.', 'error');
        return;
    }
    const short = ['player1', 'player2'].find(side => terms[`${side}Cash`] > tradeCashMax(side));
    if (short) {
        const name = tradeSideCorp(short)?.ticker || tradeSide(short).player?.name || 'That player';
        showMarketStatus(`${name} only has ${formatMoney(tradeCashMax(short))} in cash.`, 'error');
        return;
    }

    await submitGameAction('propose_trade', terms, {
        errorText: 'Failed to execute transaction.',
        showError: showMarketError,
        onSaved: () => {
            const countered = terms.counterOfferId ? tradeOfferById(terms.counterOfferId) : null;
            tradeCounterOfferId = null;
            showMarketPane('proposals');
            showMarketStatus(countered
                ? `Counteroffer sent to ${countered.proposedByName}. Their original offer is closed as countered.`
                : 'Trade proposal sent. It will execute when the other player accepts.', 'success');
            resetTradeForm();
        },
    });
}

// You give, to a company you run: add_to_corporation, which needs no one's
// agreement (the same as the Add properties sheet).
async function submitTradeAddToCorporation(corp) {
    const assetIds = Array.from(document.querySelectorAll('#player1Assets input[type="checkbox"]:checked')).map(cb => cb.value);
    if (!assetIds.length) {
        showMarketStatus(`Tick the properties to put into ${corp.ticker}.`, 'error');
        return;
    }
    const issueShares = document.querySelector('#player2Destination input[name="tradeAddReturn"]:checked')?.value === 'shares';
    await submitGameAction('add_to_corporation', { corpId: corp.id, assetIds, issueShares }, {
        errorText: `Failed to add properties to ${corp.ticker}.`,
        showError: showMarketError,
        onSaved: () => {
            showMarketStatus(`Added to ${corp.ticker}.`, 'success');
            resetTradeForm();
        },
    });
}

function resetTradeForm() {
    document.getElementById('player1Cash').value = 0;
    document.getElementById('player2Cash').value = 0;
    ['player1', 'player2'].forEach(side => {
        document.getElementById(`${side}Assets`).dataset.playerId = '';
        document.getElementById(`${side}Destination`).dataset.receiverId = '';
    });
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    updateMarketActionState();
}

async function makePayment() {
    const { to, amount, issueShares } = paymentTerms();
    if (!amount || amount <= 0) {
        showMarketStatus('Enter a payment amount greater than $0.', 'error');
        return;
    }
    if (!to.corp && (!to.player || to.userId === currentUser.id)) {
        showMarketStatus('Choose a different recipient.', 'error');
        return;
    }
    const payload = to.corp
        ? { fromPlayerId: currentUser.id, toCorpId: to.corp.id, amount, issueShares }
        : { fromPlayerId: currentUser.id, toPlayerId: to.userId, amount };

    await submitGameAction('manual_payment', payload, {
        errorText: 'Failed to make payment.',
        showError: showMarketError,
        onSaved: () => {
            showMarketStatus(to.corp ? `Paid into ${to.corp.ticker}.` : 'Payment completed successfully.', 'success');
            document.getElementById('paymentAmount').value = '';
            updateMarketActionState();
        },
    });
}
