#!/usr/bin/env node
'use strict';

// One full real-player game (playwright.real-game.config.js) against throwaway dev
// servers, with the backend's rate limits left on. Flags and environment: see
// scripts/e2e-harness.js.
const { runE2E } = require('./e2e-harness');

runE2E({
    name: 'Real-player E2E',
    dbFile: 'real-game-e2e.db',
    jwtSecret: 'real-game-e2e-secret',
    playwrightArgs: ['--config', 'playwright.real-game.config.js', '--reporter=line'],
    // The spec reads dev sign-in codes straight from the database.
    playwrightEnv: dbPath => ({ PLAYWRIGHT_DB_PATH: dbPath }),
});
