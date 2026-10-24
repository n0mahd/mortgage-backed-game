// @ts-check
// Running a corporation from the Corporations sheet: rent policy, dividends,
// property offers (offer, counter, accept), trading as the company, buying a
// property for it, all through the real UI.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState, showMarketPane } = require('./helpers');

const PARK = { id: 'prop-25', name: 'Park Place', color: 'Dark Blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] };
const BOARDWALK = { id: 'prop-26', name: 'Boardwalk', color: 'Dark Blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] };
const ILLINOIS = { id: 'prop-15', name: 'Illinois Avenue', color: 'Red', price: 240, rent: [20, 100, 300, 750, 925, 1100] };
const KENTUCKY = { id: 'prop-13', name: 'Kentucky Avenue', color: 'Red', price: 220, rent: [18, 90, 250, 700, 875, 1050] };

// MBS: 12,000 shares (Sam 6,000, Alex 3,600, Kim 2,400), owns the Dark Blues
// and has $600 in its treasury: worth $1,350, so $0.1125 a share. Sam's turn.
async function setupGame(request, { samOverrides = {}, illinoisOwner = 'alex', mbsOwnsKentucky = false } = {}) {
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
                    mbsOwnsKentucky ? owned(KENTUCKY, 'corp-mbs', '[MBS]') : owned(KENTUCKY, ids.kim, 'Kim'),
                ],
                corporations: [{
                    id: 'corp-mbs',
                    ticker: 'MBS',
                    name: 'MBS Corporation',
                    founderId: ids.sam,
                    founderName: 'Sam',
                    chairmanId: ids.sam,
                    chairmanName: 'Sam',
                    totalShares: 12000,
                    assets: [
                        { id: PARK.id, name: PARK.name, value: PARK.price, color: PARK.color },
                        { id: BOARDWALK.id, name: BOARDWALK.name, value: BOARDWALK.price, color: BOARDWALK.color },
                        ...(mbsOwnsKentucky ? [{ id: KENTUCKY.id, name: KENTUCKY.name, value: KENTUCKY.price, color: KENTUCKY.color }] : []),
                    ],
                    shareholders: [
                        { userId: ids.sam, name: 'Sam', shares: 6000 },
                        { userId: ids.alex, name: 'Alex', shares: 3600 },
                        { userId: ids.kim, name: 'Kim', shares: 2400 },
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
    // Now locked: Sam can't flip it back alone for his next 5 turns.
    await expect(sam.page.locator('.corp-rent-policy')).toContainText("can't change it alone for 5 more of their turns");
    await expect(sam.page.locator('[data-game-action="set-rent-policy"]')).toHaveCount(0);

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

test('during the lock, the policy changes when every shareholder agrees', async ({ browser, request }) => {
    const { room, game, users } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);
    const alex = await openGame(browser, room, users.Alex);
    const kim = await openGame(browser, room, users.Kim);

    await sam.page.click('[data-game-action="open-corporation"]');
    await sam.page.click('[data-game-action="set-rent-policy"][data-policy="payout"]');
    await expect(sam.page.locator('.corp-rent-policy')).toContainText('Rent policy: Payout');

    // Alex asks to go back to Reinvest; Kim and Sam agree.
    await expect.poll(() => alex.page.evaluate(() => currentGame.game_state.corporations[0].rentPolicy)).toBe('payout');
    await alex.page.click('[data-game-action="open-corporation"]');
    await alex.page.click('[data-game-action="propose-rent-policy"][data-policy="reinvest"]');
    await expect(alex.page.locator('.corp-rent-policy')).toContainText('Waiting for: Sam, Kim');

    await expect(kim.page.locator('[data-game-action="open-corporation"]').first()).toContainText('1 waiting for your answer', { timeout: 10000 });
    await kim.page.click('[data-game-action="open-corporation"]');
    await kim.page.click('[data-game-action="vote-rent-policy"][data-approve="true"]');
    await expect(kim.page.locator('.corp-rent-policy')).toContainText('Waiting for: Sam');

    await expect.poll(() => sam.page.evaluate(() => currentGame.game_state.corporations[0].rentPolicyVote?.supporterIds?.length || 0)).toBe(2);
    await sam.page.click('[data-close-modal="corporationModal"]');
    await sam.page.click('[data-game-action="open-corporation"]');
    await sam.page.click('[data-game-action="vote-rent-policy"][data-approve="true"]');
    await expect(sam.page.locator('.corp-rent-policy')).toContainText('Rent policy: Reinvest');
    const mbs = (await fetchState(request, game, users.Sam)).corporations[0];
    expect(mbs).toMatchObject({ rentPolicy: 'reinvest', rentPolicyVote: null, rentPolicyLockedTurns: 5 });

    await kim.context.close();
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
    // Book value $240 at $0.1125 a share: 2,133.3, so 2,133 new shares (nearest share).
    await expect(preview).toContainText('You give MBS Illinois Avenue for 2,133 new MBS shares.');
    await expect(preview).toContainText('Your net worth$0');

    await alex.page.check('input[name="propertyOfferBasis"][value="set"]');
    await alex.page.fill('#propertyOfferPriceInput', '300');
    // $300 at $0.1125 a share is 2,666.7, so 2,667.
    await expect(preview).toContainText('for 2,667 new MBS shares');
    await expect(preview).toContainText('Paying $60 over book value');
    await alex.page.click('#send-property-offer-btn');
    await expect(alex.page.locator('#propertyOfferModal')).not.toHaveClass(/active/);

    // Sam's Moves grid flags it; the offer is a Trade proposal in the Market.
    const proposalsTile = sam.page.locator('[data-game-action="open-trade-proposals"]').first();
    await expect(proposalsTile).toContainText('1 waiting for your answer', { timeout: 10000 });
    await expect(sam.page.locator('[data-game-action="open-corporation"]').first()).toContainText('Shares and chairmen');
    // The Corporations sheet only points to it.
    await sam.page.click('[data-game-action="open-corporation"]');
    await expect(sam.page.locator('.corp-offer-pointer')).toContainText('1 property offer waiting for you');
    await sam.page.click('.corp-offer-pointer [data-game-action="open-trade-proposals"]');
    await expect(sam.page.locator('#marketTab-proposals')).toHaveAttribute('aria-selected', 'true');
    await expect(sam.page.locator('#marketProposalsCount')).toHaveText('1');
    const offerCard = sam.page.locator('#tradeOffersList [data-property-offer-id]');
    await expect(offerCard).toContainText('Alex wants to sell Illinois Avenue to MBS');
    await expect(offerCard.locator('.trade-offer-sides')).toContainText('Worth $240');
    await expect(offerCard.locator('.trade-offer-sides')).toContainText('2,667 new shares');
    // MBS: $1,350 + $240 over 14,667 shares; Sam's 6,000 go from $675 to $650.
    await expect(offerCard.locator('.offer-verdict')).toContainText('Alex is asking $60 more than Illinois Avenue is worth. Accepting costs you $25');
    await expect(offerCard.locator('.share-deal-table')).toContainText('Your net worth−$25');
    await expect(offerCard.locator('.offer-counter')).toBeHidden();
    await offerCard.locator('[data-game-action="toggle-property-counter"]').click();
    await expect(offerCard.locator('.offer-counter')).toBeVisible();
    await offerCard.locator('[data-game-action="fill-property-counter"]').click();
    await expect(offerCard.locator('.offer-counter-result')).toContainText('Alex would get 2,133 new shares. For you: $0');
    await offerCard.locator('.offer-counter-input').fill('260');
    await expect(offerCard.locator('[data-response="counter"]')).toHaveText('Send counter at $260');
    await offerCard.locator('[data-response="counter"]').click();
    await expect(offerCard).toContainText('Waiting on Alex');
    await expect(offerCard).toContainText('You countered: MBS pays $260 for Illinois Avenue');
    await expect(offerCard.locator('.offer-verdict')).toContainText('Your counter is $20 more than Illinois Avenue is worth. If it goes through, you lose $8');

    // Alex's Moves grid flags the counter.
    await alex.page.locator('[data-game-action="open-trade-proposals"]').first().click({ timeout: 10000 });
    const alexCard = alex.page.locator('#tradeOffersList [data-property-offer-id]');
    await expect(alexCard).toContainText('2,311 new shares', { timeout: 10000 });
    await expect(alexCard).toContainText('Sam countered: MBS pays $260 for Illinois Avenue');
    await expect(alexCard.locator('.offer-verdict')).toContainText("Sam's counter is $20 more than Illinois Avenue is worth. Accepting gains you");
    await alexCard.locator('[data-response="accept"]').click();

    await expect.poll(async () => (await fetchState(request, game, users.Sam)).properties.find(p => p.id === 'prop-15').ownerId).toBe('corp-mbs');
    const mbs = (await fetchState(request, game, users.Sam)).corporations[0];
    // $260 / $0.1125 = 2,311.1, so 2,311 new shares.
    expect(mbs.totalShares).toBe(14311);
    expect(mbs.shareholders.find(h => h.userId === ids.alex).shares).toBe(3600 + 2311);

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
    await expect(sam.page.locator('#player1Select')).toHaveValue('corp:corp-mbs');
    await sam.page.selectOption('#player2Select', ids.kim);
    await expect(sam.page.locator('#player1CashMax')).toHaveText('(max $360)');
    await sam.page.fill('#player1Cash', '200');
    await sam.page.check('#player2Assets input[value="prop-13"]');
    await sam.page.click('#executeTradeBtn');
    await expect(sam.page.locator('#market-status')).toContainText('Trade proposal sent');

    await kim.page.locator('.nav-tab[data-section="market"]').click();
    await showMarketPane(kim.page, 'Trade proposals');
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
    await alex.page.fill('#propertyOfferPriceInput', '300');
    await alex.page.click('#send-property-offer-btn');
    await expect(alex.page.locator('#propertyOfferModal')).not.toHaveClass(/active/);
    await alex.context.close();

    const sam = await openGame(browser, room, users.Sam, 320);
    await sam.page.click('[data-game-action="open-corporation"]');
    await expect(sam.page.locator('.corp-runner-tools')).toBeVisible();
    overflow = await sam.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await sam.page.locator('.corp-rent-policy').scrollIntoViewIfNeeded();
    await sam.page.screenshot({ path: 'test-results/corporation-desk-320.png', fullPage: false });
    await sam.page.click('.corp-offer-pointer [data-game-action="open-trade-proposals"]');
    const card = sam.page.locator('#tradeOffersList [data-property-offer-id]');
    await card.locator('[data-game-action="toggle-property-counter"]').click();
    await expect(card.locator('.offer-counter')).toBeVisible();
    overflow = await sam.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: 'test-results/property-offer-card-320.png' });
    await sam.context.close();
});

test('a corporation lists its properties grouped by colour, in board order', async ({ browser, request }) => {
    const { room, users } = await setupGame(request, { mbsOwnsKentucky: true });
    const kim = await openGame(browser, room, users.Kim);
    await kim.page.click('[data-game-action="open-corporation"]');
    const groups = kim.page.locator('.corp-asset-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).locator('.corp-asset-group-head')).toContainText('Red');
    await expect(groups.nth(0).locator('.corp-asset-group-head')).toContainText('1 of 3');
    await expect(groups.nth(1).locator('.corp-asset-group-head')).toContainText('Monopoly');
    await expect(groups.nth(1).locator('.corp-asset-row')).toHaveText([/Park Place\s*\$350/, /Boardwalk\s*\$400/]);
    await groups.nth(0).scrollIntoViewIfNeeded();
    await kim.page.screenshot({ path: 'test-results/corporation-assets-390.png', fullPage: false });
    await kim.context.close();
});

test('the chairman picks the company under They give to add a property, and sends it cash for shares', async ({ browser, request }) => {
    // Sam owns Illinois ($240) and runs MBS ($1,350 over 12,000 shares).
    const { room, game, users, ids } = await setupGame(request, { illinoisOwner: 'sam' });
    const sam = await openGame(browser, room, users.Sam);
    await sam.page.locator('.nav-tab[data-section="market"]').click();

    await sam.page.selectOption('#player2Select', 'corp:corp-mbs');
    await expect(sam.page.locator('#player2Heading')).toHaveText('You get back');
    await expect(sam.page.locator('#player1CashGroup')).toBeHidden();
    await expect(sam.page.locator('#executeTradeBtn')).toHaveText('Add to MBS');
    await expect(sam.page.locator('#executeTradeBtn')).toBeDisabled();
    await sam.page.check('#player1Assets input[value="prop-15"]');
    await expect(sam.page.locator('#player2Destination')).toContainText('2,133 new shares');
    await expect(sam.page.locator('#tradePreview')).toContainText('Before you confirm');
    await sam.page.click('#executeTradeBtn');
    await expect(sam.page.locator('#market-status')).toContainText('Added to MBS');
    await expect.poll(async () => (await fetchState(request, game, users.Sam)).corporations[0].totalShares).toBe(14133);
    let state = await fetchState(request, game, users.Sam);
    expect(state.properties.find(p => p.id === 'prop-15').ownerId).toBe('corp-mbs');

    // Back to a normal trade: the headings and cash boxes return.
    await sam.page.selectOption('#player2Select', ids.kim);
    await expect(sam.page.locator('#player2Heading')).toHaveText('They give');
    await expect(sam.page.locator('#executeTradeBtn')).toHaveText('Propose Transaction');
    await expect(sam.page.locator('#player1CashGroup')).toBeVisible();

    // Send money into MBS for new shares: $135 at $1,590 over 14,133 shares.
    await showMarketPane(sam.page, 'Send money');
    await sam.page.selectOption('#paymentToPlayer', 'corp:corp-mbs');
    await sam.page.fill('#paymentAmount', '135');
    await expect(sam.page.locator('#paymentReturn')).toContainText('1,200 new shares');
    await sam.page.click('#makePaymentBtn');
    await expect(sam.page.locator('#market-status')).toContainText('Paid into MBS');
    await expect.poll(async () => (await fetchState(request, game, users.Sam)).corporations[0].totalShares).toBe(15333);
    state = await fetchState(request, game, users.Sam);
    expect(state.corporations[0].cash).toBe(735);
    expect(state.corporations[0].shareholders.find(h => h.userId === ids.sam).shares).toBe(6000 + 2133 + 1200);
    await sam.context.close();

    // Alex doesn't run MBS: cash he sends is a gift, with no shares choice.
    const alex = await openGame(browser, room, users.Alex);
    await alex.page.locator('.nav-tab[data-section="market"]').click();
    await showMarketPane(alex.page, 'Send money');
    await alex.page.selectOption('#paymentToPlayer', 'corp:corp-mbs');
    await alex.page.fill('#paymentAmount', '10');
    await expect(alex.page.locator('#paymentReturn')).toContainText('as a gift');
    await expect(alex.page.locator('input[name="paymentReturnChoice"]')).toHaveCount(0);
    await alex.context.close();
});
