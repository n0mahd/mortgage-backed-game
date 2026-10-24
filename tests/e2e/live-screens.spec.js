// @ts-check
// Every screen follows changes made elsewhere without a reload (AGENTS.md, "Live screens"):
// room events while connected, and a resync when the page is shown again, when the network
// comes back and on a slow poll. Each test changes something in one browser (or through the
// API, standing in for another device) and checks the other screen updates by itself.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage } = require('./helpers');

const PASSWORD = 'correct horse battery';
// The slow poll is 15 seconds; leave room for a loaded Pi.
const POLL_TIMEOUT = 25000;

function auth(token) {
    return { Authorization: `Bearer ${token}` };
}

function uniqueUsername(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
}

async function guest(request) {
    return apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
}

async function account(request, prefix) {
    const username = uniqueUsername(prefix);
    const data = await apiJson(request, 'post', `${BASE_API}/auth/register`, { data: { username, password: PASSWORD } });
    return { ...data, username };
}

async function createRoom(request, token, name, playerName = 'Host') {
    return apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: auth(token),
        data: { name, player_name: playerName, max_players: 4 },
    });
}

async function joinRoom(request, token, roomId, playerName) {
    return apiJson(request, 'post', `${BASE_API}/rooms/${roomId}/join`, {
        headers: auth(token),
        data: { player_name: playerName },
    });
}

// What a phone does when the player switches back to the browser.
async function showPageAgain(page) {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function openLobby(browser, token) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginPage(page, token);
    await page.goto(`${BASE}/lobby.html`);
    await expect(page.locator('#active-rooms-list .loading .spinner')).toHaveCount(0);
    return { context, page };
}

test.describe('My games stays live', () => {
    test('archiving on one device moves the game on another device, with no reload', async ({ browser, request }) => {
        test.setTimeout(60000);
        const me = await account(request, 'arch');
        const room = await createRoom(request, me.token, 'Two Device Archive');
        const phone = await openLobby(browser, me.token);
        const laptop = await openLobby(browser, me.token);
        await expect(phone.page.locator('#active-rooms-list')).toContainText('Two Device Archive');

        await laptop.page.locator(`[data-room-archive="${room.id}"]`).click();
        await expect(laptop.page.locator('#archived-rooms-list')).toContainText('Two Device Archive');

        // Nothing is emitted for a per-user archive, so the phone's slow poll picks it up.
        await expect(phone.page.locator('#archived-rooms-list')).toContainText('Two Device Archive', { timeout: POLL_TIMEOUT });
        await expect(phone.page.locator('#active-rooms-list')).not.toContainText('Two Device Archive');

        await laptop.page.locator(`[data-room-unarchive="${room.id}"]`).click();
        await showPageAgain(phone.page);
        await expect(phone.page.locator('#active-rooms-list')).toContainText('Two Device Archive', { timeout: 5000 });
        await expect(phone.page.locator('#archived-rooms-section')).toBeHidden();

        await phone.context.close();
        await laptop.context.close();
    });

    test('a game created or joined on another device shows up when the page is shown again', async ({ browser, request }) => {
        const me = await account(request, 'newg');
        const friend = await guest(request);
        const friendsRoom = await createRoom(request, friend.token, 'Friend Hosted Room', 'Friend');
        const phone = await openLobby(browser, me.token);
        await expect(phone.page.locator('#active-rooms-list')).toContainText('No games yet');

        await createRoom(request, me.token, 'Made Elsewhere');
        await joinRoom(request, me.token, friendsRoom.id, 'Me');
        await showPageAgain(phone.page);
        await expect(phone.page.locator('#active-rooms-list')).toContainText('Made Elsewhere', { timeout: 5000 });
        await expect(phone.page.locator('#active-rooms-list')).toContainText('Friend Hosted Room');

        await phone.context.close();
    });

    test('a game starting and ending updates its card for the other players', async ({ browser, request }) => {
        const host = await guest(request);
        const bob = await guest(request);
        const room = await createRoom(request, host.token, 'Status Card Room');
        await joinRoom(request, bob.token, room.id, 'Bob');
        const bobs = await openLobby(browser, bob.token);
        const card = bobs.page.locator(`.room-card[data-room-id="${room.id}"]`);
        await expect(card.locator('.room-status')).toHaveText('Waiting');

        const game = await apiJson(request, 'post', `${BASE_API}/games`, { headers: auth(host.token), data: { room_id: room.id } });
        await expect(card.locator('.room-status')).toHaveText('In Progress', { timeout: 5000 });

        await apiJson(request, 'post', `${BASE_API}/games/${game.id}/actions`, {
            headers: auth(host.token),
            data: { actionId: `end-${Date.now()}`, type: 'host_end_game', payload: {}, expectedVersion: game.state_version },
        });
        await expect(card.locator('.room-status')).toHaveText('Completed', { timeout: 5000 });

        await bobs.context.close();
    });

    test('signing in as someone else in another tab switches My games to them', async ({ browser, request }) => {
        const first = await guest(request);
        const second = await account(request, 'tab');
        await createRoom(request, first.token, 'First Users Room');
        await createRoom(request, second.token, 'Second Users Room');

        const { context, page } = await openLobby(browser, first.token);
        await expect(page.locator('#active-rooms-list')).toContainText('First Users Room');

        const otherTab = await context.newPage();
        await otherTab.goto(`${BASE}/auth.html`);
        await otherTab.fill('#login-input', second.username);
        await otherTab.fill('#password-input', PASSWORD);
        await otherTab.click('#signin-btn');
        await otherTab.waitForURL(/lobby\.html/);

        await expect(page.locator('#active-rooms-list')).toContainText('Second Users Room', { timeout: 5000 });
        await expect(page.locator('#active-rooms-list')).not.toContainText('First Users Room');
        await expect(page.locator('#account-name')).toHaveText(second.username);

        await context.close();
    });
});

