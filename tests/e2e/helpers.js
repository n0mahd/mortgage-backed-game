/**
 * E2E test helpers for mortgage-backed-game Playwright tests.
 */

const { expect } = require('@playwright/test');

const BASE_API = process.env.API_BASE_URL || 'http://127.0.0.1:3111/api';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3011';
const BASE = BASE_URL;

/**
 * Set the auth token in a page's localStorage and reload.
 */
async function loginPage(page, token) {
    if (page.url() === 'about:blank') {
        await page.goto(BASE_URL);
    }
    await page.evaluate((t) => localStorage.setItem('auth_token', t), token);
}

function playerState(userId, name, overrides = {}) {
    return {
        userId,
        name,
        cash: 1500,
        position: 0,
        bankrupt: false,
        inJail: false,
        jailTurns: 0,
        doubleCount: 0,
        diceRolled: false,
        hasGetOutOfJailCard: false,
        properties: [],
        corporations: [],
        debts: [],
        ...overrides,
    };
}

async function apiJson(request, method, url, options = {}) {
    const res = await request[method](url, options);
    const text = await res.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    expect(res.ok(), `${method.toUpperCase()} ${url} failed ${res.status()}: ${text}`).toBeTruthy();
    return body;
}

// The Market tab has panes: 'New trade', 'Send money', 'Trade proposals', 'Past transactions'.
async function showMarketPane(page, name) {
    await page.getByRole('tab', { name }).click();
}

// Corporations sheet: open the list, then one corporation's detail, and on a
// phone the given tab (from 720px every panel shows and the tabs are hidden).
async function openCorporation(page, corpId, tab = null) {
    await page.locator('[data-game-action="open-corporation"]').first().click();
    await page.click(`#corporationModal [data-game-action="open-corporation-detail"][data-corp-id="${corpId}"]`);
    if (tab) {
        const button = page.locator(`#corporationModal [data-game-action="corporation-tab"][data-tab="${tab}"]`);
        if (await button.isVisible()) await button.click();
    }
}

module.exports = { BASE, BASE_API, BASE_URL, apiJson, loginPage, playerState, showMarketPane, openCorporation };
