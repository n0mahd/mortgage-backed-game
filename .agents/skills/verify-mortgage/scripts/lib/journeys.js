'use strict';

// App journeys: everything outside the game board, driven end to end through
// the real UI the way people use it. Accounts, My games, rooms, AI agents over
// the real MCP endpoint, the host's tools, resilience, and turn alerts. Each
// journey opens its own browsers (separate contexts, phone and desktop), makes
// its own users and rooms, asserts what a person would see, screenshots the
// key screens, and ends as one pathway: pass, finding (passed, but something
// was recorded), fail or skip (not verifiable headless). See ../../SKILL.md,
// "App journeys".

const fs = require('fs');
const path = require('path');
const { snapshotInPage, formatView } = require('./view');
const { contextOptions, watchPage } = require('./table');
const { readLoginCode } = require('./mail-sink');

const PASSWORD = 'journey-pass-2026';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const NARROW_WIDTHS = [320, 375, 390];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class JourneyFailure extends Error {}
class JourneySkip extends Error {}

const textMatches = (text, want) => (want instanceof RegExp ? want.test(text) : String(text).includes(want));

// The helper handed to each journey: people (browsers), waits that explain
// what was on screen when they time out, screenshots, findings and MCP calls.
class Journey {
    constructor(ctx, def, { dir, counter }) {
        this.ctx = ctx;
        this.def = def;
        this.dir = dir;
        this.counter = counter;
        this.people = [];
        this.findings = [];
        this.shots = [];
        this.notes = [];
        this.step = 'start';
        this.seq = 0;
        // Page watchers report console errors and 5xx against this journey.
        const journey = this;
        this.watchCtx = Object.create(ctx);
        this.watchCtx.recordIssue = (seat, kind, detail) => {
            if (seat.expectIssues && seat.expectIssues.test(detail)) return;
            // A fetch cut off because the person clicked on to another page is not a fault.
            if (kind === 'console-error' && /TypeError: Failed to fetch/.test(detail) && !seat.deferred) {
                const url = seat.page.url();
                setTimeout(() => {
                    if (seat.page.isClosed() || seat.page.url() !== url) { journey.log(`ignored a fetch cut off by navigation: ${detail.slice(0, 80)}`); return; }
                    seat.deferred = true;
                    journey.watchCtx.recordIssue(seat, kind, detail);
                    seat.deferred = false;
                }, 1500);
                return;
            }
            const entry = ctx.recordIssue(seat, kind, `[${def.id}] ${detail}`);
            journey.findings.push(`${kind}: ${String(detail).slice(0, 160)}`);
            return entry;
        };
    }

    log(line) {
        this.ctx.log(`    [${this.def.id}] ${line}`);
    }

    say(step) {
        this.step = step;
        this.log(step);
    }

    note(text) {
        this.notes.push(text);
        this.log(`note: ${text}`);
    }

    unique(prefix) {
        this.seq++;
        return `${prefix}${Date.now().toString(36).slice(-5)}${this.seq}${Math.random().toString(36).slice(2, 4)}`.slice(0, 24);
    }

    fail(message) {
        throw new JourneyFailure(message);
    }

    skip(message) {
        throw new JourneySkip(message);
    }

    // A new person in their own browser. device: phone | desktop | iphone.
    // alerts: a browser that allows notifications and can get pushes, through
    // the harness's local push service (see attachPushDevice).
    async person(name, { device = 'phone', standalone = false, permissions = [], ua, alerts = false } = {}) {
        const kind = device === 'iphone' ? 'phone' : device;
        const options = contextOptions(kind);
        if (device === 'iphone') options.userAgent = IPHONE_UA;
        if (ua) options.userAgent = ua;
        if (alerts) permissions = [...new Set([...permissions, 'notifications'])];
        const browser = alerts ? await this.ctx.alertsBrowser() : this.ctx.browser;
        const context = await browser.newContext(options);
        context.setDefaultTimeout(15000);
        if (standalone) {
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
            });
        }
        if (permissions.length) await context.grantPermissions(permissions, { origin: this.ctx.webUrl });
        const page = await context.newPage();
        this.counter.people++;
        const p = {
            index: this.counter.people,
            name, device: kind, kind: 'journey',
            viewport: options.viewport,
            context, page,
            dialogs: [], unreadDialogs: [], unreadIssues: [], lastControls: [],
            dismissNextConfirm: false, human: false, userId: null,
        };
        if (alerts) p.push = await attachPushDevice(this, p);
        watchPage(this.watchCtx, p);
        this.people.push(p);
        return p;
    }

    // Pushes the local push service received for this person since `since`
    // (an index from pushCount), each with its decrypted payload.
    pushCount(p) {
        return this.ctx.pushRelay.forPerson(p.push.device.person).length;
    }

    pushesSince(p, since = 0) {
        return this.ctx.pushRelay.forPerson(p.push.device.person).slice(since);
    }

    // Waits for a push to reach this person's service worker and returns it.
    async waitForPush(p, since, { title, timeout = 15000 } = {}) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const bad = this.pushesSince(p, since).find(r => r.error);
            if (bad) this.fail(`${p.name}: the push service refused or couldn't deliver a push: ${bad.error}`);
            const hit = this.pushesSince(p, since).find(r => r.delivered && (!title || textMatches(r.payload?.title || '', title)));
            if (hit) return hit;
            await sleep(200);
        }
        const got = this.pushesSince(p, since).map(r => r.payload?.title || r.error).join(', ') || 'nothing';
        this.fail(`${p.name}: no ${title ? `"${title}" ` : ''}push arrived within ${timeout / 1000}s (got: ${got})`);
    }

    // Notifications the service worker is showing on this person's device.
    async notifications(p) {
        return p.page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration('/');
            if (!reg) return [];
            return (await reg.getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url || null }));
        });
    }

    async waitForNotification(p, title, { timeout = 10000 } = {}) {
        const deadline = Date.now() + timeout;
        let shown = [];
        while (Date.now() < deadline) {
            shown = await this.notifications(p).catch(() => []);
            const hit = shown.find(n => textMatches(n.title, title));
            if (hit) return hit;
            await sleep(200);
        }
        this.fail(`${p.name}: the device is not showing a "${title}" notification (showing: ${shown.map(n => n.title).join(', ') || 'none'})`);
    }

    // A second tab in the same browser (same storage), watched like the first.
    async tab(p) {
        const page = await p.context.newPage();
        const t = { ...p, page, dialogs: [], unreadDialogs: [], unreadIssues: [], name: `${p.name}-tab2` };
        watchPage(this.watchCtx, t);
        this.people.push(t);
        return t;
    }

    async close() {
        const contexts = new Set(this.people.map(p => p.context));
        for (const context of contexts) await context.close().catch(() => {});
    }

    async goto(p, url) {
        await p.page.goto(new URL(url, this.ctx.webUrl).toString());
    }

    async shot(p, what) {
        this.counter.shots++;
        const base = `${String(this.counter.shots).padStart(3, '0')}-${this.def.id}-${p.name}-${what}`.replace(/[^\w.-]/g, '_');
        const file = path.join(this.dir, `${base}.png`);
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            await p.page.screenshot({ path: file, fullPage: true });
            const snap = await p.page.evaluate(snapshotInPage, { maxTextChars: 4000 });
            fs.writeFileSync(file.replace(/\.png$/, '.txt'), formatView(p, snap));
            this.shots.push(path.relative(path.dirname(this.dir), file));
            return file;
        } catch (err) {
            this.log(`(screenshot ${what} failed: ${err.message.split('\n')[0]})`);
            return null;
        }
    }

    loc(p, target) {
        return typeof target === 'string' ? p.page.locator(target) : target;
    }

    // Waits until a visible match shows `text` (string or RegExp); returns it.
    async see(p, target, text = null, { timeout = 12000, what } = {}) {
        const loc = this.loc(p, target);
        const deadline = Date.now() + timeout;
        let seen = '';
        for (;;) {
            try {
                const n = await loc.count();
                for (let i = 0; i < n; i++) {
                    const el = loc.nth(i);
                    if (!(await el.isVisible())) continue;
                    const t = text === null ? '' : await el.innerText();
                    if (text === null || textMatches(t, text)) return el;
                    seen = t;
                }
            } catch {}
            if (Date.now() > deadline) {
                const label = what || (typeof target === 'string' ? target : 'element');
                this.fail(`${p.name}: expected ${label}${text !== null ? ` to show "${text}"` : ' to be visible'}${seen ? `; it showed "${seen.replace(/\s+/g, ' ').slice(0, 200)}"` : ''} (${p.page.url().replace(this.ctx.webUrl, '')})`);
            }
            await sleep(200);
        }
    }

    // Waits until nothing visible matches (or nothing visible shows `text`).
    async gone(p, target, text = null, { timeout = 12000, what } = {}) {
        const loc = this.loc(p, target);
        const deadline = Date.now() + timeout;
        for (;;) {
            let present = false;
            try {
                const n = await loc.count();
                for (let i = 0; i < n && !present; i++) {
                    const el = loc.nth(i);
                    if (!(await el.isVisible())) continue;
                    if (text === null || textMatches(await el.innerText(), text)) present = true;
                }
            } catch {}
            if (!present) return;
            if (Date.now() > deadline) this.fail(`${p.name}: expected ${what || target}${text !== null ? ` not to show "${text}"` : ' to be hidden'}`);
            await sleep(200);
        }
    }

    async visible(p, target) {
        try {
            const loc = this.loc(p, target).first();
            return (await loc.count()) > 0 && await loc.isVisible();
        } catch {
            return false;
        }
    }

    async url(p, pattern, { timeout = 15000 } = {}) {
        try {
            await p.page.waitForURL(pattern, { timeout });
        } catch {
            this.fail(`${p.name}: expected to reach ${pattern}, but is on ${p.page.url().replace(this.ctx.webUrl, '')}`);
        }
    }

    async click(p, target) {
        const loc = this.loc(p, target).first();
        await loc.click();
    }

    async fill(p, target, value) {
        await this.loc(p, target).first().fill(String(value));
    }

    // Records a problem without failing the journey.
    finding({ severity = 'medium', category = 'journey', person, title, detail = '' }) {
        const entry = this.ctx.finding({ severity, category, seat: person || null, title: `[${this.def.id}] ${title}`, detail });
        this.findings.push(title);
        return entry;
    }

    async findingWithShot(p, opts) {
        const entry = this.finding({ ...opts, person: p });
        const file = await this.shot(p, `finding-${entry.id}`);
        if (file && entry.shots.length < 4) entry.shots.push(path.relative(this.ctx.evidenceDir, file));
        return entry;
    }

    sql(query, params = []) {
        return this.ctx.sql(query, params);
    }

    async token(p) {
        return p.page.evaluate(() => localStorage.getItem('auth_token'));
    }

    async me(p) {
        return p.page.evaluate(async () => {
            try { return await apiFetch('/auth/me'); } catch (err) { return { error: err.message, status: err.status }; }
        });
    }

    async userId(p) {
        const me = await this.me(p);
        if (!me || !me.id) this.fail(`${p.name}: not signed in (/auth/me: ${JSON.stringify(me).slice(0, 120)})`);
        p.userId = me.id;
        return me.id;
    }

    // An API call as this person, from their page (same origin, their token).
    async apiAs(p, method, apiPath, body) {
        return p.page.evaluate(async ({ method, apiPath, body }) => {
            try {
                return { ok: true, data: await apiFetch(apiPath, { method, ...(body ? { body: JSON.stringify(body) } : {}) }) };
            } catch (err) {
                return { ok: false, status: err.status, error: err.message };
            }
        }, { method, apiPath, body });
    }

    // One MCP tool call, JSON-RPC over HTTP like an agent's client (no Origin header).
    async mcp(name, args, { url } = {}) {
        const res = await fetch(url || `${this.ctx.webUrl}/api/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
        });
        const raw = await res.text();
        if (res.status !== 200) this.fail(`MCP ${name} answered HTTP ${res.status}: ${raw.slice(0, 200)}`);
        const json = JSON.parse(raw.startsWith('event:') || raw.startsWith('data:') ? raw.split('\n').find(l => l.startsWith('data:')).slice(5) : raw);
        if (json.error) return { isError: true, text: json.error.message || JSON.stringify(json.error) };
        const text = json.result?.content?.[0]?.text || '';
        if (json.result?.isError) return { isError: true, text };
        try {
            return { isError: false, body: JSON.parse(text) };
        } catch {
            return { isError: false, body: text };
        }
    }

    async mcpOk(name, args) {
        const r = await this.mcp(name, args);
        if (r.isError) this.fail(`MCP ${name} failed: ${r.text}`);
        return r.body;
    }

    game(roomId) {
        const row = this.sql('SELECT id, game_state, state_version FROM games WHERE room_id = ?', [roomId])[0];
        return row ? { id: row.id, state: JSON.parse(row.game_state), version: row.state_version } : null;
    }

    // Sideways scroll and content cut off at the right edge, at each phone width.
    async layout(p, label, widths = NARROW_WIDTHS) {
        const original = p.page.viewportSize();
        const problems = [];
        for (const width of widths) {
            await p.page.setViewportSize({ width, height: 760 });
            await sleep(300);
            const r = await p.page.evaluate(() => {
                const vw = document.documentElement.clientWidth;
                const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
                const visible = el => {
                    const s = getComputedStyle(el);
                    if (s.visibility === 'hidden' || s.display === 'none') return false;
                    const rc = el.getBoundingClientRect();
                    return rc.width > 0 && rc.height > 0;
                };
                // Inside a sideways scroller (a table or a chip row) is fine.
                const scrolls = el => {
                    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                        const ox = getComputedStyle(a).overflowX;
                        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
                    }
                    return false;
                };
                const describe = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40)}" right=${Math.round(el.getBoundingClientRect().right)}`;
                const cut = [];
                for (const el of document.querySelectorAll('body *')) {
                    if (cut.length >= 4) break;
                    if (!visible(el) || el.children.length > 3) continue;
                    const rc = el.getBoundingClientRect();
                    if ((rc.right > vw + 1 || rc.left < -1) && !scrolls(el)) cut.push(describe(el));
                }
                return { vw, sw, cut };
            });
            if (r.sw > r.vw + 1 || r.cut.length) problems.push({ width, ...r });
        }
        if (problems.length) {
            const worst = problems[0];
            await p.page.setViewportSize({ width: worst.width, height: 760 });
            await sleep(200);
            await this.findingWithShot(p, {
                severity: 'medium', category: 'layout',
                title: `${label}: content wider than the screen at ${problems.map(x => x.width).join('/')}px`,
                detail: problems.map(x => `${x.width}px: page ${x.sw}px wide in a ${x.vw}px viewport${x.cut.length ? `; past the edge: ${x.cut.join('; ')}` : ''}`).join(' | '),
            });
        } else {
            this.log(`layout ok at ${widths.join('/')}px: ${label}`);
        }
        if (original) await p.page.setViewportSize(original);
        await sleep(150);
    }
}

// ---------------------------------------------------------------- turn alerts

