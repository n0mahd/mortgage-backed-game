'use strict';

// Coverage-guided play (`--explore`): before each bot decision, look at which
// pathways the game hasn't reached yet and lean towards them. Rare situations
// that ordinary play almost never reaches get a staged setup (lib/stages.js)
// at the start of a bot turn, and are then played out through the UI. Also
// holds the UI actions only exploration uses: refinancing, corporate debt,
// chairman votes, withdrawing or host-cancelling offers, property swaps,
// jail-card trades, and the chairman's desk (rent policy and its votes,
// dividends, building and buying for a company, trading as it, property offers
// and their answers).

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Explore {
    constructor(bot, { stageRate = 0.35, maxStageTries = 2 } = {}) {
        this.bot = bot;
        this.stageRate = stageRate;
        this.maxStageTries = maxStageTries;
        this.stageTries = {};
        this.active = null;
        this.uncoveredCache = new Set();
        // Votes and offers already answered once: a refused answer is not retried every step.
        this.answered = new Set();
    }

    get ctx() { return this.bot.ctx; }

    refresh() {
        const cov = this.ctx.coverageNow();
        this.uncoveredCache = new Set(cov.filter(c => !c.hits).map(c => c.id));
        this.cov = cov;
        return this.uncoveredCache;
    }

    wants(id) { return this.uncoveredCache.has(id); }

    // A staged expiry (trade-expiry, property-offer-expiry) is in effect: offers time out in
    // seconds, so bots leave them unanswered until one has expired and the setting is restored.
    holdingOffersFor(state, id) {
        return Number(state.settings?.tradeOfferTimeoutMs) <= 5000 && this.wants(id);
    }
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
        // Coverage moves within a turn too; re-read it so a reached pathway isn't chased again.
        this.refresh();
        const kind = prop.color === 'Railroad' ? 'buy.railroad' : prop.color === 'Utility' ? 'buy.utility' : 'buy.street';
        if (this.wants(kind)) return false;
        return this.wantsAny('auction.start', 'auction.no-sale', 'auction.host-cancel', 'auction.won', 'auction.timeout') && this.bot.chance(0.6);
    }

    // How the bots should treat this auction: 'no-sale', 'host-cancel' or null (normal).
    auctionMode(auction) {
        this.refresh();
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
        if (!done.has('debt') && this.wantsAny('debt.issue', 'debt.interest', 'debt.pay', 'debt.refinance', 'debt.term-short', 'debt.term-long')) out.push(['debt', 0.6]);
        if (!done.has('settle') && (me.debts || []).length && this.wantsAny('debt.pay', 'debt.payoff')) out.push(['settle', 0.7]);
        if (!done.has('autopay') && (me.debts || []).some(d => d.autopay !== false) && this.wantsAny('debt.autopay-off', 'debt.unpaid-interest')) out.push(['autopay', 0.7]);
        if (!done.has('probe') && this.wantsAny('refuse.bid-over-cash', 'refuse.pay-over-cash', 'refuse.junk-amount', 'refuse.trade-not-owned', 'refuse.loan-over-limit', 'refuse.trade-built-group', 'refuse.force-buy-shares')) out.push(['probe', 0.5]);
        if (!done.has('trade') && this.wantsAny('trade.propose', 'trade.accept', 'trade.decline', 'trade.withdraw', 'trade.host-cancel', 'trade.expire')) out.push(['trade', this.holdingOffersFor(state, 'trade.expire') ? 0.9 : 0.35]);
        // The chairman's desk.
        const run = (state.corporations || []).filter(c => this.runs(c, me));
        const tradeable = state.players.some(p => !p.bankrupt && p.userId !== me.userId && (p.properties || []).length);
        if (!done.has('dividend') && run.some(c => Number(c.cash) >= 1) && this.wants('desk.dividend')) out.push(['dividend', 0.8]);
        if (!done.has('rent-vote') && this.voteCorp(state, me) && this.wantsAny('desk.rent-vote-propose', 'desk.rent-vote-support', 'desk.rent-vote-reject', 'desk.rent-vote-passes')) out.push(['rent-vote', 0.8]);
        if (!done.has('build-for-corp') && run.some(c => Number(c.cash) >= 100 && this.corpGroup(state, c)) && this.wants('desk.build-for-corp')) out.push(['build-for-corp', 0.8]);
        if (!done.has('trade-as-corp') && run.some(c => Number(c.cash) >= 10) && tradeable && this.wants('desk.trade-as-corp')) out.push(['trade-as-corp', 0.7]);
        const othersCorps = (state.corporations || []).filter(c => !c.insolvent && c.chairmanId && !this.runs(c, me));
        if ((me.properties || []).length && othersCorps.length) {
            if (!done.has('property-offer') && this.holdingOffersFor(state, 'desk.offer-expired')) out.push(['property-offer', 0.9]);
            if (!done.has('property-offer') && this.wantsAny('desk.offer-made', 'desk.offer-accepted-shares', 'desk.offer-accepted-cash', 'desk.offer-countered', 'desk.offer-declined', 'desk.offer-withdrawn', 'desk.offer-expired')) out.push(['property-offer', 0.7]);
            if (!done.has('into-corp-trade') && this.wants('desk.property-for-shares-trade')) out.push(['into-corp-trade', 0.6]);
        }
        return out.filter(([, p]) => p > 0 && bot);
    }

    holds(corp, me) {
        return Number((corp.shareholders || []).find(h => h.userId === me.userId)?.shares || 0);
    }

    // Mirrors controlsCorporation: the chairman or a majority holder runs it.
    runs(corp, me) {
        return !!corp && !corp.insolvent && (corp.chairmanId === me.userId || this.holds(corp, me) * 2 > Number(corp.totalShares || 0));
    }

    // A company where `me` may open a rent policy vote now: a holder, no vote open, and
    // (if they run it) the policy locked, since the runner otherwise just switches it.
    voteCorp(state, me) {
        return (state.corporations || []).find(c => !c.insolvent && this.holds(c, me) > 0 && !c.rentPolicyVote
            && (!this.runs(c, me) || Number(c.rentPolicyLockedTurns || 0) > 0));
    }

    // A colour group the company owns whole (and can build on), or null.
    corpGroup(state, corp) {
        const colors = new Set(state.properties.filter(p => p.ownerId === corp.id).map(p => p.color));
        return [...colors].find(color => !['Railroad', 'Utility'].includes(color) && state.properties.filter(p => p.color === color).every(p => p.ownerId === corp.id)) || null;
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
        if (kind === 'debt') {
            const term = this.wants('debt.term-short') ? 5 : (this.wants('debt.term-long') ? 15 : undefined);
            return bot.issueDebt(seat, 100 + Math.floor(bot.rand() * 200), true, { term });
        }
        if (kind === 'settle') return bot.settleDebt(seat, { partial: !this.wants('debt.payoff') && bot.chance(0.5) });
        if (kind === 'autopay') return bot.toggleAutopay(seat, false);
        if (kind === 'trade') return bot.proposeTrade(seat, me, state);
        if (kind === 'probe') return this.refusalProbe(seat, me, state);
        if (kind === 'dividend') return this.payDividend(seat, me, state);
        if (kind === 'rent-vote') return this.proposeRentVote(seat, me, state);
        if (kind === 'build-for-corp') return this.buildForCorporation(seat, me, state);
        if (kind === 'trade-as-corp') return this.tradeAsCorporation(seat, me, state);
        if (kind === 'property-offer') return this.offerProperty(seat, me, state);
        if (kind === 'into-corp-trade') return this.propertyForShares(seat, me, state);
        return null;
    }

    // ----- the chairman's desk (Corporations sheet, src/js/game/corporation-desk.js) -----

    // At the start of the turn, before the roll: the only time the runner may switch the rent policy alone.
    async beforeRoll(seat, me, state) {
        // Mirrors hasMovedThisTurn: doubles leave diceRolled false but set lastDiceRoll.
        if (!this.wants('desk.rent-policy-set') || me.diceRolled || Array.isArray(state.lastDiceRoll)) return false;
        const corp = (state.corporations || []).find(c => this.runs(c, me) && !c.rentPolicyVote && !Number(c.rentPolicyLockedTurns || 0));
        if (!corp) return false;
        const bot = this.bot;
        const modal = await this.openCorporations(seat);
        const button = modal.locator(`[data-game-action="set-rent-policy"][data-corp-id="${corp.id}"]`);
        if (!(await bot.usable(button))) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Chairman sees no usable rent policy switch before rolling', detail: `${corp.ticker}: policy ${corp.rentPolicy || 'reinvest'}, lock ${corp.rentPolicyLockedTurns || 0}` });
            await this.ctx.shot(seat, 'rent-policy-missing');
            await bot.closeModals(seat);
            return false;
        }
        await bot.firstTime('rent-policy', [seat], 'corporation-rent-policy');
        await bot.act(seat, `switch ${corp.ticker} rent policy`, () => button.click(), { allowRejection: true });
        await bot.closeModals(seat);
        return true;
    }

    async payDividend(seat, me, state) {
        const bot = this.bot;
        const corp = (state.corporations || []).find(c => this.runs(c, me) && Number(c.cash) >= 1);
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const input = seat.page.locator(`#dividend-${corp.id}`);
        if (!(await input.count())) return bot.closeModals(seat);
        await input.fill(String(Math.max(1, Math.floor(Number(corp.cash) / 3))));
        await bot.firstTime('runner-tools', [seat], 'corporation-runner-tools');
        await bot.act(seat, `pay a ${corp.ticker} dividend`, () => modal.locator(`[data-game-action="pay-dividend"][data-corp-id="${corp.id}"]`).click(), { allowRejection: true });
        await bot.closeModals(seat);
    }

    async proposeRentVote(seat, me, state) {
        const bot = this.bot;
        const corp = this.voteCorp(state, me);
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const button = modal.locator(`[data-game-action="propose-rent-policy"][data-corp-id="${corp.id}"]`);
        if (await bot.usable(button)) {
            await bot.act(seat, `ask ${corp.ticker} shareholders to switch rent policy`, () => button.click(), { allowRejection: true });
        } else {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Shareholder sees no "Ask every shareholder to switch" control', detail: `${corp.ticker}: holds ${this.holds(corp, me)}, runs it: ${this.runs(corp, me)}, lock ${corp.rentPolicyLockedTurns || 0}` });
            await this.ctx.shot(seat, 'rent-vote-missing');
        }
        await bot.closeModals(seat);
    }

    async buildForCorporation(seat, me, state) {
        const bot = this.bot;
        const corp = (state.corporations || []).find(c => this.runs(c, me) && Number(c.cash) >= 100 && this.corpGroup(state, c));
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const button = modal.locator(`[data-game-action="build-for-corporation"][data-corp-id="${corp.id}"]`);
        if (!(await bot.usable(button))) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Build houses for the company is not usable', detail: `${corp.ticker} owns the whole ${this.corpGroup(state, corp)} group with $${corp.cash}` });
            return bot.closeModals(seat);
        }
        await button.click();
        await bot.buyHouses(seat, me, { opened: true, cash: Number(corp.cash), label: `build houses for ${corp.ticker}` });
    }

    async tradeAsCorporation(seat, me, state) {
        const bot = this.bot;
        const corp = (state.corporations || []).find(c => this.runs(c, me) && Number(c.cash) >= 10);
        const targets = state.players.filter(p => !p.bankrupt && p.userId !== me.userId && (p.properties || []).length && !this.runs(corp, p));
        if (!corp || !targets.length) return;
        const target = bot.pick(targets);
        const modal = await this.openCorporations(seat);
        await modal.locator(`[data-game-action="trade-as-corporation"][data-corp-id="${corp.id}"]`).click();
        await seat.page.locator('#market.section.active').waitFor({ state: 'visible' });
        if ((await seat.page.locator('#player1As').inputValue().catch(() => '')) !== corp.id) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: `"Trade as ${corp.ticker}" did not set Trading as`, detail: '' });
        }
        await seat.page.locator('#player2Select').selectOption({ value: target.userId });
        if (await seat.page.locator('#player2As').isVisible().catch(() => false)) await seat.page.locator('#player2As').selectOption('');
        const box = seat.page.locator('#player2Assets input[type="checkbox"]:not([disabled])');
        if (await box.count()) await box.nth(Math.floor(bot.rand() * await box.count())).check();
        await seat.page.locator('#player1Cash').fill(String(Math.max(1, Math.min(Math.floor(Number(corp.cash)) - 1, 150))));
        await seat.page.locator('#player2Cash').fill('0');
        await bot.firstTime('trade-as-corp', [seat], 'market-trade-as-corporation');
        await bot.act(seat, `propose a trade as ${corp.ticker}`, () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true });
        await bot.gameTab(seat);
    }

    // Corporations → Offer a property to <ticker>: book value or a set price, for shares or treasury cash.
    async offerProperty(seat, me, state) {
        const bot = this.bot;
        const corps = (state.corporations || []).filter(c => !c.insolvent && c.chairmanId && !this.runs(c, me));
        const corp = bot.pick(corps);
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const open = modal.locator(`[data-game-action="open-property-offer"][data-corp-id="${corp.id}"]`);
        if (!(await bot.usable(open))) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: `No "Offer a property to ${corp.ticker}" button for a player who owns property`, detail: `${me.name} owns ${(me.properties || []).length}` });
            return bot.closeModals(seat);
        }
        await open.click();
        const offerModal = seat.page.locator('#propertyOfferModal');
        await offerModal.waitFor({ state: 'visible' });
        const boxes = seat.page.locator('#propertyOfferAssets input[type="checkbox"]:not(:disabled)');
        if (!(await boxes.count())) return bot.closeModals(seat);
        await boxes.nth(Math.floor(bot.rand() * await boxes.count())).check();
        const cash = this.wants('desk.offer-accepted-cash') && (!this.wants('desk.offer-accepted-shares') || bot.chance(0.5));
        await seat.page.locator(`input[name="propertyOfferPayWith"][value="${cash ? 'cash' : 'shares'}"]`).check();
        if (bot.chance(0.3)) {
            await seat.page.locator('input[name="propertyOfferBasis"][value="set"]').check();
            const price = Number(await seat.page.locator('#propertyOfferPriceInput').inputValue()) || 100;
            await seat.page.locator('#propertyOfferPriceInput').fill(String(Math.max(1, Math.round(price * (0.9 + bot.rand() * 0.3)))));
        }
        const send = seat.page.locator('#send-property-offer-btn');
        if (!(await send.isEnabled()) && cash) {
            // The treasury can't pay; take new shares instead.
            await seat.page.locator('input[name="propertyOfferPayWith"][value="shares"]').check();
        }
        await bot.firstTime('property-offer', [seat], 'property-offer-modal');
        if (!(await send.isEnabled())) {
            this.ctx.log(`    ${seat.name}: property offer to ${corp.ticker} not sendable (the form says why)`);
            return bot.closeModals(seat);
        }
        await bot.act(seat, `offer a property to ${corp.ticker}`, () => send.click(), { allowRejection: true });
        await bot.closeModals(seat);
        // A staged expiry needs the offer to time out before the next action.
        if (this.holdingOffersFor(this.bot.server().state, 'desk.offer-expired')) await sleep(3500);
    }

    // Corporations → Or trade it for the chairman's own shares: property into the company, shares back.
    async propertyForShares(seat, me, state) {
        const bot = this.bot;
        const corp = bot.pick((state.corporations || []).filter(c => !c.insolvent && c.chairmanId && !this.runs(c, me)
            && (c.shareholders || []).some(h => h.userId === c.chairmanId && Number(h.shares) > 1)));
        if (!corp) return;
        const modal = await this.openCorporations(seat);
        const open = modal.locator(`[data-game-action="offer-property-for-shares"][data-corp-id="${corp.id}"]`);
        if (!(await bot.usable(open))) return bot.closeModals(seat);
        await open.click();
        await seat.page.locator('#market.section.active').waitFor({ state: 'visible' });
        const box = seat.page.locator('#player1Assets input[type="checkbox"]:not([disabled]):not([value*="jail"])');
        if (!(await box.count())) return bot.gameTab(seat);
        await box.first().check();
        const into = seat.page.locator(`#player1Destination input[value="${corp.id}"]`);
        if (!(await into.count())) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: `Market offers no "Into ${corp.ticker}" choice for a property-for-shares trade`, detail: '' });
            await this.ctx.shot(seat, 'into-corp-missing');
            return bot.gameTab(seat);
        }
        await into.check();
        const chairShares = Number(corp.shareholders.find(h => h.userId === corp.chairmanId).shares);
        const shares = seat.page.locator(`#player2Assets .trade-share-input[data-corp-id="${corp.id}"]`);
        if (await shares.count()) await shares.fill(String(Math.max(1, Math.floor(chairShares / 10))));
        await bot.firstTime('property-for-shares', [seat], 'market-property-for-shares');
        await bot.act(seat, `trade a property into ${corp.ticker} for shares`, () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true });
        await bot.gameTab(seat);
    }

    // Rent policy votes and property offers waiting on a bot seat, answered whether or not it is their turn.
    async handleCorpRequests() {
        const bot = this.bot;
        const { state } = bot.server();
        for (const corp of (state.corporations || []).filter(c => c.rentPolicyVote && !c.insolvent)) {
            const vote = corp.rentPolicyVote;
            const holder = (corp.shareholders || []).find(h => Number(h.shares) > 0 && !vote.supporterIds.includes(h.userId) && bot.seatById(h.userId) && !bot.seatById(h.userId).human);
            if (!holder) continue;
            const key = `vote:${corp.id}:${vote.createdAt}:${holder.userId}`;
            if (this.answered.has(key)) continue;
            this.answered.add(key);
            const reject = this.wants('desk.rent-vote-reject') && (!this.wants('desk.rent-vote-passes') || bot.chance(0.5));
            const approve = this.wantsAny('desk.rent-vote-reject', 'desk.rent-vote-passes', 'desk.rent-vote-support') ? !reject : bot.chance(0.7);
            const seat = bot.seatById(holder.userId);
            await bot.gameTab(seat);
            const modal = await this.openCorporations(seat);
            const button = modal.locator(`[data-game-action="vote-rent-policy"][data-corp-id="${corp.id}"][data-approve="${approve}"]`);
            if (await bot.usable(button)) {
                await bot.act(seat, `${approve ? 'agree to' : 'reject'} a ${corp.ticker} rent policy switch`, () => button.click(), { allowRejection: true });
            } else {
                this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Shareholder has no Agree/Reject for an open rent policy vote', detail: `${corp.ticker} vote to ${vote.policy}` });
                await this.ctx.shot(seat, 'rent-vote-no-buttons');
            }
            await bot.closeModals(seat);
        }
        if (this.holdingOffersFor(state, 'desk.offer-expired')) return;
        for (const offer of (state.propertyOffers || []).filter(o => o.status === 'pending' && !(Date.parse(o.expiresAt) < Date.now()))) {
            const corp = (state.corporations || []).find(c => c.id === offer.corpId);
            if (!corp) continue;
            const runner = offer.awaiting === 'corporation'
                ? state.players.find(p => !p.bankrupt && this.runs(corp, p))
                : state.players.find(p => p.userId === offer.offererId);
            const seat = runner && bot.seatById(runner.userId);
            if (!seat || seat.human) continue;
            const key = `offer:${offer.id}:${offer.awaiting}:${offer.price}`;
            if (this.answered.has(key)) continue;
            this.answered.add(key);
            let response;
            if (offer.awaiting === 'offerer') {
                response = this.wants('desk.offer-withdrawn') ? 'decline' : 'accept';
            } else if (this.wants(offer.payWith === 'cash' ? 'desk.offer-accepted-cash' : 'desk.offer-accepted-shares')) {
                response = 'accept';
            } else if (this.wants('desk.offer-countered')) {
                response = 'counter';
            } else if (this.wants('desk.offer-declined')) {
                response = 'decline';
            } else if (this.wants('desk.offer-withdrawn')) {
                // Leave it for the offerer to withdraw.
                const offerer = bot.seatById(offer.offererId);
                if (!offerer || offerer.human) continue;
                await this.answerOffer(offerer, offer, 'decline', 'withdraw a property offer');
                continue;
            } else {
                response = bot.pick(['accept', 'accept', 'decline', 'counter']);
            }
            await this.answerOffer(seat, offer, response, `${response} a property offer to ${offer.ticker}`);
        }
    }

    async answerOffer(seat, offer, response, label) {
        const bot = this.bot;
        await bot.gameTab(seat);
        const modal = await this.openCorporations(seat);
        const button = modal.locator(`[data-game-action="respond-property-offer"][data-offer-id="${offer.id}"][data-response="${response}"]`);
        if (!(await bot.usable(button))) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: `No "${response}" control on a property offer waiting for this player`, detail: `${offer.offererName} → ${offer.ticker}, awaiting ${offer.awaiting}` });
            await this.ctx.shot(seat, 'property-offer-no-button');
            return bot.closeModals(seat);
        }
        if (response === 'counter') {
            const input = seat.page.locator(`#counter-${offer.id}`);
            await input.fill(String(Math.max(1, Math.round(Number(offer.price) * (0.8 + bot.rand() * 0.15)))));
        }
        await bot.firstTime('property-offer-answer', [seat], 'property-offer-answer');
        await bot.act(seat, label, () => button.click(), { allowRejection: true });
        await bot.closeModals(seat);
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
        const limit = await bot.borrowingLimit(seat, 'refinanceLimit');
        // The new loan must exceed the payoff and stay within the borrowing limit.
        if (!limit || limit <= principal) return bot.closeModals(seat);
        await seat.page.locator('#refinanceAmount').fill(String(Math.min(limit, principal + 100)));
        await bot.pickLoanTerm(seat, 'refinanceTerms');
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
        const limit = await bot.borrowingLimit(seat);
        if (!limit) return bot.closeModals(seat);
        await seat.page.locator('#loanAmount').fill(String(Math.min(limit, 100 + Math.floor(bot.rand() * 200))));
        await bot.pickLoanTerm(seat, 'loanTerms');
        await bot.act(seat, 'issue corporate debt', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true });
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
        await bot.tradeParties(seat, me.userId, target.userId);
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
        await bot.tradeParties(seat, me.userId, target.userId);
        await seat.page.locator('#player1Cash').fill('0');
        // Ask no more than they have; with nothing, the card goes as a gift.
        await seat.page.locator('#player2Cash').fill(String(Math.max(0, Math.min(Math.floor(Number(target.cash)), 20 + Math.floor(bot.rand() * 40)))));
        const card = seat.page.locator('#player1-asset-get-out-of-jail-free');
        if (!(await card.count())) {
            this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: 'Market does not offer my Get Out of Jail Free card as a trade asset', detail: '' });
            await bot.ctx.shot(seat, 'jail-card-not-tradable');
            return bot.gameTab(seat);
        }
        await card.check();
        if (!(await seat.page.locator('#executeTradeBtn').isEnabled())) {
            this.ctx.log(`    ${seat.name}: jail card trade not proposable (the form says why)`);
            return bot.gameTab(seat);
        }
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
        const built = state.properties.find(p => Number(p.houses) > 0 && state.players.some(pl => pl.userId === p.ownerId && !pl.bankrupt));
        if (this.wants('refuse.trade-built-group') && built && others.length) probes.push('built-group');
        const heldCorp = (state.corporations || []).find(c => !c.insolvent && !Number(c.availableShares || 0) && (c.shareholders || []).some(h => h.userId !== me.userId && Number(h.shares) > 0));
        if (this.wants('refuse.force-buy-shares') && heldCorp) probes.push('force-buy');
        const probe = bot.pick(probes);
        if (!probe) return;
        if (probe === 'pay') {
            await bot.marketTab(seat);
            await seat.page.locator('#paymentToPlayer').selectOption({ value: bot.pick(others).userId });
            await seat.page.locator('#paymentAmount').fill(String(cash + 500));
            await bot.act(seat, 'probe: pay more than my cash', () => seat.page.locator('#makePaymentBtn').click(), { allowRejection: true, allowNoChange: true });
        } else if (probe === 'trade') {
            await bot.marketTab(seat);
            await bot.tradeParties(seat, me.userId, bot.pick(others).userId);
            await seat.page.locator('#player1Cash').fill(String(cash + 1000));
            // The form disables Propose for cash over your balance; that is the refusal.
            if (!(await seat.page.locator('#executeTradeBtn').isEnabled())) {
                this.ctx.log(`    ${seat.name}: probe: offer more cash than I have, blocked by the form`);
                this.ctx.markUi('refuse.trade-not-owned');
                await seat.page.locator('#player1Cash').fill('0');
                return;
            }
            await bot.act(seat, 'probe: offer more cash than I have', () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true, allowNoChange: true });
        } else if (probe === 'loan-over-limit') {
            await bot.gameTab(seat);
            if (!(await this.openDebt(seat, 'issue'))) return;
            const limit = await bot.borrowingLimit(seat);
            if (limit === null) return bot.closeModals(seat);
            await seat.page.locator('#loanAmount').fill(String(limit + 50));
            await bot.act(seat, 'probe: borrow more than the portfolio allows', () => seat.page.locator('#process-debt-btn').click(), { allowRejection: true, allowNoChange: true });
            await bot.closeModals(seat);
        } else if (probe === 'built-group') {
            // A street in a built group can't be offered: the box must be greyed out, or the server must say no.
            const mine = built.ownerId === me.userId;
            const partner = mine ? bot.pick(others) : state.players.find(p => p.userId === built.ownerId);
            await bot.marketTab(seat);
            await bot.tradeParties(seat, me.userId, partner.userId);
            const box = seat.page.locator(`#${mine ? 'player1' : 'player2'}-asset-${built.id}`);
            if (!(await box.count()) || await box.isDisabled()) {
                this.ctx.log(`    ${seat.name}: probe: ${built.name} (built group) can't be ticked in the Market`);
                this.ctx.markUi('refuse.trade-built-group');
            } else {
                await box.check();
                const r = await bot.act(seat, 'probe: offer a street from a built group', () => seat.page.locator('#executeTradeBtn').click(), { allowRejection: true, allowNoChange: true });
                if (r.changed) this.ctx.finding({ severity: 'high', category: 'game-rule', seat, title: 'A street from a built colour group could be offered in a trade', detail: built.name });
            }
        } else if (probe === 'force-buy') {
            // Shares a player holds are sold only by a trade they accept: the sheet must not sell them.
            const modal = await this.openCorporations(seat);
            const buy = modal.locator(`[data-game-action="buy-shares"][data-corp-id="${heldCorp.id}"]`);
            if (await buy.count()) {
                this.ctx.finding({ severity: 'medium', category: 'ui', seat, title: `Corporations offers to buy ${heldCorp.ticker} shares though it has none in its treasury`, detail: '' });
                await this.ctx.shot(seat, 'buy-held-shares');
            } else {
                this.ctx.log(`    ${seat.name}: probe: ${heldCorp.ticker}'s held shares can't be bought from the Corporations sheet`);
                this.ctx.markUi('refuse.force-buy-shares');
            }
            await bot.closeModals(seat);
        } else {
            await bot.gameTab(seat);
            if (!(await this.openDebt(seat, 'issue'))) return;
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
