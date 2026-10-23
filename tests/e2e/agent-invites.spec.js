// @ts-check
// The host invites an AI agent from the waiting room, the agent joins over the
// real MCP endpoint with the key from the invite, and the host can rename and
// revoke it.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, loginPage } = require('./helpers');

async function mcpCall(request, name, args) {
    const res = await request.post(`${BASE_API}/mcp`, {
        headers: { Accept: 'application/json, text/event-stream' },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(res.status()).toBe(200);
    const { result } = await res.json();
    return { isError: !!result.isError, body: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
}

test.describe('Agent invites', () => {
    let hostToken, room;

    test.beforeEach(async ({ request }) => {
        const host = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        hostToken = host.token;
        room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${hostToken}` },
            data: { name: 'Agent Invite Room', player_name: 'Host', max_players: 3 },
        })).json();
    });

    test('host names and invites an agent, the agent joins with its key, and the host renames and revokes it', async ({ page, request }) => {
        await loginPage(page, hostToken);
        await page.goto(`${BASE}/waiting.html?room=${room.id}`);
        await expect(page.locator('#agent-invites')).toBeVisible();

        await page.locator('#agent-invite-name').fill('Claude A');
        await page.locator('#agent-invite-create-btn').click();
        const modal = page.locator('#agent-invite-modal');
        await expect(modal).toBeVisible();
        // The host's steps and the agent's prompt are separate: setup is the host's job.
        await expect(modal.getByRole('heading', { name: 'Your part' })).toBeVisible();
        await expect(page.locator('#agent-invite-mcp-url')).toHaveText(/\/api\/mcp$/);
        await expect(modal.locator('.agent-invite-steps')).toContainText('Connect');
        await expect(modal.getByRole('textbox', { name: "The agent's part" })).toBeVisible();
        const prompt = await page.locator('#agent-invite-prompt').inputValue();
        expect(prompt).toContain('playing as Claude A');
        expect(prompt).not.toMatch(/Settings|Add custom connector/);
        const key = (prompt.match(/mbagent_[A-Za-z0-9_-]+/) || [])[0];
        expect(key).toBeTruthy();
        expect(prompt).toContain('join_game');

        await page.locator('#agent-invite-copy-btn').click();
        await expect(page.locator('#agent-invite-copy-btn')).toHaveText(/Copied|Selected/);
        await page.locator('#agent-invite-close-btn').click();
        await expect(modal).toBeHidden();
        // The key does not stay in the page once the host is done with it.
        await expect(page.locator('#agent-invite-prompt')).toHaveValue('');
        expect(await page.locator('body').innerText()).not.toContain(key);
        const inviteRow = page.locator('.agent-invite-row');
        await expect(inviteRow.locator('strong')).toHaveText('Claude A');
        await expect(inviteRow).toContainText('Waiting for the agent to join');
        await expect(page.locator('#agent-invite-name')).toHaveValue('');

        // The host's name wins over the one the agent picks.
        const joined = await mcpCall(request, 'join_game', { agent_key: key, player_name: 'Robo' });
        expect(joined.isError).toBe(false);
        await expect(page.locator('#players-list')).toContainText('Claude A');
        await expect(page.locator('#players-list')).not.toContainText('Robo');
        await expect(page.locator('#players-list .player-badge-agent')).toHaveText('AI');
        await expect(inviteRow).toContainText('Joined');
        await expect(page.locator('#start-game-btn')).toBeEnabled();

        page.once('dialog', dialog => dialog.accept('Claude B'));
        await page.locator('[data-agent-seat-rename]').click();
        await expect(page.locator('#players-list')).toContainText('Claude B');
        await expect(inviteRow.locator('strong')).toHaveText('Claude B');

        page.once('dialog', dialog => dialog.accept());
        await page.locator('[data-agent-seat-revoke]').click();
        await expect(page.locator('#players-list')).not.toContainText('Claude B');
        await expect(page.locator('#agent-invite-list')).toBeEmpty();
        const revoked = await mcpCall(request, 'get_game_state', { agent_key: key });
        expect(revoked.isError).toBe(true);
        expect(revoked.body).toMatch(/Invalid or revoked/);
    });

    test('guests do not see agent invites, and pending invites hold seats', async ({ page, request }) => {
        const invite = await (await request.post(`${BASE_API}/rooms/${room.id}/agent-seats`, {
            headers: { Authorization: `Bearer ${hostToken}` },
            data: {},
        })).json();
        expect(invite.key).toBeTruthy();

        const guest = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const join = await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${guest.token}` },
            data: { player_name: 'Guest' },
        });
        expect(join.status()).toBe(200);
        // Host + guest + the reserved agent seat fill a 3-player room.
        const late = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const lateJoin = await request.post(`${BASE_API}/rooms/${room.id}/join`, {
            headers: { Authorization: `Bearer ${late.token}` },
            data: { player_name: 'Late' },
        });
        expect(lateJoin.status()).toBe(400);

        await loginPage(page, guest.token);
        await page.goto(`${BASE}/waiting.html?room=${room.id}`);
        await expect(page.locator('#players-list')).toContainText('Guest');
        await expect(page.locator('#agent-invites')).toBeHidden();
    });

    // A phone host switches apps to paste the invite, so the page misses the
    // join event; it must catch up when the socket comes back.
    test('an agent that joins while the host page is disconnected shows as joined after reconnecting', async ({ page, request }) => {
        await loginPage(page, hostToken);
        await page.goto(`${BASE}/waiting.html?room=${room.id}`);
        await page.locator('#agent-invite-name').fill('Giskard');
        await page.locator('#agent-invite-create-btn').click();
        await expect(page.locator('#agent-invite-prompt')).toHaveValue(/mbagent_/);
        const key = ((await page.locator('#agent-invite-prompt').inputValue()).match(/mbagent_[A-Za-z0-9_-]+/) || [])[0];
        await page.locator('#agent-invite-close-btn').click();
        const inviteRow = page.locator('.agent-invite-row');
        await expect(inviteRow).toContainText('Waiting for the agent to join');

        await page.evaluate(() => getSocket().disconnect());
        const joined = await mcpCall(request, 'join_game', { agent_key: key });
        expect(joined.isError, String(joined.body)).toBe(false);
        await page.waitForTimeout(500);
        await expect(inviteRow).toContainText('Waiting for the agent to join');

        await page.evaluate(() => getSocket().connect());
        await expect(inviteRow).toContainText('Joined');
        await expect(page.locator('#players-list')).toContainText('Giskard');
    });

    test('the host entering their own room code goes straight back into the room', async ({ page }) => {
        await loginPage(page, hostToken);
        await page.goto(`${BASE}/waiting.html?code=${room.invite_code}`);
        await expect(page).toHaveURL(new RegExp(`waiting\\.html\\?room=${room.id}`));
        await expect(page.locator('#agent-invites')).toBeVisible();
    });
});
