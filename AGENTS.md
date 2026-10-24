# Mortgage Backed: agent guide

A multiplayer Monopoly parody with Wall Street mechanics (IPOs, loans, share trading, corporations
run by their chairman), played in the browser and by AI agents over MCP. A no-build static frontend
(classic `<script>` tags) talks to an Express + Socket.IO + SQLite backend. The server owns every
rule; browsers only render state and send actions.

Other docs: player rules in `documents/game-rules.md` and `README.md`, open decisions in
`documents/roadmap.md`, UI rules in `documents/design-system.md`, personal data and third parties in
`documents/privacy.md`, setup and backups in `SETUP.md`.

## Code map

### Backend (`backend/`)

- `server.js`: Express app, route mounting, the error handler, Socket.IO auth and `join_room`.
- `config.js`: every environment variable, its default, and the production guards.
  `db.js`: the SQLite database and `db.withTransaction`. `migrations.js`: schema.
- `auth.js`: player tokens (`readToken`, `makeToken`, `requireAuth`, `optionalUserId`). With `JWT_SECRET_PREVIOUS` set,
  old-secret tokens still work and get a replacement (`X-Refreshed-Token` header,
  `auth:token_refreshed` socket event, `POST /api/auth/refresh-tokens`).
- `helpers.js`: email/code normalizing, `plainText`, `sha256Hex`, `toSqliteDate`.
  `rateLimit.js`: in-memory limiters.
- `domain/`: the game rules. Pure functions over a state object, no I/O.
  - `gameRules.js`: the public API; everything else imports from here.
  - `gameRulesInternal/`: one module per topic, layered so each imports only earlier ones:
    `board`, `util` → `ledger` (cash flow, rent, net worth, built groups) → `corporateFinance`,
    `loans` (pure maths) → `corporations` (IPOs, shares, treasury, chairman) → `bankruptcy`,
    `auctions`, `trades`, `debt` (loans, capacity, autopay, per-turn servicing) → `movement` (dice,
    jail, landing, cards, buying, corporation rent) → `corporationManagement` (adding property, rent
    policy and its votes, dividends, property offers) → `turns` (end turn, end game, pause) → `state`
    (initial state, normalizing, invariants) → `applyAction`.
  - `gameRulesInternal/corporateFinance.js`: corporation share maths (Payout rent split and
    shareholder discount, dividend split, shares a price buys). `gameRulesInternal/loans.js`: loan
    terms, host rates and the payment schedule. Both pure; the modules above move the cash.
  - `gameRulesInternal/applyAction.js`: the `ACTIONS` table lists every action type, who may take it
    (`turn`, `host`) and its handler. The only entry point that changes game state.
  - `actionCatalog.js`: player-facing action list, descriptions and payload shapes; "legal right now"
    is decided by dry-running `applyAction`.
- `services/`: everything that touches the database or the outside world.
  - `services/gameActions.js`: the only writer of the `games` table: `startGameForRoom`,
    `applyGameAction` (transaction, `state_version` check, idempotent `actionId`, events, audit,
    broadcast, turn alerts), and the dev-only `repairGameState`.
  - `services/rooms.js`: room and member lookups, anonymous users, create and join. `canViewRoom`
    decides who may see a room and its game (members, or a host watching an agents-only game without
    a seat): use it for read access, never a bare `room_members` lookup. Player names are unique per
    room (`uniquePlayerName`) and are copied into the game state at the start.
  - `services/roomEvents.js`: `emitToRoom` (Socket.IO to a room's browsers) and `notifyRoom` (wakes
    MCP waits).
  - `services/agentSeats.js`: host-issued AI agent invites (one hashed key per seat, reservation,
    host-chosen names and renaming before the start, revocation, reissuing a new key for a taken
    seat, the invite text).
  - `services/rejoinRequests.js`: taking back a guest seat after losing the token, with another
    player's approval. Email players sign in with email instead.
  - `services/accounts.js`: username/password accounts (scrypt hashes, register with in-place guest
    upgrade, login by username or email, password changes) and `publicUser`, the user shape every
    auth endpoint answers with. Decisions: `documents/accounts-and-game-management.md`.
  - `services/roomManagement.js`: My games (`listMyRooms` with per-user archiving), leaving a room
    (waiting rooms only) and the host's Manage players view. `services/seatLinks.js`: host-made
    links back to one player's seat (hashed, 7 days, single use for guest seats).
    `services/hostTransfers.js`: offering host rights; only `rooms.host_id` changes.
  - `services/roomEmails.js`, `services/mailer.js`: room-code emails through a Resend-compatible API.
  - `services/push.js` (subscriptions, VAPID, push-service host allowlist), `services/turnAlerts.js`
    (who to alert when the turn changes), `services/presence.js` (players with the game on screen
    get no push): Web Push turn alerts.
  - `services/audit.js`: one log line per game action.
