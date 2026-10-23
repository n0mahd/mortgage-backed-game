'use strict';

// Staged setups: put a running game into a rare situation, then let the
// players (bot or agents) play out of it through the real UI. Uses two
// dev-only hooks the backend enables with ALLOW_STATE_REPAIR=true: the host's
// PATCH /games/:id/state (host_state_repair) and per-roll test dice
// (window.__E2E_NEXT_DICE on the rolling player's page). Every staged change
// is logged and tagged in the report, so findings it leads to can be judged
// with that in mind. A stage only sets up the situation; the pathway itself
// still has to happen through clicks.

const { rules } = require('./pathways');

const clone = obj => JSON.parse(JSON.stringify(obj));
const BOARD = rules.BOARD_SQUARES;

// Dice that move a player from `from` to square `to` without doubles, or a
// position to start from when `to` is out of reach.
function routeTo(to) {
    return { from: (to - 3 + 40) % 40, dice: [1, 2] };
}

function assign(state, player, propIds, houses = 0) {
    for (const id of propIds) {
        const prop = state.properties.find(p => p.id === id);
        for (const p of state.players) p.properties = (p.properties || []).filter(x => x.id !== id);
        prop.ownerId = player.userId;
        prop.ownerName = player.name;
        prop.houses = houses;
        player.properties.push({ id: prop.id, name: prop.name, color: prop.color, value: prop.price });
    }
}

function group(color) {
    return rules.MONOPOLY_PROPERTIES.map((p, i) => ({ ...p, id: `prop-${i}` })).filter(p => p.color === color).map(p => p.id);
}

// Properties owned by a corporation can't be reassigned by a stage.
function free(state, ids) {
    return ids.every(id => {
        const prop = state.properties.find(p => p.id === id);
        return !prop.ownerId || state.players.some(p => p.userId === prop.ownerId);
    });
}

const CORP_SHARES = 12000;

// Gives `chair` a corporation (their own if they already chair one) with the
// given shareholders, treasury, rent policy and properties. holders: [[player, shares]];
// the chairman keeps the rest, so with under half given away they still run it.
// props: ids that must be free (no corporation owns them); they move into it.
function corporation(s, chair, { holders = [], cash = 600, policy = 'reinvest', locked = 0, props = [] } = {}) {
    if (!free(s, props)) return null;
    let corp = (s.corporations || []).find(c => c.chairmanId === chair.userId && !c.insolvent);
    if (!corp) {
        let ticker = `T${chair.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}`;
        while (s.corporations.some(c => c.ticker === ticker)) ticker += 'X';
        corp = {
            id: `corp-staged-${Date.now()}`, ticker, name: `${ticker} Corporation`,
            founderId: chair.userId, founderName: chair.name, chairmanId: chair.userId, chairmanName: chair.name,
            totalShares: CORP_SHARES, assets: [], shareholders: [], availableShares: 0, treasuryShares: 0,
            cash: 0, debts: [], chairmanVotes: [], rentPolicy: 'reinvest',
        };
        s.corporations.push(corp);
    }
    const given = holders.reduce((n, [, shares]) => n + shares, 0);
    corp.totalShares = CORP_SHARES;
    corp.treasuryShares = 0;
    corp.availableShares = 0;
    corp.shareholders = [{ userId: chair.userId, name: chair.name, shares: CORP_SHARES - given }, ...holders.map(([p, shares]) => ({ userId: p.userId, name: p.name, shares }))];
    corp.cash = cash;
    corp.debts = [];
    corp.chairmanVotes = [];
    corp.rentPolicy = policy;
    corp.rentPolicyLockedTurns = locked;
    corp.rentPolicyLockSkipsTurnOf = null;
    corp.rentPolicyVote = null;
    for (const id of props) {
        const prop = s.properties.find(p => p.id === id);
        for (const p of s.players) p.properties = (p.properties || []).filter(x => x.id !== id);
        prop.ownerId = corp.id;
        prop.ownerName = `[${corp.ticker}]`;
        prop.houses = 0;
        if (!corp.assets.some(a => (a.id || a) === id)) corp.assets.push({ id: prop.id, name: prop.name, value: prop.price, color: prop.color });
    }
    return corp;
}

