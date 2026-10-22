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
create_ipo moves your chosen properties into a corporation (a color group with any houses/hotels must go in whole); you hold all its shares (12,000 by default, so it splits evenly in halves, thirds, quarters and sixths). Nobody can buy a player's shares without that player agreeing: shares change hands by propose_trade/accept_trade. buy_shares only buys treasury shares a corporation has for sale (after a bankruptcy returns shares to it), at the current share value. Whoever gains a majority of a corporation's shares becomes its chairman automatically. Share value in net worth = max(0, corp property value + corp cash - corp debt) / total shares. add_to_corporation puts more of your properties into a corporation you run (chairman or majority holder), on your turn; with issueShares: true you get whole new shares at the current value per share (rounded down), so other holders keep their value, otherwise the property is a gift that raises every share's value. A corporation whose cash goes negative (a loan it can't repay when it comes due) becomes insolvent and is wiped.

## Running a corporation
The chairman or a majority holder runs a corporation. set_rent_policy picks what happens to its rent, on your turn before you roll, and then locks it for your next 5 turns; during the lock it changes only if every shareholder agrees (propose_rent_policy_change, then each holder vote_rent_policy_change with approve true; one rejection closes the vote; it switches the moment all agree and starts a fresh lock). In 'reinvest' (the default) everyone, shareholders included, pays full rent into its treasury; in 'payout' the rent goes straight to the shareholders by shares held, and a shareholder who lands there pays only the share of the rent they don't own (own 30%, pay 70%), the treasury keeping the slice for its own treasury shares. pay_dividend splits treasury cash across the shareholders. buy_property and buy_houses take corpId to buy the square you landed on, or build on a group the corporation owns whole, from its treasury. propose_trade with player1CorpId/player2CorpId trades for a corporation you run: its cash, properties and its own treasury shares, and it can buy its own shares back into the treasury; a runner can't trade personally with their own corporation (money reaches holders only by dividend). Anyone who doesn't run a corporation can offer_property_to_corporation at book value (omit price) or a price they name, paid in new shares at the current value per share or in treasury cash; its chairman answers with respond_property_offer (accept, decline or counter), a counter goes back to the offerer, and either side can decline. Offers expire after 10 minutes.

## Debt
issue_debt borrows against your whole portfolio: all your loans together may reach 90% of the book value of what you own (properties at price plus buildings, shares at their book value per share). Nothing is pledged; you.borrowing shows book_value, owed and available. Pick a term (termTurns 5, 10 or 15); the host set an interest rate per term when the game started (loan_rates_percent in the state, keyed by term). Each time you end your turn a loan charges a turn of interest; with autopay on (the default) it takes next_payment from your cash, the installment that pays it off on schedule (never more than your cash, except at maturity). With autopay off (set_debt_autopay) nothing is taken and the unpaid interest is added to the balance. When turns_remaining is 1 the whole balance is due at your End Turn; if your cash can't cover it you go bankrupt. pay_debt repays any amount or the whole balance; refinance_debt rolls debts into one larger loan on a new term. A corporation's loans count down on its chairman's turns and are paid from its cash.

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
