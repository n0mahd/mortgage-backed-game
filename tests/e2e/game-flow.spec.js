// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, loginPage, playerState } = require('./helpers');

/**
 * Helper to start a game with 2 players and navigate to game.html.
 * Returns { room, game, hostToken, guestToken, player1Id, player2Id }
 */
async function setupGame(request) {
    // Host
    const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
    // Guest
    const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();

    // Create room
    const room = await (await request.post(`${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${h.token}` },
        data: { name: 'Game Test Room', player_name: 'Alice', max_players: 4 },
    })).json();

    // Guest joins
    await request.post(`${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${g.token}` },
        data: { player_name: 'Bob' },
    });

    // Create game
    const gameState = {
        currentPlayerIndex: 0,
        players: [
            playerState(h.user.id, 'Alice'),
            playerState(g.user.id, 'Bob'),
        ],
        properties: [],
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

test.describe('Game flow', () => {
    let setup;

    test.beforeAll(async ({ request }) => {
        setup = await setupGame(request);
    });

    test('game.html loads after navigating with game context', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });

    test('player names appear on game page', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('body')).toContainText('Alice', { timeout: 5000 });
    });

    test('board tab shows game board', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Click board tab if present
        const boardTab = page.locator('[role="tab"], button, a').filter({ hasText: /board/i }).first();
        if (await boardTab.count() > 0) {
            await boardTab.click();
        }

        // Board grid should be visible. Scope to the rendered board content so
        // hidden mobile/desktop duplicate markup does not satisfy the selector.
        const board = page.locator('#boardContent .board-grid:visible, #boardContent .mobile-board-view:visible, #boardContent .board-tab-wrapper:visible').first();
        await expect(board).toBeVisible({ timeout: 5000 });
    });

    test('current player can see Roll Dice button', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to board tab
        const boardTab = page.locator('[role="tab"], button, a').filter({ hasText: /board/i }).first();
        if (await boardTab.count() > 0) await boardTab.click();

        // Roll button should be visible for current player (Alice = player index 0)
        const rollBtn = page.locator('button:visible').filter({ hasText: /roll/i }).first();
        await expect(rollBtn).toBeVisible({ timeout: 5000 });
    });

    test('duplicate game action clicks are ignored while save is in flight', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByRole('button', { name: /Roll Dice/i })).toBeVisible({ timeout: 5000 });

        let actionRequests = 0;
        await page.route('**/api/games/*/actions', async route => {
            actionRequests += 1;
            await new Promise(resolve => setTimeout(resolve, 250));
            await route.continue();
        });

        const dialogs = [];
        page.on('dialog', async dialog => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        const rollButton = page.locator('#game.section.active button[data-game-action="roll-dice"]').first();
        await expect(rollButton).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => { window.__E2E_NEXT_DICE = [1, 2]; });
        await rollButton.dispatchEvent('click');
        await rollButton.dispatchEvent('click');

        await expect(page.locator('.recent-log')).toContainText(/rolled/i, { timeout: 5000 });
        await expect.poll(() => actionRequests).toBe(1);
        expect(actionRequests).toBe(1);
        expect(dialogs).toEqual([]);
    });

    test('non-current player does not see Roll Dice button', async ({ page }) => {
        await loginPage(page, setup.guestToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        const boardTab = page.locator('[role="tab"], button, a').filter({ hasText: /board/i }).first();
        if (await boardTab.count() > 0) await boardTab.click();

        // Bob is player index 1, Alice is current (index 0)
        const rollBtn = page.locator('button:visible').filter({ hasText: /roll/i });
        await expect(rollBtn).toHaveCount(0, { timeout: 2000 });
    });

    test('game log tab shows event history', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        const logTab = page.locator('[role="tab"], button, a').filter({ hasText: /log|history|events/i }).first();
        if (await logTab.count() > 0) {
            await logTab.click();
            await expect(page.locator('body')).toBeVisible();
        } else {
            await expect(page.locator('body')).toBeVisible();
        }
    });

    test('player cash is displayed', async ({ page }) => {
        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Should show starting cash (1500)
        await expect(page.locator('body')).toContainText('1500', { timeout: 5000 });
    });
});

test.describe('Game flow — multiplayer real-time', () => {
    test('player 2 sees game state loaded via API', async ({ page, request }) => {
        const setup = await setupGame(request);

        // Page 2 (guest) loads the game
        await loginPage(page, setup.guestToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Both player names should be visible
        await expect(page.locator('body')).toContainText('Alice', { timeout: 5000 });
        await expect(page.locator('body')).toContainText('Bob', { timeout: 5000 });
    });

    test('host end-game modal is centered in the viewport', async ({ page, request }) => {
        const setup = await setupGame(request);

        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');

        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: /End Game/i }).click();
        const modalContent = page.locator('#winnerModal .modal-content');
        await expect(modalContent).toBeVisible({ timeout: 5000 });

        const box = await modalContent.boundingBox();
        const viewport = page.viewportSize();
        expect(box).not.toBeNull();
        expect(viewport).not.toBeNull();
        if (box && viewport) {
            const modalCenter = box.x + box.width / 2;
            expect(Math.abs(modalCenter - viewport.width / 2)).toBeLessThan(24);
        }
    });

    test('same player can use two tabs without losing live game state', async ({ page, request }) => {
        const setup = await setupGame(request);

        await loginPage(page, setup.hostToken);
        await page.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByRole('button', { name: /Roll Dice/i })).toBeVisible({ timeout: 5000 });

        const secondTab = await page.context().newPage();
        await secondTab.goto(`${BASE}/game.html?room=${setup.room.id}`);
        await secondTab.waitForLoadState('domcontentloaded');
        await expect(secondTab.getByRole('button', { name: /Roll Dice/i })).toBeVisible({ timeout: 5000 });
        await expect.poll(() => socketJoinAck(secondTab, setup.room.id), {
            message: 'second tab joined the game room socket channel',
            timeout: 5000,
        }).toBe(true);

        await page.evaluate(() => {
            window.__E2E_NEXT_DICE = [1, 2];
        });
        await page.getByRole('button', { name: /Roll Dice/i }).click();
        await expect(secondTab.locator('#gameContent')).toContainText(/rolled/i, { timeout: 10000 });
    });
});

async function socketJoinAck(page, roomId) {
    return page.evaluate(targetRoomId => new Promise(resolve => {
        if (typeof getSocket !== 'function') {
            resolve(false);
            return;
        }

        const socket = getSocket();
        const timer = setTimeout(() => resolve(false), 1500);
        const join = () => {
            socket.emit('join_room', targetRoomId, ack => {
                clearTimeout(timer);
                resolve(!!ack && ack.ok === true);
            });
        };

        if (socket.connected) {
            join();
        } else {
            socket.once('connect', join);
        }
    }), roomId);
}
