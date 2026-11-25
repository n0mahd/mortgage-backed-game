// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, loginPage, playerState } = require('./helpers');

/**
 * Create a game where the current player is at a specific position.
 */
async function setupGameAt(request, position, opts = {}) {
    const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
    const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();

    const room = await (await request.post(`${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${h.token}` },
        data: { name: 'Mechanics Room', player_name: 'Alice', max_players: 4 },
    })).json();

    await request.post(`${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${g.token}` },
        data: { player_name: 'Bob' },
    });

    const gameState = {
        currentPlayerIndex: 0,
        players: [
            playerState(h.user.id, 'Alice', { position, inJail: opts.inJail || false }),
            playerState(g.user.id, 'Bob'),
        ],
        properties: opts.properties || [],
        corporations: [],
        debts: [],
        lastDiceRoll: opts.lastDiceRoll || null,
        lastCardDrawn: null,
        settings: { passGoAmount: 200, startingCash: 1500 },
    };

    const game = await (await request.post(`${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${h.token}` },
        data: { room_id: room.id, game_state: gameState },
    })).json();

    return { room, game, hostToken: h.token, guestToken: g.token, hostId: h.user.id, guestId: g.user.id };
}

test.describe('Game mechanics — via API state patching', () => {
    test('inJail state is stored and retrieved correctly', async ({ request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Jail Test Room', player_name: 'Alice', max_players: 2 },
        })).json();

        const gameState = {
            currentPlayerIndex: 0,
            players: [
                playerState(h.user.id, 'Alice', { position: 10, inJail: true }),
            ],
            properties: [], corporations: [], debts: [], lastDiceRoll: null, lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
        };

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: gameState },
        })).json();

        // Retrieve game and verify jail state
        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.players[0].inJail).toBe(true);
        expect(fetched.game_state.players[0].position).toBe(10);
    });

    test('bankrupt player state persists correctly', async ({ request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Bankrupt Room', player_name: 'Alice', max_players: 2 },
        })).json();

        const gameState = {
            currentPlayerIndex: 0,
            players: [
                playerState(h.user.id, 'Alice', { cash: -100, bankrupt: true }),
            ],
            properties: [], corporations: [], debts: [], lastDiceRoll: null, lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
        };

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: gameState },
        })).json();

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.players[0].bankrupt).toBe(true);
        expect(fetched.game_state.players[0].cash).toBe(-100);
    });

    test('property ownership state persists correctly', async ({ request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Property Room', player_name: 'Alice', max_players: 2 },
        })).json();

        const gameState = {
            currentPlayerIndex: 0,
            players: [
                playerState(h.user.id, 'Alice', { cash: 1440, position: 1 }),
            ],
            properties: [
                { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: h.user.id, ownerName: 'Alice', houses: 0 },
            ],
            corporations: [], debts: [], lastDiceRoll: null, lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
        };

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: gameState },
        })).json();

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.properties[0].ownerId).toBe(h.user.id);
        expect(fetched.game_state.players[0].cash).toBe(1440);
    });

    test('house count persists on property', async ({ request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'House Room', player_name: 'Alice', max_players: 2 },
        })).json();

        const gameState = {
            currentPlayerIndex: 0,
            players: [
                playerState(h.user.id, 'Alice', { cash: 1300 }),
            ],
            properties: [
                { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: h.user.id, ownerName: 'Alice', houses: 3 },
                { id: 'prop-1', name: 'Baltic Ave', color: 'Brown', price: 60, rent: [4, 20, 60, 180, 320, 450], ownerId: h.user.id, ownerName: 'Alice', houses: 3 },
            ],
            corporations: [], debts: [], lastDiceRoll: null, lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
        };

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: gameState },
        })).json();

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.properties[0].houses).toBe(3);
        expect(fetched.game_state.properties[1].houses).toBe(3);
    });

    test('end turn action changes current player index', async ({ request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Turn Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });

        const gameState = {
            currentPlayerIndex: 0,
            players: [
                playerState(h.user.id, 'Alice', { diceRolled: true }),
                playerState(g.user.id, 'Bob'),
            ],
            properties: [], corporations: [], debts: [], lastDiceRoll: [3, 4], lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
        };

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: gameState },
        })).json();

        await request.post(`${BASE_API}/games/${game.id}/actions`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { actionId: `e2e-end-turn-${Date.now()}`, type: 'end_turn', payload: {}, expectedVersion: game.state_version },
        });

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.currentPlayerIndex).toBe(1);
    });

    test('debt state persists in game_state', async ({ request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Debt Room', player_name: 'Alice', max_players: 2 },
        })).json();

        const debt = { id: 'debt-1', issuerId: h.user.id, principal: 500, interestRate: 0.1, turnsOutstanding: 2 };
        const gameState = {
            currentPlayerIndex: 0,
            players: [
                playerState(h.user.id, 'Alice', { cash: 2000 }),
            ],
            properties: [], corporations: [],
            debts: [debt],
            lastDiceRoll: null, lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
        };

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: gameState },
        })).json();

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.debts).toHaveLength(1);
        expect(fetched.game_state.debts[0].principal).toBe(500);
    });
});

