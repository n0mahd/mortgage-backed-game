'use strict';

// Shared harness for the browser E2E runners (run-e2e.js, run-real-game-e2e.js).
// It wipes a dev-only SQLite file, starts the backend and the static/proxy web
// server on dev-only ports, runs Playwright against them, and stops both.
//
// Flags (anything else is passed through to `npx playwright test`):
//   --web-port <n>        static web server port   (env E2E_WEB_PORT, default 3011)
//   --api-port <n>        backend port             (env E2E_API_PORT, default 3111)
//   --db-path <file>      SQLite file              (env E2E_DB_PATH, default under DEV_DATA_DIR)
//   --keep-db             reuse the existing DB    (env E2E_KEEP_DB=1)
//   --allow-production    skip the production-target refusal (env E2E_ALLOW_PRODUCTION=1)
// KEEP_E2E_SERVERS=1 leaves both servers running after Playwright finishes.
// Playwright gets BASE_URL and API_BASE_URL pointing at the dev servers.

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { createStaticProxyServer } = require('./dev-server');

const ROOT = path.resolve(__dirname, '..');
const DEV_DATA_DIR = '/mnt/ssd/dev-data/mortgage-backed';

/**
 * @param {object} config
 * @param {string} config.name            label for log lines, e.g. 'E2E'
 * @param {string} config.dbFile          default DB file name inside DEV_DATA_DIR
 * @param {string} config.jwtSecret       default JWT_SECRET for the backend
 * @param {object} [config.backendEnv]    extra backend environment
 * @param {string[]} [config.playwrightArgs] args placed before the caller's own
 * @param {(dbPath: string) => object} [config.playwrightEnv] extra Playwright environment
 */
function runE2E(config) {
    const { options, playwrightArgs } = parseArgs(process.argv.slice(2));
    const webPort = Number(options.webPort || process.env.E2E_WEB_PORT || 3011);
    const apiPort = Number(options.apiPort || process.env.E2E_API_PORT || 3111);
    const dbPath = path.resolve(options.dbPath || process.env.E2E_DB_PATH || path.join(DEV_DATA_DIR, config.dbFile));
    const baseURL = `http://127.0.0.1:${webPort}`;
    const apiURL = `http://127.0.0.1:${apiPort}/api`;

    refuseProductionTargets({
        name: config.name,
        webPort,
        apiPort,
        dbPath,
        allowProduction: options.allowProduction || process.env.E2E_ALLOW_PRODUCTION === '1',
    });

    let backend = null;
    let webServer = null;

    async function main() {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (!options.keepDb && process.env.E2E_KEEP_DB !== '1') {
            for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
        }

        await assertPortFree(webPort, 'web');
        await assertPortFree(apiPort, 'api');
        backend = startBackend({ apiPort, dbPath, config });
        await waitForHealth(apiPort);
        webServer = await startWebServer({ webPort, apiPort });

        console.log(`${config.name} dev web: ${baseURL}`);
        console.log(`${config.name} dev API: ${apiURL}`);
        console.log(`${config.name} DB: ${dbPath}`);

        return runPlaywright([...(config.playwrightArgs || []), ...playwrightArgs], {
            BASE_URL: baseURL,
            API_BASE_URL: apiURL,
            ...(config.playwrightEnv ? config.playwrightEnv(dbPath) : {}),
        });
    }

    main().then(code => {
        process.exitCode = code;
    }, err => {
        console.error(err && err.stack ? err.stack : err);
        process.exitCode = 1;
    }).finally(async () => {
        if (process.env.KEEP_E2E_SERVERS === '1') {
            console.log(`Keeping dev servers alive: ${baseURL}, API ${apiURL}`);
            return;
        }
        await stopServers(webServer, backend);
    });
}

function parseArgs(argv) {
    const options = {};
    const playwrightArgs = [];
    const valueFlags = { '--web-port': 'webPort', '--api-port': 'apiPort', '--db-path': 'dbPath' };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (valueFlags[arg]) {
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
            options[valueFlags[arg]] = next;
            i += 1;
        } else if (arg === '--keep-db') options.keepDb = true;
        else if (arg === '--allow-production') options.allowProduction = true;
        else playwrightArgs.push(arg);
    }

    return { options, playwrightArgs };
}

function refuseProductionTargets({ name, webPort, apiPort, dbPath, allowProduction }) {
    const productionMarkers = [
        webPort === 80,
        apiPort === 3010,
        dbPath.includes('/backend/game.db'),
        dbPath.includes('/mnt/ssd/projects/mortgage-backed/backend/game.db'),
    ];

    if (!allowProduction && productionMarkers.some(Boolean)) {
        console.error(`Refusing to run ${name} against production-looking ports or data paths.`);
        console.error(`Use dev ports 3011/3111 and a DB under ${DEV_DATA_DIR}.`);
        process.exit(2);
    }
}

// Turn alerts need a VAPID key pair. Tests get a throwaway pair unless the
// caller set one, so they don't depend on a backend/.env being present.
function testVapidKeys() {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return {};
    const webpush = require(path.join(ROOT, 'backend', 'node_modules', 'web-push'));
    const keys = webpush.generateVAPIDKeys();
    return { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:e2e@example.test' };
}

function startBackend({ apiPort, dbPath, config }) {
    const backend = spawn('node', ['server.js'], {
        cwd: path.join(ROOT, 'backend'),
        env: {
            ...process.env,
            PORT: String(apiPort),
            DB_PATH: dbPath,
            JWT_SECRET: process.env.JWT_SECRET || config.jwtSecret,
            CORS_ORIGINS: '*',
            USESEND_URL: process.env.USESEND_URL || 'http://127.0.0.1:3001/api/v1/emails',
            ALLOW_STATE_REPAIR: 'true',
            ...testVapidKeys(),
            ...(config.backendEnv || {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    prefixOutput(backend.stdout, '[backend] ');
    prefixOutput(backend.stderr, '[backend] ');
    backend.on('exit', (code, signal) => {
        if (code !== null && code !== 0) console.error(`[backend] exited with ${code}`);
        if (signal) console.error(`[backend] exited by ${signal}`);
    });
    return backend;
}

function startWebServer({ webPort, apiPort }) {
    const server = createStaticProxyServer({
        root: ROOT,
        backendOrigin: `http://127.0.0.1:${apiPort}`,
        noStore: true,
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(webPort, '0.0.0.0', () => resolve(server));
    });
}

function runPlaywright(args, env) {
    return new Promise(resolve => {
        const child = spawn('npx', ['playwright', 'test', ...args], {
            cwd: ROOT,
            env: { ...process.env, ...env },
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

async function stopServers(webServer, backend) {
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

module.exports = { runE2E };
