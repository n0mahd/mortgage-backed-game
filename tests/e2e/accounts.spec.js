// @ts-check
// Accounts and game management through the real UI (documents/accounts-and-game-management.md):
// password accounts, a guest upgrading in place, archiving, seat links, host transfer and a new
// key for an agent.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, loginPage } = require('./helpers');

const PASSWORD = 'correct horse battery';

function uniqueUsername(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
}

function auth(token) {
    return { Authorization: `Bearer ${token}` };
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

async function whoAmI(page) {
    return page.evaluate(async () => (await apiFetch('/auth/me')).id);
}

async function mcpCall(request, name, args) {
    const res = await request.post(`${BASE_API}/mcp`, {
        headers: { Accept: 'application/json, text/event-stream' },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(res.status()).toBe(200);
    const { result } = await res.json();
    return { isError: !!result.isError, body: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
}

test.describe('Accounts', () => {
    test('create an account with a password, log out, and sign back in', async ({ page }) => {
        const username = uniqueUsername('pw');
        await page.goto(`${BASE}/auth.html?mode=register`);
        await expect(page.locator('#register-keeps-games')).toBeHidden();
        await page.locator('#register-username').fill(username);
        await page.locator('#register-password').fill(PASSWORD);
        await page.locator('#register-confirm').fill('something else');
        await page.locator('#register-btn').click();
        await expect(page.locator('#register-error')).toContainText("don't match");

        await page.locator('#register-confirm').fill(PASSWORD);
        await page.locator('#register-btn').click();
        await page.waitForURL(/lobby\.html/);
        await expect(page.locator('#account-name')).toHaveText(username);
        await expect(page.locator('#guest-banner')).toBeHidden();
        await expect(page.locator('#signin-link')).toBeHidden();

        await page.locator('#logout-btn').click();
        await page.waitForURL(/index\.html|\/$/);
        expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBeFalsy();

        await page.goto(`${BASE}/auth.html`);
        await page.locator('#login-input').fill(username);
        await page.locator('#password-input').fill('wrong password');
        await page.locator('#signin-btn').click();
        await expect(page.locator('#signin-error')).toContainText('Wrong username or password');

        await page.locator('#password-input').fill(PASSWORD);
        await page.locator('#signin-btn').click();
        await page.waitForURL(/lobby\.html/);
        await expect(page.locator('#account-name')).toHaveText(username);
    });

    test('sign-in honours a same-site ?next= and ignores another site', async ({ page, request }) => {
        const user = await account(request, 'nx');
        await page.goto(`${BASE}/auth.html?next=${encodeURIComponent('//example.com/x')}`);
        await page.locator('#login-input').fill(user.username);
        await page.locator('#password-input').fill(PASSWORD);
        await page.locator('#signin-btn').click();
        await page.waitForURL(/lobby\.html/);

        await page.evaluate(() => localStorage.removeItem('auth_token'));
        await page.goto(`${BASE}/auth.html?next=${encodeURIComponent('hotseat.html')}`);
        await page.locator('#login-input').fill(user.username);
        await page.locator('#password-input').fill(PASSWORD);
        await page.locator('#signin-btn').click();
        await page.waitForURL(/hotseat\.html/);
    });

    test('a guest who creates an account keeps their game in My games', async ({ page, request }) => {
        const me = await guest(request);
        const room = await createRoom(request, me.token, 'Guest Upgrade Room');
        await loginPage(page, me.token);
        await page.goto(`${BASE}/lobby.html`);
        await expect(page.locator('#active-rooms-list')).toContainText('Guest Upgrade Room');
        await expect(page.locator('#guest-banner')).toBeVisible();
        await expect(page.locator('#signin-link')).toBeVisible();

        await page.locator('#guest-banner').getByRole('link', { name: 'Create an account' }).click();
        await page.waitForURL(/auth\.html\?mode=register/);
        await expect(page.locator('#register-keeps-games')).toHaveText('Your current games stay with you.');
        const username = uniqueUsername('up');
        await page.locator('#register-username').fill(username);
        await page.locator('#register-password').fill(PASSWORD);
        await page.locator('#register-confirm').fill(PASSWORD);
        await page.locator('#register-btn').click();

        await page.waitForURL(/lobby\.html/);
        await expect(page.locator('#guest-banner')).toBeHidden();
        await expect(page.locator('#account-name')).toHaveText(username);
        await expect(page.locator(`#active-rooms-list [data-room-id="${room.id}"]`)).toContainText('Guest Upgrade Room');
        expect(await whoAmI(page)).toBe(me.user.id);
    });
});

test.describe('My games', () => {
    test('archive hides a game from the active list and unarchive brings it back', async ({ page, request }) => {
        const me = await guest(request);
        const room = await createRoom(request, me.token, 'Archive Me');
        await loginPage(page, me.token);
        await page.goto(`${BASE}/lobby.html`);

        await page.locator(`[data-room-archive="${room.id}"]`).click();
        await expect(page.locator('#archived-rooms-section')).toBeVisible();
        await expect(page.locator('#archived-rooms-list')).toContainText('Archive Me');
        await expect(page.locator('#active-rooms-list')).not.toContainText('Archive Me');

        await page.reload();
        await expect(page.locator('#archived-rooms-list')).toContainText('Archive Me');

        await page.locator(`[data-room-unarchive="${room.id}"]`).click();
        await expect(page.locator('#active-rooms-list')).toContainText('Archive Me');
        await expect(page.locator('#archived-rooms-section')).toBeHidden();

        await page.locator(`[data-room-open="${room.id}"]`).click();
        await page.waitForURL(new RegExp(`waiting\\.html\\?room=${room.id}`));
    });
});

test.describe('Manage players', () => {
    test('a seat link signs a guest back in to their seat, once', async ({ page, browser, request }) => {
        const host = await guest(request);
        const bob = await guest(request);
        const room = await createRoom(request, host.token, 'Seat Link Room');
        await joinRoom(request, bob.token, room.id, 'Bob');

        await loginPage(page, host.token);
        await page.goto(`${BASE}/waiting.html?room=${room.id}`);
        await expect(page.locator('[data-manage-room-link]')).toHaveAttribute('href', `lobby.html?manage=${room.id}`);
        await page.locator('[data-manage-room-link]').click();
        await page.waitForURL(/lobby\.html\?manage=/);
        await expect(page.locator('#manageRoomModal')).toBeVisible();

        const bobRow = page.locator('.manage-player-row', { hasText: 'Bob' });
        await expect(bobRow.locator('.badge', { hasText: 'Guest' })).toBeVisible();
        const [linkResponse] = await Promise.all([
            page.waitForResponse(res => /\/members\/[^/]+\/link$/.test(res.url()) && res.request().method() === 'POST'),
            bobRow.getByRole('button', { name: 'Copy link' }).click(),
        ]);
        const { url } = await linkResponse.json();
        expect(url).toContain('index.html?seat=');
        await expect(page.locator('#manage-room-status')).toContainText('Bob');

        const seatPath = new URL(url).pathname + new URL(url).search;
        const other = await browser.newContext();
        const phone = await other.newPage();
        await phone.goto(`${BASE}${seatPath}`);
        await phone.waitForURL(new RegExp(`waiting\\.html\\?room=${room.id}`));
        expect(await whoAmI(phone)).toBe(bob.user.id);

        // Single use: a second browser gets an inline error, and the token leaves the address bar.
        const third = await browser.newContext();
        const late = await third.newPage();
        await late.goto(`${BASE}${seatPath}`);
        await expect(late.locator('#resume-error')).toContainText('expired or was replaced');
        expect(late.url()).not.toContain('seat=');
        await other.close();
        await third.close();
    });

    test("an account's seat link asks them to sign in, then opens the game", async ({ page, browser, request }) => {
        const host = await guest(request);
        const carol = await account(request, 'sl');
        const room = await createRoom(request, host.token, 'Account Seat Room');
        await joinRoom(request, carol.token, room.id, 'Carol');

        await loginPage(page, host.token);
        await page.goto(`${BASE}/lobby.html?manage=${room.id}`);
        const carolRow = page.locator('.manage-player-row', { hasText: 'Carol' });
        await expect(carolRow.locator('.badge', { hasText: 'Account' })).toBeVisible();
        const [linkResponse] = await Promise.all([
            page.waitForResponse(res => /\/members\/[^/]+\/link$/.test(res.url())),
            carolRow.getByRole('button', { name: 'Copy link' }).click(),
        ]);
        const { url } = await linkResponse.json();

        const other = await browser.newContext();
        const phone = await other.newPage();
        await phone.goto(`${BASE}${new URL(url).pathname}${new URL(url).search}`);
        await phone.waitForURL(/auth\.html/);
        await expect(phone.locator('#auth-reason')).toHaveText('This seat belongs to an account. Sign in to continue.');
        await phone.locator('#login-input').fill(carol.username);
        await phone.locator('#password-input').fill(PASSWORD);
        await phone.locator('#signin-btn').click();
        await phone.waitForURL(new RegExp(`waiting\\.html\\?room=${room.id}`));
        expect(await whoAmI(phone)).toBe(carol.user.id);
        await other.close();
    });

    test('the host offers host to a player with an account, who accepts it', async ({ page, browser, request }) => {
        const host = await guest(request);
        const dana = await account(request, 'ht');
        const room = await createRoom(request, host.token, 'Host Transfer Room');
        await joinRoom(request, dana.token, room.id, 'Dana');

        await loginPage(page, host.token);
        await page.goto(`${BASE}/lobby.html`);
        await page.locator(`[data-room-manage="${room.id}"]`).click();
        const danaRow = page.locator('.manage-player-row', { hasText: 'Dana' });
        page.once('dialog', dialog => {
            expect(dialog.message()).toContain('need an account');
            dialog.accept();
        });
        await danaRow.getByRole('button', { name: 'Make host' }).click();
        await expect(page.locator('#manage-transfer')).toContainText('Host offer sent to Dana');
        await expect(danaRow).toContainText('Offer sent');

        const other = await browser.newContext();
        const danaPage = await other.newPage();
        await loginPage(danaPage, dana.token);
        await danaPage.goto(`${BASE}/lobby.html`);
        const offer = danaPage.locator('.host-offer', { hasText: 'Host Transfer Room' });
        await expect(offer).toContainText('Host offered to make you host');
        await offer.getByRole('button', { name: 'Accept' }).click();
        await expect(danaPage.locator('#host-offers-section')).toBeHidden();
        await expect(danaPage.locator(`[data-room-manage="${room.id}"]`)).toBeVisible();

        const after = await apiJson(request, 'get', `${BASE_API}/rooms/${room.id}`, { headers: auth(dana.token) });
        expect(after.host_id).toBe(dana.user.id);
        await other.close();
    });

    test('a guest offered host is asked to create an account first', async ({ page, browser, request }) => {
        const host = await guest(request);
        const eve = await guest(request);
        const room = await createRoom(request, host.token, 'Guest Offer Room');
        const joined = await joinRoom(request, eve.token, room.id, 'Eve');
        const manage = await apiJson(request, 'get', `${BASE_API}/rooms/${room.id}/manage`, { headers: auth(host.token) });
        const eveMember = manage.members.find(member => member.player_name === 'Eve');
        expect(eveMember, JSON.stringify(joined)).toBeTruthy();
        await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/host-transfer`, {
            headers: auth(host.token),
            data: { member_id: eveMember.id },
        });

        await loginPage(page, eve.token);
        await page.goto(`${BASE}/lobby.html`);
        await page.locator('.host-offer').getByRole('button', { name: 'Accept' }).click();
        await page.waitForURL(/auth\.html\?mode=register/);
        await expect(page.locator('#auth-reason')).toContainText('create an account first');
        await expect(page.locator('#register-keeps-games')).toBeVisible();

        // Creating the account keeps the seat and the offer; accepting now works.
        await page.locator('#register-username').fill(uniqueUsername('ev'));
        await page.locator('#register-password').fill(PASSWORD);
        await page.locator('#register-confirm').fill(PASSWORD);
        await page.locator('#register-btn').click();
        await page.waitForURL(/lobby\.html/);
        await page.locator('.host-offer').getByRole('button', { name: 'Accept' }).click();
        await expect(page.locator(`[data-room-manage="${room.id}"]`)).toBeVisible();
    });

    test('the host gives an agent a new key; the old key stops working', async ({ page, request }) => {
        const host = await guest(request);
        const room = await createRoom(request, host.token, 'Agent Key Room');
        const invite = await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/agent-seats`, {
            headers: auth(host.token),
            data: { label: 'Claude K' },
        });
        expect((await mcpCall(request, 'join_game', { agent_key: invite.key })).isError).toBe(false);

        await loginPage(page, host.token);
        await page.goto(`${BASE}/lobby.html?manage=${room.id}`);
        const agentRow = page.locator('.manage-player-row', { hasText: 'Claude K' });
        await expect(agentRow.locator('.badge', { hasText: 'AI' })).toBeVisible();
        page.once('dialog', dialog => dialog.accept());
        await agentRow.getByRole('button', { name: 'New key' }).click();

        const modal = page.locator('#manageAgentKeyModal');
        await expect(modal).toBeVisible();
        await expect(page.locator('#manage-agent-key-mcp-url')).toHaveText(/\/api\/mcp$/);
        const prompt = await page.locator('#manage-agent-key-prompt').inputValue();
        const newKey = (prompt.match(/mbagent_[A-Za-z0-9_-]+/) || [])[0];
        expect(newKey).toBeTruthy();
        expect(newKey).not.toBe(invite.key);

        await page.locator('#manage-agent-key-copy-btn').click();
        await expect(page.locator('#manage-agent-key-copy-btn')).toHaveText(/Copied|Selected/);
        await page.locator('#manage-agent-key-close-btn').click();
        await expect(modal).toBeHidden();
        await expect(page.locator('#manage-agent-key-prompt')).toHaveValue('');
        expect(await page.content()).not.toContain(newKey);

        const old = await mcpCall(request, 'get_game_state', { agent_key: invite.key });
        expect(old.isError).toBe(true);
        const fresh = await mcpCall(request, 'get_game_state', { agent_key: newKey });
        expect(fresh.isError).toBe(false);
    });
});
