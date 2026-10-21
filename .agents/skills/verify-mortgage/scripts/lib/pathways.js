'use strict';

// The map of everything that can happen in a game, and how much of it a run
// actually reached. Pathways are detected from the authoritative game_events
// rows (plus a few harness-observed UI paths), and card and board data come
// from the public rules module, so the map follows the engine as it changes.
// Each pathway says how to reach it: `hint` for agents and the bot, `stage` for
// a staged setup that makes it reachable within a short game.

const path = require('path');
const runs = require('./runs');

const rules = require(path.join(runs.APP_ROOT, 'backend', 'domain', 'gameRules.js'));

const propByName = new Map(rules.MONOPOLY_PROPERTIES.map((p, i) => [p.name, { ...p, id: `prop-${i}` }]));
const kindOf = p => (p.color === 'Railroad' ? 'railroad' : p.color === 'Utility' ? 'utility' : 'street');

// ev(type, predicate) matches game_events rows; ui(id) matches harness marks.
const ev = (type, test = () => true) => ({ type, test });
// act(type, predicate) matches what a player submitted (game_actions rows), applied or not.
const act = (type, test = () => true) => ({ type, test, source: 'actions' });

const PATHWAYS = [
    // ----- turn and board -----
    { id: 'roll.plain', group: 'Turn', label: 'Roll without doubles', match: ev('dice_roll', d => !d.isDoubles && !d.inJail) },
    { id: 'roll.doubles-again', group: 'Turn', label: 'Roll doubles and roll again', match: ev('dice_roll', d => d.isDoubles && !d.inJail && !d.sentToJail && !d.jailReleased), hint: 'Roll doubles, then press Roll Dice again.' },
    { id: 'roll.three-doubles', group: 'Turn', label: 'Third doubles in a row sends you to Jail', match: ev('dice_roll', d => d.sentToJail), stage: 'three-doubles' },
    { id: 'board.pass-go', group: 'Turn', label: 'Pass or land on GO and collect', match: ev('pass_go') },
    { id: 'board.go-to-jail', group: 'Turn', label: 'Land on Go to Jail', match: ev('dice_roll', d => d.square === 'Go to Jail'), stage: 'land-go-to-jail' },
    { id: 'board.free-parking', group: 'Turn', label: 'Land on Free Parking', match: ev('dice_roll', d => d.square === 'Free Parking') },
    { id: 'board.just-visiting', group: 'Turn', label: 'Land on Jail / Just Visiting', match: ev('dice_roll', d => /Just Visiting/.test(d.square || '')), stage: 'land-just-visiting' },
    { id: 'tax.income', group: 'Turn', label: 'Pay Income Tax', match: ev('tax_payment', d => /Income/.test(d.reason)) },
    { id: 'tax.luxury', group: 'Turn', label: 'Pay Luxury Tax', match: ev('tax_payment', d => /Luxury/.test(d.reason)) },
    { id: 'turn.end', group: 'Turn', label: 'End a turn', match: ev('turn_end') },

    // ----- jail -----
    { id: 'jail.pay-fine', group: 'Jail', label: 'Pay the $50 fine to leave Jail', match: ev('jail_fine_paid'), hint: 'In Jail, before rolling: Pay $50 Fine.', stage: 'in-jail' },
    { id: 'jail.use-card', group: 'Jail', label: 'Use a Get Out of Jail Free card', match: ev('jail_card_used'), hint: 'In Jail with a card: Use Jail Card.', stage: 'in-jail-with-card' },
    { id: 'jail.doubles-out', group: 'Jail', label: 'Roll doubles to leave Jail', match: ev('dice_roll', d => d.jailReleased), stage: 'in-jail' },
    { id: 'jail.stay', group: 'Jail', label: 'Fail to roll doubles in Jail', match: ev('dice_roll', d => d.inJail), hint: 'In Jail: Roll for Doubles.', stage: 'in-jail' },
    { id: 'jail.forced-bail', group: 'Jail', label: 'Forced $50 bail after the third Jail turn', match: ev('forced_payment', d => d.reason === 'Jail bail'), stage: 'jail-third-turn' },

    // ----- property and auctions -----
    { id: 'buy.street', group: 'Property', label: 'Buy a street', match: ev('property_purchase', d => kindOf(propByName.get(d.property) || {}) === 'street') },
    { id: 'buy.railroad', group: 'Property', label: 'Buy a railroad', match: ev('property_purchase', d => kindOf(propByName.get(d.property) || {}) === 'railroad') },
    { id: 'buy.utility', group: 'Property', label: 'Buy a utility', match: ev('property_purchase', d => kindOf(propByName.get(d.property) || {}) === 'utility') },
    { id: 'auction.start', group: 'Property', label: 'Decline to buy and start an auction', match: ev('property_auction_started'), hint: 'Buy Property → Start Auction.' },
    { id: 'auction.bid', group: 'Property', label: 'Bid in an auction', match: ev('property_auction_bid') },
    { id: 'auction.pass', group: 'Property', label: 'Pass in an auction', match: ev('property_auction_passed') },
    { id: 'auction.won', group: 'Property', label: 'Win an auction', match: ev('property_auction_won') },
    { id: 'auction.no-sale', group: 'Property', label: 'Everyone passes: no sale', match: ev('property_auction_no_sale'), hint: 'Start an auction and have every player pass without bidding.' },
    { id: 'auction.host-cancel', group: 'Property', label: 'Host cancels an auction', match: ev('property_auction_canceled'), hint: 'Host: Cancel Auction while one is open.' },
    { id: 'auction.timeout', group: 'Property', label: 'Auction resolved by idle timeout', match: ev('property_auction_won', d => d.reason === 'timeout' || d.resolution === 'timeout'), stage: 'auction-timeout' },

    // ----- rent -----
    { id: 'rent.street', group: 'Rent', label: 'Pay rent on a plain street', match: ev('forced_payment', d => rentKind(d) === 'street') },
    { id: 'rent.monopoly', group: 'Rent', label: 'Pay double rent on a full colour group', match: ev('forced_payment', d => rentKind(d) === 'monopoly'), stage: 'monopoly' },
    { id: 'rent.houses', group: 'Rent', label: 'Pay rent on a street with houses', match: ev('forced_payment', d => rentKind(d) === 'houses'), stage: 'houses-built' },
    { id: 'rent.hotel', group: 'Rent', label: 'Pay rent on a hotel', match: ev('forced_payment', d => rentKind(d) === 'hotel'), stage: 'hotel-built' },
    { id: 'rent.railroad', group: 'Rent', label: 'Pay railroad rent', match: ev('forced_payment', d => rentKind(d) === 'railroad') },
    { id: 'rent.utility', group: 'Rent', label: 'Pay utility rent', match: ev('forced_payment', d => rentKind(d) === 'utility') },
    { id: 'rent.unpaid', group: 'Rent', label: 'Owe more rent than you have (bankruptcy claim)', match: ev('forced_payment', d => Number(d.unpaidAmount) > 0), stage: 'near-bankrupt' },

    // ----- houses -----
    { id: 'houses.buy', group: 'Houses', label: 'Buy houses on a full colour group', match: ev('house_purchase'), stage: 'monopoly' },
    { id: 'houses.hotel', group: 'Houses', label: 'Build a hotel (5th improvement)', state: s => s.properties.some(p => Number(p.houses) === 5), stage: 'houses-built' },
    { id: 'houses.repairs-card', group: 'Houses', label: 'Pay a repairs card with buildings', match: ev('card_draw', d => /repairs/i.test(d.card) && !/\$0(\.00)?\b/.test(String(d.effect))), stage: 'houses-built' },

    // ----- debt -----
    { id: 'debt.issue', group: 'Debt', label: 'Issue personal debt', match: ev('debt_issued', d => !String(d.issuer).startsWith('[')), hint: 'Manage Debt → Issue New Debt.' },
    { id: 'debt.issue-corporate', group: 'Debt', label: 'Issue debt as a corporation', match: ev('debt_issued', d => String(d.issuer).startsWith('[')), hint: 'Manage Debt → Issuer: <your corporation>. Needs a corporation you chair.' },
    { id: 'debt.pay', group: 'Debt', label: 'Repay debt', match: ev('debt_payment'), hint: 'Manage Debt → Settle Existing Debt.' },
    { id: 'debt.refinance', group: 'Debt', label: 'Refinance debt', match: ev('debt_refinanced'), hint: 'Manage Debt → Refinance Existing Debt: pick debts, new amount above the payoff.' },
    { id: 'debt.interest', group: 'Debt', label: 'Interest charged at end of turn', match: ev('interest_accrual', d => Number(d.interestCharged) > 0) },
    { id: 'debt.corporate-interest', group: 'Debt', label: 'Corporation charged interest', match: ev('interest_accrual', d => String(d.player).startsWith('[') && Number(d.interestCharged) > 0) },

    // ----- corporations -----
    { id: 'corp.ipo', group: 'Corporations', label: 'Create an IPO', match: ev('ipo_created'), hint: 'Create IPO: ticker, shares, price, at least one property.' },
    { id: 'corp.buy-shares', group: 'Corporations', label: 'Buy treasury shares', match: ev('share_purchase'), hint: 'Corporations → Buy treasury shares (only after a bankruptcy returned shares to a corporation).' },
    { id: 'corp.share-offer', group: 'Corporations', label: 'Offer to buy or sell shares in a trade', match: act('propose_trade', d => (d.player1Shares || []).length || (d.player2Shares || []).length), hint: 'Market: enter a number of shares on either side of a trade.' },
    { id: 'corp.majority-gained', group: 'Corporations', label: 'Gain a majority and become chairman automatically', match: ev('chairman_changed', d => d.method === 'majority-gained'), hint: 'Buy more than half of a corporation\'s shares by trade offers.' },
    { id: 'corp.chairman-majority', group: 'Corporations', label: 'Majority holder changes the chairman', match: ev('chairman_changed', d => d.method === 'majority'), hint: 'Corporations: as majority shareholder, change chairman.' },
    { id: 'corp.vote-propose', group: 'Corporations', label: 'Propose a chairman vote', match: ev('chairman_vote_proposed'), hint: 'Corporations: as a shareholder, Propose a chairman.' },
    { id: 'corp.vote-support', group: 'Corporations', label: 'Support a chairman vote', match: ev('chairman_vote_supported'), hint: 'Corporations: Support an open vote.' },
    { id: 'corp.vote-passes', group: 'Corporations', label: 'Chairman elected by vote', match: ev('chairman_changed', d => d.method === 'vote'), stage: 'shared-corporation' },
    { id: 'corp.chairman-after-bankruptcy', group: 'Corporations', label: 'Chairman replaced or vacated after bankruptcy', match: [ev('chairman_changed', d => d.method === 'bankruptcy'), ev('chairman_vacated')], stage: 'near-bankrupt' },
    { id: 'corp.insolvent', group: 'Corporations', label: 'A corporation becomes insolvent', match: ev('corporation_insolvent'), stage: 'insolvent-corporation' },

    // ----- market -----
    { id: 'trade.propose', group: 'Market', label: 'Propose a trade', match: ev('trade_offer_proposed') },
    { id: 'trade.accept', group: 'Market', label: 'Accept a trade', match: ev('trade_offer_accepted') },
    { id: 'trade.decline', group: 'Market', label: 'Decline a trade', match: ev('trade_offer_canceled', d => d.status === 'declined') },
    { id: 'trade.withdraw', group: 'Market', label: 'Withdraw your own offer', match: ev('trade_offer_canceled', d => d.status === 'canceled' && !d.reason), hint: 'Market → Pending Trade Offers → Cancel on your own offer.' },
    { id: 'trade.host-cancel', group: 'Market', label: 'Host cancels someone else\'s offer', match: ev('trade_offer_canceled', d => d.reason === 'host'), hint: 'Host: Host Cancel on an offer between two other players.' },
    { id: 'trade.expire', group: 'Market', label: 'Offer expires (10 min)', match: ev('trade_offer_expired'), stage: 'trade-expiry' },
    { id: 'trade.property-swap', group: 'Market', label: 'Trade property for property', match: ev('trade_offer_accepted', d => d.player1Assets > 0 && d.player2Assets > 0), hint: 'Market: tick a property on both sides.' },
    { id: 'trade.jail-card', group: 'Market', label: 'Offer a Get Out of Jail Free card in a trade', match: act('propose_trade', d => JSON.stringify(d).includes(rules.JAIL_CARD_ASSET_ID)), stage: 'in-jail-with-card' },
    { id: 'payment.manual', group: 'Market', label: 'Pay another player directly', match: ev('payment'), hint: 'Market → Payment System.' },

    // ----- bankruptcy and the end -----
    { id: 'bankrupt.claim-payment', group: 'Bankruptcy', label: 'Pay down a bankruptcy claim', match: ev('bankruptcy_claim_payment'), stage: 'near-bankrupt' },
    { id: 'bankrupt.claim-settled', group: 'Bankruptcy', label: 'Settle a bankruptcy claim and survive', match: ev('bankruptcy_claim_settled'), stage: 'near-bankrupt' },
    { id: 'bankrupt.to-player', group: 'Bankruptcy', label: 'Go bankrupt to another player', match: ev('bankruptcy_liquidation', d => d.assetDestinationType === 'player'), stage: 'near-bankrupt' },
    { id: 'bankrupt.to-bank', group: 'Bankruptcy', label: 'Go bankrupt to the bank', match: ev('bankruptcy_liquidation', d => d.assetDestinationType !== 'player'), stage: 'broke-to-bank' },
    { id: 'end.last-player', group: 'Bankruptcy', label: 'Game ends with one player left', match: ev('game_ended', d => !/host/i.test(d.reason || '')), stage: 'last-two' },
    { id: 'end.host', group: 'Host', label: 'Host ends the game', match: ev('game_ended', d => /host/i.test(d.reason || '')) },
    { id: 'host.pause', group: 'Host', label: 'Host pauses and resumes', match: [ev('game_paused'), ev('game_resumed')], all: true },

    // ----- refusals: the game must say no (counted when tried, applied or not) -----
    { id: 'refuse.bid-over-cash', group: 'Refusals', label: 'Try to bid more than your cash', match: act('place_bid', (d, s) => s.refused && /insufficient/i.test(s.error || '')), hint: 'In an auction, bid more cash than you have.' },
    { id: 'refuse.trade-built-group', group: 'Refusals', label: 'Try to trade a street from a colour group with buildings', match: act('propose_trade', (d, s) => s.refused && /buildings/i.test(s.error || '')), hint: 'Build houses, then offer one of that group\'s streets in the Market (the box should be greyed out; the rule: IPO the whole group instead).', stage: 'houses-built' },
    { id: 'refuse.loan-over-limit', group: 'Refusals', label: 'Try to borrow more than 90% of the collateral', match: act('issue_debt', (d, s) => s.refused && /up to|needs collateral|already backs/i.test(s.error || '')), hint: 'Manage Debt: pledge a property and ask for more than the limit shown.' },
    { id: 'refuse.force-buy-shares', group: 'Refusals', label: 'Try to buy a player\'s shares without an offer', match: act('buy_shares', (d, s) => s.refused), hint: 'Corporations: try to buy shares that a player holds.' },
    { id: 'refuse.pay-over-cash', group: 'Refusals', label: 'Try to pay a player more than your cash', match: act('manual_payment', (d, s) => s.refused && /insufficient/i.test(s.error || '')), hint: 'Market → Payment System: an amount above your cash.' },
    { id: 'refuse.junk-amount', group: 'Refusals', label: 'Submit a zero, negative or non-numeric amount', match: [act('issue_debt', (d, s) => s.refused && !(Number(d.amount) > 0)), act('manual_payment', (d, s) => s.refused && !(Number(d.amount) > 0)), act('place_bid', (d, s) => s.refused && !(Number(d.amount) > 0)), act('create_ipo', (d, s) => s.refused)], hint: 'Enter 0, -5 or text as an amount and submit.' },
    { id: 'refuse.trade-not-owned', group: 'Refusals', label: 'Propose a trade the rules refuse', match: act('propose_trade', (d, s) => s.refused), hint: 'Offer more cash than you have, or a trade with nothing in it.' },

    // ----- people and devices (seen by the harness, not the engine) -----
    { id: 'ui.email-sign-in', group: 'People', label: 'Sign in with an emailed code', ui: true },
    { id: 'ui.guest-join', group: 'People', label: 'Join from an invite link as a guest', ui: true },
    { id: 'ui.reload-resync', group: 'People', label: 'Reload mid-game and catch up', ui: true },
    { id: 'ui.offline-resync', group: 'People', label: 'Lose the network for a turn and catch up', ui: true },
    { id: 'ui.device-transfer', group: 'People', label: 'Move to another device with a transfer code', ui: true, hint: 'Play on another device → open the code on a new browser.' },
    { id: 'ui.rejoin-guest', group: 'People', label: 'Rejoin as an existing guest player by room code', ui: true },
];