// A street nobody owns and no stage is about to hand out, or null.
function unownedStreet(s, avoid = []) {
    const square = [1, 3, 6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23, 24, 26, 27, 29, 31, 32, 34, 37, 39]
        .find(sq => !s.properties.find(p => p.id === BOARD[sq].propertyId).ownerId && !avoid.includes(BOARD[sq].propertyId));
    return square === undefined ? null : { square, id: BOARD[square].propertyId };
}

function landOn(state, player, square, dice) {
    const route = routeTo(square);
    player.position = route.from;
    return { [player.userId]: dice || route.dice };
}

// Each stage: (state, { current, other, uncovered }) => { state, dice, note } or null when it can't apply.
const STAGES = {
    'three-doubles': (s, { current }) => {
        current.doubleCount = 0;
        return { state: s, dice: { [current.userId]: [1, 1, 2, 2, 3, 3] }, note: `${current.name} will roll doubles three times` };
    },
    'land-just-visiting': (s, { current }) => ({ state: s, dice: landOn(s, current, 10), note: `${current.name} moved to 7, will roll 1+2 onto Jail / Just Visiting` }),
    'land-go-to-jail': (s, { current }) => ({ state: s, dice: landOn(s, current, 30), note: `${current.name} moved to 27, will roll 1+2 onto Go to Jail` }),
    'in-jail': (s, { current, uncovered }) => {
        Object.assign(current, { inJail: true, position: 10, jailTurns: 0, doubleCount: 0, diceRolled: false });
        const dice = uncovered.has('jail.doubles-out') ? [4, 4] : [1, 2];
        return { state: s, dice: uncovered.has('jail.pay-fine') ? {} : { [current.userId]: dice }, note: `${current.name} put in Jail` };
    },
    'in-jail-with-card': (s, { current }) => {
        Object.assign(current, { inJail: true, position: 10, jailTurns: 0, doubleCount: 0, diceRolled: false, hasGetOutOfJailCard: true });
        return { state: s, dice: {}, note: `${current.name} put in Jail holding a Get Out of Jail Free card` };
    },
    'jail-third-turn': (s, { current }) => {
        Object.assign(current, { inJail: true, position: 10, jailTurns: 2, doubleCount: 0, diceRolled: false });
        return { state: s, dice: { [current.userId]: [1, 2] }, note: `${current.name} in Jail on their third turn, will miss doubles` };
    },
    monopoly: (s, { current, other }) => {
        const ids = group('Dark Blue');
        if (!other || !free(s, ids)) return null;
        assign(s, other, ids, 0);
        return { state: s, dice: landOn(s, current, 37), note: `${other.name} given Park Place + Boardwalk; ${current.name} will land on Park Place` };
    },
    'houses-built': (s, { current, other }) => {
        const ids = group('Orange');
        if (!other || !free(s, ids)) return null;
        assign(s, other, ids, 4);
        other.cash = Math.max(Number(other.cash), 900);
        return { state: s, dice: landOn(s, current, 19), note: `${other.name} given the Orange group with 4 houses each (and $900 to build hotels); ${current.name} will land on New York Ave` };
    },
    'hotel-built': (s, { current, other }) => {
        const ids = group('Light Blue');
        if (!other || !free(s, ids)) return null;
        assign(s, other, ids, 5);
        return { state: s, dice: landOn(s, current, 8), note: `${other.name} given the Light Blue group with hotels; ${current.name} will land on Vermont Ave` };
    },
    'near-bankrupt': (s, { current, other }) => {
        const ids = group('Dark Blue');
        if (!other || !free(s, ids)) return null;
        assign(s, other, ids, 5);
        current.cash = 40;
        // Something to borrow against, so surviving the claim is possible.
        const spare = group('Brown').find(id => !s.properties.find(p => p.id === id).ownerId);
        if (spare) assign(s, current, [spare], 0);
        return { state: s, dice: landOn(s, current, 39), note: `${other.name} given Dark Blue with hotels; ${current.name} has $40 and will land on Boardwalk` };
    },
    'broke-to-bank': (s, { current }) => {
        current.cash = 30;
        return { state: s, dice: landOn(s, current, 4), note: `${current.name} has $30 and will land on Income Tax` };
    },
    'insolvent-corporation': (s, { current }) => {
        const corp = (s.corporations || []).find(c => c.chairmanId === current.userId && !c.insolvent);
        if (!corp) return null;
        corp.cash = 0;
        corp.debts.push({ id: `debt-staged-${Date.now()}`, principal: 400, interestRate: 5, termTurns: 5, turnsRemaining: 1, autopay: true, issueDate: new Date().toISOString(), issuerType: 'corporation' });
        return { state: s, dice: {}, note: `${corp.ticker} (chaired by ${current.name}) given a $400 loan due at the next End Turn and $0 cash, so it should become insolvent` };
    },
    // A personal loan on its last turn: 'loan-due' can be repaid, 'loan-default' can't.
    'loan-due': (s, { current }) => {
        current.cash = Math.max(Number(current.cash), 700);
        current.debts.push({ id: `debt-staged-${Date.now()}`, principal: 300, interestRate: 5, termTurns: 5, turnsRemaining: 1, autopay: false, issueDate: new Date().toISOString(), issuerType: 'player' });
        return { state: s, dice: {}, note: `${current.name} given a $300 loan (autopay off) due in full at their next End Turn, with the cash to repay it` };
    },
    'loan-default': (s, { current }) => {
        current.cash = 50;
        current.debts.push({ id: `debt-staged-${Date.now()}`, principal: 2000, interestRate: 5, termTurns: 5, turnsRemaining: 1, autopay: true, issueDate: new Date().toISOString(), issuerType: 'player' });
        return { state: s, dice: {}, note: `${current.name} given a $2,000 loan due in full at their next End Turn and $50 cash, so End Turn should declare bankruptcy` };
    },
    'trade-expiry': s => {
        s.settings.tradeOfferTimeoutMs = 3000;
        return { state: s, dice: {}, note: 'trade offers now expire after 3s (restored once one expires)', restoreAfter: 'trade.expire', restore: st => { st.settings.tradeOfferTimeoutMs = 600000; } };
    },
    // ----- the chairman's desk -----
    // The current player chairs a company another player holds 40% of, with $600 and one street:
    // rent policy (before the roll), dividends, chairman votes, trading as the company.
    'corporation-with-shareholders': (s, { current, other }) => {
        const street = unownedStreet(s);
        if (!other || !street) return null;
        const corp = corporation(s, current, { holders: [[other, 4800]], cash: 600, props: [street.id] });
        return corp && { state: s, dice: {}, note: `${current.name} chairs ${corp.ticker} ($600 treasury, ${BOARD[street.square].name}); ${other.name} holds 40%` };
    },
    // As above with the rent policy locked for 3 turns, so changing it needs every shareholder.
    'corporation-locked-policy': (s, { current, other }) => {
        const street = unownedStreet(s);
        if (!other || !street) return null;
        const corp = corporation(s, current, { holders: [[other, 4800]], cash: 300, locked: 3, props: [street.id] });
        return corp && { state: s, dice: {}, note: `${current.name} chairs ${corp.ticker}, rent policy locked for 3 turns; ${other.name} holds 40%` };
    },
    // Another player's Payout company, part-owned by the current player, who lands on its street.
    'payout-corporation': (s, { current, other }) => {
        const street = unownedStreet(s);
        if (!other || !street) return null;
        const corp = corporation(s, other, { holders: [[current, 3000]], cash: 200, policy: 'payout', props: [street.id] });
        return corp && { state: s, dice: landOn(s, current, street.square), note: `${other.name}'s ${corp.ticker} is in Payout with ${BOARD[street.square].name}; ${current.name} holds 25% and will land on it` };
    },
    // Another player's Reinvest company; the current player lands on its street.
    'reinvest-corporation': (s, { current, other }) => {
        const street = unownedStreet(s);
        if (!other || !street) return null;
        const corp = corporation(s, other, { cash: 200, props: [street.id] });
        return corp && { state: s, dice: landOn(s, current, street.square), note: `${other.name}'s ${corp.ticker} owns ${BOARD[street.square].name}; ${current.name} will land on it` };
    },
    // The current player chairs a company with $1,000 and will land on an unowned street.
    'corporation-buys': (s, { current }) => {
        const owned = unownedStreet(s);
        const target = owned && unownedStreet(s, [owned.id]);
        if (!target) return null;
        const corp = corporation(s, current, { cash: 1000, props: [owned.id] });
        return corp && { state: s, dice: landOn(s, current, target.square), note: `${current.name} chairs ${corp.ticker} ($1,000 treasury) and will land on unowned ${BOARD[target.square].name}` };
    },
    // The current player's company owns the whole Brown group and $800 to build with.
    'corporation-group': (s, { current }) => {
        const corp = corporation(s, current, { cash: 800, props: group('Brown') });
        return corp && { state: s, dice: {}, note: `${current.name} chairs ${corp.ticker}, which owns the Brown group and $800` };
    },
    // Another player chairs a company with $800; the current player owns a free street to offer it.
    'offer-to-corporation': (s, { current, other }) => {
        const corpStreet = unownedStreet(s);
        const mine = corpStreet && unownedStreet(s, [corpStreet.id]);
        if (!other || !mine) return null;
        const corp = corporation(s, other, { cash: 800, props: [corpStreet.id] });
        if (!corp) return null;
        assign(s, current, [mine.id], 0);
        return { state: s, dice: {}, note: `${other.name} chairs ${corp.ticker} ($800 treasury); ${current.name} given ${BOARD[mine.square].name} to offer it` };
    },
    'property-offer-expiry': (s, ctx) => {
        const result = STAGES['offer-to-corporation'](s, ctx);
        if (!result) return null;
        s.settings.tradeOfferTimeoutMs = 3000;
        return { ...result, note: `${result.note}; offers now expire after 3s (restored once one expires)`, restoreAfter: 'desk.offer-expired', restore: st => { st.settings.tradeOfferTimeoutMs = 600000; } };
    },
    'auction-timeout': (s, { current }) => {
        s.settings.auctionTimeoutMs = 3000;
        const target = [1, 3, 6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23, 24, 26, 27, 29, 31, 32, 34, 37, 39]
            .find(sq => !s.properties.find(p => p.id === BOARD[sq].propertyId).ownerId);
        if (target === undefined) return null;
        return { state: s, dice: landOn(s, current, target), note: `auctions time out after 3s; ${current.name} will land on unowned ${BOARD[target].name}`, auctionWait: true, restoreAfter: 'auction.timeout', restore: st => { st.settings.auctionTimeoutMs = 120000; } };
    },
};

