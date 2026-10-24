'use strict';

// CLI for the verify-mortgage skill. `up`/`down`/`list`/`doctor` manage a run;
// every other command is sent to the run's daemon. See ../SKILL.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');
const runs = require('./lib/runs');
const playersLib = require('./lib/players');

const TAILNET_IP = '100.110.102.49';
const RESEND_KEY_FILE = process.env.VERIFY_RESEND_KEY_FILE || path.join(os.homedir(), '.config', 'alf-layla', 'resend-api-key');
const ROTATION = [2, 5, 8];

function parse(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) { positional.push(arg); continue; }
        const [rawKey, inline] = arg.slice(2).split(/=(.*)/s);
        const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (inline !== undefined) flags[key] = inline;
        else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
        else flags[key] = true;
    }
    return { positional, flags };
}

function die(message, code = 1) {
    console.error(message);
    process.exit(code);
}

function currentRun({ required = true } = {}) {
    const id = process.env.VERIFY_RUN_ID;
    if (!id) {
        if (!required) return null;
        const alive = runs.listRuns().filter(r => runs.isAlive(r.daemonPid));
        die(`VERIFY_RUN_ID is not set. Prefix each command with VERIFY_RUN_ID=<id from up>.${alive.length ? `\nLive runs: ${alive.map(r => r.runId).join(', ')} (only use one you started)` : ''}`, 2);
    }
    const run = runs.readRun(id);
    if (!run) die(`No run ${id} under ${runs.DATA_ROOT}`, 2);
    return run;
}

async function send(run, cmd, args = {}) {
    let res;
    try {
        res = await fetch(`http://127.0.0.1:${run.ports.ctl}/`, { method: 'POST', body: JSON.stringify({ cmd, args }) });
    } catch (err) {
        die(`Run ${run.runId} is not answering on ctl port ${run.ports.ctl} (${err.cause?.code || err.message}). Is it up? Try: list`);
    }
    return res.json();
}

function gitRev() {
    try {
        const rev = execSync('git rev-parse --short HEAD', { cwd: runs.APP_ROOT }).toString().trim();
        const dirty = execSync('git status --porcelain', { cwd: runs.APP_ROOT }).toString().trim().length > 0;
        return { rev, dirty };
    } catch {
        return { rev: 'unknown', dirty: false };
    }
}

async function up(flags) {
    for (const dir of [runs.REPO_ROOT, runs.APP_ROOT, path.join(runs.APP_ROOT, 'backend')]) {
        if (!fs.existsSync(path.join(dir, 'node_modules'))) {
            console.log(`[verify] npm ci in ${path.relative(runs.REPO_ROOT, dir) || '.'}`);
            execSync('npm ci --no-audit --no-fund', { cwd: dir, stdio: 'inherit' });
        }
    }
    const email = !!flags.email;
    if (email) {
        const { inboxReachable, INBOXES, INBOX_FILE, KEY_FILE } = require('./lib/agentmail');
        if (INBOXES.length < 3) die(`--email needs three AgentMail test inboxes, one per line, in ${INBOX_FILE} (or VERIFY_AGENTMAIL_INBOXES).`);
        if (!fs.existsSync(RESEND_KEY_FILE)) die(`--email needs the Resend key at ${RESEND_KEY_FILE}`);
        if (!fs.existsSync(KEY_FILE)) die(`--email needs the AgentMail key at ${KEY_FILE}`);
        for (const inbox of INBOXES) await inboxReachable(inbox).catch(err => die(`AgentMail inbox ${inbox} unreachable: ${err.message}`));
    }
    const ports = await runs.pickPorts();
    const runId = runs.newRunId();
    const dir = runs.runDir(runId);
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'game.db');
    if (dbPath.includes('/mnt/ssd/projects/') || dbPath.endsWith('backend/game.db')) die('Refusing a production-looking DB path.');
    const { rev, dirty } = gitRev();
    runs.writeRun({ runId, status: 'starting', ports, dbPath, email, headed: !!flags.headed, resendKeyFile: RESEND_KEY_FILE, gitRev: rev, dirty, startedAt: new Date().toISOString(), repo: runs.REPO_ROOT, appRoot: runs.APP_ROOT });
    const out = fs.openSync(path.join(dir, 'daemon.log'), 'a');
    const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js'), runId], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, VERIFY_APP_ROOT: runs.APP_ROOT }, cwd: runs.REPO_ROOT });
    child.unref();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        const run = runs.readRun(runId);
        if (run.status === 'ready') {
            console.log(`export VERIFY_RUN_ID=${runId}`);
            console.log(`READY run=${runId} web=http://127.0.0.1:${ports.web} tailnet=http://${TAILNET_IP}:${ports.web} api=${ports.api} email=${email ? 'agentmail' : 'local sink'} git=${rev}${dirty ? '-dirty' : ''}${runs.APP_ROOT !== runs.REPO_ROOT ? ` app=${runs.APP_ROOT}` : ''} evidence=${path.relative(runs.REPO_ROOT, runs.evidenceDir(runId))}`);
            return;
        }
        if (run.status === 'failed') die(`Run failed to start: ${run.error}\nSee ${path.join(dir, 'daemon.log')} and backend.log`);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    die(`Run ${runId} not ready after 90s; see ${dir}/daemon.log. Run down with VERIFY_RUN_ID=${runId}.`);
}

