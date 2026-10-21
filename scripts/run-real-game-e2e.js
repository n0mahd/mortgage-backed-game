#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { createStaticProxyServer } = require('./dev-server');

const ROOT = path.resolve(__dirname, '..');
const DEV_DATA_DIR = '/mnt/ssd/dev-data/mortgage-backed';
const DEFAULT_DB_PATH = path.join(DEV_DATA_DIR, 'real-game-e2e.db');
const args = parseArgs(process.argv.slice(2));

const webPort = Number(args.webPort || process.env.E2E_WEB_PORT || 3011);
const apiPort = Number(args.apiPort || process.env.E2E_API_PORT || 3111);
const dbPath = path.resolve(args.dbPath || process.env.E2E_DB_PATH || DEFAULT_DB_PATH);
const baseURL = `http://127.0.0.1:${webPort}`;
const allowProduction = args.allowProduction || process.env.E2E_ALLOW_PRODUCTION === '1';

const productionMarkers = [
    webPort === 80,
    apiPort === 3010,
    dbPath.includes('/backend/game.db'),
    dbPath.includes('/mnt/ssd/projects/mortgage-backed/backend/game.db'),
];

if (!allowProduction && productionMarkers.some(Boolean)) {
    console.error('Refusing to run real-game E2E against production-looking ports or data paths.');
    console.error('Use dev ports 3011/3111 and a DB under /mnt/ssd/dev-data/mortgage-backed.');
    process.exit(2);
}

let backend = null;
let webServer = null;

main().catch(async (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
}).finally(async () => {
    if (process.env.KEEP_E2E_SERVERS === '1') {
        console.log(`Keeping dev servers alive: ${baseURL}, API proxy -> ${apiPort}`);
        return;
    }
    await cleanup();
});

async function main() {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (!args.keepDb && process.env.E2E_KEEP_DB !== '1') {
        for (const suffix of ['', '-shm', '-wal']) {
            try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
        }
    }

    await assertPortFree(webPort, 'web');
    await assertPortFree(apiPort, 'api');

    backend = spawn('node', ['server.js'], {
        cwd: path.join(ROOT, 'backend'),
        env: {
            ...process.env,
            PORT: String(apiPort),
            DB_PATH: dbPath,
            JWT_SECRET: process.env.JWT_SECRET || 'real-game-e2e-secret',
            CORS_ORIGINS: '*',
            USESEND_URL: process.env.USESEND_URL || 'http://127.0.0.1:3001/api/v1/emails',
            ALLOW_STATE_REPAIR: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    prefixOutput(backend.stdout, '[backend] ');
    prefixOutput(backend.stderr, '[backend] ');
    backend.on('exit', (code, signal) => {
        if (code !== null && code !== 0) console.error(`[backend] exited with ${code}`);
        if (signal) console.error(`[backend] exited by ${signal}`);
    });

    await waitForHealth(apiPort);
    webServer = createStaticProxyServer({
        root: ROOT,
        backendOrigin: `http://127.0.0.1:${apiPort}`,
        noStore: true,
    });
    await new Promise((resolve, reject) => {
        webServer.on('error', reject);
        webServer.listen(webPort, '0.0.0.0', resolve);
    });

    console.log(`Real-player E2E dev web: ${baseURL}`);
    console.log(`Real-player E2E dev API: http://127.0.0.1:${apiPort}/api`);
    console.log(`Real-player E2E DB: ${dbPath}`);

    const result = await runPlaywright();
    process.exitCode = result;
}

function runPlaywright() {
    return new Promise((resolve) => {
        const child = spawn('npx', [
            'playwright',
            'test',
            '--config',
            'playwright.real-game.config.js',
            '--reporter=line',
        ], {
            cwd: ROOT,
            env: {
                ...process.env,
                PLAYWRIGHT_BASE_URL: baseURL,
                PLAYWRIGHT_DB_PATH: dbPath,
            },
            stdio: 'inherit',
        });
        child.on('exit', (code) => resolve(code || 0));
    });
}

async function waitForHealth(port) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const ok = await httpGetJson(`http://127.0.0.1:${port}/api/health`);
            if (ok && ok.ok) return;
        } catch {}
        await delay(250);
    }
    throw new Error(`Backend on ${port} did not become healthy in time.`);
}

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
            });
        }).on('error', reject);
    });
}

function assertPortFree(port, label) {
    return new Promise((resolve, reject) => {
        const tester = net.createServer()
            .once('error', () => reject(new Error(`Dev ${label} port ${port} is already in use.`)))
            .once('listening', () => tester.close(resolve))
            .listen(port, '0.0.0.0');
    });
}

function prefixOutput(stream, prefix) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        for (const line of chunk.split(/\r?\n/)) {
            if (line.trim()) console.log(prefix + line);
        }
    });
}

async function cleanup() {
    if (webServer) {
        await new Promise(resolve => webServer.close(resolve));
    }
    if (backend && backend.exitCode === null) {
        backend.kill('SIGTERM');
        await new Promise(resolve => {
            const timer = setTimeout(() => {
                backend.kill('SIGKILL');
                resolve();
            }, 2500);
            backend.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
}

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = true;
        } else {
            parsed[key] = next;
            i++;
        }
    }
    return parsed;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
