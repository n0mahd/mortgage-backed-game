# Project Instructions

## Agent Orientation

This is a no-build static frontend plus an Express, Socket.IO, and SQLite backend for Mortgage Backed Monopoly.

Start here:

- Product/player rules: `README.md` and `documents/game-rules.md`.
- Production and operational context: `SETUP.md`, `documents/production-roadmap.md`, and this file.
- Backend entry point: `backend/server.js`.
- Backend routes: `backend/routes/`.
- Authoritative game rules and all game-state mutation: `backend/domain/gameRules.js`.
- Game persistence shared by HTTP routes and MCP (transaction, `state_version`, idempotency row, events, audit, Socket.IO broadcast): `backend/services/gameActions.js`. Room create/join and anonymous users: `backend/services/rooms.js`. In-process room change signal: `backend/services/roomEvents.js`.
- MCP server for AI-agent players (`/api/mcp`, tools, agent state summary, rules text): `backend/mcp/`. Player-facing action catalog and dry-run legal-action list: `backend/domain/actionCatalog.js`.
- Frontend API and Socket.IO helpers: `src/js/api.js`.
- Game screen entry point: `src/js/game.js`, with focused helpers under `src/js/game/`.
- Board rendering helpers: `src/js/board.js`.
- Browser E2E tests: `tests/e2e/`.
- Backend Jest tests: `backend/tests/`.

Fast verification commands:

- Static asset and architecture checks: `npm run test:static && npm run test:architecture`.
- Backend tests only: `npm --prefix backend test -- --runInBand`.
- Browser E2E with dev-only ports/data: `npm run test:e2e`.
- Full gate before sharing results: `npm test`.

## Architecture Rules For Agents

- Keep backend game mutations authoritative through `applyGameAction` in `backend/services/gameActions.js` (used by `POST /api/games/:id/actions` and the MCP `take_action` tool) and `applyAction` in `backend/domain/gameRules.js`. Do not write game state anywhere else.
- The MCP layer (`backend/mcp/`) only adapts inputs/outputs: no game-rule decisions there. Legal actions come from `backend/domain/actionCatalog.js`, which dry-runs `applyAction`; when adding an engine action, add it to that catalog and to `backend/mcp/rules.js` if agents should use it.
- Do not put game-rule decisions in route handlers or frontend code; routes should authenticate, load/persist state, call the domain layer, record events, and broadcast.
- Keep `backend/domain/gameRules.js` as the public game-rules import path. Internal game-rules modules are private implementation details.
- Preserve the frontend's no-build model: classic scripts loaded from HTML, no bundler, no TypeScript migration, and no framework migration unless explicitly requested.
- When changing game rules, update or add backend unit tests and update `documents/game-rules.md` or `README.md` when player-facing behavior changes.
- When changing frontend behavior, prefer focused helpers under `src/js/game/` while keeping `src/js/game.js` as the page entry point.
- Do not bypass `apiFetch` for app API calls unless there is a specific reason.
- Keep tests and dev data pointed at dev-only ports and paths.

## Definition Of Done

Stop and share results only when all applicable items are true:

- The code works locally against dev-only ports/data, not production.
- `npm test` has passed as the final verification command.
- If narrower checks were used while iterating, the final check still includes the full root test command.
- Public imports and user-facing APIs are unchanged unless an intentional API change was requested.
- `AGENTS.md` remains accurate for future agents.
- No production ports, production services, or production SQLite paths were used or modified.
- Existing unrelated user changes in the worktree were preserved.
- The final response reports what changed, verification command/results, whether production was untouched, and any remaining risk.

## Dev/Prod Testing Rules

Production and development must always stay separate.

- Do not run development servers on the same ports as production.
- Do not write dev-generated files, uploads, stories, images, game state, or test data into production data directories.
- Do not restart or modify production services unless the user explicitly asks.

Production ports and paths observed on this Raspberry Pi:

- Production public web port: `80` through nginx for `mortgage.abdlh.com`.
- Production backend/API port: `3010` on `127.0.0.1`, proxied by nginx for `/api/` and `/socket.io/`.
- Production nginx root: `/mnt/ssd/projects/mortgage-backed`.
- Treat these as stable production resources; do not reuse them for development.

When testing from the user's phone while they are on the go:

- Assume the phone reaches the Raspberry Pi through Tailscale.
- Use the dedicated mortgage-backed phone-facing dev port: `3011`.
- Bind the phone-facing dev server to `0.0.0.0` when needed so it is reachable over Tailscale.
- Provide the phone-test URL as `http://100.110.102.49:3011` or `http://pi.taildb6607.ts.net:3011`.
- Tailscale Serve currently has no HTTPS config on this Pi; use raw Tailscale HTTP unless a future `tailscale serve status` shows HTTPS is configured.

Dev server commands:

- Inspect `package.json` before choosing commands. The root package currently only defines Playwright test scripts; the backend package in `backend/package.json` defines `npm run start`.
- Do not use production port `80` or backend port `3010` for development.
- If backend testing is needed, run it on a separate dev-only port, for example: `PORT=3111 npm --prefix backend run start`.
- Serve the web UI on the dedicated phone-facing dev port `3011`. If no project script has been added for static serving, use a simple dev-only static server bound to `0.0.0.0` and keep backend/API proxying pointed at the dev backend port, not `3010`.
- Keep dev game state and test data out of production paths; use a dev-only location such as `/mnt/ssd/dev-data/mortgage-backed`.

When finishing any web change, tell the user:

- Which dev server command is running.
- Which port it is using.
- The exact phone-test URL.
- Whether production was untouched.
