// The real-player game: the main config, narrowed to real-player-flow.spec.js with
// longer timeouts, one worker and failure traces. Run it through
// `npm run test:e2e:real-game` (scripts/run-real-game-e2e.js).
// PLAYWRIGHT_HEADLESS=0 shows the browser.
const base = require('./playwright.config');

module.exports = {
    ...base,
    testIgnore: [],
    testMatch: ['real-player-flow.spec.js'],
    timeout: 180000,
    workers: 1,
    use: {
        ...base.use,
        headless: process.env.PLAYWRIGHT_HEADLESS !== '0',
        actionTimeout: 10000,
        navigationTimeout: 15000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
};
