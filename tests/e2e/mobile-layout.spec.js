// @ts-check
// Guards the mobile-first layout from documents/design-system.md: nothing scrolls sideways on
// small phones, the turn's next move sits in the dock above the tab bar, host controls stay out
// of the dock, and dialogs open as bottom sheets.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

const PHONES = [
    { name: 'small phone', viewport: { width: 320, height: 640 } },
    { name: 'iPhone SE', viewport: { width: 375, height: 667 } },
    { name: 'iPhone 13', viewport: { width: 390, height: 844 } },
];

async function setupGame(request) {
    const users = [];
    for (const name of ['Alice', 'Bob']) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: 'A room name long enough to need truncating on a phone', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users[1].token}` },
        data: { player_name: 'Bob' },
    });
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: users.map(user => playerState(user.user.id, user.name)),
                properties: [],
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, game, alice: users[0], bob: users[1] };
}

async function openGameAs(browser, viewport, room, user) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.turn-ticket')).toBeVisible();
    return { context, page };
}

async function horizontalOverflow(page) {
    return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const phone of PHONES) {
    test.describe(`Mobile layout on a ${phone.name}`, () => {
        test('no screen scrolls sideways', async ({ browser, request }) => {
            const { room, alice } = await setupGame(request);
            const { context, page } = await openGameAs(browser, phone.viewport, room, alice);
            for (const section of ['game', 'market', 'log', 'board']) {
                await page.click(`.nav-tab[data-section="${section}"]`);
                await expect(page.locator(`#${section}.section.active`)).toBeVisible();
                expect(await horizontalOverflow(page), `${section} tab overflows`).toBeLessThanOrEqual(0);
            }
            for (const path of ['index.html', 'auth.html', 'hotseat.html', 'lobby.html', `waiting.html?code=${room.invite_code}`]) {
                // A player in the room goes straight back in; the join form is for everyone else.
                if (path.startsWith('waiting.html')) await page.evaluate(() => localStorage.removeItem('auth_token'));
                await page.goto(`${BASE}/${path}`);
                await page.waitForLoadState('domcontentloaded');
                expect(await horizontalOverflow(page), `${path} overflows`).toBeLessThanOrEqual(0);
            }
            await context.close();
        });

        test('the next move is in reach above the tab bar, host controls are not', async ({ browser, request }) => {
            const { room, alice } = await setupGame(request);
            const { context, page } = await openGameAs(browser, phone.viewport, room, alice);

            const tabBar = await page.locator('.nav-tabs').boundingBox();
            expect(tabBar).not.toBeNull();
            expect(Math.round(tabBar.y + tabBar.height)).toBe(phone.viewport.height);

            const roll = page.locator('.turn-dock [data-game-action="roll-dice"]');
            await expect(roll).toBeInViewport();
            const rollBox = await roll.boundingBox();
            expect(rollBox.y + rollBox.height).toBeLessThanOrEqual(tabBar.y);
            expect(rollBox.height).toBeGreaterThanOrEqual(44);

            await expect(page.locator('.turn-dock .action-btn-end-turn')).toBeDisabled();
            await expect(page.locator('.turn-dock [data-game-action="host-end"]')).toHaveCount(0);
            await expect(page.locator('.host-panel [data-game-action="host-end"]')).toHaveCount(1);
            await context.close();
        });
    });
}

test('players waiting for their turn see no dock, and the Game tab shows the turn dot only on their turn', async ({ browser, request }) => {
    const { room, bob } = await setupGame(request);
    const { context, page } = await openGameAs(browser, PHONES[2].viewport, room, bob);
    await expect(page.locator('.turn-dock')).toHaveCount(0);
    await expect(page.locator('.waiting-indicator')).toBeVisible();
    await expect(page.locator('.nav-tab[data-section="game"] .tab-dot')).toHaveCount(0);
    await context.close();
});

test('dialogs open as bottom sheets on phones', async ({ browser, request }) => {
    const { room, alice } = await setupGame(request);
    const { context, page } = await openGameAs(browser, PHONES[2].viewport, room, alice);
    await page.click('#game [data-game-action="open-debt"]');
    const sheet = page.locator('#debtModal .modal-content');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300); // let the slide-up finish
    const box = await sheet.boundingBox();
    expect(Math.round(box.y + box.height)).toBe(PHONES[2].viewport.height);
    expect(Math.round(box.width)).toBe(PHONES[2].viewport.width);
    await context.close();
});
