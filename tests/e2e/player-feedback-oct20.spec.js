// @ts-check
// Regression checks for player feedback from the live game on 2026-10-20:
// stale screens after a phone drops its connection, "Failed to end turn",
// going to Jail from a card, selling a Get Out of Jail Free card, vibrating
// on your turn, and moving a game to another browser.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

const GO_TO_JAIL_CARD = { id: 'cc-6', text: 'Go to Jail. Do not pass GO.', action: { type: 'go_to_jail' } };

async function setupGame(request, { players = ['Alice', 'Bob'], overrides = {}, communityChestCards } = {}) {
    const users = [];
    for (const name of players) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: 'Feedback Room', player_name: users[0].name, max_players: 4 },
    });
    for (const user of users.slice(1)) {
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${user.token}` },
            data: { player_name: user.name },
        });
    }
    const gameState = {
        currentPlayerIndex: 0,
        players: users.map(user => playerState(user.user.id, user.name, overrides[user.name] || {})),
        properties: [],
        corporations: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500 },
        ...(communityChestCards ? { communityChestCards } : {}),
    };
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { room_id: room.id, game_state: gameState },
    });
    const byName = Object.fromEntries(users.map(user => [user.name, user]));
    return { room, game, users: byName };
}

async function openGame(browser, room, user, { mobile = true } = {}) {
    const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true } : {});
    // Record vibration requests instead of relying on hardware.
    await context.addInitScript(() => {
        window.__vibrations = [];
        Object.defineProperty(navigator, 'vibrate', {
            configurable: true,
            value: pattern => { window.__vibrations.push(pattern); return true; },
        });
    });
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    return { context, page, dialogs };
}

async function act(request, game, user, type, payload = {}) {
    const latest = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
    });
    return apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { actionId: `e2e-${Math.random()}`, type, payload, expectedVersion: latest.state_version },
    });
}

function shownVersion(page) {
    return page.evaluate(() => currentGame.state_version);
}

test.describe('Player feedback 2026-10-20', () => {
    test('a player who dropped offline catches up without refreshing', async ({ browser, request }) => {
        const { room, game, users } = await setupGame(request);
        const bob = await openGame(browser, room, users.Bob);

        await bob.context.setOffline(true);
        await act(request, game, users.Alice, 'roll_dice', { testDice: [1, 2] });
        await act(request, game, users.Alice, 'end_turn');
        await bob.page.waitForTimeout(1000);
        expect(await shownVersion(bob.page)).toBe(0);

        await bob.context.setOffline(false);
        await expect(bob.page.locator('.turn-indicator')).toBeVisible({ timeout: 15000 });
        await expect(bob.page.locator('#gameContent [data-game-action="roll-dice"]')).toBeEnabled();
        expect(await shownVersion(bob.page)).toBe(2);
        await bob.context.close();
    });

    test('refreshing on a flaky connection still loads the game', async ({ browser, request }) => {
        const { room, users } = await setupGame(request);
        const bob = await openGame(browser, room, users.Bob);
        let failures = 2;
        await bob.page.route('**/api/auth/me', route => (failures-- > 0 ? route.abort('internetdisconnected') : route.continue()));

        await bob.page.reload();
        await expect(bob.page.locator('.game-header')).toBeVisible({ timeout: 10000 });
        expect(await bob.page.evaluate(() => localStorage.getItem('auth_token'))).toBe(users.Bob.token);
        await bob.context.close();
    });

    test('a guest who refreshes while offline keeps their login', async ({ browser, request }) => {
        const { room, users } = await setupGame(request);
        const bob = await openGame(browser, room, users.Bob);
        await bob.page.route('**/api/auth/me', route => route.abort('internetdisconnected'));

        await bob.page.goto(`${BASE}/lobby.html`);
        await expect(bob.page.locator('.turn-warning.danger')).toContainText("Couldn't reach the game server", { timeout: 15000 });
        await expect(bob.page).toHaveURL(/lobby\.html/);
        expect(await bob.page.evaluate(() => localStorage.getItem('auth_token'))).toBe(users.Bob.token);

        await bob.page.unroute('**/api/auth/me');
        await bob.page.getByRole('button', { name: 'Try again' }).click();
        await expect(bob.page.locator('.turn-warning.danger')).toHaveCount(0, { timeout: 10000 });
        await bob.context.close();
    });

    test('a screen that comes back to the foreground catches up', async ({ browser, request }) => {
        const { room, game, users } = await setupGame(request);
        const bob = await openGame(browser, room, users.Bob);
        // Simulate a socket that silently missed the broadcast.
        await bob.page.evaluate(() => gameChannel.unsubscribe());

        await act(request, game, users.Alice, 'roll_dice', { testDice: [1, 2] });
        await act(request, game, users.Alice, 'end_turn');
        await bob.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

        await expect(bob.page.locator('.turn-indicator')).toBeVisible({ timeout: 5000 });
        await bob.context.close();
    });

    test('End Turn survives a lost response: no error, no double move', async ({ browser, request }) => {
        const { room, game, users } = await setupGame(request);
        const alice = await openGame(browser, room, users.Alice);
        await alice.page.evaluate(() => { window.__E2E_NEXT_DICE = [1, 2]; });
        await alice.page.click('[data-game-action="roll-dice"]');
        await expect(alice.page.locator('[data-game-action="end-turn"]')).toBeEnabled();

        // The first end_turn reaches the server, but the phone never gets the reply.
        const actionIds = [];
        let dropped = false;
        await alice.page.route('**/api/games/*/actions', async route => {
            const body = route.request().postDataJSON();
            actionIds.push(body.actionId);
            if (body.type === 'end_turn' && !dropped) {
                dropped = true;
                await route.fetch();
                await route.abort('connectionreset');
                return;
            }
            await route.continue();
        });
        await alice.page.click('[data-game-action="end-turn"]');

        await expect(alice.page.locator('.waiting-indicator')).toBeVisible({ timeout: 10000 });
        expect(alice.dialogs).toEqual([]);
        expect(new Set(actionIds).size).toBe(1);
        const latest = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${users.Alice.token}` },
        });
        expect(latest.state_version).toBe(2);
        expect(latest.game_state.players[latest.game_state.currentPlayerIndex].name).toBe('Bob');
        await alice.context.close();
    });

    test('drawing Go to Jail after doubles ends the turn in the browser', async ({ browser, request }) => {
        const { room, users } = await setupGame(request, { communityChestCards: [GO_TO_JAIL_CARD] });
        const alice = await openGame(browser, room, users.Alice);
        await alice.page.evaluate(() => { window.__E2E_NEXT_DICE = [1, 1]; });
        await alice.page.click('[data-game-action="roll-dice"]');

        await expect(alice.page.locator('[data-game-action="end-turn"]')).toBeEnabled();
        await expect(alice.page.locator('[data-game-action="roll-dice"]')).toHaveCount(0);
        await expect(alice.page.locator('[data-game-action="pay-jail-fine"]')).toHaveCount(0);
        await alice.page.click('[data-game-action="end-turn"]');
        await expect(alice.page.locator('.waiting-indicator')).toBeVisible();
        expect(alice.dialogs).toEqual([]);
        await alice.context.close();
    });

    test('the phone vibrates once when it becomes your turn, not on load', async ({ browser, request }) => {
        const { room, game, users } = await setupGame(request);
        const bob = await openGame(browser, room, users.Bob);
        expect(await bob.page.evaluate(() => window.__vibrations.length)).toBe(0);

        await act(request, game, users.Alice, 'roll_dice', { testDice: [1, 2] });
        await act(request, game, users.Alice, 'end_turn');
        await expect.poll(() => bob.page.evaluate(() => window.__vibrations.length), { timeout: 10000 }).toBe(1);

        await act(request, game, users.Bob, 'roll_dice', { testDice: [1, 2] });
        await bob.page.waitForTimeout(1500);
        expect(await bob.page.evaluate(() => window.__vibrations.length)).toBe(1);
        await bob.context.close();
    });

    test('a Get Out of Jail Free card can be sold through the Market tab', async ({ browser, request }) => {
        const { room, users } = await setupGame(request, { overrides: { Alice: { hasGetOutOfJailCard: true } } });
        const alice = await openGame(browser, room, users.Alice, { mobile: false });
        const bob = await openGame(browser, room, users.Bob, { mobile: false });
        await expect(alice.page.locator('.player-card.current-user')).toContainText('Get Out of Jail Free card');

        await alice.page.click('.nav-tab[data-section="market"]');
        await alice.page.selectOption('#player1Select', users.Alice.user.id);
        await alice.page.selectOption('#player2Select', users.Bob.user.id);
        await alice.page.check('#player1-asset-get-out-of-jail-free');
        await alice.page.fill('#player2Cash', '60');
        await alice.page.click('#executeTradeBtn');
        await expect(alice.page.locator('#tradeOffersList')).toContainText('Get Out of Jail Free card');

        await bob.page.click('.nav-tab[data-section="market"]');
        await expect(bob.page.locator('#tradeOffersList')).toContainText('Get Out of Jail Free card', { timeout: 10000 });
        await bob.page.click('[data-game-action="accept-trade-offer"]');

        await bob.page.click('.nav-tab[data-section="game"]');
        await expect(bob.page.locator('.player-card.current-user')).toContainText('Get Out of Jail Free card');
        await expect(bob.page.locator('.player-card.current-user')).toContainText('$1440.00');
        await alice.page.click('.nav-tab[data-section="game"]');
        await expect(alice.page.locator('.player-card.current-user')).not.toContainText('Get Out of Jail Free card');
        await expect(alice.page.locator('.player-card.current-user')).toContainText('$1560.00');
        await alice.context.close();
        await bob.context.close();
    });

    test('a player can move their game to another browser with a one-time link', async ({ browser, request }) => {
        const { room, users } = await setupGame(request);
        const alice = await openGame(browser, room, users.Alice);
        await alice.page.click('#move-device-btn');
        await expect(alice.page.locator('#moveDeviceLink')).toHaveValue(/transfer=/);
        const link = await alice.page.locator('#moveDeviceLink').inputValue();

        const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const other = await otherContext.newPage();
        await other.goto(link);
        await expect(other).toHaveURL(new RegExp(`game\\.html\\?room=${room.id}`), { timeout: 10000 });
        await expect(other.locator('.player-card.current-user')).toContainText('Alice');
        await expect(other.locator('[data-game-action="roll-dice"]')).toBeVisible();

        // The link is single-use.
        const third = await (await browser.newContext()).newPage();
        await third.goto(link);
        await expect(third.locator('#transfer-error')).toContainText(/invalid or has expired/);
        await alice.context.close();
        await otherContext.close();
    });
});
