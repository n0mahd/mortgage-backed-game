# Production Readiness Roadmap

This roadmap tracks what needs to be true before people can reliably play Mortgage Backed Monopoly in live multiplayer sessions.

## Current Readiness Snapshot

### What is working

- Players can create rooms, join, start games, roll dice, move around the board, buy properties, create corporations, issue debt, buy shares, trade, make payments, and end games.
- The backend stores authoritative game state, versions actions, and rejects stale updates.
- Socket rooms broadcast game updates to the correct room.
- Multiple game rooms can exist in the database at the same time.
- Browser E2E coverage currently passes for auth, lobby, waiting room, game page, core mechanics, and trading smoke paths.

### Improved in the current production pass

- Added a turn checklist and clearer current-turn action flow.
- Disabled End Turn in the UI until the current player rolls.
- Added server enforcement for roll-before-End-Turn.
- Added trade consent: proposals stay pending until the other involved player accepts.
- Blocked self-trades, empty trades, out-of-party trades, and stale property ownership at accept time.
- Made payments actor-bound so one player cannot force another player to pay through the Market UI.
- Added pending trade offer UI with Accept, Decline, and Cancel actions.
- Added trade offer expiration: stale pending offers show their timeout, clear on the next game action, and cannot move assets after expiry.
- Added host pause/resume: paused games show a banner, block normal actions server-side, and log pause/resume events.
- Added bankruptcy enforcement: bankrupt players cannot act, are skipped, and pending offers involving them are canceled.
- Added final player bankruptcy liquidation: directly owned properties return to the bank, houses/hotels are cleared, debts are cleared, shares return to corporation availability, and chairmanship is reassigned or vacated.
- Added creditor-aware rent bankruptcy: unaffordable rent pays only available cash, tracks the unpaid claim, allows recovery before End Turn, and transfers direct assets to the player or corporation creditor if the claim remains unpaid.
- Added a post-bankruptcy liquidation summary modal so players can see the cause, asset destination, share movement, and debt cleanup immediately after declaring bankruptcy.
- Added a visible Bankrupt badge on player cards.
- Added corporation insolvency: corporate interest can close an underfunded corporation, return corporation-owned properties to the bank, clear improvements, wipe debts/shares, close governance, and show an Insolvent state in the UI.
- Reworked IPO ownership: founders now receive all shares at IPO creation, listed founder-share purchases pay the founder, bankruptcy-returned shares sit in treasury, and corporation stake value uses NAV instead of listing price.
- Removed the IPO price per share: it no longer controlled any sale. Treasury shares now sell at the corporation's current NAV per share.
- Fixed Jail edge cases: rolling doubles to leave Jail now consumes the turn roll, forced third-turn bail is logged as a bank payment, and bail-driven negative cash uses the normal bankruptcy warning path.
- Added targeted bank-return bankruptcy coverage for tax, card-payment, Jail bail, and debt-interest negative-cash paths.
- Added operational readiness basics: database hot-path indexes, a DB-backed health endpoint, and structured game-action audit logging with game/room/action/version metadata.
- Added configurable rate limits for auth requests, room creation, and authoritative game actions.
- Fixed edge cases for Chance nearest utility, Chance nearest railroad, and corporation-owned rent collection.
- Aligned README and game rules with the digital-first game flow.

## Prime-Time Blockers

### 1. Bankruptcy, liquidation, and creditor policy

Current coverage: player bankruptcy is final. The bankrupt player is marked out, skipped in future turns, blocked from normal actions, and any pending trade offer involving them is canceled. Directly owned properties return to the bank for bank-style bankruptcies, and transfer to the player or corporation creditor for unresolved rent claims. Houses/hotels are cleared, personal debts are cleared, shares return to corporation treasury for bank/corporation-creditor cases, shares transfer to the player creditor for player-creditor rent bankruptcy, and chairmanship is reassigned to an active non-bankrupt shareholder or founder when possible. Corporation-owned properties remain with the corporation unless the corporation itself becomes insolvent. Corporation insolvency is final: assets return to the bank, improvements are cleared, debts and shares are wiped, and governance is closed.

Decisions needed:

- Should bankruptcy liquidation ever trigger automatic auctions for released properties, or is bank return the permanent rule?
- Should corporation insolvency ever trigger automatic auctions for released properties, or is bank return the permanent rule?
- Should treasury-returned shares be sold immediately, queued for auction, or stay listed at the corporation's current asking price?

Acceptance criteria:

