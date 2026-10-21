'use strict';

// One process per run: owns the dev backend (child), the static web + API proxy,
// headless Chromium with one context per seat, and a control API on
// 127.0.0.1:<ctl> that the CLI talks to. Started detached by `verify-mortgage up`.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const runs = require('./lib/runs');
const { snapshotInPage, formatView, resolveControl } = require('./lib/view');
const { buildTable } = require('./lib/table');
const { Autoplay } = require('./lib/bot');
const pathways = require('./lib/pathways');
const stages = require('./lib/stages');

const runId = process.argv[2];
const run = runs.readRun(runId);
if (!run) { console.error(`No run.json for ${runId}`); process.exit(2); }

const evidence = runs.evidenceDir(runId);
fs.mkdirSync(evidence, { recursive: true });
const stepsLog = path.join(evidence, 'steps.log');

let backend = null;
let webServer = null;
let ctlServer = null;
let browser = null;
let table = null;
let tableCount = 0;
let gameDir = evidence;
let shotCounter = 0;
let autoplay = null;
let autoplayPromise = null;
let findings = [];
const findingIndex = new Map();
const api4xx = new Map();
// Coverage evidence the engine doesn't store: paths seen by the harness, and actions the server refused.
let uiMarks = new Set();
let refusedActions = [];
let stagesApplied = [];

// Evidence writes recreate their folder, so a deleted folder can't crash a run.
function appendEvidence(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, text);
}

function log(line) {
    const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
    appendEvidence(stepsLog, stamped + '\n');
}

function sql(query, params = []) {
    const db = new DatabaseSync(run.dbPath, { readOnly: true });
    try {
        return db.prepare(query).all(...params);
    } finally {
        db.close();
    }
}

function finding({ severity, category, seat, title, detail }) {
    const key = `${category}|${title}|${seat ? seat.index : ''}`;
    const existing = findingIndex.get(key);
    if (existing) {
        existing.count++;
        existing.lastAt = new Date().toISOString();
        if (detail && existing.examples.length < 5 && !existing.examples.includes(detail)) existing.examples.push(detail);
        return existing;
    }
    const entry = {
        id: `F${findings.length + 1}`,
        severity, category, title,
        seat: seat ? `${seat.index} ${seat.name} (${seat.device})` : null,
        game: tableCount,
        detail,
        examples: detail ? [detail] : [],
        count: 1,
        at: new Date().toISOString(),
        round: autoplay ? autoplay.status.round : null,
        shots: [],
    };
    findings.push(entry);
    findingIndex.set(key, entry);
    appendEvidence(path.join(evidence, 'findings.jsonl'), JSON.stringify(entry) + '\n');
    log(`  FINDING ${entry.id} [${severity}/${category}] ${seat ? `seat ${seat.index} ${seat.name}: ` : ''}${title}${detail ? ` — ${detail}` : ''}`);
    return entry;
}

async function shot(seat, name) {
    shotCounter++;
    const file = path.join(gameDir, `${String(shotCounter).padStart(3, '0')}-s${seat.index}-${seat.name}-${name}.png`.replace(/[^\w.\-/]/g, '_'));
    try {
        await seat.page.screenshot({ path: file, fullPage: true });
        const snap = await seat.page.evaluate(snapshotInPage, { maxTextChars: 4000 });
        fs.writeFileSync(file.replace(/\.png$/, '.txt'), formatView(seat, snap));
        const last = findings[findings.length - 1];
        if (last && name.match(/FAILED|rejected|no-effect|stale|stuck|missing|unusable|failed|no-resync|no-roll/) && last.shots.length < 4) last.shots.push(path.relative(evidence, file));
        return file;
    } catch (err) {
        log(`  (screenshot ${name} failed: ${err.message})`);
        return null;
    }
}

