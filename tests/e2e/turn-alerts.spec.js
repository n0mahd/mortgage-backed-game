// @ts-check
// Turn alerts (push notifications) and the iPhone Home Screen handoff.
// Real push delivery needs a real browser push service, so it's covered by the
// backend integration test (tests/push); these check what players see.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';

async function setupGame(request) {
    const alice = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const bob = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: { name: 'Alerts Room', player_name: 'Alice', max_players: 2 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${bob.token}` },
        data: { player_name: 'Bob' },
    });
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [playerState(alice.user.id, 'Alice'), playerState(bob.user.id, 'Bob')],
                properties: [], corporations: [], lastDiceRoll: null, lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, alice };
}

async function iphone(browser, { standalone = false } = {}) {
    const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    if (standalone) {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
        });
    }
    return context;
}

async function signedInGame(context, room, token) {
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(t => localStorage.setItem('auth_token', t), token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    return page;
}

test.describe('Turn alerts', () => {
    test('the app manifest and service worker are served', async ({ request }) => {
        const manifest = await request.get(`${BASE}/manifest.webmanifest`);
        expect(manifest.ok()).toBeTruthy();
        expect((await manifest.json()).display).toBe('standalone');
        const sw = await request.get(`${BASE}/sw.js`);
        expect(sw.ok()).toBeTruthy();
        expect(await sw.text()).toContain("addEventListener('push'");
    });

    test('iPhone Safari explains Home Screen install and hands the session to the app', async ({ browser }) => {
        const { room, alice } = await (async () => setupGame(await (await browser.newContext()).request))();
        const safari = await iphone(browser);
        const page = await signedInGame(safari, room, alice.token);

        await page.click('#turn-alerts-btn');
        await expect(page.locator('#turnAlertsBody')).toContainText('Home Screen');
        await page.getByRole('button', { name: 'Get ready to install' }).click();
        await expect(page).toHaveURL(/install\.html\?code=[A-Z2-9]{8}$/);
        await expect(page.locator('#install-steps')).toBeVisible();
        await expect(page.locator('#install-steps')).toContainText('Add to Home Screen');
        const code = new URL(page.url()).searchParams.get('code');

        // First launch of the Home Screen app: separate storage, signed out.
        const app = await iphone(browser, { standalone: true });
        const launched = await app.newPage();
        await launched.goto(`${BASE}/install.html?code=${code}`);
        await expect(launched).toHaveURL(new RegExp(`game\\.html\\?room=${room.id}`), { timeout: 10000 });
        await expect(launched.locator('.player-card.current-user')).toContainText('Alice');

        // Later launches reuse the same start address; the spent code is skipped.
        await launched.goto(`${BASE}/install.html?code=${code}`);
        await expect(launched).toHaveURL(new RegExp(`game\\.html\\?room=${room.id}`), { timeout: 10000 });

        // Inside the app, alerts can be turned on (not "install first" again).
        await launched.click('#turn-alerts-btn');
        await expect(launched.locator('#turnAlertsBody')).not.toContainText('Home Screen');
        await safari.close();
        await app.close();
    });

    test('Safari itself never spends the install code', async ({ browser, request }) => {
        const { room, alice } = await setupGame(request);
        const safari = await iphone(browser);
        const page = await signedInGame(safari, room, alice.token);
        await page.click('#turn-alerts-btn');
        await page.getByRole('button', { name: 'Get ready to install' }).click();
        await expect(page.locator('#install-steps')).toBeVisible();
        const code = new URL(page.url()).searchParams.get('code');

        const redeemed = await request.post(`${BASE_API}/auth/redeem-transfer`, { data: { code } });
        expect(redeemed.ok()).toBeTruthy();
        await safari.close();
    });

    test('an expired install link in the app explains what to do', async ({ browser }) => {
        const app = await iphone(browser, { standalone: true });
        const page = await app.newPage();
        await page.goto(`${BASE}/install.html?code=ZZZZ2222`);
        await expect(page.locator('#install-error')).toContainText('expired');
        await expect(page.locator('#install-fallback')).toBeVisible();
        await app.close();
    });

    test('desktop browsers explain blocked notifications', async ({ browser, request }) => {
        const { room, alice } = await setupGame(request);
        const context = await browser.newContext();
        const page = await signedInGame(context, room, alice.token);
        // Headless Chromium reports notifications as blocked.
        await page.click('#turn-alerts-btn');
        await expect(page.locator('#turnAlertsBody')).toContainText('blocked');
        await context.close();
    });

    test('desktop browsers offer to turn alerts on, and the modal closes', async ({ browser, request }) => {
        const { room, alice } = await setupGame(request);
        const context = await browser.newContext();
        // Not asked yet, as in a normal desktop browser.
        await context.addInitScript(() => {
            Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
        });
        const page = await signedInGame(context, room, alice.token);
        await page.click('#turn-alerts-btn');
        await expect(page.getByRole('button', { name: 'Turn on alerts' })).toBeVisible();
        await page.getByRole('button', { name: 'Done' }).click();
        await expect(page.locator('#turnAlertsModal')).not.toHaveClass(/active/);
        await context.close();
    });
});