// Card pathways: one per card in each deck, named from the engine's own decks.
for (const [deck, cards] of [['chance', rules.CHANCE_CARDS], ['community_chest', rules.COMMUNITY_CHEST_CARDS]]) {
    for (const card of cards) {
        PATHWAYS.push({
            id: `card.${card.id}`,
            group: deck === 'chance' ? 'Chance cards' : 'Community Chest cards',
            label: card.text,
            match: ev('card_draw', d => d.deckType === deck && d.card === card.text),
            stage: `card:${card.id}`,
        });
    }
}

function rentKind(d) {
    if (!/^Rent for /.test(d.reason || '')) return null;
    const prop = propByName.get(d.propertyName) || rules.MONOPOLY_PROPERTIES.find(p => d.reason.endsWith(p.name));
    if (!prop) return 'street';
    const kind = kindOf(prop);
    if (kind !== 'street') return kind;
    const owed = Number(d.amountOwed ?? d.amount);
    const rent = prop.rent || [];
    if (owed === rent[5]) return 'hotel';
    if (rent.slice(1, 5).includes(owed)) return 'houses';
    if (owed === rent[0] * 2) return 'monopoly';
    return 'street';
}

function matchesAny(match, events, actions) {
    const list = Array.isArray(match) ? match : [match];
    return list.map(m => m.source === 'actions'
        ? actions.filter(a => a.action_type === m.type && safe(() => m.test(a.payload, a))).length
        : events.filter(e => e.event_type === m.type && safe(() => m.test(e.data))).length);
}

