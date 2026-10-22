// @ts-check
// Running a corporation from the Corporations sheet: rent policy, dividends,
// property offers (offer, counter, accept), trading as the company, buying a
// property for it, all through the real UI.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState } = require('./helpers');

const PARK = { id: 'prop-25', name: 'Park Place', color: 'Dark Blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] };
const BOARDWALK = { id: 'prop-26', name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] };
const ILLINOIS = { id: 'prop-15', name: 'Illinois Avenue', color: 'Red', price: 240, rent: [20, 100, 300, 750, 925, 1100] };
const KENTUCKY = { id: 'prop-13', name: 'Kentucky Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] };

// MBS: 1,000 shares (Sam 500, Alex 300, Kim 200), owns the Dark Blues and has
// $600 in its treasury: worth $1,350, so $1.35 a share. It is Sam's turn.
async function setupGame(request, { samOverrides = {}, illinoisOwner = 'alex' } = {}) {
    const users = {};
    for (const name of ['Alex', 'Sam', 'Kim']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: { name: 'Corporation management', player_name: 'Alex', max_players: 4 },
    });
    for (const name of ['Sam', 'Kim']) {
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${users[name].token}` },
            data: { player_name: name },
        });
    }
    const ids = { alex: users.Alex.user.id, sam: users.Sam.user.id, kim: users.Kim.user.id };
    const owned = (prop, ownerId, ownerName) => ({ ...prop, ownerId, ownerName, houses: 0 });
    const illinois = illinoisOwner
        ? owned(ILLINOIS, ids[illinoisOwner], illinoisOwner === 'alex' ? 'Alex' : 'Sam')
        : owned(ILLINOIS, null, null);
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users.Alex.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 1,
                players: [playerState(ids.alex, 'Alex'), playerState(ids.sam, 'Sam', samOverrides), playerState(ids.kim, 'Kim')],
                properties: [
                    owned(PARK, 'corp-mbs', '[MBS]'),
                    owned(BOARDWALK, 'corp-mbs', '[MBS]'),
                    illinois,
                    owned(KENTUCKY, ids.kim, 'Kim'),
                ],
                corporations: [{
                    id: 'corp-mbs',
                    ticker: 'MBS',
                    name: 'MBS Corporation',
                    founderId: ids.sam,
                    founderName: 'Sam',
                    chairmanId: ids.sam,
                    chairmanName: 'Sam',
                    totalShares: 1000,
                    assets: [
                        { id: PARK.id, name: PARK.name, value: PARK.price, color: PARK.color },
                        { id: BOARDWALK.id, name: BOARDWALK.name, value: BOARDWALK.price, color: BOARDWALK.color },
                    ],
                    shareholders: [
                        { userId: ids.sam, name: 'Sam', shares: 500 },
                        { userId: ids.alex, name: 'Alex', shares: 300 },
                        { userId: ids.kim, name: 'Kim', shares: 200 },
                    ],
                    availableShares: 0,
                    treasuryShares: 0,
                    cash: 600,
                    debts: [],
                    chairmanVotes: [],
                }],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, game, users, ids };
}

async function openGame(browser, room, user, width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    return { context, page };
}

async function fetchState(request, game, user) {
    const fetched = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
    });
    return fetched.game_state;
}

function cashOf(state, userId) {
    return state.players.find(p => p.userId === userId).cash;
}

test('the chairman switches to Payout and pays a dividend', async ({ browser, request }) => {
    const { room, game, users, ids } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);
    const alex = await openGame(browser, room, users.Alex);

    // Alex holds 30% but doesn't run MBS: he sees the policy, not the switch.
    await alex.page.click('[data-game-action="open-corporation"]');
    await expect(alex.page.locator('.corp-rent-policy')).toContainText('Rent policy: Reinvest');
    await expect(alex.page.locator('[data-game-action="set-rent-policy"]')).toHaveCount(0);
    await expect(alex.page.locator('[data-game-action="pay-dividend"]')).toHaveCount(0);

    await sam.page.click('[data-game-action="open-corporation"]');
    await sam.page.click('[data-game-action="set-rent-policy"][data-policy="payout"]');
    await expect(sam.page.locator('.corp-rent-policy')).toContainText('Rent policy: Payout');
    await expect(sam.page.locator('[data-game-action="set-rent-policy"][data-policy="reinvest"]')).toBeEnabled();

    // Alex reopens the sheet and reads that his stake cuts the rent he pays.
    await expect.poll(() => alex.page.evaluate(() => currentGame.game_state.corporations[0].rentPolicy)).toBe('payout');
    await alex.page.click('[data-close-modal="corporationModal"]');
    await alex.page.click('[data-game-action="open-corporation"]');
    await expect(alex.page.locator('.corp-rent-policy')).toContainText(/You hold 30%.*only the other 70%/);

    await sam.page.fill('#dividend-corp-mbs', '300');
    await sam.page.click('[data-game-action="pay-dividend"][data-corp-id="corp-mbs"]');
    await expect.poll(async () => cashOf(await fetchState(request, game, users.Sam), ids.alex)).toBe(1590);
    const state = await fetchState(request, game, users.Sam);
    expect(cashOf(state, ids.sam)).toBe(1650);
    expect(cashOf(state, ids.kim)).toBe(1560);
    expect(state.corporations[0]).toMatchObject({ cash: 300, rentPolicy: 'payout' });

    await alex.context.close();
    await sam.context.close();
});

test('a player offers a property, the chairman counters and the offerer accepts', async ({ browser, request }) => {
    const { room, game, users, ids } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);
    const alex = await openGame(browser, room, users.Alex);

    await alex.page.click('[data-game-action="open-corporation"]');
    await alex.page.click('[data-game-action="open-property-offer"][data-corp-id="corp-mbs"]');
    await expect(alex.page.locator('#propertyOfferModal')).toHaveClass(/active/);
    await expect(alex.page.locator('#send-property-offer-btn')).toBeDisabled();
    await alex.page.check('#propertyOfferAssets input[value="prop-15"]');
    const preview = alex.page.locator('#propertyOfferPreview');
    // Book value $240 at $1.35 a share: 177.8, rounded down to 177 new shares,
    // so the offerer gives up under a dollar to rounding.
    await expect(preview).toContainText('You give MBS Illinois Avenue for 177 new MBS shares.');
    await expect(preview).toContainText('Your net worth−$1');

    await alex.page.check('input[name="propertyOfferBasis"][value="set"]');
    await alex.page.fill('#propertyOfferPriceInput', '300');
    await expect(preview).toContainText('for 222 new MBS shares');
    await expect(preview).toContainText('Paying $60 over book value');
    await alex.page.click('#send-property-offer-btn');
    await expect(alex.page.locator('#propertyOfferModal')).not.toHaveClass(/active/);

    // Sam sees it in the MBS card, with what it costs him, and counters.
    await sam.page.click('[data-game-action="open-corporation"]');
    const offerCard = sam.page.locator('.corp-property-offers .trade-offer-card');
    await expect(offerCard).toContainText('Alex → MBS: $300 in new shares', { timeout: 10000 });
    await expect(offerCard).toContainText('Your net worth');
    await offerCard.locator('.counter-price-input').fill('260');
    await offerCard.locator('[data-response="counter"]').click();
    await expect(sam.page.locator('.corp-property-offers')).toContainText('Waiting for Alex');

    await alex.page.click('[data-game-action="open-corporation"]');
    const alexCard = alex.page.locator('.corp-property-offers .trade-offer-card');
    await expect(alexCard).toContainText('$260 in new shares');
    await alexCard.locator('[data-response="accept"]').click();

    await expect.poll(async () => (await fetchState(request, game, users.Sam)).properties.find(p => p.id === 'prop-15').ownerId).toBe('corp-mbs');
    const mbs = (await fetchState(request, game, users.Sam)).corporations[0];
    // $260 / $1.35 = 192.6, so 192 new shares.
    expect(mbs.totalShares).toBe(1192);
    expect(mbs.shareholders.find(h => h.userId === ids.alex).shares).toBe(492);

    await alex.context.close();
    await sam.context.close();
});

test('the chairman trades as the company and buys a property for it', async ({ browser, request }) => {
    // Sam has rolled onto Illinois (square 24), which nobody owns.
    const { room, game, users, ids } = await setupGame(request, {
        samOverrides: { position: 24, diceRolled: true },
        illinoisOwner: null,
    });
    const sam = await openGame(browser, room, users.Sam);
    const kim = await openGame(browser, room, users.Kim);

    // Buy Illinois for MBS from its treasury.
    await sam.page.click('[data-game-action="open-buy-property"]');
    await expect(sam.page.locator('#buyForChoices')).toBeVisible();
    await expect(sam.page.locator('#buyForChoices')).toContainText('Treasury $600 → $360');
    await sam.page.check('#buyForChoices input[value="corp-mbs"]');
    await sam.page.click('#confirm-purchase-btn');
    await expect.poll(async () => (await fetchState(request, game, users.Sam)).properties.find(p => p.id === 'prop-15').ownerId).toBe('corp-mbs');

    // Trade as MBS: $200 of treasury cash for Kim's Kentucky Ave.
    await sam.page.click('[data-game-action="open-corporation"]');
    await sam.page.click('[data-game-action="trade-as-corporation"][data-corp-id="corp-mbs"]');
    await expect(sam.page.locator('#player1As')).toHaveValue('corp-mbs');
    await sam.page.selectOption('#player2Select', ids.kim);
    await expect(sam.page.locator('#player1CashMax')).toHaveText('(max $360)');
    await sam.page.fill('#player1Cash', '200');
    await sam.page.check('#player2Assets input[value="prop-13"]');
    await sam.page.click('#executeTradeBtn');
    await expect(sam.page.locator('#market-status')).toContainText('Trade proposal sent');

    await kim.page.locator('.nav-tab[data-section="market"]').click();
    const offer = kim.page.locator('.trade-offer-card').first();
    await expect(offer).toContainText('MBS (via Sam) gives', { timeout: 10000 });
    await offer.locator('[data-game-action="accept-trade-offer"]').click();

    await expect.poll(async () => (await fetchState(request, game, users.Sam)).properties.find(p => p.id === 'prop-13').ownerId).toBe('corp-mbs');
    const state = await fetchState(request, game, users.Sam);
    expect(state.corporations[0].cash).toBe(160);
    expect(cashOf(state, ids.kim)).toBe(1700);
    expect(cashOf(state, ids.sam)).toBe(1500);

    await sam.context.close();
    await kim.context.close();
});

test('the corporation sheet and offer sheet fit a 320px phone', async ({ browser, request }) => {
    const { room, users } = await setupGame(request);
    const alex = await openGame(browser, room, users.Alex, 320);
    await alex.page.click('[data-game-action="open-corporation"]');
    await expect(alex.page.locator('.corp-rent-policy')).toBeVisible();
    let overflow = await alex.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await alex.page.click('[data-game-action="open-property-offer"][data-corp-id="corp-mbs"]');
    await alex.page.check('#propertyOfferAssets input[value="prop-15"]');
    await alex.page.check('input[name="propertyOfferBasis"][value="set"]');
    await expect(alex.page.locator('#propertyOfferPreview')).toBeVisible();
    overflow = await alex.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await alex.page.screenshot({ path: 'test-results/property-offer-320.png', fullPage: false });
    await alex.context.close();

    const sam = await openGame(browser, room, users.Sam, 320);
    await sam.page.click('[data-game-action="open-corporation"]');
    await expect(sam.page.locator('.corp-runner-tools')).toBeVisible();
    overflow = await sam.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await sam.page.locator('.corp-rent-policy').scrollIntoViewIfNeeded();
    await sam.page.screenshot({ path: 'test-results/corporation-desk-320.png', fullPage: false });
    await sam.context.close();
});
