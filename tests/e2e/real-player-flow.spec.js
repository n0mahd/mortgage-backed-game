// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.PLAYWRIGHT_DB_PATH;
const PLAYER_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = path.join(process.cwd(), 'test-results', 'real-game-ui-flow', RUN_ID);

test.describe('thorough real-player UI game flow', () => {
    test('plays a multi-player game through the interface with screenshots', async ({ browser, baseURL }, testInfo) => {
        test.skip(!DB_PATH, 'PLAYWRIGHT_DB_PATH is required so the test can read dev OTPs.');
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

        const contexts = await Promise.all([
            browser.newContext({ viewport: { width: 1366, height: 768 } }),
            browser.newContext({ viewport: { width: 390, height: 844 } }),
            browser.newContext({ viewport: { width: 1280, height: 720 } }),
            browser.newContext({ viewport: { width: 1024, height: 768 } }),
        ]);
        const pages = {
            Alice: await contexts[0].newPage(),
            Bob: await contexts[1].newPage(),
            Carol: await contexts[2].newPage(),
            Dave: await contexts[3].newPage(),
        };
        const issues = Object.fromEntries(PLAYER_NAMES.map(name => [name, captureBrowserIssues(pages[name])]));
        PLAYER_NAMES.forEach(name => autoAcceptDialogs(pages[name]));

        try {
            const email = `e2e-${Date.now()}@example.test`;
            await signInWithOtp(pages.Alice, baseURL, email);
            await shot(testInfo, pages.Alice, '01-alice-authenticated-lobby');

            await createRoom(pages.Alice, 'Thorough Real Player E2E', 'Alice');
            const inviteCode = await readInviteCode(pages.Alice);
            await shot(testInfo, pages.Alice, '02-room-created-waiting');

            await joinAsGuest(pages.Bob, baseURL, inviteCode, 'Bob');
            await joinAsGuest(pages.Carol, baseURL, inviteCode, 'Carol');
            await joinAsGuest(pages.Dave, baseURL, inviteCode, 'Dave');
            await expect(pages.Alice.locator('#players-list')).toContainText('Dave', { timeout: 10000 });
            await shot(testInfo, pages.Alice, '03-four-players-waiting-room');
            await shot(testInfo, pages.Bob, '04-bob-mobile-waiting-room');

            await startGame(pages.Alice);
            await Promise.all(PLAYER_NAMES.map(name => expect(pages[name]).toHaveURL(/game\.html\?room=/, { timeout: 15000 })));
            await Promise.all(PLAYER_NAMES.map(name => waitForGameLoaded(pages[name])));
            await repairGameState(pages.Alice, { current: 'Alice', positions: { Alice: 0, Bob: 0, Carol: 0, Dave: 0 }, diceRolled: { Alice: false, Bob: false, Carol: false, Dave: false } });
            await reloadGamePages(pages, PLAYER_NAMES);
            await shot(testInfo, pages.Alice, '05-game-start-alice-actions');
            await openTab(pages.Alice, 'Board');
            await shot(testInfo, pages.Alice, '06-board-initial-state');

            await openTab(pages.Alice, 'Game');
            await clickAndWaitForGameVersion(pages.Alice, activeGameButton(pages.Alice, 'roll-dice'));
            await expect(pages.Alice.locator('#gameContent')).toContainText(/rolled \d\+\d=/, { timeout: 10000 });
            await expect(pages.Alice.locator('.landing-summary')).toBeVisible({ timeout: 10000 });
            await shot(testInfo, pages.Alice, '07-alice-roll-through-ui');

            await repairGameState(pages.Alice, { current: 'Alice', positions: { Alice: 1 }, unowned: ['prop-0'], diceRolled: { Alice: true } });
            await reloadGamePages(pages, ['Alice']);
            await buyCurrentSquare(pages.Alice, 'Mediterranean');
            await shot(testInfo, pages.Alice, '08-alice-buys-mediterranean');

            await repairGameState(pages.Alice, { current: 'Alice', positions: { Alice: 3 }, unowned: ['prop-1'], diceRolled: { Alice: true } });
            await reloadGamePages(pages, ['Alice']);
            await buyCurrentSquare(pages.Alice, 'Baltic');
            await shot(testInfo, pages.Alice, '09-alice-buys-baltic-completes-brown');

            await openTab(pages.Alice, 'Board');
            await buyHouses(pages.Alice);
            await shot(testInfo, pages.Alice, '10-alice-buys-houses-on-brown');

            await openTab(pages.Alice, 'Game');
            await issueDebt(pages.Alice, 150, 5);
            await shot(testInfo, pages.Alice, '11-alice-borrows-against-her-portfolio');

            await settleDebt(pages.Alice, 75);
            await shot(testInfo, pages.Alice, '12-alice-settles-partial-debt');
            await payOffDebt(pages.Alice);

            await createIpo(pages.Alice, 'BRWN', 'prop-0');
            await shot(testInfo, pages.Alice, '13-alice-creates-ipo');

            await expectCorporationDetails(pages.Alice, 'BRWN', /Alice:\s*12,000 shares \(100\.0%\)/i);
            await expectCorporationDetails(pages.Alice, 'BRWN', /No treasury shares for sale/i);
            await issueCorporationDebt(pages.Alice, 'BRWN', 100);
            await shot(testInfo, pages.Alice, '13b-alice-issues-corporation-debt');

            await endTurnNoAssert(pages.Alice);
            await repairGameState(pages.Alice, { current: 'Bob', diceRolled: { Bob: false } });
            await reloadGamePages(pages, ['Bob']);
            // A founder's shares change hands only by an offer they accept, so the
            // shareholders for the chairman vote are set up directly.
            await repairGameState(pages.Alice, {
                corporations: {
                    BRWN: {
                        shareholders: [
                            { name: 'Bob', shares: 4500 },
                            { name: 'Carol', shares: 4500 },
                        ],
                        availableShares: 3000,
                    },
                },
            });
            await reloadGamePages(pages, ['Bob', 'Carol']);
            await proposeChairmanVote(pages.Bob, 'BRWN', 'Bob');
            await supportChairmanVote(pages.Carol, 'BRWN');
            await expectCorporationDetails(pages.Carol, 'BRWN', /Chairman:\s*Bob/i);
            await shot(testInfo, pages.Carol, '14b-carol-supports-chairman-vote');

            // Brown went into BRWN with its houses; trade an unbuilt street instead.
            await repairGameState(pages.Alice, { owners: { Alice: ['prop-3'] } });
            await reloadGamePages(pages, ['Bob']);
            await tradeCashForProperty(pages.Bob, 'Bob', 'Alice', 120, 'prop-3');
            await shot(testInfo, pages.Bob, '15-bob-trades-cash-for-property');

            await repairGameState(pages.Alice, {
                current: 'Bob',
                positions: { Bob: 0 },
                owners: { Alice: ['prop-2'] },
                diceRolled: { Bob: false },
            });
            await reloadGamePages(pages, ['Bob']);
            await rollAndPayRent(pages.Bob, [3, 3], 'Alice');
            await shot(testInfo, pages.Bob, '16-bob-lands-on-alice-property-and-pays-rent');

            await makePayment(pages.Bob, 'Bob', 'Carol', 45);
            await shot(testInfo, pages.Bob, '17-bob-pays-carol');

            await repairGameState(pages.Alice, {
                current: 'Bob',
                positions: { Bob: 35 },
                diceRolled: { Bob: false },
            });
            await reloadGamePages(pages, ['Bob']);
            await rollWithDiceAndExpect(pages.Bob, [1, 2], /paid \$100 to the Bank for Luxury Tax/i);
            await expectBuyUnavailable(pages.Bob, /No Property to Buy/i);
            await shot(testInfo, pages.Bob, '18-bob-pays-luxury-tax');

            await endTurnNoAssert(pages.Bob);
            await repairGameState(pages.Alice, { current: 'Carol', positions: { Carol: 12 }, unowned: ['prop-6'], diceRolled: { Carol: true } });
            await reloadGamePages(pages, ['Carol']);
            await buyCurrentSquare(pages.Carol, 'Electric Company');
            await shot(testInfo, pages.Carol, '19-carol-buys-utility');

            await issueDebt(pages.Carol, 120, 5);
            await shot(testInfo, pages.Carol, '20-carol-issues-debt');

            await repairGameState(pages.Alice, {
                current: 'Carol',
                positions: { Carol: 18 },
                diceRolled: { Carol: false },
                chanceCards: [card('chance', 'ch-11')],
            });
            await reloadGamePages(pages, ['Carol']);
            await rollWithDiceAndExpect(pages.Carol, [1, 3], /drew card: Pay a poor tax of \$15/i);
            await expect(pages.Carol.locator('.card-effect-summary')).toContainText(/Applied: paid \$15\.00/i);
            await shot(testInfo, pages.Carol, '21-carol-draws-chance-card');

            await endTurnNoAssert(pages.Carol);
            await repairGameState(pages.Alice, { current: 'Dave', diceRolled: { Dave: true } });
            await reloadGamePages(pages, ['Dave']);
            await makePayment(pages.Dave, 'Dave', 'Alice', 60);
            await shot(testInfo, pages.Dave, '22-dave-pays-alice');

            await repairGameState(pages.Alice, {
                current: 'Dave',
                positions: { Dave: 0 },
                diceRolled: { Dave: false },
                communityChestCards: [card('community_chest', 'cc-7')],
            });
            await reloadGamePages(pages, ['Dave']);
            await rollWithDiceAndExpect(pages.Dave, [1, 1], /drew card: Grand Opera Night/i);
            await expectPlayerCashGreaterThan(pages.Dave, 'Dave', 1500);
            await shot(testInfo, pages.Dave, '23-dave-draws-community-chest-card');

            await openTab(pages.Dave, 'Board');
            await shot(testInfo, pages.Dave, '24-dave-board-mobile-ish-view');

            await repairGameState(pages.Alice, { current: 'Dave', diceRolled: { Dave: true } });
            await reloadGamePages(pages, ['Dave']);
            await endTurnNoAssert(pages.Dave);
            await repairGameState(pages.Alice, { current: 'Alice', diceRolled: { Alice: true } });
            await reloadGamePages(pages, ['Alice']);
            await repairGameState(pages.Alice, {
                current: 'Alice',
                positions: { Alice: 28 },
                diceRolled: { Alice: false },
            });
            await reloadGamePages(pages, ['Alice']);
            await rollWithDiceAndExpect(pages.Alice, [1, 1], /landed on Go to Jail/i);
            await expectPlayerState(pages.Alice, 'Alice', player => player.inJail === true && player.position === 10);
            await shot(testInfo, pages.Alice, '25-alice-sent-to-jail');

            await repairGameState(pages.Alice, {
                current: 'Alice',
                positions: { Alice: 10 },
                players: { Alice: { inJail: true, jailTurns: 0, hasGetOutOfJailCard: false } },
                diceRolled: { Alice: false },
            });
            await reloadGamePages(pages, ['Alice']);
            await rollWithDiceAndExpect(pages.Alice, [1, 2], /is in Jail \(turn 1\/3\)/i);
            await expectPlayerState(pages.Alice, 'Alice', player => player.inJail === true && player.jailTurns === 1);
            await shot(testInfo, pages.Alice, '26-alice-jail-turn-without-doubles');

            await openTab(pages.Alice, 'Recent events', 'log');
            await expect(pages.Alice.locator('#full-game-log')).toContainText(/purchased|paid|created IPO|issued debt/i, { timeout: 10000 });
            await expect(pages.Alice.locator('#full-game-log')).toContainText(/rent/i, { timeout: 10000 });
            await expect(pages.Alice.locator('#full-game-log')).toContainText(/Luxury Tax/i, { timeout: 10000 });
            await expect(pages.Alice.locator('#full-game-log')).toContainText(/Chance|Community Chest/i, { timeout: 10000 });
            await shot(testInfo, pages.Alice, '27-log-shows-game-history-including-special-squares');

            await openTab(pages.Alice, 'Game');
            await repairGameState(pages.Alice, {
                current: 'Alice',
                diceRolled: { Alice: true },
                players: {
                    Alice: {
                        cash: 0,
                        // A loan on its last turn: its whole balance is due at End Turn.
                        debts: [{ principal: 100, interestRate: 200, termTurns: 5, turnsRemaining: 1, createdAt: new Date().toISOString() }],
                        inJail: false,
                        jailTurns: 0,
                    },
                    Bob: { cash: 500, bankrupt: false },
                    Carol: { cash: -1, bankrupt: true },
                    Dave: { cash: -1, bankrupt: true },
                },
            });
            await reloadGamePages(pages, ['Alice']);
            await endTurnExpectingGameOver(pages.Alice);
            await expect(pages.Alice.locator('#winnerModal')).toBeVisible({ timeout: 10000 });
            await expect(pages.Alice.locator('#winnerName')).toContainText('Bob', { timeout: 10000 });
            await expect(pages.Alice.locator('#winnerReason')).toContainText(/last player standing|BANKRUPT|Game over/i, { timeout: 10000 });
            await shot(testInfo, pages.Alice, '28-final-winner-modal-bankruptcy-ending');

            for (const name of PLAYER_NAMES) {
                expect(issues[name].errors, `${name} browser issues:\n${issues[name].summary()}`).toEqual([]);
            }
        } finally {
            await Promise.all(contexts.map(context => context.close()));
        }
    });
});

