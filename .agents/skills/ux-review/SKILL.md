---
name: ux-review
description: Audit and improve Mortgage Backed's user experience, above all its chronic excess of text (descriptions under clear titles, the same fact shown several times on one screen, prose explaining weak labels). Reviewers stage real game states on private dev servers, screenshot every screen at phone and desktop width, and report text to cut, duplicated facts, structural fixes and bugs; fixes then land per area on separate branches, and structural redesigns go to the owner as mockups first. Use when asked to review, declutter or improve the UI, UX, copy or front-end design, to "do a UX pass", after a batch of new screens, or on a regular schedule.
---

# UX review

The owner's verdict (2026-11-23): the app has "a ton of unnecessary text or duplicative text or text
explaining things that are already clear", players get fatigued, and the front-end design is weak. Most
of that text exists to prop up a weak layout or label, so a review looks for structure, not just words.
The rules that every screen must meet are in `documents/design-system.md`, **Writing → Say less**.
Read them first.

Past audits and the open backlog: `audits/` in this folder. Start every run by reading
`audits/backlog.md` and the latest audit, so you don't re-report what's known and can check whether
earlier fixes held.

## The loop

1. **Scope.** Pick the areas. The default three cover the app:
   - **Game tab**: turn ticket, landing, warnings, dock, moves, player cards, buy/auction/houses
     sheets, jail, pause, bankruptcy, game over.
   - **Market and sheets**: Market panes, Corporations and the chairman's desk, IPO, mergers, Debt and
     its End Turn outlook, Recent events, Board.
   - **Outside the board**: home, sign-in, My games, waiting room, agent invites, hotseat, Add to Home
     Screen, the app-bar sheets (another device, turn alerts, rejoin), toasts and errors.
   After a feature, review only the screens it touched plus their neighbours.
2. **Review**: one reviewer per area, in parallel (sub-agents; read-only). Brief from
   `reviewer-brief.md`. Each stages real states through the API with `scripts/stage.js` on its own
   ports (table below), screenshots at 390x844 and 1280x800, reads the copy in the code, and writes
   `audit-<area>.md` in the format the brief gives.
3. **Triage** the reports into four batches and show the owner a short plan:
   1. **Bugs**: wrong numbers, wrong words, lost data, broken flows. No design decision needed.
   2. **Text cuts**: lines that repeat a label, intros under clear titles, side notes. Low risk.
   3. **Structural redesigns**: anything that changes layout, navigation, number formats or flows.
      These need the owner's choice: mock them up first (2–3 directions, see below).
   4. **Prevention**: a rule for `design-system.md` Writing, or a test, so the pattern can't come back.
   Keep the plan short. The owner reads it on a phone and dislikes long text as much in reports as in
   the app.
4. **Fix**: once the owner says go, batches 1, 2 and 4, one implementation agent per area, each in its
   own worktree and branch (`fix/ux-<area>`), briefed from `fixer-brief.md`. Structural items go to a
   design agent that writes mockups (below) for the owner to pick from.
5. **Land**: merge the area branches into one release branch, resolve the `?v=` cache-key collisions
   (each branch bumps the same files: take the highest and bump once more if `origin/main` moved),
   run `npm test` (or the suites listed in `AGENTS.md`), look at the after-screenshots, then follow
   AGENTS.md's merge and deploy rules (privacy check, `check:deploy`) only when the owner asks.
6. **Record**: copy the reports into `audits/<date>/` (text only; screenshots stay in scratch) and
   update `audits/backlog.md`: mark what shipped, add what's open, note any rule added.

## Ports and machine

| Who | Web | API |
|---|---|---|
| Reviewer or fixer: Game tab | 3021 | 3121 |
| Market and sheets | 3031 | 3131 |
| Outside the board | 3041 | 3141 |
| Design / mockups, spare | 3051 / 3061 | 3151 / 3161 |

