'use strict';

// Seats: one browser context per player, each a real person's browser. Builds
// the table the way people do: the host signs in by email and creates a room,
// other email players sign in and join with the room code, the rest join as
// guests from the invite link. Every page is watched for console errors, page
// errors, failed API calls and dialogs.

const { waitForMail, INBOXES, FAKE_EMAILS } = require('./agentmail');

const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana'];
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

function seatPlan(players, emailSeats, emailMode) {
    return Array.from({ length: players }, (_, i) => ({
        index: i + 1,
        name: NAMES[i],
        kind: i < emailSeats ? 'email' : 'guest',
        email: i < emailSeats ? (emailMode ? INBOXES[i] : FAKE_EMAILS[i]) : null,
        // Alternate devices so every scenario sees phone and desktop layouts.
        device: i % 2 === 0 ? 'desktop' : 'phone',
    }));
}

function contextOptions(device) {
    const phone = device === 'phone';
    return {
        viewport: phone ? PHONE : DESKTOP,
        isMobile: phone,
        hasTouch: phone,
        deviceScaleFactor: phone ? 2 : 1,
        userAgent: phone
            ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
            : undefined,
    };
}

async function openSeat(ctx, plan) {
    const phone = plan.device === 'phone';
    const context = await ctx.browser.newContext(contextOptions(plan.device));
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    const seat = {
        ...plan,
        viewport: phone ? PHONE : DESKTOP,
        context,
        page,
        dialogs: [],
        unreadDialogs: [],
        unreadIssues: [],
        lastControls: [],
        dismissNextConfirm: false,
        human: false,
        userId: null,
    };
    watchPage(ctx, seat);
    return seat;
}

function watchPage(ctx, seat) {
    const { page } = seat;
    const issue = (kind, detail) => {
        // resilience() cuts this seat's network on purpose; its errors then are expected.
        if (seat.offline && /request-failed|console-error/.test(kind)) return;
        seat.unreadIssues.push(`${kind}: ${detail}`);
        ctx.recordIssue(seat, kind, detail);
    };
    page.on('console', msg => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // The waiting room probes for a game before one exists.
        if (/Failed to load resource.*404/.test(text) && seat.expect404) { seat.expect404--; return; }
        // The browser logs every refused request; those are tallied as API 4xx instead.
        if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
        // The game logs refusals it already showed the player ("Error making payment: Error: Insufficient funds").
        if (/^Error [a-z][\w ]*: Error: /i.test(text)) { ctx.recordAppRefusal(seat, text.split('\n')[0]); return; }
        issue('console-error', text.slice(0, 500));
    });
    page.on('pageerror', err => issue('page-error', String(err.message || err).slice(0, 500)));
    page.on('requestfailed', req => {
        const failure = req.failure()?.errorText || '';
        if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(failure)) return;
        issue('request-failed', `${req.method()} ${req.url()} ${failure}`);
    });
    page.on('response', res => {
        const url = res.url();
        if (!url.includes('/api/')) return;
        const status = res.status();
        if (status === 404 && url.includes('/api/games/by-room/')) { seat.expect404 = (seat.expect404 || 0) + 1; return; }
        if (status >= 500) issue('api-5xx', `${res.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '')} -> ${status}`);
        else if (status >= 400) ctx.recordApi4xx(seat, res);
    });
    page.on('dialog', async dialog => {
        const entry = { type: dialog.type(), message: dialog.message(), at: new Date().toISOString(), handled: 'accepted' };
        try {
            if (dialog.type() === 'confirm' && seat.dismissNextConfirm) {
                seat.dismissNextConfirm = false;
                entry.handled = 'dismissed';
                await dialog.dismiss();
            } else if (dialog.type() === 'prompt') {
                await dialog.accept(seat.nextPromptValue || '');
            } else {
                await dialog.accept();
            }
        } catch {}
        seat.dialogs.push(entry);
        seat.unreadDialogs.push(entry);
        ctx.recordDialog(seat, entry);
    });
}

async function readOtp(ctx, seat, since) {
    if (ctx.run.email) {
        const mail = await waitForMail(seat.email, { subject: 'login code', since });
        ctx.log(`  email to ${seat.email}: "${mail.subject}" at ${mail.timestamp}`);
        const match = /(\d{6})/.exec(mail.text || mail.html);
        if (!match) throw new Error(`No 6-digit code in mail to ${seat.email}`);
        return match[1];
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const row = ctx.sql(`SELECT code FROM otps WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`, [seat.email.toLowerCase()])[0];
        if (row) return row.code;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`No OTP row for ${seat.email}`);
}