// Gives a person a push "device" on the harness's local push service
// (lib/push-relay.js). Headless Chromium can't reach a real push service, so
// PushManager hands out the relay's endpoint and harness-made keys; the
// backend's sending, the relay's VAPID check and decryption, and the service
// worker's notification are all real. Messages reach sw.js through CDP.
async function attachPushDevice(j, p) {
    const relay = j.ctx.pushRelay;
    if (!relay) j.fail('This run has no local push service (restart the run after updating the skill)');
    const device = relay.newDevice(`${p.name}#${p.index}`);
    await p.context.exposeBinding('__verifyPush', (_source, event, key) => {
        if (event === 'subscribe') { device.applicationServerKey = key; device.gone = false; }
        if (event === 'unsubscribe') device.gone = true;
    });
    await p.context.addInitScript(({ endpoint, keys }) => {
        const FLAG = 'verify_push_subscribed';
        const toB64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const make = () => ({
            endpoint,
            expirationTime: null,
            options: { userVisibleOnly: true },
            toJSON: () => ({ endpoint, expirationTime: null, keys }),
            async unsubscribe() {
                localStorage.removeItem(FLAG);
                await window.__verifyPush('unsubscribe');
                return true;
            },
        });
        PushManager.prototype.getSubscription = async function () {
            return localStorage.getItem(FLAG) ? make() : null;
        };
        PushManager.prototype.subscribe = async function (options = {}) {
            if (Notification.permission !== 'granted') throw new DOMException('Registration failed - permission denied', 'NotAllowedError');
            if (!options.userVisibleOnly || !options.applicationServerKey) throw new DOMException('Registration failed - missing applicationServerKey', 'AbortError');
            const key = typeof options.applicationServerKey === 'string' ? options.applicationServerKey : toB64Url(options.applicationServerKey);
            localStorage.setItem(FLAG, '1');
            await window.__verifyPush('subscribe', key);
            return make();
        };
    }, { endpoint: device.endpoint, keys: device.keys });
    const cdp = await p.context.newCDPSession(p.page);
    const registrations = new Map();
    cdp.on('ServiceWorker.workerRegistrationUpdated', e => {
        for (const r of e.registrations) {
            if (r.isDeleted) registrations.delete(r.registrationId); else registrations.set(r.registrationId, r);
        }
    });
    await cdp.send('ServiceWorker.enable');
    const origin = j.ctx.webUrl;
    device.deliver = async data => {
        const reg = [...registrations.values()].find(r => r.scopeURL === `${origin}/`);
        if (!reg) throw new Error('no service worker registered for the app on this device');
        await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: reg.registrationId, data });
    };
    return { device, cdp };
}

// Turns alerts on from the game page's Turn alerts sheet. Returns the endpoint saved.
async function turnOnAlerts(j, p) {
    await j.click(p, '#turn-alerts-btn');
    await j.see(p, '#turnAlertsModal');
    await j.see(p, '#turnAlertsActions [data-turn-alerts="enable"]', 'Turn on alerts', { what: 'the Turn on alerts button' });
    await j.click(p, '#turnAlertsActions [data-turn-alerts="enable"]');
    await j.see(p, '#turnAlertsStatus', 'Alerts turned on.', { timeout: 15000 });
    const rows = j.sql('SELECT endpoint FROM push_subscriptions WHERE user_id = ?', [p.userId]);
    if (!rows.some(r => r.endpoint === p.push.device.endpoint)) j.fail(`${p.name}: Turn on alerts did not save this device's subscription (saved: ${rows.length})`);
    return p.push.device.endpoint;
}

// ---------------------------------------------------------------- shared flows

async function register(j, p, { prefix = 'jr', viaHome = false } = {}) {
    const username = j.unique(prefix);
    if (viaHome) {
        await j.goto(p, '/');
        await j.click(p, 'a[href="auth.html?mode=register"]');
    } else {
        await j.goto(p, '/auth.html?mode=register');
    }
    await j.url(p, /auth\.html\?mode=register/);
    await j.see(p, '#register-username');
    await j.fill(p, '#register-username', username);
    await j.fill(p, '#register-password', PASSWORD);
    await j.fill(p, '#register-confirm', PASSWORD);
    await j.click(p, '#register-btn');
    await j.url(p, /lobby\.html/);
    await j.see(p, '#account-name', username);
    p.username = username;
    await j.userId(p);
    return username;
}

async function signIn(j, p, login, password = PASSWORD) {
    await j.goto(p, '/auth.html');
    await j.see(p, '#login-input');
    await j.fill(p, '#login-input', login);
    await j.fill(p, '#password-input', password);
    await j.click(p, '#signin-btn');
}

async function logOut(j, p) {
    if (!/lobby\.html/.test(p.page.url())) await j.goto(p, '/lobby.html');
    await j.click(p, '#logout-btn');
    await j.url(p, /index\.html|\/$/);
    if (await j.token(p)) j.fail(`${p.name}: still holds a token after Log out`);
}

// The login code from the email the person got (the local mail sink on dev
// runs); the dev DB only when the run has no mailbox.
async function readOtp(j, email) {
    if (j.ctx.mailbox) {
        try {
            return await readLoginCode(j.ctx.mailbox, email);
        } catch (err) {
            j.fail(err.message);
        }
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const row = j.sql('SELECT code FROM otps WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1', [email.toLowerCase()])[0];
        if (row) return row.code;
        await sleep(250);
    }
    j.fail(`No login code stored for ${email}`);
}

async function emailSignIn(j, p, email) {
    await j.goto(p, '/auth.html?mode=email');
    await j.see(p, '#email-input');
    await j.fill(p, '#email-input', email);
    await j.click(p, '#send-code-btn');
    await j.see(p, '#sent-to-email', email);
    await j.fill(p, '#code-input', await readOtp(j, email));
    await j.click(p, '#verify-code-btn');
    await j.url(p, /lobby\.html/);
    await j.userId(p);
}

function testEmail(j) {
    return `journey-${j.unique('m').toLowerCase()}@example.test`;
}

// From My games: Create New Game. Returns { roomId, code }.
async function createRoom(j, host, { name, max = 4, playerName, spectate = false } = {}) {
    if (!/lobby\.html/.test(host.page.url())) await j.goto(host, '/lobby.html');
    await j.click(host, '#show-create-room-btn');
    await j.see(host, '#createRoomModal');
    await j.fill(host, '#room-name', name || `Journey ${j.def.id}`);
    await j.fill(host, '#max-players', max);
    if (spectate) await host.page.locator('#host-spectate').check();
    else await j.fill(host, '#host-player-name', playerName || host.name);
    await j.click(host, '#create-room-btn');
    await j.url(host, /waiting\.html\?room=/);
    await host.page.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.getElementById('invite-code')?.innerText.trim()), null, { timeout: 15000 });
    const code = (await host.page.locator('#invite-code').innerText()).trim();
    const roomId = new URL(host.page.url()).searchParams.get('room');
    return { roomId, code };
}

// The room-code box on the home page, or the invite link (waiting.html?code=).
async function joinRoom(j, p, code, { name = p.name, via = 'link' } = {}) {
    if (via === 'home') {
        await j.goto(p, '/');
        await j.fill(p, '#resume-code', code);
        await j.click(p, '#resume-code-btn');
    } else {
        await j.goto(p, `/waiting.html?code=${code}`);
    }
    await j.url(p, /waiting\.html\?code=/);
    await j.see(p, '#guest-player-name', null, { what: 'the name field to join' });
    await j.fill(p, '#guest-player-name', name);
    await j.click(p, '#guest-join-btn');
    await j.url(p, /waiting\.html\?room=/);
    await j.see(p, '#players-list', name);
    await j.userId(p);
}

async function inGame(j, p, { timeout = 20000 } = {}) {
    await j.url(p, /game\.html\?room=/, { timeout });
    await j.see(p, '#gameContent', 'Current Turn:', { timeout, what: 'the game screen' });
}

async function startGame(j, host, players) {
    await j.see(host, '#start-game-btn:not([disabled])', /Start Game/, { what: 'an enabled Start Game button' });
    await j.click(host, '#start-game-btn');
    await Promise.all(players.map(p => inGame(j, p)));
}

// Host (account, desktop) and a guest (phone) in a started 2-player game.
async function twoPlayerGame(j, { hostDevice = 'desktop', guestDevice = 'phone', hostName = 'Hal', guestName = 'Gia', max = 2, guestAccount = false, guestAlerts = false } = {}) {
    const host = await j.person(hostName, { device: hostDevice });
    await register(j, host, { prefix: 'host' });
    const room = await createRoom(j, host, { max });
    const guest = await j.person(guestName, { device: guestDevice, alerts: guestAlerts });
    if (guestAccount) await register(j, guest, { prefix: 'acct' });
    await joinRoom(j, guest, room.code);
    await j.see(host, '#players-list', guestName);
    await startGame(j, host, [host, guest]);
    return { host, guest, ...room };
}

// What this page believes: whose turn, my player, version.
async function pageGame(p) {
    return p.page.evaluate(() => {
        if (typeof currentGame === 'undefined' || !currentGame || typeof currentUser === 'undefined' || !currentUser) return null;
        const s = currentGame.game_state;
        const cur = s.players[s.currentPlayerIndex];
        const me = s.players.find(x => x.userId === currentUser.id) || null;
        return { v: currentGame.state_version, mine: !!cur && !!me && cur.userId === me.userId, current: cur && cur.name, me, auction: s.auction?.status === 'open', paused: !!s.paused, ended: !!s.ended, host: typeof isRoomHost === 'function' ? isRoomHost() : null };
    }).catch(() => null);
}

function button(p, action) {
    return p.page.locator(`#game.section.active [data-game-action="${action}"]`).first();
}

async function usable(loc) {
    try {
        return (await loc.count()) > 0 && await loc.isVisible() && await loc.isEnabled();
    } catch {
        return false;
    }
}

// Clicks and waits for this page's game version to move (or an alert refusal).
async function actWait(j, p, loc, label) {
    const before = (await pageGame(p))?.v ?? -1;
    const dialogs = p.dialogs.length;
    await loc.click();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (((await pageGame(p))?.v ?? -1) > before) return;
        const alert = p.dialogs.slice(dialogs).find(d => d.type === 'alert');
        if (alert) j.fail(`${p.name}: "${label}" was refused: ${alert.message}`);
        await sleep(150);
    }
    j.fail(`${p.name}: "${label}" had no visible effect within 10s (version stayed ${before})`);
}

async function gameTab(p) {
    const tab = p.page.locator('.nav-tab[data-section="game"]');
    if (await tab.count() && !((await tab.getAttribute('class')) || '').includes('active')) await tab.click().catch(() => {});
}

// Plays this page's current turn through the real buttons: roll, buy (or
// auction if it can't), roll again on doubles, end turn. Others pass auctions.
async function takeTurn(j, p, { others = [] } = {}) {
    for (let step = 0; step < 20; step++) {
        if (await j.visible(p, '#hotseat-interstitial')) await j.click(p, '#dismiss-hotseat-btn');
        const g = await pageGame(p);
        if (!g) j.fail(`${p.name}: not on a game screen`);
        if (!g.mine || g.ended) return;
        await gameTab(p);
        if (g.auction) {
            for (const q of [p, ...others]) {
                if (await usable(button(q, 'pass-auction'))) await actWait(j, q, button(q, 'pass-auction'), 'pass auction');
            }
            continue;
        }
        if (!g.me.diceRolled) {
            if (g.me.inJail && await usable(button(p, 'pay-jail-fine'))) await actWait(j, p, button(p, 'pay-jail-fine'), 'pay jail fine');
            else await actWait(j, p, button(p, 'roll-dice'), 'roll dice');
            continue;
        }
        if (await usable(button(p, 'open-buy-property'))) {
            await button(p, 'open-buy-property').click();
            await j.see(p, '#buyPropertyModal');
            const buy = p.page.locator('#confirm-purchase-btn');
            if (await usable(buy)) await actWait(j, p, buy, 'buy property');
            else await actWait(j, p, p.page.locator('#start-auction-btn'), 'start auction');
            const close = p.page.locator('.modal.active [data-close-modal]');
            if (await usable(close.first())) await close.first().click().catch(() => {});
            continue;
        }
        if (await usable(button(p, 'roll-dice'))) {
            await actWait(j, p, button(p, 'roll-dice'), 'roll again');
            continue;
        }
        const end = button(p, 'end-turn');
        if (await usable(end)) {
            await actWait(j, p, end, 'end turn');
            return;
        }
        await j.shot(p, 'stuck-turn');
        j.fail(`${p.name}: my turn, rolled, but no Buy or End Turn button to use`);
    }
    j.fail(`${p.name}: turn took more than 20 steps`);
}

// Plays `turns` turns among UI players, whoever's turn it is.
async function playTurns(j, people, turns) {
    for (let t = 0; t < turns; t++) {
        let mover = null;
        for (let tries = 0; tries < 40 && !mover; tries++) {
            for (const p of people) if ((await pageGame(p))?.mine) { mover = p; break; }
            if (!mover) await sleep(250);
        }
        if (!mover) j.fail(`No player's screen says it is their turn (${(await Promise.all(people.map(async p => `${p.name}: ${JSON.stringify((await pageGame(p))?.current)}`))).join(', ')})`);
        await takeTurn(j, mover, { others: people.filter(p => p !== mover) });
    }
}

// Waits until this page shows the server's version of the game.
async function caughtUp(j, p, roomId, { timeout = 15000 } = {}) {
    const deadline = Date.now() + timeout;
    let g;
    while (Date.now() < deadline) {
        const server = j.game(roomId);
        g = await pageGame(p);
        if (g && server && g.v === server.version) return server;
        await sleep(250);
    }
    j.fail(`${p.name}: screen stuck at version ${g?.v} while the server is at ${j.game(roomId)?.version}`);
}

// One agent decision over MCP: roll, buy, end the turn, or pass an auction.
async function agentStep(j, key) {
    const s = await j.mcpOk('get_game_state', { agent_key: key });
    const legal = new Set((s.legal_actions || []).map(a => a.type));
    let type = null;
    if (s.status === 'auction_needs_you' && legal.has('pass_auction')) type = 'pass_auction';
    else if (s.status === 'your_turn') {
        type = ['roll_dice', 'buy_property', 'start_auction', 'end_turn'].find(t => legal.has(t));
        if (type === 'start_auction' && legal.has('end_turn')) type = 'end_turn';
    }
    if (!type) return { status: s.status, type: null, state: s };
    const r = await j.mcp('take_action', { agent_key: key, type, payload: {} });
    if (r.isError) j.fail(`Agent's ${type} was refused: ${r.text}`);
    return { status: s.status, type, state: r.body.state };
}

// Plays the agent's whole turn (and any auction it is asked about).
async function agentTurn(j, key) {
    const done = [];
    for (let i = 0; i < 15; i++) {
        const r = await agentStep(j, key);
        if (!r.type) return done;
        done.push(r.type);
        if (r.type === 'end_turn') return done;
    }
    j.fail(`Agent turn took more than 15 actions: ${done.join(', ')}`);
}

