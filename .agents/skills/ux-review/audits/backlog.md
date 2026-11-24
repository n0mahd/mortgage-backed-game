# UX backlog

Open structural items and the state of earlier runs. Update at the end of every run: mark what shipped
(branch or commit), add what's new, and drop items the owner declined (say so).

## 2026-11-23 run

Reports: `2026-11-23/game.md`, `2026-11-23/market.md`, `2026-11-23/outside.md`.

**In progress** (bugs and text cuts, one branch per area, based on `feature/turn-alerts-prompt`):
`fix/ux-game-tab`, `fix/ux-market-sheets`, `fix/ux-outside-board`. Also on
`feature/turn-alerts-prompt`: the "Say less" rule in `design-system.md` and `AGENTS.md`, and this skill.

**Open: structural, needs the owner's choice** (mock up first):
- Game tab redesign: one-line ticket off your turn, no Roll/Resolve/Actions/End rail, landing card as
  one money result line, dock labels with the action and price ("Buy $200"), no disabled move tiles,
  slimmer own player card. Mockups requested 2026-11-24.
- Shares shown as % and $ instead of counts out of 12,000 (engine unchanged).
- Market from 5 tabs to 3: Trade (with Send money), Offers (trades, property offers, mergers, rule
  votes), History.
- Debt: one row per loan that opens to Pay / Pay off / Refinance; one primary button per view.
- One way to put property or cash into a company (today four screens).
- Rent-policy vote shown like the rule vote (avatars with ticks).
- Recent events filters from 7 to 4.
- Home page for signed-in players: My games and New game instead of the marketing buttons.
- Guests create games without registering (the server already allows it).
- My games cards: whole card opens the game, status like "Your turn", Archive/Manage in a menu.
- Separate join and rejoin screens.
- Replace `window.alert/confirm/prompt` with the app's sheets and inline errors.
