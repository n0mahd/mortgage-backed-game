// @ts-check
// Number boxes change only when you type in them: scrolling over a focused box
// scrolls the page, and the arrow keys and spin buttons don't nudge the value.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

async function openMarket(browser, request) {
    const alex = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const sam = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${alex.token}` },
        data: { name: 'Number boxes', player_name: 'Alex', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${sam.token}` },
        data: { player_name: 'Sam' },
    });
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alex.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [playerState(alex.user.id, 'Alex'), playerState(sam.user.id, 'Sam')],
                properties: [],
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    // A short desktop window, so the Market page has room to scroll.
    const context = await browser.newContext({ viewport: { width: 1024, height: 500 } });
    const page = await context.newPage();
    await loginPage(page, alex.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    await page.click('.nav-tab[data-section="market"]');
    return { context, page };
}

test('scrolling over a focused number box scrolls the page and keeps the value', async ({ browser, request }) => {
    const { context, page } = await openMarket(browser, request);
    const cash = page.locator('#player1Cash');
    // Chromium steps a focused number box on the wheel once the box has a wheel
    // listener (Safari does it regardless), so give it one to reproduce that.
    await cash.evaluate(input => input.addEventListener('wheel', () => {}));
    await cash.fill('50');
    await cash.scrollIntoViewIfNeeded();
    const box = await cash.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(0, -100);
    await expect(cash).toHaveValue('50');
    await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(scrollBefore);
    await context.close();
});

test('arrow keys do not step a number box; typing still works', async ({ browser, request }) => {
    const { context, page } = await openMarket(browser, request);
    const cash = page.locator('#player1Cash');
    await cash.fill('50');
    await cash.press('ArrowUp');
    await cash.press('ArrowUp');
    await cash.press('ArrowDown');
    await expect(cash).toHaveValue('50');
    await cash.fill('');
    await cash.type('125');
    await expect(cash).toHaveValue('125');
    await context.close();
});