async function signInWithOtp(page, baseURL, email) {
    await page.goto(`${baseURL}/auth.html`);
    await page.locator('#email-input').fill(email);
    await page.locator('#send-code-btn').click();
    await expect(page.locator('#code-input')).toBeVisible({ timeout: 10000 });
    await page.locator('#code-input').fill(await readOtp(email));
    await page.locator('#verify-code-btn').click();
    await expect(page).toHaveURL(/lobby\.html/, { timeout: 10000 });
}

async function createRoom(page, roomName, playerName) {
    await page.getByRole('button', { name: /create new game/i }).click();
    await expect(page.locator('#createRoomModal')).toBeVisible();
    await page.locator('#room-name').fill(roomName);
    await page.locator('#max-players').fill('4');
    await page.locator('#host-player-name').fill(playerName);
    await page.locator('#createRoomModal').getByRole('button', { name: /create game/i }).click();
    await expect(page).toHaveURL(/waiting\.html\?room=/, { timeout: 10000 });
}

async function readInviteCode(page) {
    await expect(page.locator('#invite-code')).toHaveText(/[A-Z0-9]{6}/, { timeout: 10000 });
    return (await page.locator('#invite-code').innerText()).trim();
}

async function joinAsGuest(page, baseURL, inviteCode, playerName) {
    await page.goto(`${baseURL}/waiting.html?code=${inviteCode}`);
    await expect(page.locator('#guest-join-section')).toBeVisible({ timeout: 10000 });
    await page.locator('#guest-player-name').fill(playerName);
    await page.locator('#guest-join-btn').click();
    await expect(page).toHaveURL(/waiting\.html\?room=/, { timeout: 10000 });
    await expect(page.locator('#players-list')).toContainText(playerName, { timeout: 10000 });
}