async function down() {
    const run = currentRun();
    playersLib.stopAll(run);
    if (runs.isAlive(run.daemonPid)) {
        await send(run, 'shutdown').catch(() => {});
        const deadline = Date.now() + 20000;
        while (runs.isAlive(run.daemonPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 300));
        if (runs.isAlive(run.daemonPid)) process.kill(run.daemonPid, 'SIGKILL');
    }
    if (runs.isAlive(run.backendPid)) process.kill(run.backendPid, 'SIGKILL');
    const latest = runs.readRun(run.runId);
    if (latest.status !== 'down') runs.writeRun({ ...latest, status: 'down', stoppedAt: new Date().toISOString() });
    const ev = runs.evidenceDir(run.runId);
    const pngs = fs.existsSync(ev) ? execSync(`find "${ev}" -name '*.png' | wc -l`).toString().trim() : '0';
    console.log(`down: ${run.runId} stopped. Evidence kept: ${path.relative(runs.REPO_ROOT, ev)} (${pngs} screenshots, report.md, findings.json, steps.log, backend.log)`);
}

function list() {
    const all = runs.listRuns();
    if (!all.length) return console.log('no runs');
    for (const r of all) {
        const alive = runs.isAlive(r.daemonPid);
        console.log(`${r.runId} ${alive ? 'UP  ' : 'down'} web=${r.ports.web} ctl=${r.ports.ctl} email=${r.email ? 'on' : 'off'} git=${r.gitRev} ${r.repo === runs.REPO_ROOT ? '' : `(other checkout: ${r.repo})`}`);
    }
}

async function doctor() {
    const run = currentRun();
    let failed = false;
    const report = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
    report(runs.isAlive(run.daemonPid), `daemon pid ${run.daemonPid}`);
    report(runs.isAlive(run.backendPid), `backend pid ${run.backendPid} on 127.0.0.1:${run.ports.api}`);
    try {
        const health = await (await fetch(`http://127.0.0.1:${run.ports.web}/api/health`)).json();
        report(!!health.ok, `web ${run.ports.web} proxies /api/health -> ${JSON.stringify(health)}`);
    } catch (err) { report(false, `web proxy: ${err.message}`); }
    try {
        const html = await (await fetch(`http://127.0.0.1:${run.ports.web}/game.html`)).text();
        report(html.includes('Mortgage Backed'), 'web serves game.html from this checkout');
    } catch (err) { report(false, `web: ${err.message}`); }
    const status = await send(run, 'status');
    report(status.ok, `control API: ${status.text || status.error}`);
    const { rev, dirty } = gitRev();
    report(true, `git now ${rev}${dirty ? '-dirty' : ''}; run started at ${run.gitRev}${run.dirty ? '-dirty' : ''} (web files are served live; backend code needs a new run)`);
    report(true, `email ${run.email ? 'ON: Resend -> the AgentMail test inboxes' : 'off: OTP codes read from the dev DB, mail URL pinned to a dead port'}`);
    report(!run.dbPath.includes('/mnt/ssd/projects/'), `db ${run.dbPath}`);
    if (failed) process.exit(1);
}

function rotationNext() {
    const file = path.join(runs.DATA_ROOT, 'rotation.json');
    let i = 0;
    try { i = JSON.parse(fs.readFileSync(file, 'utf8')).next || 0; } catch {}
    fs.mkdirSync(runs.DATA_ROOT, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ next: (i + 1) % ROTATION.length }));
    return ROTATION[i % ROTATION.length];
}

