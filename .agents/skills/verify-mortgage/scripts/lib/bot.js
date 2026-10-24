'use strict';

// Autoplay: plays every non-human seat through the real UI (tabs, buttons,
// modals, forms), never through the API. After each action it checks that
// every seat's screen caught up with the server, that the screens agree on
// whose turn it is, and that the saved game state is internally consistent.
// Human seats (an agent playing via look/click) are waited for, not played.

const BOARD_PROPERTY_AT = {
    1: 'prop-0', 3: 'prop-1', 5: 'prop-9', 6: 'prop-2', 8: 'prop-3', 9: 'prop-4', 11: 'prop-5', 12: 'prop-6',
    13: 'prop-7', 14: 'prop-8', 15: 'prop-16', 16: 'prop-10', 18: 'prop-11', 19: 'prop-12', 21: 'prop-13',
    23: 'prop-14', 24: 'prop-15', 25: 'prop-27', 26: 'prop-17', 27: 'prop-18', 28: 'prop-19', 29: 'prop-20',
    31: 'prop-21', 32: 'prop-22', 34: 'prop-23', 35: 'prop-24', 37: 'prop-25', 39: 'prop-26',
};

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const { Chaos } = require('./chaos');
const { Explore } = require('./explore');
const { rules } = require('./pathways');
const { transferDevice, rejoinAsGuest, declineStrayRejoin } = require('./table');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Autoplay {
    constructor(ctx, table, opts) {
        this.ctx = ctx;
        this.table = table;
        this.rounds = opts.rounds;
        this.seed = opts.seed;
        this.rand = mulberry32(opts.seed);
        this.shotEvery = opts.shotEvery;
        this.humanIdleMs = opts.humanIdleMs;
        this.maxMinutes = opts.maxMinutes;
        this.endWithHost = opts.endGame !== false;
        this.turns = {};
        this.actionCounts = {};
        this.actionMs = {};
        this.firstSeen = new Set();
        this.invariantSeen = new Set();
        this.resilienceDone = { reload: false, offline: false, pause: false, moves: false };
        this.status = { phase: 'starting', round: 0, turnsTotal: 0 };
        this.stopRequested = false;
        this.chaos = Number(opts.chaos || 0);
        this.chaosEngine = new Chaos(this);
        this.explore = opts.explore ? new Explore(this, { stageRate: opts.stageRate ?? 0.35 }) : null;
    }

    get seats() { return this.table.seats; }
    seatById(userId) { return this.seats.find(s => s.userId === userId); }
    chance(p) { return this.rand() < p; }
    pick(list) { return list[Math.floor(this.rand() * list.length)]; }

    server() {
        const row = this.ctx.sql('SELECT game_state, state_version FROM games WHERE id = ?', [this.table.gameId])[0];
        return { state: JSON.parse(row.game_state), version: row.state_version };
    }

    async pageVersion(seat) {
        try {
            return await seat.page.evaluate(() => (typeof currentGame !== 'undefined' && currentGame ? currentGame.state_version : -1));
        } catch {
            return -1;
        }
    }

    async gameTab(seat) {
        await this.closeModals(seat);
        const tab = seat.page.locator('.nav-tab[data-section="game"]');
        if (!(await tab.getAttribute('class') || '').includes('active')) await tab.click();
    }

    // pane: 'trade', 'payment', 'proposals' or 'history' (the Market's tabs).
    async marketTab(seat, pane) {
        await this.closeModals(seat);
        const tab = seat.page.locator('.nav-tab[data-section="market"]');
        if (!(await tab.getAttribute('class') || '').includes('active')) await tab.click();
        if (pane) await seat.page.locator(`#marketTab-${pane}`).click();
    }

    gameButton(seat, action) {
        return seat.page.locator(`#game.section.active [data-game-action="${action}"]`).first();
    }

    async usable(locator) {
        try {
            return (await locator.count()) > 0 && await locator.isVisible() && await locator.isEnabled();
        } catch {
            return false;
        }
    }

    // Runs one UI action and waits for the seat's game version to move.
    async act(seat, label, fn, { allowNoChange = false, allowRejection = false, waitMs = allowNoChange ? 3000 : 10000 } = {}) {
        const before = await this.pageVersion(seat);
        const dialogsBefore = seat.dialogs.length;
        const started = Date.now();
        try {
            await fn();
        } catch (err) {
            this.ctx.finding({ severity: 'high', category: 'ui', seat, title: `Could not ${label}`, detail: String(err.message || err).split('\n')[0] });
            await this.ctx.shot(seat, `FAILED-${label}`);
            await this.closeModals(seat);
            return { changed: false, failed: true };
        }
        let changed = false;
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
            if (await this.pageVersion(seat) > before) { changed = true; break; }
            if (seat.dialogs.slice(dialogsBefore).some(d => d.type === 'alert')) break;
            await sleep(150);
        }
        const ms = Date.now() - started;
        this.actionCounts[label] = (this.actionCounts[label] || 0) + 1;
        (this.actionMs[label] = this.actionMs[label] || []).push(ms);
        // Confirms are the app asking "are you sure?" (accepted); alerts are refusals.
        const newDialogs = seat.dialogs.slice(dialogsBefore).filter(d => d.type === 'alert');
        if (newDialogs.length && !allowRejection) {
            this.ctx.finding({
                severity: 'medium', category: 'ui-rejection', seat,
                title: `"${label}" was refused with a dialog`,
                detail: newDialogs.map(d => `${d.type}: ${d.message}`).join(' | '),
            });
            await this.ctx.shot(seat, `rejected-${label}`);
        } else if (!changed && !allowNoChange && !newDialogs.length) {
            this.ctx.finding({ severity: 'high', category: 'ui', seat, title: `"${label}" had no visible effect within 10s`, detail: `state_version stayed at ${before}` });
            await this.ctx.shot(seat, `no-effect-${label}`);
        } else if (ms > 4000 && changed) {
            this.ctx.finding({ severity: 'low', category: 'perf', seat, title: `"${label}" took ${(ms / 1000).toFixed(1)}s to show its result`, detail: '' });
        }
        this.ctx.log(`    ${seat.name}: ${label}${changed ? '' : ' (no state change)'} ${ms}ms`);
        if (changed) await this.syncCheck(label);
        return { changed, dialogs: newDialogs };
    }

    async closeModals(seat) {
        if (!seat.human) await declineStrayRejoin(this.ctx, seat);
        const open = seat.page.locator('.modal.active [data-close-modal]');
        try {
            const n = await open.count();
            for (let i = 0; i < n; i++) if (await open.nth(i).isVisible()) await open.nth(i).click();
        } catch {}
    }

    async firstTime(key, seats, name) {
        if (this.firstSeen.has(key)) return;
        this.firstSeen.add(key);
        for (const seat of seats) await this.ctx.shot(seat, name || key);
    }

    // Every seat should show the server's latest version within a few seconds,
    // and every screen should agree on whose turn it is.
    async syncCheck(after) {
        const { state, version } = this.server();
        // A seat cut off on purpose by resilience() is checked when it reconnects.
        const online = this.seats.filter(s => !s.reconnectAfterTurn);
        const deadline = Date.now() + 8000;
        let lagging = online;
        while (Date.now() < deadline) {
            const versions = await Promise.all(online.map(s => this.pageVersion(s)));
            lagging = online.filter((s, i) => versions[i] < version);
            if (!lagging.length) break;
            await sleep(250);
        }
        for (const seat of lagging) {
            const v = await this.pageVersion(seat);
            await sleep(12000);
            const later = await this.pageVersion(seat);
            const recovered = later >= version;
            this.ctx.finding({
                severity: recovered ? 'medium' : 'high', category: 'sync', seat,
                title: recovered ? 'Screen took over 8s to catch up' : 'Screen stuck on an old game state',
                detail: `after "${after}": server v${version}, seat showed v${v}, ${recovered ? 'caught up' : `still v${later}`} 20s later`,
            });
            await this.ctx.shot(seat, 'stale-screen');
        }
        const current = state.players[state.currentPlayerIndex];
        for (const seat of online) {
            const dom = await seat.page.evaluate(() => ({
                heading: document.querySelector('#gameContent .game-header h2')?.innerText || '',
                myTurnClass: document.body.classList.contains('is-my-turn'),
            })).catch(() => null);
            if (!dom) continue;
            if (dom.heading && !dom.heading.includes(current.name) && !state.ended) {
                this.ctx.finding({ severity: 'high', category: 'sync', seat, title: 'Screens disagree on whose turn it is', detail: `server: ${current.name}; seat heading: "${dom.heading}"` });
            }
            const shouldBeMine = current.userId === seat.userId && !state.paused && !state.ended;
            if (dom.myTurnClass !== shouldBeMine && !state.ended) {
                this.ctx.finding({ severity: 'medium', category: 'sync', seat, title: 'Your-turn highlight is wrong', detail: `is-my-turn=${dom.myTurnClass}, current player ${current.name}` });
            }
        }
    }

    checkInvariants(state) {
        const problems = [];
        const playerIds = new Set(state.players.map(p => p.userId));
        const corpIds = new Set((state.corporations || []).map(c => c.id));
        const groups = {};
        state.properties.forEach(p => { (groups[p.color] = groups[p.color] || []).push(p); });
        for (const p of state.players) {
            if (!Number.isFinite(Number(p.cash))) problems.push(`${p.name} cash is ${p.cash}`);
            if (!(p.position >= 0 && p.position < 40)) problems.push(`${p.name} position ${p.position}`);
            const listed = new Set((p.properties || []).map(x => x.id));
            const owned = new Set(state.properties.filter(x => x.ownerId === p.userId).map(x => x.id));
            for (const id of owned) if (!listed.has(id)) problems.push(`${id} is owned by ${p.name} but missing from their property list`);
            for (const id of listed) if (!owned.has(id)) problems.push(`${p.name} lists ${id} but the board says owner ${state.properties.find(x => x.id === id)?.ownerName || 'nobody'}`);
            if (p.bankrupt && (p.properties || []).length) problems.push(`${p.name} is bankrupt but still lists properties`);
            for (const d of p.debts || []) if (!Number.isFinite(Number(d.principal)) || Number(d.principal) < 0) problems.push(`${p.name} has debt with principal ${d.principal}`);
        }
        for (const prop of state.properties) {
            if (prop.ownerId && !playerIds.has(prop.ownerId) && !corpIds.has(prop.ownerId) && !(state.corporations || []).some(c => (c.assets || []).some(a => (a.id || a) === prop.id))) {
                problems.push(`${prop.name} owner ${prop.ownerId} is neither a player nor a corporation`);
            }
            const houses = Number(prop.houses || 0);
            if (houses < 0 || houses > 5 || !Number.isInteger(houses)) problems.push(`${prop.name} has ${prop.houses} houses`);
            if (houses > 0) {
                const group = groups[prop.color] || [];
                if (!group.every(g => g.ownerId && g.ownerId === prop.ownerId)) problems.push(`${prop.name} has houses but its ${prop.color} group is not owned by one owner`);
            }
        }
        const engineProblem = rules.validateStateInvariants(state);
        if (engineProblem) problems.push(`engine invariant: ${engineProblem}`);
        const current = state.players[state.currentPlayerIndex];
        if (!current) problems.push(`currentPlayerIndex ${state.currentPlayerIndex} has no player`);
        else if (current.bankrupt && !state.ended) problems.push(`current player ${current.name} is bankrupt`);
        const active = state.players.filter(p => !p.bankrupt);
        if (active.length <= 1 && !state.ended) problems.push('one player left but the game has not ended');
        for (const corp of state.corporations || []) {
            const held = (corp.shareholders || []).reduce((n, h) => n + Number(h.shares || 0), 0);
            if (held > Number(corp.totalShares || 0)) problems.push(`${corp.ticker} shareholders hold ${held} of ${corp.totalShares} shares`);
            if (!Number.isFinite(Number(corp.cash))) problems.push(`${corp.ticker} cash is ${corp.cash}`);
        }
        return problems;
    }

    runInvariants(context) {
        const { state } = this.server();
        for (const problem of this.checkInvariants(state)) {
            if (this.invariantSeen.has(problem)) continue;
            this.invariantSeen.add(problem);
            this.ctx.finding({ severity: 'high', category: 'state', title: 'Game state invariant broken', detail: `${problem} (after ${context})` });
        }
    }

    // ----- decisions, each performed through the UI -----

    async handleOffers() {
        const { state } = this.server();
        if (state.marketOffers?.some(o => o.status === 'pending')) await this.restoreOffline();
        // An offer past its expiry shows "expired" with no Accept/Decline; the next action clears it.
        const pending = (state.marketOffers || []).filter(o => o.status === 'pending' && !(Date.parse(o.expiresAt) <= Date.now()));
        for (const offer of pending) {
            const recipientId = offer.proposedById === offer.player1Id ? offer.player2Id : offer.player1Id;
            const seat = this.seatById(recipientId);
            if (!seat || seat.human) continue;
            await this.marketTab(seat, 'proposals');
            await this.firstTime('trade-offer-received', [seat], 'trade-offer-recipient');
            let accept = this.chance(0.55);
            if (this.explore?.wants('trade.decline') && !this.explore.wants('trade.accept')) accept = false;
            if (this.explore?.wantsAny('trade.accept', 'trade.property-swap', 'trade.jail-card') && !this.explore.wants('trade.decline')) accept = true;
            if (this.explore?.holdingOffersFor(state, 'trade.expire')) continue;
            const button = seat.page.locator(`#tradeOffersList [data-game-action="${accept ? 'accept-trade-offer' : 'cancel-trade-offer'}"][data-offer-id="${offer.id}"]`);
            if (await this.usable(button)) {
                await this.act(seat, accept ? 'accept trade' : 'decline trade', () => button.click(), { allowRejection: true });
            } else {
                this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Trade offer made to this player has no Accept/Decline button', detail: `offer ${offer.id} from ${offer.proposedByName}` });
                await this.ctx.shot(seat, 'trade-offer-missing-buttons');
            }
            await this.gameTab(seat);
        }
    }

    async handleAuction() {
        // Everyone may be needed to bid or pass, so a seat cut off by resilience() comes back now.
        await this.restoreOffline();
        let failures = 0;
        for (let guard = 0; guard < 60 && failures < 3; guard++) {
            const { state } = this.server();
            const auction = state.auction;
            if (!auction || auction.status !== 'open') return true;
            const prop = state.properties.find(p => p.id === auction.propertyId) || {};
            const bidders = state.players.filter(p => !p.bankrupt && !(auction.passedPlayerIds || []).includes(p.userId) && auction.highBidderId !== p.userId);
            const botBidders = bidders.map(p => this.seatById(p.userId)).filter(s => s && !s.human);
            if (!bidders.length) {
                // Nobody may bid or pass, yet the auction is still open.
                this.ctx.finding({
                    severity: 'high', category: 'game-rule',
                    title: 'Auction stays open when only the high bidder is left',
                    detail: `${prop.name}: everyone else passed before ${auction.highBidderName || 'nobody'} bid $${auction.currentBid}; no player has a Bid or Pass button and End Turn is blocked`,
                });
                for (const seat of this.seats.slice(0, 2)) await this.ctx.shot(seat, 'auction-deadlock');
                const host = this.seats[0];
                if (host.human) {
                    // Never act on an agent's screen. Give it 3 minutes to Cancel Auction itself,
                    // then the harness cancels through the API and says so in the game log.
                    this.ctx.log('    auction deadlock: host is an agent seat; waiting up to 3 min for it to cancel');
                    if (await this.waitForHuman('auction deadlock (host may cancel)', [host], 180000)) continue;
                    await this.ctx.harnessAction('host_cancel_auction', {}, 'Test harness cancelled an auction stuck by the known "only the high bidder is left" bug');
                    continue;
                }
                this.ctx.log('    auction deadlock: harness cancels it as host to keep the game going');
                await this.gameTab(host);
                await this.act(host, 'host cancels stuck auction', () => this.gameButton(host, 'host-cancel-auction').click());
                continue;
            }
            if (!botBidders.length) {
                const humans = bidders.map(p => this.seatById(p.userId)).filter(x => x && x.human);
                if (!(await this.waitForHuman('auction', humans))) return false;
                continue;
            }
            const mode = this.explore ? this.explore.auctionMode(auction) : null;
            if (mode === 'host-cancel') {
                const host = this.seats[0];
                await this.gameTab(host);
                await this.act(host, 'host cancels auction', () => this.gameButton(host, 'host-cancel-auction').click(), { allowRejection: true });
                continue;
            }
            if (mode === 'timeout' && auction.highBidderId) {
                await this.explore.waitOutAuction();
                this.explore.active = null;
            }
            const seat = this.pick(botBidders);
            const me = state.players.find(p => p.userId === seat.userId);
            await this.gameTab(seat);
            await this.firstTime('auction', [seat, this.seats.find(s => s !== seat)].filter(Boolean), 'auction-panel');
            const bid = Number(auction.currentBid || 0) + 5 + Math.floor(this.rand() * 40);
            const ceiling = Number(prop.price || 100) * (0.6 + this.rand() * 0.7);
            const bidNow = mode === 'no-sale' ? false : mode === 'timeout' ? !auction.highBidderId : bid <= Number(me.cash) - 50 && bid <= ceiling && this.chance(0.65);
            if (bidNow) {
                const input = seat.page.locator('#auctionBidAmount');
                const r = await this.act(seat, 'bid in auction', async () => {
                    await input.fill(String(bid));
                    await this.gameButton(seat, 'place-auction-bid').click();
                }, { allowRejection: true });
                if (r.failed) failures++;
            } else {
                const r = await this.act(seat, 'pass auction', () => this.gameButton(seat, 'pass-auction').click(), { allowRejection: true });
                if (r.failed) failures++;
            }
        }
        this.ctx.finding({ severity: 'high', category: 'stuck', title: 'Auction did not resolve after 60 bids/passes', detail: JSON.stringify(this.server().state.auction).slice(0, 400) });
        return false;
    }

    // Waits for a human seat to act. Returns false if it stayed idle too long.
    // `seats`: the human seats this wait is for; only they are taken over if they stay idle.
    async waitForHuman(what, seats = this.seats.filter(s => s.human), idleMs = this.humanIdleMs) {
        if (!seats.some(s => s.human)) return false;
        const start = this.server().version;
        const deadline = Date.now() + idleMs;
        this.status.phase = `waiting for human seat (${what})`;
        while (Date.now() < deadline && !this.stopRequested) {
            await sleep(1000);
            if (this.server().version !== start) return true;
        }
        if (idleMs < this.humanIdleMs) return false;
        const names = seats.filter(s => s.human).map(s => s.name).join(', ');
        this.ctx.finding({ severity: 'low', category: 'harness', title: `Human seat idle for ${Math.round(idleMs / 60000)} min during ${what}`, detail: `Autoplay took over ${names}.` });
        seats.forEach(s => { s.human = false; });
        return false;
    }

    async buyOrAuction(seat, me, state) {
        const propId = BOARD_PROPERTY_AT[me.position];
        const prop = state.properties.find(p => p.id === propId);
        const reserve = 80 + Math.floor(this.rand() * 250);
        let buy = prop && Number(me.cash) - Number(prop.price) >= reserve && this.chance(0.85);
        if (this.explore?.active?.auctionWait || this.explore?.auctionInstead(prop)) buy = false;
        await this.gameButton(seat, 'open-buy-property').click();
        await seat.page.locator('#buyPropertyModal').waitFor({ state: 'visible' });
        await this.firstTime('buy-modal', [seat], 'buy-property-modal');
        // "Who's buying?": a company the player runs, when exploration wants that path.
        const forCorp = this.explore?.wants('desk.buy-for-corp') && seat.page.locator('#buyForChoices input[name="buyFor"]:not([value=""]):not(:disabled)').first();
        if (forCorp && await forCorp.count()) {
            buy = true;
            await forCorp.check();
            await this.firstTime('buy-for-corp', [seat], 'buy-property-for-corporation');
        }
        if (buy) {
            await this.act(seat, forCorp && await forCorp.count() ? 'buy property for a company' : 'buy property', () => seat.page.locator('#confirm-purchase-btn').click());
        } else {
            await this.act(seat, 'start auction', () => seat.page.locator('#start-auction-btn').click());
        }
        await this.closeModals(seat);
    }

    // opts.opened: the House sheet is already open (Build houses for <ticker>); opts.cash: the builder's cash.
    async buyHouses(seat, me, opts = {}) {
        if (!opts.opened) await this.gameButton(seat, 'open-house').click();
        const cash = opts.cash ?? Number(me.cash);
        const modal = seat.page.locator('#houseModal');
        await modal.waitFor({ state: 'visible' });
        await this.firstTime('house-modal', [seat], 'house-modal');
        const plus = modal.locator('[data-game-action="adjust-house"][data-delta="1"]');
        const n = await plus.count();
        const aimHotel = this.explore?.wantsAny('houses.hotel', 'rent.hotel');
        const budget = Math.max(1, Math.min(aimHotel ? n * 5 : n * 2, Math.floor((cash - (aimHotel ? 50 : 200)) / 150)));
        for (let i = 0; i < budget; i++) {
            const button = plus.nth(i % n);
            if (await button.isEnabled()) await button.click();
        }
        // Step back down until the modal's own total fits the cash, keeping $50 spare.
        const minus = modal.locator('[data-game-action="adjust-house"][data-delta="-1"]');
        for (let i = 0; i < n * 5; i++) {
            const total = await modal.locator('#houseModalTotal').innerText().catch(() => '');
            const cost = Number((/Total cost: \$([\d.]+)/.exec(total) || [])[1] || 0);
            if (cost <= cash - 50) break;
            const enabled = [];
            for (let j = 0; j < n; j++) if (await minus.nth(j).isEnabled()) enabled.push(j);
            if (!enabled.length) break;
            await minus.nth(enabled[enabled.length - 1]).click();
        }
        await this.act(seat, opts.label || 'buy houses', () => modal.locator('#confirm-house-purchase-btn').click(), { allowRejection: true });
        await this.closeModals(seat);
    }

    // The borrowing limit the Debt page shows (#loanLimit or #refinanceLimit):
    // loans can total 90% of the borrower's portfolio. Whole dollars, or null.
    async borrowingLimit(seat, textId = 'loanLimit') {
        const text = await seat.page.locator(`#${textId}`).innerText().catch(() => '');
        const limit = Number((/up to \$([\d,.]+)/.exec(text) || [])[1]?.replace(/,/g, ''));
        return Number.isFinite(limit) ? Math.floor(limit) : null;
    }

    async issueDebt(seat, amount, withinLimit = true, opts = {}) {
        await this.gameButton(seat, 'open-debt').click();
        const modal = seat.page.locator('#debtModal');
        await modal.waitFor({ state: 'visible' });
        await this.firstTime('debt-modal', [seat], 'debt-modal');
        await seat.page.locator('#debtAction').selectOption('issue');
        const limit = withinLimit ? await this.borrowingLimit(seat) : null;
        if (withinLimit && !limit) {
            this.ctx.log(`    ${seat.name}: nothing left to borrow against`);
            return this.closeModals(seat);
        }
        await seat.page.locator('#loanAmount').fill(String(limit ? Math.min(amount, limit) : amount));
        await this.pickLoanTerm(seat, 'loanTerms', opts);
        const autopay = opts.autopay ?? this.chance(0.8);
        await seat.page.locator('#loanAutopay').setChecked(autopay);
        await this.act(seat, `issue debt (autopay ${autopay ? 'on' : 'off'})`, () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true });
        await this.closeModals(seat);
    }

    // Picks a loan term (5, 10 or 15 turns) in a term list, at random unless given.
    async pickLoanTerm(seat, containerId, opts = {}) {
        const term = opts.term || this.pick([5, 10, 15]);
        const radio = seat.page.locator(`#${containerId}-${term}`);
        if (await radio.count()) await radio.check();
        return term;
    }

    // The first loan row on the Debt page's "Your loans" view, or null.
    async openLoans(seat) {
        if (!(await this.usable(this.gameButton(seat, 'open-debt')))) return null;
        await this.gameButton(seat, 'open-debt').click();
        await seat.page.locator('#debtModal').waitFor({ state: 'visible' });
        await seat.page.locator('#debtAction').selectOption('loans');
        await this.firstTime('loan-list', [seat], 'loan-list');
        const row = seat.page.locator('#loanList .loan-row').first();
        return (await row.count()) ? row : null;
    }

    // Pays the loan off if there is the cash, otherwise pays part of it.
    async settleDebt(seat, { partial = false } = {}) {
        const row = await this.openLoans(seat);
        if (!row) return this.closeModals(seat);
        const payoff = row.locator('[data-loan-payoff]');
        if (!partial && await this.usable(payoff)) {
            await this.act(seat, 'pay off a loan', () => payoff.click(), { allowRejection: true });
        } else {
            const balance = Number((await row.locator('.loan-balance').innerText()).replace(/[^\d.]/g, ''));
            await row.locator('input[type="number"]').fill(String(Math.max(1, Math.floor(balance / 2))));
            await this.act(seat, 'pay part of a loan', () => row.locator('[data-loan-pay]').click(), { allowRejection: true });
        }
        await this.closeModals(seat);
    }

    // Flips autopay on the first loan (allowed off-turn too).
    async toggleAutopay(seat, on) {
        const row = await this.openLoans(seat);
        if (!row) return this.closeModals(seat);
        const toggle = row.locator('[data-loan-autopay]');
        if (await this.usable(toggle) && (await toggle.isChecked()) !== on) {
            await this.act(seat, `turn autopay ${on ? 'on' : 'off'}`, () => toggle.setChecked(on), { allowRejection: true });
        }
        await this.closeModals(seat);
    }

    async createIpo(seat, me) {
        const props = (me.properties || []);
        if (!props.length) return;
        await this.gameButton(seat, 'open-ipo').click();
        await seat.page.locator('#ipoModal').waitFor({ state: 'visible' });
        await this.firstTime('ipo-modal', [seat], 'ipo-modal');
        const ticker = `${seat.name.slice(0, 3).toUpperCase()}${Math.floor(this.rand() * 90 + 10)}`;
        await seat.page.locator('#ipoTicker').fill(ticker);
        const asset = seat.page.locator(`#ipo-asset-${props[0].id}`);
        if (await asset.count()) await asset.check();
        else await seat.page.locator('#ipoAssets input[type="checkbox"]').first().check();
        await this.act(seat, 'create IPO', () => seat.page.locator('#create-ipo-btn').click(), { allowRejection: true });
        await this.closeModals(seat);
    }

    // Corporations → Add properties to <ticker>: tick the first free property and
    // take new shares when they're on offer, otherwise give it.
    async addToCorporation(seat, corp) {
        await this.gameButton(seat, 'open-corporation').click();
        await seat.page.locator('#corporationModal').waitFor({ state: 'visible' });
        const open = seat.page.locator(`#corporationModal [data-game-action="open-add-to-corporation"][data-corp-id="${corp.id}"]`);
        if (!(await this.usable(open))) return this.closeModals(seat);
        await open.click();
        await seat.page.locator('#addToCorpModal').waitFor({ state: 'visible' });
        await this.firstTime('add-to-corp-modal', [seat], 'add-to-corp-modal');
        const box = seat.page.locator('#addToCorpAssets input[type="checkbox"]:not(:disabled)').first();
        if (!(await box.count())) return this.closeModals(seat);
        await box.check();
        const shares = seat.page.locator('#addToCorpShares input[value="shares"]');
        if (await this.usable(shares)) await shares.check();
        await this.act(seat, 'add property to corporation', () => seat.page.locator('#add-to-corp-btn').click(), { allowRejection: true });
        await this.closeModals(seat);
    }

    // Treasury shares sell at the corporation's price; shares a player holds are
    // bought by offering cash for them in the Market, which the holder may accept.
    async buyShares(seat, corp, wanted = 1) {
        await this.gameButton(seat, 'open-corporation').click();
        const modal = seat.page.locator('#corporationModal');
        await modal.waitFor({ state: 'visible' });
        await this.firstTime('corporation-modal', [seat], 'corporation-modal');
        const input = seat.page.locator(`#buyShares-${corp.id}`);
        if (await input.count()) {
            await input.fill(String(Math.min(wanted, Number(corp.availableShares || 1))));
            await this.act(seat, 'buy treasury shares', () => modal.locator(`[data-game-action="buy-shares"][data-corp-id="${corp.id}"]`).click(), { allowRejection: true });
            return this.closeModals(seat);
        }
        await this.closeModals(seat);
        const { state } = this.server();
        const holder = (state.corporations.find(c => c.id === corp.id)?.shareholders || [])
            .filter(h => h.userId !== seat.userId && Number(h.shares) > 0)
            .sort((a, b) => b.shares - a.shares)[0];
        const me = state.players.find(p => p.userId === seat.userId);
        if (!holder || !me) return;
        const shares = Math.min(wanted, Number(holder.shares));
        const cash = Math.min(Math.floor(Number(me.cash) * 0.5), Math.round(shares * 50 * (0.8 + this.rand() * 0.6)));
        if (cash <= 0) return;
        await this.marketTab(seat, 'trade');
        await this.tradeParties(seat, seat.userId, holder.userId);
        await seat.page.locator('#player1Cash').fill(String(cash));
        await seat.page.locator('#player2Cash').fill('0');
        const sharesInput = seat.page.locator(`#player2-shares-${corp.id}`);
        if (!(await sharesInput.count())) return this.gameTab(seat);
        await sharesInput.fill(String(shares));
        await this.firstTime('share-offer', [seat], 'share-offer-form');
        await this.act(seat, `offer $${cash} for ${shares} ${corp.ticker} shares`, () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true });
        await this.gameTab(seat);
    }

    // Market: who trades with whom, each for themselves. A company is its own
    // option ("corp:<id>") in the same dropdowns, so picking a player trades personally.
    async tradeParties(seat, player1Id, player2Id) {
        await seat.page.locator('#player1Select').selectOption({ value: player1Id });
        await seat.page.locator('#player2Select').selectOption({ value: player2Id });
    }

    async proposeTrade(seat, me, state) {
        const others = state.players.filter(p => !p.bankrupt && p.userId !== me.userId && (p.properties || []).length);
        if (!others.length) return;
        // Prefer a property that completes one of my colour groups, so houses get exercised.
        const mine = new Set((me.properties || []).map(p => p.color));
        const completing = others.flatMap(o => o.properties.filter(p => mine.has(p.color)).map(p => ({ o, p })));
        const choice = completing.length && this.chance(0.7) ? this.pick(completing) : (() => { const o = this.pick(others); return { o, p: this.pick(o.properties) }; })();
        const target = choice.o;
        const wanted = choice.p;
        const offer = Math.min(Math.floor(Number(me.cash) * 0.4), Math.round(Number(wanted.value || 100) * (1 + this.rand() * 0.5)));
        if (offer <= 0) return;
        await this.marketTab(seat, 'trade');
        await this.tradeParties(seat, me.userId, target.userId);
        await seat.page.locator('#player1Cash').fill(String(offer));
        await seat.page.locator('#player2Cash').fill('0');
        // Streets in built colour groups are greyed out (they can't be traded): leave those.
        const box = seat.page.locator(`#player2-asset-${wanted.id}:not([disabled])`);
        if (await box.count()) await box.check();
        await this.firstTime('trade-form', [seat], 'market-trade-form');
        await this.act(seat, 'propose trade', () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true });
        await this.gameTab(seat);
    }

    async manualPayment(seat, state) {
        const others = state.players.filter(p => !p.bankrupt && p.userId !== seat.userId);
        if (!others.length) return;
        const to = this.pick(others);
        await this.marketTab(seat, 'payment');
        await seat.page.locator('#paymentToPlayer').selectOption({ value: to.userId });
        await seat.page.locator('#paymentAmount').fill(String(5 + Math.floor(this.rand() * 20)));
        await this.act(seat, 'manual payment', () => seat.page.locator('#makePaymentBtn').click(), { allowRejection: true });
        await this.gameTab(seat);
    }

    async pauseAndResume(host) {
        await this.gameTab(host);
        await this.act(host, 'pause game', () => this.gameButton(host, 'host-pause').click());
        await this.firstTime('paused', this.seats.slice(0, 2), 'game-paused');
        await this.act(host, 'resume game', () => this.gameButton(host, 'host-resume').click());
    }

    // Reload one waiting player and cut another's network briefly; both should catch up.
    async resilience(currentSeat) {
        const others = this.seats.filter(s => s !== currentSeat && !s.human);
        if (!this.resilienceDone.reload && others[0]) {
            this.resilienceDone.reload = true;
            const seat = others[0];
            await seat.page.reload();
            await seat.page.locator('#gameContent').filter({ hasText: 'Current Turn:' }).waitFor({ timeout: 20000 }).catch(async () => {
                this.ctx.finding({ severity: 'high', category: 'sync', seat, title: 'Game did not load after a page reload', detail: 'No "Current Turn:" within 20s' });
                await this.ctx.shot(seat, 'reload-failed');
            });
            this.ctx.log(`    resilience: reloaded ${seat.name}`);
            this.ctx.markUi('ui.reload-resync');
        }
        if (!this.resilienceDone.offline && others[1]) {
            this.resilienceDone.offline = true;
            const seat = others[1];
            seat.offline = true;
            await seat.context.setOffline(true);
            this.ctx.log(`    resilience: ${seat.name} offline for this turn`);
            seat.reconnectAfterTurn = true;
        }
    }

    // A player moves to another phone with a transfer code, and a guest rejoins by room code.
    async moveDevices(currentSeat) {
        this.resilienceDone.moves = true;
        const idle = this.seats.filter(s => s !== currentSeat && !s.human && !s.offline);
        const mover = idle.find(s => s.kind === 'email') || idle[0];
        if (mover) {
            try {
                await transferDevice(this.ctx, mover);
                this.ctx.log(`    resilience: ${mover.name} moved to a new browser with a transfer code`);
                this.ctx.markUi('ui.device-transfer');
            } catch (err) {
                this.ctx.finding({ severity: 'high', category: 'sync', seat: mover, title: 'Moving to another device did not land in the game', detail: String(err.message || err).split('\n')[0] });
                await this.ctx.shot(mover, 'device-transfer-failed');
            }
        }
        const guest = idle.find(s => s.kind === 'guest' && s !== mover);
        if (guest) {
            try {
                await rejoinAsGuest(this.ctx, guest, this.table.inviteCode, this.seats.filter(s => s !== guest && !s.human));
                this.ctx.log(`    resilience: ${guest.name} rejoined from a new browser as an existing guest`);
                this.ctx.markUi('ui.rejoin-guest');
            } catch (err) {
                this.ctx.finding({ severity: 'high', category: 'sync', seat: guest, title: 'A guest could not rejoin their seat from a new browser', detail: String(err.message || err).split('\n')[0] });
                await this.ctx.shot(guest, 'guest-rejoin-failed');
            }
        }
    }

    async restoreOffline() {
        for (const seat of this.seats.filter(s => s.reconnectAfterTurn)) {
            seat.reconnectAfterTurn = false;
            await seat.context.setOffline(false);
            setTimeout(() => { seat.offline = false; }, 3000);
            const { version } = this.server();
            const deadline = Date.now() + 20000;
            let v = -1;
            while (Date.now() < deadline) {
                v = await this.pageVersion(seat);
                if (v >= version) break;
                await sleep(500);
            }
            if (v < version) {
                this.ctx.finding({ severity: 'high', category: 'sync', seat, title: 'Screen did not catch up after the network came back', detail: `server v${version}, seat v${v} 20s after reconnecting` });
                await this.ctx.shot(seat, 'offline-no-resync');
            } else {
                this.ctx.log(`    resilience: ${seat.name} back online and caught up (v${v})`);
                this.ctx.markUi('ui.offline-resync');
            }
        }
    }

    // Plays the current bot seat's whole turn.
    async playTurn(seat) {
        await this.gameTab(seat);
        const optionalDone = new Set();
        let chaosSteps = 0;
        if (this.explore) {
            this.explore.active = null;
            await this.explore.maybeStage(seat, this.server().state);
        }
        for (let step = 0; step < 25; step++) {
            await this.handleOffers();
            if (this.explore) {
                await this.explore.handleVotes();
                await this.explore.handleCorpRequests();
                await this.explore.hostCancelOffers();
            }
            let { state } = this.server();
            if (state.ended) return 'ended';
            if (state.auction?.status === 'open') { await this.handleAuction(); continue; }
            const current = state.players[state.currentPlayerIndex];
            if (current.userId !== seat.userId) return 'done';
            const me = current;
            // At most 3 chaos moves a turn, so the game still moves on.
            if (this.chaos && chaosSteps < 3 && this.chance(this.chaos)) {
                chaosSteps++;
                await this.chaosEngine.step(seat);
                continue;
            }
            await this.gameTab(seat);

            if (!me.diceRolled) {
                if (me.inJail) {
                    await this.firstTime('jail', [seat], 'in-jail');
                    const guided = this.explore ? this.explore.jailChoice(me) : null;
                    if (guided === 'card' && await this.usable(this.gameButton(seat, 'use-jail-card'))) {
                        await this.act(seat, 'use jail card', () => this.gameButton(seat, 'use-jail-card').click());
                        continue;
                    }
                    if (guided === 'fine' && await this.usable(this.gameButton(seat, 'pay-jail-fine'))) {
                        await this.act(seat, 'pay jail fine', () => this.gameButton(seat, 'pay-jail-fine').click());
                        continue;
                    }
                    if (guided === 'roll') {
                        await this.act(seat, 'roll for doubles', () => this.gameButton(seat, 'roll-dice').click());
                        continue;
                    }
                    if (me.hasGetOutOfJailCard && await this.usable(this.gameButton(seat, 'use-jail-card')) && this.chance(0.7)) {
                        await this.act(seat, 'use jail card', () => this.gameButton(seat, 'use-jail-card').click());
                        continue;
                    }
                    if (Number(me.cash) > 200 && this.chance(0.5) && await this.usable(this.gameButton(seat, 'pay-jail-fine'))) {
                        await this.act(seat, 'pay jail fine', () => this.gameButton(seat, 'pay-jail-fine').click());
                        continue;
                    }
                }
                // Only before the roll may a chairman switch the rent policy alone.
                if (this.explore && !me.inJail && !optionalDone.has('before-roll')) {
                    optionalDone.add('before-roll');
                    try {
                        if (await this.explore.beforeRoll(seat, me, state)) continue;
                    } catch (err) {
                        this.ctx.finding({ severity: 'low', category: 'harness', seat, title: 'Explore before-roll action failed', detail: String(err.message || err).split('\n')[0] });
                        await this.closeModals(seat);
                    }
                }
                const roll = this.gameButton(seat, 'roll-dice');
                if (!(await this.usable(roll))) {
                    this.ctx.finding({ severity: 'high', category: 'ui', seat, title: 'It is my turn and I have not rolled, but there is no usable Roll Dice button', detail: '' });
                    await this.ctx.shot(seat, 'no-roll-button');
                    return 'stuck';
                }
                await this.act(seat, me.inJail ? 'roll for doubles' : 'roll dice', () => roll.click());
                await this.firstTime('after-roll', [seat], 'after-roll');
                continue;
            }

            if (await this.usable(this.gameButton(seat, 'open-buy-property'))) {
                await this.buyOrAuction(seat, me, state);
                continue;
            }

            const claim = Number(state.bankruptcyClaims?.[me.userId]?.unpaidAmount || 0);
            if ((Number(me.cash) < 0 || claim > 0) && !optionalDone.has('rescue') && (!this.explore || this.explore.rescue())) {
                optionalDone.add('rescue');
                await this.firstTime('negative-cash', [seat], 'negative-cash-warning');
                await this.issueDebt(seat, Math.ceil(Math.max(-Number(me.cash), 0) + claim + 50), true);
                continue;
            }

            const options = [];
            if (!optionalDone.has('houses') && Number(me.cash) > 450 && await this.usable(this.gameButton(seat, 'open-house'))) options.push(['houses', 0.7]);
            if (!optionalDone.has('debt') && (me.debts || []).length < 2) options.push(['debt', Number(me.cash) < 250 ? 0.5 : 0.04]);
            if (!optionalDone.has('settle') && Number(me.cash) > 900 && (me.debts || []).length) options.push(['settle', 0.5]);
            if (!optionalDone.has('ipo') && (me.properties || []).length >= 2 && !(state.corporations || []).some(c => c.founderId === me.userId)) options.push(['ipo', 0.12]);
            const buyable = (state.corporations || []).filter(c => !c.insolvent && (Number(c.availableShares || 0) > 0 || (c.shareholders || []).some(h => h.userId !== me.userId && Number(h.shares) > 0)));
            if (!optionalDone.has('shares') && buyable.length && Number(me.cash) > 400) options.push(['shares', 0.25]);
            const runCorps = (state.corporations || []).filter(c => !c.insolvent && c.chairmanId === seat.userId);
            if (!optionalDone.has('addcorp') && runCorps.length && (me.properties || []).length) options.push(['addcorp', 0.15]);
            if (!optionalDone.has('trade')) options.push(['trade', 0.1]);
            if (!optionalDone.has('pay')) options.push(['pay', 0.02]);
            const host = this.seats[0];
            if (!this.resilienceDone.pause && seat === host && this.status.round >= Math.ceil(this.rounds / 2)) options.push(['pause', 1]);

            // Exploration adds actions that lead to unreached pathways, ahead of the usual ones.
            const base = new Set(options.map(([k]) => k));
            if (this.explore) options.unshift(...this.explore.options(me, state, optionalDone).filter(([k]) => !base.has(k) || k === 'houses'));
            const chosen = options.find(([, p]) => this.chance(p));
            if (chosen) {
                const [kind] = chosen;
                optionalDone.add(kind);
                if (this.explore && !base.has(kind)) {
                    // One optional action going wrong must not end the game: log it and move on.
                    try {
                        await this.explore.run(kind, seat, me, state);
                    } catch (err) {
                        this.ctx.finding({ severity: 'low', category: 'harness', seat, title: `Explore action "${kind}" failed`, detail: String(err.message || err).split('\n')[0] });
                        await this.closeModals(seat);
                        await this.gameTab(seat).catch(() => {});
                    }
                    continue;
                }
                try {
                    if (kind === 'houses') await this.buyHouses(seat, me);
                    if (kind === 'debt') await this.issueDebt(seat, 100 + Math.floor(this.rand() * 300), true);
                    if (kind === 'settle') await this.settleDebt(seat);
                    if (kind === 'ipo') await this.createIpo(seat, me);
                    if (kind === 'shares') await this.buyShares(seat, this.pick(buyable));
                    if (kind === 'addcorp') await this.addToCorporation(seat, this.pick(runCorps));
                    if (kind === 'trade') await this.proposeTrade(seat, me, state);
                    if (kind === 'pay') await this.manualPayment(seat, state);
                    if (kind === 'pause') { this.resilienceDone.pause = true; await this.pauseAndResume(seat); }
                } catch (err) {
                    this.ctx.finding({ severity: 'low', category: 'harness', seat, title: `Optional action "${kind}" failed`, detail: String(err.message || err).split('\n')[0] });
                    await this.closeModals(seat);
                    await this.gameTab(seat).catch(() => {});
                }
                continue;
            }

            const end = this.gameButton(seat, 'end-turn');
            if (!(await this.usable(end))) {
                this.ctx.finding({ severity: 'high', category: 'ui', seat, title: 'Rolled, nothing pending, but End Turn is not usable', detail: await end.getAttribute('title').catch(() => '') || '' });
                await this.ctx.shot(seat, 'end-turn-unusable');
                return 'stuck';
            }
            const label = (await end.innerText()).trim();
            if (/bankrupt/i.test(label)) await this.firstTime('declare-bankruptcy', [seat], 'declare-bankruptcy-button');
            await this.act(seat, /bankrupt/i.test(label) ? 'declare bankruptcy' : 'end turn', () => end.click());
            if (/bankrupt/i.test(label)) await this.firstTime('liquidation', this.seats, 'after-bankruptcy');
            return 'done';
        }
        this.ctx.finding({ severity: 'medium', category: 'stuck', seat, title: 'Turn took more than 25 steps', detail: '' });
        return 'stuck';
    }

    allDone(state) {
        const active = state.players.filter(p => !p.bankrupt);
        return active.every(p => (this.turns[p.userId] || 0) >= this.rounds);
    }

    async run() {
        const started = this.startedAt = Date.now();
        this.status.phase = 'playing';
        let lastVersion = -1;
        let lastProgress = Date.now();
        while (!this.stopRequested) {
            const { state, version } = this.server();
            if (version !== lastVersion) { lastVersion = version; lastProgress = Date.now(); }
            if (state.ended) break;
            if (this.allDone(state)) break;
            if ((Date.now() - started) / 60000 > this.maxMinutes) {
                this.ctx.finding({ severity: 'low', category: 'harness', title: `Stopped at the ${this.maxMinutes} min time limit`, detail: `round ${this.status.round}` });
                break;
            }
            if (Date.now() - lastProgress > 90000) {
                this.ctx.finding({ severity: 'high', category: 'stuck', title: 'Game made no progress for 90s', detail: `v${version}, current ${state.players[state.currentPlayerIndex]?.name}, auction ${state.auction?.status || 'none'}` });
                for (const seat of this.seats) await this.ctx.shot(seat, 'stuck');
                break;
            }
            const current = state.players[state.currentPlayerIndex];
            const seat = this.seatById(current.userId);
            this.status.current = current.name;
            if (seat.human) {
                await this.handleOffers();
                if (state.auction?.status === 'open') { await this.handleAuction(); continue; }
                await this.waitForHuman(`${seat.name}'s turn`, [seat]);
            } else {
                if (this.status.turnsTotal === this.seats.length + 1) await this.resilience(seat);
                if (this.status.turnsTotal === this.seats.length * 2 + 1 && !this.resilienceDone.moves) await this.moveDevices(seat);
                const result = await this.playTurn(seat);
                if (result === 'stuck') {
                    for (const s of this.seats) await this.ctx.shot(s, 'stuck');
                    break;
                }
                await this.restoreOffline();
            }
            const after = this.server().state;
            if (after.currentPlayerIndex !== state.currentPlayerIndex || after.ended) {
                this.turns[current.userId] = (this.turns[current.userId] || 0) + 1;
                this.status.turnsTotal++;
                const round = Math.min(...after.players.filter(p => !p.bankrupt).map(p => this.turns[p.userId] || 0));
                this.runInvariants(`${current.name}'s turn ${this.turns[current.userId]}`);
                if (round > this.status.round) {
                    this.status.round = round;
                    this.ctx.log(`  == round ${round}/${this.rounds} complete (v${this.server().version}) ==`);
                    if (this.shotEvery && round % this.shotEvery === 0) {
                        for (const s of this.seats) await this.ctx.shot(s, `round-${round}`);
                        await this.boardShot(this.seats[0], `round-${round}-board`);
                    }
                }
            }
        }
        await this.restoreOffline();
        await this.finish();
        this.status.phase = 'done';
        this.status.minutes = ((Date.now() - started) / 60000).toFixed(1);
    }

    async boardShot(seat, name) {
        try {
            await this.closeModals(seat);
            await seat.page.locator('.nav-tab[data-section="board"]').click({ timeout: 5000 });
            await sleep(400);
            await this.ctx.shot(seat, name);
            await this.gameTab(seat);
        } catch (err) {
            this.ctx.log(`    (board shot skipped: ${String(err.message || err).split('\n')[0]})`);
        }
    }

    async finish() {
        const { state } = this.server();
        const host = this.seats[0];
        if (!state.ended && this.endWithHost) {
            await this.closeModals(host);
            await this.gameTab(host);
            await this.act(host, 'host ends game', () => this.gameButton(host, 'host-end').click());
        }
        for (const seat of this.seats) {
            const shown = await seat.page.locator('#winnerModal').isVisible().catch(() => false)
                || await seat.page.locator('#winnerModal').waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
            if (!shown && this.server().state.ended) {
                this.ctx.finding({ severity: 'high', category: 'ui', seat, title: 'Game over, but this player never saw the Game Over screen', detail: '' });
            }
            await this.ctx.shot(seat, 'game-over');
        }
        this.runInvariants('game end');
    }

    summary() {
        const timing = Object.fromEntries(Object.entries(this.actionMs).map(([k, list]) => {
            const sorted = [...list].sort((a, b) => a - b);
            return [k, { n: list.length, p50: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] }];
        }));
        const { state } = this.server();
        return {
            seed: this.seed,
            roundsTarget: this.rounds,
            roundsCompleted: this.status.round,
            turnsTotal: this.status.turnsTotal,
            minutes: this.status.minutes || ((Date.now() - (this.startedAt || Date.now())) / 60000).toFixed(1),
            ended: !!state.ended,
            players: state.players.map(p => ({ name: p.name, cash: p.cash, properties: (p.properties || []).length, debts: (p.debts || []).length, bankrupt: !!p.bankrupt, turns: this.turns[p.userId] || 0 })),
            standings: state.standings || null,
            chaos: this.chaos ? { probability: this.chaos, ...this.chaosEngine.summary() } : null,
            timing,
        };
    }
}

module.exports = { Autoplay };