async function startGame(page) {
    await expect(page.locator('#start-game-btn')).toBeEnabled({ timeout: 10000 });
    await page.locator('#start-game-btn').click();
}

async function waitForGameLoaded(page) {
    await expect(page.locator('#gameContent')).toContainText(/Current Turn:/, { timeout: 15000 });
}

async function openTab(page, tabName, sectionId = tabName.toLowerCase()) {
    await page.getByRole('button', { name: new RegExp(`^${tabName}$`, 'i') }).click();
    await expect(page.locator(`#${sectionId}`)).toHaveClass(/active/);
}

async function buyCurrentSquare(page, expectedText) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-buy-property').click();
    await expect(page.locator('#buyPropertyModal')).toBeVisible();
    await expect(page.locator('#availableProperties')).toContainText(expectedText, { timeout: 10000 });
    await expect(page.locator('#purchasePriceDisplay')).toContainText(/\$\d+\.\d{2}/);
    await clickAndWaitForGameVersion(page, page.locator('#confirm-purchase-btn'));
    await expect(page.locator('#buyPropertyModal')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#gameContent')).toContainText(expectedText, { timeout: 10000 });
}

async function buyHouses(page) {
    await openTab(page, 'Board');
    await page.getByRole('button', { name: /buy houses/i }).click();
    await expect(page.locator('#houseModal')).toBeVisible();
    await page.locator('#houseModalProperties button').filter({ hasText: '+' }).nth(0).click();
    await page.locator('#houseModalProperties button').filter({ hasText: '+' }).nth(1).click();
    await clickAndWaitForGameVersion(page, page.locator('#confirm-house-purchase-btn'));
    await expect(page.locator('#gameContent')).toContainText(/Properties/, { timeout: 10000 });
}