// Creates an agent invite from the waiting room; returns { key, prompt, mcpUrl }.
async function inviteAgent(j, host, name) {
    await j.see(host, '#agent-invites', null, { what: 'the agent invite panel' });
    await j.fill(host, '#agent-invite-name', name || '');
    await j.click(host, '#agent-invite-create-btn');
    await j.see(host, '#agent-invite-modal');
    await host.page.waitForFunction(() => /mbagent_/.test(document.getElementById('agent-invite-prompt')?.value || ''), null, { timeout: 10000 });
    const prompt = await host.page.locator('#agent-invite-prompt').inputValue();
    const mcpUrl = (await host.page.locator('#agent-invite-mcp-url').innerText()).trim();
    const key = (prompt.match(/mbagent_[A-Za-z0-9_-]+/) || [])[0];
    if (!key) j.fail('The agent invite has no key in it');
    return { key, prompt, mcpUrl };
}

async function closeInvite(j, host) {
    await j.click(host, '#agent-invite-close-btn');
    await j.gone(host, '#agent-invite-modal');
}

// The seat link the host copies from Manage players: what the clipboard got,
// else the link shown for copying by hand.
async function copySeatLink(j, host, playerName) {
    await host.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: j.ctx.webUrl });
    const row = host.page.locator('.manage-player-row', { hasText: playerName });
    await j.see(host, row, null, { what: `${playerName}'s row in Manage players` });
    const [response] = await Promise.all([
        host.page.waitForResponse(res => /\/members\/[^/]+\/link$/.test(res.url()) && res.request().method() === 'POST', { timeout: 15000 }),
        row.getByRole('button', { name: 'Copy link' }).click(),
    ]);
    const served = (await response.json()).url;
    await j.see(host, '#manage-room-status', playerName);
    let url = await host.page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '');
    if (!/seat=/.test(url || '')) url = await host.page.locator('#manage-link-url').inputValue().catch(() => '');
    if (!/seat=/.test(url || '')) {
        j.note('Copy link: neither the clipboard nor the link field had the link; used the server response');
        url = served;
    }
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
}

async function openManage(j, host, roomId) {
    await j.goto(host, `/lobby.html?manage=${roomId}`);
    await j.see(host, '#manageRoomModal');
    await j.see(host, '#manage-player-list .manage-player-row');
}

// ---------------------------------------------------------------- journeys

