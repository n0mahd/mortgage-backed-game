// The Market tab: the trade form (with its LLC share preview), pending trade offers,
// and sending money. Part of the game page; reads game.js's state.
// Offer buttons run via action-dispatcher.js.

function populatePlayerDropdowns() {
    const gameState = currentGame.game_state;

    const player1Select = document.getElementById('player1Select');
    const player2Select = document.getElementById('player2Select');
    const paymentFromPlayer = document.getElementById('paymentFromPlayer');
    const paymentToPlayer = document.getElementById('paymentToPlayer');
    if (!player1Select || !player2Select || !paymentFromPlayer || !paymentToPlayer) return;

    const playersHtml = gameState.players.map(p =>
        `<option value="${escapeHtml(p.userId)}">${escapeHtml(p.name)}</option>`
    ).join('');

    const previous = {
        player1: player1Select.value,
        player2: player2Select.value,
        paymentFrom: paymentFromPlayer.value,
        paymentTo: paymentToPlayer.value,
    };
    const firstOtherId = getFirstOtherPlayerId(currentUser.id) || gameState.players[0]?.userId || '';

    player1Select.innerHTML = playersHtml;
    player2Select.innerHTML = playersHtml;
    paymentFromPlayer.innerHTML = playersHtml;
    paymentToPlayer.innerHTML = playersHtml;

    setSelectValue(player1Select, previous.player1 || currentUser.id, currentUser.id);
    setSelectValue(player2Select, previous.player2 || firstOtherId, firstOtherId || currentUser.id);
    setSelectValue(paymentFromPlayer, currentUser.id, currentUser.id);
    setSelectValue(paymentToPlayer, previous.paymentTo || firstOtherId, firstOtherId || currentUser.id);
    paymentFromPlayer.disabled = true;
    enforceDistinctPlayers(player1Select, player2Select);
    enforceDistinctPlayers(paymentFromPlayer, paymentToPlayer);

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
        paymentToPlayer.addEventListener('change', () => {
            enforceDistinctPlayers(paymentFromPlayer, paymentToPlayer);
            updateMarketActionState();
        });
        paymentToPlayer.dataset.paymentBound = 'true';
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
    const selectId = playerNumber === 'player1' ? 'player1Select' : 'player2Select';
    const assetsId = playerNumber === 'player1' ? 'player1Assets' : 'player2Assets';

    const userId = document.getElementById(selectId).value;
    const player = gameState.players.find(p => p.userId === userId);

    if (!player) return;
    const container = document.getElementById(assetsId);
    // Game updates re-render this form; keep what the player already picked.
    const kept = container.dataset.playerId === userId ? {
        checked: new Set(Array.from(container.querySelectorAll('input:checked')).map(input => input.value)),
        shares: new Map(Array.from(container.querySelectorAll('.trade-share-input')).map(input => [input.dataset.corpId, input.value])),
    } : null;

    const assetsHtml = player.properties.map(p => `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="${playerNumber}-asset-${escapeHtml(p.id)}">${tradeAssetDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span></label>
        </div>
    `).join('');
    const jailCardHtml = player.hasGetOutOfJailCard ? `
        <div class="asset-checkbox">
            <input type="checkbox" id="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}" value="${GAME_JAIL_CARD_ASSET_ID}">
            <label for="${playerNumber}-asset-${GAME_JAIL_CARD_ASSET_ID}">Get Out of Jail Free card</label>
        </div>
    ` : '';

    const sharesHtml = (player.corporations || [])
        .filter(corp => Number(corp.sharesOwned || 0) > 0 && !corp.insolvent)
        .map(corp => {
            const inputId = `${playerNumber}-shares-${escapeHtml(corp.id)}`;
            return `
                <div class="asset-checkbox asset-shares">
                    <input type="number" class="trade-share-input" id="${inputId}" data-corp-id="${escapeHtml(corp.id)}" data-total-shares="${Number(corp.totalShares)}" min="0" max="${Number(corp.sharesOwned)}" step="1" value="0">
                    <label for="${inputId}">${escapeHtml(corp.ticker)} shares (holds ${Number(corp.sharesOwned)} of ${Number(corp.totalShares)})</label>
                    <span class="trade-share-pct" aria-live="polite"></span>
                </div>
            `;
        }).join('');

    container.innerHTML = (assetsHtml + sharesHtml + jailCardHtml) || '<p class="empty-state">No properties or shares to offer</p>';
    container.dataset.playerId = userId;
    if (kept) {
        container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = kept.checked.has(input.value); });
        container.querySelectorAll('.trade-share-input').forEach(input => {
            if (kept.shares.has(input.dataset.corpId)) input.value = kept.shares.get(input.dataset.corpId);
        });
    }
    container.querySelectorAll('.trade-share-input').forEach(updateTradeSharePercent);
    renderTradeDestination(playerNumber);
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
    const giver = gameState.players.find(p => p.userId === document.getElementById(`${playerNumber}Select`)?.value);
    const receiver = gameState.players.find(p => p.userId === document.getElementById(`${otherTradeSide(playerNumber)}Select`)?.value);
    const corps = giver && receiver && giver.userId !== receiver.userId && (giver.properties || []).length
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
        player1Id: document.getElementById('player1Select')?.value,
        player2Id: document.getElementById('player2Select')?.value,
        player1Cash: value('player1Cash'),
        player2Cash: value('player2Cash'),
        player1AssetIds: assets('player1Assets'),
        player2AssetIds: assets('player2Assets'),
        player1Shares: selectedTradeShares('player1Assets'),
        player2Shares: selectedTradeShares('player2Assets'),
        player1PropertiesToCorpId: selectedTradeDestination('player1'),
        player2PropertiesToCorpId: selectedTradeDestination('player2'),
    };
}

