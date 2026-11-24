#!/usr/bin/env node
'use strict';

// Starts a private dev backend and web server for one UX reviewer, on its own
// ports and its own SQLite file, with throwaway push keys and no rate limits.
//
//   node .agents/skills/ux-review/scripts/servers.js --web 3021 --api 3121 --db <scratch>/ux.db
//
// Runs in the foreground until SIGINT/SIGTERM. Run it in the background and
// stop it when done. Refuses production and other services' ports.

const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '../../../..');
const RESERVED = new Set([80, 3000, 3001, 3002, 3010, 8080, 8081]);

function arg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? process.argv[index + 1] : undefined;
}

const web = Number(arg('web'));
const api = Number(arg('api'));
const db = arg('db');
if (!web || !api || !db) {
    console.error('Usage: servers.js --web <port> --api <port> --db <scratch sqlite path>');
    process.exit(2);
}
if (RESERVED.has(web) || RESERVED.has(api)) {
    console.error(`Ports ${[...RESERVED].join(', ')} belong to production or other services.`);
    process.exit(2);
}
if (db.includes('/mnt/ssd/projects/') || path.basename(db) === 'game.db' && db.includes('mortgage-backed/backend')) {
    console.error('Refusing a production-looking database path.');
    process.exit(2);
}

const { createStaticProxyServer } = require(path.join(REPO, 'scripts/dev-server'));
const webpush = require(path.join(REPO, 'backend/node_modules/web-push'));
const keys = webpush.generateVAPIDKeys();

const backend = spawn('node', ['server.js'], {
    cwd: path.join(REPO, 'backend'),
    stdio: 'inherit',
    env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(api),
        HOST: '127.0.0.1',
        DB_PATH: path.resolve(db),
        JWT_SECRET: 'ux-review-dev-secret',
        CORS_ORIGINS: '*',
        ALLOW_STATE_REPAIR: 'true',
        RATE_LIMIT_ENABLED: 'false',
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: 'mailto:ux-review@example.test',
        USESEND_URL: 'http://127.0.0.1:9/no-mail',
    },
});

const server = createStaticProxyServer({ root: REPO, backendOrigin: `http://127.0.0.1:${api}`, noStore: true });
server.listen(web, '127.0.0.1', () => console.log(`ux-review: web http://127.0.0.1:${web} -> api ${api}, db ${db}`));

function stop() {
    backend.kill();
    server.close();
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
backend.on('exit', code => {
    console.error(`backend exited (${code})`);
    server.close();
    process.exit(code || 1);
});
