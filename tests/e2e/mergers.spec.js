// @ts-check
// Mergers: Sam runs MBS and merges RRX into it from Market > New trade. The
// merge sheet recalculates as Sam types; RRX's other owners vote in Trade
// proposals, and the merger goes through the moment yes passes half.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage, playerState, showMarketPane } = require('./helpers');

// Set MERGER_SHOTS to a folder to save phone screenshots of each step.
const SHOTS = process.env.MERGER_SHOTS || '';

const rent = [25, 50, 100, 200];
function property(id, name, color, price, ownerId, ownerName) {
    return { id, name, color, price, rent, ownerId, ownerName, houses: 0 };
}

// MBS is worth $2,200 ($1,400 of property + $800 cash), all Sam's. RRX is
// worth $800 (four railroads + $150 cash - a $150 loan): Priya 60% (chairman),
// Lee 30%, Sam 10%. It is Lee's turn.
async function setupGame(request) {
    const users = {};
    for (const name of ['Priya', 'Sam', 'Lee']) {
        users[name] = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users.Priya.token}` },
        data: { name: 'Mergers', player_name: 'Priya', max_players: 4 },
    });
    for (const name of ['Sam', 'Lee']) {
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${users[name].token}` },
            data: { player_name: name },
        });
    }
    const id = name => users[name].user.id;
    const mbs = ['Pacific Ave', 'North Carolina Ave', 'Pennsylvania Ave', 'Atlantic Ave', 'Kentucky Ave'];
    const mbsPrices = [300, 300, 320, 260, 220];
    const mbsColors = ['Green', 'Green', 'Green', 'Yellow', 'Red'];
    const railroads = ['Reading Railroad', 'Pennsylvania Railroad', 'B. & O. Railroad', 'Short Line'];
    const properties = [
        ...mbs.map((name, i) => property(`prop-m${i}`, name, mbsColors[i], mbsPrices[i], 'corp-mbs', '[MBS]')),
        ...railroads.map((name, i) => property(`prop-r${i}`, name, 'Railroad', 200, 'corp-rrx', '[RRX]')),
    ];
    const corp = (cid, ticker, chair, holders, cash, assets, debts = []) => ({
        id: cid, ticker, name: `${ticker} Corporation`,
        founderId: id(chair), founderName: chair, chairmanId: id(chair), chairmanName: chair,
        totalShares: 12000, shareholders: holders.map(([name, shares]) => ({ userId: id(name), name, shares })),
        availableShares: 0, treasuryShares: 0, cash, debts, chairmanVotes: [], rentPolicy: 'reinvest',
        assets: assets.map(p => ({ id: p.id, name: p.name, value: p.price, color: p.color })),
    });
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${users.Priya.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 2,
                players: ['Priya', 'Sam', 'Lee'].map(name => playerState(id(name), name)),
                properties,
                corporations: [
                    corp('corp-mbs', 'MBS', 'Sam', [['Sam', 12000]], 800, properties.slice(0, 5)),
                    corp('corp-rrx', 'RRX', 'Priya', [['Priya', 7200], ['Lee', 3600], ['Sam', 1200]], 150, properties.slice(5),
                        [{ id: 'loan-1', principal: 150, interestRate: 5, termTurns: 10, turnsRemaining: 10 }]),
                ],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, users, game };
}

async function openGame(browser, room, user) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await loginPage(page, user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.game-header')).toBeVisible();
    return { context, page };
}

async function shot(page, name, locator) {
    if (!SHOTS) return;
    // Sheets scroll inside the screen: a tall window shows all of one at once.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 2800 });
    if (locator) await locator.screenshot({ path: `${SHOTS}/${name}.png` });
    if (size) await page.setViewportSize(size);
    else await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    if (!locator && size) await page.setViewportSize(size);
}