async function issueDebt(page, amount, rate) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-debt').click();
    await expect(page.locator('#debtModal')).toBeVisible();
    await page.locator('#debtAction').selectOption('issue');
    // Loans can total 90% of the book value of everything the player owns.
    await expect(page.locator('#loanLimit')).toContainText(/You can borrow up to \$/);
    await page.locator('#loanAmount').fill(String(amount));
    // The 10-turn term is picked by default, at the host's rate for it.
    await expect(page.locator('#loanTerms input[value="10"]')).toBeChecked();
    await expect(page.locator('#loanTerms')).toContainText(`10 turns at ${rate}% per turn`);
    await expect(page.locator('#loanTerms')).toContainText(/a turn, .* in total/);
    await clickAndWaitForGameVersion(page, page.locator('#process-debt-btn'));
    await expect(page.locator('#debtModal')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#gameContent')).toContainText(`${formatMoneyForUi(amount)} · 10 turns left`, { timeout: 10000 });
    await expect(page.locator('#gameContent')).toContainText(/Autopay \$[\d,.]+ next turn/, { timeout: 10000 });
}

// Pays off the first loan from the Debt page.
async function payOffDebt(page) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-debt').click();
    const loanCount = await page.locator('#loanList .loan-row').count();
    await clickAndWaitForGameVersion(page, page.locator('#loanList .loan-row').first().locator('[data-loan-payoff]'));
    await expect(page.locator('#loanList .loan-row')).toHaveCount(loanCount - 1, { timeout: 10000 });
    await page.locator('[data-close-modal="debtModal"]').click();
    await expect(page.locator('#debtModal')).toBeHidden({ timeout: 10000 });
}

