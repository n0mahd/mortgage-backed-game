'use strict';

// Concise rules for agents, condensed from documents/game-rules.md. Keep in
// sync when player-facing rules change. The action list is generated from the
// domain action catalog so payload shapes cannot drift from what MCP accepts.

const { ACTIONS } = require('../domain/actionCatalog');
const { MONOPOLY_PROPERTIES } = require('../domain/gameRules');

const RULES_TEXT = `# Mortgage Backed Monopoly: rules for agents

Standard Monopoly plus Wall Street mechanics (IPOs, debt, trades). The server is authoritative: it rolls the dice, moves tokens, applies rent/taxes/cards, and rejects illegal actions with a clear error.

## Turn flow
1. On your turn call take_action roll_dice. You move automatically; rent, taxes and Chance/Community Chest effects are applied for you.
2. Landed on an unowned property? buy_property (pay list price) or start_auction (everyone bids/passes).
3. Optionally buy houses, create an IPO, buy shares, issue/pay/refinance debt, trade.
4. Rolled doubles? You must roll_dice again (3 doubles in a row = Jail). Otherwise end_turn.
end_turn is only allowed after rolling and while no auction is open.

## Money
- Start with $1,500. Passing GO pays $200. Income Tax $200, Luxury Tax $100. Free Parking does nothing.
- Rent: base rent; doubled when you own the full color group with no houses; houses/hotel use the rent table (rent[1..5]). Railroads $25/$50/$100/$200 for 1-4 owned. Utilities: dice x4 (one owned) or x10 (both).
- Houses need the complete color group. Cost per house: Brown/Light Blue $50, Pink/Orange $100, Red/Yellow $150, Green/Dark Blue $200. Max 5 per property (5th = hotel).

## Jail
Sent there by square 30, a Go to Jail card, or three doubles. Before rolling you may pay_jail_fine ($50) or use_get_out_of_jail_card, then roll normally. Or roll_dice for doubles: doubles release you and move you; no doubles on turns 1-2 keeps you in Jail; on turn 3 you pay $50 bail and move.

## Auctions
Bids must beat the current bid and be affordable. The high bidder cannot pass. When every other active player has passed, the high bidder pays and gets the property; if all pass with no bid it stays unowned. Auctions time out after 2 idle minutes (the next action resolves them). Nothing else can happen until the auction resolves.

## IPOs and shares
create_ipo moves your chosen properties into a corporation (a color group with any houses/hotels must go in whole); you hold all its shares (max 12). Nobody can buy a player's shares without that player agreeing: shares change hands by propose_trade/accept_trade. buy_shares only buys treasury shares a corporation has for sale (after a bankruptcy returns shares to it). Whoever gains a majority of a corporation's shares becomes its chairman automatically. Share value in net worth = max(0, corp property value + corp cash - corp debt) / total shares. A corporation whose cash goes negative from interest becomes insolvent and is wiped.

## Debt
issue_debt borrows at the room rate (default 5% per turn) against collateral: pledge properties you own (collateralIds) and borrow at most 90% of their value (price plus buildings); a property backs one loan at a time, and loans without collateral are refused. Interest compounds each time you end your turn and is taken from your cash. pay_debt repays; refinance_debt rolls debts into one larger loan.

## Trades and payments
propose_trade any time (you must be player1 or player2); a trade can include cash, properties and corporation shares (player1Shares/player2Shares), and a one-sided offer gives them away; player1PropertiesToCorpId/player2PropertiesToCorpId put that side's properties into an LLC the other player runs (chairman or majority holder), which is how you trade a property for a stake in their LLC; streets in a color group with buildings can't be traded at all (IPO the whole group and trade its shares instead); the other side must accept_trade, or cancel_trade declines. Offers expire after 10 minutes. manual_payment sends cash directly.

## Bankruptcy and winning
If your cash is below $0 (or rent is still unpaid) when you end your turn, you go bankrupt and are out. If you cannot afford rent you pay what you have and owe the rest until end of turn, so raise cash first (debt, trades, IPO). Last solvent player wins; the host may end the game early, ranking by net worth = cash + property value + share value - debt.
`;

function renderActions() {
    return ACTIONS.filter(action => action.category !== 'host').map(action => `- ${action.type} [${action.category}] payload ${JSON.stringify(action.payload)}: ${action.description}`).join('\n');
}

function renderBoard() {
    return MONOPOLY_PROPERTIES.map((prop, i) => `- prop-${i} ${prop.name} (${prop.color}) $${prop.price}, rent ${Array.isArray(prop.rent) ? prop.rent.join('/') : prop.rent}`).join('\n');
}

function getRulesText() {
    return `${RULES_TEXT}
## Actions accepted by take_action
Pass the type and a payload object. Ids (property, player, corporation, debt, offer, vote) come from get_game_state. get_game_state.legal_actions lists what is valid for you right now, with example payloads.
${renderActions()}

## Properties
Id, name, group, price, and rent: streets by houses (0, 1-4, hotel), railroads by how many you own, utilities as the dice multiplier. Game state lists only owned properties; the rest are unowned.
${renderBoard()}
`;
}

module.exports = { getRulesText };