const JOURNEYS = [
    // ===== Accounts =====
    {
        id: 'accounts.register-home', group: 'Accounts', label: 'Create an account with a password from the home page',
        async run(j) {
            const p = await j.person('Ava', { device: 'phone' });
            await j.goto(p, '/');
            await j.see(p, 'a[href="auth.html?mode=register"]', 'Create New Game');
            await j.layout(p, 'Home page');
            await j.click(p, 'a[href="auth.html?mode=register"]');
            await j.url(p, /auth\.html\?mode=register/);
            await j.see(p, '#view-register');
            await j.shot(p, 'register-form');
            await j.layout(p, 'Create account');
            j.say('mismatched passwords are refused');
            const username = j.unique('ava');
            await j.fill(p, '#register-username', username);
            await j.fill(p, '#register-password', PASSWORD);
            await j.fill(p, '#register-confirm', 'not the same');
            await j.click(p, '#register-btn');
            await j.see(p, '#register-error', "don't match");
            j.say('short username is refused');
            await j.fill(p, '#register-username', 'ab');
            await j.fill(p, '#register-confirm', PASSWORD);
            await j.click(p, '#register-btn');
            await j.see(p, '#register-error', /3 to 24/);
            j.say('valid form creates the account');
            await j.fill(p, '#register-username', username);
            await j.click(p, '#register-btn');
            await j.url(p, /lobby\.html/);
            await j.see(p, '#account-name', username);
            await j.gone(p, '#guest-banner');
            await j.see(p, '#active-rooms-list', 'No games yet');
            await j.shot(p, 'my-games-new-account');
            await j.layout(p, 'My games (empty)');
            const me = await j.me(p);
            if (me.is_anonymous || me.username !== username || !me.has_password) j.fail(`/auth/me after registering: ${JSON.stringify(me)}`);
            j.say('the same username cannot be registered twice');
            const q = await j.person('Ava2', { device: 'desktop' });
            await j.goto(q, '/auth.html?mode=register');
            await j.fill(q, '#register-username', username.toUpperCase());
            await j.fill(q, '#register-password', PASSWORD);
            await j.fill(q, '#register-confirm', PASSWORD);
            await j.click(q, '#register-btn');
            await j.see(q, '#register-error', /taken/i);
        },
    },
    {
        id: 'accounts.signin-username', group: 'Accounts', label: 'Sign out, then sign in by username from the home page',
        async run(j) {
            const p = await j.person('Ben', { device: 'desktop' });
            const username = await register(j, p);
            j.say('log out');
            await logOut(j, p);
            j.say('find a way to sign in from the home page');
            const signInLinks = await p.page.locator('a[href^="auth.html"]:not([href*="mode=register"]):visible').count();
            if (!signInLinks) {
                await j.findingWithShot(p, {
                    severity: 'medium', category: 'ux',
                    title: 'After Log out, the home page has no visible Sign in link',
                    detail: 'Log out lands on index.html. Its only sign-in link is inside #signed-out-notice, which is hidden unless ?signin=game. A returning player must guess that "Create New Game" leads to "I already have an account".',
                });
                await j.click(p, 'a[href="auth.html?mode=register"]');
                await j.see(p, '#view-register');
                await j.click(p, '#view-register [data-auth-switch="signin"]');
            } else {
                await p.page.locator('a[href^="auth.html"]:not([href*="mode=register"]):visible').first().click();
            }
            await j.see(p, '#view-signin');
            await j.shot(p, 'signin-form');
            await j.layout(p, 'Sign in');
            await j.fill(p, '#login-input', username.toUpperCase());
            await j.fill(p, '#password-input', PASSWORD);
            await j.click(p, '#signin-btn');
            await j.url(p, /lobby\.html/);
            await j.see(p, '#account-name', username);
            if ((await j.userId(p)) !== p.userId) j.fail('Signed in as a different user');
            j.say('an account opening auth.html goes straight on');
            await j.goto(p, '/auth.html');
            await j.url(p, /lobby\.html/);
        },
    },
    {
        id: 'accounts.wrong-password', group: 'Accounts', label: 'Wrong password and unknown username get the same message',
        async run(j) {
            const p = await j.person('Cleo', { device: 'phone' });
            const username = await register(j, p);
            await logOut(j, p);
            await signIn(j, p, username, 'wrong-password-123');
            await j.see(p, '#signin-error', 'Wrong username or password');
            await j.shot(p, 'wrong-password');
            if (await j.token(p)) j.fail('A token was stored after a failed sign-in');
            await j.layout(p, 'Sign in error');
            await signIn(j, p, j.unique('nobody'), 'wrong-password-123');
            await j.see(p, '#signin-error', 'Wrong username or password');
            j.say('empty fields');
            await j.fill(p, '#login-input', '');
            await j.fill(p, '#password-input', '');
            await j.click(p, '#signin-btn');
            await j.see(p, '#signin-error', /Enter your username/);
            j.say('correct password still works');
            await signIn(j, p, username);
            await j.url(p, /lobby\.html/);
        },
    },
    {
        id: 'accounts.email-code-password', group: 'Accounts', label: 'Email-code account sets a password, then signs in by email+password and by username',
        async run(j) {
            const p = await j.person('Dev', { device: 'phone' });
            const email = testEmail(j);
            await j.goto(p, '/auth.html');
            await j.click(p, '[data-auth-switch="email"]');
            await j.see(p, '#step-email');
            await j.layout(p, 'Email code sign-in');
            await j.fill(p, '#email-input', email);
            await j.click(p, '#send-code-btn');
            await j.see(p, '#step-code');
            await j.see(p, '#sent-to-email', email);
            await j.shot(p, 'enter-code');
            j.say('a wrong code is refused');
            p.expectIssues = /Verify code error: Error: Invalid or expired code/;
            await j.fill(p, '#code-input', '000000');
            await j.click(p, '#verify-code-btn');
            await j.see(p, '#code-error', /./);
            await j.fill(p, '#code-input', await readOtp(j, email));
            await j.click(p, '#verify-code-btn');
            await j.url(p, /lobby\.html/);
            await j.see(p, '#account-name', email);
            j.say('Set password');
            await j.see(p, '#set-password-btn', 'Set password');
            await j.click(p, '#set-password-btn');
            await j.see(p, '#setPasswordModal');
            await j.layout(p, 'Set password sheet');
            const username = j.unique('dev');
            await j.fill(p, '#set-password-username', username);
            await j.fill(p, '#set-password-new', PASSWORD);
            await j.fill(p, '#set-password-confirm', PASSWORD);
            await j.click(p, '#set-password-save-btn');
            await j.gone(p, '#setPasswordModal');
            await j.gone(p, '#set-password-btn');
            await j.shot(p, 'password-saved');
            const me = await j.me(p);
            if (!me.has_password || me.username !== username || me.email !== email) j.fail(`/auth/me after setting a password: ${JSON.stringify(me)}`);
            const id = me.id;
            j.say('sign in with email + password');
            await logOut(j, p);
            await signIn(j, p, email.toUpperCase());
            await j.url(p, /lobby\.html/);
            if ((await j.userId(p)) !== id) j.fail('Email+password signed in as another user');
            j.say('sign in with the new username');
            await logOut(j, p);
            await signIn(j, p, username);
            await j.url(p, /lobby\.html/);
            if ((await j.userId(p)) !== id) j.fail('Username sign-in reached another user');
        },
    },
    {
        id: 'accounts.guest-upgrade', group: 'Accounts', label: 'A guest plays, creates an account, and keeps the game in My games',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            const guestId = guest.userId;
            j.say('play a round so the guest has moved');
            await playTurns(j, [host, guest], 2);
            j.say('guest goes to My games');
            await j.click(guest, '.app-bar-back');
            await j.url(guest, /lobby\.html/);
            await j.see(guest, '#guest-banner', /account/i);
            await j.see(guest, `#active-rooms-list [data-room-id="${roomId}"]`, 'In Progress');
            await j.shot(guest, 'guest-my-games');
            await j.layout(guest, 'My games (guest banner)');
            await guest.page.locator('#guest-banner a', { hasText: /Create an account/i }).click();
            await j.url(guest, /auth\.html\?mode=register/);
            await j.see(guest, '#register-keeps-games', 'Your current games stay with you.');
            const username = j.unique('gia');
            await j.fill(guest, '#register-username', username);
            await j.fill(guest, '#register-password', PASSWORD);
            await j.fill(guest, '#register-confirm', PASSWORD);
            await j.click(guest, '#register-btn');
            await j.url(guest, /lobby\.html/);
            await j.see(guest, '#account-name', username);
            await j.gone(guest, '#guest-banner');
            await j.see(guest, `#active-rooms-list [data-room-id="${roomId}"]`, 'In Progress');
            if ((await j.userId(guest)) !== guestId) j.fail('Registering made a new user instead of upgrading the guest');
            j.say('open the game again from My games');
            await j.click(guest, `[data-room-open="${roomId}"]`);
            await inGame(j, guest);
            await j.see(guest, '.player-card.current-user', 'Gia');
            j.say('the account works from a new browser');
            const other = await j.person('Gia-laptop', { device: 'desktop' });
            await signIn(j, other, username);
            await j.url(other, /lobby\.html/);
            await j.see(other, `#active-rooms-list [data-room-id="${roomId}"]`);
            await j.click(other, `[data-room-open="${roomId}"]`);
            await inGame(j, other);
            await j.see(other, '.player-card.current-user', 'Gia');
        },
    },
    {
        id: 'accounts.next-param', group: 'Accounts', label: 'Sign-in honours a same-site ?next= and ignores another site',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { roomId } = await createRoom(j, host);
            const username = host.username;
            await logOut(j, host);
            j.say('?next= back into the waiting room');
            await j.goto(host, `/auth.html?next=${encodeURIComponent(`waiting.html?room=${roomId}`)}`);
            await j.fill(host, '#login-input', username);
            await j.fill(host, '#password-input', PASSWORD);
            await j.click(host, '#signin-btn');
            await j.url(host, new RegExp(`waiting\\.html\\?room=${roomId}`));
            await j.see(host, '#host-controls');
            await logOut(j, host);
            j.say('?next= to another site is ignored');
            for (const bad of ['//example.com/x', 'https://example.com/', 'javascript:alert(1)']) {
                await j.goto(host, `/auth.html?next=${encodeURIComponent(bad)}`);
                await j.fill(host, '#login-input', username);
                await j.fill(host, '#password-input', PASSWORD);
                await j.click(host, '#signin-btn');
                await j.url(host, /lobby\.html/);
                if (!host.page.url().startsWith(j.ctx.webUrl)) j.fail(`?next=${bad} left the site: ${host.page.url()}`);
                await logOut(j, host);
            }
        },
    },
    {
        id: 'accounts.device-transfer', group: 'Accounts', label: 'Move to a second browser with a one-time code (typed, and as a link)',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            j.say('Play on another device');
            await j.click(guest, '#move-device-btn');
            await j.see(guest, '#moveDeviceModal');
            await guest.page.waitForFunction(() => /\w{4} \w{4}/.test(document.getElementById('moveDeviceCode')?.innerText || ''), null, { timeout: 10000 });
            await j.shot(guest, 'move-device-sheet');
            await j.layout(guest, 'Play on another device sheet');
            const code = (await guest.page.locator('#moveDeviceCode').innerText()).replace(/\s+/g, '');
            j.say('type the code on a laptop');
            const laptop = await j.person('Gia-laptop', { device: 'desktop' });
            await j.goto(laptop, '/');
            await laptop.page.locator('.resume-more summary').click();
            await j.fill(laptop, '#transfer-code', code.toLowerCase());
            await j.click(laptop, '#transfer-code-btn');
            await inGame(j, laptop);
            if ((await j.userId(laptop)) !== guest.userId) j.fail('The transfer code signed in as someone else');
            await j.see(laptop, '.player-card.current-user', 'Gia');
            j.say('the code works once');
            const third = await j.person('Stranger', { device: 'phone' });
            await j.goto(third, '/');
            await third.page.locator('.resume-more summary').click();
            await j.fill(third, '#transfer-code', code);
            await j.click(third, '#transfer-code-btn');
            await j.see(third, '#transfer-error', /./);
            await j.shot(third, 'used-code-refused');
            if (await j.token(third)) j.fail('A used transfer code still signed a browser in');
            j.say('the link form of a fresh code');
            await j.click(laptop, '#move-device-btn');
            await laptop.page.waitForFunction(() => document.getElementById('moveDeviceLink')?.value, null, { timeout: 10000 });
            const link = new URL(await laptop.page.locator('#moveDeviceLink').inputValue());
            const tablet = await j.person('Gia-tablet', { device: 'phone' });
            await j.goto(tablet, `${link.pathname}${link.search}`);
            await inGame(j, tablet);
            if ((await j.userId(tablet)) !== guest.userId) j.fail('The transfer link signed in as someone else');
            if (/transfer=/.test(tablet.page.url())) j.fail('The transfer code stayed in the address bar');
            j.say('the moved player can still play');
            await playTurns(j, [host, tablet], 2);
            await caughtUp(j, guest, roomId);
        },
    },
    {
        id: 'accounts.signed-out-game-link', group: 'Accounts', label: 'A game link opened in a signed-out browser explains the ways back in',
        async run(j) {
            const { roomId } = await twoPlayerGame(j);
            const other = await j.person('Gia-other', { device: 'phone' });
            await j.goto(other, `/game.html?room=${roomId}`);
            await j.url(other, /index\.html\?signin=game/);
            await j.see(other, '#signed-out-notice', 'Play on another device');
            await j.see(other, '#transfer-code');
            await j.shot(other, 'signed-out-notice');
            await j.layout(other, 'Home page (signed-out game link)');
            await other.page.locator('#signed-out-notice a[href="auth.html"]').click();
            await j.url(other, /auth\.html/);
        },
    },
    {
        id: 'accounts.forgot-room-code', group: 'Accounts', label: 'Forgot your room code? emails the codes of your rooms, and nothing to an unknown address',
        async run(j) {
            const forgot = async (p, email) => {
                await j.goto(p, '/');
                await p.page.locator('.resume-more summary').click();
                await j.click(p, '#forgot-code-link');
                await j.see(p, '#forgot-code-form');
                if (email === null) {
                    await j.click(p, '#send-forgot-code-btn');
                    return j.see(p, '#forgot-error', /email/i);
                }
                await j.fill(p, '#forgot-email', email);
                await j.click(p, '#send-forgot-code-btn');
                return j.see(p, '#forgot-success', /./, { what: 'the Send Codes answer' });
            };
            j.say('an email player with a room');
            const owner = await j.person('Eli', { device: 'phone' });
            const email = testEmail(j);
            await emailSignIn(j, owner, email);
            const { code } = await createRoom(j, owner, { max: 2, playerName: 'Eli' });
            await logOut(j, owner);
            const p = await j.person('Eli-later', { device: 'phone' });
            await forgot(p, null);
            const since = Date.now();
            const answer = (await (await forgot(p, email)).innerText()).trim();
            await j.shot(p, 'forgot-code-answer');
            if (!j.ctx.mailbox) j.skip(`Answer shown: ${answer}. This run sends real mail, so delivery is checked in the inbox, not here.`);
            const deadline = Date.now() + 10000;
            let mail = null;
            while (!mail && Date.now() < deadline) {
                mail = j.ctx.mailbox.to(email).find(m => m.at >= since && /room codes/i.test(m.subject));
                if (!mail) await sleep(200);
            }
            if (!mail) j.fail(`"${answer}" was shown, but no room-code email reached ${email}`);
            if (!mail.text.includes(code) || !mail.html.includes(code)) j.fail(`The room-code email does not have the room's code ${code}: "${mail.text.slice(0, 120)}"`);
            j.note(`Email "${mail.subject}": ${mail.text.replace(/\s+/g, ' ').slice(0, 100)}`);
            j.say('an address with no rooms gets the same answer and no email');
            const stranger = testEmail(j);
            const strangerAnswer = (await (await forgot(p, stranger)).innerText()).trim();
            if (strangerAnswer !== answer) j.fail(`An unknown address got a different answer ("${strangerAnswer}" vs "${answer}"), which tells people who has an account`);
            await sleep(1500);
            if (j.ctx.mailbox.to(stranger).length) j.fail('An address with no rooms was sent an email');
        },
    },

    // ===== My games =====
    {
        id: 'games.open-rooms', group: 'My games', label: 'My games lists waiting and in-progress games and opens each',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            const waitingRoom = await createRoom(j, host, { name: 'Journey Waiting' });
            const live = await createRoom(j, host, { name: 'Journey Live', max: 2 });
            const guest = await j.person('Gia', { device: 'desktop' });
            await joinRoom(j, guest, live.code);
            await startGame(j, host, [host, guest]);
            j.say('My games');
            await j.goto(host, '/lobby.html');
            const waitingCard = await j.see(host, `#active-rooms-list [data-room-id="${waitingRoom.roomId}"]`, 'Waiting');
            const liveCard = await j.see(host, `#active-rooms-list [data-room-id="${live.roomId}"]`, 'In Progress');
            for (const card of [waitingCard, liveCard]) {
                const text = await card.innerText();
                if (!/Host/.test(text)) j.fail(`Room card does not say Host: ${text}`);
            }
            if (!(await liveCard.innerText()).includes(live.code)) j.fail('Room card does not show the room code');
            await j.shot(host, 'my-games-two-rooms');
            await j.layout(host, 'My games (rooms)');
            j.say('open the in-progress game');
            await j.click(host, `[data-room-open="${live.roomId}"]`);
            await inGame(j, host);
            j.say('back, open the waiting room');
            await j.click(host, '.app-bar-back');
            await j.url(host, /lobby\.html/);
            await j.click(host, `[data-room-open="${waitingRoom.roomId}"]`);
            await j.url(host, new RegExp(`waiting\\.html\\?room=${waitingRoom.roomId}`));
            await j.see(host, '#room-name', 'Journey Waiting');
            j.say('the other player sees the game too, without Host or Manage');
            await j.goto(guest, '/lobby.html');
            const theirs = await j.see(guest, `#active-rooms-list [data-room-id="${live.roomId}"]`, 'In Progress');
            if (/\bHost\b/.test(await theirs.innerText())) j.fail('A non-host sees a Host badge on the room card');
            if (await j.visible(guest, `[data-room-manage="${live.roomId}"]`)) j.fail('A non-host sees Manage on the room card');
        },
    },
    {
        id: 'games.archive-unarchive', group: 'My games', label: 'Archive and unarchive games (per user, does not end the game)',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j, { hostDevice: 'phone', guestDevice: 'desktop' });
            await j.goto(host, '/lobby.html');
            await j.see(host, `#active-rooms-list [data-room-id="${roomId}"]`);
            j.say('archive');
            await j.click(host, `[data-room-archive="${roomId}"]`);
            await j.see(host, '#archived-rooms-section');
            await j.see(host, `#archived-rooms-list [data-room-id="${roomId}"]`);
            await j.gone(host, `#active-rooms-list [data-room-id="${roomId}"]`);
            await j.shot(host, 'archived');
            await j.layout(host, 'My games (archived)');
            await host.page.reload();
            await j.see(host, `#archived-rooms-list [data-room-id="${roomId}"]`, null, { what: 'the archived game after reload' });
            j.say('archiving is per user and does not end the game');
            await j.goto(guest, '/lobby.html');
            await j.see(guest, `#active-rooms-list [data-room-id="${roomId}"]`, 'In Progress');
            const room = j.sql('SELECT status FROM rooms WHERE id = ?', [roomId])[0];
            if (room.status !== 'in_progress') j.fail(`Archiving changed the room status to ${room.status}`);
            j.say('an archived game still opens');
            await j.click(host, `[data-room-open="${roomId}"]`);
            await inGame(j, host);
            await j.goto(host, '/lobby.html');
            j.say('unarchive');
            await j.click(host, `[data-room-unarchive="${roomId}"]`);
            await j.see(host, `#active-rooms-list [data-room-id="${roomId}"]`);
            await j.gone(host, '#archived-rooms-section');
        },
    },

    // ===== Rooms =====
    {
        id: 'rooms.create-playing-host', group: 'Rooms', label: 'Create a room as a playing host',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            await j.click(host, '#show-create-room-btn');
            await j.see(host, '#createRoomModal');
            await j.shot(host, 'create-room-sheet');
            await j.layout(host, 'Create game sheet');
            j.say('missing fields are refused');
            await j.click(host, '#create-room-btn');
            if (!host.dialogs.some(d => /fill in all fields/i.test(d.message))) j.fail('Creating with empty fields gave no message');
            j.say('max players out of range');
            await j.fill(host, '#room-name', 'Journey Room');
            await j.fill(host, '#host-player-name', 'Hal');
            await j.fill(host, '#max-players', 9);
            await j.click(host, '#create-room-btn');
            if (!host.dialogs.some(d => /between 2 and 8/.test(d.message))) j.fail('Max players 9 was not refused');
            await j.fill(host, '#max-players', 3);
            await j.click(host, '#create-room-btn');
            await j.url(host, /waiting\.html\?room=/);
            await j.see(host, '#room-name', 'Journey Room');
            await j.see(host, '#invite-code', /^[A-Z0-9]{6}$/);
            await j.see(host, '#player-count', '1/3 players');
            const me = await j.see(host, '#players-list .player-item', 'Hal');
            const text = await me.innerText();
            if (!/Host/.test(text) || !/You/.test(text)) j.fail(`The host's row lacks Host/You badges: ${text}`);
            await j.see(host, '#start-game-btn[disabled]', 'Need at least 2 players');
            await j.see(host, '[data-manage-room-link]', 'Manage players');
            await j.see(host, '#leave-room-btn');
            await j.shot(host, 'waiting-room-host');
            await j.layout(host, 'Waiting room (host)');
        },
    },
    {
        id: 'rooms.create-spectating-host', group: 'Rooms', label: 'Create a room as a host who only watches',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            await j.click(host, '#show-create-room-btn');
            await host.page.locator('#host-spectate').check();
            await j.gone(host, '#host-player-name', null, { what: 'the player name field' });
            await j.fill(host, '#room-name', 'Journey Watching');
            await j.click(host, '#create-room-btn');
            await j.url(host, /waiting\.html\?room=/);
            const roomId = new URL(host.page.url()).searchParams.get('room');
            await j.see(host, '#spectator-help-text', /watching/);
            await j.see(host, '#players-list', 'No players yet');
            await j.gone(host, '#leave-room-btn');
            await j.see(host, '#agent-invites');
            await j.shot(host, 'waiting-room-watching');
            await j.goto(host, '/lobby.html');
            const card = await j.see(host, `#active-rooms-list [data-room-id="${roomId}"]`, 'Waiting');
            if (!/0 of 4 players/.test(await card.innerText())) j.note(`Watching host's card: ${(await card.innerText()).replace(/\s+/g, ' ')}`);
        },
    },
    {
        id: 'rooms.invite-tools-loan-rates', group: 'Rooms', label: 'Waiting room: Copy Code, Send Invite (mail off), host loan rates carried into the game',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop', permissions: ['clipboard-read', 'clipboard-write'] });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host, { max: 2 });
            j.say('Copy Code');
            await j.click(host, '#copy-invite-code-btn');
            await j.see(host, '#copy-invite-code-btn', 'Copied');
            const copied = await host.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
            if (copied.trim() !== code) j.fail(`Copy Code put "${copied}" on the clipboard, not ${code}`);
            j.say('Send Invite');
            host.expectIssues = /send-code|status of 5\d\d/;
            const inviteTo = testEmail(j);
            await j.fill(host, '#invite-email', inviteTo);
            await j.click(host, '#send-invite-btn');
            const status = await j.see(host, '#invite-status', /^(?!Sending)\S/, { timeout: 15000, what: 'an answer to Send Invite' });
            const statusText = (await status.innerText()).trim();
            const invites = j.ctx.mailbox ? j.ctx.mailbox.to(inviteTo).filter(m => /room code/i.test(m.subject)) : [];
            if (invites.length && !invites[0].text.includes(code)) j.fail(`The invite email does not have the room code ${code}: "${invites[0].text.slice(0, 120)}"`);
            if (/sent/i.test(statusText) && j.ctx.mailbox && !invites.length) j.fail(`Send Invite said "${statusText}" but no email reached ${inviteTo}`);
            j.note(`Send Invite answered: "${statusText}"${j.ctx.mailbox ? `; ${invites.length ? 'the email arrived with the code' : 'no email sent'}` : ''}`);
            j.say('host loan rate');
            await j.fill(host, '#loan-rate', '5.5');
            const guest = await j.person('Gia', { device: 'phone' });
            await joinRoom(j, guest, code);
            await startGame(j, host, [host, guest]);
            const rate = j.game(roomId).state.settings?.loanRate;
            if (Number(rate) !== 5.5) j.fail(`Game started with loan rate ${JSON.stringify(rate)}, not 5.5`);
        },
    },
    {
        id: 'rooms.join-code-home', group: 'Rooms', label: 'A guest joins with the room code on the home page',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { code } = await createRoom(j, host);
            const guest = await j.person('Gia', { device: 'phone' });
            await j.goto(guest, '/');
            j.say('a too-short code is explained');
            await j.fill(guest, '#resume-code', 'AB');
            await j.click(guest, '#resume-code-btn');
            await j.see(guest, '#resume-error', /6 letters/);
            j.say('a code pasted with a leading space (as copied from a message)');
            await j.fill(guest, '#resume-code', '');
            await guest.page.locator('#resume-code').focus();
            await guest.page.keyboard.insertText(` ${code}`);
            const pasted = await guest.page.locator('#resume-code').inputValue();
            if (pasted.trim() !== code) {
                await j.findingWithShot(guest, {
                    severity: 'low', category: 'ux',
                    title: 'A room code pasted with a leading space is cut to 5 characters',
                    detail: `Pasting " ${code}" into the home page code box (maxlength 6) leaves "${pasted}", so Join Game opens the wrong code. index.html #resume-code maxlength="6" truncates before normalizeInviteCode trims.`,
                });
            }
            j.say('code typed in lower case');
            await j.fill(guest, '#resume-code', code.toLowerCase());
            await j.click(guest, '#resume-code-btn');
            await j.url(guest, /waiting\.html\?code=/);
            await j.see(guest, '#guest-room-code');
            if ((await guest.page.locator('#guest-room-code').inputValue()) !== code) j.fail('The join form does not show the normalised room code');
            await j.shot(guest, 'join-form');
            await j.layout(guest, 'Join form');
            await j.click(guest, '#guest-join-btn');
            await j.see(guest, '#guest-join-error', /name/i);
            await j.fill(guest, '#guest-player-name', 'Gia');
            await j.click(guest, '#guest-join-btn');
            await j.url(guest, /waiting\.html\?room=/);
            const row = await j.see(guest, '#players-list .player-item', 'Gia');
            if (!/You/.test(await row.innerText())) j.fail('The guest does not see a You badge on their row');
            j.say('the host sees them arrive without reloading');
            await j.see(host, '#players-list', 'Gia', { timeout: 8000 });
            await j.see(host, '#player-count', '2/4 players');
            await j.see(host, '#start-game-btn:not([disabled])', 'Start Game (2 players)');
            if (!(await j.me(guest)).is_anonymous) j.fail('Joining by code from a fresh browser did not make a guest');
            await j.shot(guest, 'waiting-room-guest');
            await j.layout(guest, 'Waiting room (guest)');
            j.say('a taken name gets a number (names are unique per room)');
            const twin = await j.person('Gia2', { device: 'desktop' });
            await j.goto(twin, `/waiting.html?code=${code}`);
            await j.fill(twin, '#guest-player-name', 'gia');
            await j.click(twin, '#guest-join-btn');
            await j.url(twin, /waiting\.html\?room=/);
            const mine = await j.see(twin, '#players-list .player-item', 'You');
            if (!/gia 2/.test(await mine.innerText())) j.fail(`The second "gia" is shown as: ${(await mine.innerText()).replace(/\s+/g, ' ')}`);
            await j.see(host, '#players-list', 'gia 2');
        },
    },
    {
        id: 'rooms.join-invite-link', group: 'Rooms', label: 'A guest joins from the invite link',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host);
            const guest = await j.person('Gia', { device: 'desktop' });
            await joinRoom(j, guest, code, { via: 'link' });
            if (new URL(guest.page.url()).searchParams.get('room') !== roomId) j.fail('The guest ended up in another room');
            await j.see(host, '#players-list', 'Gia', { timeout: 8000 });
            j.say('a bad code is explained without signing anyone in');
            const lost = await j.person('Lost', { device: 'phone' });
            await j.goto(lost, '/waiting.html?code=ZZZZ99');
            await j.fill(lost, '#guest-player-name', 'Lost');
            await j.click(lost, '#guest-join-btn');
            await j.see(lost, '#guest-join-error', /not found|Could not join/i);
            if (await j.token(lost)) j.fail('A failed join left a guest token behind');
            await j.shot(lost, 'bad-code');
        },
    },
    {
        id: 'rooms.email-invite', group: 'Rooms', label: 'An email host sends an invite; the friend joins with the code from the email',
        async run(j) {
            if (!j.ctx.mailbox) j.skip('This run sends real mail; the invite email is checked in the inbox instead');
            const host = await j.person('Hal', { device: 'desktop' });
            await emailSignIn(j, host, testEmail(j));
            const { code } = await createRoom(j, host, { max: 2, playerName: 'Hal' });
            const friendEmail = testEmail(j);
            await j.fill(host, '#invite-email', friendEmail);
            await j.click(host, '#send-invite-btn');
            const status = (await (await j.see(host, '#invite-status', /^(?!Sending)\S/, { timeout: 15000, what: 'an answer to Send Invite' })).innerText()).trim();
            const deadline = Date.now() + 10000;
            let mail = null;
            while (!mail && Date.now() < deadline) {
                mail = j.ctx.mailbox.to(friendEmail).find(m => /room code/i.test(m.subject));
                if (!mail) await sleep(200);
            }
            if (!mail) j.fail(`Send Invite answered "${status}" but no email reached the friend`);
            j.note(`Invite email "${mail.subject}": ${mail.text.replace(/\s+/g, ' ').slice(0, 100)}`);
            const emailed = (/\b([A-Z0-9]{6})\b/.exec(mail.text) || [])[1];
            if (emailed !== code) j.fail(`The invite email's code is ${emailed}, not the room's ${code}`);
            const friend = await j.person('Fay', { device: 'phone' });
            await joinRoom(j, friend, emailed, { via: 'home' });
            await j.see(host, '#players-list', 'Fay');
        },
    },
    {
        id: 'rooms.email-player-joins', group: 'Rooms', label: 'A player signed in by email joins by code and stays an account',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host);
            const p = await j.person('Ema', { device: 'phone' });
            const email = testEmail(j);
            await emailSignIn(j, p, email);
            const id = p.userId;
            await joinRoom(j, p, code, { via: 'home' });
            const me = await j.me(p);
            if (me.is_anonymous || me.email !== email || me.id !== id) {
                j.fail(`After joining by code the player is no longer their email account (/auth/me: ${JSON.stringify(me)})`);
            }
            j.say('My games lists the room for the email account');
            await j.goto(p, '/lobby.html');
            await j.see(p, `#active-rooms-list [data-room-id="${roomId}"]`);
            j.say('signing in by email on another browser finds the game');
            const other = await j.person('Ema-laptop', { device: 'desktop' });
            await emailSignIn(j, other, email);
            await j.see(other, `#active-rooms-list [data-room-id="${roomId}"]`);
            await j.click(other, `[data-room-open="${roomId}"]`);
            await j.url(other, new RegExp(`waiting\\.html\\?room=${roomId}`));
            const row = await j.see(other, '#players-list .player-item', 'Ema');
            if (!/You/.test(await row.innerText())) j.fail('The email player is not recognised as themselves on the new browser');
            j.say('the host sees an Account badge for them');
            await openManage(j, host, roomId);
            await j.see(host, host.page.locator('.manage-player-row', { hasText: 'Ema' }).locator('.badge'), 'Account');
        },
    },
    {
        id: 'rooms.leave-waiting', group: 'Rooms', label: 'A player leaves the waiting room; leaving is refused once the game starts',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host, { max: 3 });
            const leaver = await j.person('Lea', { device: 'phone' });
            await joinRoom(j, leaver, code);
            await j.see(host, '#players-list', 'Lea');
            j.say('Leave, but cancel the confirm first');
            leaver.dismissNextConfirm = true;
            await j.click(leaver, '#leave-room-btn');
            await sleep(500);
            if (!/waiting\.html\?room=/.test(leaver.page.url())) j.fail('Cancelling the Leave confirm still left the room');
            await j.click(leaver, '#leave-room-btn');
            await j.url(leaver, /index\.html|\/$/);
            await j.gone(host, '#players-list', 'Lea', { what: "the host's player list", timeout: 8000 });
            await j.see(host, '#player-count', '1/3 players');
            await j.goto(leaver, '/lobby.html');
            await j.gone(leaver, `#active-rooms-list [data-room-id="${roomId}"]`, null, { what: 'the left room in My games' });
            j.say('rejoin and start; leaving is then refused');
            await joinRoom(j, leaver, code, { name: 'Lea' });
            await startGame(j, host, [host, leaver]);
            if (await j.visible(leaver, '#leave-room-btn')) j.fail('The game screen offers Leave after the start');
            await j.goto(leaver, `/waiting.html?room=${roomId}`);
            await inGame(j, leaver);
            const r = await j.apiAs(leaver, 'DELETE', `/rooms/${roomId}/leave`);
            if (r.ok) j.fail('The server let a player leave a started game');
            if (!/only leave before the game starts/i.test(r.error)) j.fail(`Unexpected refusal: ${r.status} ${r.error}`);
            const still = j.sql('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, leaver.userId]);
            if (!still.length) j.fail('The player was removed from a started game');
            j.note('Players cannot rename themselves in the waiting room (no such control); only agent seats can be renamed (agents.invite-rename-revoke).');
        },
    },
    {
        id: 'rooms.host-reenters-code', group: 'Rooms', label: 'The host entering their own room code goes straight back in',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host, { max: 2 });
            await j.goto(host, '/');
            await j.fill(host, '#resume-code', code);
            await j.click(host, '#resume-code-btn');
            await j.url(host, new RegExp(`waiting\\.html\\?room=${roomId}`));
            await j.see(host, '#host-controls');
            if (await j.visible(host, '#guest-player-name')) j.fail('The host was shown the guest join form for their own room');
            await j.shot(host, 'host-back-in');
            j.say('a player re-entering the code of a started game goes to the game');
            const guest = await j.person('Gia', { device: 'desktop' });
            await joinRoom(j, guest, code);
            await startGame(j, host, [host, guest]);
            for (const p of [host, guest]) {
                await j.goto(p, `/waiting.html?code=${code}`);
                await inGame(j, p);
            }
        },
    },
    {
        id: 'rooms.full-room', group: 'Rooms', label: 'A full room offers "continue as an existing player", not a join form',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { code } = await createRoom(j, host, { max: 2 });
            const guest = await j.person('Gia', { device: 'phone' });
            await joinRoom(j, guest, code);
            await j.see(host, '#player-count', '2/2 players');
            try {
                await j.see(host, '#room-status', 'Room Full', { timeout: 5000 });
            } catch {
                await j.findingWithShot(host, {
                    severity: 'low', category: 'sync',
                    title: 'The host\'s waiting room shows "Waiting for players" after the last seat fills',
                    detail: 'Player count says 2/2, but the status chip only changes to Room Full after a reload: the room:member_change handler in src/js/waiting.js (subscribeToRoomUpdatesById) updates the list, count and Start button but never calls updateRoomStatus.',
                });
                await host.page.reload();
                await j.see(host, '#room-status', 'Room Full', { what: 'Room Full after reload' });
            }
            const late = await j.person('Late', { device: 'phone' });
            await j.goto(late, `/waiting.html?code=${code}`);
            await j.see(late, '#hotseat-resume-options', 'Continue as an existing player');
            await j.see(late, '#hotseat-resume-options', /already full/);
            if (await j.visible(late, '#guest-player-name')) j.fail('A full room still shows the join form');
            await j.shot(late, 'full-room');
            await j.layout(late, 'Full room options');
            const r = await late.page.evaluate(async code => {
                const guest = await createGuestUser();
                setToken(guest.token);
                try { await joinRoomByCode(code, 'Late'); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; } finally { clearToken(); }
            }, code);
            if (r.ok) j.fail('The server let a 3rd player into a 2-player room');
            if (!/full/i.test(r.error)) j.fail(`Joining a full room gave: ${r.error}`);
        },
    },
    {
        id: 'rooms.rejoin-approved', group: 'Rooms', label: 'Game started: "continue as existing player", approved by another player',
        async run(j) {
            const { host, guest, code } = await twoPlayerGame(j);
            const fresh = await j.person('Gia-new', { device: 'phone' });
            await j.goto(fresh, '/');
            await j.fill(fresh, '#resume-code', code);
            await j.click(fresh, '#resume-code-btn');
            await j.url(fresh, /waiting\.html\?code=/);
            await j.see(fresh, '#hotseat-resume-options', 'Continue as an existing player');
            await j.shot(fresh, 'existing-player-options');
            await fresh.page.locator('#hotseat-resume-options button', { hasText: 'Gia' }).click();
            await j.see(fresh, '#hotseat-resume-options', 'Waiting for approval');
            await j.see(fresh, '#hotseat-resume-options', /Ask Hal/);
            if (await j.token(fresh)) j.fail('The asking browser got a token before approval');
            const prompt = await j.see(host, '#rejoinPromptModal', 'wants to continue as Gia', { timeout: 15000 });
            await j.shot(host, 'rejoin-prompt');
            await j.layout(host, 'Rejoin prompt', [390]);
            await prompt.locator('[data-decision="approve"]').click();
            await j.gone(host, '#rejoinPromptModal');
            await inGame(j, fresh);
            if ((await j.userId(fresh)) !== guest.userId) j.fail('Approval signed the new browser in as someone else');
            await j.see(fresh, '.player-card.current-user', 'Gia');
            await playTurns(j, [host, fresh], 2);
        },
    },
    {
        id: 'rooms.rejoin-declined', group: 'Rooms', label: 'A declined rejoin request hands out nothing',
        async run(j) {
            const { host, code } = await twoPlayerGame(j);
            const fresh = await j.person('Gia-new', { device: 'desktop' });
            await j.goto(fresh, `/waiting.html?code=${code}`);
            await fresh.page.locator('#hotseat-resume-options button', { hasText: 'Gia' }).click();
            await j.see(fresh, '#hotseat-resume-options', 'Waiting for approval');
            const prompt = await j.see(host, '#rejoinPromptModal', 'Gia', { timeout: 15000 });
            await prompt.locator('[data-decision="deny"]').click();
            await j.see(fresh, '#hotseat-resume-options', 'Request declined', { timeout: 12000 });
            await j.shot(fresh, 'declined');
            if (await j.token(fresh)) j.fail('A declined request still signed the browser in');
            await fresh.page.getByRole('button', { name: 'Back' }).click();
            await j.see(fresh, '#hotseat-resume-options button', 'Gia');
            j.say('cancelling a request while waiting');
            await fresh.page.locator('#hotseat-resume-options button', { hasText: 'Gia' }).click();
            await j.see(fresh, '#hotseat-resume-options', 'Waiting for approval');
            await fresh.page.getByRole('button', { name: 'Cancel' }).click();
            await j.see(fresh, '#hotseat-resume-options button', 'Gia');
            await sleep(1500);
            await host.page.evaluate(() => window.dispatchEvent(new Event('online')));
        },
    },
    {
        id: 'rooms.hotseat', group: 'Rooms', label: 'Hotseat game on one phone: create, play turns, resume from home',
        async run(j) {
            const p = await j.person('Phone', { device: 'phone' });
            await j.goto(p, '/');
            await j.click(p, 'a[href="hotseat.html"]');
            await j.url(p, /hotseat\.html/);
            await j.layout(p, 'Hotseat setup');
            j.say('one name is not enough');
            await p.page.locator('.player-name-input').nth(0).fill('Ann');
            await j.click(p, '#start-hotseat-btn');
            await j.see(p, '#hotseat-error', /at least 2/);
            await p.page.locator('.player-name-input').nth(1).fill('ann');
            await j.click(p, '#start-hotseat-btn');
            await j.see(p, '#hotseat-error', /unique/);
            await p.page.locator('.player-name-input').nth(1).fill('Bob');
            await j.click(p, '#add-player-btn');
            await p.page.locator('.player-name-input').nth(2).fill('Cat');
            await j.shot(p, 'hotseat-setup');
            await j.click(p, '#start-hotseat-btn');
            await inGame(j, p);
            if (await j.visible(p, '#move-device-btn')) j.note('Hotseat game shows "Play on another device"');
            if (await j.visible(p, '#turn-alerts-btn')) j.note('Hotseat game shows Turn alerts');
            const roomId = new URL(p.page.url()).searchParams.get('room');
            j.say('play 4 turns, passing the phone');
            for (let t = 0; t < 4; t++) {
                await takeTurn(j, p);
                if (t === 0) {
                    await j.see(p, '#hotseat-interstitial', 'Pass the phone');
                    await j.shot(p, 'pass-the-phone');
                }
            }
            if (await j.visible(p, '#hotseat-interstitial')) await j.click(p, '#dismiss-hotseat-btn');
            const before = j.game(roomId);
            const code = (await p.page.locator('#room-code').innerText()).replace(/[^A-Z0-9]/g, '');
            j.say('leave, then resume from home with the room code');
            await j.goto(p, '/');
            await j.fill(p, '#resume-code', code);
            await j.click(p, '#resume-code-btn');
            await j.see(p, '#hotseat-resume-options', 'Continue this saved hotseat game');
            await j.shot(p, 'resume-hotseat');
            await p.page.getByRole('button', { name: 'Continue Hotseat' }).click();
            await inGame(j, p);
            const g = await pageGame(p);
            if (!g || g.v !== before.version) j.fail(`Resumed hotseat game is at version ${g?.v}, the server at ${before.version}`);
            const current = before.state.players[before.state.currentPlayerIndex].name;
            await j.see(p, '#gameContent', current);
            const view = await p.page.evaluate(() => currentUser && currentGame.game_state.players.find(x => x.userId === currentUser.id)?.name);
            if (view !== current && !(await j.visible(p, '#hotseat-interstitial'))) {
                await j.shot(p, 'resumed-wrong-player');
                j.fail(`Resumed hotseat game shows ${view}'s screen while it is ${current}'s turn, with no Roll button and no pass-the-phone screen, so nobody can play`);
            }
            await takeTurn(j, p);
            const after = j.game(roomId);
            if (after.version <= before.version) j.fail('Could not play after resuming the hotseat game');
        },
    },

    // ===== Agents =====
    {
        id: 'agents.invite-rename-revoke', group: 'Agents', label: 'Invite an agent by name; it joins over MCP; rename; revoke (joined and not joined)',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            const { roomId } = await createRoom(j, host, { max: 4 });
            const invite = await inviteAgent(j, host, 'Claude A');
            await j.see(host, '#agent-invite-modal', 'Your part');
            if (!invite.prompt.includes('playing as Claude A') || !invite.prompt.includes('join_game')) j.fail(`Invite prompt: ${invite.prompt.slice(0, 200)}`);
            if (!/\/api\/mcp$/.test(invite.mcpUrl)) j.fail(`Connector address: ${invite.mcpUrl}`);
            await j.shot(host, 'agent-invite-sheet');
            await j.layout(host, 'Agent invite sheet');
            await closeInvite(j, host);
            if ((await host.page.locator('body').innerText()).includes(invite.key)) j.fail('The agent key stayed on the page after Done');
            const row = await j.see(host, '.agent-invite-row', 'Waiting for the agent to join');
            j.say('agent joins with its own name; the host name wins');
            const joined = await j.mcpOk('join_game', { agent_key: invite.key, player_name: 'Robo' });
            if (!joined.joined) j.fail(`join_game: ${JSON.stringify(joined).slice(0, 200)}`);
            await j.see(host, row, 'Joined', { timeout: 8000 });
            await j.see(host, '#players-list', 'Claude A');
            if ((await host.page.locator('#players-list').innerText()).includes('Robo')) j.fail('The agent\'s own name replaced the host\'s');
            await j.see(host, '#players-list .player-badge-agent', 'AI');
            await j.shot(host, 'agent-joined');
            j.say('join_game again is harmless');
            const again = await j.mcpOk('join_game', { agent_key: invite.key });
            if (again.joined) j.fail('A second join_game said it joined again');
            j.say('rename');
            host.nextPromptValue = 'Claude B';
            await j.click(host, '[data-agent-seat-rename]');
            await j.see(host, '#players-list', 'Claude B');
            await j.see(host, '.agent-invite-row strong', 'Claude B');
            const named = await j.mcpOk('get_game_state', { agent_key: invite.key });
            if (!JSON.stringify(named.room || {}).includes('Claude B')) j.fail(`The agent does not see its new name: ${JSON.stringify(named.room).slice(0, 200)}`);
            j.say('revoke the joined agent');
            await j.click(host, '[data-agent-seat-revoke]');
            await j.gone(host, '#players-list', 'Claude B');
            const revoked = await j.mcp('get_game_state', { agent_key: invite.key });
            if (!revoked.isError || !/Invalid or revoked/.test(revoked.text)) j.fail(`A revoked key still works: ${JSON.stringify(revoked).slice(0, 200)}`);
            j.say('invite another and revoke it before it joins');
            const pending = await inviteAgent(j, host, '');
            await closeInvite(j, host);
            await j.see(host, '.agent-invite-row', 'Waiting for the agent to join');
            await j.click(host, '[data-agent-seat-revoke]');
            await j.gone(host, '.agent-invite-row');
            const late = await j.mcp('join_game', { agent_key: pending.key });
            if (!late.isError) j.fail('A key revoked before joining still joined');
            const members = j.sql('SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?', [roomId])[0].n;
            if (members !== 1) j.fail(`Room has ${members} members after revoking both agents`);
        },
    },
    {
        id: 'agents.join-while-backgrounded', group: 'Agents', label: 'Agent joins while the host page is backgrounded and offline; page shows Joined on return',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            await createRoom(j, host, { max: 3 });
            const invite = await inviteAgent(j, host, 'Giskard');
            await closeInvite(j, host);
            const row = await j.see(host, '.agent-invite-row', 'Waiting for the agent to join');
            j.say('host switches apps: page hidden, network gone');
            await host.page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            host.offline = true;
            await host.context.setOffline(true);
            // setOffline does not drop an open WebSocket; a phone in the background does.
            await host.page.evaluate(() => { const s = getSocket(); if (s.connected) s.io.engine.close(); });
            await sleep(1500);
            if (await host.page.evaluate(() => getSocket().connected)) j.fail('Harness could not cut the socket');
            await j.mcpOk('join_game', { agent_key: invite.key });
            await sleep(1500);
            if (!/Waiting for the agent/.test(await row.innerText())) j.note('The page saw the join while offline; the catch-up path was not exercised');
            j.say('host comes back');
            await host.context.setOffline(false);
            await host.page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
                document.dispatchEvent(new Event('visibilitychange'));
                window.dispatchEvent(new Event('online'));
            });
            const started = Date.now();
            await j.see(host, row, 'Joined', { timeout: 20000, what: 'the agent invite row' });
            await j.see(host, '#players-list', 'Giskard');
            host.offline = false;
            j.note(`Joined shown ${((Date.now() - started) / 1000).toFixed(1)}s after the page came back`);
            await j.see(host, '#start-game-btn:not([disabled])', /Start Game/);
            await j.shot(host, 'joined-after-return');
        },
    },
    {
        id: 'agents.play-turns', group: 'Agents', label: 'Host and an agent play turns: wait_for_turn wakes, take_action shows live',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { roomId } = await createRoom(j, host, { max: 2 });
            const invite = await inviteAgent(j, host, 'Claude P');
            await closeInvite(j, host);
            await j.mcpOk('join_game', { agent_key: invite.key });
            await j.see(host, '#players-list', 'Claude P');
            j.say('agent waits for the start');
            const waitStart = j.mcp('wait_for_turn', { agent_key: invite.key, timeout_seconds: 30 });
            await startGame(j, host, [host]);
            const woke = await waitStart;
            if (woke.isError) j.fail(`wait_for_turn during the start: ${woke.text}`);
            j.log(`agent woke: ${woke.body.woke_because}`);
            const rules = await j.mcpOk('get_rules', {});
            if (!JSON.stringify(rules).includes('roll_dice')) j.fail('get_rules does not list roll_dice');
            for (let round = 0; round < 3; round++) {
                const g = j.game(roomId);
                const current = g.state.players[g.state.currentPlayerIndex];
                if (current.userId === host.userId) {
                    j.say(`round ${round + 1}: host plays; the agent's wait_for_turn must wake`);
                    const wait = j.mcp('wait_for_turn', { agent_key: invite.key, timeout_seconds: 40 });
                    await takeTurn(j, host);
                    const t0 = Date.now();
                    const w = await wait;
                    if (w.isError) j.fail(`wait_for_turn: ${w.text}`);
                    if (!/your_turn|auction/.test(w.body.woke_because)) j.fail(`wait_for_turn woke with ${w.body.woke_because} instead of your_turn`);
                    if (Date.now() - t0 > 5000) j.finding({ severity: 'low', category: 'perf', title: 'wait_for_turn woke more than 5s after the host ended the turn' });
                }
                j.say(`round ${round + 1}: agent plays over MCP`);
                const done = await agentTurn(j, invite.key);
                j.log(`agent: ${done.join(', ')}`);
                if (!done.includes('roll_dice')) j.fail(`The agent's turn did not roll: ${done.join(', ')}`);
                await caughtUp(j, host, roomId);
                await j.see(host, '.recent-log', /Claude P/);
            }
            await j.shot(host, 'after-agent-turns');
            const log = await host.page.locator('.recent-log').innerText();
            if (!/Claude P rolled/.test(log)) j.note(`Host's recent log after agent turns: ${log.replace(/\s+/g, ' ').slice(0, 200)}`);
        },
    },
    {
        id: 'agents.agent-only-spectator', group: 'Agents', label: 'Agent-only game run by a watching host (pause, resume, end)',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            const { roomId } = await createRoom(j, host, { spectate: true });
            const keys = [];
            for (const name of ['Claude A', 'Claude B']) {
                const invite = await inviteAgent(j, host, name);
                await closeInvite(j, host);
                await j.mcpOk('join_game', { agent_key: invite.key });
                keys.push(invite.key);
            }
            await j.see(host, '#players-list', 'Claude B');
            await j.see(host, '#start-game-btn', 'Start Game (2 players)');
            await j.click(host, '#start-game-btn');
            await inGame(j, host);
            await j.see(host, '.moves', 'Watching');
            if (await j.visible(host, '[data-game-action="roll-dice"]')) j.fail('The watching host has a Roll Dice button');
            await j.see(host, '.host-panel', 'Host controls');
            await j.shot(host, 'watching-host');
            await j.layout(host, 'Game screen (watching host)');
            j.say('agents play 4 turns');
            for (let t = 0; t < 4; t++) {
                const g = j.game(roomId);
                const cur = g.state.players[g.state.currentPlayerIndex];
                const key = keys[['Claude A', 'Claude B'].indexOf(cur.name)];
                await agentTurn(j, key);
            }
            await caughtUp(j, host, roomId);
            await j.see(host, '.recent-log', /Claude [AB]/);
            j.say('host pauses');
            await j.click(host, '[data-game-action="host-pause"]');
            await j.see(host, '[data-game-action="host-resume"]');
            const paused = await j.mcpOk('get_game_state', { agent_key: keys[0] });
            if (paused.status !== 'paused' && !paused.paused) j.fail(`Agent's view while paused: ${paused.status}`);
            const refused = await j.mcp('take_action', { agent_key: keys[0], type: 'roll_dice' });
            const refused2 = await j.mcp('take_action', { agent_key: keys[1], type: 'roll_dice' });
            if (!refused.isError || !refused2.isError) j.fail('An agent could roll while the game was paused');
            await j.shot(host, 'paused');
            j.say('host resumes');
            await j.click(host, '[data-game-action="host-resume"]');
            await j.see(host, '[data-game-action="host-pause"]');
            const g = j.game(roomId);
            const cur = g.state.players[g.state.currentPlayerIndex];
            await agentTurn(j, keys[['Claude A', 'Claude B'].indexOf(cur.name)]);
            j.say('host ends the game');
            const wait = j.mcp('wait_for_turn', { agent_key: keys[0], timeout_seconds: 30 });
            await j.click(host, '[data-game-action="host-end"]');
            await j.see(host, '#winnerModal');
            await j.shot(host, 'game-over');
            const w = await wait;
            const end = await j.mcpOk('get_game_state', { agent_key: keys[1] });
            if (end.status !== 'game_ended') j.fail(`Agent status after the host ended the game: ${end.status} (wait woke: ${w.body?.woke_because || w.text})`);
        },
    },
    {
        id: 'agents.new-key-midgame', group: 'Agents', label: '"New key" mid-game: old key fails, new key resumes the same seat',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { roomId } = await createRoom(j, host, { max: 2 });
            const invite = await inviteAgent(j, host, 'Claude K');
            await closeInvite(j, host);
            await j.mcpOk('join_game', { agent_key: invite.key });
            await startGame(j, host, [host]);
            const seatId = (await j.mcpOk('get_game_state', { agent_key: invite.key })).you.player_id;
            await takeTurn(j, host);
            await agentTurn(j, invite.key);
            j.say('host panel → Manage players → New key');
            await gameTab(host);
            await host.page.locator('.host-panel a', { hasText: 'Manage players' }).click();
            await j.url(host, /lobby\.html\?manage=/);
            const row = await j.see(host, '.manage-player-row', 'Claude K');
            await j.see(host, row.locator('.badge'), 'AI');
            await row.getByRole('button', { name: 'New key' }).click();
            await j.see(host, '#manageAgentKeyModal');
            await host.page.waitForFunction(() => /mbagent_/.test(document.getElementById('manage-agent-key-prompt')?.value || ''), null, { timeout: 10000 });
            const prompt = await host.page.locator('#manage-agent-key-prompt').inputValue();
            await j.shot(host, 'new-key-sheet');
            await j.layout(host, 'New key sheet');
            const newKey = (prompt.match(/mbagent_[A-Za-z0-9_-]+/) || [])[0];
            if (!newKey || newKey === invite.key) j.fail('New key sheet has no new key');
            if (!/already have a seat/.test(prompt)) j.fail(`The new-key prompt does not say the agent already has a seat: ${prompt.slice(0, 200)}`);
            await j.click(host, '#manage-agent-key-close-btn');
            await j.gone(host, '#manageAgentKeyModal');
            if ((await host.page.locator('#manage-agent-key-prompt').inputValue())) j.fail('The new key stayed in the page after Done');
            const old = await j.mcp('get_game_state', { agent_key: invite.key });
            if (!old.isError) j.fail('The old key still works after New key');
            const rejoined = await j.mcpOk('join_game', { agent_key: newKey });
            if (rejoined.joined) j.fail('join_game with the new key took a new seat');
            const state = await j.mcpOk('get_game_state', { agent_key: newKey });
            if (state.you.player_id !== seatId) j.fail(`The new key is a different seat (${state.you.player_id} vs ${seatId})`);
            j.say('play on with the new key');
            await gameTab(host);
            await j.goto(host, `/game.html?room=${roomId}`);
            await inGame(j, host);
            await takeTurn(j, host);
            const done = await agentTurn(j, newKey);
            if (!done.includes('roll_dice')) j.fail(`The agent could not play with its new key: ${done.join(', ')}`);
            await caughtUp(j, host, roomId);
        },
    },

    // ===== Hosting =====
    {
        id: 'hosting.manage-sheet', group: 'Hosting', label: 'Manage players sheet lists guests, accounts, agents and invites with the right tools',
        async run(j) {
            const host = await j.person('Hal', { device: 'phone' });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host, { max: 6 });
            const guest = await j.person('Gia', { device: 'desktop' });
            await joinRoom(j, guest, code);
            const acct = await j.person('Ana', { device: 'desktop' });
            await register(j, acct);
            await joinRoom(j, acct, code);
            await j.goto(host, `/waiting.html?room=${roomId}`);
            const joinedAgent = await inviteAgent(j, host, 'Claude J');
            await closeInvite(j, host);
            await j.mcpOk('join_game', { agent_key: joinedAgent.key });
            await inviteAgent(j, host, 'Claude W');
            await closeInvite(j, host);
            j.say('open Manage players from the waiting room');
            await j.click(host, '[data-manage-room-link]');
            await j.url(host, new RegExp(`lobby\\.html\\?manage=${roomId}`));
            await j.see(host, '#manageRoomModal');
            await j.see(host, '#manage-room-name', code);
            const expect = [
                ['Hal', ['Host'], []],
                ['Gia', ['Guest'], ['Copy link', 'Make host']],
                ['Ana', ['Account'], ['Copy link', 'Make host']],
                ['Claude J', ['AI'], ['New key']],
                ['Claude W', ['AI', 'Not joined'], ['New key']],
            ];
            for (const [name, badges, buttons] of expect) {
                const row = await j.see(host, host.page.locator('.manage-player-row', { has: host.page.locator('strong', { hasText: name }) }), null, { what: `${name}'s row` });
                const text = await row.innerText();
                for (const b of badges) if (!text.includes(b)) j.fail(`${name}'s row lacks the ${b} badge: ${text.replace(/\s+/g, ' ')}`);
                for (const b of buttons) if (!(await row.getByRole('button', { name: b }).count())) j.fail(`${name}'s row lacks ${b}`);
                if (name === 'Hal' && (await row.locator('button').count())) j.fail('The host\'s own row has buttons');
            }
            await j.shot(host, 'manage-sheet');
            await j.layout(host, 'Manage players sheet');
            await j.click(host, '#manage-room-close-btn');
            await j.gone(host, '#manageRoomModal');
            if (/manage=/.test(host.page.url())) j.fail('Closing the sheet left ?manage= in the address');
            j.say('a non-host opening ?manage= is refused');
            await j.goto(guest, `/lobby.html?manage=${roomId}`);
            await j.see(guest, '#manage-player-list', 'Only the host');
            j.say('Manage from the My games card');
            await j.click(host, `[data-room-manage="${roomId}"]`);
            await j.see(host, '#manageRoomModal');
            await j.see(host, '#manage-player-list', 'Gia');
        },
    },
    {
        id: 'hosting.seat-link-guest', group: 'Hosting', label: 'Copy a guest\'s seat link; a fresh browser lands in their seat; the link is single use',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            j.say('host panel → Manage players → Copy link');
            await gameTab(host);
            await host.page.locator('.host-panel a', { hasText: 'Manage players' }).click();
            await j.see(host, '#manageRoomModal');
            const link = await copySeatLink(j, host, 'Gia');
            await j.shot(host, 'link-copied');
            const phone = await j.person('Gia-newphone', { device: 'phone' });
            await j.goto(phone, link);
            await inGame(j, phone);
            if ((await j.userId(phone)) !== guest.userId) j.fail('The seat link signed in as someone else');
            if (/seat=/.test(phone.page.url())) j.fail('The seat token stayed in the address bar');
            await j.see(phone, '.player-card.current-user', 'Gia');
            j.say('the link works once');
            const late = await j.person('Stranger', { device: 'desktop' });
            await j.goto(late, link);
            await j.see(late, '#resume-error', 'expired or was replaced');
            if (/seat=/.test(late.page.url())) j.fail('A used seat token stayed in the address bar');
            if (await j.token(late)) j.fail('A used seat link still signed a browser in');
            await j.shot(late, 'used-link');
            j.say('the seat plays on from the new phone');
            await j.goto(host, `/game.html?room=${roomId}`);
            await inGame(j, host);
            await playTurns(j, [host, phone], 2);
            await caughtUp(j, guest, roomId);
        },
    },
    {
        id: 'hosting.seat-link-account', group: 'Hosting', label: 'An account\'s seat link asks them to sign in, then opens the game',
        async run(j) {
            const { host, guest } = await twoPlayerGame(j, { guestAccount: true });
            const roomId = new URL(host.page.url()).searchParams.get('room');
            await openManage(j, host, roomId);
            await j.see(host, host.page.locator('.manage-player-row', { hasText: 'Gia' }).locator('.badge'), 'Account');
            const link = await copySeatLink(j, host, 'Gia');
            for (const n of [1, 2]) {
                const fresh = await j.person(`Gia-browser${n}`, { device: n === 1 ? 'phone' : 'desktop' });
                await j.goto(fresh, link);
                await j.url(fresh, /auth\.html/);
                await j.see(fresh, '#auth-reason', 'This seat belongs to an account. Sign in to continue.');
                if (n === 1) {
                    await j.shot(fresh, 'sign-in-for-seat');
                    await j.layout(fresh, 'Sign in for a seat');
                }
                await j.fill(fresh, '#login-input', guest.username);
                await j.fill(fresh, '#password-input', PASSWORD);
                await j.click(fresh, '#signin-btn');
                await inGame(j, fresh);
                if ((await j.userId(fresh)) !== guest.userId) j.fail('Signed into the wrong seat');
            }
            j.note('The account seat link stayed usable for a second browser, as designed.');
        },
    },
    {
        id: 'hosting.make-host', group: 'Hosting', label: 'Make host → guest must create an account → accepts → host controls move',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            await openManage(j, host, roomId);
            const row = host.page.locator('.manage-player-row', { hasText: 'Gia' });
            await row.getByRole('button', { name: 'Make host' }).click();
            await j.see(host, '#manage-transfer', 'Host offer sent to Gia');
            await j.see(host, row, 'Offer sent');
            if (!host.dialogs.some(d => d.type === 'confirm' && /need an account/.test(d.message))) j.fail('Make host did not explain that an account is needed');
            await j.shot(host, 'offer-sent');
            j.say('guest sees the offer in My games');
            await j.click(guest, '.app-bar-back');
            await j.url(guest, /lobby\.html/);
            const offer = await j.see(guest, '.host-offer', 'offered to make you host');
            await j.shot(guest, 'host-offer');
            await j.layout(guest, 'My games (host offer)');
            await offer.getByRole('button', { name: 'Accept' }).click();
            await j.url(guest, /auth\.html\?mode=register/);
            await j.see(guest, '#auth-reason', 'create an account first');
            const username = j.unique('gia');
            await j.fill(guest, '#register-username', username);
            await j.fill(guest, '#register-password', PASSWORD);
            await j.fill(guest, '#register-confirm', PASSWORD);
            await j.click(guest, '#register-btn');
            await j.url(guest, /lobby\.html/);
            await (await j.see(guest, '.host-offer', 'offered to make you host')).getByRole('button', { name: 'Accept' }).click();
            await j.gone(guest, '#host-offers-section');
            await j.see(guest, `[data-room-manage="${roomId}"]`, 'Manage');
            const room = j.sql('SELECT host_id FROM rooms WHERE id = ?', [roomId])[0];
            if (room.host_id !== guest.userId) j.fail('rooms.host_id did not change');
            j.say('new host sees host controls in the game');
            await j.click(guest, `[data-room-open="${roomId}"]`);
            await inGame(j, guest);
            await j.see(guest, '.host-panel', 'Host controls');
            await j.shot(guest, 'new-host-controls');
            j.say('old host loses them (live, else after reload)');
            await j.goto(host, `/game.html?room=${roomId}`);
            await inGame(j, host);
            await j.gone(host, '.host-panel', null, { what: "the old host's Host controls" });
            await j.goto(host, '/lobby.html');
            const card = await j.see(host, `#active-rooms-list [data-room-id="${roomId}"]`);
            if (/\bHost\b/.test(await card.innerText())) j.fail('The old host\'s card still says Host');
            if (await j.visible(host, `[data-room-manage="${roomId}"]`)) j.fail('The old host still has Manage');
            j.say('the new host can pause');
            await gameTab(guest);
            await j.click(guest, '[data-game-action="host-pause"]');
            await j.see(guest, '[data-game-action="host-resume"]');
            await j.click(guest, '[data-game-action="host-resume"]');
        },
    },
    {
        id: 'hosting.make-host-live-page', group: 'Hosting', label: 'Host controls move on open game screens without a reload',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j, { guestAccount: true });
            const manager = await j.tab(host);
            await openManage(j, manager, roomId);
            await manager.page.locator('.manage-player-row', { hasText: 'Gia' }).getByRole('button', { name: 'Make host' }).click();
            await j.see(manager, '#manage-transfer', 'Host offer sent');
            const gTab = await j.tab(guest);
            await j.goto(gTab, '/lobby.html');
            await (await j.see(gTab, '.host-offer', 'offered to make you host')).getByRole('button', { name: 'Accept' }).click();
            await j.gone(gTab, '#host-offers-section');
            j.say('both open game screens update by themselves');
            const t0 = Date.now();
            let guestOk = true;
            let hostOk = true;
            try { await j.see(guest, '.host-panel', 'Host controls', { timeout: 20000, what: "the new host's Host controls (no reload)" }); } catch { guestOk = false; }
            try { await j.gone(host, '.host-panel', null, { timeout: 5000, what: "the old host's Host controls (no reload)" }); } catch { hostOk = false; }
            if (!guestOk || !hostOk) {
                await j.findingWithShot(hostOk ? guest : host, {
                    severity: 'medium', category: 'sync',
                    title: 'After a host transfer, open game screens keep the old host controls until reloaded',
                    detail: `${!guestOk ? 'The new host\'s game screen showed no Host controls within 20s. ' : ''}${!hostOk ? 'The old host\'s game screen still shows Pause/End Game. ' : ''}Waited ${((Date.now() - t0) / 1000).toFixed(0)}s after Accept.`,
                });
                if (!hostOk) {
                    j.say('what happens when the old host presses Pause');
                    await gameTab(host);
                    const dialogs = host.dialogs.length;
                    await j.click(host, '[data-game-action="host-pause"]');
                    await sleep(2500);
                    const seen = host.dialogs.slice(dialogs).map(d => `${d.type}: ${d.message}`).join(' | ');
                    const snap = await host.page.evaluate(snapshotInPage, { maxTextChars: 200 }).catch(() => ({ toasts: [], statuses: [] }));
                    const toast = [...snap.toasts, ...snap.statuses].join(' | ');
                    await j.shot(host, 'old-host-pressed-pause');
                    j.note(`Old host pressed Pause: ${seen}${toast ? ` · on screen: ${toast.slice(0, 160)}` : ''}; game paused: ${!!j.game(roomId).state.paused}`);
                    if (j.game(roomId).state.paused) j.fail('The old host could still pause the game after the transfer');
                }
            }
        },
    },
    {
        id: 'hosting.offer-cancel-decline', group: 'Hosting', label: 'Cancel a host offer, then a declined offer; the player sees each live',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { code, roomId } = await createRoom(j, host);
            const ana = await j.person('Ana', { device: 'phone' });
            await register(j, ana);
            await joinRoom(j, ana, code);
            await j.goto(ana, '/lobby.html');
            await j.see(ana, `#active-rooms-list [data-room-id="${roomId}"]`);
            await openManage(j, host, roomId);
            const row = host.page.locator('.manage-player-row', { hasText: 'Ana' });
            j.say('offer, then cancel');
            await row.getByRole('button', { name: 'Make host' }).click();
            await j.see(host, '#manage-transfer', 'Host offer sent to Ana');
            await j.see(ana, '.host-offer', 'offered to make you host', { timeout: 10000, what: 'the offer, live on My games' });
            await host.page.locator('[data-manage-cancel-transfer]').click();
            await j.see(host, '#manage-room-status', 'Host offer cancelled');
            await j.gone(host, '#manage-transfer');
            await j.see(host, row.getByRole('button', { name: 'Make host' }));
            await j.gone(ana, '#host-offers-section', null, { timeout: 10000, what: 'the cancelled offer on My games' });
            j.say('offer again, Ana declines');
            await row.getByRole('button', { name: 'Make host' }).click();
            await j.see(host, '#manage-transfer', 'Host offer sent to Ana');
            const offer = await j.see(ana, '.host-offer', 'offered to make you host', { timeout: 10000 });
            await offer.getByRole('button', { name: 'Decline' }).click();
            await j.gone(ana, '#host-offers-section');
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline && await j.visible(host, '#manage-transfer')) await sleep(300);
            if (await j.visible(host, '#manage-transfer')) {
                await j.findingWithShot(host, { severity: 'low', category: 'sync', title: 'An open Manage sheet still shows a host offer the player declined', detail: 'Reopen the sheet to see it gone.' });
                await openManage(j, host, roomId);
            }
            await j.gone(host, '#manage-transfer');
            await j.see(host, row.getByRole('button', { name: 'Make host' }));
            const r = j.sql('SELECT host_id FROM rooms WHERE id = ?', [roomId])[0];
            if (r.host_id !== host.userId) j.fail('A declined offer changed the host');
        },
    },
    {
        id: 'hosting.pause-resume-end', group: 'Hosting', label: 'Playing host pauses, resumes and ends the game; every player sees it',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            await playTurns(j, [host, guest], 1);
            await gameTab(host);
            await j.see(host, '.host-panel', 'Host controls');
            if (await j.visible(guest, '.host-panel')) j.fail('A non-host sees Host controls');
            j.say('pause');
            await j.click(host, '[data-game-action="host-pause"]');
            await j.see(guest, '#pausePanel', 'Game Paused', { timeout: 8000 });
            if (await usable(button(guest, 'roll-dice')) || await usable(button(host, 'roll-dice'))) j.fail('Roll Dice is usable while paused');
            await j.shot(guest, 'paused-guest');
            await j.layout(guest, 'Game paused', [390]);
            j.say('resume');
            await j.click(host, '[data-game-action="host-resume"]');
            await j.gone(guest, '#pausePanel', null, { timeout: 8000 });
            await playTurns(j, [host, guest], 1);
            j.say('end');
            await j.click(host, '[data-game-action="host-end"]');
            for (const p of [host, guest]) await j.see(p, '#winnerModal', null, { timeout: 10000, what: 'the Game Over dialog' });
            await j.shot(guest, 'game-over');
            await j.goto(host, '/lobby.html');
            await j.see(host, `#active-rooms-list [data-room-id="${roomId}"]`, 'Completed');
            if (await j.visible(host, `[data-room-manage="${roomId}"]`)) j.fail('A completed game still offers Manage');
        },
    },

    // ===== Resilience =====
    {
        id: 'resilience.reload', group: 'Resilience', label: 'Reload mid-turn and carry on',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            const mover = (await pageGame(host)).mine ? host : guest;
            const other = mover === host ? guest : host;
            await gameTab(mover);
            await actWait(j, mover, button(mover, 'roll-dice'), 'roll dice');
            const server = j.game(roomId);
            const serverMe = server.state.players.find(x => x.userId === mover.userId);
            await mover.page.reload();
            await inGame(j, mover);
            const g = await pageGame(mover);
            if (g.v !== server.version || g.me.position !== serverMe.position || g.me.diceRolled !== serverMe.diceRolled || Number(g.me.cash) !== Number(serverMe.cash)) {
                j.fail(`After reload the screen disagrees with the server: version ${g.v}/${server.version}, square ${g.me.position}/${serverMe.position}, rolled ${g.me.diceRolled}/${serverMe.diceRolled}`);
            }
            await takeTurn(j, mover, { others: [other] });
            await caughtUp(j, other, roomId);
            await j.shot(mover, 'after-reload-turn');
        },
    },
    {
        id: 'resilience.offline', group: 'Resilience', label: 'Lose the network while the other player moves; catch up on return',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            if (!(await pageGame(host)).mine) await takeTurn(j, guest, { others: [host] });
            guest.offline = true;
            await guest.context.setOffline(true);
            await takeTurn(j, host, { others: [] });
            await sleep(1000);
            const stale = await pageGame(guest);
            if (stale.v === j.game(roomId).version) j.note('The offline page already had the new version (socket was not cut)');
            await guest.context.setOffline(false);
            await guest.page.evaluate(() => window.dispatchEvent(new Event('online')));
            await caughtUp(j, guest, roomId, { timeout: 20000 });
            guest.offline = false;
            const g = await pageGame(guest);
            if (!g.mine) j.fail('After coming back, the guest\'s screen does not show it is their turn');
            await j.shot(guest, 'back-online');
            await takeTurn(j, guest, { others: [host] });
            await caughtUp(j, host, roomId);
        },
    },
    {
        id: 'resilience.two-tabs', group: 'Resilience', label: 'Same player in two tabs: each sees the other\'s moves',
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j);
            if (!(await pageGame(guest)).mine) await takeTurn(j, host, { others: [guest] });
            const second = await j.tab(guest);
            await j.goto(second, `/game.html?room=${roomId}`);
            await inGame(j, second);
            await gameTab(guest);
            await actWait(j, guest, button(guest, 'roll-dice'), 'roll dice (tab 1)');
            await caughtUp(j, second, roomId, { timeout: 8000 });
            await j.shot(second, 'tab2-after-tab1-roll');
            await takeTurn(j, second, { others: [host] });
            await caughtUp(j, guest, roomId, { timeout: 8000 });
            if ((await pageGame(guest)).mine) j.fail('Tab 1 still thinks it is my turn after tab 2 ended it');
            await caughtUp(j, host, roomId);
        },
    },

    // ===== Turn alerts =====
    {
        id: 'push.turn-alerts', group: 'Turn alerts', label: 'Turn alerts sheet: blocked browser, then turn on, test alert shows, turn off',
        async run(j) {
            const { host, roomId } = await twoPlayerGame(j, { hostDevice: 'desktop' });
            j.say('a browser that blocks notifications');
            await j.click(host, '#turn-alerts-btn');
            await j.see(host, '#turnAlertsModal');
            await j.see(host, '#turnAlertsHint', /blocked|can't show alerts|aren't available/);
            await j.shot(host, 'alerts-blocked');
            await host.page.locator('#turnAlertsActions button', { hasText: /Done|Not now/ }).first().click();
            await j.gone(host, '#turnAlertsModal');

            j.say('the same player on a browser that allows notifications');
            const phone = await j.person('Hal-phone', { device: 'phone', alerts: true });
            await j.goto(phone, '/');
            await phone.page.evaluate(t => localStorage.setItem('auth_token', t), await j.token(host));
            phone.userId = host.userId;
            await j.goto(phone, `/game.html?room=${roomId}`);
            await inGame(j, phone);
            await j.see(phone, '#turn-alerts-btn:not(.is-on)', null, { what: 'the Turn alerts button, off' });
            await turnOnAlerts(j, phone);
            await j.shot(phone, 'alerts-on');
            await j.see(phone, '#turnAlertsActions [data-turn-alerts="test"]', 'Send a test alert');

            j.say('Send a test alert: the server signs and encrypts it, the device shows it');
            const since = j.pushCount(phone);
            await j.click(phone, '#turnAlertsActions [data-turn-alerts="test"]');
            await j.see(phone, '#turnAlertsStatus', 'Test alert sent');
            const push = await j.waitForPush(phone, since, { title: 'Alerts are on' });
            if (push.urgency !== 'high' || !(push.ttl > 0)) j.fail(`Test alert headers: urgency ${push.urgency}, TTL ${push.ttl}`);
            const shown = await j.waitForNotification(phone, 'Alerts are on');
            if (!/when it's your turn/.test(shown.body)) j.fail(`Test notification body: "${shown.body}"`);
            j.note(`Test alert shown: "${shown.title}: ${shown.body}"`);
            await j.click(phone, '#turnAlertsActions [data-turn-alerts="close"]');
            await j.see(phone, '#turn-alerts-btn.is-on', null, { what: 'the Turn alerts button, on' });

            j.say('reload: the sheet still says alerts are on');
            await phone.page.reload();
            await inGame(j, phone);
            await j.see(phone, '#turn-alerts-btn.is-on', null, { what: 'the Turn alerts button, on after a reload' });

            j.say('Turn off alerts');
            await j.click(phone, '#turn-alerts-btn');
            await j.click(phone, '#turnAlertsActions [data-turn-alerts="disable"]');
            await j.see(phone, '#turnAlertsStatus', 'turned off');
            await j.see(phone, '#turnAlertsActions [data-turn-alerts="enable"]', 'Turn on alerts');
            if (j.sql('SELECT endpoint FROM push_subscriptions WHERE user_id = ?', [host.userId]).length) j.fail('Turning alerts off left the subscription on the server');
            const after = j.pushCount(phone);
            const res = await phone.page.evaluate(async () => (await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } })).json());
            if (res.sent) j.fail(`A test alert still went out after turning alerts off (sent ${res.sent})`);
            await sleep(1000);
            if (j.pushCount(phone) !== after) j.fail('The push service still got a message after alerts were turned off');
        },
    },
    {
        id: 'push.agent-turn', group: 'Turn alerts', label: "Playing an agent: no alert while the game is on screen, an alert when it's hidden or closed, tap opens your turn",
        async run(j) {
            const host = await j.person('Hal', { device: 'phone', alerts: true });
            await register(j, host);
            const roomName = `Alerts ${j.unique('r')}`;
            const { roomId } = await createRoom(j, host, { name: roomName, max: 2 });
            const invite = await inviteAgent(j, host, 'Claude Alert');
            await closeInvite(j, host);
            await j.mcpOk('join_game', { agent_key: invite.key });
            await j.see(host, '#players-list', 'Claude Alert');
            await startGame(j, host, [host]);
            await turnOnAlerts(j, host);
            await j.click(host, '#turnAlertsActions [data-turn-alerts="close"]');
            const isHostsTurn = () => {
                const g = j.game(roomId).state;
                return g.players[g.currentPlayerIndex].userId === host.userId;
            };
            const waitForHostsTurn = async what => {
                const deadline = Date.now() + 15000;
                while (!isHostsTurn() && Date.now() < deadline) await sleep(200);
                if (!isHostsTurn()) j.fail(`It never became the host's turn ${what}`);
            };
            if (isHostsTurn()) await takeTurn(j, host);

            j.say('the game is on screen: the agent ends its turn, no push (the page shows it)');
            let since = j.pushCount(host);
            await agentTurn(j, invite.key);
            await waitForHostsTurn('after the agent played');
            await caughtUp(j, host, roomId);
            await sleep(2500);
            const early = j.pushesSince(host, since);
            if (early.length) j.fail(`A push went out while the game was on screen: ${early.map(r => r.payload?.title).join(', ')}`);

            j.say('the game tab is hidden (phone locked, another app): the turn alert arrives');
            await takeTurn(j, host);
            await host.page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await sleep(500);
            since = j.pushCount(host);
            await agentTurn(j, invite.key);
            await waitForHostsTurn('after the agent played (hidden tab)');
            const hidden = await j.waitForPush(host, since, { title: 'Your turn' });
            if (!hidden.payload.body.includes(roomName)) j.fail(`Turn alert body "${hidden.payload.body}" does not name the game "${roomName}"`);
            await j.waitForNotification(host, 'Your turn');

            j.say('the game is closed (player on My games): the alert arrives and its link opens the turn');
            await host.page.reload();
            await inGame(j, host);
            await takeTurn(j, host);
            await j.goto(host, '/lobby.html');
            await sleep(500);
            since = j.pushCount(host);
            await agentTurn(j, invite.key);
            await waitForHostsTurn('after the agent played (game closed)');
            const closed = await j.waitForPush(host, since, { title: 'Your turn' });
            const p = closed.payload;
            if (p.url !== `/game.html?room=${encodeURIComponent(roomId)}`) j.fail(`Turn alert opens ${p.url}, not this game`);
            if (closed.urgency !== 'high' || !closed.topic) j.fail(`Turn alert headers: urgency ${closed.urgency}, topic ${closed.topic}`);
            const shown = await j.waitForNotification(host, 'Your turn');
            await j.shot(host, 'turn-alert-arrived');
            if (shown.url !== p.url) j.fail(`The notification opens ${shown.url}, not ${p.url}`);
            j.note(`Turn alert: "${shown.title}: ${shown.body}"`);
            j.say("tap the alert: the game opens on the player's turn");
            await j.goto(host, shown.url);
            await inGame(j, host);
            await caughtUp(j, host, roomId);
            if (!(await pageGame(host))?.mine) j.fail('Opening the turn alert did not land on my turn');
            await j.see(host, button(host, 'roll-dice'), null, { what: 'Roll Dice after opening the alert' });
        },
    },
    {
        id: 'push.human-turn', group: 'Turn alerts', label: "Two people: the guest gets a turn alert when the host ends their turn, and none for their own moves",
        async run(j) {
            const { host, guest, roomId } = await twoPlayerGame(j, { guestAccount: true, guestAlerts: true });
            await turnOnAlerts(j, guest);
            await j.click(guest, '#turnAlertsActions [data-turn-alerts="close"]');
            const people = [host, guest];
            const turnOf = () => {
                const g = j.game(roomId).state;
                return g.players[g.currentPlayerIndex].userId;
            };
            if (turnOf() === guest.userId) {
                j.say("the guest's own turn: no alert for it");
                const since = j.pushCount(guest);
                await takeTurn(j, guest, { others: [host] });
                await sleep(1500);
                if (j.pushesSince(guest, since).length) j.fail("The guest got a push for their own move");
            }
            j.say('the guest closes the game; the host ends their turn');
            await j.goto(guest, '/lobby.html');
            await sleep(500);
            const since = j.pushCount(guest);
            await takeTurn(j, host, { others: [] });
            const push = await j.waitForPush(guest, since, { title: 'Your turn' });
            await j.waitForNotification(guest, 'Your turn');
            j.say('the guest opens it and plays');
            await j.goto(guest, push.payload.url);
            await inGame(j, guest);
            await caughtUp(j, guest, roomId);
            await playTurns(j, people, 1);
        },
    },
    {
        id: 'push.iphone-home-screen', group: 'Turn alerts', label: 'iPhone: Add to Home Screen handoff page signs the icon in',
        async run(j) {
            const host = await j.person('Hal', { device: 'desktop' });
            await register(j, host);
            const { code: roomCode, roomId } = await createRoom(j, host, { max: 2 });
            const safari = await j.person('Ivy-safari', { device: 'iphone' });
            await joinRoom(j, safari, roomCode, { name: 'Ivy' });
            await startGame(j, host, [host, safari]);
            await j.click(safari, '#turn-alerts-btn');
            await j.see(safari, '#turnAlertsHint', 'Home Screen');
            await j.see(safari, '#turnAlertsNote', 'not an App Store app');
            await j.shot(safari, 'alerts-iphone');
            await safari.page.getByRole('button', { name: 'Add to Home Screen' }).click();
            await j.url(safari, /home-screen\.html\?code=[A-Z2-9]{8}$/);
            await j.see(safari, '#home-screen-steps');
            await j.shot(safari, 'home-screen-steps');
            await j.layout(safari, 'Add to Home Screen page');
            const code = new URL(safari.page.url()).searchParams.get('code');
            const back = await safari.page.locator('#home-screen-back').getAttribute('href');
            if (!/game\.html/.test(back || '')) j.note(`Back link on the steps page: ${back}`);
            j.say('first launch from the Home Screen icon');
            const app = await j.person('Ivy-icon', { device: 'iphone', standalone: true });
            await j.goto(app, `/home-screen.html?code=${code}`);
            await inGame(j, app);
            if ((await j.userId(app)) !== safari.userId) j.fail('The icon signed in as someone else');
            await j.see(app, '.player-card.current-user', 'Ivy');
            j.say('later launches skip the spent code');
            await j.goto(app, `/home-screen.html?code=${code}`);
            await inGame(j, app);
            j.say('inside the icon, alerts can be turned on');
            await j.click(app, '#turn-alerts-btn');
            await j.see(app, '#turnAlertsHint', /./);
            const hint = (await app.page.locator('#turnAlertsHint').innerText()).trim();
            if (/Home Screen/.test(hint) || hint === 'Checking this device…') j.fail(`Inside the icon the sheet still says: ${hint}`);
            j.say('an expired code in a fresh icon');
            const stale = await j.person('Ivy-oldicon', { device: 'iphone', standalone: true });
            await j.goto(stale, '/home-screen.html?code=ZZZZ2222');
            await j.see(stale, '#home-screen-launch-title', 'Sign in again');
            await j.see(stale, '#home-screen-fallback');
            await j.shot(stale, 'expired-icon');
            void roomId;
        },
    },
];

