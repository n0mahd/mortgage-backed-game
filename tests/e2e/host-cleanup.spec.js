// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState, showMarketPane } = require('./helpers');

async function setupThreePlayerGame(request, opts = {}) {
    const host = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const bob = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const carol = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${host.token}` },
        data: { name: `Host Cleanup Room ${Date.now()}`, player_name: 'Alice', max_players: 4 },
    });

    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${bob.token}` },
        data: { player_name: 'Bob' },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${carol.token}` },
        data: { player_name: 'Carol' },
    });

    const gameState = {
        currentPlayerIndex: 0,
        players: [
            playerState(host.user.id, 'Alice'),
            playerState(bob.user.id, 'Bob'),
            playerState(carol.user.id, 'Carol'),
        ],
        properties: [],
        corporations: [],
        debts: [],
        marketOffers: opts.marketOffers ? opts.marketOffers({ host, bob, carol }) : [],
        gameLog: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5, ...(opts.settings || {}) },
    };
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${host.token}` },
        data: { room_id: room.id, game_state: gameState },
    });

    return { room, game, host, bob, carol };
}

test.describe('Host cleanup controls', () => {
    test('host can cancel a pending trade offer they are not part of', async ({ page, request }) => {
        const setup = await setupThreePlayerGame(request);

        await apiJson(request, 'post', `${BASE_API}/games/${setup.game.id}/actions`, {
            headers: { Authorization: `Bearer ${setup.bob.token}` },
            data: {
                actionId: `host-cleanup-offer-${Date.now()}`,
                type: 'propose_trade',
                payload: {
                    player1Id: setup.bob.user.id,
                    player2Id: setup.carol.user.id,
                    player1Cash: 15,
                    player2Cash: 0,
                    player1AssetIds: [],
                    player2AssetIds: [],
                },
                expectedVersion: setup.game.state_version,
            },
        });

        await loginPage(page, setup.host.token);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await page.getByRole('button', { name: 'Market' }).click();
        await showMarketPane(page, 'Trade proposals');
        await expect(page.locator('#tradeOffersList')).toContainText('Bob proposed a trade', { timeout: 5000 });

        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Host Cancel' }).click();
        await expect(page.locator('#market-status')).toContainText('canceled by host', { timeout: 5000 });
        await expect(page.locator('#tradeOffersList')).toContainText('No pending trade offers');

        const fetched = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(fetched.game_state.marketOffers[0].status).toBe('canceled');
        expect(fetched.game_state.marketOffers[0].cancelReason).toBe('host');
        expect(fetched.game_state.players.find(player => player.userId === setup.bob.user.id).cash).toBe(1500);
        expect(fetched.game_state.players.find(player => player.userId === setup.carol.user.id).cash).toBe(1500);
    });

    test('host can clear an expired trade offer without moving assets', async ({ page, request }) => {
        const setup = await setupThreePlayerGame(request, {
            marketOffers: ({ bob, carol }) => [{
                id: 'expired-offer-e2e',
                status: 'pending',
                proposedById: bob.user.id,
                proposedByName: 'Bob',
                recipientId: carol.user.id,
                recipientName: 'Carol',
                player1Id: bob.user.id,
                player1Name: 'Bob',
                player2Id: carol.user.id,
                player2Name: 'Carol',
                player1Cash: 15,
                player2Cash: 0,
                player1AssetIds: [],
                player2AssetIds: [],
                createdAt: '2000-01-01T00:00:00.000Z',
                expiresAt: '2000-01-01T00:01:00.000Z',
            }],
        });

        await loginPage(page, setup.host.token);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await page.getByRole('button', { name: 'Market' }).click();
        await showMarketPane(page, 'Trade proposals');
        await expect(page.locator('#tradeOffersList')).toContainText('Bob proposed a trade', { timeout: 5000 });
        await expect(page.locator('#tradeOffersList')).toContainText('expired');

        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Clear Expired' }).click();
        await expect(page.locator('#market-status')).toContainText('expired and was cleared', { timeout: 5000 });
        await expect(page.locator('#tradeOffersList')).toContainText('No pending trade offers');

        const fetched = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(fetched.game_state.marketOffers[0].status).toBe('expired');
        expect(fetched.game_state.marketOffers[0].cancelReason).toBe('timeout');
        expect(fetched.game_state.players.find(player => player.userId === setup.bob.user.id).cash).toBe(1500);
        expect(fetched.game_state.players.find(player => player.userId === setup.carol.user.id).cash).toBe(1500);
    });

    test('host can pause and resume the game from the game screen', async ({ page, request }) => {
        const setup = await setupThreePlayerGame(request);

        await loginPage(page, setup.host.token);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByRole('button', { name: 'Pause Game' })).toBeVisible({ timeout: 5000 });

        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Pause Game' }).click();
        await expect(page.locator('#pausePanel')).toContainText('Game Paused', { timeout: 5000 });
        await expect(page.getByRole('button', { name: 'Resume Game' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Roll Dice' })).toBeHidden();

        const paused = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(paused.game_state.paused).toBe(true);

        const blocked = await request.post(`${BASE_API}/games/${setup.game.id}/actions`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
            data: {
                actionId: `paused-roll-${Date.now()}`,
                type: 'roll_dice',
                payload: {},
                expectedVersion: paused.state_version,
            },
        });
        expect(blocked.status()).toBe(400);
        expect((await blocked.json()).error).toBe('Game is paused');

        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Resume Game' }).click();
        await expect(page.locator('#pausePanel')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Pause Game' })).toBeVisible();

        const resumed = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(resumed.game_state.paused).toBe(false);
        expect(resumed.game_state.pauseHistory[0].reason).toBe('Host paused the game');
    });
});