test.describe('Manage players stays live', () => {
    test('a player joining and leaving while the sheet is open appears and goes', async ({ browser, request }) => {
        const host = await guest(request);
        const carol = await guest(request);
        const room = await createRoom(request, host.token, 'Live Manage Room');
        const hosts = await openLobby(browser, host.token);
        await hosts.page.locator(`[data-room-manage="${room.id}"]`).click();
        const list = hosts.page.locator('#manage-player-list');
        await expect(list.locator('.manage-player-row')).toHaveCount(1);

        await joinRoom(request, carol.token, room.id, 'Carol');
        await expect(list.locator('.manage-player-row', { hasText: 'Carol' })).toBeVisible({ timeout: 5000 });

        await apiJson(request, 'delete', `${BASE_API}/rooms/${room.id}/leave`, { headers: auth(carol.token) });
        await expect(list.locator('.manage-player-row', { hasText: 'Carol' })).toHaveCount(0, { timeout: 5000 });

        await hosts.context.close();
    });

    test('an offer answered on the other device updates the open sheet', async ({ browser, request }) => {
        const host = await account(request, 'mh');
        const dana = await account(request, 'md');
        const room = await createRoom(request, host.token, 'Live Offer Room');
        const danaJoin = await joinRoom(request, dana.token, room.id, 'Dana');
        const danaMember = danaJoin.room_members.find(member => member.user_id === dana.user.id);

        const hosts = await openLobby(browser, host.token);
        await hosts.page.locator(`[data-room-manage="${room.id}"]`).click();
        await expect(hosts.page.locator('.manage-player-row', { hasText: 'Dana' })).toBeVisible();

        // Offered from another of the host's devices: the open sheet shows it.
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/host-transfer`, {
            headers: auth(host.token),
            data: { member_id: danaMember.id },
        });
        await expect(hosts.page.locator('#manage-transfer')).toContainText('Host offer sent to Dana', { timeout: 5000 });

        const danas = await openLobby(browser, dana.token);
        await danas.page.locator('.host-offer', { hasText: 'Live Offer Room' }).getByRole('button', { name: 'Decline' }).click();
        await expect(hosts.page.locator('#manage-transfer')).toBeHidden({ timeout: 5000 });

        await hosts.context.close();
        await danas.context.close();
    });
});

test.describe('Room pages follow the signed-in user', () => {
    // Both tabs share one session, so the open page must not keep acting as the old user.
    async function signInInAnotherTab(context, username) {
        const otherTab = await context.newPage();
        await otherTab.goto(`${BASE}/auth.html`);
        await otherTab.fill('#login-input', username);
        await otherTab.fill('#password-input', PASSWORD);
        await otherTab.click('#signin-btn');
        await otherTab.waitForURL(/lobby\.html/);
    }

    test('the waiting room reloads as the user signed in in another tab', async ({ browser, request }) => {
        const host = await account(request, 'wh');
        const bob = await guest(request);
        const room = await createRoom(request, host.token, 'Tab Switch Waiting', 'Hosty');
        await joinRoom(request, bob.token, room.id, 'Bob');

        const context = await browser.newContext();
        const page = await context.newPage();
        await loginPage(page, bob.token);
        await page.goto(`${BASE}/waiting.html?room=${room.id}`);
        await expect(page.locator('#players-list')).toContainText('Bob');
        await expect(page.locator('#host-controls')).toBeHidden();

        await signInInAnotherTab(context, host.username);
        await expect(page.locator('#host-controls')).toBeVisible({ timeout: 5000 });
        await context.close();
    });

    test('the game page reloads as the user signed in in another tab', async ({ browser, request }) => {
        const host = await account(request, 'gh');
        const bob = await guest(request);
        const room = await createRoom(request, host.token, 'Tab Switch Game', 'Hosty');
        await joinRoom(request, bob.token, room.id, 'Bob');
        await apiJson(request, 'post', `${BASE_API}/games`, { headers: auth(host.token), data: { room_id: room.id } });

        const context = await browser.newContext();
        const page = await context.newPage();
        await loginPage(page, bob.token);
        await page.goto(`${BASE}/game.html?room=${room.id}`);
        await expect(page.locator('#user-email')).toHaveText('Bob');

        await signInInAnotherTab(context, host.username);
        await expect(page.locator('#user-email')).toHaveText('Hosty', { timeout: 5000 });
        await context.close();
    });
});
