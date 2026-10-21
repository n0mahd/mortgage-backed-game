'use strict';

// Coverage-guided play (`--explore`): before each bot decision, look at which
// pathways the game hasn't reached yet and lean towards them. Rare situations
// that ordinary play almost never reaches get a staged setup (lib/stages.js)
// at the start of a bot turn, and are then played out through the UI. Also
// holds the UI actions only exploration uses: refinancing, corporate debt,
// chairman votes, withdrawing or host-cancelling offers, property swaps and
// jail-card trades.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Explore {
    constructor(bot, { stageRate = 0.35, maxStageTries = 2 } = {}) {
        this.bot = bot;
        this.stageRate = stageRate;
        this.maxStageTries = maxStageTries;
        this.stageTries = {};
        this.active = null;
        this.uncoveredCache = new Set();
    }

    get ctx() { return this.bot.ctx; }

    refresh() {
        const cov = this.ctx.coverageNow();
        this.uncoveredCache = new Set(cov.filter(c => !c.hits).map(c => c.id));
        this.cov = cov;
        return this.uncoveredCache;
    }

    wants(id) { return this.uncoveredCache.has(id); }
    wantsAny(...ids) { return ids.some(id => this.uncoveredCache.has(id)); }

    // Boost a probability when the action leads to an unreached pathway.
    p(base, ...ids) { return this.wantsAny(...ids) ? Math.max(base, 0.85) : base; }

    // At the start of a bot seat's turn: maybe stage a rare situation.
    async maybeStage(seat, state) {
        const bot = this.bot;
        this.refresh();
        await this.ctx.restoreStages(this.cov);
        const me = state.players[state.currentPlayerIndex];
        if (me.diceRolled || me.inJail || state.auction?.status === 'open' || !bot.chance(this.stageRate)) return null;
        const active = state.players.filter(p => !p.bankrupt).length;
        const candidates = this.cov
            .filter(c => !c.hits && c.stage && (this.stageTries[c.stage] || 0) < this.maxStageTries)
            // Bankruptcy stages end games: keep them for the last third, and never with 2 players left unless it is the point.
            .filter(c => !/near-bankrupt|broke-to-bank|bankrupt-chairman|last-two/.test(c.stage) || bot.status.round >= Math.floor(bot.rounds * 2 / 3))
            .filter(c => !(/near-bankrupt|broke-to-bank/.test(c.stage) && active <= 2 && !this.wants('end.last-player')));
        if (!candidates.length) return null;
        const pick = bot.pick(candidates);
        this.stageTries[pick.stage] = (this.stageTries[pick.stage] || 0) + 1;
        let entry = null;
        try {
            entry = await this.ctx.applyStage(pick.stage, { reason: `explore: ${pick.id}`, rand: bot.rand, uncovered: this.uncoveredCache });
        } catch (err) {
            this.ctx.log(`    stage ${pick.stage} skipped: ${err.message}`);
        }
        if (entry) {
            this.active = { ...entry, pathway: pick.id };
            // The staged state reached every screen; give them a moment to re-render.
            await bot.syncCheck(`stage ${pick.stage}`);
        }
        return entry;
    }

    // ----- decisions -----

    jailChoice(me) {
        if (me.hasGetOutOfJailCard && this.wants('jail.use-card')) return 'card';
        if (this.wants('trade.jail-card') && me.hasGetOutOfJailCard) return 'roll';
        if (this.wants('jail.pay-fine') && Number(me.cash) >= 50) return 'fine';
        if (this.wantsAny('jail.stay', 'jail.doubles-out', 'jail.forced-bail')) return 'roll';
        return null;
    }

    auctionInstead(prop) {
        if (!prop) return false;
        const kind = prop.color === 'Railroad' ? 'buy.railroad' : prop.color === 'Utility' ? 'buy.utility' : 'buy.street';
        if (this.wants(kind)) return false;
        return this.wantsAny('auction.start', 'auction.no-sale', 'auction.host-cancel', 'auction.won', 'auction.timeout') && this.bot.chance(0.6);
    }

    // How the bots should treat this auction: 'no-sale', 'host-cancel' or null (normal).
    auctionMode(auction) {
        if (this.active?.auctionWait) return 'timeout';
        if (!auction.highBidderId && this.wants('auction.no-sale')) return 'no-sale';
        if (this.wants('auction.host-cancel') && !this.bot.seats[0].human) return 'host-cancel';
        return null;
    }

    rescue() {
        // Survive a bankruptcy claim unless an unreached bankruptcy pathway is the point.
        if (this.active && /near-bankrupt|broke-to-bank|bankrupt-chairman/.test(this.active.name)) {
            return this.wants('bankrupt.claim-settled') || this.wants('bankrupt.claim-payment');
        }
        return true;
    }

    // Extra optional actions for this turn, as [kind, probability] like the bot's own list.
    options(me, state, done) {
        const bot = this.bot;
        const out = [];
        const myCorps = (state.corporations || []).filter(c => c.chairmanId === me.userId && !c.insolvent);
        const held = (state.corporations || []).filter(c => !c.insolvent && (c.shareholders || []).some(h => h.userId === me.userId && Number(h.shares) > 0));
        if (!done.has('refinance') && (me.debts || []).length && this.wants('debt.refinance')) out.push(['refinance', 0.8]);
        if (!done.has('corp-debt') && myCorps.length && this.wants('debt.issue-corporate')) out.push(['corp-debt', 0.8]);
        if (!done.has('majority') && held.some(c => this.holds(c, me) * 2 > c.totalShares) && this.wants('corp.chairman-majority')) out.push(['majority', 0.8]);
        if (!done.has('vote') && held.some(c => !(c.chairmanVotes || []).some(v => v.status === 'open')) && this.wantsAny('corp.vote-propose', 'corp.vote-passes')) out.push(['vote', 0.6]);
        const forSale = (state.corporations || []).filter(c => !c.insolvent && (c.shareholders || []).some(h => h.userId !== me.userId && Number(h.shares) > 0));
        if (!done.has('stake') && forSale.length && Number(me.cash) > 300 && this.wantsAny('corp.vote-propose', 'corp.vote-passes', 'corp.chairman-majority', 'corp.majority-gained', 'corp.share-offer')) out.push(['stake', 0.7]);
        const mineOpen = (state.marketOffers || []).some(o => o.status === 'pending' && o.proposedById === me.userId);
        if (!done.has('withdraw') && mineOpen && this.wants('trade.withdraw')) out.push(['withdraw', 0.9]);
        if (!done.has('swap') && (me.properties || []).length && this.wants('trade.property-swap')) out.push(['swap', 0.5]);
        if (!done.has('jail-card-trade') && me.hasGetOutOfJailCard && this.wants('trade.jail-card')) out.push(['jail-card-trade', 0.8]);
        if (!done.has('pay') && this.wants('payment.manual')) out.push(['pay', 0.5]);
        if (!done.has('ipo') && (me.properties || []).length && this.wantsAny('corp.ipo', 'debt.issue-corporate', 'corp.insolvent')) out.push(['ipo', 0.5]);
        if (!done.has('debt') && this.wantsAny('debt.issue', 'debt.interest', 'debt.pay', 'debt.refinance')) out.push(['debt', 0.6]);
        if (!done.has('settle') && (me.debts || []).length && this.wants('debt.pay')) out.push(['settle', 0.7]);
        if (!done.has('probe') && this.wantsAny('refuse.bid-over-cash', 'refuse.pay-over-cash', 'refuse.junk-amount', 'refuse.trade-not-owned')) out.push(['probe', 0.5]);
        if (!done.has('trade') && this.wantsAny('trade.propose', 'trade.accept', 'trade.decline', 'trade.withdraw', 'trade.host-cancel', 'trade.expire')) out.push(['trade', 0.35]);
        return out.filter(([, p]) => p > 0 && bot);
    }

    holds(corp, me) {
        return Number((corp.shareholders || []).find(h => h.userId === me.userId)?.shares || 0);
    }

    // ----- UI actions only exploration uses -----

    async run(kind, seat, me, state) {
        const bot = this.bot;
        if (kind === 'refinance') return this.refinance(seat, me);
        if (kind === 'corp-debt') return this.corporateDebt(seat, me, state);
        if (kind === 'majority') return this.changeChairman(seat, me, state);
        if (kind === 'vote') return this.proposeVote(seat, me, state);
        if (kind === 'stake') return this.buyStake(seat, me, state);
        if (kind === 'withdraw') return this.withdrawOffer(seat, me, state);
        if (kind === 'swap') return this.propertySwap(seat, me, state);
        if (kind === 'jail-card-trade') return this.jailCardTrade(seat, me, state);
        if (kind === 'pay') return bot.manualPayment(seat, state);
        if (kind === 'ipo') return bot.createIpo(seat, me);
        if (kind === 'debt') return bot.issueDebt(seat, 100 + Math.floor(bot.rand() * 200), true);
        if (kind === 'settle') return this.partialOrFullSettle(seat, me);
        if (kind === 'trade') return bot.proposeTrade(seat, me, state);
        if (kind === 'probe') return this.refusalProbe(seat, me, state);
        return null;
    }

    async openDebt(seat, action) {
        const bot = this.bot;
        if (!(await bot.usable(bot.gameButton(seat, 'open-debt')))) return false;
        await bot.gameButton(seat, 'open-debt').click();
        await seat.page.locator('#debtModal').waitFor({ state: 'visible' });
        await seat.page.locator('#debtAction').selectOption(action);
        return true;
    }

    async refinance(seat, me) {
        const bot = this.bot;
        if (!(await this.openDebt(seat, 'refinance'))) return;
        const boxes = seat.page.locator('#debtsToRefinance input[type="checkbox"]');
        if (!(await boxes.count())) return bot.closeModals(seat);
        await boxes.first().check();
        const principal = Math.ceil(Number(me.debts[0].principal || 0));
        const limit = await bot.pledge(seat, 'refinanceCollateralAssets');
        await seat.page.locator('#refinanceAmount').fill(String(limit ? Math.max(principal + 1, Math.min(limit, principal + 100)) : principal + 100));
        await bot.firstTime('refinance-form', [seat], 'refinance-form');
        await bot.act(seat, 'refinance debt', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true });
        await bot.closeModals(seat);
    }

    async corporateDebt(seat, me, state) {
        const bot = this.bot;
        const corp = state.corporations.find(c => c.chairmanId === me.userId && !c.insolvent);
        if (!corp || !(await this.openDebt(seat, 'issue'))) return;
        const issuer = seat.page.locator('#debtIssuer');
        const options = await issuer.locator('option').allInnerTexts();
        const label = options.find(o => o.includes(corp.ticker));
        if (!label) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Chairman cannot pick their corporation as the debt issuer', detail: `${corp.ticker} not in Issuer options: ${options.join(' | ')}` });
            return bot.closeModals(seat);
        }
        await issuer.selectOption({ label });
        const limit = await bot.pledge(seat, 'collateralAssets');
        if (!limit) return bot.closeModals(seat);
        await seat.page.locator('#loanAmount').fill(String(Math.min(limit, 100 + Math.floor(bot.rand() * 200))));
        await bot.act(seat, 'issue corporate debt', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true });
        await bot.closeModals(seat);
    }

    async partialOrFullSettle(seat, me) {
        const bot = this.bot;
        if (!(await this.openDebt(seat, 'settle'))) return;
        const partial = bot.chance(0.5);
        if (partial) await seat.page.locator('#settlementAmount').fill(String(Math.max(1, Math.floor(Number(me.debts[0].principal || 2) / 2))));
        else if (await bot.usable(seat.page.locator('#payFullDebtBtn'))) await seat.page.locator('#payFullDebtBtn').click();
        await bot.act(seat, partial ? 'settle part of a debt' : 'settle debt', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true });
        await bot.closeModals(seat);
    }

    async openCorporations(seat) {
        const bot = this.bot;
        await bot.gameButton(seat, 'open-corporation').click();
        const modal = seat.page.locator('#corporationModal');
        await modal.waitFor({ state: 'visible' });
        return modal;
    }

    async changeChairman(seat, me, state) {
        const bot = this.bot;
        const corp = state.corporations.find(c => !c.insolvent && this.holds(c, me) * 2 > c.totalShares);
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const select = seat.page.locator(`#chairmanMajority-${corp.id}`);
        if (await select.count()) {
            const values = await select.locator('option').evaluateAll(os => os.map(o => o.value));
            const target = values.find(v => v !== corp.chairmanId) || values[0];
            await select.selectOption(target);
            await bot.act(seat, 'change chairman by majority', () => modal.locator(`[data-game-action="change-chairman-majority"][data-corp-id="${corp.id}"]`).click(), { allowRejection: true });
        } else {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Majority shareholder sees no Change Chairman control', detail: `${corp.ticker}: holds ${this.holds(corp, me)}/${corp.totalShares}` });
        }
        await bot.closeModals(seat);
    }

    async proposeVote(seat, me, state) {
        const bot = this.bot;
        const corp = state.corporations.find(c => !c.insolvent && this.holds(c, me) > 0 && !(c.chairmanVotes || []).some(v => v.status === 'open'));
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const select = seat.page.locator(`#chairmanVoteCandidate-${corp.id}`);
        if (await select.count()) {
            await select.selectOption(me.userId).catch(() => {});
            await bot.firstTime('chairman-vote', [seat], 'chairman-vote-form');
            await bot.act(seat, 'propose chairman vote', () => modal.locator(`[data-game-action="propose-chairman-vote"][data-corp-id="${corp.id}"]`).click(), { allowRejection: true });
        }
        await bot.closeModals(seat);
    }

    // Any bot shareholder supports open votes (not only on their turn; the rules allow it).
    async handleVotes() {
        const bot = this.bot;
        const { state } = bot.server();
        for (const corp of state.corporations || []) {
            for (const vote of (corp.chairmanVotes || []).filter(v => v.status === 'open')) {
                const supporters = new Set((vote.supporters || []).map(s => s.userId));
                const holder = (corp.shareholders || []).find(h => Number(h.shares) > 0 && !supporters.has(h.userId) && bot.seatById(h.userId) && !bot.seatById(h.userId).human);
                if (!holder || !bot.chance(0.7)) continue;
                const seat = bot.seatById(holder.userId);
                await bot.gameTab(seat);
                const modal = await this.openCorporations(seat);
                const button = modal.locator(`[data-game-action="support-chairman-vote"][data-vote-id="${vote.id}"]`);
                if (await bot.usable(button)) await bot.act(seat, 'support chairman vote', () => button.click(), { allowRejection: true });
                await bot.closeModals(seat);
            }
        }
    }

    // Buy a big enough stake that votes or a majority become possible.
    // Offer for a big enough stake that votes or a majority become possible.
    async buyStake(seat, me, state) {
        const bot = this.bot;
        const corp = bot.pick(state.corporations.filter(c => !c.insolvent && (c.shareholders || []).some(h => h.userId !== me.userId && Number(h.shares) > 0)));
        if (!corp) return;
        const want = this.wants('corp.majority-gained') ? Math.floor(Number(corp.totalShares) / 2) + 1 : Math.max(1, Math.floor(Number(corp.totalShares) / 3));
        await bot.buyShares(seat, corp, want);
    }

    async withdrawOffer(seat, me, state) {
        const bot = this.bot;
        const offer = (state.marketOffers || []).find(o => o.status === 'pending' && o.proposedById === me.userId);
        if (!offer) return;
        await bot.marketTab(seat);
        const button = seat.page.locator(`#tradeOffersList [data-game-action="cancel-trade-offer"][data-offer-id="${offer.id}"]`);
        if (await bot.usable(button)) await bot.act(seat, 'withdraw own trade offer', () => button.click(), { allowRejection: true });
        await bot.gameTab(seat);
    }

    // The host clears an offer between two other players.
    async hostCancelOffers() {
        const bot = this.bot;
        const host = bot.seats[0];
        if (host.human || !this.wants('trade.host-cancel')) return;
        const { state } = bot.server();
        const offer = (state.marketOffers || []).find(o => o.status === 'pending' && ![o.player1Id, o.player2Id].includes(host.userId));
        if (!offer) return;
        await bot.marketTab(host);
        const button = host.page.locator(`#tradeOffersList [data-game-action="host-cancel-trade-offer"][data-offer-id="${offer.id}"]`);
        if (await bot.usable(button)) await bot.act(host, 'host cancels a trade offer', () => button.click(), { allowRejection: true });
        await bot.gameTab(host);
    }

    async propertySwap(seat, me, state) {
        const bot = this.bot;
        const others = state.players.filter(p => !p.bankrupt && p.userId !== me.userId && (p.properties || []).length);
        if (!others.length || !(me.properties || []).length) return;
        const target = bot.pick(others);
        await bot.marketTab(seat);
        await seat.page.locator('#player1Select').selectOption({ value: me.userId });
        await seat.page.locator('#player2Select').selectOption({ value: target.userId });
        await seat.page.locator('#player1Cash').fill('0');
        await seat.page.locator('#player2Cash').fill('0');
        // Only streets that may be traded (built colour groups are greyed out).
        const give = seat.page.locator('#player1Assets input[type="checkbox"]:not([disabled])');
        const get = seat.page.locator('#player2Assets input[type="checkbox"]:not([disabled])');
        if (!(await give.count()) || !(await get.count())) return bot.gameTab(seat);
        await give.nth(Math.floor(bot.rand() * await give.count())).check();
        await get.nth(Math.floor(bot.rand() * await get.count())).check();
        await bot.act(seat, 'propose property swap', () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true });
        await bot.gameTab(seat);
    }

    async jailCardTrade(seat, me, state) {
        const bot = this.bot;
        const target = bot.pick(state.players.filter(p => !p.bankrupt && p.userId !== me.userId));
        if (!target) return;
        await bot.marketTab(seat);
        await seat.page.locator('#player1Select').selectOption({ value: me.userId });
        await seat.page.locator('#player2Select').selectOption({ value: target.userId });
        await seat.page.locator('#player1Cash').fill('0');
        await seat.page.locator('#player2Cash').fill(String(20 + Math.floor(bot.rand() * 40)));
        const card = seat.page.locator('#player1-asset-get-out-of-jail-free');
        if (!(await card.count())) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Market does not offer my Get Out of Jail Free card as a trade asset', detail: '' });
            await bot.ctx.shot(seat, 'jail-card-not-tradable');
            return bot.gameTab(seat);
        }
        await card.check();
        await bot.act(seat, 'offer jail card in a trade', () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true });
        await bot.gameTab(seat);
    }

    // Asks for something the rules must refuse, the way a careless player would.
    // Client-side checks may stop it first; only what reaches the server counts as covered.
    async refusalProbe(seat, me, state) {
        const bot = this.bot;
        const cash = Math.floor(Number(me.cash));
        const others = state.players.filter(p => !p.bankrupt && p.userId !== me.userId);
        const probes = [];
        if (this.wants('refuse.pay-over-cash') && others.length) probes.push('pay');
        if (this.wants('refuse.trade-not-owned') && others.length) probes.push('trade');
        if (this.wants('refuse.junk-amount')) probes.push('junk');
        if (this.wants('refuse.loan-over-limit')) probes.push('loan-over-limit');
        const probe = bot.pick(probes);
        if (!probe) return;
        if (probe === 'pay') {
            await bot.marketTab(seat);
            await seat.page.locator('#paymentToPlayer').selectOption({ value: bot.pick(others).userId });
            await seat.page.locator('#paymentAmount').fill(String(cash + 500));
            await bot.act(seat, 'probe: pay more than my cash', () => seat.page.locator('#makePaymentBtn').click(), { allowRejection: true, allowNoChange: true });
        } else if (probe === 'trade') {
            await bot.marketTab(seat);
            await seat.page.locator('#player1Select').selectOption({ value: me.userId });
            await seat.page.locator('#player2Select').selectOption({ value: bot.pick(others).userId });
            await seat.page.locator('#player1Cash').fill(String(cash + 1000));
            await bot.act(seat, 'probe: offer more cash than I have', () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true, allowNoChange: true });
        } else if (probe === 'loan-over-limit') {
            await bot.gameTab(seat);
            if (!(await this.openDebt(seat, 'issue'))) return;
            const limit = await bot.pledge(seat, 'collateralAssets');
            if (!limit) return bot.closeModals(seat);
            await seat.page.locator('#loanAmount').fill(String(limit + 50));
            await bot.act(seat, 'probe: borrow more than 90% of the collateral', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true, allowNoChange: true });
            await bot.closeModals(seat);
        } else {
            await bot.gameTab(seat);
            if (!(await this.openDebt(seat, 'issue'))) return;
            await bot.pledge(seat, 'collateralAssets');
            await seat.page.locator('#loanAmount').fill(bot.pick(['-50', '0']));
            await bot.act(seat, 'probe: borrow a zero or negative amount', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true, allowNoChange: true });
            await bot.closeModals(seat);
        }
        await bot.gameTab(seat);
    }

    // During a staged auction timeout: let the idle timer run out before the next move.
    async waitOutAuction() {
        this.ctx.log('    waiting out the staged auction timeout');
        await sleep(3500);
    }
}

module.exports = { Explore };
