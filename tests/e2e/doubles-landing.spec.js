// @ts-check
// Doubles leave diceRolled false so the player can roll again, but they have still landed.
// The dock must offer Buy for the property they landed on, with Roll Again beside it, and
// must not offer to buy the square a turn merely starts on.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

async function openGameAt(browser, request, { lastDiceRoll }) {
    const users = [];
    for (const name of ['Alice', 'Bob']) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: 'Doubles Room', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users[1].token}` },
        data: { player_name: 'Bob' },
    });
    const config = await apiJson(request, 'get', `${BASE_API}/games/config`);
    const properties = config.properties.map((prop, i) => ({ ...prop, id: `prop-${i}`, houses: 0, ownerId: null, ownerName: null }));
    // Square 6 is Oriental Avenue, unowned, $100.
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(users[0].user.id, 'Alice', { position: 6, diceRolled: false, doubleCount: lastDiceRoll ? 1 : 0 }),
                    playerState(users[1].user.id, 'Bob'),
                ],
                properties,
                corporations: [],
                gameLog: [],
                lastDiceRoll,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), users[0].token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.turn-ticket')).toBeVisible();
    return { page, context };
}

test('after doubles onto an unowned property the dock offers Buy and Roll Again', async ({ browser, request }) => {
    const { page, context } = await openGameAt(browser, request, { lastDiceRoll: [3, 3] });
    const dock = page.locator('#gameContent .turn-dock');

    await expect(page.locator('.ticket-status')).toContainText('Doubles! Now on Oriental');
    await expect(dock.locator('[data-game-action="open-buy-property"]')).toHaveText('Buy for $100');
    await expect(dock.locator('[data-game-action="roll-dice"]')).toHaveText('Roll Again');
    await expect(dock.locator('[data-game-action="end-turn"]')).toHaveCount(0);

    await dock.locator('[data-game-action="open-buy-property"]').click();
    await page.locator('#confirm-purchase-btn').click();

    await expect(dock.locator('[data-game-action="open-buy-property"]')).toHaveCount(0);
    await expect(dock.locator('[data-game-action="roll-dice"]')).toHaveText('Roll Again');
    await expect(page.locator('.landing-summary')).toContainText('You already own this square.');
    await context.close();
});

test('the square a turn starts on is not offered for sale before rolling', async ({ browser, request }) => {
    const { page, context } = await openGameAt(browser, request, { lastDiceRoll: null });
    const dock = page.locator('#gameContent .turn-dock');

    await expect(page.locator('.ticket-status')).toHaveText('Roll to move');
    await expect(page.locator('.landing-summary')).toContainText('roll first');
    await expect(dock.locator('[data-game-action="open-buy-property"]')).toHaveCount(0);
    await expect(dock.locator('[data-game-action="roll-dice"]')).toHaveText('Roll Dice');
    await context.close();
});
