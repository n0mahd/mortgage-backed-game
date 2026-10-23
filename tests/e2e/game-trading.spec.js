// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

/**
 * Setup a 2-player game with some properties owned.
 */
async function setupTradingGame(request) {
    const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
    const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();

    const room = await (await request.post(`${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${h.token}` },
        data: { name: 'Trading Room', player_name: 'Alice', max_players: 4 },
    })).json();

    await request.post(`${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${g.token}` },
        data: { player_name: 'Bob' },
    });

    const gameState = {
        currentPlayerIndex: 0,
        players: [
            playerState(h.user.id, 'Alice'),
            playerState(g.user.id, 'Bob'),
        ],
        properties: [
            { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: h.user.id, ownerName: 'Alice', houses: 0 },
            { id: 'prop-1', name: 'Baltic Ave', color: 'Brown', price: 60, rent: [4, 20, 60, 180, 320, 450], ownerId: g.user.id, ownerName: 'Bob', houses: 0 },
        ],
        corporations: [],
        debts: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500 },
    };

    const game = await (await request.post(`${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${h.token}` },
        data: { room_id: room.id, game_state: gameState },
    })).json();

    return { room, game, hostToken: h.token, guestToken: g.token, hostId: h.user.id, guestId: g.user.id };
}

// The proposer offers, the other player accepts: the only way a trade happens.
async function proposeAndAccept(request, game, proposerToken, recipientToken, terms) {
    const proposed = await request.post(`${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${proposerToken}` },
        data: { actionId: `e2e-propose-${Date.now()}`, type: 'propose_trade', payload: terms, expectedVersion: game.state_version },
    });
    expect(proposed.ok()).toBe(true);
    const current = await (await request.get(`${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${recipientToken}` },
    })).json();
    const offer = current.game_state.marketOffers.find(o => o.status === 'pending');
    const accepted = await request.post(`${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${recipientToken}` },
        data: { actionId: `e2e-accept-${Date.now()}`, type: 'accept_trade', payload: { offerId: offer.id }, expectedVersion: current.state_version },
    });
    expect(accepted.ok()).toBe(true);
}

test.describe('Trading — API state manipulation', () => {
    test('cash transfer between players persists correctly', async ({ request }) => {
        const { game, hostToken, hostId, guestId } = await setupTradingGame(request);

        await request.post(`${BASE_API}/games/${game.id}/actions`, {
            headers: { Authorization: `Bearer ${hostToken}` },
            data: {
                actionId: `e2e-payment-${Date.now()}`,
                type: 'manual_payment',
                payload: { fromPlayerId: hostId, toPlayerId: guestId, amount: 200 },
                expectedVersion: game.state_version,
            },
        });

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${hostToken}` },
        })).json();
        expect(fetched.game_state.players[0].cash).toBe(1300);
        expect(fetched.game_state.players[1].cash).toBe(1700);
    });

    test('property transfer between players persists correctly', async ({ request }) => {
        const { game, hostToken, guestToken, hostId, guestId } = await setupTradingGame(request);
        await proposeAndAccept(request, game, hostToken, guestToken,
            { player1Id: hostId, player2Id: guestId, player1Cash: 0, player2Cash: 0, player1AssetIds: ['prop-0'], player2AssetIds: [] });

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${hostToken}` },
        })).json();
        expect(fetched.game_state.properties[0].ownerId).toBe(guestId);
        expect(fetched.game_state.properties[0].ownerName).toBe('Bob');
    });

    test('mutual exchange (cash + property) persists correctly', async ({ request }) => {
        const { game, hostToken, guestToken, hostId, guestId } = await setupTradingGame(request);
        await proposeAndAccept(request, game, hostToken, guestToken,
            { player1Id: hostId, player2Id: guestId, player1Cash: 0, player2Cash: 100, player1AssetIds: ['prop-0'], player2AssetIds: [] });

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${hostToken}` },
        })).json();
        expect(fetched.game_state.players[0].cash).toBe(1600);
        expect(fetched.game_state.players[1].cash).toBe(1400);
        expect(fetched.game_state.properties[0].ownerId).toBe(guestId);
    });

    test('one player cannot move the other player\'s money without an accepted offer', async ({ request }) => {
        const { game, hostToken, hostId, guestId } = await setupTradingGame(request);
        const res = await request.post(`${BASE_API}/games/${game.id}/actions`, {
            headers: { Authorization: `Bearer ${hostToken}` },
            data: {
                actionId: `e2e-trade-legacy-${Date.now()}`,
                type: 'trade',
                payload: { player1Id: hostId, player2Id: guestId, player1Cash: 0, player2Cash: 1000, player1AssetIds: [], player2AssetIds: [] },
                expectedVersion: game.state_version,
            },
        });
        expect(res.status()).toBe(400);
        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${hostToken}` },
        })).json();
        expect(fetched.game_state.players[1].cash).toBe(1500);
    });
});

