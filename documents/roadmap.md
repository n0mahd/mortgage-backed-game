# Roadmap: open decisions and remaining work

What is still open for Mortgage Backed. Shipped behaviour is described in `documents/game-rules.md`
(players) and `AGENTS.md` (code); this page lists only what is not decided or not built. Remove an item
when it ships.

## Open product decisions

- **Released properties.** Bankruptcy and corporation insolvency return properties to the bank today.
  Should they go to auction instead?
- **Treasury shares.** Shares returned to a corporation by bankruptcy stay in its treasury and sell at
  the corporation's net asset value per share. Should they be sold off or auctioned instead?
- **Chairman powers.** The chairman (or a majority holder) runs the corporation: debt, rent policy,
  dividends, property offers, buying and building, and trading as the company. Winding a corporation
  up by choice (liquidation controls) is not designed yet.
- **Payment requests.** Payments are voluntary only. Is "ask another player to pay" needed?

## Remaining work

- **Release gate for the real-player E2E.** `npm run test:e2e:real-game` runs the long two-browser
  scenario on dev-only ports. Make it part of the release checklist or CI, with screenshots of each
  major state (lobby, waiting room, board, market, corporation, debt, bankruptcy, endgame).
- **Soak test.** Run concurrent games with simulated players for an hour, including simultaneous
  trade proposals, stale action versions and reconnects, against dev-only data.
- **No more `alert()`.** Some game-screen errors still use browser alerts; move them to inline status
  messages or toasts from `src/js/ui.js`.
- **Empty states** for corporations, debts, trades and the game log.
- **Host tools.** Kick a disconnected player; record a reason when the host ends a game.