// ---------------------------------------------------------------- runner

function select(only) {
    if (!only) return JOURNEYS;
    const wanted = String(only).split(',').map(s => s.trim()).filter(Boolean);
    const list = JOURNEYS.filter(def => wanted.some(w => def.id === w || def.id.startsWith(`${w}.`) || def.group.toLowerCase() === w.toLowerCase()));
    if (!list.length) throw new Error(`No journey matches ${only}. Ids: ${JOURNEYS.map(d => d.id).join(', ')}`);
    return list;
}

// Runs the journeys one after another; status.results grows as they finish.
async function runJourneys(ctx, { only, dir, status, timeoutMs = 180000 }) {
    const counter = { people: 100, shots: 0 };
    for (const def of select(only)) {
        if (status.stopRequested) break;
        status.current = def.id;
        const j = new Journey(ctx, def, { dir, counter });
        const started = Date.now();
        ctx.log(`  journey ${def.id}: ${def.label}`);
        const result = { id: def.id, group: def.group, label: def.label, status: 'pass', seconds: 0, error: null, step: null, shots: j.shots, notes: j.notes, findings: j.findings };
        let timer;
        try {
            await Promise.race([
                def.run(j),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new JourneyFailure(`timed out after ${timeoutMs / 1000}s`)), timeoutMs); }),
            ]);
            if (j.findings.length) result.status = 'finding';
        } catch (err) {
            result.step = j.step;
            if (err instanceof JourneySkip) {
                result.status = 'skip';
                result.error = err.message;
            } else {
                result.status = 'fail';
                result.error = err instanceof JourneyFailure ? err.message : String(err.stack || err).split('\n').slice(0, 3).join(' | ');
                const shots = [];
                for (const p of j.people) {
                    const file = await j.shot(p, 'FAIL');
                    if (file) shots.push(path.relative(ctx.evidenceDir, file));
                }
                const entry = ctx.finding({ severity: 'high', category: 'journey', title: `Journey failed: ${def.id}`, detail: `${def.label} — at "${j.step}": ${result.error}` });
                entry.shots.push(...shots.slice(0, 4));
            }
        } finally {
            clearTimeout(timer);
            await j.close();
        }
        result.seconds = Math.round((Date.now() - started) / 1000);
        ctx.log(`  journey ${def.id}: ${result.status.toUpperCase()} in ${result.seconds}s${result.error ? ` — ${result.error}` : ''}`);
        status.results.push(result);
    }
    status.current = null;
    return status.results;
}

