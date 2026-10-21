// LLCs (corporations): the IPO sheet, the Corporations sheet, chairman votes and
// buying shares. Part of the game page; reads game.js's state.
// Buttons run via action-dispatcher.js.

// Open IPO Modal
async function openIPOModal() {
    const assetsHtml = currentPlayerData.properties.map(p => `
        <div class="asset-checkbox">
            <input type="checkbox" id="ipo-asset-${escapeHtml(p.id)}" value="${escapeHtml(p.id)}">
            <label for="ipo-asset-${escapeHtml(p.id)}">${escapeHtml(p.name)} <span class="debt-detail">${formatMoney(p.value)}</span></label>
        </div>
    `).join('');

    document.getElementById('ipoAssets').innerHTML = assetsHtml;
    openModal('ipoModal');
}

async function createIPO() {
    const ticker = document.getElementById('ipoTicker').value.toUpperCase();
    const numShares = parseInt(document.getElementById('ipoShares').value);
    const pricePerShare = parseFloat(document.getElementById('ipoPrice').value);

    if (!ticker || !numShares || !pricePerShare) {
        alert('Please fill in all fields');
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
        totalShares: numShares,
        pricePerShare,
        assetIds: selectedAssets.map(asset => asset.id),
    }, {
        errorText: 'Failed to create IPO',
        alwaysErrorText: true,
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
        const listedShares = getListedShares(corp);
        const treasuryListedShares = getTreasuryListedShares(corp);
        const founderListedShares = getFounderListedShares(corp);
        const isFounder = corp.founderId === currentUser.id;
        const isInsolvent = ShareDeals.isInsolvent(corp);
        const buyableShares = getBuyableListedShares(corp, currentUser.id);
        const canBuy = isMyTurn && buyableShares > 0 && !isInsolvent;
        const governanceHtml = renderChairmanGovernance(corp);
        const canOfferProperty = !isInsolvent && !!corp.chairmanId && corp.chairmanId !== currentUser.id
            && (currentPlayerData?.properties || []).length > 0 && !currentPlayerData?.bankrupt;
        const pricePerShare = Number(corp.pricePerShare || 0);
        const netAssetValue = getCorporationNetAssetValue(corp);
        const shareValue = getCorporationShareValue(corp);
        const shareholderRows = shareholders.length
            ? shareholders.map(s => `<li>${escapeHtml(s.name)}: ${s.shares} shares (${ownershipPercent(s.shares, corp.totalShares)}%)</li>`).join('')
            : '<li>No active shareholders</li>';
        const debtRows = debts.length
            ? debts.map(d => `<li>$${Number(d.principal || 0).toFixed(2)} @ ${Number(d.interestRate || 0)}% (interest next turn: $${interestPayment(d).toFixed(2)})</li>`).join('')
            : '<li>No corporation debt</li>';
        const listingDetails = listedShares > 0
            ? `<p>Listed Shares: ${listedShares} (${founderListedShares} founder, ${treasuryListedShares} treasury)</p>`
            : '<p>Listed Shares: 0</p>';
        const buyLabel = isFounder ? 'Buy treasury shares' : 'Buy listed shares';

        return `
        <div class="corporation-card">
            <h3>${escapeHtml(corp.ticker)} - ${escapeHtml(corp.name)} ${isInsolvent ? '<span class="badge badge-danger">Insolvent</span>' : ''}</h3>
            <p>Founder: ${escapeHtml(corp.founderName)}</p>
            <p>Chairman: ${escapeHtml(isInsolvent ? 'Closed' : (corp.chairmanName || corp.founderName || 'Unassigned'))}</p>
            <p>Majority holder: ${escapeHtml(majorityHolderName(corp) || 'None')}</p>
            <p>Treasury Cash: $${Number(corp.cash || 0).toFixed(2)}</p>
            <p>Total Shares: ${corp.totalShares} | Asking: $${pricePerShare.toFixed(2)}/share | NAV: $${shareValue.toFixed(2)}/share</p>
            <p>Net Asset Value: $${netAssetValue.toFixed(2)}</p>
            ${listingDetails}
            ${isInsolvent ? '<p class="corp-status-warning">This corporation is closed after treasury insolvency. Properties returned to the Bank; shares, debt, and governance were wiped.</p>' : ''}
            <h4>Assets:</h4>
            <ul>
                ${assets.map(a => `<li>${escapeHtml(a.name)} ($${Number(a.value || 0).toFixed(2)})</li>`).join('') || '<li>No assets</li>'}
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
            ${canOfferProperty ? `
                <div class="offer-property-for-shares">
                    <button class="btn btn-success" data-game-action="offer-property-for-shares" data-corp-id="${escapeHtml(corp.id)}">Offer a property for ${escapeHtml(corp.ticker)} shares</button>
                    <small>Put one of your properties into ${escapeHtml(corp.ticker)} in exchange for part of its ${Number(corp.totalShares || 0)} shares. ${escapeHtml(corp.chairmanName || 'The chairman')} has to accept.</small>
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
                        <span>${supportedShares}/${corp.totalShares} shares supporting, ${required} needed</span>
                    </div>
                    ${canSupport ? `<button class="btn btn-primary btn-sm" data-game-action="support-chairman-vote" data-corp-id="${escapeHtml(corp.id)}" data-vote-id="${escapeHtml(vote.id)}">Support</button>` : ''}
                </div>
            `;
        }).join('')
        : '<p class="empty-state">No open chairman votes</p>';

    return `
        <div class="chairman-governance">
            <h4>Chairman Governance</h4>
            <p>Changing chairman requires ${required}/${corp.totalShares} shares.</p>
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
        alwaysErrorText: true,
        onSaved: openCorporationModal,
    });
}

async function proposeChairmanVote(corpId) {
    const candidateUserId = document.getElementById(`chairmanVoteCandidate-${corpId}`).value;
    await submitGameAction('propose_chairman_vote', { corpId, candidateUserId }, {
        errorText: 'Failed to propose chairman vote',
        alwaysErrorText: true,
        onSaved: openCorporationModal,
    });
}

async function supportChairmanVote(corpId, voteId) {
    await submitGameAction('support_chairman_vote', { corpId, voteId }, {
        errorText: 'Failed to support chairman vote',
        alwaysErrorText: true,
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
    const totalCost = numShares * Number(corp.pricePerShare || 0);
    const buyableShares = getBuyableListedShares(corp, currentUser.id);

    if (!numShares || numShares < 1 || numShares > buyableShares) {
        alert(`Enter a valid number of shares (1-${buyableShares})`);
        return;
    }

    if (currentPlayerData.cash < totalCost) {
        alert(`Insufficient funds. Cost: $${totalCost.toFixed(2)}, You have: $${currentPlayerData.cash.toFixed(2)}`);
        return;
    }

    await submitGameAction('buy_shares', { corpId, shares: numShares }, {
        errorText: 'Failed to buy shares',
        onSaved: () => closeModal('corporationModal'),
    });
}