const ctx = {
    run,
    get webUrl() { return `http://127.0.0.1:${run.ports.web}`; },
    get browser() { return browser; },
    log,
    sql,
    shot,
    finding,
    recordIssue(seat, kind, detail) {
        const severity = kind === 'page-error' || kind === 'api-5xx' ? 'high' : 'medium';
        finding({ severity, category: kind, seat, title: kind === 'console-error' ? 'Console error' : kind === 'page-error' ? 'Uncaught page error' : kind === 'api-5xx' ? 'Server error' : 'Network request failed', detail });
    },
    recordApi4xx(seat, res) {
        const url = res.url().replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id');
        const key = `${res.request().method()} ${url} ${res.status()}`;
        api4xx.set(key, (api4xx.get(key) || 0) + 1);
        if (url.endsWith('/actions')) {
            const body = (() => { try { return JSON.parse(res.request().postData() || '{}'); } catch { return {}; } })();
            const entry = { action_type: body.type, payload: body.payload || {}, refused: true, error: '' };
            refusedActions.push(entry);
            res.json().then(j => { entry.error = j.error || ''; }).catch(() => {});
        }
        if (res.status() === 409) finding({ severity: 'low', category: 'api-409', title: 'Actions hit a version conflict (409); the player is asked to retry', detail: key });
    },
    markUi(id) {
        if (!uiMarks.has(id)) log(`  pathway: ${id}`);
        uiMarks.add(id);
    },
    coverageNow() {
        return currentCoverage();
    },
    applyStage(name, opts) {
        return applyStage(name, opts);
    },
    // A game action the harness takes as host through the API (never on an agent's screen),
    // followed by a 'Test harness' log line so players can see who did it.
    async harnessAction(type, payload, why) {
        const res = await fetch(`http://127.0.0.1:${run.ports.api}/api/games/${table.gameId}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${table.hostToken}` },
            body: JSON.stringify({ actionId: `harness-${Date.now()}`, type, payload, expectedVersion: sql('SELECT state_version FROM games WHERE id = ?', [table.gameId])[0].state_version }),
        });
        log(`  HARNESS ${type}: ${res.status} (${why})`);
        const row = sql('SELECT game_state, state_version FROM games WHERE id = ?', [table.gameId])[0];
        const state = JSON.parse(row.game_state);
        state.gameLog = [...state.gameLog, { timestamp: new Date().toISOString(), message: `Test harness: ${why}` }].slice(-100);
        await fetch(`http://127.0.0.1:${run.ports.api}/api/games/${table.gameId}/state`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${table.hostToken}` },
            body: JSON.stringify({ game_state: state, action_type: 'host_state_repair', expected_version: row.state_version }),
        });
        return res.ok;
    },
    recordAppRefusal(seat, text) {
        finding({ severity: 'low', category: 'console-error', title: 'The game logs refused actions as console errors', detail: text.slice(0, 200) });
    },
    recordDialog(seat, entry) {
        log(`    dialog on seat ${seat.index} ${seat.name}: ${entry.type} "${entry.message}" (${entry.handled})`);
    },
};

// ---------- servers ----------

async function startBackend() {
    const env = {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(run.ports.api),
        HOST: '127.0.0.1',
        DB_PATH: run.dbPath,
        JWT_SECRET: `verify-${runId}`,
        CORS_ORIGINS: '*',
        LOG_OTPS: 'true',
        ACTION_AUDIT_LOG: 'true',
        ROOM_CREATE_RATE_LIMIT_MAX: '200',
        // Dev-only hooks used by staged setups: host state repair and per-roll test dice.
        ALLOW_STATE_REPAIR: 'true',
        // A throwaway push key pair, so the turn-alerts screen behaves as in production.
        ...(() => {
            const keys = require(path.join(runs.APP_ROOT, 'backend', 'node_modules', 'web-push')).generateVAPIDKeys();
            return { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:verify@example.test' };
        })(),
        PUBLIC_APP_URL: `http://127.0.0.1:${run.ports.web}`,
        // Mail: a dead local URL unless --email, so a repo backend/.env can never
        // send real mail (an empty value would let .env fill it in).
        USESEND_URL: run.email ? 'https://api.resend.com/emails' : 'http://127.0.0.1:9/disabled',
        USESEND_API_KEY: run.email ? fs.readFileSync(run.resendKeyFile, 'utf8').trim() : 'verify-mail-disabled',
        SMTP_FROM: 'noreply@abdlh.com',
    };
    const out = fs.openSync(path.join(runs.runDir(runId), 'backend.log'), 'a');
    backend = spawn(process.execPath, ['server.js'], { cwd: path.join(runs.APP_ROOT, 'backend'), env, stdio: ['ignore', out, out] });
    backend.on('exit', code => log(`backend exited (${code})`));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${run.ports.api}/api/health`);
            if (res.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('backend did not become healthy');
}

async function startWeb() {
    const { createStaticProxyServer } = require(path.join(runs.APP_ROOT, 'scripts', 'dev-server.js'));
    webServer = createStaticProxyServer({ root: runs.APP_ROOT, backendOrigin: `http://127.0.0.1:${run.ports.api}`, noStore: true });
    await new Promise((resolve, reject) => {
        webServer.on('error', reject);
        webServer.listen(run.ports.web, '0.0.0.0', resolve);
    });
}

