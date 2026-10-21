// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE, BASE_API } = require('./helpers');

test.describe('Runtime smoke checks', () => {
    test('referenced scripts and stylesheets are served successfully', async ({ request }) => {
        const urls = await discoverReferencedAssets(request);

        for (const assetUrl of urls) {
            const res = await request.get(assetUrl);
            expect(res.ok(), `${assetUrl} returned ${res.status()}`).toBeTruthy();
        }
    });

    test('landing page room-code join responds and reaches guest join flow', async ({ page }) => {
        const runtimeErrors = collectRuntimeErrors(page);

        await page.goto(BASE);
        await expect.poll(() => page.evaluate(() => typeof window.apiFetch)).toBe('function');

        await page.locator('#resume-code').fill('ABC123');
        await page.locator('#resume-code-btn').click();

        await expect(page).toHaveURL(/waiting\.html\?code=ABC123/, { timeout: 5000 });
        await expect(page.locator('#guest-join-section')).toBeVisible({ timeout: 5000 });
        expect(runtimeErrors()).toEqual([]);
    });

    test('guest can join a waiting room through the room-code UI', async ({ page, request }) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const host = await (await request.post(`${BASE_API}/auth/anonymous`)).json();
        const room = await (await request.post(`${BASE_API}/rooms`, {
            headers: { Authorization: `Bearer ${host.token}` },
            data: { name: 'Runtime Guest Join', player_name: 'Host', max_players: 4 },
        })).json();

        await page.goto(BASE);
        await page.locator('#resume-code').fill(room.invite_code);
        await page.locator('#resume-code-btn').click();
        await expect(page).toHaveURL(new RegExp(`waiting\\.html\\?code=${room.invite_code}`), { timeout: 5000 });

        await page.locator('#guest-player-name').fill('Guest');
        await page.locator('#guest-join-btn').click();

        await expect(page).toHaveURL(/waiting\.html\?room=/, { timeout: 10000 });
        await expect(page.locator('#players-list')).toContainText('Guest', { timeout: 10000 });
        expect(runtimeErrors()).toEqual([]);
    });

    test('hotseat setup creates a game without missing helper errors', async ({ page }) => {
        const runtimeErrors = collectRuntimeErrors(page);

        await page.goto(`${BASE}/hotseat.html`);
        await expect.poll(() => page.evaluate(() => typeof window.apiFetch)).toBe('function');

        await page.locator('.player-name-input').nth(0).fill(`Alpha${Date.now()}`);
        await page.locator('.player-name-input').nth(1).fill(`Beta${Date.now()}`);
        await page.locator('#start-hotseat-btn').click();

        await expect(page).toHaveURL(/game\.html\?room=/, { timeout: 15000 });
        await expect(page.locator('#gameContent')).toBeVisible({ timeout: 10000 });
        expect(runtimeErrors()).toEqual([]);
    });
});

async function discoverReferencedAssets(request) {
    const pages = ['/', '/auth.html', '/hotseat.html', '/lobby.html', '/waiting.html', '/game.html'];
    const urls = new Set();

    for (const pagePath of pages) {
        const pageUrl = new URL(pagePath, `${BASE}/`).toString();
        const res = await request.get(pageUrl);
        expect(res.ok(), `${pageUrl} returned ${res.status()}`).toBeTruthy();

        const html = await res.text();
        for (const asset of extractScriptAndStylesheetUrls(html, pageUrl)) {
            urls.add(asset);
        }
    }

    return Array.from(urls).sort();
}

function extractScriptAndStylesheetUrls(html, pageUrl) {
    const urls = [];
    const attrPattern = /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = attrPattern.exec(html)) !== null) {
        const raw = match[1];
        if (raw.startsWith('/socket.io/')) continue;
        if (/^(?:[a-z]+:)?\/\//i.test(raw)) continue;
        urls.push(new URL(raw, pageUrl).toString());
    }
    return urls;
}

function collectRuntimeErrors(page) {
    const errors = [];

    page.on('pageerror', error => {
        errors.push(error.message);
    });

    page.on('console', message => {
        if (message.type() === 'error') {
            const text = message.text();
            if (!/Failed to load resource: the server responded with a status of 404/.test(text)) {
                errors.push(text);
            }
        }
    });

    return () => errors;
}
