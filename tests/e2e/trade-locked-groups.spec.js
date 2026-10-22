// @ts-check
// Streets in a colour group with buildings can't be traded. The trade form
// shows such a group once, greyed out, with a single note.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

test('a built-up colour group shows once in the trade form, with one note', async ({ browser, request }) => {
    const users = {};
    for (const name of ['Alex', 'Sam']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: { name: 'Locked groups', player_name: 'Alex', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users.Sam.token}` },
        data: { player_name: 'Sam' },
    });
    const alexId = users.Alex.user.id;
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [playerState(alexId, 'Alex'), playerState(users.Sam.user.id, 'Sam')],
                properties: [
                    { id: 'prop-med', name: 'Mediterranean Avenue', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: alexId, ownerName: 'Alex', houses: 1 },
                    { id: 'prop-bal', name: 'Baltic Avenue', color: 'Brown', price: 60, rent: [4, 20, 60, 180, 320, 450], ownerId: alexId, ownerName: 'Alex', houses: 0 },
                    { id: 'prop-stc', name: 'St. Charles Place', color: 'Pink', price: 140, rent: [10, 50, 150, 450, 625, 750], ownerId: alexId, ownerName: 'Alex', houses: 0 },
                ],
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, users.Alex.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    await page.click('.nav-tab[data-section="market"]');
    await page.selectOption('#player1Select', alexId);

    const assets = page.locator('#player1Assets');
    const group = assets.locator('.asset-locked-group');
    await expect(group).toHaveCount(1);
    await expect(group.locator('.asset-locked-note')).toHaveText(/The Brown group has buildings/);
    await expect(group.locator('.asset-locked-row')).toHaveText([/Mediterranean Avenue/, /Baltic Avenue/]);
    await expect(group.locator('input')).toHaveCount(0);
    await expect(assets.locator('input[value="prop-stc"]')).toBeEnabled();
    await expect(assets).not.toContainText("Can't be traded:");

    await group.scrollIntoViewIfNeeded();
    await assets.screenshot({ path: test.info().outputPath('trade-locked-groups.png') });
    await context.close();
});
