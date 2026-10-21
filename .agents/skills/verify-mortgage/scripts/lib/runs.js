'use strict';

// Run bookkeeping shared by the CLI and the run daemon: where a run keeps its
// DB and logs, where evidence goes, and how ports are chosen.

const fs = require('fs');
const net = require('net');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');
// The checkout under test. Defaults to the one holding this skill; VERIFY_APP_ROOT
// points a run at another worktree (a fix branch, the redesign) with this harness.
const APP_ROOT = path.resolve(process.env.VERIFY_APP_ROOT || REPO_ROOT);
const DATA_ROOT = process.env.VERIFY_DATA_ROOT || '/mnt/ssd/dev-data/mortgage-backed/verify';
// Not under test-results/: Playwright empties that folder at the start of every run.
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'test-output', 'verify-mortgage');

// Production and shared ports on this Pi that a run must never bind.
const FORBIDDEN_PORTS = new Set([80, 443, 3000, 3001, 3002, 3010, 3011, 3111, 8080, 8081]);
const DEFAULT_PORTS = { web: 3411, api: 3511, ctl: 3611 };

function runDir(runId) {
    return path.join(DATA_ROOT, runId);
}

function evidenceDir(runId) {
    return path.join(EVIDENCE_ROOT, runId);
}

function readRun(runId) {
    try {
        return JSON.parse(fs.readFileSync(path.join(runDir(runId), 'run.json'), 'utf8'));
    } catch {
        return null;
    }
}

function writeRun(run) {
    fs.mkdirSync(runDir(run.runId), { recursive: true });
    const file = path.join(runDir(run.runId), 'run.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(run, null, 2));
    fs.renameSync(file + '.tmp', file);
}

function listRuns() {
    let ids = [];
    try { ids = fs.readdirSync(DATA_ROOT); } catch { return []; }
    return ids.map(readRun).filter(Boolean).sort((a, b) => a.runId.localeCompare(b.runId));
}

function isAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}

function portFree(port) {
    return new Promise(resolve => {
        const tester = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => tester.close(() => resolve(true)))
            .listen(port, '0.0.0.0');
    });
}

// Finds web/api/ctl ports that are all free, stepping by one from the defaults.
async function pickPorts() {
    const pinned = {
        web: Number(process.env.VERIFY_WEB_PORT || 0),
        api: Number(process.env.VERIFY_API_PORT || 0),
        ctl: Number(process.env.VERIFY_CTL_PORT || 0),
    };
    const claimed = new Set(listRuns().filter(run => isAlive(run.daemonPid)).flatMap(run => Object.values(run.ports || {})));
    for (let offset = 0; offset < 50; offset++) {
        const ports = {
            web: pinned.web || DEFAULT_PORTS.web + offset,
            api: pinned.api || DEFAULT_PORTS.api + offset,
            ctl: pinned.ctl || DEFAULT_PORTS.ctl + offset,
        };
        const values = Object.values(ports);
        if (values.some(port => FORBIDDEN_PORTS.has(port))) {
            throw new Error(`Refusing forbidden port in ${JSON.stringify(ports)} (production or shared).`);
        }
        if (values.some(port => claimed.has(port))) continue;
        const free = await Promise.all(values.map(portFree));
        if (free.every(Boolean)) return ports;
        if (pinned.web && pinned.api && pinned.ctl) break;
    }
    throw new Error('No free port set found for web/api/ctl.');
}

function newRunId() {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    return `${stamp}-${process.pid}`;
}

module.exports = {
    SKILL_DIR,
    REPO_ROOT,
    APP_ROOT,
    DATA_ROOT,
    EVIDENCE_ROOT,
    FORBIDDEN_PORTS,
    runDir,
    evidenceDir,
    readRun,
    writeRun,
    listRuns,
    isAlive,
    pickPorts,
    newRunId,
};