test.describe('Game mechanics — UI', () => {
    test('game.html shows only the moves you can take: no IPO without property', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'IPO UI Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice'),
                    playerState(g.user.id, 'Bob'),
                ],
                properties: [], corporations: [], debts: [], lastDiceRoll: null, lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        })).json();

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Only moves you can take now: Borrow, but no IPO without a property to put in one.
        await expect(page.locator('#game .move-tools [data-game-action="open-debt"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#game [data-game-action="open-ipo"]')).toHaveCount(0);
    });

    test('negative current-player cash shows bankruptcy warning before end turn', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Negative Cash UI Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', { cash: -25, diceRolled: true }),
                    playerState(g.user.id, 'Bob'),
                ],
                properties: [],
                corporations: [],
                debts: [],
                lastDiceRoll: [3, 4],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        });

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning.danger')).toContainText('below zero', { timeout: 5000 });
        await expect(page.locator('.action-btn-end-turn')).toHaveText('Declare Bankruptcy');
    });

    test('after rolling doubles to leave Jail, the UI offers the landing instead of another Roll Dice', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Jail Doubles UI Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', { position: 14, diceRolled: true }),
                    playerState(g.user.id, 'Bob'),
                ],
                properties: [],
                corporations: [],
                debts: [],
                gameLog: [{
                    timestamp: new Date().toISOString(),
                    message: 'Alice rolled 2+2=4 - moved to Virginia Ave',
                }],
                lastDiceRoll: [2, 2],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        })).json();

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        // Virginia Ave is unowned: the dock offers Auction and Buy, and no second roll.
        await expect(page.locator('#gameContent .turn-ticket .ticket-title')).toContainText('Your turn');
        await expect(page.locator('.turn-dock [data-game-action="buy-property"]')).toHaveText('Buy $160');
        await expect(page.locator('.turn-dock [data-game-action="start-auction"]')).toBeVisible();
        await expect(page.locator('[data-game-action="roll-dice"]')).toHaveCount(0);

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        const alice = fetched.game_state.players.find(player => player.userId === h.user.id);
        expect(alice.inJail).toBe(false);
        expect(alice.position).toBe(14);
        expect(alice.diceRolled).toBe(true);
        expect(alice.doubleCount).toBe(0);
    });

    test('after forced third-turn Jail bail, the UI shows bankruptcy warning when cash is below zero', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Jail Bail Warning Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', { cash: -25, position: 13, diceRolled: true }),
                    playerState(g.user.id, 'Bob'),
                ],
                properties: [],
                corporations: [],
                debts: [],
                gameLog: [{
                    timestamp: new Date().toISOString(),
                    message: 'Alice paid $50 bail after their third Jail turn.',
                }],
                lastDiceRoll: [1, 2],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        })).json();

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning.danger')).toContainText('below zero', { timeout: 5000 });
        await expect(page.locator('.action-btn-end-turn')).toHaveText('Declare Bankruptcy');

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        const alice = fetched.game_state.players.find(player => player.userId === h.user.id);
        expect(alice.inJail).toBe(false);
        expect(alice.cash).toBe(-25);
        expect(alice.diceRolled).toBe(true);
    });

    test('declaring bankruptcy releases direct properties and advances to next active player', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const c = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Bankruptcy Liquidation Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${c.token}` },
            data: { player_name: 'Carol' },
        });

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', {
                        cash: -25,
                        diceRolled: true,
                        debts: [{ id: 'debt-alice', issuerId: h.user.id, principal: 100, interestRate: 0, turnsOutstanding: 0 }],
                    }),
                    playerState(g.user.id, 'Bob'),
                    playerState(c.user.id, 'Carol'),
                ],
                properties: [
                    { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: h.user.id, ownerName: 'Alice', houses: 3 },
                ],
                corporations: [],
                debts: [],
                lastDiceRoll: [3, 4],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        })).json();

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning.danger')).toContainText('below zero', { timeout: 5000 });
        await expect(page.locator('.seat.is-me')).toContainText('Mediterranean Ave');

        await Promise.all([
            page.waitForResponse(response => response.url().includes(`/games/${game.id}/actions`) && response.status() === 200),
            page.locator('.action-btn-end-turn').click(),
        ]);

        const liquidationModal = page.locator('#liquidationModal');
        await expect(liquidationModal).toBeVisible({ timeout: 5000 });
        await expect(liquidationModal).toContainText('Alice is bankrupt');
        await expect(liquidationModal).toContainText("Alice couldn't pay the Bank");
        await expect(liquidationModal).toContainText('Mediterranean Ave to the Bank, without houses');
        await expect(liquidationModal).toContainText(/Loans\s*Cleared/);
        await liquidationModal.locator('button', { hasText: 'OK' }).click();
        await expect(liquidationModal).toBeHidden();

        await expect(page.locator('.turn-strip-title')).toContainText('Bob', { timeout: 5000 });
        await expect(page.locator('.seat.is-me')).toContainText('Bankrupt');
        await expect(page.locator('.seat.is-me')).not.toContainText('Mediterranean Ave');

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.currentPlayerIndex).toBe(1);
        expect(fetched.game_state.players[0].bankrupt).toBe(true);
        expect(fetched.game_state.players[0].debts).toEqual([]);
        expect(fetched.game_state.players[0].properties).toEqual([]);
        expect(fetched.game_state.properties[0].ownerId).toBeNull();
        expect(fetched.game_state.properties[0].ownerName).toBeNull();
        expect(fetched.game_state.properties[0].houses).toBe(0);
    });

    async function seedCoveredClaimGame(request, { cash, debtPrincipal, debtTerms = {}, diceRolled = true }) {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Covered Claim Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        const debt = { id: 'debt-test', principal: debtPrincipal, interestRate: 10, issueDate: new Date().toISOString(), issuerType: 'player', ...debtTerms };
        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', { cash, position: 5, diceRolled, debts: [debt] }),
                    playerState(g.user.id, 'Bob', { cash: 1500 }),
                ],
                properties: [
                    { id: 'prop-rr-1', name: 'Reading RR', price: 200, ownerId: g.user.id, ownerName: 'Bob', houses: 0 },
                ],
                corporations: [],
                debts: [],
                bankruptcyClaims: {
                    [h.user.id]: {
                        debtorId: h.user.id,
                        debtorName: 'Alice',
                        creditorId: g.user.id,
                        creditorName: 'Bob',
                        creditorType: 'player',
                        reason: 'Rent for Reading RR',
                        amountOwed: 200,
                        paidAmount: 27,
                        unpaidAmount: 173,
                        createdAt: new Date().toISOString(),
                    },
                },
                lastDiceRoll: [4, 1],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        })).json();
        return { h, g, room, game };
    }

    test('an unpaid claim that cash now covers is paid by End Turn without bankruptcy', async ({ page, request }) => {
        const { h, g, room, game } = await seedCoveredClaimGame(request, { cash: 1000, debtPrincipal: 500 });

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        const warning = page.locator('.turn-warning');
        await expect(warning).toContainText('You owe $173 to Bob', { timeout: 5000 });
        // The claim is paid first, then autopay takes the loan's $81.37 installment.
        await expect(warning).toContainText('then $81.37 in loan payments, leaving you $745.63');
        await expect(warning).not.toHaveClass(/danger/);
        const endTurn = page.locator('.action-btn-end-turn');
        await expect(endTurn).toHaveText('Pay $173 & End Turn');
        await expect(endTurn).not.toHaveClass(/btn-danger/);

        await Promise.all([
            page.waitForResponse(response => response.url().includes(`/games/${game.id}/actions`) && response.status() === 200),
            endTurn.click(),
        ]);

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        const alice = fetched.game_state.players.find(player => player.userId === h.user.id);
        const bob = fetched.game_state.players.find(player => player.userId === g.user.id);
        expect(alice.bankrupt).toBe(false);
        expect(alice.cash).toBe(745.63);
        expect(bob.cash).toBe(1673);
        expect(fetched.game_state.bankruptcyClaims[h.user.id]).toBeUndefined();
        expect(fetched.game_state.currentPlayerIndex).toBe(1);
    });

    // diceRolled false with lastDiceRoll set: the claim came from a doubles roll.
    test('after doubles an unpaid claim that cash covers is paid by Roll Again', async ({ page, request }) => {
        const { h, g, room, game } = await seedCoveredClaimGame(request, { cash: 1000, debtPrincipal: 500, diceRolled: false });

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning')).toContainText('Roll Again pays it from your cash first, leaving you $827', { timeout: 5000 });
        await expect(page.locator('.action-btn-end-turn')).toHaveCount(0);
        const roll = page.locator('.turn-dock [data-game-action="roll-dice"]');
        await expect(roll).toHaveText('Pay $173 & Roll Again');

        await Promise.all([
            page.waitForResponse(response => response.url().includes(`/games/${game.id}/actions`) && response.status() === 200),
            roll.click(),
        ]);

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.bankruptcyClaims[h.user.id]).toBeUndefined();
        expect(fetched.game_state.players.find(player => player.userId === g.user.id).cash).toBeGreaterThanOrEqual(1673);
        expect(fetched.game_state.players.find(player => player.userId === h.user.id).position).not.toBe(5);
    });

    test('after doubles an unpaid claim cash cannot cover blocks Roll Again and opens End Turn', async ({ page, request }) => {
        const { h, room, game } = await seedCoveredClaimGame(request, { cash: 100, debtPrincipal: 500, diceRolled: false });

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning.danger')).toContainText('You owe Bob $173 and are $73 short. Raise it to roll again', { timeout: 5000 });
        await expect(page.locator('.turn-dock [data-game-action="roll-dice"]')).toHaveCount(0);
        const endTurn = page.locator('.action-btn-end-turn');
        await expect(endTurn).toHaveText('Declare Bankruptcy');
        await expect(endTurn).toBeEnabled();

        await Promise.all([
            page.waitForResponse(response => response.url().includes(`/games/${game.id}/actions`) && response.status() === 200),
            endTurn.click(),
        ]);
        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        expect(fetched.game_state.players.find(player => player.userId === h.user.id).bankrupt).toBe(true);
    });

    test('a loan coming due that leaves too little after the claim warns of bankruptcy', async ({ page, request }) => {
        // $900 at 10% on its last turn: $990 due after the $173 claim leaves $827.
        const { h, room } = await seedCoveredClaimGame(request, { cash: 1000, debtPrincipal: 900, debtTerms: { termTurns: 5, turnsRemaining: 1 } });

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning.danger')).toContainText('You owe Bob $173 and are $163 short', { timeout: 5000 });
        await expect(page.locator('.action-btn-end-turn')).toHaveText('Declare Bankruptcy');
    });

    test('unpaid rent claim shows creditor warning and transfers assets to the creditor on bankruptcy', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const c = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Creditor Bankruptcy Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${c.token}` },
            data: { player_name: 'Carol' },
        });

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', { cash: 0, position: 39, diceRolled: true }),
                    playerState(g.user.id, 'Bob', { cash: 1520 }),
                    playerState(c.user.id, 'Carol'),
                ],
                properties: [
                    { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: h.user.id, ownerName: 'Alice', houses: 2 },
                    { id: 'prop-26', name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], ownerId: g.user.id, ownerName: 'Bob', houses: 0 },
                ],
                corporations: [],
                debts: [],
                bankruptcyClaims: {
                    [h.user.id]: {
                        debtorId: h.user.id,
                        debtorName: 'Alice',
                        creditorId: g.user.id,
                        creditorName: 'Bob',
                        creditorType: 'player',
                        reason: 'Rent for Boardwalk',
                        propertyId: 'prop-26',
                        propertyName: 'Boardwalk',
                        amountOwed: 50,
                        paidAmount: 20,
                        unpaidAmount: 30,
                        createdAt: new Date().toISOString(),
                    },
                },
                lastDiceRoll: [1, 2],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            }},
        })).json();

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.turn-warning.danger')).toContainText('You owe Bob $30', { timeout: 5000 });
        await expect(page.locator('.action-btn-end-turn')).toHaveText('Declare Bankruptcy');

        await Promise.all([
            page.waitForResponse(response => response.url().includes(`/games/${game.id}/actions`) && response.status() === 200),
            page.locator('.action-btn-end-turn').click(),
        ]);

        const liquidationModal = page.locator('#liquidationModal');
        await expect(liquidationModal).toBeVisible({ timeout: 5000 });
        await expect(liquidationModal).toContainText('Alice is bankrupt');
        await expect(liquidationModal).toContainText("Alice couldn't pay Bob");
        await expect(liquidationModal).toContainText('Mediterranean Ave to Bob');
        await expect(liquidationModal).toContainText(/Loans\s*Cleared/);
        await liquidationModal.locator('button', { hasText: 'OK' }).click();
        await expect(liquidationModal).toBeHidden();

        await expect(page.locator('.turn-strip-title')).toContainText('Bob', { timeout: 5000 });
        await expect(page.locator('.seat.is-me')).toContainText('Bankrupt');
        await expect(page.locator('.seat.is-me')).not.toContainText('Mediterranean Ave');

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        const transferredProperty = fetched.game_state.properties.find(prop => prop.id === 'prop-0');
        const boardwalk = fetched.game_state.properties.find(prop => prop.id === 'prop-26');
        expect(fetched.game_state.bankruptcyClaims[h.user.id]).toBeUndefined();
        expect(fetched.game_state.players.find(player => player.userId === h.user.id).bankrupt).toBe(true);
        expect(fetched.game_state.players.find(player => player.userId === g.user.id).cash).toBe(1520);
        expect(transferredProperty.ownerId).toBe(g.user.id);
        expect(transferredProperty.ownerName).toBe('Bob');
        expect(transferredProperty.houses).toBe(0);
        expect(boardwalk.ownerId).toBe(g.user.id);
    });

    test('corporation insolvency is visible and closes corporation controls', async ({ page, request }) => {
        const h = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const g = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const c = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { name: 'Corporation Insolvency Room', player_name: 'Alice', max_players: 4 },
        })).json();
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${g.token}` },
            data: { player_name: 'Bob' },
        });
        await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${c.token}` },
            data: { player_name: 'Carol' },
        });

        const game = await (await request.post(`${BASE_API}/games`, {
            headers: { Authorization: `Bearer ${h.token}` },
            data: { room_id: room.id, game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(h.user.id, 'Alice', { diceRolled: true }),
                    playerState(g.user.id, 'Bob'),
                    playerState(c.user.id, 'Carol'),
                ],
                properties: [
                    { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: 'corp-1', ownerName: '[MBS]', houses: 3 },
                ],
                corporations: [{
                    id: 'corp-1',
                    ticker: 'MBS',
                    name: 'MBS Corporation',
                    founderId: h.user.id,
                    founderName: 'Alice',
                    chairmanId: h.user.id,
                    chairmanName: 'Alice',
                    totalShares: 8,
                    availableShares: 5,
                    treasuryShares: 5,
                    assets: [{ id: 'prop-0', name: 'Mediterranean Ave', value: 60, color: 'Brown' }],
                    shareholders: [
                        { userId: g.user.id, name: 'Bob', shares: 2 },
                        { userId: c.user.id, name: 'Carol', shares: 1 },
                    ],
                    debts: [{ id: 'corp-debt-1', principal: 100, interestRate: 5, termTurns: 5, turnsRemaining: 1, issuerType: 'corporation' }],
                    cash: 1,
                    chairmanVotes: [{
                        id: 'vote-1',
                        type: 'chairman',
                        status: 'open',
                        candidateUserId: g.user.id,
                        candidateName: 'Bob',
                        supporters: [{ userId: g.user.id, name: 'Bob' }],
                        createdBy: g.user.id,
                        createdAt: '2026-01-01T00:00:00.000Z',
                    }],
                }],
                debts: [],
                marketOffers: [],
                gameLog: [],
                lastDiceRoll: [3, 4],
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
            }},
        })).json();

        await loginPage(page, h.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await page.waitForLoadState('domcontentloaded');

        await Promise.all([
            page.waitForResponse(response => response.url().includes(`/games/${game.id}/actions`) && response.status() === 200),
            page.locator('.action-btn-end-turn').click(),
        ]);

        await expect(page.locator('#full-game-log')).toContainText('MBS became insolvent', { timeout: 5000 });
        await page.getByRole('button', { name: 'Corporations' }).click();

        const modal = page.locator('#corporationModal');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.locator('.corp-summary')).toContainText('Insolvent');
        await modal.locator('.corp-summary').first().click();
        await expect(modal).toContainText('Insolvent');
        await expect(modal).toContainText('Properties returned to the Bank');
        await expect(modal).toContainText('Governance closed after insolvency');
        await expect(modal).toContainText('No assets');
        await expect(modal.locator('[data-corp-panel="debt"]')).toHaveCount(0);
        await expect(modal.getByRole('button', { name: /^Buy$/ })).toHaveCount(0);

        const fetched = await (await request.get(`${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${h.token}` },
        })).json();
        const corporation = fetched.game_state.corporations.find(item => item.id === 'corp-1');
        const releasedProperty = fetched.game_state.properties.find(prop => prop.id === 'prop-0');

        expect(corporation.insolvent).toBe(true);
        expect(corporation.status).toBe('insolvent');
        expect(corporation.shareholders).toEqual([]);
        expect(corporation.debts).toEqual([]);
        expect(corporation.chairmanVotes[0].closeReason).toBe('corporation_insolvent');
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.houses).toBe(0);
    });
});
