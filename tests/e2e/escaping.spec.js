// @ts-check
// A player name is free text that other players' browsers render. It must never be able to
// open an attribute or inject markup: not on the square card ("<name>'s · 1 of 2 browns"),
// not in the players list, and not in the Recent events log built from game events.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

const HOSTILE = `Eve" onmouseover="window.__pwned=1" x="<img src=x onerror=window.__pwned=2>`;

test('hostile player names render as text on the square card, players list and the log', async ({ browser, request }) => {
    const users = [];
    for (const name of ['Alice', HOSTILE]) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: 'Escaping Room', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users[1].token}` },
        data: { player_name: 'Eve' },
    });
    const config = await apiJson(request, 'get', `${BASE_API}/games/config`);
    const evil = users[1];
    // Eve owns Mediterranean (square 1). Alice has just rolled onto it.
    const properties = config.properties.map((prop, i) => ({
        ...prop, id: `prop-${i}`, houses: 0,
        ownerId: i === 0 ? evil.user.id : null, ownerName: i === 0 ? HOSTILE : null,
    }));
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(users[0].user.id, 'Alice', { position: 1, diceRolled: true }),
                    playerState(evil.user.id, HOSTILE, { properties: [{ id: 'prop-0', name: properties[0].name, value: properties[0].price }] }),
                ],
                properties,
                corporations: [],
                gameLog: [{ timestamp: new Date().toISOString(), message: `${HOSTILE} joined the market` }],
                lastDiceRoll: [0, 1],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });

    // A payment to Eve puts her name in a game event, which Recent events shows.
    const paid = await request.post(`${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { actionId: `pay-${Date.now()}`, type: 'manual_payment', expectedVersion: game.state_version,
            payload: { fromPlayerId: users[0].user.id, toPlayerId: evil.user.id, amount: 5 } },
    });
    expect(paid.ok()).toBe(true);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), users[0].token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.turn-ticket')).toBeVisible();

    const card = page.locator('#game .square-card');
    await expect(card).toContainText(`${HOSTILE}'s · 1 of 2 browns`);
    await expect(page.locator('#game .seat-list')).toContainText(HOSTILE);
    await expect(page.locator('#full-game-log')).toContainText(`You paid $5 to ${HOSTILE}`);

    expect(await page.locator('#gameContent [onmouseover], #gameContent img[onerror], #full-game-log [onmouseover], #full-game-log img[onerror]').count()).toBe(0);
    await card.hover({ force: true });
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    await context.close();
});