function summarizeShareDeal(terms) {
    return ShareDeals.summarize(currentGame.game_state, terms, currentUser.id, {
        netAssetValue: getCorporationNetAssetValue,
        jailCardId: GAME_JAIL_CARD_ASSET_ID,
    });
}

function tradeInvolvesLLC(terms) {
    return (terms.player1Shares || []).length > 0 || (terms.player2Shares || []).length > 0
        || (!!terms.player1PropertiesToCorpId && (terms.player1AssetIds || []).length > 0)
        || (!!terms.player2PropertiesToCorpId && (terms.player2AssetIds || []).length > 0);
}

function renderShareDealSummary(summary, options = {}) {
    const rows = summary.rows.map(row => `
        <tr><td>${escapeHtml(row.label)}</td><td class="${escapeHtml(row.tone || '')}">${escapeHtml(row.value)}</td></tr>
    `).join('');
    const even = options.showEven && summary.evenShares ? `
        <p class="share-deal-even">An even trade is ${summary.evenShares.shares} of ${summary.evenShares.total} ${escapeHtml(summary.evenShares.ticker)} shares (${escapeHtml(ShareDeals.percent(summary.evenShares.shares, summary.evenShares.total))}).
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

function renderTradePreview() {
    const preview = document.getElementById('tradePreview');
    if (!preview || !currentGame) return;
    const terms = collectTradeTerms();
    if (!tradeInvolvesLLC(terms)) {
        preview.hidden = true;
        preview.innerHTML = '';
        preview.dataset.html = '';
        return;
    }
    preview.hidden = false;
    // Only re-render on a real change, so a click on "Use N" isn't swallowed
    // when the share box's blur fires a change event first.
    const html = `<h4>Your offer</h4>${renderShareDealSummary(summarizeShareDeal(terms), { showEven: true })}`;
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

// From the Corporations modal: start a trade that puts one of your properties
// into this LLC in exchange for its shares.
function offerPropertyForShares(corpId) {
    const corp = currentGame?.game_state?.corporations?.find(item => item.id === corpId);
    if (!corp || !corp.chairmanId) return;
    closeModal('corporationModal');
    const marketTab = document.querySelector('.nav-tab[data-section="market"]');
    if (marketTab) showSection(marketTab, 'market');
    document.getElementById('player1Select').value = currentUser.id;
    document.getElementById('player2Select').value = corp.chairmanId;
    updatePlayerAssets('player1');
    updatePlayerAssets('player2');
    const radio = document.querySelector(`#player1Destination input[value="${CSS.escape(corp.id)}"]`);
    if (radio) radio.checked = true;
    updateMarketActionState();
    const shareInput = document.querySelector(`#player2Assets .trade-share-input[data-corp-id="${CSS.escape(corp.id)}"]`);
    showMarketStatus(`Tick the property you're offering, then enter how many ${corp.ticker} shares you want back.`, 'info');
    document.querySelector('#market .transaction-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const player1Id = document.getElementById('player1Select')?.value;
    const player2Id = document.getElementById('player2Select')?.value;
    const fromPlayerId = document.getElementById('paymentFromPlayer')?.value;
    const toPlayerId = document.getElementById('paymentToPlayer')?.value;
    const player1Cash = parseFloat(document.getElementById('player1Cash')?.value) || 0;
    const player2Cash = parseFloat(document.getElementById('player2Cash')?.value) || 0;
    const paymentAmount = parseFloat(document.getElementById('paymentAmount')?.value) || 0;
    const player1Assets = document.querySelectorAll('#player1Assets input:checked').length + selectedTradeShares('player1Assets').length;
    const player2Assets = document.querySelectorAll('#player2Assets input:checked').length + selectedTradeShares('player2Assets').length;

    const tradeHasOffer = player1Cash > 0 || player2Cash > 0 || player1Assets > 0 || player2Assets > 0;
    const tradeValid = player1Id && player2Id && player1Id !== player2Id && [player1Id, player2Id].includes(currentUser.id) && tradeHasOffer;
    const paymentValid = fromPlayerId && toPlayerId && fromPlayerId !== toPlayerId && fromPlayerId === currentUser.id && paymentAmount > 0;

    if (tradeBtn) tradeBtn.disabled = !tradeValid;
    if (paymentBtn) paymentBtn.disabled = !paymentValid;
    renderTradePreview();
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
    const offers = (currentGame.game_state.marketOffers || []).filter(offer => offer.status === 'pending');
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
                    <strong>${escapeHtml(offer.proposedByName)} proposed a trade</strong>
                    <div class="trade-offer-meta">
                        <span>${escapeHtml(formatTradeOfferAge(offer.createdAt))}</span>
                        ${offer.expiresAt ? `<span>${escapeHtml(formatTradeOfferExpiry(offer.expiresAt))}</span>` : ''}
                    </div>
                </div>
                ${tradeInvolvesLLC(offer) ? renderShareDealSummary(summarizeShareDeal(offer)) : ''}
                <div class="trade-offer-sides">
                    <div>
                        <h4>${escapeHtml(offer.player1Name)} gives</h4>
                        ${renderTradeOfferSide(offer.player1Cash, offer.player1AssetIds, offer.player1Shares, offer.player1PropertiesToCorpId)}
                    </div>
                    <div>
                        <h4>${escapeHtml(offer.player2Name)} gives</h4>
                        ${renderTradeOfferSide(offer.player2Cash, offer.player2AssetIds, offer.player2Shares, offer.player2PropertiesToCorpId)}
                    </div>
                </div>
                ${hasActions ? `
                    <div class="trade-offer-actions">
                        ${canAccept ? `<button class="btn btn-success btn-sm" data-game-action="accept-trade-offer" data-offer-id="${escapeHtml(offer.id)}">Accept</button>` : ''}
                        ${canCancel ? `<button class="btn btn-secondary btn-sm" data-game-action="cancel-trade-offer" data-offer-id="${escapeHtml(offer.id)}">${expired ? 'Clear Expired' : (canAccept ? 'Decline' : 'Cancel')}</button>` : ''}
                        ${canHostCancel ? `<button class="btn btn-danger btn-sm" data-game-action="host-cancel-trade-offer" data-offer-id="${escapeHtml(offer.id)}">${expired ? 'Clear Expired' : 'Host Cancel'}</button>` : ''}
                    </div>
                ` : `<p class="empty-state">${canClearExpired ? 'Clear this expired offer from the involved player view.' : 'Waiting on the involved players'}</p>`}
            </div>
        `;
    }).join('');
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

function tradeAssetDot(assetId) {
    const property = tradeAssetProperty(assetId);
    if (!property) return '';
    return `<span class="trade-asset-dot" style="--property-color:${escapeHtml(getPropertyColorValue(property.color))};" aria-hidden="true"></span>`;
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
    const terms = collectTradeTerms();
    const { player1Id, player2Id, player1Cash, player2Cash } = terms;
    const player1Assets = terms.player1AssetIds;
    const player2Assets = terms.player2AssetIds;
    const player1Shares = terms.player1Shares;
    const player2Shares = terms.player2Shares;

    if (player1Id === player2Id) {
        showMarketStatus('Choose two different players for a trade.', 'error');
        return;
    }
    if (![player1Id, player2Id].includes(currentUser.id)) {
        showMarketStatus('Your trade must include you.', 'error');
        return;
    }
    if (player1Cash <= 0 && player2Cash <= 0 && player1Assets.length === 0 && player2Assets.length === 0
        && player1Shares.length === 0 && player2Shares.length === 0) {
        showMarketStatus('Add cash, property, shares, or a Get Out of Jail Free card before proposing a trade.', 'error');
        return;
    }

    await submitGameAction('propose_trade', terms, {
        errorText: 'Failed to execute transaction.',
        showError: showMarketError,
        onSaved: () => {
            showMarketStatus('Trade proposal sent. It will execute when the other player accepts.', 'success');
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
    const fromPlayerId = document.getElementById('paymentFromPlayer').value;
    const toPlayerId = document.getElementById('paymentToPlayer').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);

    if (!amount || amount <= 0) {
        showMarketStatus('Enter a payment amount greater than $0.', 'error');
        return;
    }
    if (fromPlayerId === toPlayerId) {
        showMarketStatus('Choose a different recipient.', 'error');
        return;
    }
    if (fromPlayerId !== currentUser.id) {
        showMarketStatus('Payments must be sent from your player.', 'error');
        return;
    }

    await submitGameAction('manual_payment', { fromPlayerId, toPlayerId, amount }, {
        errorText: 'Failed to make payment.',
        showError: showMarketError,
        onSaved: () => {
            showMarketStatus('Payment completed successfully.', 'success');
            document.getElementById('paymentAmount').value = '';
            updateMarketActionState();
        },
    });
}
