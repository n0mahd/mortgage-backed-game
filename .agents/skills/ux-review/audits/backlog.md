# UX backlog

Open structural items and the state of earlier runs. Update at the end of every run: mark what shipped
(branch or commit), add what's new, and drop items the owner declined (say so).

## 2026-11-23 run

Reports: `2026-11-23/game.md`, `2026-11-23/market.md`, `2026-11-23/outside.md`.

**Done** (bugs and text cuts, combined on `release/ux-cleanup`): `fix/ux-game-tab`,
`fix/ux-market-sheets`, `fix/ux-outside-board`, plus the "Say less" rule, the turn alerts offer and
this skill from `feature/turn-alerts-prompt`. Highlights: hotseat no longer replaces the browser's
sign-in (guests lost games), game-over standings come back after a reload, merger percentages match
the Corporations sheet, home page loan claims match the engine, "Past transactions" renamed "Past
trades" (it only ever listed trades).

**Open: small, needs the owner**
- Standings now open on every load of an ended game; maybe once per player.
- The backend's default pause reason shows as "Alice paused the game: Host paused the game".
- `turnCashFlow` / `receivedBetweenTurns` are written but no screen reads them; remove or keep for agents.
- The backend stores corporation borrowers as "[MBS]"; the browser strips the brackets.
- `tests/e2e/real-player-flow.spec.js` opens a tab named "Game" that main renamed; it fails before
  reaching the changed screens.
- "Continue online as one player" from a saved hotseat game now lasts for that tab only.
- Leaving a room and making someone host still use `window.confirm`.

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