// Pays part of the first loan from the Debt page, which stays open with the new balance.
async function settleDebt(page, amount) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-debt').click();
    await expect(page.locator('#debtAction')).toHaveValue('loans');
    const loan = page.locator('#loanList .loan-row').first();
    const before = await loan.locator('.loan-balance').textContent();
    await loan.locator('input[type="number"]').fill(String(amount));
    await clickAndWaitForGameVersion(page, loan.locator('[data-loan-pay]'));
    await expect(page.locator('#loanList .loan-row').first().locator('.loan-balance')).not.toHaveText(before, { timeout: 10000 });
    await page.locator('[data-close-modal="debtModal"]').click();
    await expect(page.locator('#debtModal')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#gameContent')).toContainText(/Debts/, { timeout: 10000 });
}

// An IPO always creates 12,000 shares, all the founder's.
async function createIpo(page, ticker, assetId) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-ipo').click();
    await expect(page.locator('#ipoModal')).toBeVisible();
    await page.locator('#ipoTicker').fill(ticker);
    await page.locator(`#ipo-asset-${assetId}`).check();
    await clickAndWaitForGameVersion(page, page.locator('#create-ipo-btn'));
    await expect(page.locator('#gameContent')).toContainText(ticker, { timeout: 10000 });
}

async function expectCorporationDetails(page, ticker, shareholderText) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-corporation').click();
    const card = page.locator('.corporation-card').filter({ hasText: ticker }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText(/Chairman:/i);
    await expect(card).toContainText(/Treasury Cash:/i);
    await expect(card).toContainText(shareholderText);
    await page.locator('#corporationModal').getByRole('button', { name: /close/i }).click();
    await expect(page.locator('#corporationModal')).toBeHidden({ timeout: 10000 });
}

