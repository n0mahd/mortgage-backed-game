// LLCs (corporations) outside the chairman's desk: the IPO sheet, adding more
// properties to an LLC you run, and the Corporations sheet's listing, chairman
// governance and share buying. The chairman's tools inside that sheet (rent
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
        <small>Or add these properties to a company you already run:</small>
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

// Open Corporation Modal
async function openCorporationModal() {
    const gameState = currentGame.game_state;
    const isMyTurn = gameState.players[gameState.currentPlayerIndex].userId === currentUser.id;

    const corporationsHtml = gameState.corporations.map(corp => {
        const shareholders = Array.isArray(corp.shareholders) ? corp.shareholders : [];
        const assets = Array.isArray(corp.assets) ? corp.assets : [];
        const debts = Array.isArray(corp.debts) ? corp.debts : [];
        const myShares = shareholders.find(s => s.userId === currentUser.id);
        const treasuryListedShares = getTreasuryListedShares(corp);
        const isInsolvent = ShareDeals.isInsolvent(corp);
        const buyableShares = getBuyableListedShares(corp);
        const canBuy = isMyTurn && buyableShares > 0 && !isInsolvent;
        const governanceHtml = renderChairmanGovernance(corp);
        const hasProperties = (currentPlayerData?.properties || []).length > 0 && !currentPlayerData?.bankrupt;
        const runsIt = ShareDeals.runsCorporation(corp, currentUser.id);
        const canAddProperty = runsIt && hasProperties;
        const netAssetValue = getCorporationNetAssetValue(corp);
        const shareValue = getCorporationShareValue(corp);
        const shareholderRows = shareholders.length
            ? shareholders.map(s => `<li>${escapeHtml(s.name)}: ${ShareDeals.count(s.shares)} shares (${ownershipPercent(s.shares, corp.totalShares)}%)</li>`).join('')
            : '<li>No active shareholders</li>';
        const debtRows = debts.length
            ? debts.map(d => {
                const dueThisTurn = gameState.players[gameState.currentPlayerIndex]?.userId === corp.chairmanId;
                const status = LoanMath.loanStatus(d, { dueThisTurn });
                return `<li>${formatMoney(d.principal)}, ${escapeHtml(status.termLabel)}: ${escapeHtml(status.turnsLabel.toLowerCase())}. ${escapeHtml(LoanMath.paymentNote(d, dueThisTurn))}.</li>`;
            }).join('')
            : '<li>No corporation debt</li>';
        const listingDetails = treasuryListedShares > 0
            ? `<p>Treasury shares for sale: ${treasuryListedShares} at ${formatMoney(shareValue)} each (NAV)</p>`
            : '<p>No treasury shares for sale. To buy shares a player holds, make them an offer in the Market.</p>';
        const buyLabel = 'Buy treasury shares';

        return `
        <div class="corporation-card">
            <h3>${escapeHtml(corp.ticker)} - ${escapeHtml(corp.name)} ${isInsolvent ? '<span class="badge badge-danger">Insolvent</span>' : ''}</h3>
            <p>Founder: ${escapeHtml(corp.founderName)}</p>
            <p>Chairman: ${escapeHtml(isInsolvent ? 'Closed' : (corp.chairmanName || corp.founderName || 'Unassigned'))}</p>
            <p>Majority holder: ${escapeHtml(majorityHolderName(corp) || 'None')}</p>
            <p>Treasury Cash: $${Number(corp.cash || 0).toFixed(2)}</p>
            <p>Total Shares: ${ShareDeals.count(corp.totalShares)} | NAV: ${ShareDeals.perShare(shareValue)}/share</p>
            <p>Net Asset Value: $${netAssetValue.toFixed(2)}</p>
            ${listingDetails}
            ${isInsolvent ? '<p class="corp-status-warning">This corporation is closed after treasury insolvency. Properties returned to the Bank; shares, debt, and governance were wiped.</p>' : ''}
            ${CorporationDesk.renderRentPolicy(corp)}
            ${CorporationDesk.renderRunnerTools(corp)}
            ${CorporationDesk.renderPropertyOffers(corp)}
            <h4>Assets:</h4>
            <ul>
                ${assets.map(a => `<li>${propertyDot(a.id)}${escapeHtml(a.name)} ($${Number(a.value || 0).toFixed(2)})</li>`).join('') || '<li>No assets</li>'}
            </ul>
            <h4>Shareholders:</h4>
            <ul>
                ${shareholderRows}
            </ul>
            <h4>Debt:</h4>
            <ul>
                ${debtRows}
            </ul>
            ${governanceHtml}
            ${myShares ? `<p><strong>Your shares:</strong> ${myShares.shares}</p>` : ''}
            ${CorporationDesk.renderOfferButton(corp)}
            ${canAddProperty ? `
                <div class="offer-property-for-shares">
                    <button class="btn btn-success" data-game-action="open-add-to-corporation" data-corp-id="${escapeHtml(corp.id)}"${isMyTurn ? '' : ' disabled'}>Add properties to ${escapeHtml(corp.ticker)}</button>
                    <small>${isMyTurn ? `Move more of your properties into ${escapeHtml(corp.ticker)}.` : 'You can do this on your turn.'}</small>
                </div>
            ` : ''}
            ${canBuy ? `
                <div class="buy-shares-form">
                    <label for="buyShares-${escapeHtml(corp.id)}">${buyLabel} (up to ${buyableShares})</label>
                    <input type="number" inputmode="numeric" id="buyShares-${escapeHtml(corp.id)}" min="1" max="${buyableShares}" value="1">
                    <button class="btn btn-primary" data-game-action="buy-shares" data-corp-id="${escapeHtml(corp.id)}">Buy</button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('');

    document.getElementById('corporationList').innerHTML = corporationsHtml || '<p class="empty-state">No corporations yet. Create an IPO on your turn to start one.</p>';
    openModal('corporationModal');
}

function renderChairmanGovernance(corp) {
    if (ShareDeals.isInsolvent(corp)) {
        return `
            <div class="chairman-governance">
                <h4>Chairman Governance</h4>
                <p class="empty-state">Governance closed after insolvency.</p>
            </div>
        `;
    }
    const myShares = ShareDeals.sharesHeld(corp, currentUser.id);
    const candidates = chairmanCandidateOptions(corp);
    const voteOptions = candidates.map(player =>
        `<option value="${escapeHtml(player.userId)}">${escapeHtml(player.name)}</option>`
    ).join('');
    const required = majorityThresholdUi(corp);
    const openVotes = (corp.chairmanVotes || []).filter(vote => vote.status === 'open');
    const openVotesHtml = openVotes.length
        ? openVotes.map(vote => {
            const supportedShares = voteSupportSharesUi(corp, vote);
            const alreadySupported = (vote.supporters || []).some(supporter => supporter.userId === currentUser.id);
            const canSupport = myShares > 0 && !alreadySupported;
            return `
                <div class="chairman-vote-row">
                    <div>
                        <strong>${escapeHtml(vote.candidateName)}</strong>
                        <span>${ShareDeals.count(supportedShares)}/${ShareDeals.count(corp.totalShares)} shares supporting, ${ShareDeals.count(required)} needed</span>
                    </div>
                    ${canSupport ? `<button class="btn btn-primary btn-sm" data-game-action="support-chairman-vote" data-corp-id="${escapeHtml(corp.id)}" data-vote-id="${escapeHtml(vote.id)}">Support</button>` : ''}
                </div>
            `;
        }).join('')
        : '<p class="empty-state">No open chairman votes</p>';

    return `
        <div class="chairman-governance">
            <h4>Chairman Governance</h4>
            <p>Changing chairman requires ${ShareDeals.count(required)}/${ShareDeals.count(corp.totalShares)} shares.</p>
            ${hasMajoritySharesUi(corp, currentUser.id) ? `
                <div class="governance-control">
                    <label>Majority change:</label>
                    <select id="chairmanMajority-${escapeHtml(corp.id)}">${voteOptions}</select>
                    <button class="btn btn-primary btn-sm" data-game-action="change-chairman-majority" data-corp-id="${escapeHtml(corp.id)}">Change Chairman</button>
                </div>
            ` : ''}
            ${myShares > 0 ? `
                <div class="governance-control">
                    <label>Propose vote:</label>
                    <select id="chairmanVoteCandidate-${escapeHtml(corp.id)}">${voteOptions}</select>
                    <button class="btn btn-secondary btn-sm" data-game-action="propose-chairman-vote" data-corp-id="${escapeHtml(corp.id)}">Propose</button>
                </div>
            ` : ''}
            <div>
                ${openVotesHtml}
            </div>
        </div>
    `;
}

function chairmanCandidateOptions(corp) {
    const players = currentGame.game_state.players || [];
    return players.filter(player =>
        player.userId === corp.chairmanId ||
        player.userId === corp.founderId ||
        ShareDeals.sharesHeld(corp, player.userId) > 0
    );
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
        onSaved: openCorporationModal,
    });
}