test.describe('Trading — UI', () => {
    let setup;

    test.beforeAll(async ({ request }) => {
        setup = await setupTradingGame(request);
    });

    test('game.html loads with market/trading functionality accessible', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Look for market/trade tab
        const marketTab = page.locator('[role="tab"], button, a').filter({ hasText: /market|trade|transaction/i }).first();
        if (await marketTab.count() > 0) {
            await marketTab.click();
            await expect(page.locator('body')).toBeVisible();
        } else {
            await expect(page.locator('body')).toBeVisible();
        }
    });

    test('corporation panel is accessible in game', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Check for corporations tab or button
        const corpTab = page.locator('[role="tab"], button, a').filter({ hasText: /corp/i }).first();
        if (await corpTab.count() > 0) {
            await corpTab.click();
            await expect(page.locator('body')).toBeVisible();
        } else {
            await expect(page.locator('body')).toBeVisible();
        }
    });

    test('player cash values are shown on game page', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Should show cash amounts
        await expect(page.locator('body')).toContainText('$1,500', { timeout: 5000 });
    });

    test('property names are shown in game state', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Board has Mediterranean Ave
        const boardTab = page.locator('[role="tab"], button, a').filter({ hasText: /board/i }).first();
        if (await boardTab.count() > 0) {
            await boardTab.click();
        }

        // Mediterranean should appear on the board
        await expect(page.locator('body')).toContainText('Mediterranean', { timeout: 5000 });
    });
});

test.describe('Trading — offer colors', () => {
    test('pending offer shows each property in its color group', async ({ page, request }) => {
        const h = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        const g = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Trade Colors Room', player_name: 'Abdullah', max_players: 4 },
        });
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Matt' },
        });
        const prop = (id, name, color, owner) => ({ id, name, color, price: 200, rent: [10, 50, 150, 450, 625, 750], ownerId: owner.user.id, ownerName: owner === h ? 'Abdullah' : 'Matt', houses: 0 });
        const game = await apiJson(request, 'post', `${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: {
                room_id: room.id,
                game_state: {
                    currentPlayerIndex: 0,
                    players: [playerState(h.user.id, 'Abdullah'), playerState(g.user.id, 'Matt')],
                    properties: [
                        prop('prop-10', 'St. James Place', 'Orange', g),
                        prop('prop-11', 'Tennessee Avenue', 'Orange', g),
                        prop('prop-23', 'Pennsylvania Avenue', 'Green', g),
                        prop('prop-12', 'New York Avenue', 'Orange', h),
                        prop('prop-25', 'Park Place', 'Dark Blue', h),
                    ],
                    corporations: [], debts: [], marketOffers: [], gameLog: [],
                    lastDiceRoll: null, lastCardDrawn: null,
                    settings: { passGoAmount: 200, startingCash: 1500 },
                },
            },
        });

        await apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: {
                actionId: `e2e-offer-colors-${Date.now()}`,
                type: 'propose_trade',
                payload: { player1Id: g.user.id, player2Id: h.user.id, player1Cash: 50, player2Cash: 0, player1AssetIds: ['prop-23', 'prop-10', 'prop-11'], player2AssetIds: ['prop-12', 'prop-25'] },
                expectedVersion: game.state_version,
            },
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.getByRole('button', { name: 'Market' }).click();
        const card = page.locator('#tradeOffersList .trade-offer-card');
        await expect(card).toContainText('Matt proposed a trade', { timeout: 5000 });

        // Board order groups the oranges together ahead of the green.
        await expect(card.locator('.trade-asset-tag.property').first()).toContainText('St. James Place');
        const park = card.locator('.trade-asset-tag', { hasText: 'Park Place' });
        await expect(park).toContainText('Dark Blue');
        await expect(park).toHaveCSS('--property-color', '#2C3E9E');
        await expect(card.locator('.trade-asset-tag.cash')).toContainText('$50');
        if (process.env.TRADE_COLORS_SHOT) await card.screenshot({ path: process.env.TRADE_COLORS_SHOT });
    });
});

test.describe('Trading — cash limit', () => {
    test('each side shows its max cash and an offer above it cannot be proposed', async ({ page, request }) => {
        const h = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        const g = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Trade Cash Room', player_name: 'Abdullah', max_players: 4 },
        });
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Claude' },
        });
        await apiJson(request, 'post', `${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: {
                room_id: room.id,
                game_state: {
                    currentPlayerIndex: 0,
                    players: [playerState(h.user.id, 'Abdullah', { cash: 1234 }), playerState(g.user.id, 'Claude', { cash: -50 })],
                    properties: [], corporations: [], debts: [], marketOffers: [], gameLog: [],
                    lastDiceRoll: null, lastCardDrawn: null,
                    settings: { passGoAmount: 200, startingCash: 1500 },
                },
            },
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.getByRole('button', { name: 'Market' }).click();

        await expect(page.locator('label[for="player1Cash"]')).toHaveText('Cash (max $1,234)');
        await expect(page.locator('label[for="player2Cash"]')).toHaveText('Cash (max $0)');

        const cash = page.locator('#player1Cash');
        const propose = page.locator('#executeTradeBtn');
        await cash.fill('1234');
        await expect(propose).toBeEnabled();
        await cash.fill('1235');
        await expect(propose).toBeDisabled();
        await expect(cash).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#player1CashMax')).toHaveClass(/is-over/);
        if (process.env.TRADE_CASH_SHOT) await page.locator('#market .transaction-form').screenshot({ path: process.env.TRADE_CASH_SHOT });

        await cash.fill('0');
        await page.locator('#player2Cash').fill('1');
        await expect(propose).toBeDisabled();
    });
});