async function startBrowser() {
    const { chromium } = require(path.join(runs.REPO_ROOT, 'node_modules', '@playwright', 'test'));
    const opts = { headless: !run.headed };
    if (process.env.VERIFY_CHROMIUM) opts.executablePath = process.env.VERIFY_CHROMIUM;
    try {
        browser = await chromium.launch(opts);
    } catch (err) {
        log(`bundled chromium failed (${err.message.split('\n')[0]}); trying /usr/bin/chromium`);
        browser = await chromium.launch({ ...opts, executablePath: '/usr/bin/chromium' });
    }
}

// ---------- seat helpers ----------

function seatArg(args) {
    if (!table) throw new Error('No table yet. Run: table --players N');
    const want = String(args.seat ?? '');
    const seat = table.seats.find(s => String(s.index) === want || s.name.toLowerCase() === want.toLowerCase());
    if (!seat) throw new Error(`No seat "${want}". Seats: ${table.seats.map(s => `${s.index}=${s.name}`).join(', ')}`);
    return seat;
}

async function settle(page) {
    await page.waitForTimeout(250);
    await page.waitForFunction(() => !document.querySelector('.game-action-busy'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(250);
}

async function look(seat, { full = false } = {}) {
    const snap = await seat.page.evaluate(snapshotInPage, { maxTextChars: full ? 50000 : 1800 });
    seat.lastControls = snap.controls;
    const view = formatView(seat, snap, { dialogs: seat.unreadDialogs, issues: seat.unreadIssues });
    seat.unreadDialogs = [];
    seat.unreadIssues = [];
    return view;
}

async function mustAct(seat) {
    return seat.page.evaluate(() => {
        if (typeof currentGame === 'undefined' || !currentGame || typeof currentUser === 'undefined' || !currentUser) return 'not-in-game';
        const state = currentGame.game_state;
        if (state.ended) return 'game-over';
        if (state.players[state.currentPlayerIndex]?.userId === currentUser.id && !state.paused) return 'your-turn';
        const a = state.auction;
        if (a && a.status === 'open' && a.highBidderId !== currentUser.id && !(a.passedPlayerIds || []).includes(currentUser.id)) return 'auction';
        if ((state.marketOffers || []).some(o => o.status === 'pending' && [o.player1Id, o.player2Id].includes(currentUser.id) && o.proposedById !== currentUser.id)) return 'trade-offer';
        return null;
    }).catch(() => null);
}

// ---------- commands ----------

const commands = {
    async table(args) {
        if (autoplayPromise && autoplay?.status.phase !== 'done') throw new Error('Autoplay is still running; stop it first.');
        const players = Number(args.players);
        if (!(players >= 2 && players <= 8)) throw new Error('--players must be 2-8');
        const emailSeats = Math.min(players, Number(args.emailSeats ?? 3));
        if (table) for (const seat of table.seats) await seat.context.close().catch(() => {});
        tableCount++;
        shotCounter = 0;
        gameDir = path.join(evidence, `game-${tableCount}-${players}p`);
        fs.mkdirSync(gameDir, { recursive: true });
        log(`== game ${tableCount}: ${players} players (${emailSeats} by email${run.email ? ' via AgentMail' : ', codes read from the dev DB'}) ==`);
        const started = Date.now();
        uiMarks = new Set();
        refusedActions = [];
        stagesApplied = [];
        table = await buildTable(ctx, { players, emailSeats });
        table.hostToken = await table.seats[0].page.evaluate(() => localStorage.getItem('auth_token'));
        table.players = players;
        table.seats.forEach(seat => { seat.gameUrl = seat.page.url(); });
        table.setupSeconds = Math.round((Date.now() - started) / 1000);
        log(`  game ${table.gameId} started in ${table.setupSeconds}s`);
        for (const seat of table.seats) await shot(seat, 'game-start');
        return { text: `Game ${tableCount} started: ${players} players, room ${table.inviteCode}, evidence ${path.relative(runs.REPO_ROOT, gameDir)}\n` + seatsText() };
    },

    async seats() {
        return { text: seatsText() };
    },

    async seatsData() {
        if (!table) throw new Error('No table yet.');
        return { seats: table.seats.map(s => ({ index: s.index, name: s.name, device: s.device, viewport: s.viewport, kind: s.kind, human: s.human })), rounds: autoplay ? autoplay.rounds : null };
    },

    async look(args) {
        const seat = seatArg(args);
        return { text: await look(seat, { full: !!args.full }) };
    },

    async click(args) {
        const seat = seatArg(args);
        const { locator, note } = await resolveControl(seat.page, seat.lastControls, String(args.target));
        // An agent must accept "are you sure?" dialogs on purpose; otherwise they are dismissed.
        if (args.dismiss || (seat.human && !args.confirm)) seat.dismissNextConfirm = true;
        await locator.click({ timeout: 8000 });
        await settle(seat.page);
        seat.dismissNextConfirm = false;
        return { text: `${note ? note + '\n' : ''}${await look(seat)}` };
    },

    async fill(args) {
        const seat = seatArg(args);
        const { locator, note } = await resolveControl(seat.page, seat.lastControls, String(args.target));
        await locator.fill(String(args.value ?? ''));
        await locator.dispatchEvent('input');
        return { text: `${note ? note + '\n' : ''}filled.` };
    },

    async select(args) {
        const seat = seatArg(args);
        const { locator, note } = await resolveControl(seat.page, seat.lastControls, String(args.target));
        await locator.selectOption({ label: String(args.option) }).catch(() => locator.selectOption(String(args.option)));
        await settle(seat.page);
        return { text: `${note ? note + '\n' : ''}${await look(seat)}` };
    },

    async check(args) {
        const seat = seatArg(args);
        const { locator } = await resolveControl(seat.page, seat.lastControls, String(args.target));
        if (args.off) await locator.uncheck(); else await locator.check();
        return { text: 'ok' };
    },

    async press(args) {
        const seat = seatArg(args);
        await seat.page.keyboard.press(String(args.key));
        await settle(seat.page);
        return { text: await look(seat) };
    },

    async tab(args) {
        const seat = seatArg(args);
        await seat.page.locator(`.nav-tab[data-section="${String(args.name).toLowerCase()}"]`).click();
        await settle(seat.page);
        return { text: await look(seat) };
    },

    async goto(args) {
        const seat = seatArg(args);
        await seat.page.goto(new URL(String(args.path || '/'), ctx.webUrl).toString());
        await settle(seat.page);
        return { text: await look(seat) };
    },

    async shot(args) {
        const seat = seatArg(args);
        const file = await shot(seat, String(args.name || 'manual'));
        return { text: file || 'screenshot failed' };
    },

    // Blocks until one of the seats ("2" or "1,3") must act, then shows that seat.
    async wait(args) {
        const seats = String(args.seat ?? '').split(',').filter(Boolean).map(seat => seatArg({ seat }));
        if (!seats.length) throw new Error('wait needs a seat, e.g. wait 2 or wait 1,3');
        const timeoutMs = Number(args.timeout || 100) * 1000;
        const deadline = Date.now() + timeoutMs;
        let hit = null;
        while (Date.now() < deadline && !hit) {
            for (const seat of seats) {
                const reason = await mustAct(seat);
                if (reason && reason !== 'not-in-game') { hit = { seat, reason }; break; }
            }
            if (!hit) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!hit) return { text: `wait: nothing to do yet for seat ${seats.map(s => s.index).join(',')} (${autoplay ? autoplay.status.current || '' : ''} is playing). Call wait again.` };
        await settle(hit.seat.page);
        return { text: `wait: seat ${hit.seat.index} ${hit.seat.name}: ${hit.reason}\n${await look(hit.seat)}` };
    },

    async human(args) {
        const seat = seatArg(args);
        seat.human = !args.off;
        return { text: `seat ${seat.index} ${seat.name} is ${seat.human ? 'played by you (autoplay waits for it)' : 'played by autoplay'}` };
    },

    async autoplay(args) {
        if (!table) throw new Error('No table yet.');
        if (autoplayPromise && autoplay.status.phase !== 'done') throw new Error('Autoplay already running.');
        for (const index of String(args.human || '').split(',').filter(Boolean)) seatArg({ seat: index }).human = true;
        autoplay = new Autoplay(ctx, table, {
            rounds: Number(args.rounds || 20),
            seed: Number(args.seed || Date.now() % 100000),
            shotEvery: Number(args.shotEvery ?? 5),
            humanIdleMs: Number(args.humanIdleMin || 10) * 60000,
            maxMinutes: Number(args.maxMinutes || 90),
            endGame: !args.noEnd,
            chaos: Number(args.chaos || 0),
            explore: !!args.explore,
            stageRate: args.stageRate !== undefined ? Number(args.stageRate) : undefined,
        });
        log(`  autoplay: ${autoplay.rounds} rounds, seed ${autoplay.seed}, chaos ${autoplay.chaos}, explore ${!!autoplay.explore}, human seats: ${table.seats.filter(s => s.human).map(s => s.name).join(', ') || 'none'}`);
        autoplayPromise = autoplay.run().catch(err => {
            finding({ severity: 'high', category: 'harness', title: 'Autoplay crashed', detail: String(err.stack || err).split('\n').slice(0, 3).join(' | ') });
            autoplay.status.phase = 'done';
            autoplay.status.crashed = true;
        }).then(() => writeReport());
        return { text: `autoplay started (seed ${autoplay.seed}). Poll with: status` };
    },

    async stop() {
        if (autoplay) autoplay.stopRequested = true;
        return { text: 'stop requested' };
    },

    async status() {
        const s = autoplay ? autoplay.status : null;
        const counts = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {});
        return {
            text: s
                ? `autoplay ${s.phase} · round ${s.round}/${autoplay.rounds} · ${s.turnsTotal} turns · now: ${s.current || '-'}${s.minutes ? ` · ${s.minutes} min` : ''} · findings ${JSON.stringify(counts)}`
                : `no autoplay · findings ${JSON.stringify(counts)}`,
            done: !s || s.phase === 'done',
        };
    },

    async findings(args) {
        const list = findings.filter(f => !args.severity || f.severity === args.severity);
        return { text: list.map(formatFinding).join('\n\n') || 'no findings' };
    },

    async report() {
        return { text: writeReport() };
    },

    async coverage(args) {
        if (!table) throw new Error('No table yet.');
        return { text: formatCoverage(currentCoverage(), { missingOnly: !!args.missing, ledger: !!args.allRuns }) };
    },

    async coverageData() {
        if (!table) throw new Error('No table yet.');
        const totals = ledgerTotals(readLedger());
        return { pathways: currentCoverage().map(c => ({ ...c, everReached: !!totals[c.id] })) };
    },

    async stage(args) {
        const name = String(args.seat || args.name || '');
        const result = await applyStage(name, { reason: 'requested' });
        return { text: result ? `staged ${name}: ${result.note}` : `stage ${name} does not apply right now` };
    },

    async state() {
        if (!table) throw new Error('No table yet.');
        const row = sql('SELECT game_state, state_version FROM games WHERE id = ?', [table.gameId])[0];
        const state = JSON.parse(row.game_state);
        const lines = [`v${row.state_version} · turn: ${state.players[state.currentPlayerIndex]?.name} · auction: ${state.auction?.status || 'none'} · paused: ${!!state.paused} · ended: ${!!state.ended}`];
        for (const p of state.players) {
            lines.push(`${p.name}: $${Number(p.cash).toFixed(2)} sq ${p.position}${p.inJail ? ' JAIL' : ''}${p.bankrupt ? ' BANKRUPT' : ''} · ${(p.properties || []).map(x => x.name).join(', ') || 'no property'} · debts ${(p.debts || []).length}`);
        }
        (state.corporations || []).forEach(c => lines.push(`corp ${c.ticker}: ${c.totalShares} shares, available ${c.availableShares}, chair ${c.chairmanName}`));
        lines.push('recent log:', ...state.gameLog.slice(-6).map(e => `  ${String(e.message).replace(/<[^>]+>/g, '')}`));
        return { text: lines.join('\n') };
    },

    async note(args) {
        const seat = args.seat ? seatArg(args) : null;
        const entry = finding({ severity: String(args.severity || 'low'), category: String(args.category || 'ux'), seat, title: String(args.title), detail: String(args.detail || '') });
        if (seat && args.shot !== false) entry.shots.push(path.relative(evidence, await shot(seat, `note-${entry.id}`)));
        return { text: `recorded ${entry.id}` };
    },

    async shutdown() {
        setTimeout(() => shutdown(0), 50);
        return { text: 'shutting down' };
    },
};

function seatsText() {
    if (!table) return 'no table';
    return table.seats.map(s => `seat ${s.index}: ${s.name} · ${s.kind}${s.email ? ` ${s.email}` : ''} · ${s.device} ${s.viewport.width}x${s.viewport.height}${s.human ? ' · HUMAN (you)' : ''}`).join('\n');
}

function formatFinding(f) {
    return `${f.id} [${f.severity}/${f.category}] ${f.seat ? `seat ${f.seat}: ` : ''}${f.title}${f.count > 1 ? ` (x${f.count})` : ''}\n  ${f.examples.join('\n  ') || ''}${f.shots.length ? `\n  shots: ${f.shots.join(', ')}` : ''}`;
}

function currentCoverage() {
    const row = sql('SELECT game_state FROM games WHERE id = ?', [table.gameId])[0];
    const state = row ? JSON.parse(row.game_state) : null;
    return pathways.coverage(pathways.readEvents(sql, table.gameId), state, uiMarks, pathways.readActions(sql, table.gameId, refusedActions));
}

// Puts the game into a staged situation through the host's dev-only state repair.
async function applyStage(name, { reason = 'auto', rand, uncovered } = {}) {
    const row = sql('SELECT game_state, state_version FROM games WHERE id = ?', [table.gameId])[0];
    const state = JSON.parse(row.game_state);
    if (state.auction?.status === 'open' || state.ended || state.paused) return null;
    const current = state.players[state.currentPlayerIndex];
    if (current.diceRolled) return null;
    const built = stages.build(name, state, { rand, uncovered });
    if (!built) return null;
    const res = await fetch(`http://127.0.0.1:${run.ports.api}/api/games/${table.gameId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${table.hostToken}` },
        body: JSON.stringify({ game_state: built.state, action_type: 'host_state_repair', expected_version: row.state_version }),
    });
    if (!res.ok) {
        log(`  stage ${name} refused by the server: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return null;
    }
    for (const [userId, dice] of Object.entries(built.dice || {})) {
        const seat = table.seats.find(s => s.userId === userId);
        // The game's dev hook sends whatever array is there, so hide the queue once it runs out:
        // an empty array would be sent as testDice: [] and the server would roll undefined dice.
        if (seat && dice.length) {
            await seat.page.evaluate(d => {
                const queue = d.slice();
                Object.defineProperty(window, '__E2E_NEXT_DICE', { configurable: true, get: () => (queue.length >= 2 ? queue : undefined) });
            }, dice);
        }
    }
    const entry = { name, note: built.note, reason, round: autoplay ? autoplay.status.round : null, at: new Date().toISOString(), restoreAfter: built.restoreAfter || null, restored: false, auctionWait: !!built.auctionWait };
    entry.restore = built.restore || null;
    stagesApplied.push(entry);
    log(`  STAGED ${name} (${reason}): ${built.note}`);
    return entry;
}

// Undo temporary setting changes once the pathway they were for has happened.
async function restoreStages(cov) {
    const hit = new Set(cov.filter(c => c.hits).map(c => c.id));
    for (const entry of stagesApplied.filter(e => e.restore && !e.restored && hit.has(e.restoreAfter))) {
        const row = sql('SELECT game_state, state_version FROM games WHERE id = ?', [table.gameId])[0];
        const state = JSON.parse(row.game_state);
        entry.restore(state);
        const res = await fetch(`http://127.0.0.1:${run.ports.api}/api/games/${table.gameId}/state`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${table.hostToken}` },
            body: JSON.stringify({ game_state: state, action_type: 'host_state_repair', expected_version: row.state_version }),
        });
        entry.restored = res.ok;
        log(`  restored settings after ${entry.name}: ${res.ok ? 'ok' : res.status}`);
    }
}
ctx.restoreStages = restoreStages;