// Card stages: that card goes to the top of its deck and the player lands on its deck.
for (const [deck, cards, key, square] of [['chance', rules.CHANCE_CARDS, 'chanceCards', 7], ['community_chest', rules.COMMUNITY_CHEST_CARDS, 'communityChestCards', 17]]) {
    for (const card of cards) {
        STAGES[`card:${card.id}`] = (s, { current }) => {
            const rest = (s[key] || []).filter(c => c.id !== card.id);
            s[key] = [card, ...rest];
            return { state: s, dice: landOn(s, current, square), note: `${card.id} put on top of ${deck}; ${current.name} will land on ${BOARD[square].name}` };
        };
    }
}

// Every stage a pathway names must exist; a typo would silently never stage.
{
    const { PATHWAYS } = require('./pathways');
    const unknown = [...new Set(PATHWAYS.map(p => p.stage).filter(name => name && !STAGES[name]))];
    if (unknown.length) throw new Error(`lib/pathways.js names stages lib/stages.js doesn't have: ${unknown.join(', ')}`);
}

function build(name, state, ctx) {
    const fn = STAGES[name];
    if (!fn) throw new Error(`Unknown stage ${name}. Known: ${Object.keys(STAGES).filter(k => !k.startsWith('card:')).join(', ')}, card:<id>`);
    const draft = clone(state);
    const current = draft.players[draft.currentPlayerIndex];
    const others = draft.players.filter(p => p.userId !== current.userId && !p.bankrupt);
    const other = others[Math.floor((ctx.rand ? ctx.rand() : Math.random()) * others.length)];
    const result = fn(draft, { current, other, uncovered: ctx.uncovered || new Set() });
    if (!result) return null;
    // Players see it in Recent actions and Recent events, so nobody mistakes a setup for a bug.
    result.state.gameLog = [...(result.state.gameLog || []), { timestamp: new Date().toISOString(), message: `Test setup: ${result.note}` }].slice(-100);
    const problem = rules.validateStateInvariants(rules.normalizeState(result.state));
    if (problem) throw new Error(`stage ${name} would break an invariant: ${problem}`);
    return { ...result, name, currentUserId: current.userId };
}

module.exports = { STAGES, build };
