// @ts-check
// The Game tab during play: one sheet at a time when a bankruptcy ends the game,
// standings that come back after a reload, the "Since your last turn" card on a
// first turn, the auction clock and whole-dollar bids, and player cards without
// the old turn cash-flow counters.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

async function setupGame(request, names, buildState) {
    const users = [];
    for (const name of names) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: `Game Tab ${Date.now()}`, player_name: names[0], max_players: 4 },
    });
    for (const user of users.slice(1)) {
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${user.token}` },
            data: { player_name: user.name },
        });
    }
    const config = await apiJson(request, 'get', `${BASE_API}/games/config`);
    const properties = config.properties.map((prop, i) => ({ ...prop, id: `prop-${i}`, houses: 0, ownerId: null, ownerName: null }));
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { room_id: room.id, game_state: buildState(users, properties) },
    });
    return { users, room, game };
}

async function openGame(page, user, room) {
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.turn-ticket')).toBeVisible({ timeout: 10000 });
}

async function postAction(request, game, user, type, payload = {}) {
    const fetched = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
    });
    return apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { actionId: `t-${Date.now()}-${Math.random()}`, type, payload, expectedVersion: fetched.state_version },
    });
}

const baseState = (players, properties) => ({
    currentPlayerIndex: 0,
    players,
    properties,
    corporations: [],
    debts: [],
    marketOffers: [],
    gameLog: [],
    lastDiceRoll: null,
    lastCardDrawn: null,
    settings: { passGoAmount: 200, startingCash: 1500 },
});

test.describe('Game tab', () => {
    test('a bankruptcy that ends the game shows its summary, then the standings, which come back after a reload', async ({ page, request }) => {
        const { users, room } = await setupGame(request, ['Alice', 'Bob'], ([a, b], properties) => {
            // Square 34 is Pennsylvania Ave (prop-22): Bob's with 3 houses, rent $1,000.
            properties[22] = { ...properties[22], ownerId: b.user.id, ownerName: 'Bob', houses: 3 };
            properties[21] = { ...properties[21], ownerId: b.user.id, ownerName: 'Bob', houses: 3 };
            properties[23] = { ...properties[23], ownerId: b.user.id, ownerName: 'Bob', houses: 3 };
            properties[1] = { ...properties[1], ownerId: a.user.id, ownerName: 'Alice' };
            return baseState([
                playerState(a.user.id, 'Alice', { cash: 40, position: 30 }),
                playerState(b.user.id, 'Bob', { cash: 900 }),
            ], properties);
        });
        const [alice] = users;
        await openGame(page, alice, room);
        await page.evaluate(() => { window.__E2E_NEXT_DICE = [1, 3]; });
        await page.locator('[data-game-action="roll-dice"]').click();
        await expect(page.locator('.turn-warning.danger')).toContainText('You owe Bob $960. Borrow, sell or trade to raise it, or End Turn makes you bankrupt.');

        await page.locator('.action-btn-end-turn').click();
        const liquidation = page.locator('#liquidationModal');
        await expect(liquidation).toBeVisible({ timeout: 5000 });
        await expect(liquidation).toContainText('Alice is bankrupt');
        // Give a late socket update time to arrive: it must not stack the standings on top.
        await page.waitForTimeout(1500);
        await expect(page.locator('#winnerModal')).toBeHidden();

        await liquidation.locator('button', { hasText: 'OK' }).click();
        const winner = page.locator('#winnerModal');
        await expect(winner).toBeVisible();
        await expect(page.locator('#winnerName')).toHaveText('Bob wins');
        await expect(page.locator('#winnerReason')).toHaveText('Last player standing');

        await winner.getByRole('button', { name: 'Close' }).click();
        await expect(winner).toBeHidden();
        await page.locator('[data-game-action="show-final-standings"]').click();
        await expect(winner).toBeVisible();

        await page.reload();
        await expect(page.locator('#winnerModal')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#finalStandings')).toContainText('Bob');
        await expect(page.locator('#gameContent .moves')).toHaveCount(0);
    });

    test('the cash card on a first turn has one "This turn" heading, and player cards drop the turn counters', async ({ page, request }) => {
        const { users, room, game } = await setupGame(request, ['Alice', 'Bob'], ([a, b], properties) => baseState([
            playerState(a.user.id, 'Alice', { cash: 1500 }),
            playerState(b.user.id, 'Bob'),
        ], properties));
        const [alice, bob] = users;
        await openGame(page, alice, room);
        // Nothing has moved yet: no card at all.
        await expect(page.locator('.cash-since')).toHaveCount(0);

        // Square 5 is Reading Railroad, unowned.
        await page.evaluate(() => { window.__E2E_NEXT_DICE = [2, 3]; });
        await page.locator('[data-game-action="roll-dice"]').click();
        await page.locator('[data-game-action="open-buy-property"]').click();
        await expect(page.locator('#buyPropertyHint')).toHaveText('Buying leaves you $1,300. Auction: everyone bids, the high bid wins.');
        await page.locator('#confirm-purchase-btn').click();

        const card = page.locator('.cash-since');
        await expect(card.locator('.cash-since-summary h3')).toHaveText('This turn', { timeout: 5000 });
        await expect(card).not.toContainText('Before your first turn');
        await expect(card.locator('h3', { hasText: 'This turn' })).toHaveCount(1);
        await expect(card).toContainText('−$200');

        await page.locator('.action-btn-end-turn').click();
        await expect(page.locator('.game-header h2')).toContainText('Bob', { timeout: 5000 });
        // Off turn, the money from the turn that just ended isn't "this turn" any more.
        await expect(page.locator('#gameContent')).not.toContainText('Paid this turn');
        await expect(page.locator('#gameContent')).not.toContainText('Received between turns');

        // Bob lands on Alice's railroad: Alice sees the rent in "Since your turn ended".
        await postAction(request, game, bob, 'roll_dice', { testDice: [2, 3] });
        await expect(page.locator('.cash-since-summary h3')).toHaveText('Since your turn ended', { timeout: 5000 });
        await expect(page.locator('.cash-since')).toContainText('Rent from Bob');
    });

    test('the auction clock counts down, bids are whole dollars, and the dock steps aside', async ({ page, request }) => {
        const { users, room, game } = await setupGame(request, ['Alice', 'Bob'], ([a, b], properties) => ({
            ...baseState([
                playerState(a.user.id, 'Alice', { position: 1, diceRolled: true }),
                playerState(b.user.id, 'Bob'),
            ], properties),
            lastDiceRoll: [0, 1],
        }));
        const [alice, bob] = users;
        await openGame(page, alice, room);
        await page.locator('.action-btn-buy').click();
        await page.getByRole('button', { name: 'Start Auction' }).click();
        const panel = page.locator('#auctionPanel');
        await expect(panel).toContainText('No bids yet', { timeout: 5000 });
        await expect(page.locator('.turn-dock')).toHaveCount(0);
        // Host tools sit with the other host controls, not beside Bid and Pass.
        await expect(panel.getByRole('button', { name: 'Cancel Auction' })).toHaveCount(0);
        await expect(page.locator('.host-panel').getByRole('button', { name: 'Cancel Auction' })).toBeVisible();

        const expiry = page.locator('#auctionExpiry');
        await expect(expiry).toHaveText(/^Closes in \d:\d\d if no one bids or passes\.$/);
        const first = await expiry.textContent();
        await expect(expiry).not.toHaveText(first || '', { timeout: 4000 });

        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('#auctionBidAmount').fill('70.5');
        await page.getByRole('button', { name: /^Bid$/ }).click();
        await expect(panel).toContainText('No bids yet');

        await postAction(request, game, bob, 'place_bid', { amount: 90 });
        await expect(panel).toContainText('Bob leads at $90', { timeout: 5000 });
        await expect(panel).not.toContainText('$90.00');
        await expect(page.locator('#auctionBidAmount')).toHaveValue('91');
    });
});
