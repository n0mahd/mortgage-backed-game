// @ts-check
// Loan terms through the real UI: the host's rates in the waiting room, taking a
// loan on a chosen term, and the Debt page (autopay, payments, pay off).
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');
const { MONOPOLY_PROPERTIES } = require('../../backend/domain/gameRules');

const BOARDWALK = 'prop-26';

async function makeRoom(request) {
    const users = [];
    for (const name of ['Alice', 'Bob']) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${users[0].token}` },
        data: { name: 'Loan Terms Room', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${users[1].token}` },
        data: { player_name: 'Bob' },
    });
    return { room, alice: users[0], bob: users[1] };
}

async function seedGame(request, { currentPlayerIndex = 0, aliceDebts = [], corporations = () => [] } = {}) {
    const { room, alice, bob } = await makeRoom(request);
    const properties = MONOPOLY_PROPERTIES.map((prop, index) => ({
        ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0,
    }));
    Object.assign(properties.find(prop => prop.id === BOARDWALK), { ownerId: alice.user.id, ownerName: 'Alice' });
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex,
                players: [
                    playerState(alice.user.id, 'Alice', { diceRolled: true, debts: aliceDebts }),
                    playerState(bob.user.id, 'Bob'),
                ],
                properties,
                corporations: corporations(alice.user.id),
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500, loanRates: { 5: 4, 10: 5, 15: 6 } },
            },
        },
    });
    return { room, game, alice, bob };
}

async function openGame(page, room, user) {
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.turn-ticket')).toBeVisible();
    await page.click('.nav-tab[data-section="game"]');
}

