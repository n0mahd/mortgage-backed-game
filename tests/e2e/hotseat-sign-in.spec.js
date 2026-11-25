// @ts-check
// A "Play on one phone" (hotseat) game keeps its players in the tab's own
// session (api.js), so starting, playing, leaving and resuming one never
// replaces the browser's sign-in: a guest's games stay in My games and an
// account stays signed in.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage } = require('./helpers');

function auth(token) {
    return { Authorization: `Bearer ${token}` };
}

async function startHotseatGame(page) {
    await page.goto(`${BASE}/hotseat.html`);
    const stamp = Date.now().toString(36).slice(-4);
    await page.locator('.player-name-input').nth(0).fill(`Ann${stamp}`);
    await page.locator('.player-name-input').nth(1).fill(`Ben${stamp}`);
    await page.locator('#start-hotseat-btn').click();
    await expect(page).toHaveURL(/game\.html\?room=/, { timeout: 15000 });
    await expect(page.locator('#gameContent')).toContainText(`Ann${stamp}`, { timeout: 10000 });
    // Whoever goes first, the phone is handed to them.
    if (await page.locator('#hotseat-interstitial').isVisible()) await page.locator('#dismiss-hotseat-btn').click();
    // The game plays as the hotseat players, not as the browser's sign-in.
    await expect(page.locator('[data-game-action="roll-dice"]').first()).toBeVisible({ timeout: 10000 });
    const roomId = new URL(page.url()).searchParams.get('room');
    const code = (await page.locator('#room-code').innerText()).replace(/[^A-Z0-9]/g, '');
    return { roomId, code };
}

test('a guest keeps their games after starting, leaving and resuming a hotseat game', async ({ page, request }) => {
    const guest = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: auth(guest.token),
        data: { name: 'Guest Online Game', player_name: 'Gus', max_players: 4 },
    });
    await loginPage(page, guest.token);
    await page.goto(`${BASE}/lobby.html`);
    await expect(page.locator(`.room-card[data-room-id="${room.id}"]`)).toBeVisible();

    const hotseat = await startHotseatGame(page);
    await page.locator('[data-game-action="roll-dice"]').first().click();
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBe(guest.token);

    // Leaving the game for My games, in the same tab and in a new one.
    await page.goto(`${BASE}/lobby.html`);
    await expect(page.locator(`.room-card[data-room-id="${room.id}"]`)).toBeVisible();
    await expect(page.locator(`.room-card[data-room-id="${hotseat.roomId}"]`)).toHaveCount(0);
    const other = await page.context().newPage();
    await other.goto(`${BASE}/lobby.html`);
    await expect(other.locator(`.room-card[data-room-id="${room.id}"]`)).toBeVisible();
    await other.close();

    // Resuming the saved hotseat game from the home page.
    await page.goto(`${BASE}/`);
    await page.locator('#resume-code').fill(hotseat.code);
    await page.locator('#resume-code-btn').click();
    await expect(page.locator('#hotseat-resume-options')).toContainText('Saved game on this phone');
    await page.getByRole('button', { name: 'Everyone on this phone' }).click();
    await expect(page).toHaveURL(new RegExp(`game\\.html\\?room=${hotseat.roomId}`), { timeout: 10000 });
    await expect(page.locator('#gameContent')).toContainText('Ann', { timeout: 10000 });
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBe(guest.token);

    await page.goto(`${BASE}/lobby.html`);
    await expect(page.locator(`.room-card[data-room-id="${room.id}"]`)).toBeVisible();
});

test('an account stays signed in after a hotseat game', async ({ page, request }) => {
    const username = `hs${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24);
    const account = await apiJson(request, 'post', `${BASE_API}/auth/register`, {
        data: { username, password: 'correct horse battery' },
    });
    await loginPage(page, account.token);

    await startHotseatGame(page);
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBe(account.token);

    await page.goto(`${BASE}/lobby.html`);
    await expect(page.locator('#account-name')).toHaveText(username);
    await expect(page.locator('#guest-banner')).toBeHidden();
});
