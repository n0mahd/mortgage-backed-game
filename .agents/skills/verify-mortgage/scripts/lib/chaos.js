'use strict';

// Chaos moves for autoplay (`--chaos P`): with probability P per step the bot
// stops playing sensibly and does what careless, impatient or malicious people
// do, all through the UI: random controls on any seat, junk in number fields,
// double clicks, two seats acting at once, Escape and tab switches over modals,
// reloading mid-action. The usual checks (errors, sync, invariants, stuck) then
// show whether the game survived; chaos adds checks for accepted junk input and
// actions applied twice.

const { snapshotInPage } = require('./view');

// Never chaos-click controls that end the session or the game for everyone.
const DENY = /end game|back to lobby|log ?out|sign out|leave room|play on another device|copy link|copy code|cancel auction|host cancel|pause game|resume game/i;

// Values a person might type, with whether a game should refuse them as an amount.
const JUNK = [
    { value: '-50', invalid: true },
    { value: '0', invalid: true },
    { value: '-0.01', invalid: true },
    { value: '0.001', invalid: false },
    { value: '1e9', invalid: false },
    { value: '99999999', invalid: false },
    { value: 'abc', invalid: true },
    { value: '', invalid: true },
    { value: ' 12 ', invalid: false },
    { value: '12.345', invalid: false },
    { value: 'NaN', invalid: true },
    { value: 'Infinity', invalid: true },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A second roll is only legal right after doubles; the engine says so in its log line.
// The log keeps its last 100 lines, so new lines are found after the last line seen before.
function newLogLines(beforeState, afterState) {
    const last = beforeState.gameLog[beforeState.gameLog.length - 1];
    if (!last) return afterState.gameLog;
    const at = afterState.gameLog.findIndex(e => e.timestamp === last.timestamp && e.message === last.message);
    return at === -1 ? [] : afterState.gameLog.slice(at + 1);
}

function extraRoll(beforeState, afterState) {
    const rolls = newLogLines(beforeState, afterState).map(e => String(e.message || '')).filter(m => / rolled \d\+\d=/.test(m));
    return rolls.length >= 2 && !/roll again/.test(rolls[0]);
}

class Chaos {
    constructor(bot) {
        this.bot = bot;
        this.moves = {};
        this.refusals = new Map();
    }

    get ctx() { return this.bot.ctx; }

    count(kind) { this.moves[kind] = (this.moves[kind] || 0) + 1; }

    // One chaos move. `seat` is the player whose turn it is.
    async step(seat) {
        const bot = this.bot;
        const kinds = [
            ['random-control', 0.32],
            ['junk-input', 0.24],
            ['double-click', 0.14],
            ['concurrent', 0.12],
            ['modal-escape', 0.1],
            ['reload-mid-action', 0.08],
        ];
        let roll = bot.rand();
        let kind = kinds[0][0];
        for (const [k, p] of kinds) { if (roll < p) { kind = k; break; } roll -= p; }
        this.count(kind);
        const before = bot.server();
        const dialogsBefore = new Map(bot.seats.map(s => [s, s.dialogs.length]));
        let touched = [seat];
        try {
            if (kind === 'random-control') touched = await this.randomControl(seat);
            if (kind === 'junk-input') await this.junkInput(seat, before);
            if (kind === 'double-click') await this.doubleClick(seat, before);
            if (kind === 'concurrent') touched = await this.concurrent(seat);
            if (kind === 'modal-escape') await this.modalEscape(seat);
            if (kind === 'reload-mid-action') await this.reloadMidAction(seat, before);
        } catch (err) {
            this.ctx.log(`    chaos ${kind} on ${seat.name}: ${String(err.message || err).split('\n')[0]}`);
        }
        await sleep(400);
        for (const s of bot.seats) {
            for (const d of s.dialogs.slice(dialogsBefore.get(s))) {
                if (d.type === 'alert') this.refusals.set(d.message, (this.refusals.get(d.message) || 0) + 1);
            }
        }
        for (const s of touched) await this.restore(s);
        await bot.syncCheck(`chaos ${kind}`);
        bot.runInvariants(`chaos ${kind} by ${seat.name}`);
    }

    // Back to the game screen with no modal open, as a person would get there.
    async restore(seat) {
        const bot = this.bot;
        if (!/game\.html/.test(seat.page.url())) {
            this.ctx.log(`    chaos left ${seat.name} on ${seat.page.url().replace(/^https?:\/\/[^/]+\//, '')}; going back`);
            await seat.page.goto(seat.gameUrl).catch(() => {});
            await seat.page.locator('#gameContent').filter({ hasText: 'Current Turn:' }).waitFor({ timeout: 15000 }).catch(async () => {
                this.ctx.finding({ severity: 'high', category: 'chaos', seat, title: 'Could not get back into the game after leaving the game page', detail: seat.gameUrl });
                await this.ctx.shot(seat, 'chaos-no-way-back');
            });
        }
        await bot.gameTab(seat).catch(() => {});
    }

    async controls(seat) {
        const snap = await seat.page.evaluate(snapshotInPage, { maxTextChars: 10 });
        return snap.controls.filter(c => !c.disabled && c.kind !== 'link' && !DENY.test(c.label || ''));
    }

    async randomControl(seat) {
        const bot = this.bot;
        const target = bot.chance(0.6) || seat.offline ? seat : bot.pick(bot.seats.filter(s => !s.offline));
        // Sometimes open another tab first so Market and Board controls get hit too.
        if (bot.chance(0.4)) {
            const tab = bot.pick(['market', 'board', 'log', 'game']);
            await target.page.locator(`.nav-tab[data-section="${tab}"]`).click().catch(() => {});
            await sleep(200);
        }
        const controls = await this.controls(target);
        if (!controls.length) return [target];
        const control = bot.pick(controls);
        const el = target.page.locator(`[data-vm-ref="${control.ref}"]`).first();
        let what;
        if (control.kind.startsWith('input:') || control.kind === 'textarea') {
            const junk = bot.pick(JUNK);
            await el.fill(junk.value).catch(() => {});
            what = `typed "${junk.value}" into ${control.label}`;
        } else if (control.kind === 'select') {
            const options = await el.locator('option').allInnerTexts();
            const option = bot.pick(options);
            await el.selectOption({ label: option.trim() }).catch(() => {});
            what = `chose "${option.trim()}" in ${control.label}`;
        } else if (control.kind === 'checkbox' || control.kind === 'radio') {
            await el.click().catch(() => {});
            what = `toggled ${control.label}`;
        } else {
            await el.click({ timeout: 3000 }).catch(() => {});
            what = `clicked ${control.label}`;
        }
        this.ctx.log(`    chaos: ${target.name} ${what}`);
        // A form that opened may now be submitted with whatever it holds.
        if (bot.chance(0.5)) await this.submitOpenModal(target);
        return [target];
    }

    async submitOpenModal(seat) {
        const submit = seat.page.locator('.modal.active').locator('#confirm-purchase-btn, #start-auction-btn, #create-ipo-btn, #process-debt-btn, #confirm-house-purchase-btn, [data-game-action="buy-shares"]').first();
        if (await this.bot.usable(submit)) {
            this.ctx.log(`    chaos: ${seat.name} submits the open form`);
            await submit.click({ timeout: 3000 }).catch(() => {});
            await sleep(300);
        }
    }

    // Fill one money field with junk and submit; flag junk the game accepted.
    async junkInput(seat, before) {
        const bot = this.bot;
        const me = before.state.players.find(p => p.userId === seat.userId);
        let junk = bot.pick(JUNK);
        const forms = [];
        if (before.state.auction?.status === 'open') forms.push('bid');
        if (me.diceRolled || !me.inJail) forms.push('debt', 'payment', 'trade');
        if ((me.properties || []).length) forms.push('ipo');
        if ((me.debts || []).length) forms.push('settle');
        const form = bot.pick(forms);
        if (!form) return;
        const p = seat.page;
        let field;
        if (form === 'bid') {
            const bidder = bot.pick(bot.seats.filter(s => !s.human && !s.offline));
            if (!bidder) return;
            await bot.gameTab(bidder);
            const input = bidder.page.locator('#auctionBidAmount');
            if (!(await input.count())) return;
            await input.fill(junk.value);
            await bot.gameButton(bidder, 'place-auction-bid').click().catch(() => {});
            return this.judge(bidder, before, junk, 'auction bid');
        }
        await bot.gameTab(seat);
        if (form === 'debt' || form === 'settle') {
            if (!(await bot.usable(bot.gameButton(seat, 'open-debt')))) return;
            await bot.gameButton(seat, 'open-debt').click();
            await p.locator('#debtModal').waitFor({ state: 'visible' });
            await p.locator('#debtAction').selectOption(form === 'debt' ? 'issue' : 'loans');
            field = form === 'debt' ? '#loanAmount' : '#loanList .loan-row input[type="number"]';
            await p.locator(field).first().fill(junk.value);
            const submit = form === 'debt' ? '#process-debt-btn' : '#loanList .loan-row [data-loan-pay]';
            await p.locator(submit).first().click().catch(() => {});
        } else if (form === 'ipo') {
            if (!(await bot.usable(bot.gameButton(seat, 'open-ipo')))) return;
            await bot.gameButton(seat, 'open-ipo').click();
            await p.locator('#ipoModal').waitFor({ state: 'visible' });
            // Every company has 1,000 shares, so the ticker is the only free-text field.
            field = '#ipoTicker';
            const ticker = bot.pick(['', 'A', 'TOOLONGTICKER', 'x-1', '😀', junk.value]);
            await p.locator(field).fill(ticker);
            // The engine keeps a ticker's letters and digits (up to 8), so "Infinity" is a fine ticker;
            // only a ticker with none left is junk.
            junk = { value: ticker, invalid: ticker.replace(/[^A-Za-z0-9]/g, '') === '' };
            await p.locator('#ipoAssets input[type="checkbox"]').first().check().catch(() => {});
            await p.locator('#create-ipo-btn').click().catch(() => {});
        } else if (form === 'payment') {
            await bot.marketTab(seat, 'payment');
            await p.locator('#paymentAmount').fill(junk.value);
            await p.locator('#makePaymentBtn').click().catch(() => {});
            field = 'payment amount';
        } else if (form === 'trade') {
            await bot.marketTab(seat, 'trade');
            field = bot.pick(['#player1Cash', '#player2Cash']);
            await p.locator(field).fill(junk.value);
            await p.locator('#executeTradeBtn').click().catch(() => {});
        }
        return this.judge(seat, before, junk, `${form} (${field})`);
    }

    async judge(seat, before, junk, what) {
        await sleep(1200);
        const after = this.bot.server();
        this.ctx.log(`    chaos: ${seat.name} sent "${junk.value}" as ${what}: ${after.version > before.version ? 'ACCEPTED' : 'refused'}`);
        if (junk.invalid && after.version > before.version) {
            const cashBefore = Object.fromEntries(before.state.players.map(p => [p.name, Number(p.cash)]));
            const moved = after.state.players.filter(p => Number(p.cash) !== cashBefore[p.name]).map(p => `${p.name} ${cashBefore[p.name]} -> ${p.cash}`);
            this.ctx.finding({
                severity: junk.value.startsWith('-') || /NaN|Infinity|abc/.test(junk.value) ? 'high' : 'medium',
                category: 'chaos', seat,
                title: `Game accepted "${junk.value}" as ${what.replace(/ \(.*/, '')}`,
                detail: `${what}; state v${before.version} -> v${after.version}; cash moved: ${moved.join(', ') || 'none'}; last log: ${String(after.state.gameLog.slice(-1)[0]?.message || '').replace(/<[^>]+>/g, '')}`,
            });
            await this.ctx.shot(seat, 'chaos-accepted-junk');
        }
    }

    // Impatient double clicks on whatever the main action is right now.
    async doubleClick(seat, before) {
        const bot = this.bot;
        await bot.gameTab(seat);
        const me = before.state.players.find(p => p.userId === seat.userId);
        const action = !me.diceRolled ? 'roll-dice' : (await bot.usable(bot.gameButton(seat, 'end-turn')) ? 'end-turn' : null);
        if (!action) return;
        const startIndex = before.state.currentPlayerIndex;
        await bot.gameButton(seat, action).dblclick({ timeout: 3000 }).catch(() => {});
        await sleep(1500);
        const after = bot.server();
        const rolls = newLogLines(before.state, after.state).length;
        this.ctx.log(`    chaos: ${seat.name} double-clicked ${action}: v${before.version} -> v${after.version}`);
        // Bankrupt seats are skipped by design, so only a player still in the
        // game being passed over counts as a skipped turn.
        const players = after.state.players;
        const passedOver = [];
        for (let step = 1; step < players.length; step++) {
            const index = (startIndex + step) % players.length;
            if (index === after.state.currentPlayerIndex) break;
            if (!players[index].bankrupt) passedOver.push(players[index].name);
        }
        if (action === 'end-turn' && !after.state.ended && after.state.currentPlayerIndex !== startIndex && passedOver.length > 0) {
            this.ctx.finding({ severity: 'high', category: 'chaos', seat, title: 'Double-clicking End Turn skipped a player', detail: `turn passed over ${passedOver.join(', ')}` });
        }
        if (action === 'roll-dice' && extraRoll(before.state, after.state)) {
            this.ctx.finding({ severity: 'high', category: 'chaos', seat, title: 'Double-clicking Roll Dice rolled twice without doubles', detail: `v${before.version} -> v${after.version}, ${rolls} new log lines` });
        }
    }

    // Two seats act at the same moment: the current player and someone else.
    async concurrent(seat) {
        const bot = this.bot;
        const others = bot.seats.filter(s => s !== seat && !s.human && !s.offline);
        if (!others.length) return [seat];
        const other = bot.pick(others);
        await bot.gameTab(seat);
        const { state } = bot.server();
        const me = state.players.find(p => p.userId === seat.userId);
        const mine = !me.diceRolled ? 'roll-dice' : 'end-turn';
        await bot.marketTab(other, 'payment');
        const to = state.players.find(p => p.userId !== other.userId && !p.bankrupt);
        await other.page.locator('#paymentToPlayer').selectOption({ value: to.userId }).catch(() => {});
        await other.page.locator('#paymentAmount').fill('3');
        this.ctx.log(`    chaos: ${seat.name} ${mine} at the same moment ${other.name} pays ${to.name} $3`);
        await Promise.all([
            bot.gameButton(seat, mine).click({ timeout: 3000 }).catch(() => {}),
            other.page.locator('#makePaymentBtn').click({ timeout: 3000 }).catch(() => {}),
        ]);
        await sleep(1500);
        return [seat, other];
    }

    // Open a modal, then try to leave it the ways people do.
    async modalEscape(seat) {
        const bot = this.bot;
        await bot.gameTab(seat);
        const opener = bot.pick(['open-debt', 'open-corporation', 'open-ipo']);
        if (!(await bot.usable(bot.gameButton(seat, opener)))) return;
        await bot.gameButton(seat, opener).click();
        const modal = seat.page.locator('.modal.active').first();
        await modal.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        const way = bot.pick(['escape', 'backdrop']);
        if (way === 'escape') await seat.page.keyboard.press('Escape');
        else await seat.page.mouse.click(5, 5);
        await sleep(300);
        const stillOpen = await modal.isVisible().catch(() => false);
        this.ctx.log(`    chaos: ${seat.name} opened ${opener} and pressed ${way}: modal ${stillOpen ? 'stayed open' : 'closed'}`);
        if (stillOpen) {
            this.ctx.finding({ severity: 'low', category: 'ux', title: `${way === 'escape' ? 'Escape' : 'Tapping outside'} does not close dialogs`, detail: `${opener} dialog stayed open; only its Cancel/Close button closes it` });
        }
    }

    // Start an action and reload before it can show its result.
    async reloadMidAction(seat, before) {
        const bot = this.bot;
        await bot.gameTab(seat);
        const me = before.state.players.find(p => p.userId === seat.userId);
        if (me.diceRolled) return;
        await bot.gameButton(seat, 'roll-dice').click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
        await seat.page.reload().catch(() => {});
        await seat.page.locator('#gameContent').filter({ hasText: 'Current Turn:' }).waitFor({ timeout: 15000 }).catch(async () => {
            this.ctx.finding({ severity: 'high', category: 'chaos', seat, title: 'Game did not come back after reloading mid-roll', detail: '' });
            await this.ctx.shot(seat, 'chaos-reload-broken');
        });
        const after = bot.server();
        this.ctx.log(`    chaos: ${seat.name} reloaded mid-roll: v${before.version} -> v${after.version}`);
        if (extraRoll(before.state, after.state)) {
            this.ctx.finding({ severity: 'high', category: 'chaos', seat, title: 'Reloading during a roll applied it twice', detail: `v${before.version} -> v${after.version}` });
        }
    }

    summary() {
        return {
            moves: this.moves,
            refusals: [...this.refusals.entries()].sort((a, b) => b[1] - a[1]).map(([message, n]) => ({ message, n })),
        };
    }
}

module.exports = { Chaos };
