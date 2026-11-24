// Mergers on the game page: the merge sheet (opened from Market > New trade
// with a company you run on one side and another company on the other), the
// merger vote cards in Market > Trade proposals, and the value-flow chart.
//
// The rules live in backend/domain/gameRulesInternal/mergers.js. The numbers
// here mirror mergerQuote and mergerTally there (and the merger maths in
// corporateFinance.js) so the sheet can recalculate on every keystroke; keep
// them in step. The server checks everything again on proposal and on closing.
// Classic browser script, no build; reads game.js's currentGame and currentUser.
(function (global) {
    'use strict';

    const MAX_STAKE = 95; // MAX_MERGER_STAKE_PERCENT in corporateFinance.js
    const FLOW_MAX_PLAYERS = 5; // more holders than this are grouped as "Others"

    // The open sheet: { acquirerId, targetId, stakeTouched, tickerChoice, showFlow }.
    let sheet = null;
    // Vote cards whose value-flow chart is open.
    const openFlows = new Set();

    function state() { return currentGame?.game_state || null; }
    function me() { return currentUser?.id || null; }
    function esc(value) { return global.escapeHtml(value); }
    function money(value) { return global.formatMoney(value); }
    function count(value) { return global.ShareDeals.count(value); }
    function corpById(id) { return (state()?.corporations || []).find(corp => corp.id === id) || null; }
    function playerById(id) { return (state()?.players || []).find(player => player.userId === id) || null; }
    function roundCents(value) { return Math.round(Number(value) * 100) / 100; }
    function floorCents(value) { return Math.floor(Number(value) * 100 + 1e-6) / 100; }
    function nav(corp) { return roundCents(global.getCorporationNetAssetValue(corp)); }
    function signed(value) { return global.ShareDeals.signedMoney(value); }
    function nameFor(userId, name) { return userId === me() ? 'You' : name; }

    function formatPercent(value) {
        const rounded = Math.round(Number(value) * 10) / 10;
        return `${rounded.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    }

    // ---- Maths (mirrors corporateFinance.js and mergers.js) ----

    function newSharesFor(stakePercent, acquirerShares) {
        const percent = Number(stakePercent);
        const shares = Number(acquirerShares);
        if (!(percent > 0) || !(shares > 0) || percent >= 100) return 0;
        return Math.round((percent * shares) / (100 - percent));
    }

    // ownersValue: what the target's player-held shares are worth today
    // (treasury shares get nothing in a merger).
    function fairStake(acquirerValue, targetValue, cash, ownersValue = targetValue) {
        const merged = acquirerValue + targetValue - cash;
        if (!(merged > 0)) return null;
        return Math.min(Math.max(0, ((ownersValue - cash) / merged) * 100), MAX_STAKE);
    }

    function ownersValueOf(target) {
        const held = activeHolders(target).reduce((sum, owner) => sum + owner.shares, 0);
        const total = Number(target.totalShares || 0);
        return total > 0 ? roundCents((held * Math.max(0, nav(target))) / total) : 0;
    }

    function splitWholeShares(total, holders) {
        const base = holders.reduce((sum, holder) => sum + holder.shares, 0);
        if (!(total > 0) || base <= 0) return holders.map(() => 0);
        const parts = holders.map((holder, index) => {
            const exact = (total * holder.shares) / base;
            return { index, shares: holder.shares, whole: Math.floor(exact), remainder: exact - Math.floor(exact) };
        });
        let left = total - parts.reduce((sum, part) => sum + part.whole, 0);
        [...parts]
            .sort((a, b) => (b.remainder - a.remainder) || (b.shares - a.shares) || (a.index - b.index))
            .forEach(part => { if (left > 0) { part.whole += 1; left -= 1; } });
        return parts.map(part => part.whole);
    }

    function activeHolders(corp) {
        return (corp.shareholders || [])
            .map(holder => ({ userId: holder.userId, shares: Number(holder.shares || 0), player: playerById(holder.userId) }))
            .filter(holder => holder.shares > 0 && holder.player && !holder.player.bankrupt)
            .map(holder => ({ userId: holder.userId, name: holder.player.name, shares: holder.shares }));
    }

    // What the merger does right now, for every player it touches.
    function quote(acquirer, target, cash, stakePercent) {
        const acquirerValue = nav(acquirer);
        const targetValue = nav(target);
        const owners = activeHolders(target);
        const ownerShares = owners.reduce((sum, owner) => sum + owner.shares, 0);
        const cashParts = owners.map(owner => (cash > 0 && ownerShares > 0 ? floorCents((cash * owner.shares) / ownerShares) : 0));
        const newShares = newSharesFor(stakePercent, acquirer.totalShares);
        const shareParts = splitWholeShares(newShares, owners);
        const cashPaid = roundCents(cashParts.reduce((sum, part) => sum + part, 0));
        const mergedValue = roundCents(acquirerValue + targetValue - cashPaid);
        const sharesBefore = Number(acquirer.totalShares || 0);
        const totalSharesAfter = sharesBefore + newShares;
        const shareValueAfter = totalSharesAfter > 0 ? Math.max(0, mergedValue) / totalSharesAfter : 0;
        const acquirerShareValue = sharesBefore > 0 ? Math.max(0, acquirerValue) / sharesBefore : 0;
        const targetShareValue = Number(target.totalShares || 0) > 0 ? Math.max(0, targetValue) / Number(target.totalShares) : 0;

        // Everyone holding either company, before and after.
        const people = new Map();
        const person = (userId, name) => {
            if (!people.has(userId)) people.set(userId, { userId, name, acquirerShares: 0, targetShares: 0, newShares: 0, cash: 0 });
            return people.get(userId);
        };
        activeHolders(acquirer).forEach(holder => { person(holder.userId, holder.name).acquirerShares = holder.shares; });
        owners.forEach((owner, index) => {
            const entry = person(owner.userId, owner.name);
            entry.targetShares = owner.shares;
            entry.cash = cashParts[index];
            entry.newShares = shareParts[index];
        });
        const players = [...people.values()].map(entry => {
            const sharesAfter = entry.acquirerShares + entry.newShares;
            const valueBefore = roundCents(entry.acquirerShares * acquirerShareValue + entry.targetShares * targetShareValue);
            const stockAfter = roundCents(sharesAfter * shareValueAfter);
            return {
                ...entry,
                sharesAfter,
                percentAfter: totalSharesAfter > 0 ? (sharesAfter / totalSharesAfter) * 100 : 0,
                valueBefore,
                stockAfter,
                valueAfter: roundCents(stockAfter + entry.cash),
                change: roundCents(stockAfter + entry.cash - valueBefore),
            };
        }).sort((a, b) => b.valueAfter - a.valueAfter);
        const offerValue = roundCents(cashPaid + newShares * shareValueAfter);
        const ownersValue = roundCents(ownerShares * targetShareValue);
        return {
            acquirerValue,
            targetValue,
            ownersValue,
            cash: cashPaid,
            newShares,
            totalSharesAfter,
            mergedValue,
            shareValueAfter,
            offerValue,
            fair: fairStake(acquirerValue, targetValue, cashPaid, ownersValue),
            players,
        };
    }

    // The vote (mergerTally): every target share counts; holders who run the
    // acquirer count as yes (buyerSide), the rest vote.
    function tally(proposal) {
        const acquirer = corpById(proposal.acquirerId);
        const target = corpById(proposal.targetId);
        if (!acquirer || !target) return { voters: [], buyerSide: [], votingShares: 0, yesShares: 0, noShares: 0, neededShares: 1 };
        const holders = activeHolders(target);
        const runsBuyer = holder => global.ShareDeals.runsCorporation(acquirer, holder.userId);
        const votes = proposal.votes || {};
        const voters = holders.filter(holder => !runsBuyer(holder))
            .map(holder => ({ ...holder, vote: Object.hasOwn(votes, holder.userId) ? votes[holder.userId] : null }));
        const sum = list => list.reduce((total, voter) => total + voter.shares, 0);
        const buyerSide = holders.filter(runsBuyer);
        const votingShares = sum(holders);
        return {
            voters,
            buyerSide,
            votingShares,
            yesShares: sum(buyerSide) + sum(voters.filter(voter => voter.vote === true)),
            noShares: sum(voters.filter(voter => voter.vote === false)),
            neededShares: Math.floor(votingShares / 2) + 1,
        };
    }

    function openProposals() {
        return (state()?.mergerProposals || []).filter(item => item.status === 'open');
    }

    function myVoteNeeded(proposal) {
        const voter = tally(proposal).voters.find(item => item.userId === me());
        return !!voter && voter.vote === null;
    }

    function awaitingMe() {
        return openProposals().filter(myVoteNeeded).length;
    }

    // ---- Shared pieces ----

    // Percentages are of every share the company has (total), as on the
    // Corporations sheet; shares in its own treasury get a row of their own.
    function ownersBar(rows, total) {
        const segments = rows.filter(row => row.shares > 0 && total > 0).map(row =>
            `<span style="--owner-color:${esc(global.getPlayerColor(playerById(row.userId)))};--owner-share:${((row.shares / total) * 100).toFixed(2)}%"></span>`).join('');
        return `<div class="corp-owners-bar" aria-hidden="true">${segments}</div>`;
    }

    function ownersList(rows, total, treasury) {
        const pct = shares => formatPercent(total > 0 ? (shares / total) * 100 : 0);
        return `<ul class="corp-owner-list">${rows.map(row => `
            <li class="corp-owner-row">
                <span><i class="corp-owner-dot" style="--owner-color:${esc(global.getPlayerColor(playerById(row.userId)))}"></i>${esc(row.label || nameFor(row.userId, row.name))}</span>
                <span>${pct(row.shares)}</span>
            </li>`).join('')}${treasury > 0 ? `
            <li class="corp-owner-row"><span>Treasury</span><span>${pct(treasury)}</span></li>` : ''}</ul>`;
    }

    function owners(rows, total, treasury = 0) {
        const all = Number(total) > 0 ? Number(total) : rows.reduce((sum, row) => sum + row.shares, 0);
        return `${ownersBar(rows, all)}${ownersList(rows, all, Number(treasury || 0))}`;
    }

    function afterOwners(q, acquirer) {
        return q.players.filter(p => p.sharesAfter > 0).map(p => ({
            userId: p.userId,
            name: p.name,
            shares: p.sharesAfter,
            label: `${nameFor(p.userId, p.name)}${p.userId === acquirer.chairmanId ? ' (chairman)' : ''}`,
        })).sort((a, b) => b.shares - a.shares);
    }

    function conversionLine(p, targetTicker, mergedTicker) {
        if (!p.targetShares) return `Keeps ${count(p.acquirerShares)} ${mergedTicker}`;
        const got = [p.newShares > 0 ? `${count(p.newShares)} ${mergedTicker}` : '', p.cash > 0 ? money(p.cash) : ''].filter(Boolean).join(' + ') || 'nothing';
        return `${count(p.targetShares)} ${targetTicker} → ${got}`;
    }

    function playersTable(q, targetTicker, mergedTicker) {
        return `<table class="share-deal-table">${q.players.map(p => `
            <tr><td>${esc(nameFor(p.userId, p.name))}</td><td>${esc(conversionLine(p, targetTicker, mergedTicker))}<small>${esc(`${money(p.valueBefore)} → ${money(p.valueAfter)} (${signed(p.change)})`)}</small></td></tr>
        `).join('')}</table>`;
    }

    function passesAtOnce(t) {
        return t.votingShares === 0 || t.yesShares * 2 > t.votingShares;
    }

    function buyerSideNote(t, targetTicker) {
        return t.buyerSide.map(h => (h.userId === me()
            ? `Your ${count(h.shares)} ${targetTicker} shares count as yes.`
            : `${h.name}'s ${count(h.shares)} ${targetTicker} shares count as yes.`));
    }

    function votersNote(t, targetTicker, acquirerTicker) {
        if (passesAtOnce(t)) {
            return t.votingShares === 0 || !t.voters.length
                ? `Nobody outside the buying side owns ${targetTicker}, so it goes through at once.`
                : `The buying side holds more than half of ${targetTicker}, so it goes through at once.`;
        }
        const names = t.voters.map(v => nameFor(v.userId, v.name));
        const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        const verb = names.length === 1 && names[0] !== 'You' ? 'votes' : 'vote';
        return [`${who} ${verb}. It goes through the moment yes votes pass half of the ${count(t.votingShares)} ${targetTicker} shares (${count(t.neededShares)}).`, ...buyerSideNote(t, targetTicker)].join(' ');
    }

    // ---- Value-flow chart (a top-to-bottom Sankey) ----

    function flowChart(q, acquirer, target, mergedTicker) {
        const total = q.acquirerValue + q.targetValue;
        if (!(q.acquirerValue > 0) || !(q.targetValue > 0) || !(q.mergedValue > 0) || !(total > 0)) {
            return `<p class="corp-hint">The chart needs both companies worth more than $0.</p>`;
        }
        // Players, biggest first; past FLOW_MAX_PLAYERS the rest (never you) are "Others".
        let people = q.players.map(p => ({ ...p, stock: p.stockAfter }));
        if (people.length > FLOW_MAX_PLAYERS) {
            const keep = people.slice(0, FLOW_MAX_PLAYERS - 1);
            const mine = people.find(p => p.userId === me());
            if (mine && !keep.includes(mine)) keep[keep.length - 1] = mine;
            const rest = people.filter(p => !keep.includes(p));
            keep.push({ userId: null, name: `${rest.length} others`, stock: rest.reduce((s, p) => s + p.stock, 0), cash: rest.reduce((s, p) => s + p.cash, 0) });
            people = keep;
        }
        const W = 320;
        const H = 14;
        const GAP = 10;
        const rows = [44, 150, 256];
        const scale = (W - GAP * Math.max(2, people.length - 1)) / total;
        const w = value => Math.max(value > 0 ? 2 : 0, value * scale);
        const cashFromA = Math.min(q.cash, q.acquirerValue);
        const cashFromT = q.cash - cashFromA;

        // Row 1: the companies today. Row 2: the merged company and the cash paid out.
        const a = { x: 0, w: w(q.acquirerValue) };
        const t = { x: a.w + GAP, w: w(q.targetValue) };
        const m = { x: 0, w: w(q.mergedValue) };
        const c = { x: m.w + GAP, w: w(q.cash) };
        let px = 0;
        const nodes = people.map(p => {
            const node = { p, x: px, sw: p.stock > 0 ? w(p.stock) : 0, cw: p.cash > 0 ? w(p.cash) : 0 };
            px += node.sw + node.cw + GAP;
            return node;
        });
        const width = Math.max(a.w + GAP + t.w, m.w + (q.cash > 0 ? GAP + c.w : 0), px - GAP);

        const ribbon = (x0, w0, y0, x1, w1, y1, cls) => {
            const mid = (y0 + y1) / 2;
            return `<path class="${cls}" d="M${x0.toFixed(1)},${y0} C${x0.toFixed(1)},${mid} ${x1.toFixed(1)},${mid} ${x1.toFixed(1)},${y1} L${(x1 + w1).toFixed(1)},${y1} C${(x1 + w1).toFixed(1)},${mid} ${(x0 + w0).toFixed(1)},${mid} ${(x0 + w0).toFixed(1)},${y0} Z"/>`;
        };
        const rect = (x, y, width_, cls, extra = '') => `<rect class="${cls}" x="${x.toFixed(1)}" y="${y}" width="${Math.max(0, width_).toFixed(1)}" height="${H}" rx="3"${extra}/>`;
        const parts = [];
        // Company → merged / cash.
        parts.push(ribbon(a.x, w(q.acquirerValue - cashFromA), rows[0] + H, m.x, w(q.acquirerValue - cashFromA), rows[1], 'flow-stock'));
        parts.push(ribbon(t.x + w(cashFromT), w(q.targetValue - cashFromT), rows[0] + H, m.x + w(q.acquirerValue - cashFromA), w(q.targetValue - cashFromT), rows[1], 'flow-stock'));
        if (cashFromA > 0) parts.push(ribbon(a.x + w(q.acquirerValue - cashFromA), w(cashFromA), rows[0] + H, c.x, w(cashFromA), rows[1], 'flow-cash'));
        if (cashFromT > 0) parts.push(ribbon(t.x, w(cashFromT), rows[0] + H, c.x + w(cashFromA), w(cashFromT), rows[1], 'flow-cash'));
        // Merged / cash → each player.
        let mx = m.x;
        let cx = c.x;
        nodes.forEach(node => {
            const mine = node.p.userId === me() ? ' is-mine' : '';
            if (node.sw > 0) { parts.push(ribbon(mx, node.sw, rows[1] + H, node.x, node.sw, rows[2], `flow-stock${mine}`)); mx += node.sw; }
            if (node.cw > 0) { parts.push(ribbon(cx, node.cw, rows[1] + H, node.x + node.sw, node.cw, rows[2], `flow-cash${mine}`)); cx += node.cw; }
        });
        parts.push(rect(a.x, rows[0], a.w, 'flow-node'), rect(t.x, rows[0], t.w, 'flow-node'), rect(m.x, rows[1], m.w, 'flow-node'));
        if (q.cash > 0) parts.push(rect(c.x, rows[1], c.w, 'flow-node-cash'));
        nodes.forEach(node => {
            if (node.sw > 0) parts.push(rect(node.x, rows[2], node.sw, 'flow-node'));
            if (node.cw > 0) parts.push(rect(node.x + node.sw, rows[2], node.cw, 'flow-node-cash'));
            const color = node.p.userId ? esc(global.getPlayerColor(playerById(node.p.userId))) : 'currentColor';
            parts.push(`<rect x="${node.x.toFixed(1)}" y="${rows[2] + H + 3}" width="${(node.sw + node.cw).toFixed(1)}" height="3" rx="1.5" fill="${color}"/>`);
        });
        const label = (x, y, text, anchor = 'start') => `<text class="flow-label" x="${x.toFixed(1)}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;
        parts.push(label(0, rows[0] - 6, `${acquirer.ticker} ${money(q.acquirerValue)}`));
        parts.push(label(t.x + t.w, rows[0] - 6, `${target.ticker} ${money(q.targetValue)}`, 'end'));
        parts.push(label(0, rows[1] - 6, `Merged ${mergedTicker} ${money(q.mergedValue)}`));
        if (q.cash > 0) parts.push(label(c.x + c.w, rows[1] - 6, `Cash ${money(q.cash)}`, 'end'));

        const svg = `<svg class="merger-flow" viewBox="-2 0 ${(width + 4).toFixed(0)} ${rows[2] + H + 10}" role="img" aria-label="Where the value goes: ${esc(acquirer.ticker)} and ${esc(target.ticker)} into the merged company and cash, then to each player">${parts.join('')}</svg>`;
        const legend = `<div class="merger-flow-key"><span><i class="is-stock"></i>Shares in ${esc(mergedTicker)}</span><span><i class="is-cash"></i>Cash</span></div>`;
        const list = `<table class="share-deal-table">${nodes.map(node => `
            <tr><td>${node.p.userId ? `<i class="corp-owner-dot" style="--owner-color:${esc(global.getPlayerColor(playerById(node.p.userId)))}"></i>` : ''}${esc(node.p.userId ? nameFor(node.p.userId, node.p.name) : node.p.name)}</td>
            <td>${money(node.p.stock + node.p.cash)}<small>${esc(`${money(node.p.stock)} in ${mergedTicker}${node.p.cash > 0 ? ` + ${money(node.p.cash)} cash` : ''}`)}</small></td></tr>`).join('')}</table>`;
        return `${legend}${svg}${list}`;
    }

    // ---- The merge sheet ----

    function open(acquirerId, targetId) {
        const acquirer = corpById(acquirerId);
        const target = corpById(targetId);
        if (!acquirer || !target) return;
        sheet = { acquirerId, targetId, stakeTouched: false, tickerChoice: 'keep', showFlow: false };
        renderSheet();
        global.openModal('mergerModal');
        document.querySelector('#mergerModal .modal-content').scrollTop = 0;
    }

    function readTerms() {
        const cashInput = document.getElementById('mergerCash');
        const stakeInput = document.getElementById('mergerStake');
        const tickerInput = document.getElementById('mergerTicker');
        return {
            cash: Math.max(0, Number(cashInput?.value) || 0),
            stake: Number(stakeInput?.value) || 0,
            stakeText: stakeInput?.value ?? '',
            newTicker: String(tickerInput?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
        };
    }

    function chosenTicker(acquirer, target, terms) {
        if (sheet.tickerChoice === 'target') return target.ticker;
        if (sheet.tickerChoice === 'new') return terms.newTicker || null;
        return null;
    }

    function renderSheet() {
        const acquirer = corpById(sheet?.acquirerId);
        const target = corpById(sheet?.targetId);
        const container = document.getElementById('mergerSheet');
        if (!container || !acquirer || !target) return;
        document.getElementById('mergerTitle').textContent = `Merge ${target.ticker} into ${acquirer.ticker}`;
        const cashCap = roundCents(Number(acquirer.cash || 0) + Number(target.cash || 0));
        const q0 = quote(acquirer, target, 0, 0);
        const startStake = q0.fair == null ? 0 : Math.round(q0.fair * 10) / 10;
        const tickerOption = (value, title) => `
            <label class="trade-destination-option">
                <input type="radio" name="mergerTickerChoice" value="${value}"${sheet.tickerChoice === value ? ' checked' : ''}>
                <span><strong>${esc(title)}</strong></span>
            </label>`;
        container.innerHTML = `
            <p class="modal-hint">Everyone's ${esc(target.ticker)} shares turn into ${esc(acquirer.ticker)} shares and cash, and ${esc(target.ticker)} closes. ${esc(target.ticker)}'s owners vote on it.</p>
            <div id="mergerBefore"></div>
            <h4>Your offer to ${esc(target.ticker)}'s owners</h4>
            <div class="form-group">
                <label for="mergerCash">Cash <span class="field-max" id="mergerCashMax"></span></label>
                <input type="number" id="mergerCash" min="0" max="${cashCap}" step="1" inputmode="decimal" value="0">
            </div>
            <div class="form-group">
                <label for="mergerStake">Their share of the merged company (%)</label>
                <input type="number" id="mergerStake" min="0" max="${MAX_STAKE}" step="0.1" inputmode="decimal" value="${startStake}">
            </div>
            <div id="mergerFair"></div>
            <h4>Ticker of the merged company</h4>
            <div class="trade-destination" id="mergerTickerChoices">
                ${tickerOption('keep', `Keep ${acquirer.ticker}`)}
                ${tickerOption('target', `Use ${target.ticker}`)}
                ${tickerOption('new', 'New ticker')}
            </div>
            <div class="form-group merger-ticker" id="mergerTickerGroup"${sheet.tickerChoice === 'new' ? '' : ' hidden'}>
                <label for="mergerTicker">New ticker</label>
                <input type="text" id="mergerTicker" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="Like ${esc((acquirer.ticker.slice(0, 2) + target.ticker.slice(0, 2)).slice(0, 8))}">
            </div>
            <div id="mergerResult"></div>
        `;
        if (!container.dataset.bound) {
            container.addEventListener('input', event => {
                if (event.target.id === 'mergerStake') sheet.stakeTouched = true;
                recalc();
            });
            container.addEventListener('change', event => {
                if (event.target.name === 'mergerTickerChoice') {
                    sheet.tickerChoice = event.target.value;
                    const group = document.getElementById('mergerTickerGroup');
                    if (group) {
                        group.hidden = sheet.tickerChoice !== 'new';
                        if (!group.hidden) document.getElementById('mergerTicker')?.focus();
                    }
                }
                recalc();
            });
            container.dataset.bound = 'true';
        }
        recalc();
    }

    // Recalculates everything below the inputs; runs on every keystroke and
    // on every game update, so the numbers always match the current state.
    function recalc() {
        if (!sheet) return;
        const acquirer = corpById(sheet.acquirerId);
        const target = corpById(sheet.targetId);
        const result = document.getElementById('mergerResult');
        const fairBox = document.getElementById('mergerFair');
        const sendBtn = document.getElementById('mergerSendBtn');
        if (!result || !fairBox) return;
        if (!acquirer || !target || global.ShareDeals.isClosed(acquirer) || global.ShareDeals.isClosed(target)
            || !global.ShareDeals.runsCorporation(acquirer, me())) {
            result.innerHTML = '<p class="share-deal-warning">This merger can no longer be proposed.</p>';
            fairBox.innerHTML = '';
            if (sendBtn) sendBtn.disabled = true;
            return;
        }
        const terms = readTerms();
        const cashCap = roundCents(Number(acquirer.cash || 0) + Number(target.cash || 0));
        renderBefore(acquirer, target, cashCap);
        // Until the player types a stake, it follows the fair one.
        const fairNow = fairStake(nav(acquirer), nav(target), Math.min(terms.cash, cashCap), ownersValueOf(target));
        if (!sheet.stakeTouched && fairNow != null) {
            const stakeInput = document.getElementById('mergerStake');
            const value = Math.round(fairNow * 10) / 10;
            if (stakeInput && Number(stakeInput.value) !== value) stakeInput.value = value;
            terms.stake = value;
        }
        const errors = [];
        if (terms.cash > cashCap + 1e-9) errors.push(`${acquirer.ticker} and ${target.ticker} have ${money(cashCap)} in cash between them.`);
        if (terms.stake < 0 || terms.stake > MAX_STAKE || terms.stakeText === '') errors.push(`Their share must be 0% to ${MAX_STAKE}%.`);
        if (terms.stake > 0 && newSharesFor(terms.stake, acquirer.totalShares) === 0) errors.push(`That share is less than one ${acquirer.ticker} share.`);
        const ticker = chosenTicker(acquirer, target, terms);
        if (sheet.tickerChoice === 'new' && !ticker) errors.push('Type the new ticker.');
        if (ticker && ticker !== acquirer.ticker && ticker !== target.ticker
            && (state()?.corporations || []).some(corp => corp.ticker === ticker)) errors.push(`The ticker ${ticker} is already taken.`);
        const mergedTicker = ticker || acquirer.ticker;

        const q = quote(acquirer, target, Math.min(terms.cash, cashCap), Math.min(Math.max(terms.stake, 0), MAX_STAKE));
        fairBox.innerHTML = fairHint(q, terms.stake, target.ticker);
        const t = tally({ acquirerId: acquirer.id, targetId: target.id, votes: {} });
        result.innerHTML = `
            <h4>After the merger</h4>
            <table class="share-deal-table">
                ${q.cash > 0 ? `<tr><td>− Cash paid to ${esc(target.ticker)}'s owners</td><td>${money(q.cash)}</td></tr>` : ''}
                <tr><td><b>Merged ${esc(mergedTicker)} is worth</b></td><td>${money(q.mergedValue)}<small>${count(q.totalSharesAfter)} shares at ${global.ShareDeals.perShare(q.shareValueAfter)}</small></td></tr>
            </table>
            ${owners(afterOwners(q, acquirer), q.totalSharesAfter, acquirer.treasuryShares)}
            <h4>What each player ends up with</h4>
            ${playersTable(q, target.ticker, mergedTicker)}
            ${errors.map(error => `<p class="share-deal-warning">${esc(error)}</p>`).join('')}
            <p class="share-deal-warning">${esc(votersNote(t, target.ticker, acquirer.ticker))}</p>
            ${flowToggle('sheet', sheet.showFlow)}
            ${sheet.showFlow ? flowChart(q, acquirer, target, mergedTicker) : ''}
        `;
        const sendLabel = passesAtOnce(t) ? `Merge ${target.ticker} into ${acquirer.ticker}` : `Send to ${target.ticker}'s owners`;
        if (sendBtn) {
            sendBtn.textContent = sendLabel;
            sendBtn.disabled = errors.length > 0;
        }
    }

    // The top of the sheet: each company's worth and owners today, and the cash
    // limit. Redrawn with the rest, so a game update can't leave it behind.
    function renderBefore(acquirer, target, cashCap) {
        const box = document.getElementById('mergerBefore');
        const holdsTreasury = Number(target.treasuryShares || 0) > 0;
        const html = `
            <h4>Before the merger</h4>
            <div class="corp-stats">
                <div class="corp-stat"><span class="stat-label">${esc(acquirer.ticker)} is worth</span><span class="corp-stat-value">${money(nav(acquirer))}</span></div>
                <div class="corp-stat"><span class="stat-label">${esc(target.ticker)} is worth</span><span class="corp-stat-value">${money(nav(target))}</span></div>
            </div>
            <p class="corp-hint"><b>${esc(acquirer.ticker)}</b></p>
            ${owners(activeHolders(acquirer), acquirer.totalShares, acquirer.treasuryShares)}
            <p class="corp-hint"><b>${esc(target.ticker)}</b></p>
            ${owners(activeHolders(target), target.totalShares, target.treasuryShares)}
            ${holdsTreasury ? `<p class="corp-hint">${esc(target.ticker)}'s treasury shares get nothing, so its owners' shares are worth ${money(ownersValueOf(target))}.</p>` : ''}
        `;
        if (box && box.dataset.html !== html) {
            box.innerHTML = html;
            box.dataset.html = html;
        }
        const max = document.getElementById('mergerCashMax');
        const text = `up to ${money(cashCap)}, ${acquirer.ticker}'s and ${target.ticker}'s cash together`;
        if (max && max.textContent !== text) max.textContent = text;
        const cashInput = document.getElementById('mergerCash');
        if (cashInput) cashInput.max = String(cashCap);
    }

    function fairHint(q, stake, targetTicker) {
        if (q.fair == null) return `<p class="share-deal-warning">That much cash leaves the merged company worth $0 or less.</p>`;
        const fair = Math.round(q.fair * 10) / 10;
        // Compared with what their shares are worth today (all of the target,
        // unless it holds treasury shares).
        const premium = roundCents(q.offerValue - q.ownersValue);
        let verdict;
        let tone;
        if (Math.abs(premium) < 0.5) {
            verdict = `${targetTicker}'s owners get what ${targetTicker} is worth.`;
            tone = 'is-fair';
        } else if (premium > 0) {
            verdict = `At ${formatPercent(stake)} ${targetTicker}'s owners get ${money(premium)} more than ${targetTicker} is worth.`;
            tone = 'is-good';
        } else {
            verdict = `At ${formatPercent(stake)} ${targetTicker}'s owners get ${money(-premium)} less than ${targetTicker} is worth.`;
            tone = 'is-bad';
        }
        const button = Math.abs(fair - stake) >= 0.05
            ? ` <button type="button" class="btn btn-secondary btn-sm" data-game-action="merger-use-fair" data-stake="${fair}">Use ${formatPercent(fair)}</button>`
            : '';
        return `<p class="offer-verdict ${tone}"><strong>A fair offer is ${formatPercent(fair)}.</strong> ${esc(verdict)}${button}</p>`;
    }

    function flowToggle(key, shown) {
        return `<button type="button" class="btn btn-secondary btn-sm merger-flow-toggle" data-game-action="merger-toggle-flow" data-flow-key="${esc(key)}" aria-expanded="${shown}">${shown ? 'Hide where the value goes' : 'See where the value goes'}</button>`;
    }

    function useFair(stake) {
        const input = document.getElementById('mergerStake');
        if (!input || !sheet) return;
        input.value = stake;
        sheet.stakeTouched = true;
        recalc();
    }

    function toggleFlow(key) {
        if (key === 'sheet') {
            if (!sheet) return;
            sheet.showFlow = !sheet.showFlow;
            recalc();
            return;
        }
        if (openFlows.has(key)) openFlows.delete(key); else openFlows.add(key);
        global.renderTradeOffers();
    }

    async function send() {
        if (!sheet) return;
        const acquirer = corpById(sheet.acquirerId);
        const target = corpById(sheet.targetId);
        if (!acquirer || !target) return;
        const terms = readTerms();
        const ticker = chosenTicker(acquirer, target, terms);
        await global.submitGameAction('propose_merger', {
            acquirerId: acquirer.id,
            targetId: target.id,
            cash: terms.cash,
            stakePercent: terms.stake,
            ticker,
        }, {
            errorText: 'Failed to propose the merger.',
            onSaved: result => {
                global.closeModal('mergerModal');
                sheet = null;
                const done = (result?.events || []).some(event => event.type === 'merger_completed');
                global.showMarketPane(done ? 'trade' : 'proposals');
                global.showMarketStatus(done
                    ? `${target.ticker} merged into ${ticker || acquirer.ticker}.`
                    : `Merger sent. It goes through when ${target.ticker}'s owners vote yes.`, 'success');
                global.resetTradeForm();
            },
        });
    }

    // Called on every game update.
    function refresh() {
        if (sheet && document.getElementById('mergerModal')?.classList.contains('active')) recalc();
    }

    // ---- Vote cards in Market > Trade proposals ----

    function cards() {
        return openProposals().map(proposal => ({ waiting: myVoteNeeded(proposal), html: card(proposal) }));
    }

    function card(proposal) {
        const acquirer = corpById(proposal.acquirerId);
        const target = corpById(proposal.targetId);
        if (!acquirer || !target) return '';
        const q = quote(acquirer, target, Number(proposal.cash || 0), Number(proposal.stakePercent || 0));
        const t = tally(proposal);
        const mergedTicker = proposal.ticker || acquirer.ticker;
        const mine = q.players.find(p => p.userId === me());
        const voter = t.voters.find(v => v.userId === me());
        const canWithdraw = proposal.proposedById === me() || global.ShareDeals.runsCorporation(acquirer, me());
        const proposer = proposal.proposedById === me() ? 'You' : proposal.proposedByName;
        let headline = '';
        if (mine && mine.targetShares > 0) {
            const got = [mine.newShares > 0 ? `${count(mine.newShares)} ${mergedTicker} shares` : '', mine.cash > 0 ? `${money(mine.cash)} cash` : ''].filter(Boolean).join(' + ') || 'nothing';
            headline = `<p class="offer-verdict ${mine.change >= 0 ? 'is-good' : 'is-bad'}"><strong>Your ${count(mine.targetShares)} ${esc(target.ticker)} shares would become ${esc(got)}.</strong> ${esc(`${money(mine.valueBefore)} today → ${money(mine.valueAfter)} after (${signed(mine.change)}).`)}</p>`;
        } else if (mine) {
            headline = `<p class="offer-verdict ${mine.change >= 0 ? 'is-good' : 'is-bad'}"><strong>Your ${esc(acquirer.ticker)} shares:</strong> ${esc(`${money(mine.valueBefore)} today → ${money(mine.valueAfter)} after (${signed(mine.change)}).`)}</p>`;
        }
        const votes = t.voters.map(v => `${nameFor(v.userId, v.name)}: ${v.vote === true ? 'yes' : (v.vote === false ? 'no' : 'waiting')} (${count(v.shares)})`).join('. ');
        const excluded = t.buyerSide.length ? ` ${buyerSideNote(t, target.ticker).join(' ')}` : '';
        const isTargetChair = target.chairmanId === me();
        const flowKey = proposal.id;
        const id = esc(proposal.id);
        let actions = '';
        if (voter) {
            actions = voter.vote === null
                ? `<button class="btn btn-success btn-sm" data-game-action="merger-vote" data-merger-id="${id}" data-approve="true">Vote yes</button>
                   <button class="btn btn-secondary btn-sm" data-game-action="merger-vote" data-merger-id="${id}" data-approve="false">Vote no</button>`
                : `<button class="btn btn-secondary btn-sm" data-game-action="merger-vote" data-merger-id="${id}" data-approve="${voter.vote ? 'false' : 'true'}">You voted ${voter.vote ? 'yes' : 'no'}. Switch to ${voter.vote ? 'no' : 'yes'}</button>`;
        }
        if (canWithdraw) actions += `<button class="btn btn-secondary btn-sm" data-game-action="merger-withdraw" data-merger-id="${id}">Withdraw</button>`;
        return `
            <div class="trade-offer-card" data-merger-id="${id}">
                <div class="trade-offer-header">
                    <span class="offer-kind">Merger vote</span>
                    <strong>${esc(proposer)} ${proposer === 'You' ? 'want' : 'wants'} to merge ${esc(target.ticker)} into ${esc(acquirer.ticker)}</strong>
                    <div class="trade-offer-meta"><span>Open until ${esc(proposal.proposedById === me() ? 'your' : `${proposal.proposedByName}'s`)} next turn</span></div>
                </div>
                ${headline}
                <h4>The companies</h4>
                <table class="share-deal-table">
                    <tr><td>${esc(acquirer.ticker)} today</td><td>${money(q.acquirerValue)}</td></tr>
                    <tr><td>${esc(target.ticker)} today</td><td>${money(q.targetValue)}</td></tr>
                    <tr><td>Merged ${esc(mergedTicker)}</td><td>${money(q.mergedValue)}${q.cash > 0 ? `<small>after ${money(q.cash)} cash goes to ${esc(target.ticker)}'s owners</small>` : ''}</td></tr>
                    ${proposal.ticker ? `<tr><td>New ticker</td><td>${esc(proposal.ticker)}<small>${esc(acquirer.ticker)} is renamed</small></td></tr>` : ''}
                </table>
                <h4>Who owns the merged ${esc(mergedTicker)}</h4>
                ${owners(afterOwners(q, acquirer), q.totalSharesAfter, acquirer.treasuryShares)}
                ${isTargetChair ? `<p class="share-deal-warning">${esc(target.ticker)} closes and you stop being its chairman.</p>` : ''}
                <h4>Votes</h4>
                <p class="corp-hint">${esc(votes || 'Nobody votes.')}. It goes through the moment yes votes reach ${count(t.neededShares)}.${esc(excluded)}</p>
                ${flowToggle(flowKey, openFlows.has(flowKey))}
                ${openFlows.has(flowKey) ? flowChart(q, acquirer, target, mergedTicker) : ''}
                ${actions ? `<div class="trade-offer-actions">${actions}</div>` : ''}
            </div>
        `;
    }

    async function vote(mergerId, approve) {
        await global.submitGameAction('vote_merger', { mergerId, approve }, {
            errorText: 'Failed to vote on the merger.',
            showError: global.showMarketError,
            onSaved: result => {
                const done = (result?.events || []).find(event => event.type === 'merger_completed' || event.type === 'merger_closed');
                const message = done?.type === 'merger_completed' ? 'The merger went through.'
                    : (done?.data?.status === 'rejected' ? 'The merger was voted down.' : 'Vote recorded.');
                global.showMarketStatus(message, 'success');
            },
        });
    }

    async function withdraw(mergerId) {
        if (!confirm('Withdraw this merger?')) return;
        await global.submitGameAction('withdraw_merger', { mergerId }, {
            errorText: 'Failed to withdraw the merger.',
            showError: global.showMarketError,
            onSaved: () => global.showMarketStatus('Merger withdrawn.', 'success'),
        });
    }

    global.Mergers = {
        quote, tally, open, refresh, send, useFair, toggleFlow, cards, awaitingMe, openProposals, vote, withdraw,
    };
})(window);
