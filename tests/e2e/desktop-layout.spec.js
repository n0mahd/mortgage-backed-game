// @ts-check
// On wide screens the turn column (ticket, End Turn, moves) stays pinned while the
// players column scrolls. When the turn column is taller than the window, its bottom
// must still be reachable without first scrolling past every player card.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

test('turn column bottom is reachable on a short desktop window', async ({ browser, request }) => {
    const names = ['Alice', 'Bob', 'Cara', 'Dev'];
    const users = [];
    for (const name of names) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: 'Desktop Room', player_name: 'Alice', max_players: 4 },
    });
    for (const user of users.slice(1)) {
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${user.token}` },
            data: { player_name: user.name },
        });
    }

    // Give every player a few properties so the players column is long.
    const config = await apiJson(request, 'get', `${BASE_API}/games/config`);
    const properties = config.properties.map((prop, i) => {
        const owner = users[i % users.length];
        return { ...prop, id: `prop-${i}`, houses: 0, ownerId: owner.user.id, ownerName: owner.name };
    });
    const players = users.map(user => playerState(user.user.id, user.name, {
        properties: properties
            .filter(prop => prop.ownerId === user.user.id)
            .map(prop => ({ id: prop.id, name: prop.name, value: prop.price })),
    }));
    players[0] = { ...players[0], diceRolled: true };

    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players,
                properties,
                corporations: [],
                lastDiceRoll: [4, 5],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), users[0].token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);

    const main = page.locator('.game-layout-main');
    const lastMove = page.locator('.game-layout-main .moves-grid > *').last();
    await expect(lastMove).toBeAttached();

    // The page really is longer than the window, which is when the bug showed.
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight * 2)).toBe(true);

    // The pinned column fits in the window...
    const mainBox = await main.boundingBox();
    expect(mainBox && mainBox.y + mainBox.height).toBeLessThanOrEqual(640);

    // ...and scrolling inside it brings the last move into view with the page still at the top.
    await main.hover();
    await page.mouse.wheel(0, 2000);
    await expect(lastMove).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await context.close();
});