async function play(flags) {
    const run = currentRun();
    let players = flags.players === undefined || flags.players === 'rotate' ? rotationNext() : Number(flags.players);
    if (flags.players === 'random') players = ROTATION[Math.floor(Math.random() * ROTATION.length)];
    const agentSeats = flags.agents ? parseSeats(flags.agents, players) : [];
    if (agentSeats.length) playersLib.checkCap(flags.shared ? 1 : agentSeats.length);
    const human = [...new Set([...String(flags.human || '').split(',').filter(Boolean).map(Number), ...agentSeats])].join(',');
    const table = await send(run, 'table', { players, emailSeats: flags.emailSeats ?? 3 });
    if (!table.ok) die(table.error);
    console.log(table.text);
    const started = await send(run, 'autoplay', { rounds: flags.rounds || 20, seed: flags.seed, human, shotEvery: flags.shotEvery, humanIdleMin: flags.humanIdleMin, maxMinutes: flags.maxMinutes, noEnd: flags.noEnd, chaos: flags.chaos, explore: flags.explore, stageRate: flags.stageRate });
    if (!started.ok) die(started.error);
    console.log(started.text);
    if (agentSeats.length) {
        await launchAgents(run, agentSeats, flags);
        console.log('Agents are playing. Follow with: status, agents-status. A game with agent seats takes roughly 1-2 min per agent turn; agents-status shows calls and cost.');
        return;
    }
    if (flags.detach || flags.human) {
        console.log(flags.human ? `Seat(s) ${flags.human} are yours: use wait/look/click. Autoplay plays the rest. Check progress with: status` : 'Detached. Check progress with: status');
        return;
    }
    await waitDone(run, Number(flags.timeout || 0));
}

function parseSeats(spec, count) {
    if (spec === true || spec === 'all') return Array.from({ length: count }, (_, i) => i + 1);
    const seats = String(spec).split(',').map(Number).filter(n => n >= 1 && n <= count);
    if (!seats.length) die(`--agents must be "all" or seat numbers 1-${count}`);
    return seats;
}

async function launchAgents(run, seatIndexes, flags) {
    const data = await send(run, 'seatsData');
    if (!data.ok) die(data.error);
    const seats = data.seats.filter(s => seatIndexes.includes(s.index));
    const personaList = flags.personas ? String(flags.personas).split(',') : null;
    const personas = Object.fromEntries(seats.map(s => [s.index, playersLib.personaFor(s.index, personaList)]));
    for (const seat of seats) await send(run, 'human', { seat: seat.index });
    const running = playersLib.checkCap(flags.shared ? 1 : seats.length);
    const cov = await send(run, 'coverageData');
    const missions = cov.ok ? playersLib.assignMissions(cov.pathways, seats, personas) : {};
    const launched = playersLib.launch({
        run, seats, personas, missions,
        rounds: data.rounds || flags.rounds || 20,
        model: flags.agentModel || playersLib.DEFAULT_MODEL,
        effort: flags.agentEffort,
        shared: !!flags.shared,
    });
    const latest = runs.readRun(run.runId);
    runs.writeRun({ ...latest, agents: [...(latest.agents || []), ...launched] });
    for (const a of launched) console.log(`agent ${a.name}: pid ${a.pid}, ${a.personas.join('+')}, ${a.model} (claude processes before launch: ${running})`);
}

async function agentsStatus() {
    const run = currentRun();
    const list = playersLib.status(run);
    if (!list.length) return console.log('no agents in this run');
    for (const a of list) {
        console.log(`${a.name} [${a.personas.join('+')}] ${a.state} · ${a.calls} tool calls${a.denied ? ` · ${a.denied} refused` : ''}${a.cost != null ? ` · $${Number(a.cost).toFixed(2)}` : ''}${a.minutes ? ` · ${a.minutes} min` : ''}${a.review ? ` · review: ${a.review}` : ''}${a.error ? ` · error: ${a.error.slice(0, 200)}` : ''}`);
    }
}

