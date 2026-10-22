// @ts-check
// An IPO has no price per share: the form asks only for a ticker, a share
// count and properties. Treasury shares sell at the corporation's NAV.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

async function setupGame(request) {
    const alice = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: { name: 'IPO Room', player_name: 'Alice', max_players: 4 },
    });
    const bob = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${bob.token}` },
        data: { player_name: 'Bob' },
    });
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [playerState(alice.user.id, 'Alice'), playerState(bob.user.id, 'Bob')],
                properties: [
                    { id: 'prop-0', name: 'Mediterranean Ave', color: 'Brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: alice.user.id, ownerName: 'Alice', houses: 0 },
                ],
                corporations: [{
                    // $600 of treasury cash over 12 shares: NAV is $50 a share.
                    id: 'corp-trsy',
                    ticker: 'TRSY',
                    name: 'TRSY Corporation',
                    founderId: alice.user.id,
                    founderName: 'Alice',
                    chairmanId: alice.user.id,
                    chairmanName: 'Alice',
                    totalShares: 12,
                    availableShares: 3,
                    treasuryShares: 3,
                    assets: [],
                    shareholders: [{ userId: alice.user.id, name: 'Alice', shares: 9 }],
                    debts: [],
                    cash: 600,
                }],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, alice };
}

async function openGame(browser, room, user) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    await page.click('.nav-tab[data-section="game"]');
    return { context, page };
}

const gameButton = (page, action) => page.locator(`#game.section.active button[data-game-action="${action}"]`).first();

test('an IPO is created without a price, and treasury shares sell at NAV', async ({ browser, request }) => {
    const { room, alice } = await setupGame(request);
    const { context, page } = await openGame(browser, room, alice);

    await gameButton(page, 'open-ipo').click();
    await expect(page.locator('#ipoModal')).toBeVisible();
    await expect(page.locator('#ipoModal')).not.toContainText(/price/i);
    await page.locator('#ipoTicker').fill('BRWN');
    // Every company issues 1,000 shares; there's no share-count field.
    await expect(page.locator('#ipoShares')).toHaveCount(0);
    await expect(page.locator('#ipoModal')).toContainText('1,000 shares');
    await page.locator('#ipo-asset-prop-0').check();
    await page.locator('#create-ipo-btn').click();
    await expect(page.locator('#ipoModal')).toBeHidden();

    await gameButton(page, 'open-corporation').click();
    const cards = page.locator('#corporationModal .corporation-card');
    const brwn = cards.filter({ hasText: 'BRWN' });
    await expect(brwn).toContainText('Total Shares: 1000 | NAV: $0.06/share');
    const trsy = cards.filter({ hasText: 'TRSY' });
    await expect(trsy).toContainText('Treasury shares for sale: 3 at $50 each (NAV)');
    await expect(cards.first()).not.toContainText('Price:');

    await page.locator('#buyShares-corp-trsy').fill('2');
    await trsy.locator('button[data-game-action="buy-shares"]').click();
    await expect(page.locator('#corporationModal')).toBeHidden();
    await page.click('.nav-tab[data-section="log"]');
    await expect(page.locator('#log')).toContainText('bought 2 share(s) of TRSY (2 from treasury) for $100.00');
    const corp = await page.evaluate(() => currentGame.game_state.corporations.find(c => c.ticker === 'TRSY'));
    expect(corp.cash).toBe(700);
    expect(corp.treasuryShares).toBe(1);

    await context.close();
});