- Covered: bankrupt players cannot act and are skipped.
- Covered: direct player assets do not become inert forever.
- Covered: pending offers involving bankrupt players are canceled.
- Covered: shares and chairmanship are resolved deterministically for player bankruptcy.
- Covered: rent creditors receive only available cash before bankruptcy; unpaid rent claims can be settled before End Turn or liquidated to the creditor.
- Covered: bank/tax/card/interest bankruptcies use bank-return liquidation rather than creditor transfer.
- Covered: the UI explains liquidation details in a post-bankruptcy summary modal.
- Covered: corporation insolvency has a defined path.
- Tests cover bankruptcy to player, bankruptcy to bank, bankruptcy with pending offers, bankruptcy with shares, bankruptcy while chairman, and last-player-standing.

### 2. Property auctions and declined purchases

Current coverage: players can start an auction from the property purchase modal. Active players can bid or pass from the Game tab, normal actions are blocked while the auction is open, the host can cancel a stuck auction, and the winning bid is paid atomically when all other active players pass. Auctions also have an idle timeout that resolves on the next game action, and stale concurrent bid attempts are rejected by action versioning. `backend/tests/unit/property-auctions.test.js` and `tests/e2e/property-auctions.spec.js` cover the core flow, host cancellation, timeout settlement, and stale concurrent bids.

Acceptance criteria:

- Covered: if a player lands on an unowned property and does not buy it, the game can auction it.
- Covered: all active players can bid or pass.
- Covered: the auction has host cancellation for stalled sessions.
- Covered: the winning bid is paid and ownership updates atomically.
- Covered: idle timeout resolves no-bid auctions as no sale and high-bid auctions to the high bidder.
- Covered: stale concurrent bids are rejected and cannot overwrite the accepted bid.
- Tests cover pass, bid, outbid, no-sale, timeout, insufficient cash, stale concurrent bids, and browser-level two-player auction flow.

### 3. Payment and insolvency resolution

Rent, taxes, cards, interest, and jail bail can push cash below zero. That is legal for now because bankruptcy is checked at turn end, but production needs a clear resolution step.

Current coverage: the game screen warns the current player when cash is below zero or when rent remains unpaid, and relabels End Turn as "Declare Bankruptcy." `tests/e2e/game-mechanics.spec.js` covers this warning path, direct-property bank liquidation, rent-creditor liquidation, and forced Jail-bail negative cash.

Acceptance criteria:

- Covered: the player sees a clear negative-cash warning before ending the turn.
- Covered: unpaid rent can be recovered before End Turn if the player raises enough cash.
- Covered: if the player stays below zero, End Turn clearly means "declare bankruptcy."
- Covered: after bankruptcy, the player sees a liquidation summary before returning to the board.
- Covered: rent creditors are not overpaid in cash when the debtor cannot afford rent.
- Covered: forced third-turn Jail bail can push cash below zero and then use bank-return bankruptcy.
- Tests cover negative cash from rent, tax, card payments, jail bail, and debt interest.

### 4. Corporation lifecycle rules

Corporations are playable, and the first production insolvency policy is now defined.

Current coverage: corporate rent flows into treasury, corporate debt can be issued by the chairman or controlling shareholder, founders receive all IPO shares, listed founder-share purchases pay the founder, treasury-share purchases pay the corporation, share value uses corporation NAV, shares can be purchased only while the corporation is active, chairman changes and shareholder votes are blocked after insolvency, and a corporation that falls below $0 from corporate interest closes as insolvent.

Acceptance criteria:

- Covered: corporate rent, treasury cash, debt, share purchase, chairman changes, shareholder voting, and insolvency are documented.
- Covered: chairman authority is clear for debt issuance.
- Covered: corporation insolvency has a defined path.
- Remaining: chairman authority for voluntary property decisions and liquidation controls needs richer product design.
- Share transfers and potential secondary markets are either implemented or explicitly out of scope.
- Tests cover chairman edge cases, majority thresholds, deadlocked votes, corporation debt interest, insolvency resolution, and blocked post-insolvency actions.

### 5. Real-player E2E and release CI

The long real-player Playwright scenario has a dedicated dev-only runner (`npm run test:e2e:real-game`) that starts isolated web/API servers and uses a dev-only SQLite database. It should be promoted into the release checklist or CI gate once runtime and artifact handling are stable enough.

Acceptance criteria:

- The real-player scenario runs in CI or a release checklist against dev-only ports and data.
- It captures screenshots for lobby, waiting room, board, market, corporation, debt, bankruptcy, and endgame states.
- It runs against dev-only ports and dev-only data.
- Failures produce enough artifact detail to debug quickly.

## Multiplayer and Concurrency Roadmap

### Near term

- Keep all game actions authoritative through `/api/games/:id/actions`.
- Require `expectedVersion` for every mutating game action.
- Keep action IDs idempotent.
- Ensure every socket broadcast is scoped to a single room.
- Covered: `tests/e2e/concurrent-games.spec.js` creates two simultaneous rooms and proves actions in one room do not affect the other.

### Production load readiness