async function signInByEmail(ctx, seat) {
    const { page } = seat;
    await page.goto(ctx.webUrl + '/');
    await page.getByRole('link', { name: 'Create New Game' }).first().click();
    await page.waitForURL(/auth\.html/);
    await page.locator('#email-input').fill(seat.email);
    const since = Date.now();
    await page.locator('#send-code-btn').click();
    const code = await readOtp(ctx, seat, since);
    await page.locator('#code-input').fill(code);
    await page.locator('#verify-code-btn').click();
    await page.waitForURL(/lobby\.html/, { timeout: 20000 });
    ctx.log(`  seat ${seat.index} ${seat.name} signed in as ${seat.email}`);
    ctx.markUi('ui.email-sign-in');
}

async function createRoom(ctx, seat, players) {
    const { page } = seat;
    await page.getByRole('button', { name: /create new game/i }).click();
    await page.locator('#room-name').fill(`Verify ${players}p ${ctx.run.runId.slice(-6)}`);
    await page.locator('#max-players').fill(String(players));
    await page.locator('#host-player-name').fill(seat.name);
    await page.locator('#create-room-btn').click();
    await page.waitForURL(/waiting\.html\?room=/);
    const codeEl = page.locator('#invite-code');
    await codeEl.waitFor();
    await page.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.getElementById('invite-code')?.innerText.trim()));
    return (await codeEl.innerText()).trim();
}

// Email invite through the waiting room. Proves the invite email arrives and
// carries the same code the host sees.
async function sendInvite(ctx, host, seat, inviteCode) {
    const since = Date.now();
    await host.page.locator('#invite-email').fill(seat.email);
    await host.page.locator('#send-invite-btn').click();
    if (!ctx.run.email) return;
    const mail = await waitForMail(seat.email, { subject: 'room code', since });
    ctx.log(`  invite email to ${seat.email}: "${mail.subject}"`);
    if (!(mail.text || mail.html).includes(inviteCode)) {
        ctx.finding({ severity: 'high', category: 'email', seat, title: 'Invite email does not contain the room code', detail: `Expected ${inviteCode} in: ${(mail.text || '').slice(0, 300)}` });
    }
}

async function joinWithCode(ctx, seat, inviteCode) {
    const { page } = seat;
    if (seat.kind === 'email') {
        // A signed-in player uses the home page's room-code box.
        await page.goto(ctx.webUrl + '/');
        await page.locator('#resume-code').fill(inviteCode);
        await page.locator('#resume-code-btn').click();
    } else {
        await page.goto(`${ctx.webUrl}/waiting.html?code=${inviteCode}`);
    }
    await page.waitForURL(/waiting\.html\?code=/);
    await page.locator('#guest-player-name').waitFor({ state: 'visible' });
    await page.locator('#guest-player-name').fill(seat.name);
    await page.locator('#guest-join-btn').click();
    await page.waitForURL(/waiting\.html\?room=/);
    ctx.markUi('ui.guest-join');
    if (seat.kind === 'email') {
        const me = await page.evaluate(() => apiFetch('/auth/me').catch(err => ({ error: err.message })));
        const email = me?.email || me?.user?.email || null;
        if (!email) {
            ctx.finding({
                severity: 'medium', category: 'ux', seat,
                title: 'A signed-in player who joins by room code becomes a guest',
                detail: `${seat.email} signed in, then joined with the home page code box; the session is now anonymous (/auth/me: ${JSON.stringify(me).slice(0, 200)}). Their email sign-in no longer finds this game and "Continue as an existing player" is their only way back.`,
            });
        }
    }
}

async function seatUserId(seat) {
    return seat.page.evaluate(() => (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null));
}