const LEDGER = path.join(runs.DATA_ROOT, 'coverage-ledger.json');

function readLedger() {
    try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return { games: {} }; }
}

function recordLedger(cov) {
    const ledger = readLedger();
    ledger.games[`${runId}/game-${tableCount}`] = { rev: run.gitRev, players: table.players, at: new Date().toISOString(), hits: Object.fromEntries(cov.filter(c => c.hits).map(c => [c.id, c.hits])) };
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
    return ledger;
}

function ledgerTotals(ledger) {
    const totals = {};
    for (const game of Object.values(ledger.games)) for (const [id, n] of Object.entries(game.hits)) totals[id] = (totals[id] || 0) + n;
    return totals;
}

function formatCoverage(cov, { missingOnly = false, ledger = false } = {}) {
    const lines = [];
    const hitCount = cov.filter(c => c.hits).length;
    lines.push(`Pathways reached this game: ${hitCount}/${cov.length}`);
    const totals = ledger ? ledgerTotals(readLedger()) : null;
    if (totals) lines.push(`Across all recorded games: ${cov.filter(c => totals[c.id] || c.hits).length}/${cov.length}`);
    for (const [group, g] of pathways.summarize(cov)) {
        lines.push(`${group}: ${g.hit}/${g.total}`);
        const shown = missingOnly || !ledger ? g.missing : g.missing.filter(c => !totals[c.id]);
        for (const c of shown) lines.push(`  - ${c.id}: ${c.label}${c.hint ? ` (how: ${c.hint})` : ''}${c.stage ? ` [stage ${c.stage}]` : ''}`);
    }
    return lines.join('\n');
}