async function fetchAlice(request, game, alice) {
    const state = (await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${alice.token}` },
    })).game_state;
    return state.players.find(player => player.userId === alice.user.id);
}

function actionSaved(page) {
    return page.waitForResponse(response => response.url().includes('/actions') && response.status() === 200);
}

test('the host sets the loan rates in the waiting room', async ({ page, request }) => {
    const { room, alice } = await makeRoom(request);
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), alice.token);
    await page.goto(`${BASE}/waiting.html?room=${room.id}`);
    await expect(page.locator('#loan-rates-panel')).toBeVisible({ timeout: 5000 });
    await page.fill('#loan-rate-5', '3');
    await page.fill('#loan-rate-10', '4.5');
    await page.fill('#loan-rate-15', '8');
    await page.click('#start-game-btn');
    await page.waitForURL(/game\.html/, { timeout: 10000 });

    const game = await apiJson(request, 'get', `${BASE_API}/games/by-room/${room.id}`, {
        headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(game.game_state.settings.loanRates).toEqual({ 5: 3, 10: 4.5, 15: 8 });
    await page.click('.nav-tab[data-section="game"]');
    await page.click('#game [data-game-action="open-debt"]');
    await expect(page.locator('#loanRatesHint')).toContainText('5 turns at 3%, 10 turns at 4.5%, 15 turns at 8%');
});

test('a rate out of range is refused before the game starts', async ({ page, request }) => {
    const { room, alice } = await makeRoom(request);
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), alice.token);
    await page.goto(`${BASE}/waiting.html?room=${room.id}`);
    await page.fill('#loan-rate-15', '40');
    const dialog = page.waitForEvent('dialog');
    await page.click('#start-game-btn');
    const message = (await dialog).message();
    expect(message).toContain('15-turn rate must be between 0% and 25%');
});

test('take a loan on a chosen term, switch autopay and pay it off', async ({ page, request }) => {
    const { room, game, alice } = await seedGame(request);
    await openGame(page, room, alice);

    await page.click('#game [data-game-action="open-debt"]');
    await expect(page.locator('#debtAction')).toHaveValue('issue');
    // Alice owns only Boardwalk ($400): her loans can total $360.
    await expect(page.locator('#loanLimit')).toHaveText('You can borrow up to $360: 90% of the $400 book value of your properties and shares.');
    await page.fill('#loanAmount', '300');
    await expect(page.locator('#loanTerms')).toContainText('5 turns at 4% per turn');
    await expect(page.locator('#loanTerms')).toContainText('$67.39 a turn, $336.95 in total');
    await page.check('#loanTerms-5');
    await page.uncheck('#loanAutopay');
    await Promise.all([actionSaved(page), page.click('#process-debt-btn')]);
    await expect(page.locator('#debtModal')).toBeHidden();
    await expect(page.locator('#gameContent')).toContainText('Autopay off');

    let loan = (await fetchAlice(request, game, alice)).debts[0];
    expect(loan).toMatchObject({ principal: 300, termTurns: 5, turnsRemaining: 5, interestRate: 4, autopay: false });

    await page.click('#game [data-game-action="open-debt"]');
    await expect(page.locator('#debtAction')).toHaveValue('loans');
    await expect(page.locator('#process-debt-btn')).toBeHidden();
    const row = page.locator('#loanList .loan-row');
    await expect(row).toContainText('5 turns left');
    await expect(row).toContainText('Autopay is off');
    await Promise.all([actionSaved(page), row.locator('[data-loan-autopay]').check()]);
    await expect(row).toContainText('Autopay takes $67.39');
    expect((await fetchAlice(request, game, alice)).debts[0].autopay).toBe(true);

    await row.locator('input[type="number"]').fill('100');
    await Promise.all([actionSaved(page), row.locator('[data-loan-pay]').click()]);
    await expect(row.locator('.loan-balance')).toHaveText('$200');

    await Promise.all([actionSaved(page), row.locator('[data-loan-payoff]').click()]);
    await expect(page.locator('#loanList')).toContainText('No loans');
    loan = (await fetchAlice(request, game, alice));
    expect(loan.debts).toEqual([]);
    expect(loan.cash).toBe(1500);
});

test('off your turn you can change autopay but not pay', async ({ page, request }) => {
    const debt = { id: 'debt-1', principal: 300, interestRate: 5, termTurns: 10, turnsRemaining: 4, autopay: true };
    const { room, game, alice } = await seedGame(request, { currentPlayerIndex: 1, aliceDebts: [debt] });
    await openGame(page, room, alice);

    await page.click('#game [data-game-action="open-debt"]');
    const row = page.locator('#loanList .loan-row');
    await expect(row).toContainText('4 turns left');
    await expect(row.locator('[data-loan-pay]')).toBeDisabled();
    await expect(row.locator('[data-loan-payoff]')).toBeDisabled();
    await expect(page.locator('#debtAction option[value="issue"]')).toBeDisabled();
    await Promise.all([actionSaved(page), row.locator('[data-loan-autopay]').uncheck()]);
    expect((await fetchAlice(request, game, alice)).debts[0].autopay).toBe(false);
});

test('the turn screen warns before a loan comes due', async ({ page, request }) => {
    const debt = { id: 'debt-1', principal: 2000, interestRate: 5, termTurns: 5, turnsRemaining: 1, autopay: true };
    const { room, alice } = await seedGame(request, { aliceDebts: [debt] });
    await openGame(page, room, alice);
    await expect(page.locator('.turn-warning.danger')).toContainText('$2,100 of loans come due when you end your turn. Raise $600 more');
    await expect(page.locator('.action-btn-end-turn')).toHaveText('Declare Bankruptcy');
});

test('refinance a loan onto a new term', async ({ page, request }) => {
    const debt = { id: 'debt-1', principal: 200, interestRate: 5, termTurns: 10, turnsRemaining: 3, autopay: true };
    const { room, game, alice } = await seedGame(request, { aliceDebts: [debt] });
    await openGame(page, room, alice);
    await page.click('#game [data-game-action="open-debt"]');
    await page.selectOption('#debtAction', 'refinance');
    await expect(page.locator('#process-debt-btn')).toHaveText('Refinance');
    await page.check('#refinance-debt-0');
    // The loan being replaced doesn't count against the limit.
    await expect(page.locator('#refinanceLimit')).toContainText('You can borrow up to $360');
    await page.fill('#refinanceAmount', '300');
    await page.check('#refinanceTerms-15');
    await Promise.all([actionSaved(page), page.click('#process-debt-btn')]);
    await expect(page.locator('#debtModal')).toBeHidden();
    const after = await fetchAlice(request, game, alice);
    expect(after.debts).toHaveLength(1);
    expect(after.debts[0]).toMatchObject({ principal: 300, termTurns: 15, turnsRemaining: 15, interestRate: 6 });
    expect(after.cash).toBe(1600);
});

test("refinance a corporation's loans down to a smaller one", async ({ page, request }) => {
    const loan = (id, principal) => ({ id, principal, interestRate: 5, termTurns: 10, turnsRemaining: 6, autopay: true });
    const { room, game, alice } = await seedGame(request, {
        aliceDebts: [loan('debt-own', 50)],
        corporations: aliceId => [{
            id: 'corp-loan', ticker: 'LOAN', name: 'LOAN Corporation',
            founderId: aliceId, founderName: 'Alice', chairmanId: aliceId, chairmanName: 'Alice',
            totalShares: 10, availableShares: 0, treasuryShares: 0, assets: [],
            shareholders: [{ userId: aliceId, name: 'Alice', shares: 10 }],
            debts: [loan('debt-a', 100), loan('debt-b', 150)],
            cash: 400,
        }],
    });
    await openGame(page, room, alice);
    await page.click('#game [data-game-action="open-debt"]');
    await page.selectOption('#debtAction', 'refinance');
    await page.selectOption('#refinanceBorrower', 'corporation:corp-loan');
    await page.check('#refinance-debt-0');
    await page.check('#refinance-debt-1');
    // The amount starts at the selected balance: the same loans on a new term.
    await expect(page.locator('#refinanceAmount')).toHaveValue('250.00');
    await expect(page.locator('#refinanceSummary')).toContainText('Same balance on a new term');
    await page.fill('#refinanceAmount', '100');
    await expect(page.locator('#refinanceSummary')).toContainText("$150 is paid down from LOAN's cash");
    await page.check('#refinanceTerms-5');
    await Promise.all([actionSaved(page), page.click('#process-debt-btn')]);
    await expect(page.locator('#debtModal')).toBeHidden();
    const state = (await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, {
        headers: { Authorization: `Bearer ${alice.token}` },
    })).game_state;
    const corp = state.corporations.find(item => item.id === 'corp-loan');
    expect(corp.debts).toHaveLength(1);
    expect(corp.debts[0]).toMatchObject({ principal: 100, termTurns: 5, interestRate: 4 });
    expect(corp.cash).toBe(250);
    const aliceAfter = state.players.find(player => player.userId === alice.user.id);
    expect(aliceAfter.cash).toBe(1500);
    expect(aliceAfter.debts.map(debt => debt.id)).toEqual(['debt-own']);
});