// Builds the whole table and starts the game. Returns { seats, inviteCode, roomId, gameId }.
async function buildTable(ctx, { players, emailSeats }) {
    const plans = seatPlan(players, emailSeats, !!ctx.run.email);
    const seats = [];
    for (const plan of plans) seats.push(await openSeat(ctx, plan));
    const [host, ...others] = seats;

    await signInByEmail(ctx, host);
    await ctx.shot(host, 'lobby-host');
    const inviteCode = await createRoom(ctx, host, players);
    ctx.log(`  room created, code ${inviteCode}`);
    await ctx.shot(host, 'waiting-room-host');

    for (const seat of others.filter(s => s.kind === 'email')) {
        await sendInvite(ctx, host, seat, inviteCode);
        await signInByEmail(ctx, seat);
    }
    for (const seat of others) {
        await joinWithCode(ctx, seat, inviteCode);
        ctx.log(`  seat ${seat.index} ${seat.name} (${seat.kind}, ${seat.device}) joined`);
    }
    await host.page.locator('#players-list').filter({ hasText: others[others.length - 1].name }).waitFor({ timeout: 15000 });
    await ctx.shot(host, 'waiting-room-full');
    if (others.length) await ctx.shot(others[0], 'waiting-room-guest');

    await host.page.locator('#start-game-btn').click();
    await Promise.all(seats.map(seat => seat.page.waitForURL(/game\.html\?room=/, { timeout: 20000 })));
    await Promise.all(seats.map(seat => seat.page.locator('#gameContent').filter({ hasText: 'Current Turn:' }).waitFor({ timeout: 20000 })));
    for (const seat of seats) seat.userId = await seatUserId(seat);
    const roomId = new URL(host.page.url()).searchParams.get('room');
    const game = ctx.sql(`SELECT id FROM games WHERE room_id = ?`, [roomId])[0];
    return { seats, inviteCode, roomId, gameId: game && game.id };
}

// Moves a seat to a brand-new browser (another phone), keeping its place at the table.
async function moveToNewBrowser(ctx, seat, open) {
    const context = await ctx.browser.newContext(contextOptions(seat.device));
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    const moved = { ...seat, context, page };
    try {
        await open(page);
        await page.waitForURL(/game\.html\?room=/, { timeout: 20000 });
        await page.locator('#gameContent').filter({ hasText: 'Current Turn:' }).waitFor({ timeout: 20000 });
    } catch (err) {
        await context.close().catch(() => {});
        throw err;
    }
    const old = seat.context;
    seat.context = context;
    seat.page = page;
    seat.gameUrl = page.url();
    watchPage(ctx, seat);
    await old.close().catch(() => {});
    return moved;
}

// "Play on another device": code from the old browser, link opened in the new one.
async function transferDevice(ctx, seat) {
    await seat.page.locator('#move-device-btn').click();
    const linkInput = seat.page.locator('#moveDeviceLink');
    await seat.page.waitForFunction(() => document.getElementById('moveDeviceLink')?.value, null, { timeout: 10000 });
    const link = new URL(await linkInput.inputValue());
    await seat.page.locator('[data-close-modal="moveDeviceModal"]').click().catch(() => {});
    const url = `${ctx.webUrl}${link.pathname}${link.search}`;
    await moveToNewBrowser(ctx, seat, page => page.goto(url));
}

// A guest on a new browser picks themselves under "Continue as an existing player";
// since the game requires it, another player approves the Rejoin request.
async function rejoinAsGuest(ctx, seat, inviteCode, approvers) {
    await moveToNewBrowser(ctx, seat, async page => {
        await page.goto(`${ctx.webUrl}/waiting.html?code=${inviteCode}`);
        await page.locator('#hotseat-resume-options button', { hasText: seat.name }).first().click();
        const deadline = Date.now() + 20000;
        let approved = false;
        while (!approved && Date.now() < deadline) {
            for (const other of approvers) {
                const prompt = other.page.locator('#rejoinPromptModal');
                if (await prompt.isVisible().catch(() => false) && (await prompt.innerText()).includes(seat.name)) {
                    await prompt.locator('[data-decision="approve"]').click();
                    ctx.log(`    ${other.name} approved ${seat.name}'s rejoin request`);
                    approved = true;
                    break;
                }
            }
            if (!approved) await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!approved) throw new Error('No player was shown a Rejoin request to approve within 20s');
    });
}

// Declines a Rejoin request nobody asked for (it would block that screen).
async function declineStrayRejoin(ctx, seat) {
    const prompt = seat.page.locator('#rejoinPromptModal');
    if (!(await prompt.isVisible().catch(() => false))) return false;
    await prompt.locator('[data-decision="deny"]').click().catch(() => {});
    ctx.log(`    ${seat.name} declined an unexpected Rejoin request`);
    return true;
}

module.exports = { buildTable, transferDevice, rejoinAsGuest, declineStrayRejoin, NAMES };
