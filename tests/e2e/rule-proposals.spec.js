// @ts-check
// Rule proposals through the real UI, in two browsers: Alice proposes a new Pass GO
// amount in Market › Rule proposals, Bob gets the Vote pill and agrees, and both
// screens show the rule changed. Carol is bankrupt and has no vote.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');
const { MONOPOLY_PROPERTIES } = require('../../backend/domain/gameRules');

async function seedGame(request, { aliceDebts = [], passGoAmount = 200 } = {}) {
    const users = [];
    for (const name of ['Alice', 'Bob', 'Carol']) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const [alice, bob, carol] = users;
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: { name: 'Rule Vote Room', player_name: 'Alice', max_players: 4 },
    });
    for (const user of [bob, carol]) {
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${user.token}` },
            data: { player_name: user.name },
        });
    }
    const game = await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players: [
                    playerState(alice.user.id, 'Alice', { debts: aliceDebts }),
                    playerState(bob.user.id, 'Bob'),
                    playerState(carol.user.id, 'Carol', { bankrupt: true, cash: 0 }),
                ],
                properties: MONOPOLY_PROPERTIES.map((prop, index) => ({ ...prop, id: `prop-${index}`, ownerId: null, ownerName: null, houses: 0 })),
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount, startingCash: 1500, loanRate: 5 },
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
}

async function openRuleProposals(page) {
    await page.click('.nav-tab[data-section="market"]');
    await page.getByRole('tab', { name: /Rule proposals/ }).click();
}

function actionSaved(page) {
    return page.waitForResponse(response => response.url().includes('/actions') && response.status() === 200);
}

test('Alice proposes Pass GO $300, Bob votes yes, and the rule changes on both screens', async ({ browser, request }) => {
    const { room, game, alice, bob } = await seedGame(request);
    const alicePage = await (await browser.newContext()).newPage();
    const bobPage = await (await browser.newContext()).newPage();
    await openGame(alicePage, room, alice);
    await openGame(bobPage, room, bob);

    await openRuleProposals(alicePage);
    const pane = alicePage.locator('#ruleProposalsPane');
    await expect(pane.locator('.house-rule').first()).toContainText('Pass GO');
    await expect(pane.locator('.house-rule').first()).toContainText('$200');
    await expect(pane.locator('.house-rule').first()).toContainText('Set by host');

    await pane.locator('[data-game-action="rule-start"]').click();
    // The form starts one step up from today's value.
    await expect(alicePage.locator('#ruleValueInput')).toHaveValue('250');
    await pane.locator('[data-game-action="rule-adjust"][data-delta="1"]').click();
    await expect(alicePage.locator('#ruleValueInput')).toHaveValue('300');
    await pane.locator('[data-game-action="rule-review"]').click();
    await expect(pane.locator('.rule-sentence')).toHaveText('Change Pass GO from $200 to $300.');
    await expect(pane.locator('.rule-tally')).toHaveText('Need a unanimous vote');
    // Alice ✓, Bob not voted yet, Carol bankrupt.
    await expect(pane.locator('.rule-voter').nth(0).locator('.vote-mark')).toHaveClass(/is-yes/);
    await expect(pane.locator('.rule-voter').nth(1).locator('.vote-mark')).toHaveClass(/is-wait/);
    await expect(pane.locator('.rule-voter').nth(2).locator('.vote-mark')).toHaveClass(/is-out/);
    await Promise.all([actionSaved(alicePage), pane.locator('[data-game-action="rule-send"]').click()]);
    await expect(pane.locator('#ruleProposalCard')).toContainText('1 of 2');
    await expect(pane.locator('[data-game-action="rule-withdraw"]')).toBeVisible();

    // Bob, on the Game tab, gets the pill, a featured move and a dot on Market.
    await expect(bobPage.locator('#rule-vote-banner')).toBeVisible({ timeout: 10000 });
    await expect(bobPage.locator('#rule-vote-banner')).toContainText('Alice proposes Pass GO → $300');
    await expect(bobPage.locator('.nav-tab[data-section="market"] .tab-dot')).toHaveCount(1);
    await expect(bobPage.locator('#game [data-game-action="open-rule-proposals"]')).toBeVisible();
    await bobPage.click('#rule-vote-banner-btn');
    await expect(bobPage.locator('#marketPane-rules')).toBeVisible();
    await expect(bobPage.locator('#rule-vote-banner')).toBeHidden();
    await expect(bobPage.locator('#marketRulesCount')).toHaveText('1');
    const bobPane = bobPage.locator('#ruleProposalsPane');
    await expect(bobPane.locator('.rule-sentence')).toContainText('Alice: change Pass GO from $200 to $300.');
    await Promise.all([actionSaved(bobPage), bobPane.locator('[data-game-action="rule-vote"][data-approve="true"]').click()]);

    for (const page of [alicePage, bobPage]) {
        const rule = page.locator('#ruleProposalsPane .house-rule').first();
        await expect(rule).toContainText('$300', { timeout: 10000 });
        await expect(rule).toContainText('Changed by vote');
        await expect(page.locator('#ruleProposalsPane .rule-history')).toContainText('Pass GO: $200 → $300');
    }
    await expect(bobPage.locator('.nav-tab[data-section="market"] .tab-dot')).toHaveCount(0);
    const saved = await apiJson(request, 'get', `${BASE_API}/games/${game.id}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    expect(saved.game_state.settings.passGoAmount).toBe(300);
});

