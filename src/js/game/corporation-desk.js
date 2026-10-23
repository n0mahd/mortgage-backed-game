// Running a corporation from the Corporations sheet: rent policy, dividends,
// spending the treasury, and property offers (anyone offers a property; the
// chairman accepts, declines or counters).
//
// Classic browser script. It renders HTML for openCorporationModal() and
// handles its buttons, calling game.js globals (currentGame, currentUser,
// submitGameAction, escapeHtml, formatMoney, ...) at click time. The server
// stays the authority; numbers here are previews.
(function (global) {
    'use strict';

    function state() {
        return currentGame?.game_state || null;
    }

    function me() {
        return currentUser?.id || null;
    }

    function corpById(corpId) {
        return (state()?.corporations || []).find(corp => corp.id === corpId) || null;
    }

    function policyOf(corp) {
        return corp.rentPolicy === 'payout' ? 'payout' : 'reinvest';
    }

    function isMyTurn() {
        const gameState = state();
        return !!gameState && gameState.players[gameState.currentPlayerIndex]?.userId === me();
    }

    // Mirrors the engine: doubles leave diceRolled false, but lastDiceRoll is set.
    function hasRolled() {
        const gameState = state();
        const mine = gameState?.players.find(p => p.userId === me());
        return !!mine?.diceRolled || Array.isArray(gameState?.lastDiceRoll);
    }

    function money(value) {
        return global.formatMoney(Number(value || 0));
    }

    function esc(value) {
        return global.escapeHtml(value);
    }

    function offerOptions(extra = {}) {
        return { netAssetValue: global.getCorporationNetAssetValue, maxShares: MAX_CORPORATION_SHARES, ...extra };
    }

    // ---- Rent policy ------------------------------------------------------

    function renderRentPolicy(corp) {
        if (global.ShareDeals.isInsolvent(corp)) return '';
        const policy = policyOf(corp);
        const runs = global.ShareDeals.runsCorporation(corp, me());
        const total = Number(corp.totalShares || 0);
        const mine = global.ShareDeals.sharesHeld(corp, me());
        const pct = global.ShareDeals.percent(mine, total);
        const effect = policy === 'payout'
            ? (mine > 0
                ? `Rent goes straight to shareholders. You hold ${pct}, so on ${corp.ticker}'s properties you pay only the other ${global.ShareDeals.percent(total - mine, total)} of the rent.`
                : 'Rent goes straight to the shareholders, split by shares.')
            : `Everyone pays full rent into the ${corp.ticker} treasury, shareholders included. ${mine > 0 ? `Your ${pct} stake grows with it.` : ''}`;
        const other = policy === 'payout' ? 'reinvest' : 'payout';
        const otherLabel = other === 'payout' ? 'Payout' : 'Reinvest';
        const lockedTurns = Number(corp.rentPolicyLockedTurns || 0);
        const lockLine = lockedTurns > 0
            ? `<small>The chairman can't change it alone for ${lockedTurns} more of their turns. Every shareholder agreeing changes it at once.</small>`
            : '';
        let controls = '';
        if (runs && !corp.rentPolicyVote) {
            const canSwitch = isMyTurn() && !hasRolled() && lockedTurns === 0;
            const note = lockedTurns > 0 ? 'Locked after the last change. Ask the shareholders instead.'
                : (!isMyTurn() ? 'You can change this at the start of your turn.'
                    : (hasRolled() ? 'Locked: you have rolled. Change it at the start of your next turn.'
                        : `Change it now, before you roll. It then stays put for your next 5 turns unless every shareholder agrees.`));
            const debt = (corp.debts || []).reduce((sum, d) => sum + Number(d.principal || 0), 0);
            const debtWarning = other === 'payout' && debt > 0
                ? `<p class="share-deal-warning">${esc(corp.ticker)} owes ${money(debt)}. In Payout its treasury stops growing, but interest is still charged to it.</p>`
                : '';
            controls = `
                ${debtWarning}
                <div class="governance-control">
                    ${canSwitch || lockedTurns === 0
                        ? `<button class="btn btn-primary btn-sm" data-game-action="set-rent-policy" data-corp-id="${esc(corp.id)}" data-policy="${other}"${canSwitch ? '' : ' disabled'}>Switch to ${otherLabel}</button>`
                        : ''}
                    ${mine > 0 && lockedTurns > 0 ? proposeButton(corp, other, otherLabel) : ''}
                </div>
                <small>${esc(note)}</small>
            `;
        } else if (mine > 0 && !corp.rentPolicyVote) {
            controls = `<div class="governance-control">${proposeButton(corp, other, otherLabel)}</div>`;
        }
        return `
            <div class="corp-rent-policy">
                <h4>Rent policy: <span class="badge${policy === 'payout' ? ' badge-gold' : ''}">${policy === 'payout' ? 'Payout' : 'Reinvest'}</span></h4>
                <p>${esc(effect)}</p>
                ${lockLine}
                ${renderRentPolicyVote(corp)}
                ${controls}
            </div>
        `;
    }

    function proposeButton(corp, policy, label) {
        return `<button class="btn btn-secondary btn-sm" data-game-action="propose-rent-policy" data-corp-id="${esc(corp.id)}" data-policy="${policy}">Ask every shareholder to switch to ${label}</button>`;
    }

    // An open rent-policy vote: who agreed, who hasn't yet, and Agree / Reject
    // for a shareholder who hasn't answered.
    function shareholdersOf(corp) {
        return (corp.shareholders || [])
            .filter(h => Number(h.shares || 0) > 0)
            .filter(h => !(state()?.players || []).find(p => p.userId === h.userId)?.bankrupt);
    }

    function renderRentPolicyVote(corp) {
        const vote = corp.rentPolicyVote;
        if (!vote) return '';
        const holders = shareholdersOf(corp);
        const agreed = holders.filter(h => vote.supporterIds.includes(h.userId));
        const waiting = holders.filter(h => !vote.supporterIds.includes(h.userId));
        const nameOf = h => (h.userId === me() ? 'you' : h.name);
        const canAnswer = global.ShareDeals.sharesHeld(corp, me()) > 0 && !vote.supporterIds.includes(me());
        return `
            <div class="chairman-vote-row">
                <div>
                    <strong>Switch to ${vote.policy === 'payout' ? 'Payout' : 'Reinvest'}?</strong>
                    <span>Proposed by ${esc(vote.proposedByName || 'a shareholder')}. Agreed: ${esc(agreed.map(nameOf).join(', ') || 'nobody yet')}. Waiting for: ${esc(waiting.map(nameOf).join(', '))}. It switches when everyone agrees; one no closes it.</span>
                </div>
                ${canAnswer ? `
                    <button class="btn btn-primary btn-sm" data-game-action="vote-rent-policy" data-corp-id="${esc(corp.id)}" data-approve="true">Agree</button>
                    <button class="btn btn-secondary btn-sm" data-game-action="vote-rent-policy" data-corp-id="${esc(corp.id)}" data-approve="false">Reject</button>
                ` : ''}
            </div>
        `;
    }

    async function proposeRentPolicy(corpId, policy) {
        await global.submitGameAction('propose_rent_policy_change', { corpId, policy }, {
            errorText: 'Failed to propose the change',
            onSaved: () => global.openCorporationModal(),
        });
    }

    async function voteRentPolicy(corpId, approve) {
        await global.submitGameAction('vote_rent_policy_change', { corpId, approve }, {
            errorText: 'Failed to vote',
            onSaved: () => global.openCorporationModal(),
        });
    }

    async function setRentPolicy(corpId, policy) {
        await global.submitGameAction('set_rent_policy', { corpId, policy }, {
            errorText: 'Failed to change the rent policy',
            onSaved: () => global.openCorporationModal(),
        });
    }

    // ---- The runner's tools -----------------------------------------------

    function renderRunnerTools(corp) {
        if (global.ShareDeals.isInsolvent(corp) || !global.ShareDeals.runsCorporation(corp, me())) return '';
        const myTurn = isMyTurn();
        const cash = Number(corp.cash || 0);
        const ownsGroup = global.getCompleteGroupProperties(corp.id, state()).length > 0;
        const turnNote = myTurn ? '' : '<small>Dividends and building happen on your turn.</small>';
        return `
            <div class="corp-runner-tools">
                <h4>Spend the treasury (${money(cash)})</h4>
                <div class="buy-shares-form">
                    <label for="dividend-${esc(corp.id)}">Pay a dividend, split by shares</label>
                    <input type="number" inputmode="decimal" id="dividend-${esc(corp.id)}" min="1" max="${Math.floor(cash)}" value="${Math.floor(cash / 2) || ''}">
                    <button class="btn btn-primary btn-sm" data-game-action="pay-dividend" data-corp-id="${esc(corp.id)}"${myTurn && cash >= 1 ? '' : ' disabled'}>Pay dividend</button>
                </div>
                <div class="governance-control">
                    <button class="btn btn-secondary btn-sm" data-game-action="build-for-corporation" data-corp-id="${esc(corp.id)}"${myTurn && ownsGroup ? '' : ' disabled'}>Build houses for ${esc(corp.ticker)}</button>
                    <button class="btn btn-secondary btn-sm" data-game-action="trade-as-corporation" data-corp-id="${esc(corp.id)}">Trade as ${esc(corp.ticker)}</button>
                </div>
                <small>${ownsGroup ? '' : `${esc(corp.ticker)} can build once it owns a whole colour group. `}To buy a property for ${esc(corp.ticker)}, land on it and choose ${esc(corp.ticker)} when you buy.</small>
                ${turnNote}
            </div>
        `;
    }

    async function payDividend(corpId) {
        const corp = corpById(corpId);
        const amount = Number(document.getElementById(`dividend-${corpId}`)?.value || 0);
        if (!corp || !(amount > 0)) return;
        await global.submitGameAction('pay_dividend', { corpId, amount }, {
            errorText: 'Failed to pay the dividend',
            onSaved: () => {
                global.showToast(`${corp.ticker} paid a ${money(amount)} dividend.`);
                global.openCorporationModal();
            },
        });
    }

    function buildForCorporation(corpId) {
        global.closeModal('corporationModal');
        global.openHouseModal(corpId);
    }

    function tradeAsCorporation(corpId) {
        global.closeModal('corporationModal');
        const marketTab = document.querySelector('.nav-tab[data-section="market"]');
        if (marketTab) global.showSection(marketTab, 'market');
        global.setTradingAs('player1', me(), corpId);
        const corp = corpById(corpId);
        global.showMarketStatus(`You're trading for ${corp?.ticker || 'the company'}: its treasury cash, properties and treasury shares. Pick who to trade with.`, 'info');
        document.querySelector('#market .transaction-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---- Property offers --------------------------------------------------

    function pendingOffers(corp) {
        return (state()?.propertyOffers || []).filter(offer => offer.status === 'pending' && offer.corpId === corp.id);
    }

    function renderOfferButton(corp) {
        if (global.ShareDeals.isInsolvent(corp) || !corp.chairmanId || global.ShareDeals.runsCorporation(corp, me())) return '';
        const mine = (currentPlayerData?.properties || []).length > 0 && !currentPlayerData?.bankrupt;
        if (!mine) return '';
        return `
            <div class="offer-property-for-shares">
                <button class="btn btn-success" data-game-action="open-property-offer" data-corp-id="${esc(corp.id)}">Offer a property to ${esc(corp.ticker)}</button>
                <small>At book value or your price, for new ${esc(corp.ticker)} shares or treasury cash. ${esc(corp.chairmanName || 'The chairman')} accepts, declines or counters.</small>
                <button class="btn btn-secondary btn-sm" data-game-action="offer-property-for-shares" data-corp-id="${esc(corp.id)}">Or trade it for ${esc(corp.chairmanName || 'the chairman')}'s own shares</button>
            </div>
        `;
    }

    function renderPropertyOffers(corp) {
        const offers = pendingOffers(corp);
        if (!offers.length) return '';
        const runs = global.ShareDeals.runsCorporation(corp, me());
        return `
            <div class="corp-property-offers">
                <h4>Property offers</h4>
                ${offers.map(offer => renderOffer(corp, offer, runs)).join('')}
            </div>
        `;
    }

    function renderOffer(corp, offer, runs) {
        const isOfferer = offer.offererId === me();
        const awaitingMe = offer.awaiting === 'offerer' ? isOfferer : runs;
        const summary = global.ShareDeals.summarizePropertyOffer(state(), corp, offer.offererId, offer.assetIds,
            offer.priceBasis === 'book' ? null : offer.price, offer.payWith, me(), offerOptions());
        const waitingOn = offer.awaiting === 'offerer' ? offer.offererName : `${corp.ticker}'s chairman`;
        const canAnswer = awaitingMe && !global.isTradeOfferExpiredForDisplay(offer);
        return `
            <div class="trade-offer-card">
                <div class="trade-offer-header">
                    <strong>${esc(offer.offererName)} → ${esc(corp.ticker)}: ${money(offer.price)} in ${offer.payWith === 'cash' ? 'treasury cash' : 'new shares'}</strong>
                    <div class="trade-offer-meta">
                        <span>${esc(offer.priceBasis === 'book' ? 'Book value' : 'Set price')}</span>
                        ${offer.expiresAt ? `<span>${esc(global.formatTradeOfferExpiry(offer.expiresAt))}</span>` : ''}
                    </div>
                </div>
                ${global.renderShareDealSummary(summary)}
                ${canAnswer ? `
                    <div class="trade-offer-actions">
                        <button class="btn btn-success btn-sm" data-game-action="respond-property-offer" data-offer-id="${esc(offer.id)}" data-response="accept">Accept</button>
                        <input type="number" class="counter-price-input" id="counter-${esc(offer.id)}" min="1" step="1" inputmode="decimal" value="${Math.round(offer.price)}" aria-label="Counter price">
                        <button class="btn btn-secondary btn-sm" data-game-action="respond-property-offer" data-offer-id="${esc(offer.id)}" data-response="counter">Counter</button>
                        <button class="btn btn-secondary btn-sm" data-game-action="respond-property-offer" data-offer-id="${esc(offer.id)}" data-response="decline">${isOfferer ? 'Withdraw' : 'Decline'}</button>
                    </div>
                ` : `
                    <p class="empty-state">Waiting for ${esc(waitingOn)}.</p>
                    ${isOfferer ? `<div class="trade-offer-actions"><button class="btn btn-secondary btn-sm" data-game-action="respond-property-offer" data-offer-id="${esc(offer.id)}" data-response="decline">Withdraw</button></div>` : ''}
                `}
            </div>
        `;
    }

    async function respondPropertyOffer(offerId, response) {
        const payload = { offerId, response };
        if (response === 'counter') {
            payload.price = Number(document.getElementById(`counter-${offerId}`)?.value || 0);
            if (!(payload.price > 0)) return;
        }
        await global.submitGameAction('respond_property_offer', payload, {
            errorText: 'Failed to answer the offer',
            onSaved: () => global.openCorporationModal(),
        });
    }

    let offerCorpId = null;

    function openPropertyOffer(corpId) {
        const corp = corpById(corpId);
        if (!corp) return;
        offerCorpId = corpId;
        global.closeModal('corporationModal');
        document.getElementById('propertyOfferTitle').textContent = `Offer a property to ${corp.ticker}`;
        document.getElementById('propertyOfferHint').textContent = `${corp.chairmanName || 'The chairman'} decides. ${corp.ticker} will own it and collect its rent.`;
        document.getElementById('propertyOfferCashNote').textContent = `${corp.ticker} buys it outright. Its treasury has ${money(corp.cash)}.`;
        const container = document.getElementById('propertyOfferAssets');
        container.innerHTML = (currentPlayerData?.properties || []).map(p => {
            const built = global.groupHasBuildingsUi(p.color);
            const note = built ? `Has buildings: goes with the whole ${p.color} group` : '';
            return `
                <div class="asset-checkbox">
                    <input type="checkbox" id="offer-asset-${esc(p.id)}" value="${esc(p.id)}"${built ? ` data-built-group="${esc(p.color)}"` : ''}>
                    <label for="offer-asset-${esc(p.id)}">${global.propertyDot(p.id)}${esc(p.name)} <span class="debt-detail">${money(p.value)}</span>${note ? ` <span class="debt-detail">${esc(note)}</span>` : ''}</label>
                </div>
            `;
        }).join('') || '<p class="empty-state">You have no properties to offer.</p>';
        container.querySelectorAll('input[data-built-group]').forEach(input => {
            input.addEventListener('change', () => {
                container.querySelectorAll(`input[data-built-group="${CSS.escape(input.dataset.builtGroup)}"]:not(:disabled)`).forEach(other => { other.checked = input.checked; });
            });
        });
        document.querySelector('input[name="propertyOfferBasis"][value="book"]').checked = true;
        document.querySelector('input[name="propertyOfferPayWith"][value="shares"]').checked = true;
        document.getElementById('propertyOfferPriceInput').value = '';
        renderPropertyOfferPreview();
        global.openModal('propertyOfferModal');
    }

    function offerFormTerms() {
        const corp = corpById(offerCorpId);
        const assetIds = Array.from(document.querySelectorAll('#propertyOfferAssets input:checked')).map(cb => cb.value);
        const basis = document.querySelector('input[name="propertyOfferBasis"]:checked')?.value || 'book';
        const payWith = document.querySelector('input[name="propertyOfferPayWith"]:checked')?.value || 'shares';
        const price = basis === 'set' ? Number(document.getElementById('propertyOfferPriceInput').value || 0) : null;
        return { corp, assetIds, basis, payWith, price };
    }

    function renderPropertyOfferPreview() {
        const form = offerFormTerms();
        if (!form.corp) return;
        document.getElementById('propertyOfferPriceGroup').hidden = form.basis !== 'set';
        // Switching to a set price starts from book value.
        const priceInput = document.getElementById('propertyOfferPriceInput');
        if (form.basis === 'set' && !priceInput.value && form.assetIds.length) {
            priceInput.value = Math.round(global.ShareDeals.contributionQuote(state(), form.corp, me(), form.assetIds, offerOptions()).value);
        }
        const { corp, assetIds, basis, payWith, price } = offerFormTerms();
        const preview = document.getElementById('propertyOfferPreview');
        const button = document.getElementById('send-property-offer-btn');
        const priced = basis === 'book' || price > 0;
        if (!assetIds.length || !priced) {
            preview.hidden = true;
            preview.innerHTML = '';
            button.disabled = true;
            return;
        }
        const summary = global.ShareDeals.summarizePropertyOffer(state(), corp, me(), assetIds,
            basis === 'set' ? price : null, payWith, me(), offerOptions());
        preview.hidden = false;
        preview.innerHTML = `<h4>Your offer</h4>${global.renderShareDealSummary(summary)}`;
        const cashShort = payWith === 'cash' && summary.quote.price > Number(corp.cash || 0);
        button.disabled = (payWith === 'shares' && summary.newShares === 0) || cashShort;
        if (cashShort) preview.innerHTML += `<p class="share-deal-warning">${esc(corp.ticker)}'s treasury has only ${money(corp.cash)}.</p>`;
    }

    async function sendPropertyOffer() {
        const { corp, assetIds, basis, payWith, price } = offerFormTerms();
        if (!corp || !assetIds.length) return;
        const payload = { corpId: corp.id, assetIds, payWith };
        if (basis === 'set') payload.price = price;
        await global.submitGameAction('offer_property_to_corporation', payload, {
            errorText: 'Failed to send the offer',
            onSaved: () => {
                global.closeModal('propertyOfferModal');
                global.showToast(`Offer sent to ${corp.chairmanName || corp.ticker}.`);
            },
        });
    }

    function bind() {
        document.getElementById('propertyOfferModal')?.addEventListener('change', renderPropertyOfferPreview);
        document.getElementById('propertyOfferPriceInput')?.addEventListener('input', renderPropertyOfferPreview);
        document.getElementById('send-property-offer-btn')?.addEventListener('click', sendPropertyOffer);
    }

    // Property offers and rent-policy votes someone needs to answer, for the
    // Corporations button.
    function offersAwaiting(userId) {
        const votes = (state()?.corporations || []).filter(corp => corp.rentPolicyVote && !global.ShareDeals.isInsolvent(corp)
            && global.ShareDeals.sharesHeld(corp, userId) > 0 && !corp.rentPolicyVote.supporterIds.includes(userId));
        return [...votes, ...(state()?.propertyOffers || []).filter(offer => {
            if (offer.status !== 'pending') return false;
            if (offer.awaiting === 'offerer') return offer.offererId === userId;
            const corp = corpById(offer.corpId);
            return !!corp && global.ShareDeals.runsCorporation(corp, userId);
        })];
    }

    global.CorporationDesk = {
        renderRentPolicy,
        renderRunnerTools,
        renderOfferButton,
        renderPropertyOffers,
        setRentPolicy,
        proposeRentPolicy,
        voteRentPolicy,
        payDividend,
        buildForCorporation,
        tradeAsCorporation,
        openPropertyOffer,
        respondPropertyOffer,
        offersAwaiting,
        bind,
    };
})(window);
