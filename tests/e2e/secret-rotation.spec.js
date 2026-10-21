// @ts-check
// Rotating JWT_SECRET must not sign anyone out: a browser holding a token
// signed with the previous secret keeps playing, and every token it keeps
// (active and saved same-device players) is swapped for a new-secret one.
// Runs only when the dev backend was started with JWT_SECRET_PREVIOUS set:
//   JWT_SECRET=rotated JWT_SECRET_PREVIOUS=playwright-e2e-secret npm run test:e2e
const path = require('path');
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API, loginPage } = require('./helpers');

const jwt = require(path.join(__dirname, '../../backend/node_modules/jsonwebtoken'));
const NEW_SECRET = process.env.JWT_SECRET;
const PREVIOUS_SECRET = process.env.JWT_SECRET_PREVIOUS;

test.skip(!PREVIOUS_SECRET, 'backend is not rotating its secret');

function signedWith(secret, userId) {
    return jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
}

function issuedBy(secret, token) {
    try {
        jwt.verify(token, secret);
        return true;
    } catch {
        return false;
    }
}

test('a player holding an old-secret token stays signed in and gets a new token', async ({ page, request }) => {
    const guest = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
    const created = await (await request.post(`${BASE_API}/rooms`, {
        headers: { Authorization: `Bearer ${guest.token}` },
        data: { name: 'Rotation Room', player_name: 'Rotating Guest', max_players: 4 },
    })).json();

    const oldToken = signedWith(PREVIOUS_SECRET, guest.user.id);
    const otherOld = signedWith(PREVIOUS_SECRET, 'saved-player');
    await loginPage(page, oldToken);
    await page.evaluate(({ code, roomId, oldToken, otherOld }) => {
        localStorage.setItem('mortgage_hotseat_resume_rooms', JSON.stringify({
            [code]: { roomId, inviteCode: code, tokens: [{ userId: 'x', token: oldToken, name: 'A' }, { userId: 'y', token: otherOld, name: 'B' }] },
        }));
        sessionStorage.clear();
    }, { code: created.invite_code, roomId: created.id, oldToken, otherOld });

    await page.goto(`${BASE}/waiting.html?room=${created.id}`);
    await expect(page.locator('body')).toContainText('Rotating Guest', { timeout: 10000 });
    expect(page.url()).toContain('waiting.html');

    await expect.poll(() => page.evaluate(() => localStorage.getItem('auth_token'))).not.toBe(oldToken);
    const active = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(issuedBy(NEW_SECRET, active)).toBe(true);
    expect(jwt.decode(active).sub).toBe(guest.user.id);

    await expect.poll(async () => {
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mortgage_hotseat_resume_rooms')));
        return Object.values(saved)[0].tokens.every(record => issuedBy(NEW_SECRET, record.token));
    }).toBe(true);
});
