// @ts-check
// The Board tab: the whole board fits the screen on phones and desktops, owners and
// buildings show on the squares, a tap puts a square in the centre, and Roll Dice in
// the centre moves your token.
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, apiJson, playerState } = require('./helpers');

const SCREENS = [
    { name: 'small phone', viewport: { width: 320, height: 640 }, phone: true },
    { name: 'iPhone 13', viewport: { width: 390, height: 844 }, phone: true },
    { name: 'short laptop', viewport: { width: 1280, height: 720 }, phone: false },
    { name: 'laptop', viewport: { width: 1440, height: 820 }, phone: false },
];

async function setupGame(request) {
    const users = [];
    for (const name of ['Alice', 'Bob']) {
        const auth = await apiJson(request, 'post', `${BASE_API}/auth/anonymous`);
        users.push({ ...auth, name });
    }
    const [alice, bob] = users;
    const room = await apiJson(request, 'post', `${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: { name: 'Board room', player_name: 'Alice', max_players: 4 },
    });
    await apiJson(request, 'post', `${BASE_API}/rooms/${room.id}/join`, {
        headers: { Authorization: `Bearer ${bob.token}` },
        data: { player_name: 'Bob' },
    });

    // Alice owns the browns (4 houses on Mediterranean, a hotel on Baltic); Bob owns Reading Railroad.
    const config = await apiJson(request, 'get', `${BASE_API}/games/config`);
    const owners = { 'prop-0': alice, 'prop-1': alice, 'prop-9': bob };
    const houses = { 'prop-0': 4, 'prop-1': 5 };
    const properties = config.properties.map((prop, i) => {
        const id = `prop-${i}`;
        const owner = owners[id];
        return { ...prop, id, houses: houses[id] || 0, ownerId: owner ? owner.user.id : null, ownerName: owner ? owner.name : null };
    });
    const players = users.map(user => playerState(user.user.id, user.name, {
        properties: properties.filter(p => p.ownerId === user.user.id).map(p => ({ id: p.id, name: p.name, value: p.price })),
    }));
    await apiJson(request, 'post', `${BASE_API}/games`, {
        headers: { Authorization: `Bearer ${alice.token}` },
        data: {
            room_id: room.id,
            game_state: {
                currentPlayerIndex: 0,
                players,
                properties,
                corporations: [],
                lastDiceRoll: null,
                lastCardDrawn: null,
                settings: { passGoAmount: 200, startingCash: 1500 },
            },
        },
    });
    return { room, alice, bob };
}

async function openBoard(browser, screen, room, user) {
    const context = await browser.newContext({ viewport: screen.viewport, hasTouch: screen.phone, isMobile: screen.phone });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(token => localStorage.setItem('auth_token', token), user.token);
    await page.goto(`${BASE}/game.html?room=${room.id}`);
    await expect(page.locator('.turn-ticket')).toBeVisible();
    await page.click('.nav-tab[data-section="board"]');
    await expect(page.locator('#boardContent .board-frame')).toBeVisible();
    return { context, page };
}

for (const screen of SCREENS) {
    test(`the whole board fits a ${screen.name} without scrolling`, async ({ browser, request }) => {
        const { room, alice } = await setupGame(request);
        const { context, page } = await openBoard(browser, screen, room, alice);

        await expect(page.locator('#boardContent .board-cell')).toHaveCount(40);
        const frame = await page.locator('.board-frame').boundingBox();
        const tabBar = await page.locator('.nav-tabs').boundingBox();
        const bottomLimit = screen.phone ? tabBar.y : screen.viewport.height;
        expect(frame.y + frame.height).toBeLessThanOrEqual(bottomLimit);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(screen.viewport.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

        // GO is the bottom-right corner, Jail the bottom-left.
        const go = await page.locator('.board-cell[data-board-square="0"]').boundingBox();
        const jail = await page.locator('.board-cell[data-board-square="10"]').boundingBox();
        expect(go.x).toBeGreaterThan(jail.x);
        expect(Math.round(go.y)).toBe(Math.round(jail.y));

        // On desktop the names are readable; phones leave them to the centre.
        const name = page.locator('.board-cell[data-board-square="39"] .board-cell-name');
        if (screen.phone) {
            await expect(name).toBeHidden();
        } else {
            await expect(name).toBeVisible();
            const size = await name.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
            expect(size).toBeGreaterThanOrEqual(10);
        }

        // It's Alice's turn, but the board says so itself: no floating banner over it.
        await expect(page.locator('#turn-banner')).toBeHidden();
        await context.close();
    });
}

test('squares show owners and buildings, and a tap puts a square in the centre', async ({ browser, request }) => {
    const { room, alice } = await setupGame(request);
    const { context, page } = await openBoard(browser, SCREENS[1], room, alice);

    const mediterranean = page.locator('.board-cell[data-board-square="1"]');
    await expect(mediterranean.locator('.board-owner-tag')).toHaveText('AL');
    await expect(mediterranean.locator('.board-house')).toHaveText('4');
    await expect(page.locator('.board-cell[data-board-square="3"] .board-hotel')).toHaveText('H');
    await expect(page.locator('.board-cell[data-board-square="5"] .board-owner-tag')).toHaveText('BO');
    await expect(page.locator('.board-cell[data-board-square="6"] .board-price')).toHaveText('$100');

    await expect(page.locator('.board-focus-name')).toHaveText('GO');
    await page.locator('.board-cell[data-board-square="5"]').tap();
    await expect(page.locator('.board-focus-name')).toHaveText('Reading Railroad');
    await expect(page.locator('.board-focus-facts')).toContainText('Bob');
    await page.locator('.board-cell[data-board-square="5"]').tap();
    await expect(page.locator('.board-focus-name')).toHaveText('GO');
    await context.close();
});

test('Roll Dice in the centre of the board moves your token', async ({ browser, request }) => {
    const { room, alice } = await setupGame(request);
    const { context, page } = await openBoard(browser, SCREENS[3], room, alice);

    const token = page.locator(`.board-token[data-token-user="${alice.user.id}"]`);
    const before = await token.boundingBox();
    await page.click('.board-turn [data-game-action="roll-dice"]');
    await expect(page.locator('.board-turn [data-game-action="roll-dice"]')).toHaveCount(0);
    await expect.poll(async () => {
        const box = await token.boundingBox();
        return Math.round(Math.abs(box.x - before.x) + Math.abs(box.y - before.y));
    }, { timeout: 10000 }).toBeGreaterThan(10);

    // Desktop shows recent events beside the board.
    await expect(page.locator('.board-events-panel')).toBeVisible();
    await context.close();
});