test('a loan-rate proposal says loans already taken keep their rate, and one No closes it', async ({ browser, request }) => {
    const debt = { id: 'debt-1', principal: 300, interestRate: 5, termTurns: 10, turnsRemaining: 6, autopay: 'pay_down' };
    const { room, alice, bob } = await seedGame(request, { aliceDebts: [debt] });
    const bobPage = await (await browser.newContext()).newPage();
    const alicePage = await (await browser.newContext()).newPage();
    await openGame(bobPage, room, bob);
    await openGame(alicePage, room, alice);

    await openRuleProposals(bobPage);
    const pane = bobPage.locator('#ruleProposalsPane');
    await pane.locator('[data-game-action="rule-start"]').click();
    await pane.locator('input[name="ruleChoice"][value="loanRate"]').check();
    await bobPage.fill('#ruleValueInput', '3.5');
    await pane.locator('[data-game-action="rule-review"]').click();
    await expect(pane.locator('.rule-sentence')).toHaveText('Change Loan interest rate from 5% per turn to 3.5% per turn.');
    await Promise.all([actionSaved(bobPage), pane.locator('[data-game-action="rule-send"]').click()]);

    await openRuleProposals(alicePage);
    const alicePane = alicePage.locator('#ruleProposalsPane');
    await expect(alicePane).toContainText('New loans only. Your loan keeps 5%.');
    await Promise.all([actionSaved(alicePage), alicePane.locator('[data-game-action="rule-vote"][data-approve="false"]').click()]);
    await expect(alicePane.locator('#ruleProposalCard')).toHaveCount(0);
    await expect(alicePane.locator('.house-rule').nth(1)).toContainText('5% per turn');
    // Bob's proposal was rejected: he waits for his next turn.
    await expect(pane.locator('[data-game-action="rule-start"]')).toBeVisible({ timeout: 10000 });
    await pane.locator('[data-game-action="rule-start"]').click();
    await expect(pane).toContainText('You can propose again from your next turn');
    await expect(pane.locator('[data-game-action="rule-review"]')).toBeDisabled();
});

test('at the top of the range the form starts one step down, so Review works', async ({ page, request }) => {
    const { room, alice } = await seedGame(request, { passGoAmount: 1000 });
    await openGame(page, room, alice);
    await openRuleProposals(page);
    const pane = page.locator('#ruleProposalsPane');
    await pane.locator('[data-game-action="rule-start"]').click();
    await expect(page.locator('#ruleValueInput')).toHaveValue('950');
    await expect(pane.locator('[data-game-action="rule-review"]')).toBeEnabled();
    // + stops at $1,000, today's value: nothing to propose.
    await pane.locator('[data-game-action="rule-adjust"][data-delta="1"]').click();
    await expect(page.locator('#ruleValueInput')).toHaveValue('1000');
    await expect(pane.locator('[data-game-action="rule-review"]')).toBeDisabled();
});
