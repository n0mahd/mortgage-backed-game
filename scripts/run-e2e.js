#!/usr/bin/env node
'use strict';

// Main browser E2E suite (playwright.config.js) against throwaway dev servers.
// Flags and environment: see scripts/e2e-harness.js.
const { runE2E } = require('./e2e-harness');

runE2E({
    name: 'E2E',
    dbFile: 'playwright-e2e.db',
    jwtSecret: 'playwright-e2e-secret',
    // The suite signs up many users and rooms from one IP in seconds.
    backendEnv: { RATE_LIMIT_ENABLED: 'false' },
});