function safe(fn) { try { return fn(); } catch { return false; } }

// events: [{ event_type, data }], state: final game_state, uiMarks: Set of ui ids.
function coverage(events, state, uiMarks = new Set(), actions = []) {
    return PATHWAYS.map(p => {
        let hits = 0;
        if (p.ui) hits = uiMarks.has(p.id) ? 1 : 0;
        else if (p.state) hits = state && safe(() => p.state(state)) ? 1 : 0;
        else {
            const counts = matchesAny(p.match, events, actions);
            hits = p.all ? Math.min(...counts) : counts.reduce((a, b) => a + b, 0);
        }
        return { id: p.id, group: p.group, label: p.label, hits, hint: p.hint || null, stage: p.stage || null };
    });
}

function readEvents(sql, gameId) {
    return sql('SELECT event_type, event_data FROM game_events WHERE game_id = ? ORDER BY created_at', [gameId])
        .map(r => ({ event_type: r.event_type, data: safe(() => JSON.parse(r.event_data)) || {} }));
}

// What players submitted. The server only stores applied actions, so the harness
// adds refused ones it saw in the browser (see daemon recordApi4xx).
function readActions(sql, gameId, refused = []) {
    const applied = sql('SELECT action_type, request_json FROM game_actions WHERE game_id = ?', [gameId])
        .map(r => {
            const req = safe(() => JSON.parse(r.request_json)) || {};
            return { action_type: r.action_type, payload: req.payload || req, refused: false };
        });
    return applied.concat(refused);
}

function summarize(cov) {
    const groups = new Map();
    for (const c of cov) {
        const g = groups.get(c.group) || { hit: 0, total: 0, missing: [] };
        g.total++;
        if (c.hits) g.hit++; else g.missing.push(c);
        groups.set(c.group, g);
    }
    return groups;
}

module.exports = { PATHWAYS, coverage, readEvents, readActions, summarize, rules };
