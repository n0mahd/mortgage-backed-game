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
        return { netAssetValue: global.getCorporationNetAssetValue, ...extra };
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
        global.openMarketPane('trade');
        global.setTradingAs('player1', me(), corpId);
        const corp = corpById(corpId);
        global.showMarketStatus(`You're trading for ${corp?.ticker || 'the company'}: its treasury cash, properties and treasury shares. Pick who to trade with.`, 'info');
        document.querySelector('#market .market-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    // In the Corporations sheet, a pointer: the offers themselves are Trade
    // proposals in the Market.
    function renderPropertyOffers(corp) {
        const offers = pendingOffers(corp);
        if (!offers.length) return '';
        const mine = offers.filter(offer => awaitsUser(offer, me())).length;
        const label = mine
            ? `${mine} property offer${mine === 1 ? '' : 's'} waiting for you`
            : `${offers.length} property offer${offers.length === 1 ? '' : 's'} pending`;
        return `
            <div class="corp-offer-pointer">
                <span>${esc(label)}</span>
                <button class="btn btn-secondary btn-sm" data-game-action="open-trade-proposals">See in Market</button>
            </div>
        `;
    }

    function pendingPropertyOffers() {
        return (state()?.propertyOffers || []).filter(offer => offer.status === 'pending');
    }

    // Whose answer a property offer waits on: the offerer after a counter,
    // otherwise whoever runs the corporation.
    function awaitsUser(offer, userId) {
        if (!userId || global.isTradeOfferExpiredForDisplay(offer)) return false;
        if (offer.awaiting === 'offerer') return offer.offererId === userId;
        const corp = corpById(offer.corpId);
        return !!corp && global.ShareDeals.runsCorporation(corp, userId);
    }

    function summarizeOffer(corp, offer, price) {
        return global.ShareDeals.summarizePropertyOffer(state(), corp, offer.offererId, offer.assetIds,
            price, offer.payWith, me(), offerOptions());
    }

    function offerPrice(offer) {
        return offer.priceBasis === 'book' ? null : offer.price;
    }

    // One sentence on whether the price is fair and what it means for the viewer.
    function offerVerdict(corp, offer, summary) {
        const { value, price } = summary.quote;
        const over = Math.round(price - value);
        const names = global.ShareDeals.list(offer.assetIds.map(id => global.ShareDeals.propertyName(state(), id)));
        const isAre = offer.assetIds.length === 1 ? 'is' : 'are';
        const stake = summary.stakes.find(item => item.userId === me());
        const change = stake ? Math.round(stake.change) : 0;
        const isOfferer = offer.offererId === me();
        const decider = awaitsUser(offer, me());
        if (over === 0) {
            return { tone: 'is-fair', html: `A fair price: ${esc(names)} ${isAre} worth ${money(value)}.${stake ? ' Your net worth doesn\'t change.' : ''}` };
        }
        const gap = `<strong>${money(Math.abs(over))} ${over > 0 ? 'more' : 'less'}</strong>`;
        // After a counter the chairman set the price, not the offerer.
        const countered = offer.awaiting === 'offerer';
        const counterer = corp.chairmanId === me() ? 'Your' : `${esc(corp.chairmanName || corp.ticker)}'s`;
        const asking = countered
            ? `${counterer} counter is ${gap} than ${esc(names)} ${isAre} worth.`
            : `${isOfferer ? 'You\'re' : `${esc(offer.offererName)} is`} asking ${gap} than ${esc(names)} ${isAre} worth.`;
        const tone = change > 0 ? 'is-good' : (change < 0 ? 'is-bad' : 'is-fair');
        if (!stake || change === 0) {
            return { tone, html: `${asking}${over > 0 && !isOfferer ? ` ${esc(corp.ticker)}'s other owners pay the difference.` : ''}` };
        }
        const amount = `<strong>${money(Math.abs(change))}</strong>`;
        const effect = decider
            ? `Accepting ${change < 0 ? 'costs you' : 'gains you'} ${amount}`
            : `If it goes through, you ${change < 0 ? 'lose' : 'gain'} ${amount}`;
        const source = change < 0 && !isOfferer ? `; the extra goes to ${esc(offer.offererName)}` : '';
        return { tone, html: `${asking} ${effect}${source}.` };
    }

    // A property offer as a Trade proposals card: the two sides, a verdict,
    // what changes for the viewer, and Accept / Counter / Decline for whoever
    // the offer waits on.
    function renderPropertyOfferCard(offer) {
        const corp = corpById(offer.corpId);
        if (!corp) return '';
        const summary = summarizeOffer(corp, offer, offerPrice(offer));
        const isOfferer = offer.offererId === me();
        const canAnswer = awaitsUser(offer, me());
        const expired = global.isTradeOfferExpiredForDisplay(offer);
        const chairman = corp.chairmanId === me() ? 'you' : (corp.chairmanName || `${corp.ticker}'s chairman`);
        const names = global.ShareDeals.list(offer.assetIds.map(id => global.ShareDeals.propertyName(state(), id)));
        const offerer = isOfferer ? 'You' : offer.offererName;
        const title = offer.awaiting === 'offerer'
            ? `${corp.chairmanId === me() ? 'You' : (corp.chairmanName || corp.ticker)} countered: ${corp.ticker} pays ${money(summary.quote.price)} for ${names}`
            : `${offerer} ${isOfferer ? 'want' : 'wants'} to sell ${names} to ${corp.ticker}`;
        const kind = `Offer to ${corp.ticker}${canAnswer ? (isOfferer ? ' · your answer' : ' · you decide as chairman') : ''}`;
        const assetTags = global.sortTradeAssetIds(offer.assetIds).map(id => {
            const property = global.tradeAssetProperty(id);
            const value = Number((state().players || []).flatMap(p => p.properties || []).find(p => p.id === id)?.value ?? property?.price ?? 0);
            return global.renderTradeAssetTag(property?.name || id, `Worth ${money(value)}`, 'property', property ? global.getPropertyColorValue(property.color) : null);
        }).join('');
        const paid = offer.payWith === 'cash'
            ? global.renderTradeAssetTag(money(summary.quote.price), 'Treasury cash', 'cash')
            : global.renderTradeAssetTag(`${global.ShareDeals.count(summary.newShares)} new share${summary.newShares === 1 ? '' : 's'}`, `Worth ${money(summary.quote.price)}`, 'shares');
        const verdict = offerVerdict(corp, offer, summary);
        const rows = [];
        const myStake = summary.stakes.find(item => item.userId === me());
        if (myStake) {
            const change = Math.round(myStake.change);
            rows.push(`<tr><td>Your net worth</td><td class="${change > 0 ? 'up' : (change < 0 ? 'down' : '')}">${esc(global.ShareDeals.signedMoney(change))}</td></tr>`);
        }
        if (summary.newShares > 0) {
            summary.stakes
                .slice()
                .sort((a, b) => (b.userId === me()) - (a.userId === me()))
                .forEach(item => {
                    const you = item.userId === me();
                    let note = '';
                    if (item.majorityAfter && !item.majorityBefore) note = you ? 'You take control' : 'Takes control';
                    else if (item.majorityBefore && !item.majorityAfter) note = you ? 'You lose control' : 'Loses control';
                    else if (you && item.majorityAfter) note = 'You keep control';
                    rows.push(`<tr><td>${you ? `You own of ${esc(corp.ticker)}` : `${esc(item.name)} owns`}</td><td>${esc(item.percentBefore)} → ${esc(item.percentAfter)}${note ? `<small>${esc(note)}</small>` : ''}</td></tr>`);
                });
        }
        const otherWarnings = summary.warnings.filter(warning => !/over book value/.test(warning) && !/will own over half/.test(warning));
        const waitingOn = offer.awaiting === 'offerer'
            ? offer.offererName
            : `${corp.chairmanName || 'the chairman'}, ${corp.ticker}'s chairman`;
        const id = esc(offer.id);
        return `
            <div class="trade-offer-card${expired ? ' trade-offer-expired' : ''}" data-property-offer-id="${id}">
                <div class="trade-offer-header">
                    <span class="offer-kind">${esc(kind)}</span>
                    <strong>${esc(title)}</strong>
                    <div class="trade-offer-meta">
                        ${offer.createdAt ? `<span>${esc(global.formatTradeOfferAge(offer.createdAt))}</span>` : ''}
                        ${offer.expiresAt ? `<span>${esc(global.formatTradeOfferExpiry(offer.expiresAt))}</span>` : ''}
                    </div>
                </div>
                <div class="trade-offer-sides">
                    <div>
                        <h4>${esc(offerer)} ${isOfferer ? 'give' : 'gives'}</h4>
                        <ul class="trade-asset-list">${assetTags}</ul>
                    </div>
                    <div>
                        <h4>${esc(corp.ticker)} gives</h4>
                        <ul class="trade-asset-list">${paid}</ul>
                    </div>
                </div>
                <p class="offer-verdict ${verdict.tone}">${verdict.html}</p>
                ${rows.length ? `<table class="share-deal-table">${rows.join('')}</table>` : ''}
                ${otherWarnings.map(warning => `<p class="share-deal-warning">${esc(warning)}</p>`).join('')}
                ${canAnswer ? `
                    <div class="trade-offer-actions">
                        <button class="btn btn-success btn-sm" data-game-action="respond-property-offer" data-offer-id="${id}" data-response="accept">Accept</button>
                        <button class="btn btn-secondary btn-sm" data-game-action="toggle-property-counter" data-offer-id="${id}" aria-expanded="${counterOfferId === offer.id}" aria-controls="counter-box-${id}">Counter</button>
                        <button class="btn btn-secondary btn-sm" data-game-action="respond-property-offer" data-offer-id="${id}" data-response="decline">${isOfferer ? 'Withdraw' : 'Decline'}</button>
                    </div>
                    ${renderCounterBox(corp, offer, summary.quote.value, names)}
                ` : `
                    <p class="empty-state">${expired ? 'This offer has expired.' : `Waiting on ${esc(waitingOn)}.`}</p>
                    ${isOfferer ? `<div class="trade-offer-actions"><button class="btn btn-secondary btn-sm" data-game-action="respond-property-offer" data-offer-id="${id}" data-response="decline">Withdraw</button></div>` : ''}
                `}
            </div>
        `;
    }

    // Counter: hidden until the Counter button opens it. The draft price
    // survives game updates re-rendering the list.
    let counterOfferId = null;
    const counterDrafts = {};

    function renderCounterBox(corp, offer, bookValue, names) {
        const id = esc(offer.id);
        const draft = counterDrafts[offer.id] ?? Math.round(offer.price);
        return `
            <div class="offer-counter" id="counter-box-${id}"${counterOfferId === offer.id ? '' : ' hidden'}>
                <label for="counter-${id}">Your price for ${esc(names)}</label>
                <div class="offer-counter-row">
                    <input type="number" class="offer-counter-input" id="counter-${id}" data-offer-id="${id}" min="1" step="1" inputmode="decimal" value="${esc(draft)}">
                    <button type="button" class="btn btn-secondary btn-sm" data-game-action="fill-property-counter" data-offer-id="${id}" data-price="${Math.round(bookValue)}">Its worth: ${money(bookValue)}</button>
                </div>
                <p class="offer-counter-result" id="counter-result-${id}">${counterResultHtml(corp, offer, draft)}</p>
                <button class="btn btn-success btn-sm" data-game-action="respond-property-offer" data-offer-id="${id}" data-response="counter" id="counter-send-${id}">Send counter at ${money(draft)}</button>
            </div>
        `;
    }

    function counterResultHtml(corp, offer, price) {
        if (!(Number(price) > 0)) return 'Enter a price.';
        const summary = summarizeOffer(corp, offer, Number(price));
        const stake = summary.stakes.find(item => item.userId === me());
        const forYou = stake ? ` For you: <strong>${esc(global.ShareDeals.signedMoney(stake.change))}</strong>${summary.newShares > 0 ? `, owning ${esc(stake.percentAfter)}` : ''}.` : '';
        if (offer.payWith === 'cash') return `${esc(corp.ticker)} would pay <strong>${money(price)}</strong> from its treasury.${forYou}`;
        if (!summary.newShares) return esc(summary.quote.noSharesReason || 'This price buys no shares.');
        const who = offer.offererId === me() ? 'You' : esc(offer.offererName);
        return `${who} would get <strong>${esc(global.ShareDeals.count(summary.newShares))} new share${summary.newShares === 1 ? '' : 's'}</strong>.${forYou}`;
    }

    function updateCounterPreview(offerId) {
        const offer = pendingPropertyOffers().find(item => item.id === offerId);
        const corp = offer && corpById(offer.corpId);
        if (!corp) return;
        const price = counterDrafts[offerId];
        const result = document.getElementById(`counter-result-${offerId}`);
        if (result) result.innerHTML = counterResultHtml(corp, offer, price);
        const send = document.getElementById(`counter-send-${offerId}`);
        if (send) send.textContent = `Send counter at ${money(price)}`;
    }

    function togglePropertyCounter(offerId) {
        counterOfferId = counterOfferId === offerId ? null : offerId;
        const box = document.getElementById(`counter-box-${offerId}`);
        if (box) box.hidden = counterOfferId !== offerId;
        document.querySelector(`[data-game-action="toggle-property-counter"][data-offer-id="${CSS.escape(offerId)}"]`)
            ?.setAttribute('aria-expanded', String(counterOfferId === offerId));
        if (counterOfferId === offerId) document.getElementById(`counter-${offerId}`)?.focus();
    }

    function fillPropertyCounter(offerId, price) {
        counterDrafts[offerId] = Number(price);
        const input = document.getElementById(`counter-${offerId}`);
        if (input) input.value = String(price);
        updateCounterPreview(offerId);
    }

    async function respondPropertyOffer(offerId, response) {
        const payload = { offerId, response };
        if (response === 'counter') {
            payload.price = Number(document.getElementById(`counter-${offerId}`)?.value || 0);
            if (!(payload.price > 0)) return;
        }
        await global.submitGameAction('respond_property_offer', payload, {
            errorText: 'Failed to answer the offer',
            onSaved: () => {
                if (counterOfferId === offerId) counterOfferId = null;
                delete counterDrafts[offerId];
                global.renderTradeOffers();
            },
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
        document.addEventListener('input', event => {
            const input = event.target.closest?.('.offer-counter-input');
            if (!input) return;
            counterDrafts[input.dataset.offerId] = Number(input.value || 0);
            updateCounterPreview(input.dataset.offerId);
        });
        document.getElementById('propertyOfferModal')?.addEventListener('change', renderPropertyOfferPreview);
        document.getElementById('propertyOfferPriceInput')?.addEventListener('input', renderPropertyOfferPreview);
        document.getElementById('send-property-offer-btn')?.addEventListener('click', sendPropertyOffer);
    }

    // Rent-policy votes waiting on this shareholder, for the Corporations button.
    // (Property offers wait in Market > Trade proposals.)
    function votesAwaiting(userId) {
        return (state()?.corporations || []).filter(corp => corp.rentPolicyVote && !global.ShareDeals.isInsolvent(corp)
            && global.ShareDeals.sharesHeld(corp, userId) > 0 && !corp.rentPolicyVote.supporterIds.includes(userId));
    }

    global.CorporationDesk = {
        renderRentPolicy,
        renderRunnerTools,
        renderOfferButton,
        renderPropertyOffers,
        renderPropertyOfferCard,
        pendingPropertyOffers,
        awaitsUser,
        togglePropertyCounter,
        fillPropertyCounter,
        setRentPolicy,
        proposeRentPolicy,
        voteRentPolicy,
        payDividend,
        buildForCorporation,
        tradeAsCorporation,
        openPropertyOffer,
        respondPropertyOffer,
        votesAwaiting,
        bind,
    };
})(window);