async function waitDone(run, timeoutSec) {
    const deadline = timeoutSec ? Date.now() + timeoutSec * 1000 : Infinity;
    let last = '';
    while (Date.now() < deadline) {
        const status = await send(run, 'status');
        if (status.text !== last) { console.log(status.text); last = status.text; }
        if (status.done) {
            const report = await send(run, 'report');
            console.log('\n' + report.text);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log('(still running; poll again with: status --wait <seconds>)');
}

// App journeys (lib/journeys.js): accounts, rooms, agents, hosting and more
// through the real UI. Blocks until done or --timeout seconds, like play.
async function journeys(flags) {
    if (flags.list) return console.log(require('./lib/journeys').list());
    const run = currentRun();
    const started = await send(run, 'journeys', { only: flags.only });
    if (!started.ok) die(started.error);
    console.log(started.text);
    if (flags.detach) return console.log('Detached. Follow with: journeys-status [--wait 590]');
    await waitJourneys(run, Number(flags.timeout || 590));
}

async function waitJourneys(run, timeoutSec) {
    const deadline = Date.now() + timeoutSec * 1000;
    let last = '';
    for (;;) {
        const status = await send(run, 'journeysStatus');
        if (!status.ok) die(status.error);
        const line = status.text.replace(/ · \d+s/, '');
        if (line !== last) { console.log(status.text); last = line; }
        if (status.done) {
            if (status.report) console.log('\n' + status.report);
            const report = await send(run, 'report');
            console.log(`\n${report.text.split('\n')[0]}`);
            return;
        }
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log('(still running; poll again with: journeys-status --wait <seconds>)');
}

async function forward(cmd, positional, flags) {
    const run = currentRun();
    const args = { ...flags };
    const [a, b, c] = positional;
    switch (cmd) {
        case 'click': Object.assign(args, { seat: a, target: b }); break;
        case 'fill': Object.assign(args, { seat: a, target: b, value: c ?? '' }); break;
        case 'select': Object.assign(args, { seat: a, target: b, option: c }); break;
        case 'check': Object.assign(args, { seat: a, target: b }); break;
        case 'press': Object.assign(args, { seat: a, key: b }); break;
        case 'tab': Object.assign(args, { seat: a, name: b }); break;
        case 'goto': Object.assign(args, { seat: a, path: b }); break;
        case 'shot': Object.assign(args, { seat: a, name: b }); break;
        case 'table': if (a) args.players = a; break;
        default: if (a !== undefined) args.seat = a;
    }
    if (cmd === 'status' && flags.wait) return waitDone(run, Number(flags.wait));
    const reply = await send(run, cmd, args);
    if (!reply.ok) die(`error: ${reply.error}`);
    console.log(reply.text);
}

function logs(positional) {
    const run = currentRun();
    const which = positional[0] || 'steps';
    const lines = Number(positional[1] || 60);
    const file = which === 'backend' ? path.join(runs.runDir(run.runId), 'backend.log')
        : which === 'daemon' ? path.join(runs.runDir(run.runId), 'daemon.log')
            : path.join(runs.evidenceDir(run.runId), 'steps.log');
    console.log(execSync(`tail -n ${lines} "${file}"`).toString());
}

const HELP = `verify-mortgage <command>
  up [--email] [--headed]      start a disposable backend + web + browser; prints export VERIFY_RUN_ID=...
  down | list | doctor | logs [steps|backend|daemon] [n]
  play [--players 2|5|8|rotate|random] [--rounds 20] [--explore [--stage-rate 0.35]] [--chaos 0.3] [--human 1] [--seed N] [--detach]
  table <players> [--email-seats 3]   build a table and start a game (no autoplay)
  autoplay [--rounds 20] [--chaos 0.3] [--human 1,3] [--seed N] [--shot-every 5] [--no-end]
  play ... --agents all|1,3 [--shared] [--personas newbie,trader,breaker,auditor] [--agent-model claude-haiku-5-5] [--agent-effort low]
  agents [all|1,3] [same agent flags]   start Haiku players on an existing table · agents-status
  coverage [--missing] [--all-runs]   pathways reached (this game, or every recorded game)
  journeys [--only id,group,...] [--list] [--timeout 590] [--detach]   app journeys outside the board (accounts, rooms, agents, hosting, ...)
  journeys-status [--wait SECONDS] · coverage --journeys
  stage <name>                        stage a situation now (three-doubles, in-jail, near-bankrupt, card:ch-7, ...)
  status [--wait SECONDS] | stop | report | findings [--severity high] | state | seats
  look <seat> [--full] | wait <seat> [--timeout 300] | human <seat> [--off]
  click <seat> <ref|"label"> [--dismiss] | fill <seat> <ref> <value> | select <seat> <ref> <option>
  check <seat> <ref> [--off] | press <seat> <key> | tab <seat> game|market|log|board | goto <seat> <path>
  shot <seat> [name] | note --title "..." [--seat N] [--severity low|medium|high] [--category ux] [--detail "..."]`;

(async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    const { positional, flags } = parse(rest);
    switch (cmd) {
        case 'up': return up(flags);
        case 'down': return down();
        case 'list': return list();
        case 'doctor': return doctor();
        case 'logs': return logs(positional);
        case 'play': return play(flags);
        case 'agents': {
            const run = currentRun();
            const data = await send(run, 'seatsData');
            if (!data.ok) die(data.error);
            return launchAgents(run, parseSeats(positional[0] || flags.seats || 'all', data.seats.length), flags);
        }
        case 'agents-status': return agentsStatus();
        case 'journeys': return journeys(flags);
        case 'journeys-status': return waitJourneys(currentRun(), Number(flags.wait || 0));
        case 'env': { const run = currentRun(); return console.log(`export VERIFY_RUN_ID=${run.runId}\nWEB_URL=http://127.0.0.1:${run.ports.web}\nTAILNET_URL=http://${TAILNET_IP}:${run.ports.web}\nDB_PATH=${run.dbPath}\nEVIDENCE=${runs.evidenceDir(run.runId)}`); }
        case undefined: case 'help': case '--help': return console.log(HELP);
        default: return forward(cmd, positional, flags);
    }
})().catch(err => die(err.stack || String(err)));