function formatResults(results, { everPassed = {} } = {}) {
    const lines = [];
    const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    lines.push(`App journeys: ${results.length} run · ${['pass', 'finding', 'fail', 'skip'].filter(s => counts[s]).map(s => `${counts[s]} ${s}`).join(', ')} · ${Math.round(results.reduce((a, r) => a + r.seconds, 0) / 6) / 10} min`);
    lines.push('', '| Journey | Result | Time | Notes |', '| --- | --- | --- | --- |');
    for (const r of results) {
        const notes = [r.error, ...r.findings.map(f => `finding: ${f}`), ...r.notes].filter(Boolean).join('; ').replace(/\|/g, '/').replace(/\s+/g, ' ');
        lines.push(`| ${r.id} | ${r.status.toUpperCase()}${everPassed[r.id] ? '' : ' ✱'} | ${r.seconds}s | ${notes.slice(0, 400)} |`);
    }
    const missing = JOURNEYS.filter(def => !results.some(r => r.id === def.id));
    if (missing.length) lines.push('', `Not run this time: ${missing.map(d => d.id).join(', ')}`);
    lines.push('', '✱ = never passed in any recorded journeys run (coverage ledger).');
    return lines.join('\n');
}

function list() {
    return JOURNEYS.map(def => `${def.id.padEnd(34)} ${def.group.padEnd(12)} ${def.label}`).join('\n');
}

module.exports = { JOURNEYS, runJourneys, formatResults, list, select };