function writeReport() {
    const order = { high: 0, medium: 1, low: 2 };
    const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
    const summary = autoplay ? autoplay.summary() : null;
    const lines = [`# verify-mortgage report — run ${runId}`, ''];
    lines.push(`- git: ${run.gitRev}${run.dirty ? ' (dirty)' : ''}`);
    lines.push(`- email: ${run.email ? 'real (Resend → AgentMail)' : 'off (OTP read from dev DB)'}`);
    if (table) lines.push(`- game ${tableCount}: ${table.players} players, setup ${table.setupSeconds}s, seats: ${table.seats.map(s => `${s.name} (${s.kind}, ${s.device}${s.human ? ', human' : ''})`).join(', ')}`);
    if (summary) {
        lines.push(`- autoplay: seed ${summary.seed}, chaos ${summary.chaos ? summary.chaos.probability : 0}, rounds ${summary.roundsCompleted}/${summary.roundsTarget}, ${summary.turnsTotal} turns, ${summary.minutes} min, game ended: ${summary.ended}`);
        lines.push('', '## Final table', '', '| Player | Cash | Properties | Debts | Turns | Bankrupt |', '| --- | --- | --- | --- | --- | --- |');
        summary.players.forEach(p => lines.push(`| ${p.name} | $${Number(p.cash).toFixed(2)} | ${p.properties} | ${p.debts} | ${p.turns} | ${p.bankrupt ? 'yes' : ''} |`));
        lines.push('', '## Action timing (ms, click to result on that screen)', '', '| Action | n | p50 | max |', '| --- | --- | --- | --- |');
        Object.entries(summary.timing).forEach(([k, t]) => lines.push(`| ${k} | ${t.n} | ${t.p50} | ${t.max} |`));
    }
    if (summary && summary.chaos) {
        lines.push('', '## Chaos', '', `Moves: ${Object.entries(summary.chaos.moves).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`, '');
        lines.push('Refusal messages players saw (check the wording reads well to a person):', '');
        summary.chaos.refusals.forEach(r => lines.push(`- "${r.message}" x${r.n}`));
    }
    if (table) {
        try {
            const cov = currentCoverage();
            const ledger = recordLedger(cov);
            const totals = ledgerTotals(ledger);
            lines.push('', '## Pathway coverage', '', `This game reached ${cov.filter(c => c.hits).length}/${cov.length} pathways; all recorded games together reached ${cov.filter(c => totals[c.id]).length}/${cov.length}. Missing this game (✱ = never reached in any recorded game):`, '');
            for (const [group, g] of pathways.summarize(cov)) {
                lines.push(`- **${group}** ${g.hit}/${g.total}${g.missing.length ? ': ' + g.missing.map(c => `${totals[c.id] ? '' : '✱'}${c.id}`).join(', ') : ''}`);
            }
            if (stagesApplied.length) {
                const hit = new Set(cov.filter(c => c.hits).map(c => c.id));
                lines.push('', '### Staged setups (dev-only state repair; findings after these come from a staged situation)', '');
                stagesApplied.forEach(e => lines.push(`- round ${e.round}: ${e.name} (${e.reason}): ${e.note}`));
            }
            fs.writeFileSync(path.join(evidence, 'coverage.json'), JSON.stringify(cov, null, 1));
        } catch (err) {
            lines.push('', `(coverage failed: ${err.message})`);
        }
    }
    lines.push('', `## Findings (${findings.length})`, '');
    if (!sorted.length) lines.push('None.');
    sorted.forEach(f => lines.push(formatFinding(f).replace(/^/, '- ').replace(/\n/g, '\n  '), ''));
    if (api4xx.size) {
        lines.push('## API 4xx responses (usually expected refusals; check any that are not)', '');
        [...api4xx.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => lines.push(`- ${k} x${n}`));
    }
    const file = path.join(evidence, 'report.md');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    fs.writeFileSync(path.join(evidence, 'findings.json'), JSON.stringify(sorted, null, 2));
    if (summary) fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
    return `report: ${path.relative(runs.REPO_ROOT, file)}\n\n${lines.join('\n')}`;
}

