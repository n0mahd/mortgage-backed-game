// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

async function setupAuctionGame(request) {
    const host = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const guest = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${host.token}` },
        data: { name: `Auction Room ${Date.now()}`, player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${guest.token}` },
        data: { player_name: 'Bob' },
    });

    const gameState = {
        currentPlayerIndex: 0,
        players: [
            playerState(host.user.id, 'Alice', { position: 1, diceRolled: true }),
            playerState(guest.user.id, 'Bob'),
        ],
        properties: [
            { id: 'prop-0', name: 'Mediterranean Avenue', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: null, ownerName: null, houses: 0 },
        ],
        corporations: [],
        debts: [],
        marketOffers: [],
        gameLog: [],
        lastDiceRoll: [3, 4],
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
    };
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${host.token}` },
        data: { room_id: room.id, game_state: gameState },
    });

    return { room, game, host, guest };
}

async function postGameAction(request, gameId, token, data) {
    const res = await request.post(`${BASE_API}/games/${gameId}/actions`, {
        headers: { Authorization: `Bearer ${token}` },
        data,
    });
    const body = await res.json();
    return { res, body };
}

test.describe('Property auctions', () => {
    test('players can auction an unowned landed property through the UI', async ({ browser, request }) => {
        const setup = await setupAuctionGame(request);

        const alicePage = await browser.newPage();
        await loginPage(alicePage, setup.host.token);
        await alicePage.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await alicePage.waitForLoadState('domcontentloaded');
        await alicePage.locator('.turn-dock [data-game-action="start-auction"]').click();
        await expect(alicePage.locator('#auctionPanel')).toContainText('Mediterranean Avenue', { timeout: 5000 });
        // The dock would hold nothing usable, so it steps aside for Bid and Pass.
        await expect(alicePage.locator('.turn-dock')).toHaveCount(0);

        const bobPage = await browser.newPage();
        await loginPage(bobPage, setup.guest.token);
        await bobPage.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await bobPage.waitForLoadState('domcontentloaded');
        await expect(bobPage.locator('#auctionPanel')).toContainText('No bids yet', { timeout: 5000 });
        await bobPage.locator('#auctionBidAmount').fill('70');
        await bobPage.getByRole('button', { name: /^Bid$/ }).click();
        await expect(bobPage.locator('#auctionPanel')).toContainText('You lead at $70', { timeout: 5000 });

        await alicePage.reload();
        await alicePage.waitForLoadState('domcontentloaded');
        await expect(alicePage.locator('#auctionPanel')).toContainText('Bob leads at $70', { timeout: 5000 });
        await alicePage.getByRole('button', { name: /^Pass$/ }).click();
        await expect(alicePage.locator('#auctionPanel')).toHaveCount(0, { timeout: 5000 });

        const fetched = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(fetched.game_state.auction.status).toBe('sold');
        expect(fetched.game_state.auction.winnerName).toBe('Bob');
        expect(fetched.game_state.properties.find(prop => prop.id === 'prop-0').ownerId).toBe(setup.guest.user.id);
        expect(fetched.game_state.players.find(player => player.userId === setup.guest.user.id).cash).toBe(1430);
    });

    test('host can cancel a stuck auction through the UI', async ({ page, request }) => {
        const setup = await setupAuctionGame(request);

        await loginPage(page, setup.host.token);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await page.locator('.turn-dock [data-game-action="start-auction"]').click();
        await expect(page.locator('#auctionPanel')).toContainText('Mediterranean Avenue', { timeout: 5000 });
        await expect(page.locator('#auctionPanel')).toContainText('Closes in', { timeout: 5000 });

        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Cancel Auction' }).click();
        await expect(page.locator('#auctionPanel')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.action-btn-end-turn')).toHaveText('End Turn');

        const fetched = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(fetched.game_state.auction.status).toBe('canceled');
        expect(fetched.game_state.auction.cancelReason).toBe('host');
        expect(fetched.game_state.properties.find(prop => prop.id === 'prop-0').ownerId).toBeNull();
    });

    test('concurrent auction bids reject the stale expected version', async ({ request }) => {
        const setup = await setupAuctionGame(request);
        const started = await postGameAction(request, setup.game.id, setup.host.token, {
            actionId: `auction-start-${Date.now()}`,
            type: 'start_auction',
            payload: {},
            expectedVersion: setup.game.state_version,
        });
        expect(started.res.ok()).toBeTruthy();

        const staleVersion = started.body.game.state_version;
        const winningBid = await postGameAction(request, setup.game.id, setup.guest.token, {
            actionId: `auction-bid-winning-${Date.now()}`,
            type: 'place_bid',
            payload: { amount: 70 },
            expectedVersion: staleVersion,
        });
        expect(winningBid.res.ok()).toBeTruthy();

        const staleBid = await postGameAction(request, setup.game.id, setup.host.token, {
            actionId: `auction-bid-stale-${Date.now()}`,
            type: 'place_bid',
            payload: { amount: 80 },
            expectedVersion: staleVersion,
        });
        expect(staleBid.res.status()).toBe(409);
        expect(staleBid.body.error).toBe('Stale game state');

        const fetched = await apiJson(request, 'get', `${BASE_API}/games/${setup.game.id}`, {
            headers: { Authorization: `Bearer ${setup.host.token}` },
        });
        expect(fetched.game_state.auction.status).toBe('open');
        expect(fetched.game_state.auction.currentBid).toBe(70);
        expect(fetched.game_state.auction.highBidderId).toBe(setup.guest.user.id);
    });
});