async function issueCorporationDebt(page, ticker, amount) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-debt').click();
    await expect(page.locator('#debtModal')).toBeVisible();
    await page.locator('#debtAction').selectOption('issue');
    await selectByVisibleText(page.locator('#debtIssuer'), `${ticker} Corporation`);
    await page.locator('#loanAmount').fill(String(amount));
    await clickAndWaitForGameVersion(page, page.locator('#process-debt-btn'));
    await expect(page.locator('#debtModal')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#gameContent')).toContainText(new RegExp(`borrowed for ${ticker}`, 'i'), { timeout: 10000 });
}

async function proposeChairmanVote(page, ticker, candidateName) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-corporation').click();
    await expect(page.locator('#corporationModal')).toBeVisible();
    const card = page.locator('.corporation-card').filter({ hasText: ticker }).first();
    await selectByVisibleText(card.locator('select[id^="chairmanVoteCandidate-"]'), candidateName);
    await clickAndWaitForGameVersion(page, card.getByRole('button', { name: /propose/i }));
    await expect(card).toContainText(candidateName, { timeout: 10000 });
    await expect(card).toContainText(/4,500\/12,000 shares supporting/i, { timeout: 10000 });
    await page.locator('#corporationModal').getByRole('button', { name: /close/i }).click();
    await expect(page.locator('#corporationModal')).toBeHidden({ timeout: 10000 });
}

async function supportChairmanVote(page, ticker) {
    await openTab(page, 'Game');
    await activeGameButton(page, 'open-corporation').click();
    await expect(page.locator('#corporationModal')).toBeVisible();
    const card = page.locator('.corporation-card').filter({ hasText: ticker }).first();
    await clickAndWaitForGameVersion(page, card.getByRole('button', { name: /support/i }).first());
    await expect(card).toContainText(/Chairman:\s*Bob/i, { timeout: 10000 });
    await page.locator('#corporationModal').getByRole('button', { name: /close/i }).click();
    await expect(page.locator('#corporationModal')).toBeHidden({ timeout: 10000 });
}

async function rollAndPayRent(page, dice, ownerName) {
    await openTab(page, 'Game');
    await page.evaluate(dice => { window.__E2E_NEXT_DICE = dice.slice(); }, dice);
    await clickAndWaitForGameVersion(page, activeGameButton(page, 'roll-dice'));
    await expect(page.locator('#gameContent')).toContainText(new RegExp(`paid \\$\\d+(?:\\.\\d+)? to ${ownerName} for Rent`, 'i'), { timeout: 10000 });
}

async function rollWithDiceAndExpect(page, dice, expectedText) {
    await openTab(page, 'Game');
    await page.evaluate(dice => { window.__E2E_NEXT_DICE = dice.slice(); }, dice);
    await clickAndWaitForGameVersion(page, activeGameButton(page, 'roll-dice'));
    await expect(page.locator('#gameContent')).toContainText(expectedText, { timeout: 10000 });
}

async function expectBuyUnavailable(page, labelPattern) {
    const buyButton = page.locator('#game.section.active .action-btn-buy');
    await expect(buyButton).toBeDisabled({ timeout: 10000 });
    await expect(buyButton).toContainText(labelPattern);
}

async function tradeCashForProperty(page, cashFrom, propertyFrom, cashAmount, propertyId) {
    await openTab(page, 'Market');
    await selectByVisibleText(page.locator('#player1Select'), cashFrom);
    await page.locator('#player1Cash').fill(String(cashAmount));
    await selectByVisibleText(page.locator('#player2Select'), propertyFrom);
    await page.locator('#player2Select').dispatchEvent('change');
    await expect(page.locator(`#player2-asset-${propertyId}`)).toBeVisible({ timeout: 10000 });
    await page.locator(`#player2-asset-${propertyId}`).check();
    await clickAndWaitForGameVersion(page, page.locator('#executeTradeBtn'));
    await expect(page.locator('#gameContent')).toContainText('Current Turn:', { timeout: 10000 });
}