test('Sam merges RRX into MBS; RRX\'s owners vote it through', async ({ browser, request }) => {
    const { room, users, game } = await setupGame(request);
    const sam = await openGame(browser, room, users.Sam);
    const priya = await openGame(browser, room, users.Priya);

    // New trade: MBS on Sam's side, RRX on the other, then "the whole company".
    await sam.page.click('.nav-tab[data-section="market"]');
    await showMarketPane(sam.page, 'New trade');
    await sam.page.selectOption('#player1Select', 'corp:corp-mbs');
    await sam.page.selectOption('#player2Select', 'corp:corp-rrx');
    await sam.page.check('#player2Destination input[name="tradeMergeChoice"][value="merge"]');
    await expect(sam.page.locator('#executeTradeBtn')).toHaveText('Set up the merger');
    await expect(sam.page.locator('#player1CashGroup')).toBeHidden();
    await shot(sam.page, '1-new-trade', sam.page.locator('#marketPane-trade'));
    await sam.page.click('#executeTradeBtn');

    const sheet = sam.page.locator('#mergerModal');
    await expect(sheet).toHaveClass(/active/);
    await expect(sheet.locator('#mergerTitle')).toHaveText('Merge RRX into MBS');
    // With no cash the fair share is 26.7%; it follows the cash until Sam types a share.
    await expect(sheet.locator('#mergerStake')).toHaveValue('26.7');
    await sheet.locator('#mergerCash').fill('300');
    await expect(sheet.locator('#mergerStake')).toHaveValue('18.5');
    await expect(sheet.locator('#mergerFair')).toContainText('A fair offer is 18.5%');
    await sheet.locator('#mergerStake').fill('20');
    await expect(sheet.locator('#mergerFair')).toContainText('$40 more than RRX is worth');
    await expect(sheet.locator('#mergerResult')).toContainText('$2,700');
    await expect(sheet.locator('#mergerResult')).toContainText('7,200 RRX → 1,800 MBS + $180');
    await expect(sheet.locator('#mergerResult')).toContainText("Yours don't vote because you're on the buying side.");
    // Typing more cash than both companies hold together blocks sending.
    await sheet.locator('#mergerCash').fill('1000');
    await expect(sheet.locator('#mergerSendBtn')).toBeDisabled();
    await sheet.locator('#mergerCash').fill('300');
    await expect(sheet.locator('#mergerSendBtn')).toBeEnabled();
    await sheet.locator('[data-game-action="merger-toggle-flow"]').click();
    await expect(sheet.locator('svg.merger-flow')).toBeVisible();
    await shot(sam.page, '2-merge-sheet', sheet.locator('.modal-content'));

    // While the sheet is open, Lee gives RRX $100: every number on it moves.
    await apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
        headers: { Authorization: `Bearer ${users.Lee.token}` },
        data: {
            actionId: `merger-live-${Date.now()}`,
            type: 'manual_payment',
            payload: { fromPlayerId: users.Lee.user.id, toCorpId: 'corp-rrx', amount: 100 },
            expectedVersion: game.state_version,
        },
    });
    await expect(sheet.locator('#mergerBefore')).toContainText('$900');
    await expect(sheet.locator('#mergerCashMax')).toContainText('up to $1,050');
    await expect(sheet.locator('#mergerResult')).toContainText('$2,800');
    await expect(sheet.locator('#mergerFair')).toContainText('A fair offer is 21.4%');
    await expect(sheet.locator('#mergerFair')).toContainText('$40 less than RRX is worth');
    await expect(sheet.locator('#mergerStake')).toHaveValue('20');
    await sheet.locator('#mergerSendBtn').click();
    await expect(sheet).not.toHaveClass(/active/);

    // Priya votes yes in Trade proposals; with 7,200 of 10,800 voting shares that passes it.
    await priya.page.click('.nav-tab[data-section="market"]');
    await expect(priya.page.locator('#marketProposalsCount')).toHaveText('1');
    await showMarketPane(priya.page, 'Trade proposals');
    const card = priya.page.locator('#tradeOffersList .trade-offer-card[data-merger-id]');
    await expect(card).toContainText('Your 7,200 RRX shares would become 1,800 MBS shares + $180 cash.');
    await expect(card).toContainText('RRX closes and you stop being its chairman.');
    await shot(priya.page, '3-vote-card', card);
    await card.locator('[data-game-action="merger-vote"][data-approve="true"]').click();
    await expect(priya.page.locator('#tradeOffersList .trade-offer-card[data-merger-id]')).toHaveCount(0);

    // Both screens now show RRX merged into MBS.
    for (const { page } of [sam, priya]) {
        await page.click('.nav-tab[data-section="game"]');
        await page.locator('[data-game-action="open-corporation"]').first().click();
        await expect(page.locator('#corporationModal')).toContainText('Merged into MBS');
    }
    await shot(sam.page, '4-after', sam.page.locator('#corporationModal .modal-content'));

    await sam.context.close();
    await priya.context.close();
});