async function proposeChairmanVote(corpId) {
    const candidateUserId = document.getElementById(`chairmanVoteCandidate-${corpId}`).value;
    await submitGameAction('propose_chairman_vote', { corpId, candidateUserId }, {
        errorText: 'Failed to propose chairman vote',
        onSaved: openCorporationModal,
    });
}

async function supportChairmanVote(corpId, voteId) {
    await submitGameAction('support_chairman_vote', { corpId, voteId }, {
        errorText: 'Failed to support chairman vote',
        onSaved: openCorporationModal,
    });
}

async function buyShares(corpId) {
    const gameState = currentGame.game_state;
    const corp = gameState.corporations.find(c => c.id === corpId);
    if (!corp) return;
    if (ShareDeals.isInsolvent(corp)) {
        alert('This corporation is insolvent and cannot sell shares.');
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
const MAX_CORPORATION_SHARES = 1000000;
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
    document.getElementById('addToCorpHint').textContent = `${corp.ticker} will own them and collect their rent, so every ${corp.ticker} share is worth more.`;
    const container = document.getElementById('addToCorpAssets');
    container.innerHTML = (currentPlayerData?.properties || []).map(p => {
        const built = groupHasBuildingsUi(p.color);
        const note = built ? `Has buildings: goes in with the whole ${p.color} group` : '';
        return `
        <div class="asset-checkbox">
            <input type="checkbox" id="add-corp-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"${built ? ` data-built-group="${escapeHtml(p.color)}"` : ''}>
            <label for="add-corp-asset-${escapeHtml(p.id)}">${propertyDot(p.id)}${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span>${note ? ` <span class="debt-detail">${escapeHtml(note)}</span>` : ''}</label>
        </div>
    `;
    }).join('') || '<p class="empty-state">You have no properties to add.</p>';
    // A built group goes in whole, so ticking one street ticks the group.
    container.querySelectorAll('input[data-built-group]').forEach(input => {
        input.addEventListener('change', () => {
            container.querySelectorAll(`input[data-built-group="${CSS.escape(input.dataset.builtGroup)}"]:not(:disabled)`).forEach(other => { other.checked = input.checked; });
        });
    });
    document.getElementById('addToCorpShares').innerHTML = '';
    addToCorpChoice = 'shares';
    renderAddToCorpChoices();
    openModal('addToCorpModal');
}

function selectedAddToCorpIds() {
    return Array.from(document.querySelectorAll('#addToCorpAssets input:checked')).map(cb => cb.value);
}

function addToCorpOptions() {
    return { netAssetValue: getCorporationNetAssetValue, maxShares: MAX_CORPORATION_SHARES };
}

// Redraws the "what do you get back" choice and the preview whenever the
// ticked properties or the choice change.
function renderAddToCorpChoices(event) {
    if (event?.target?.name === 'addToCorpReturn') addToCorpChoice = event.target.value;
    const gameState = currentGame?.game_state;
    const corp = gameState?.corporations?.find(item => item.id === addToCorpId);
    if (!corp) return;
    const ids = selectedAddToCorpIds();
    const quote = ShareDeals.contributionQuote(gameState, corp, currentUser.id, ids, addToCorpOptions());
    const choices = document.getElementById('addToCorpShares');
    if (quote.otherShares <= 0) {
        // Sole owner: the property just moves inside the company.
        choices.innerHTML = '';
    } else {
        const canIssue = ids.length > 0 && quote.newShares > 0;
        const choice = canIssue ? addToCorpChoice : 'gift';
        const sharesDetail = canIssue
            ? `${ShareDeals.count(quote.newShares)} new share${quote.newShares === 1 ? '' : 's'} at today's value per share, so the other holders' stakes keep their value.`
            : (quote.noSharesReason || 'Pick a property to see how many shares it is worth.');
        choices.innerHTML = `
            <p class="trade-destination-title">What do you get back?</p>
            <label class="trade-destination-option">
                <input type="radio" name="addToCorpReturn" value="shares"${choice === 'shares' ? ' checked' : ''}${canIssue ? '' : ' disabled'}>
                <span><strong>New ${escapeHtml(corp.ticker)} shares</strong><small>${escapeHtml(sharesDetail)}</small></span>
            </label>
            <label class="trade-destination-option">
                <input type="radio" name="addToCorpReturn" value="gift"${choice === 'gift' ? ' checked' : ''}>
                <span><strong>Nothing, it's a gift</strong><small>Every ${escapeHtml(corp.ticker)} share rises in value, including the other holders'.</small></span>
            </label>
        `;
    }
    const issueShares = choices.querySelector('input:checked')?.value === 'shares';
    const preview = document.getElementById('addToCorpPreview');
    preview.hidden = ids.length === 0;
    preview.innerHTML = ids.length
        ? `<h4>Before you confirm</h4>${renderShareDealSummary(ShareDeals.summarizeContribution(gameState, corp, currentUser.id, ids, issueShares, addToCorpOptions()))}`
        : '';
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