- `routes/`: HTTP only (authenticate, call a service, answer): `routes/auth.js` (accounts, email
  codes, guests, one-time device transfer codes), `routes/rooms.js` (including rejoin requests, My
  games archiving and the host's Manage players tools), `routes/seatLinks.js` (`/api/seat-links`,
  redeeming a seat link), `routes/hostTransfers.js` (`/api/host-transfers`, the offered player's
  side), `routes/games.js`, `routes/push.js`. Errors with a 4xx `status` (`RoomError`, `GameRuleError`) are answered by the
  error handler in `server.js`.
- `mcp/`: the MCP server for AI players at `/api/mcp` (`mcp/server.js` tools, `mcp/gameSummary.js`
  the agent's view of the game, `mcp/rules.js` rules text).

### Frontend (root `*.html`, `src/`)

- One HTML page per screen: `index.html` (home), `auth.html`, `lobby.html`, `waiting.html`,
  `game.html`, `hotseat.html` (same-device game), `home-screen.html` (iPhone Add to Home Screen
  handoff), `design-system.html` (live UI specimen). `landing.html` only redirects to `/`.
- `src/js/api.js`: `apiFetch` (attaches the JWT kept in `localStorage` `auth_token`), session storage
  (`getToken`/`setToken`/`clearToken`, hotseat session, `replaceStoredToken`), room wrappers and
  Socket.IO (`subscribeToGame`, which emits on every room (re)join). Pages load the Socket.IO client
  from the backend at `/socket.io/socket.io.js`, not a CDN. `src/js/ui.js`: DOM helpers
  (`escapeHtml`, `formatMoney`, dice, `showToast`, `copyText`, `showPageLoadError`).
  `src/js/number-inputs.js`: money and share-count inputs.
- One script per page: `src/js/index.js` (with `src/js/seat-link.js`, redeeming `?seat=` links),
  `src/js/auth.js` (password sign-in, create an account, email codes, `?next=`), `src/js/lobby.js`
  (My games: active and archived rooms, host offers, guest banner, set password; with
  `src/js/manage-room.js`, the host's Manage players sheet), `src/js/waiting.js` (with
  `src/js/agent-invites.js` and `src/js/manage-link.js`), `src/js/hotseat.js`, `src/js/home-screen.js`.
  Accounts, seat links, host transfer and archiving: `documents/accounts-and-game-management.md`.
  `src/js/room-resume.js`: getting back into a room (resume options and `requestRoomRejoin`).
  `src/js/rejoin-prompts.js`: the approve/decline prompt shown to other players.
  `src/js/turn-notifications.js` with `sw.js` and `manifest.webmanifest`: Web Push in the browser.
- Game page: `src/js/game.js` is the entry point and holds the page state (`currentGame`,
  `currentUser`, ...), startup, `resyncGame` (on rejoin, `visibilitychange`, `online` and a fallback
  poll), `performGameAction`/`submitGameAction` (one `actionId` across retries) and sheets. Feature
  code is in `src/js/game/`, loaded before it:
  - `turn-panel.js`: turn ticket, landing summary, warnings, auction panel, `renderActionButtons`,
    the moves grid and `renderHostPanel`.
  - `purchase.js` (buying and auctions), `houses.js`, `debt.js` (the Debt sheet), `corporations.js`
    (IPO and add-to-corporation sheets, the Corporations listing, chairman votes, buying treasury
    shares), `corporation-desk.js` (the chairman's tools: rent policy, dividends, property offers),
    `market.js` (trade form, pending and past offers, payments, share-deal summary), `device-alerts.js` (another
    device, turn alerts).
  - `property-display.js` (player cards, property rows, colours), `valuation.js` (net worth and
    company values), `log-format.js` (Recent events wording).
  - Display mirrors of server rules, kept in step with the backend: `loans.js` (`LoanMath`: terms,
    quotes and status wording, mirroring `gameRulesInternal/loans.js`), `share-deals.js`
    (`ShareDeals` previews), `turn-end-outlook.js` (cash after End Turn, mirroring `endTurn` in
    `gameRulesInternal/turns.js` and loan servicing in `gameRulesInternal/debt.js`).
  - `turn-alert.js` (vibrate when your turn starts) and `action-dispatcher.js` (routes
    `data-game-action` clicks to top-level handler functions).
  - `src/js/board.js`: board data and drawing.
- Styles: `src/css/tokens.css` (all colours, sizes, layers) and `src/css/style.css` (one stylesheet,
  mobile first, numbered sections).

### Tests and scripts

- `backend/tests/`: Jest (unit, routes, sockets, MCP, push). `tests/e2e/`: Playwright, real browser
  against real dev servers.
- `scripts/e2e-harness.js`: starts a dev backend (with throwaway push keys) and web server on dev-only
  ports with a fresh dev database, runs Playwright, stops both (flags documented at its top). Used by
  `scripts/run-e2e.js` and `scripts/run-real-game-e2e.js`. `scripts/dev-static-server.js` (with
  `scripts/dev-server.js`): static files plus an `/api` proxy.
- `scripts/check-static-assets.js` (every referenced asset exists; a script or stylesheet has the same
  `?v=` on every page) and `scripts/check-architecture.js` (import boundaries, classic scripts only,
  and every path named in this file exists).
- Whole-app verification through the real UI: the `verify-mortgage` skill,
  `.agents/skills/verify-mortgage/SKILL.md`. `play` runs whole games (2/5/8 players, 20 rounds, sync
  and state invariants, coverage of every game pathway, screenshots, agent seats); `journeys` runs
  every path outside the board (accounts, My games, rooms, hotseat, agents over MCP, hosting,
  resilience, turn alerts) in fresh browsers. Its dev runs deliver mail to a local mail sink and
  turn alerts through a local push service into the browser's real service worker
  (`PUSH_ALLOW_LOCAL_ENDPOINTS`, which `config.js` refuses in production), so both are checked end
  to end headless.
  Its bot relies on the `data-game-action` buttons and modal/Market ids listed there; update
  `.agents/skills/verify-mortgage/scripts/lib/bot.js` when renaming them.

## Rules

- **Game state changes only through `applyAction`**, called from `applyGameAction` (HTTP actions and the
  MCP `take_action` tool). Nothing else writes the `games` table except `startGameForRoom` and the
  dev-only `repairGameState`, all in `services/gameActions.js`.
- **Rules live in `backend/domain/`.** Not in routes, services, MCP or the frontend; the frontend may
  mirror a rule for display (say so in a comment, like `turn-end-outlook.js`, and keep the mirror in
  step). A new action goes in the `ACTIONS` table in `applyAction.js`, in `actionCatalog.js`
  (`backend/tests/unit/action-catalog.test.js` fails if the two differ), and in `mcp/rules.js` if
  agents should use it. Players change each other's holdings only through offers they accept.
- **Keep the rule documents true.** Rules are written down in `documents/game-rules.md`, `README.md`,
  `backend/mcp/rules.js` and the descriptions in `backend/domain/actionCatalog.js`. A rule change needs
  backend tests and an update to every one of them that mentions it, in the same commit; fix any you
  find out of date with the engine.
- **Import rules from `backend/domain/gameRules.js`**, never from `gameRulesInternal/`
  (`npm run test:architecture` enforces it). Inside `gameRulesInternal/`, keep the layer order above:
  a module never imports a later one, so there are no cycles.
- **MCP agents act only as their own seat**, authenticated by the seat's agent key. No room creation,
  room-code joins or host actions over MCP. The MCP layer only adapts inputs and outputs.
- **No build step.** Classic scripts loaded from HTML; no modules, bundler, TypeScript or framework
  unless the user asks. Game-page files share one global scope: keep shared state as top-level `let`
  in `game.js`, give helpers unique names, and keep action handlers as top-level functions (the
  dispatcher looks them up on `window`). Use `apiFetch` for API calls.
- **Cache keys.** Cloudflare caches `/src/` for 4 hours. When a file under `src/` changes, raise its
  `?v=` on every page that loads it, higher than any value `origin/main` has used.
- **Design system.** New UI uses the existing classes and tokens: no inline styles, no raw hex. Turn
  actions go in `renderActionButtons()`, optional moves in the moves grid, host-only controls in
  `renderHostPanel()`. Check 320, 375 and 390px widths; `tests/e2e/mobile-layout.spec.js` guards the
  phone layout.
- **Keep this map true.** When a file moves or a rule changes, update this file in the same commit.

## Verification

- Quick: `npm run test:static && npm run test:architecture`.
- Backend: `npm --prefix backend test -- --runInBand`.
- Browser: `npm run test:e2e` (dev ports 3011/3111 by default; pass `--web-port`/`--api-port`/`--db-path`
  to run beside another server). Long two-browser game: `npm run test:e2e:real-game`.
- Everything: `npm test`. Full suites run on the M60e's sandboxed agent account.

## Definition of done

- Works locally against dev-only ports and data; `npm test` passes as the last check (small, low-risk
  fixes may run only the checks covering the files touched; say so).
- Before any merge to `main` or deploy, run the `privacy-check` skill in gate mode
  (`--base origin/main --url https://mortgage.abdlh.com --own-domain abdlh.com`). A scanner FAIL or a
  High finding blocks, and `documents/privacy.md` must describe the code being merged.
- Public APIs unchanged unless the change was asked for; this file still accurate.
- No production port, service or database used or modified; other people's uncommitted changes kept.
- The report says what changed, which checks ran with their results, whether production was touched,
  and what risk remains.

## Development and production

Production and development never share ports, data or services.

**Production** is on the ThinkCentre M60e (`ssh m60e`) since 2026-09-23; development happens on the Pi.

- `https://mortgage.abdlh.com` reaches nginx on the M60e through a Cloudflare tunnel. nginx serves only
  `/`, `*.html` (no-cache), `/src/`, `/sw.js` and `/manifest.webmanifest`; everything else, including
  `backend/` and dotfiles, is a 404. It proxies `/api/` and `/socket.io/` to the backend, forwards
  `CF-Connecting-IP` as `X-Forwarded-For`, and passes the browser `Origin` through (MCP checks it).
- Backend: systemd unit `mortgage-backend` on `127.0.0.1:3010` (`HOST=127.0.0.1`, `TRUST_PROXY=loopback`,
  `VAPID_*` and the mail key in `backend/.env`).
- Code and data: `/mnt/ssd/projects/mortgage-backed`, not a git checkout. A deploy copies a `git archive`
  of `main` over it, keeping `backend/.env` and `backend/game.db*`, and runs `npm ci --omit=dev` in
  `backend/`. Game state is only in SQLite and a restart takes about a second (browsers resync), so
  deploy between turns after `sqlite3 game.db ".backup …"`.
- Never point dev servers, tests or scripts at any of this, and don't restart or change production
  unless the user asks.

**Development** on the Pi:

- Ports: backend `3111`, web `3011` (the phone-facing port). Never `80` or `3010`. Ports 3000–3002,
  8080 and 8081 belong to other services on the Pi.
- Data: `/mnt/ssd/dev-data/mortgage-backed`.
- Commands (see `SETUP.md` for the full environment):
  `PORT=3111 DB_PATH=/mnt/ssd/dev-data/mortgage-backed/game.db npm --prefix backend run start`, then
  `PORT=3011 DEV_BACKEND_ORIGIN=http://127.0.0.1:3111 npm run dev:web`.
- The user tests from their phone over Tailscale: `http://100.110.102.49:3011` or
  `http://pi.taildb6607.ts.net:3011` (plain HTTP; no Tailscale HTTPS on this Pi). Bind to `0.0.0.0`.
- After a web change, tell the user the running dev command, its port, the phone-test URL, and whether
  production was touched.
