// @ts-check
// A player can trade a property into someone else's LLC in exchange for part
// of its shares, starting from the Corporations modal.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

// Sam runs MBS (12 shares, worth $1,200: Pennsylvania Ave $320 + $880 cash).
// Alex owns Boardwalk ($400).
async function setupGame(request) {
    const users = {};
    for (const name of ['Alex', 'Sam']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: { name: 'Property for shares', player_name: 'Alex', max_players: 4 },
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
                    { id: 'prop-bw', name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], ownerId: alexId, ownerName: 'Alex', houses: 0 },
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
                    totalShares: 12,
                    assets: [{ id: 'prop-pa', name: 'Pennsylvania Ave', value: 320, color: 'Green' }],
                    shareholders: [{ userId: samId, name: 'Sam', shares: 12 }],
                    availableShares: 12,
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

async function openGame(browser, room, user) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    return { context, page };
}

test('a player trades a property into an LLC for its shares', async ({ browser, request }) => {
    const { room, game, users } = await setupGame(request);
    const alex = await openGame(browser, room, users.Alex);
    const sam = await openGame(browser, room, users.Sam);

    // Alex starts from MBS in the Corporations modal (it's not his turn).
    await alex.page.click('[data-game-action="open-corporation"]');
    await alex.page.click('[data-game-action="offer-property-for-shares"][data-corp-id="corp-mbs"]');
    await expect(alex.page.locator('#market')).toHaveClass(/active/);
    await expect(alex.page.locator('#player1Destination input[value="corp-mbs"]')).toBeChecked();

    await alex.page.check('#player1Assets input[value="prop-bw"]');
    const shareInput = alex.page.locator('#player2Assets .trade-share-input[data-corp-id="corp-mbs"]');
    await shareInput.fill('4');
    await expect(alex.page.locator('#player2Assets .trade-share-pct')).toHaveText('= 33.3%');

    const preview = alex.page.locator('#tradePreview');
    await expect(preview).toContainText('You put Boardwalk into MBS.');
    await expect(preview).toContainText('Sam gives you 4 of 12 MBS shares (33.3%).');
    await expect(preview).toContainText('$1,200 → $1,600');
    await expect(preview).toContainText('+$133');
    await expect(preview).toContainText('An even trade is 3 of 12 MBS shares (25%)');
    await alex.page.click('[data-game-action="use-even-shares"]');
    await expect(shareInput).toHaveValue('3');
    await expect(preview).toContainText('Your net worth$0');

    await alex.page.click('#executeTradeBtn');
    await expect(alex.page.locator('#market-status')).toContainText('Trade proposal sent');

    // Sam sees the deal from his side, with what it means for him.
    await sam.page.click('.nav-tab[data-section="market"]');
    const offer = sam.page.locator('#tradeOffersList .trade-offer-card');
    await expect(offer).toContainText('Alex puts Boardwalk into MBS.', { timeout: 10000 });
    await expect(offer).toContainText('You give Alex 3 of 12 MBS shares (25%).');
    await expect(offer).toContainText('12 → 9 (100% → 75%)');
    await expect(offer.locator('.trade-asset-tag.property')).toContainText('Into MBS');
    await sam.page.click('[data-game-action="accept-trade-offer"]');
    await expect(sam.page.locator('#market-status')).toContainText('Trade accepted');

    const fetched = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
    });
    const state = fetched.game_state;
    expect(state.properties.find(p => p.id === 'prop-bw')).toMatchObject({ ownerId: 'corp-mbs', ownerName: '[MBS]' });
    const mbs = state.corporations.find(c => c.id === 'corp-mbs');
    expect(mbs.shareholders).toEqual(expect.arrayContaining([
        expect.objectContaining({ userId: users.Alex.user.id, shares: 3 }),
        expect.objectContaining({ userId: users.Sam.user.id, shares: 9 }),
    ]));
    expect(state.players.find(p => p.userId === users.Alex.user.id).corporations[0]).toMatchObject({ ticker: 'MBS', sharesOwned: 3 });

    await alex.context.close();
    await sam.context.close();
});

test('a half-built trade survives another player moving', async ({ browser, request }) => {
    const { room, game, users } = await setupGame(request);
    const alex = await openGame(browser, room, users.Alex);
    await alex.page.click('.nav-tab[data-section="market"]');
    await alex.page.selectOption('#player2Select', users.Sam.user.id);
    await alex.page.check('#player1Assets input[value="prop-bw"]');
    await alex.page.check('#player1Destination input[value="corp-mbs"]');
    await alex.page.locator('#player2Assets .trade-share-input').fill('2');

    // Sam rolls; Alex's screen gets the new game state.
    const current = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${users.Sam.token}` },
    });
    await apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${users.Sam.token}` },
        data: { actionId: `e2e-roll-${Date.now()}`, type: 'roll_dice', payload: {}, expectedVersion: current.state_version },
    });
    await expect.poll(() => alex.page.evaluate(() => currentGame.state_version)).toBeGreaterThan(current.state_version);

    await expect(alex.page.locator('#player1Assets input[value="prop-bw"]')).toBeChecked();
    await expect(alex.page.locator('#player1Destination input[value="corp-mbs"]')).toBeChecked();
    await expect(alex.page.locator('#player2Assets .trade-share-input')).toHaveValue('2');
    await alex.context.close();
});
