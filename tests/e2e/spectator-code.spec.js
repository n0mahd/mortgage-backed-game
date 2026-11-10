// @ts-check
// Watching by room code: a friend who isn't playing opens the room code,
// taps "Just watch" and follows two agents' game live, with no seat and no moves.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API } = require('./helpers');

async function mcpCall(request, name, args) {
    const res = await request.post(`${BASE_API}/mcp`, {
        headers: { Accept: 'application/json, text/event-stream' },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(res.status()).toBe(200);
    const { result } = await res.json();
    return { isError: !!result.isError, body: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
}

test('a friend with the room code watches an agents-only game live', async ({ page, request }) => {
    const host = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
    const auth = { Authorization: `Bearer ${host.token}` };
    const room = await (await request.post(`${BASE_API}/rooms`, {
        headers: auth,
        data: { name: 'Agent Duel', max_players: 2, spectate: true },
    })).json();

    const keys = [];
    for (const name of ['Mine', 'Friend']) {
        const invite = await (await request.post(`${BASE_API}/rooms/${room.id}/agent-seats`, { headers: auth, data: { label: name } })).json();
        expect((await mcpCall(request, 'join_game', { agent_key: invite.key })).isError).toBe(false);
        keys.push(invite.key);
    }
    expect((await request.post(`${BASE_API}/games`, { headers: auth, data: { room_id: room.id } })).status()).toBe(200);

    // The room is full and started, so the page offers seat rejoins and watching.
    await page.goto(`${BASE}/waiting.html?code=${room.invite_code.toLowerCase()}`);
    await expect(page.locator('#guest-join-btn')).toBeHidden();
    await page.locator('#guest-watch-btn').click();
    await page.waitForURL(/game\.html\?room=/);

    await expect(page.locator('.moves')).toContainText("You're watching this game");
    await expect(page.locator('[data-game-action="roll"]')).toHaveCount(0);
    await expect(page.locator('[data-game-action="host-pause"]')).toHaveCount(0);
    await expect(page.locator('.players-grid')).toContainText('Friend');

    const rolls = await Promise.all(keys.map(key => mcpCall(request, 'take_action', { agent_key: key, type: 'roll_dice' })));
    expect(rolls.filter(roll => !roll.isError)).toHaveLength(1);
    await expect(page.locator('.recent-log')).toContainText(/(Mine|Friend) rolled/);

    // Reloading keeps watching: the guest session remembers the room.
    await page.reload();
    await expect(page.locator('.moves')).toContainText("You're watching this game");
});
