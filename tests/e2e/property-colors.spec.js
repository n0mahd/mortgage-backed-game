// @ts-check
// Property lists show each property's board color, so groups read at a glance.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

const OWNED = [
    { id: 'prop-8', name: 'Virginia Avenue', color: 'Pink', price: 160, rent: [12, 60, 180, 500, 700, 900] },
    { id: 'prop-10', name: 'St. James Place', color: 'Orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
    { id: 'prop-13', name: 'Kentucky Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
];

test('the IPO picker shows each property in its board color', async ({ browser, request }) => {
    const alice = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const bob = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: { name: 'Color Room', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${bob.token}` },
        data: { player_name: 'Bob' },
    });
    const properties = OWNED.map(p => ({ ...p, ownerId: alice.user.id, ownerName: 'Alice', houses: 0 }));
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(alice.user.id, 'Alice', { properties: OWNED.map(p => p.id) }),
                    playerState(bob.user.id, 'Bob'),
                ],
                properties,
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, alice.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();

    await page.evaluate(() => window.openIPOModal());
    const ipoDots = page.locator('#ipoAssets .property-dot');
    await expect(ipoDots).toHaveCount(OWNED.length);
    // Pink, Orange and Red from PROP_COLORS in board.js, in board order.
    const colors = await ipoDots.evaluateAll(dots => dots.map(dot => getComputedStyle(dot).backgroundColor));
    expect(colors).toEqual(['rgb(233, 30, 140)', 'rgb(249, 124, 42)', 'rgb(231, 76, 60)']);
    await page.locator('#ipoModal .modal-content').screenshot({ path: test.info().outputPath('ipo-sheet.png') });
    await context.close();
});
