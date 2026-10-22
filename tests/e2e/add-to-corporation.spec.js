// @ts-check
// Whoever runs an LLC can put more of their own properties into it from the
// Corporations modal, taking whole new shares or giving the property outright.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

// Sam runs MBS (10 shares, worth $1,200: Pennsylvania Ave $320 + $880 cash) and
// holds 7; Alex holds 3. Sam owns Illinois Ave ($240) and it is Sam's turn.
async function setupGame(request) {
    const users = {};
    for (const name of ['Alex', 'Sam']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: { name: 'Add to corporation', player_name: 'Alex', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users.Sam.token}` },
        data: { player_name: 'Sam' },
    });
    const alexId = users.Alex.user.id;
    const samId = users.Sam.user.id;
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 1,
                players: [playerState(alexId, 'Alex'), playerState(samId, 'Sam')],
                properties: [
                    { id: 'prop-il', name: 'Illinois Ave', color: 'Red', price: 240, rent: [20, 100, 300, 750, 925, 1100], ownerId: samId, ownerName: 'Sam', houses: 0 },
                    { id: 'prop-pa', name: 'Pennsylvania Ave', color: 'Green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], ownerId: 'corp-mbs', ownerName: '[MBS]', houses: 0 },
                ],
                corporations: [{
                    id: 'corp-mbs',
                    ticker: 'MBS',
                    name: 'MBS Corporation',
                    founderId: samId,
                    founderName: 'Sam',
                    chairmanId: samId,
                    chairmanName: 'Sam',
                    totalShares: 10,
                    assets: [{ id: 'prop-pa', name: 'Pennsylvania Ave', value: 320, color: 'Green' }],
                    shareholders: [{ userId: samId, name: 'Sam', shares: 7 }, { userId: alexId, name: 'Alex', shares: 3 }],
                    availableShares: 0,
                    treasuryShares: 0,
                    cash: 880,
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

test('the chairman adds a property to their LLC for new shares', async ({ browser, request }) => {
    const { room, game, users } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);
    const alex = await openGame(browser, room, users.Alex);

    // Alex doesn't run MBS, so he can't add to it.
    await alex.page.click('[data-game-action="open-corporation"]');
    await expect(alex.page.locator('#corporationModal')).toHaveClass(/active/);
    await expect(alex.page.locator('[data-game-action="open-add-to-corporation"]')).toHaveCount(0);

    await sam.page.click('[data-game-action="open-corporation"]');
    await expect(sam.page.locator('[data-game-action="offer-property-for-shares"]')).toHaveCount(0);
    await sam.page.click('[data-game-action="open-add-to-corporation"][data-corp-id="corp-mbs"]');
    const modal = sam.page.locator('#addToCorpModal');
    await expect(modal).toHaveClass(/active/);
    await expect(sam.page.locator('#addToCorpTitle')).toHaveText('Add properties to MBS');
    await expect(sam.page.locator('#add-to-corp-btn')).toBeDisabled();

    await sam.page.check('#addToCorpAssets input[value="prop-il"]');
    const sharesChoice = sam.page.locator('#addToCorpShares input[value="shares"]');
    await expect(sharesChoice).toBeChecked();
    await expect(sam.page.locator('#addToCorpShares')).toContainText('2 new shares');
    const preview = sam.page.locator('#addToCorpPreview');
    await expect(preview).toContainText('You put Illinois Ave into MBS and get 2 new shares.');
    await expect(preview).toContainText('$1,200 → $1,440');
    await expect(preview).toContainText('7 of 10 → 9 of 12 (75%)');
    await expect(preview).toContainText('Your net worth$0');

    // A gift instead: Alex's 3 shares gain $72.
    await sam.page.check('#addToCorpShares input[value="gift"]');
    await expect(preview).toContainText('The other MBS holders gain $72');
    await expect(preview).toContainText('7 of 10 → 7 of 10');

    await sharesChoice.check();
    await sam.page.click('#add-to-corp-btn');
    await expect(modal).not.toHaveClass(/active/);

    const fetched = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${users.Sam.token}` },
    });
    const state = fetched.game_state;
    expect(state.properties.find(p => p.id === 'prop-il')).toMatchObject({ ownerId: 'corp-mbs', ownerName: '[MBS]' });
    const mbs = state.corporations.find(c => c.id === 'corp-mbs');
    expect(mbs.totalShares).toBe(12);
    expect(mbs.shareholders).toEqual(expect.arrayContaining([
        expect.objectContaining({ userId: users.Sam.user.id, shares: 9 }),
        expect.objectContaining({ userId: users.Alex.user.id, shares: 3 }),
    ]));

    // Alex sees the new share count without reloading.
    await expect.poll(() => alex.page.evaluate(() => currentGame.game_state.corporations[0].totalShares)).toBe(12);

    await alex.context.close();
    await sam.context.close();
});

test('the add-properties sheet fits a 320px phone', async ({ browser, request }) => {
    const { room, users } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam, 320);
    await sam.page.click('[data-game-action="open-corporation"]');
    await sam.page.click('[data-game-action="open-add-to-corporation"][data-corp-id="corp-mbs"]');
    await sam.page.check('#addToCorpAssets input[value="prop-il"]');
    await expect(sam.page.locator('#addToCorpPreview')).toBeVisible();
    const overflow = await sam.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await sam.page.screenshot({ path: 'test-results/add-to-corporation-320.png', fullPage: false });
    await sam.context.close();
});
