'use strict';

// Helpers for staging real game states through the dev API and screenshotting
// them, for ux-review reviewers. Require it from a scratch script:
//
//   const ux = require('<repo>/.agents/skills/ux-review/scripts/stage.js')({ web: 3021, api: 3121, shots: '<scratch>/shots' });
//   const browser = await ux.launch();
//   const { users, room, game } = await ux.setupGame(['Alice', 'Bob'], u => ({
//       currentPlayerIndex: 0,
//       players: [ux.player(u[0], { cash: 1340 }), ux.player(u[1])],
//       properties: ux.board({ 'prop-1': [u[0], 2] }),   // owner, houses
//   }));
//   const page = await ux.openGame(browser, users[0], room);   // phone 390x844
//   await ux.shot(page, 'A01-alice-before-roll');              // full page by default
//   await ux.act(game, users[0], 'roll_dice');
//
// POST /api/games accepts any game_state on a dev server, so any situation
// (jail, auction, debt, corporations, game over) can be staged directly.
// Action types and payloads: backend/domain/actionCatalog.js.

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '../../../..');
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

module.exports = function stage({ web, api, shots }) {
    const API = `http://127.0.0.1:${api}/api`;
    const WEB = `http://127.0.0.1:${web}`;
    let counter = 0;
    if (shots) fs.mkdirSync(shots, { recursive: true });

    async function call(method, url, token, data) {
        const res = await fetch(API + url, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: data ? JSON.stringify(data) : undefined,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${url} ${res.status} ${text}`);
        return text ? JSON.parse(text) : null;
    }

    // A guest user: { token, user: { id }, name }.
    async function guest(name) {
        const auth = await call('POST', '/auth/anonymous');
        return { ...auth, name };
    }

    // A waiting room with these players joined; the first is the host.
    async function setupRoom(names, { roomName = 'Friday night', maxPlayers = 8 } = {}) {
        const users = [];
        for (const name of names) users.push(await guest(name));
        const room = await call('POST', '/rooms', users[0].token, { name: roomName, player_name: names[0], max_players: maxPlayers });
        for (const user of users.slice(1)) await call('POST', `/rooms/${room.id}/join`, user.token, { player_name: user.name });
        return { users, room };
    }

    // A started game with an arbitrary state. buildState(users) returns a
    // partial state; defaults fill the rest.
    async function setupGame(names, buildState = () => ({}), options) {
        const { users, room } = await setupRoom(names, options);
        const partial = buildState(users);
        const state = {
            currentPlayerIndex: 0,
            players: users.map(user => player(user)),
            properties: board(),
            corporations: [],
            lastDiceRoll: null,
            lastCardDrawn: null,
            settings: { passGoAmount: 200, startingCash: 1500 },
            ...partial,
        };
        const game = await call('POST', '/games', users[0].token, { room_id: room.id, game_state: state });
        return { users, room, game };
    }

    function player(user, overrides = {}) {
        return {
            userId: user.user.id, name: user.name, cash: 1500, position: 0, bankrupt: false,
            inJail: false, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: false,
            properties: [], corporations: [], debts: [], ...overrides,
        };
    }

    // Every board property, with owners: { 'prop-<index>': [user, houses] }.
    function board(owners = {}) {
        const { MONOPOLY_PROPERTIES } = require(path.join(REPO, 'backend/domain/gameRulesInternal/board.js'));
        return MONOPOLY_PROPERTIES.map((property, index) => {
            const id = `prop-${index}`;
            const owner = owners[id];
            return {
                ...property, id,
                ownerId: owner ? owner[0].user.id : null,
                ownerName: owner ? owner[0].name : null,
                houses: owner ? owner[1] || 0 : 0,
            };
        });
    }

    async function act(game, user, type, payload = {}) {
        const current = await call('GET', `/games/${game.id}`, user.token);
        return call('POST', `/games/${game.id}/actions`, user.token, {
            actionId: `ux-${Date.now()}-${counter++}`, type, payload, expectedVersion: current.state_version,
        });
    }

    async function launch() {
        const { chromium } = require(path.join(REPO, 'node_modules', '@playwright', 'test'));
        try {
            return await chromium.launch();
        } catch {
            return chromium.launch({ executablePath: '/usr/bin/chromium' });
        }
    }

    // A signed-in page. viewport: PHONE (default) or DESKTOP. The one-time
    // turn alerts offer is answered unless { alertsOffer: true }.
    async function openAs(browser, user, url, { viewport = PHONE, alertsOffer = false, iphone = false, standalone = false } = {}) {
        const context = await browser.newContext({
            viewport,
            deviceScaleFactor: 1,
            ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}),
            ...(iphone ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1' } : {}),
        });
        if (standalone) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
        const page = await context.newPage();
        await page.goto(`${WEB}/index.html`);
        if (user) {
            await page.evaluate(([token, offer]) => {
                localStorage.setItem('auth_token', token);
                if (!offer) localStorage.setItem('turn_alerts_prompt_done', 'true');
            }, [user.token, alertsOffer]);
        }
        await page.goto(`${WEB}/${url}`);
        await page.waitForLoadState('networkidle');
        return page;
    }

    async function openGame(browser, user, room, options) {
        const page = await openAs(browser, user, `game.html?room=${room.id}`, options);
        await page.waitForSelector('.turn-ticket');
        await page.waitForTimeout(600);
        return page;
    }

    // Saves <shots>/<name>.png and <name>.txt (the visible text, to grep for repeats).
    async function shot(page, name, { full = true } = {}) {
        await page.waitForTimeout(300);
        const file = path.join(shots, `${name}.png`);
        await page.screenshot({ path: file, fullPage: full });
        fs.writeFileSync(path.join(shots, `${name}.txt`), await page.evaluate(() => document.body.innerText));
        return file;
    }

    return { API, WEB, PHONE, DESKTOP, call, guest, setupRoom, setupGame, player, board, act, launch, openAs, openGame, shot };
};
