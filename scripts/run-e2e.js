#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { createStaticProxyServer } = require('./devServer');

const ROOT = path.resolve(__dirname, '..');
const DEV_DATA_DIR = '/mnt/ssd/dev-data/mortgage-backed';
const DEFAULT_DB_PATH = path.join(DEV_DATA_DIR, 'playwright-e2e.db');
const { options, playwrightArgs } = parseArgs(process.argv.slice(2));

const webPort = Number(options.webPort || process.env.E2E_WEB_PORT || 3011);
const apiPort = Number(options.apiPort || process.env.E2E_API_PORT || 3111);
const dbPath = path.resolve(options.dbPath || process.env.E2E_DB_PATH || DEFAULT_DB_PATH);
const baseURL = `http://127.0.0.1:${webPort}`;
const apiURL = `http://127.0.0.1:${apiPort}/api`;
const allowProduction = options.allowProduction || process.env.E2E_ALLOW_PRODUCTION === '1';

refuseProductionTargets();

let backend = null;
let webServer = null;

main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
}).finally(async () => {
    await cleanup();
});

async function main() {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (!options.keepDb && process.env.E2E_KEEP_DB !== '1') {
        for (const suffix of ['', '-shm', '-wal']) {
            try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
        }
    }

    await assertPortFree(webPort, 'web');
    await assertPortFree(apiPort, 'api');
    await startBackend();
    await startWebServer();

    console.log(`E2E dev web: ${baseURL}`);
    console.log(`E2E dev API: ${apiURL}`);
    console.log(`E2E DB: ${dbPath}`);

    process.exitCode = await runPlaywright();
}

function startBackend() {
    backend = spawn('node', ['server.js'], {
        cwd: path.join(ROOT, 'backend'),
        env: {
            ...process.env,
            PORT: String(apiPort),
            DB_PATH: dbPath,
            JWT_SECRET: process.env.JWT_SECRET || 'playwright-e2e-secret',
            CORS_ORIGINS: '*',
            RATE_LIMIT_ENABLED: 'false',
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

    return waitForHealth(apiPort);
}

function startWebServer() {
    webServer = createStaticProxyServer({
        root: ROOT,
        backendOrigin: `http://127.0.0.1:${apiPort}`,
        noStore: true,
    });

    return new Promise((resolve, reject) => {
        webServer.on('error', reject);
        webServer.listen(webPort, '0.0.0.0', resolve);
    });
}

function runPlaywright() {
    return new Promise(resolve => {
        const child = spawn('npx', ['playwright', 'test', ...playwrightArgs], {
            cwd: ROOT,
            env: {
                ...process.env,
                BASE_URL: baseURL,
                API_BASE_URL: apiURL,
            },
            stdio: 'inherit',
        });
        child.on('exit', code => resolve(code || 0));
    });
}

async function waitForHealth(port) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const health = await httpGetJson(`http://127.0.0.1:${port}/api/health`);
            if (health && health.ok) return;
        } catch {}
        await delay(250);
    }
    throw new Error(`Backend on ${port} did not become healthy in time.`);
}

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
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

function refuseProductionTargets() {
    const productionMarkers = [
        webPort === 80,
        apiPort === 3010,
        dbPath.includes('/backend/game.db'),
        dbPath.includes('/mnt/ssd/projects/mortgage-backed/backend/game.db'),
    ];

    if (!allowProduction && productionMarkers.some(Boolean)) {
        console.error('Refusing to run E2E against production-looking ports or data paths.');
        console.error('Use dev ports 3011/3111 and a DB under /mnt/ssd/dev-data/mortgage-backed.');
        process.exit(2);
    }
}

function parseArgs(argv) {
    const options = {};
    const playwrightArgs = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        const readValue = key => {
            if (!next || next.startsWith('--')) {
                throw new Error(`${arg} requires a value`);
            }
            options[key] = next;
            i += 1;
        };

        if (arg === '--web-port') readValue('webPort');
        else if (arg === '--api-port') readValue('apiPort');
        else if (arg === '--db-path') readValue('dbPath');
        else if (arg === '--keep-db') options.keepDb = true;
        else if (arg === '--allow-production') options.allowProduction = true;
        else playwrightArgs.push(arg);
    }

    return { options, playwrightArgs };
}

function prefixOutput(stream, prefix) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        for (const line of chunk.split(/\r?\n/)) {
            if (line.trim()) console.log(prefix + line);
        }
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