Never 80, 3010 (production), 3000–3002, 8080, 8081 (other services), and leave 3011/3111 to the
owner's own dev server. Never touch production (`mortgage.abdlh.com`, `ssh m60e`) except to read logs
or data when the owner reports a live problem, and say so.

Start a reviewer's servers with
`node .agents/skills/ux-review/scripts/servers.js --web <port> --api <port> --db <scratch>/ux.db`
(in the background; stop it at the end). It sets throwaway push keys, so turn alerts behave as in
production, and turns off rate limits.

On `omarchy-mini` there's no `/mnt/ssd/dev-data` (use scratch paths) and Playwright's bundled
browser is missing: `stage.js` falls back to `/usr/bin/chromium`, and e2e runs need a wrapper config
that sets `use.launchOptions.executablePath`. With that browser, Chromium reports notification
permission as "default", not "denied": `turn-alerts.spec.js` "desktop browsers explain blocked
notifications" fails on main too, and the one-time turn alerts offer shows on every fresh page
(`stage.js` answers it unless `alertsOffer: true`).

## Staging states

`scripts/stage.js` wraps the dev API: guests, rooms, a started game with any `game_state`
(`POST /api/games` accepts one on dev), actions with the right `expectedVersion`, a signed-in page at
phone or desktop width (optionally an iPhone, optionally standalone), and `shot()`, which saves the PNG
and the page's visible text as `.txt`. Grep the `.txt` for repeated numbers and names: that's the
fastest way to find a fact shown twice. Usage is at the top of the file. Stage the states players
actually meet: before and after a roll, buying, paying rent, someone else's turn, jail, an auction
(bidder and watcher), debt and End Turn warnings, a corporation with shareholders, pending trades and
votes, bankruptcy, paused, game over (also after a reload), and outside the board, signed out, guest,
account, host and non-host.

## Mockups for structural changes

A design agent writes 2–3 genuinely different directions as self-contained HTML in scratch, using the
real tokens and classes from `src/css/tokens.css` and `style.css` so they're buildable, renders PNGs
at 320/375/390 and 1280 with Playwright (`file://`, no servers), and writes a README: idea, trade-off,
what it takes to build. Show them with `html_preview`/`html_render` (or publish an artifact if the
owner wants to share them), recommend one, and let the owner choose before building.

## What earlier runs taught

- **Reviews must use screenshots.** Copy built in JS and duplication across components only show on
  screen. In 2026-11 the $200 of one purchase appeared five times on the Game tab; no single file
  showed it.
- **Weak structure creates text.** "Action" on the dock needed a landing hint; 12,000 shares per
  company made "$0.1792 a share" and an "of 12,000 (50%)" note everywhere. Fix the label or unit, and
  the sentence goes.
- **The owner cuts harder than reviewers.** Even one line under "Know when it's your turn" was
  "completely pointless"; the short functional line they chose instead was "Alerts when the app is
  running in the background". Default to title + buttons.
- **Don't let a step repeat the button below it** ("Tap Turn on alerts below").
- **Reviews find real bugs.** The 2026-11 run found a hotseat start that deleted a guest's games,
  merger percentages that disagreed with the Corporations sheet, a winner summary that never came back
  after a reload, and marketing copy contradicting the loan rules. Triage bugs first.
- **A new card above the desktop columns pushes the pinned turn column down**:
  `tests/e2e/desktop-layout.spec.js` caught it. Layout tests should start with one-time offers
  answered.
- **Keep the rule documents true.** If a fix changes a rule, action or limit, `CLAUDE.md` requires
  `documents/game-rules.md`, `README.md`, `backend/mcp/rules.js` and `actionCatalog.js` in the same
  commit. Text fixes usually don't, but marketing claims about rules must match the engine.
- **Several branches bump the same `?v=`** (`style.css`, `game.js`, `game.html`'s scripts). Expect the
  conflicts at merge; `npm run test:static` catches a version that didn't move.
