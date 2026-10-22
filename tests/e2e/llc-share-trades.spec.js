// @ts-check
// Shares in an LLC (corporation) can be traded or sent through the Market tab,
// not just whole properties.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

async function setupGameWithLlc(request) {
    const users = {};
    for (const name of ['Alice', 'Bob']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Alice.token}` },
        data: { name: 'LLC Room', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users.Bob.token}` },
        data: { player_name: 'Bob' },
    });
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users.Alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [playerState(users.Alice.user.id, 'Alice'), playerState(users.Bob.user.id, 'Bob')],
                properties: [
                    { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: users.Alice.user.id, ownerName: 'Alice', houses: 0 },
                ],
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    const created = await apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${users.Alice.token}` },
        data: {
            actionId: `e2e-ipo-${Date.now()}`,
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, assetIds: ['prop-0'] },
            expectedVersion: game.state_version,
        },
    });
    expect(created).toBeTruthy();
    return { room, game, users };
}

async function openMarket(browser, room, user) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    await page.click('.nav-tab[data-section="market"]');
    return { context, page };
}

test('a player can sell LLC shares through the Market tab', async ({ browser, request }) => {
    const { room, users } = await setupGameWithLlc(request);
    const alice = await openMarket(browser, room, users.Alice);
    const bob = await openMarket(browser, room, users.Bob);

    await alice.page.selectOption('#player1Select', users.Alice.user.id);
    await alice.page.selectOption('#player2Select', users.Bob.user.id);
    const shareInput = alice.page.locator('#player1Assets .trade-share-input');
    await expect(alice.page.locator('#player1Assets')).toContainText('ALC shares (holds 10 of 10)');
    await shareInput.fill('4');
    await alice.page.fill('#player2Cash', '90');
    await expect(alice.page.locator('#executeTradeBtn')).toBeEnabled();
    await alice.page.click('#executeTradeBtn');
    await expect(alice.page.locator('#tradeOffersList')).toContainText('4 ALC shares');

    await expect(bob.page.locator('#tradeOffersList')).toContainText('4 ALC shares', { timeout: 10000 });
    await bob.page.click('[data-game-action="accept-trade-offer"]');
    await expect(bob.page.locator('#market-status')).toContainText('Trade accepted');

    // Bob can now offer the shares he holds; Alice's side shows what she kept.
    await bob.page.selectOption('#player1Select', users.Bob.user.id);
    await bob.page.selectOption('#player2Select', users.Alice.user.id);
    await expect(bob.page.locator('#player1Assets')).toContainText('ALC shares (holds 4 of 10)');
    await expect(bob.page.locator('#player2Assets')).toContainText('ALC shares (holds 6 of 10)');

    const fetched = await apiJson(request, 'get', `${BASE_API}/games/${(await alice.page.evaluate(() => currentGame.id))}`, {
        headers: { Authorization: `Bearer ${users.Alice.token}` },
    });
    const bobState = fetched.game_state.players.find(p => p.userId === users.Bob.user.id);
    expect(bobState.cash).toBe(1410);
    expect(bobState.corporations[0]).toMatchObject({ ticker: 'ALC', sharesOwned: 4 });
    await alice.context.close();
    await bob.context.close();
});

test('a player can send LLC shares as a gift', async ({ browser, request }) => {
    const { room, users } = await setupGameWithLlc(request);
    const alice = await openMarket(browser, room, users.Alice);

    await alice.page.selectOption('#player2Select', users.Bob.user.id);
    await alice.page.locator('#player1Assets .trade-share-input').fill('2');
    await alice.page.click('#executeTradeBtn');
    await expect(alice.page.locator('#tradeOffersList')).toContainText('2 ALC shares');
    await expect(alice.page.locator('#tradeOffersList .trade-offer-sides')).toContainText('Nothing');
    await alice.context.close();
});
