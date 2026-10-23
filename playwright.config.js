// Main E2E suite. Run it through `npm run test:e2e` (scripts/run-e2e.js), which
// starts dev servers and sets BASE_URL; the defaults match its default ports.
const { devices } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3011';

module.exports = {
    testDir: './tests/e2e',
    testIgnore: ['real-player-flow.spec.js'],
    timeout: 30000,
    retries: 0,
    use: {
        baseURL,
        headless: true,
        viewport: { width: 1280, height: 720 },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
};