async function makePayment(page, fromName, toName, amount) {
    await openTab(page, 'Market');
    const fromSelect = page.locator('#paymentFromPlayer');
    await expect(fromSelect).toBeDisabled({ timeout: 10000 });
    await expect(fromSelect.locator('option:checked')).toHaveText(fromName, { timeout: 10000 });
    await selectByVisibleText(page.locator('#paymentToPlayer'), toName);
    await page.locator('#paymentAmount').fill(String(amount));
    await clickAndWaitForGameVersion(page, page.locator('#makePaymentBtn'));
    await expect(page.locator('#gameContent')).toContainText('Current Turn:', { timeout: 10000 });
}

async function endTurn(page, nextPlayerName) {
    await openTab(page, 'Game');
    await clickAndWaitForGameVersion(page, activeGameButton(page, 'end-turn'));
    await expect(page.locator('#gameContent')).toContainText(`Current Turn: ${nextPlayerName}`, { timeout: 10000 });
}

async function endTurnNoAssert(page) {
    await openTab(page, 'Game');
    await clickAndWaitForGameVersion(page, activeGameButton(page, 'end-turn'));
}

async function endTurnExpectingGameOver(page) {
    await openTab(page, 'Game');
    await clickAndWaitForGameVersion(page, activeGameButton(page, 'end-turn'));
}

function activeGameButton(page, action) {
    return page.locator(`#game.section.active button[data-game-action="${action}"]`).first();
}

async function clickAndWaitForGameVersion(page, locator) {
    const beforeVersion = await gameVersion(page);
    await Promise.all([
        page.waitForFunction(previous =>
            typeof currentGame !== 'undefined' &&
            currentGame &&
            typeof currentGame.state_version === 'number' &&
            currentGame.state_version > previous,
            beforeVersion,
            { timeout: 15000 }
        ),
        locator.click(),
    ]);
}

async function gameVersion(page) {
    return page.evaluate(() => typeof currentGame !== 'undefined' && currentGame ? currentGame.state_version : -1);
}

async function repairGameState(hostPage, patch) {
    await hostPage.evaluate(async (patch) => {
        const clone = obj => JSON.parse(JSON.stringify(obj));
        const state = clone(currentGame.game_state);
        const byName = name => state.players.find(player => player.name === name);
        const propertyById = id => state.properties.find(prop => prop.id === id);
        const removePropertyFromPlayers = propId => {
            state.players.forEach(player => {
                player.properties = (player.properties || []).filter(prop => prop.id !== propId);
            });
        };
        const assignProperty = (name, propId) => {
            const player = byName(name);
            const prop = propertyById(propId);
            if (!player || !prop) return;
            removePropertyFromPlayers(propId);
            prop.ownerId = player.userId;
            prop.ownerName = player.name;
            player.properties.push({ id: prop.id, name: prop.name, color: prop.color, value: prop.price });
        };

        if (patch.unowned) {
            patch.unowned.forEach(propId => {
                removePropertyFromPlayers(propId);
                const prop = propertyById(propId);
                if (prop) {
                    prop.ownerId = null;
                    prop.ownerName = null;
                    prop.houses = 0;
                }
            });
        }
        if (patch.owners) {
            Object.entries(patch.owners).forEach(([name, propIds]) => propIds.forEach(propId => assignProperty(name, propId)));
        }
        if (patch.positions) {
            Object.entries(patch.positions).forEach(([name, position]) => {
                const player = byName(name);
                if (player) player.position = position;
            });
        }
        if (patch.diceRolled) {
            Object.entries(patch.diceRolled).forEach(([name, value]) => {
                const player = byName(name);
                if (player) player.diceRolled = !!value;
            });
        }
        if (patch.players) {
            Object.entries(patch.players).forEach(([name, changes]) => {
                const player = byName(name);
                if (!player) return;
                Object.assign(player, changes);
            });
        }
        if (patch.corporations) {
            Object.entries(patch.corporations).forEach(([ticker, changes]) => {
                const corp = state.corporations.find(item => item.ticker === ticker);
                if (!corp) return;
                if (changes.shareholders) {
                    corp.shareholders = changes.shareholders.map(holder => {
                        const player = byName(holder.name);
                        return { userId: player.userId, name: player.name, shares: holder.shares };
                    });
                }
                Object.entries(changes).forEach(([key, value]) => {
                    if (key !== 'shareholders') corp[key] = value;
                });
            });
        }
        if (patch.chanceCards) state.chanceCards = patch.chanceCards;
        if (patch.communityChestCards) state.communityChestCards = patch.communityChestCards;
        if (patch.current) {
            const index = state.players.findIndex(player => player.name === patch.current);
            if (index !== -1) state.currentPlayerIndex = index;
        }
        state.players.forEach(player => {
            if (!patch.players || !patch.players[player.name] || patch.players[player.name].bankrupt == null) {
                player.bankrupt = false;
            }
            player.doubleCount = player.doubleCount || 0;
            player.debts = player.debts || [];
            player.corporations = player.corporations || [];
            player.properties = player.properties || [];
        });

        const repaired = await apiFetch(`/games/${currentGame.id}/state`, {
            method: 'PATCH',
            body: JSON.stringify({
                game_state: state,
                action_type: 'host_state_repair',
                expected_version: currentGame.state_version,
            }),
        });
        currentGame = repaired;
        currentPlayerData = currentGame.game_state.players.find(player => player.userId === currentUser.id);
        renderGameState(currentGame.game_state);
        renderBoardTab();
        populatePlayerDropdowns();
    }, patch);
}