// ---------- control server ----------

function startControl() {
    ctlServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            let reply;
            try {
                const { cmd, args = {} } = JSON.parse(body || '{}');
                const handler = commands[cmd];
                if (!handler) throw new Error(`Unknown command ${cmd}`);
                if (cmd !== 'status') log(`> ${cmd} ${JSON.stringify(args)}`);
                reply = { ok: true, ...(await handler(args)) };
            } catch (err) {
                reply = { ok: false, error: String(err.message || err).split('\n').slice(0, 4).join('\n') };
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(reply));
        });
    });
    return new Promise(resolve => ctlServer.listen(run.ports.ctl, '127.0.0.1', resolve));
}

async function shutdown(code) {
    log('shutting down');
    try { if (autoplay) autoplay.stopRequested = true; } catch {}
    try { writeReport(); } catch {}
    try { if (browser) await browser.close(); } catch {}
    try { if (webServer) webServer.close(); } catch {}
    if (backend && backend.exitCode === null) {
        backend.kill('SIGTERM');
        await new Promise(resolve => { const t = setTimeout(() => { backend.kill('SIGKILL'); resolve(); }, 3000); backend.once('exit', () => { clearTimeout(t); resolve(); }); });
    }
    try { fs.copyFileSync(path.join(runs.runDir(runId), 'backend.log'), path.join(evidence, 'backend.log')); } catch {}
    const latest = runs.readRun(runId) || run;
    runs.writeRun({ ...latest, status: 'down', stoppedAt: new Date().toISOString() });
    try { if (ctlServer) ctlServer.close(); } catch {}
    process.exit(code);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

(async () => {
    try {
        log(`run ${runId} starting: web ${run.ports.web}, api ${run.ports.api}, ctl ${run.ports.ctl}, db ${run.dbPath}`);
        await startBackend();
        await startWeb();
        await startBrowser();
        await startControl();
        runs.writeRun({ ...run, status: 'ready', daemonPid: process.pid, backendPid: backend.pid });
        log('ready');
    } catch (err) {
        log(`startup failed: ${err.stack || err}`);
        runs.writeRun({ ...run, status: 'failed', error: String(err.message || err) });
        await shutdown(1);
    }
})();
