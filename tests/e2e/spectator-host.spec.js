// @ts-check
// A host who only watches: creates the game without a seat, seats two AI
// agents over the real MCP endpoint, starts the game and watches the agents
// play, keeping the host controls.
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

test('a watching host runs a game played only by agents', async ({ page, request }) => {
    const host = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
    await loginPage(page, host.token);
    await page.goto(`${BASE}/lobby.html`);

    await page.locator('#show-create-room-btn').click();
    await page.locator('#room-name').fill('Agents Only');
    await page.locator('#host-spectate').check();
    await expect(page.locator('#host-player-name')).toBeHidden();
    await page.locator('#create-room-btn').click();
    await page.waitForURL(/waiting\.html\?room=/);
    const roomId = new URL(page.url()).searchParams.get('room');

    await expect(page.locator('#spectator-help-text')).toBeVisible();
    await expect(page.locator('#players-list')).toContainText('No players yet');
    await expect(page.locator('#leave-room-btn')).toBeHidden();

    const keys = [];
    for (const name of ['Claude A', 'Claude B']) {
        const invite = await (await request.post(`${BASE_API}/rooms/${roomId}/agent-seats`, {
            headers: { Authorization: `Bearer ${host.token}` },
            data: { label: name },
        })).json();
        const joined = await mcpCall(request, 'join_game', { agent_key: invite.key });
        expect(joined.isError).toBe(false);
        keys.push(invite.key);
    }
    await expect(page.locator('#players-list')).toContainText('Claude B');
    await expect(page.locator('#start-game-btn')).toHaveText('Start Game (2 players)');

    // The watching host still finds the game in their lobby.
    const mine = await (await request.get(`${BASE_API}/rooms/mine`, { headers: { Authorization: `Bearer ${host.token}` } })).json();
    expect(mine.map(room => room.id)).toContain(roomId);

    await page.locator('#start-game-btn').click();
    await page.waitForURL(/game\.html\?room=/);
    await expect(page.locator('.moves')).toContainText('Watching');
    await expect(page.locator('[data-game-action="roll"]')).toHaveCount(0);
    await expect(page.locator('.nav-tab[data-section="market"]')).toBeHidden();
    await expect(page.locator('.players-grid')).toContainText('Claude A');

    // An agent moves; the watching host sees it live.
    const rolls = await Promise.all(keys.map(key => mcpCall(request, 'take_action', { agent_key: key, type: 'roll_dice' })));
    expect(rolls.filter(roll => !roll.isError)).toHaveLength(1);
    await expect(page.locator('.recent-log')).toContainText(/Claude [AB] rolled/);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-game-action="host-pause"]').click();
    await expect(page.locator('[data-game-action="host-resume"]')).toBeVisible();
    await expect(page.locator('.recent-log')).toContainText(/paused/i);
});