async function expectPlayerState(page, playerName, predicate) {
    await expect.poll(async () => page.evaluate(({ playerName, predicateSource }) => {
        const player = currentGame.game_state.players.find(p => p.name === playerName);
        return Boolean(player && (0, eval)(`(${predicateSource})`)(player));
    }, { playerName, predicateSource: predicate.toString() }), { timeout: 10000 }).toBe(true);
}

async function expectPlayerCashGreaterThan(page, playerName, amount) {
    await expect.poll(async () => page.evaluate(({ playerName }) => {
        const player = currentGame.game_state.players.find(p => p.name === playerName);
        return player ? player.cash : Number.NEGATIVE_INFINITY;
    }, { playerName }), { timeout: 10000 }).toBeGreaterThan(amount);
}

function card(deckType, id) {
    const decks = {
        chance: {
            'ch-11': { id: 'ch-11', text: 'Pay a poor tax of $15.', action: { type: 'pay', amount: 15 } },
        },
        community_chest: {
            'cc-7': { id: 'cc-7', text: 'Grand Opera Night - collect $50 from every other player.', action: { type: 'collect_from_each', amount: 50 } },
        },
    };
    return decks[deckType][id];
}

async function reloadGamePages(pages, names) {
    await Promise.all(names.map(async name => {
        await pages[name].reload();
        await waitForGameLoaded(pages[name]);
    }));
}

async function selectByVisibleText(locator, label) {
    await locator.selectOption({ label });
}

async function shot(testInfo, page, name) {
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
}

async function readOtp(email) {
    const normalized = email.toLowerCase();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const db = new DatabaseSync(DB_PATH, { readOnly: true });
        try {
            const row = db.prepare(`
                SELECT code FROM otps
                WHERE email = ? AND used = 0
                ORDER BY created_at DESC
                LIMIT 1
            `).get(normalized);
            if (row && row.code) return row.code;
        } finally {
            db.close();
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`OTP was not written for ${normalized}`);
}

function captureBrowserIssues(page) {
    const errors = [];
    let expectedGameLookup404s = 0;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        if (
            expectedGameLookup404s > 0 &&
            message.text().includes('Failed to load resource') &&
            message.text().includes('404')
        ) {
            expectedGameLookup404s--;
            return;
        }
        errors.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
        if (response.status() !== 404) return;
        if (response.url().includes('/api/games/by-room/')) {
            expectedGameLookup404s++;
            return;
        }
        errors.push(`404: ${response.url()}`);
    });
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    return {
        errors,
        summary() {
            return errors.join('\n');
        },
    };
}

function autoAcceptDialogs(page) {
    page.on('dialog', dialog => dialog.accept());
}

// Mirrors formatMoney in src/js/ui.js: whole dollars with thousands separators.
function formatMoneyForUi(amount) {
    return `$${Number(amount).toLocaleString('en-US')}`;
}
