// @ts-check
// Borrowing for a corporation from its own sheet: the chairman gets a "Borrow
// for" move that opens Take a new loan with the corporation already chosen;
// everyone else is told who can borrow for it. All through the real UI.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState, openCorporation } = require('./helpers');

const PARK = { id: 'prop-25', name: 'Park Place', color: 'Dark Blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] };
const BOARDWALK = { id: 'prop-26', name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] };

// MBS owns the Dark Blues ($750 book value, so it can borrow up to $675).
// Sam is its chairman with 50%; Alex holds the rest. currentPlayerIndex picks
// whose turn it is (0 Alex, 1 Sam).
async function setupGame(request, currentPlayerIndex = 1) {
    const users = {};
    for (const name of ['Alex', 'Sam']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: { name: 'Corporation borrowing', player_name: 'Alex', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users.Sam.token}` },
        data: { player_name: 'Sam' },
    });
    const ids = { alex: users.Alex.user.id, sam: users.Sam.user.id };
    const owned = prop => ({ ...prop, ownerId: 'corp-mbs', ownerName: '[MBS]', houses: 0 });
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex,
                players: [playerState(ids.alex, 'Alex'), playerState(ids.sam, 'Sam')],
                properties: [owned(PARK), owned(BOARDWALK)],
                corporations: [{
                    id: 'corp-mbs',
                    ticker: 'MBS',
                    name: 'MBS Corporation',
                    founderId: ids.sam,
                    founderName: 'Sam',
                    chairmanId: ids.sam,
                    chairmanName: 'Sam',
                    totalShares: 12000,
                    assets: [PARK, BOARDWALK].map(p => ({ id: p.id, name: p.name, value: p.price, color: p.color })),
                    shareholders: [
                        { userId: ids.sam, name: 'Sam', shares: 6000 },
                        { userId: ids.alex, name: 'Alex', shares: 6000 },
                    ],
                    availableShares: 0,
                    treasuryShares: 0,
                    cash: 100,
                    debts: [],
                    chairmanVotes: [],
                }],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, game, users };
}

async function openGame(browser, room, user, width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    return { context, page };
}

test('the chairman borrows for the corporation from its sheet', async ({ browser, request }) => {
    const { room, game, users } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);

    await openCorporation(sam.page, 'corp-mbs');
    const borrow = sam.page.locator('#corporationModal [data-corp-panel="overview"] [data-game-action="borrow-for-corporation"]');
    await expect(borrow).toBeEnabled();
    await expect(borrow).toContainText('Borrow for MBS');
    await expect(borrow).toContainText('Up to $675');
    await borrow.click();

    // Manage Debt opens on Take a new loan, borrowing as MBS.
    await expect(sam.page.locator('#corporationModal')).not.toHaveClass(/active/);
    await expect(sam.page.locator('#debtModal')).toHaveClass(/active/);
    await expect(sam.page.locator('#debtAction')).toHaveValue('issue');
    await expect(sam.page.locator('#debtIssuer')).toHaveValue('corporation:corp-mbs');
    await expect(sam.page.locator('#loanLimit')).toContainText("MBS's properties");

    await sam.page.fill('#loanAmount', '200');
    await sam.page.click('#process-debt-btn');
    await expect.poll(async () => {
        const fetched = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
            headers: { Authorization: `Bearer ${users.Sam.token}` },
        });
        return fetched.game_state.corporations[0].cash;
    }).toBe(300);

    // The Debt tab offers the same move.
    await openCorporation(sam.page, 'corp-mbs', 'debt');
    await expect(sam.page.locator('#corporationModal [data-corp-panel="debt"] [data-game-action="borrow-for-corporation"]')).toBeVisible();
    await sam.context.close();
});

test("a shareholder who isn't chairman is told who can borrow", async ({ browser, request }) => {
    const { room, users } = await setupGame(request, 0);
    const alex = await openGame(browser, room, users.Alex);
    await openCorporation(alex.page, 'corp-mbs', 'debt');
    await expect(alex.page.locator('#corporationModal [data-corp-panel="debt"]')).toContainText("Only MBS's chairman, Sam, can borrow for it.");
    await expect(alex.page.locator('[data-game-action="borrow-for-corporation"]')).toHaveCount(0);
    await alex.context.close();
});

test('off their turn, the chairman sees the move disabled', async ({ browser, request }) => {
    const { room, users } = await setupGame(request, 0);
    const sam = await openGame(browser, room, users.Sam);
    await openCorporation(sam.page, 'corp-mbs');
    const borrow = sam.page.locator('#corporationModal [data-corp-panel="overview"] [data-game-action="borrow-for-corporation"]');
    await expect(borrow).toBeDisabled();
    await expect(borrow).toContainText('On your turn');
    await sam.context.close();
});

test('the chairman builds houses for the corporation from its Properties tab', async ({ browser, request }) => {
    const { room, users } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);
    await openCorporation(sam.page, 'corp-mbs', 'assets');
    const build = sam.page.locator('#corporationModal [data-corp-panel="assets"] [data-game-action="build-for-corporation"]');
    await expect(build).toBeEnabled();
    await expect(build).toHaveText('Build houses');
    await build.click();

    // The house sheet opens building for MBS, on its Dark Blues.
    await expect(sam.page.locator('#corporationModal')).not.toHaveClass(/active/);
    await expect(sam.page.locator('#houseModal')).toHaveClass(/active/);
    await expect(sam.page.locator('#houseBuildFor')).toHaveValue('corp-mbs');
    await expect(sam.page.locator('#houseModalProperties')).toContainText('Park Place');
    await expect(sam.page.locator('#houseModalProperties')).toContainText('Boardwalk');
    await sam.context.close();

    // Alex doesn't run MBS: no build move in its Properties tab.
    const alex = await openGame(browser, room, users.Alex);
    await openCorporation(alex.page, 'corp-mbs', 'assets');
    await expect(alex.page.locator('[data-game-action="build-for-corporation"]')).toHaveCount(0);
    await alex.context.close();
});