- Covered: database indexes exist for room membership lookup, player room listing, game by room, game events by game, actions by game, actions by actor, OTP lookup, and room status listing.
- Covered: successful game actions emit structured audit logs with game ID, room ID, actor ID, action type, action ID, old version, new version, event count, and ended state when audit logging is enabled.
- Covered: `/api/health` verifies Express and SQLite readiness and reports applied migrations.
- Covered: configurable rate limits protect auth, room creation, and game actions, with `429` responses and retry metadata.
- Add backup/restore steps for the production SQLite database.

### Soak tests

- Run concurrent games with simulated players for at least 60 minutes.
- Include simultaneous trade proposals, stale action versions, reconnects, and room-specific socket subscriptions.
- Verify no production data directories are used during testing.

## UX Roadmap

### Game flow

- Make the game screen the source of truth for "what can I do next?"
- Keep the turn checklist visible and accurate for jail, doubles, property purchase, negative cash, auctions, and endgame.
- Covered: leaving Jail on doubles does not show another Roll Dice action.
- Replace remaining `alert()` flows with inline status messages or modals.
- Add empty states for corporations, debts, trades, and game log.

### Market

- Keep trades consent-based.
- Add clear offer summaries: "You give" and "You receive."
- Covered: host cleanup can cancel abandoned pending offers.
- Covered: pending trade offers expire and clear without moving assets.
- Add payment requests if the game needs "ask another player to pay" instead of only voluntary direct payments.

### Host controls

- Covered: host can cancel abandoned auctions/offers and force-end games.
- Covered: host can pause and resume a live game, with normal actions blocked while paused and pause/resume events logged.
- Remaining: kick disconnected players, force-end reason capture, and richer host audit trail.
- Show host-only controls consistently and document what they do.

### Mobile readiness

- Test full game flow on the phone-facing dev URL.
- Verify board, player cards, Market, modals, and waiting room on narrow screens.
- Ensure important buttons have stable sizes and no text overflow.

## Testing Plan

### Unit tests

- Rent calculations for properties, railroads, utilities, monopolies, houses, hotels, and Chance multipliers.
- Card effects including pass GO, nearest utility/railroad, back three spaces, repairs, collect/pay each player, and jail.
- Trade proposal, accept, decline, cancel, stale ownership, stale cash, bankrupt participant, and duplicate assets.
- Bankruptcy, turn skipping, game ending, and offer cancellation.
- Corporation ownership, treasury, debt, votes, rent collection, and insolvency.

### API tests

- Every game action returns the expected status for unauthorized, out-of-turn, stale-version, duplicate-action, and invalid-payload cases.
- End Turn is rejected before rolling.
- Bankrupt players cannot perform actions.
- Concurrent games remain isolated.

### Browser E2E tests

- Full room creation and guest join.
- Host starts game and all players load game state.
- Player rolls, lands, buys or declines property, resolves card/tax/rent, and ends turn.
- Trade proposal is visible to the recipient and does not execute before consent.
- Bankruptcy appears visibly and the bankrupt player is skipped.
- Multiple rooms progress independently.

### Manual exploratory test script

1. Create a fresh dev room on the phone-facing URL.
2. Join with at least two players.
3. Start the game and verify each player sees the correct current turn state.
4. Roll and confirm board position, dice, landing summary, and turn checklist.
5. Try to end turn before rolling through the UI and confirm it is blocked.
6. Buy an unowned property and verify cash/ownership.
7. Propose a trade and verify it appears only as pending until accepted.
8. Accept and decline offers from the other player.
9. Force or simulate negative cash and verify bankruptcy state.
10. Confirm another room can play independently at the same time.

## Suggested Timeline

### Week 1: Hardening the playable core

- Continue polishing corporation lifecycle UX and documentation after the initial insolvency policy.
- Promote the real-player E2E runner into the release checklist or CI where practical.

### Weeks 2-3: Multiplayer reliability

- Add concurrent-room E2E.
- Add host stuck-game controls.
- Verify logging, health checks, and rate limits in dev.
- Prepare backup/restore instructions and rehearse them against dev-only data.
- Run 60-minute dev soak tests.

### Weeks 4-6: Financial game depth

- Finish corporation lifecycle rules beyond insolvency.
- Add shareholder edge cases and decide secondary-market scope.
- Decide whether payment requests and secondary share/property markets are in scope.
- Expand test coverage around debt, interest, corporate ownership, and endgame.

### Release candidate

- Run backend tests, full E2E, real-player E2E, and phone manual test.
- Verify dev data and production data remain separate.
- Confirm production config uses explicit `DB_PATH`, non-default `JWT_SECRET`, and explicit `CORS_ORIGINS`.
- Prepare backup/restore instructions.
- Ship only after the core gameplay loop can complete without manual database repair.
