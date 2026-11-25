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
    test('a bankruptcy that ends the game shows its summary, then the standings, which stay on the ticket after a reload', async ({ page, request }) => {
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
        // The standings stay on the ticket, and come back after a reload without the sheet.
        const standings = page.locator('#gameContent .ticket-standings');
        await expect(page.locator('#gameContent .ticket-title')).toHaveText('Bob won');
        await expect(standings.locator('.ticket-standing').first()).toContainText('Bob');

        await page.reload();
        await expect(page.locator('#gameContent .ticket-title')).toHaveText('Bob won', { timeout: 10000 });
        await expect(standings.locator('.ticket-standing.is-out')).toContainText('Alice');
        await expect(page.locator('#winnerModal')).toBeHidden();
        await expect(page.locator('#gameContent .moves')).toHaveCount(0);
        await expect(page.locator('#gameContent .game-over-actions')).toContainText('My games');
    });

    test('rent shows as a stamp on the square card, and before your next roll as the ticket stub', async ({ page, request }) => {
        const { users, room, game } = await setupGame(request, ['Alice', 'Bob'], ([a, b], properties) => baseState([
            playerState(a.user.id, 'Alice', { cash: 1500 }),
            playerState(b.user.id, 'Bob'),
        ], properties));
        const [alice, bob] = users;
        await openGame(page, alice, room);
        // Nothing has moved yet: no stub, no square card.
        await expect(page.locator('.ticket-stub')).toHaveCount(0);
        await expect(page.locator('.square-card')).toHaveCount(0);

        // Square 5 is Reading Railroad, unowned: the card shows the rent ladder, the dock the price.
        await page.evaluate(() => { window.__E2E_NEXT_DICE = [2, 3]; });
        await page.locator('[data-game-action="roll-dice"]').click();
        await expect(page.locator('.square-card')).toContainText('Railroad · for sale');
        await expect(page.locator('.rent-ladder-step.is-lit')).toContainText('$25');
        await page.locator('.turn-dock [data-game-action="buy-property"]', { hasText: 'Buy $200' }).click();
        await expect(page.locator('.square-card')).toContainText('Yours · 1 of 4 railroads');
        await expect(page.locator('.turn-ticket .ticket-cash')).toContainText('$1,300');
        await expect(page.locator('.ticket-stub')).toHaveCount(0);

        await page.locator('.action-btn-end-turn').click();
        await expect(page.locator('.turn-strip-title')).toContainText('Bob', { timeout: 5000 });

        // Bob lands on Alice's railroad: Alice sees the rent stamped on the card, off her turn.
        await postAction(request, game, bob, 'roll_dice', { testDice: [2, 3] });
        await expect(page.locator('.square-stamp.is-in')).toHaveText('+$25', { timeout: 5000 });
        await expect(page.locator('.turn-ticket.is-compact .ticket-cash')).toContainText('$1,325');

        // Before Alice rolls again, the stub says where it came from.
        await postAction(request, game, bob, 'end_turn');
        const stub = page.locator('.turn-ticket .ticket-stub');
        await expect(stub).toContainText('Since your last turn', { timeout: 5000 });
        await expect(stub).toContainText('Rent from Bob');
        await expect(stub).toContainText('Reading Railroad');
        await expect(stub.locator('.ticket-stub-amount')).toHaveText('+$25');
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
        await page.locator('.turn-dock [data-game-action="start-auction"]').click();
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
