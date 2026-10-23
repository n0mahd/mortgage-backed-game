---
name: verify-mortgage
description: Thoroughly verify Mortgage Backed Monopoly by playing whole multiplayer games through the real browser UI on a disposable dev instance. Builds a 2/5/8-player table (the first 3 seats sign in by email, with real login codes through AgentMail when started with `--email`; the rest join as guests on phone and desktop viewports). A scripted bot plays 20 rounds through the real buttons, checking sync, game-state invariants, errors and timing, and screenshots every key screen. An agent can take over any seat as an end user through a numbered text view (look/click), then review the UI. An app journeys suite (`journeys`) drives everything outside the board end to end: accounts, My games, rooms, AI agents over real MCP, hosting tools (seat links, host transfer), resilience and turn alerts. Use before claiming a game change works, after any change to game rules, the game screen, the lobby, sign-in, rooms, agents or hosting, or when asked to playtest, find bugs or review the game's UI.
---

# Verify Mortgage Backed

The game is a no-build static frontend with an Express + Socket.IO + SQLite backend (see `AGENTS.md`). This skill starts a **private, disposable copy** on dev ports with its own SQLite file. It plays real games in headless Chromium and never touches production, which runs on the M60e, not this Pi.

One helper does everything. Run it from the repo root:

```bash
S=.agents/skills/verify-mortgage/scripts/verify-mortgage
$S up [--email] [--headed]        # prints `export VERIFY_RUN_ID=...` and READY
export VERIFY_RUN_ID=<id>          # shell state doesn't persist between tool calls: prefix every command with VERIFY_RUN_ID=<id>
$S play --players rotate --rounds 20   # build a table, autoplay 20 rounds, print the report
$S down                            # stop everything; evidence is kept
```

## Safety

- Ports start at web `3411`, api `3511`, ctl `3611` and step up past anything taken. The helper refuses production and shared ports (`80`, `3010`, `3011`, `3111`, `3000-3002`, `8080/8081`). The web port binds `0.0.0.0` so the user can watch over Tailscale (`tailnet=` URL in READY). The API binds `127.0.0.1`.
- The DB is `/mnt/ssd/dev-data/mortgage-backed/verify/<run>/game.db`, new for every run.
- Mail is **off** by default: the mail URL is pinned to a dead local port with a dummy key. A real value is pinned rather than left empty because `backend/config.js` lets `backend/.env` fill in any empty variable. With mail off, login codes are read from the run's `otps` table.
- `--email` sends real mail: Resend as `noreply@abdlh.com`, key read from `~/.config/alf-layla/resend-api-key`. It goes to the maintainer's three AgentMail test inboxes, listed one per line in `~/.config/verify-mortgage/inboxes` (kept out of this public repo; `VERIFY_AGENTMAIL_INBOXES` overrides), and codes are read back with the AgentMail key in `~/.config/alf-layla-verify/agentmail.key`. Without `--email`, the email seats use made-up `verify-seat-N@example.test` addresses. One table sends 5 emails (3 login codes, 2 invites), and Resend's free plan allows 100 a day, so use `--email` for one table per session, not every game. Never print either key.
- Other agents may run this at the same time. Only drive, query or stop the run whose id `up` gave you. `$S list` shows every run.
- On the Pi, the browser and 8 seats use about 1.5 GB. Don't run more than 2 runs at once. Count agents before starting sub-agents (`pgrep -c -x claude`, cap 8).

## What a table is

`table <N>` (or `play`) builds a table the way people do:

1. Seat 1 (host) opens the home page, clicks **Create New Game**, signs in with the first test inbox and its emailed code, then creates a room with max players N.
2. Seats 2-3 (when N ≥ 3): the host sends them **Send Invite** emails (checked to contain the room code on `--email` runs). They sign in by email, then join with the home page room-code box.
3. The other seats open the invite link `waiting.html?code=…` and join as guests.
4. The host clicks **Start Game**, and every seat must reach the game screen.

Seats alternate desktop (1280x800) and phone (390x844, touch, mobile UA). Names: Ava, Ben, Cleo, Dev, Eli, Fay, Gus, Hana. `--email-seats 0-3` changes how many sign in by email.

## Autoplay (the bot: no tokens)

`play` and `autoplay` play every non-human seat through the **real UI only**: tabs, buttons, modals and forms, never the API. Per turn: roll (jail: card, fine or roll for doubles), then buy or start an auction. Everyone bids or passes, and sometimes passes before any bid, which is how the auction deadlock below was found. Then houses when a group is complete, issuing and settling debt, an IPO, buying shares, proposing trades (aimed at completing colour groups) that the recipient accepts or declines in Market, small manual payments, then End Turn or Declare Bankruptcy. Decisions come from a seeded PRNG (`--seed`). Dice are the server's.

Once per game it also tests resilience: the host pauses and resumes mid-game, one waiting player reloads the page, and another loses its network for a whole turn and must catch up when it reconnects. At the end, the host ends the game and every seat must see **Game Over**.

After every action it checks:

- **Effect**: the acting seat's `state_version` moves within 10 s. Otherwise it reports `no visible effect`. An `alert()` counts as a refusal (`ui-rejection`). Confirm dialogs are accepted and are normal.
- **Sync**: every seat reaches the server version within 8 s (`sync`, high if still stale 20 s later). Every seat's heading names the same current player, and only the current player has the `is-my-turn` highlight.
- **Invariants**, after every turn: finite cash, positions 0-39, board owner ↔ player property lists, houses 0-5 and only on fully owned groups, no bankrupt current player, share counts, and the game ending when one player is left (`state`).
- **Errors**: console errors, uncaught page errors, failed requests, API 5xx (and 409 conflicts). Other 4xx are tallied in the report.
- **Stuck**: a turn over 25 steps, no progress for 90 s, or an auction no one can move.
- **Timing**: p50/max click-to-result per action. Anything over 4 s is a `perf` finding.

Measured on this Pi: 2 players × 20 rounds ≈ 1 min, 5 × 6 ≈ 1 min, 8 × 20 (160 turns, ~550 UI actions) ≈ 7 min. Autoplay costs nothing in tokens; only agent turns do.

`--players rotate` cycles 2 → 5 → 8 across runs (state in `/mnt/ssd/dev-data/mortgage-backed/verify/rotation.json`). `random` picks one. A thorough pass is one game of each:

```bash
$S up && export VERIFY_RUN_ID=<id>
for n in 2 5 8; do VERIFY_RUN_ID=$VERIFY_RUN_ID $S play --players $n --rounds 20 --timeout 590; done
```

Each `play` blocks until done (`--timeout` seconds of polling; keep it under the Bash limit, then use `status --wait 590`). `--detach` returns at once.

## Pathway coverage and explore mode (`--explore`, free)

Random play reaches common paths constantly and rare ones almost never. An 8-player, 12-round chaos game reached 25 of 41 engine event types, with no bankruptcy, chairman vote, refinance, insolvency or jail card. So every report measures **pathway coverage**: 140 pathways in `lib/pathways.js`, detected from the authoritative `game_events` rows, the `game_actions` request log, refused actions seen in the browser, and harness-observed paths (including refusals the UI blocks before the server sees them, such as a greyed-out built-group street). Card and board data come from the public `backend/domain/gameRules.js`, so the map follows the engine.

| Group | Covers |
| --- | --- |
| Turn | roll, doubles again, three doubles → Jail, GO, Go to Jail, Free Parking, Just Visiting, both taxes, end turn |
| Jail | pay fine, use card, doubles out, stay, forced bail on the third turn |
| Property | buy street/railroad/utility; auction start, bid, pass, won, no sale, host cancel, timeout |
| Rent | plain street, double rent on a full group, houses, hotel, railroad, utility, rent you can't pay |
| Houses | buy houses, build a hotel, repairs card with buildings |
| Debt | personal, corporate, 5- and 15-turn terms, part payment, pay off, autopay off, unpaid interest, repaid at maturity, bankrupt at maturity, refinance, loan payments (personal and corporate) |
| Corporations | IPO, add property, buy treasury shares, share offers, majority chairman change, vote proposed/supported/passed, chairman after bankruptcy, insolvency |
| Corporation desk | rent policy switched by the chairman; policy vote proposed, agreed, rejected, passed by everyone; Payout rent passed to shareholders and the shareholder's discount; rent into a Reinvest treasury; dividend; buying and building for the company; trading as the company; property-for-shares trade; property offers made, accepted for shares or cash, countered, declined, withdrawn, expired |
| Market | propose, accept, decline, withdraw, host cancel, expire, property swap, jail-card trade, direct payment |
| Bankruptcy | claim payment, claim settled, bankrupt to a player, to the bank, last player standing |
| Host | pause/resume, end game |
| Refusals | the game must say no: bid over cash, act out of turn, junk amounts, impossible trades |
| People | email sign-in, guest join, reload, offline, device transfer, guest rejoin by room code |
| Cards | each of the 16 Chance and 16 Community Chest cards |

```bash
$S coverage --missing      # this game: what is still unreached, with how-to hints and stage names
$S coverage --all-runs     # across every recorded game (ledger: /mnt/ssd/dev-data/mortgage-backed/verify/coverage-ledger.json)
```

`report.md` has a **Pathway coverage** section per group. Pathways no recorded game has ever reached are marked ✱. That's the to-do list for the next run.

`--explore` makes autoplay **coverage-guided**. Before each decision it reads what's unreached and leans that way: jail choices, auction instead of buy, all bots passing to get a no-sale, host cancels, aiming houses at a hotel, accepting versus declining. It also does actions the plain bot never does: refinance, corporate debt, buying a stake big enough to vote or take a majority, chairman votes and support, withdrawing its own offer, host-cancelling others' offers, property swaps, jail-card trades, partial repayment. Rare situations get a **staged setup** at the start of a bot turn (35% of turns, at most 2 tries per stage; `--stage-rate`). The host's dev-only state repair (`ALLOW_STATE_REPAIR=true`, which every run sets) puts the game into the situation, and fixed dice queue the right roll. Then the situation is played out **through the UI**:

| Stage | Sets up |
| --- | --- |
| `three-doubles`, `land-go-to-jail` | fixed dice for the current player |
| `in-jail`, `in-jail-with-card`, `jail-third-turn` | the current player in Jail (with a card, or on the third turn) |
| `monopoly`, `houses-built`, `hotel-built` | another player owns a full group (plain, 4 houses, hotels); the current player will land on it |
| `near-bankrupt`, `broke-to-bank` | the current player has $40/$30 and lands on hotels or Income Tax; the bot survives the claim or goes bankrupt, whichever is unreached |
| `insolvent-corporation` | the current player's corporation gets a $400 loan due at the next End Turn and no cash, so it becomes insolvent |
| `loan-due`, `loan-default` | the current player gets a loan due in full at their next End Turn, with the cash to repay it ($300, autopay off) or without ($2,000 and $50 cash) |
| `trade-expiry`, `auction-timeout` | offers or auctions time out after 3 s (restored once the pathway happens); bots leave offers unanswered while the short timeout is in effect |
| `corporation-with-shareholders` | the current player chairs a company (their own, or a new one) with a $600 treasury and a street, and another player holds 40%: rent policy before the roll, dividends, chairman votes, Trade as |
| `corporation-locked-policy` | the same with the rent policy locked for 3 turns, so a change needs every shareholder: Ask every shareholder, Agree, Reject |
| `payout-corporation`, `reinvest-corporation` | another player's company owns a street in Payout (the current player holds 25%) or Reinvest; the current player lands on it |
| `corporation-buys`, `corporation-group` | the current player's company has $1,000 and they will land on an unowned street (Who's buying?), or it owns the Brown group and $800 (Build houses for) |
| `offer-to-corporation`, `property-offer-expiry` | another player chairs a company with $800 and the current player owns a street to offer it (the second also makes offers expire after 3 s) |
| `card:<id>` (32) | that card on top of its deck, and the player lands on that deck |

Bankruptcy stages wait for the last third of the game. A pathway naming a stage `lib/stages.js` doesn't have fails at load. Every stage is checked against the engine's own `validateStateInvariants` before it's sent, logged as `STAGED` in `steps.log`, and listed in the report. A finding that follows a stage came from a staged situation, so judge it with that in mind. `$S stage <name>` stages one by hand at the start of a turn.

The chairman's desk is played through the corporation sheet (`src/js/game/corporation-desk.js`): the chairman switches the rent policy at the start of a turn before rolling, pays dividends, builds for the company and trades as it; holders propose a policy vote and every bot holder answers Agree or Reject; non-runners offer a property (book value or a set price, for shares or treasury cash) and the bot chairman accepts, counters or declines, the offerer answering a counter; the Buy sheet's **Who's buying?** picks the company. Votes and offers are answered off-turn, like trades.

Explore mode also adds the engine's `validateStateInvariants` to the bot's invariant checks, and adds two resilience paths: a player moves to a new browser with **Play on another device**, and a guest rejoins from a new browser via **Continue as an existing player**.

For a thorough pass, use explore on every game and chaos on some:

```bash
for n in 2 5 8; do VERIFY_RUN_ID=$VERIFY_RUN_ID $S play --players $n --rounds 20 --explore --timeout 590; done
VERIFY_RUN_ID=$VERIFY_RUN_ID $S play --players 5 --rounds 12 --explore --chaos 0.3 --timeout 590
VERIFY_RUN_ID=$VERIFY_RUN_ID $S coverage --all-runs
```

## Chaos mode (`--chaos P`, free)

The sensible bot only does what its policy allows, with sane inputs in a sane order. `--chaos 0.3` makes about 30% of its steps (at most 3 a turn, so games still finish) do what careless, impatient or malicious people do, all through the UI:

| Move | What it does | Extra check |
| --- | --- | --- |
| random-control | Random enabled control on a random seat and tab (60% current player, 40% anyone), sometimes submits whatever form opened. Never End Game, Pause, Cancel Auction, logout or device transfer. | Seat must get back into the game if it left the page. |
| junk-input | Puts `-50`, `0`, `abc`, `NaN`, `Infinity`, `''`, `1e9`, `0.001`, … into a bid, loan, settlement, IPO, payment or trade field and submits. | **Accepted junk** is a finding (high for negative/NaN/text), with the cash that moved. |
| double-click | Double-clicks Roll Dice or End Turn. | Rolled twice without doubles; End Turn skipped a player. |
| concurrent | Current player rolls or ends the turn at the same moment another seat makes a payment. | 409 handling, sync, invariants. |
| modal-escape | Opens a dialog, then presses Escape or taps outside it. | Dialog still open → UX note. |
| reload-mid-action | Clicks Roll Dice and reloads at once. | Game comes back; the roll applied once. |

After every chaos move, the normal sync and invariant checks run. The report adds a **Chaos** section with move counts and every refusal message players saw, so you can check that the wording tells a person what went wrong. Decisions follow `--seed`, so `--seed N --chaos P` replays the same choices (dice still differ). Use chaos for at least one game per pass, for example `play --players 5 --rounds 12 --chaos 0.3`.

## Haiku players (`--agents`, costs tokens)

An LLM player explores what neither bot thinks of, and says what confused it. Each agent seat is a headless `claude -p` on Haiku 5.5 that plays only through `wait`/`look`/`click`/`fill`/`select`/`check`/`tab`/`shot`/`note`. It is allowed exactly the harness command plus Read, nothing else. When the game ends it writes a review. The bot plays every other seat and waits for agents.

```bash
$S play --players 2 --rounds 10 --agents all                 # one claude process per agent seat
$S play --players 5 --rounds 20 --agents 1,3 --chaos 0.2     # mix: agents, bot and chaos at one table
$S play --players 5 --rounds 20 --agents all --shared        # ONE claude process plays all agent seats
$S agents-status    # per agent: running/done, tool calls, refused calls, cost, minutes, review path
$S status           # the game's progress
```

- **Missions.** At launch, each agent's brief gets its own share of the unreached pathways (never-reached ones first, from the ledger), matched to its persona: newbie gets People/Turn/Property/Jail/Host, trader gets Debt/Corporations/Market/Houses, breaker gets Refusals/Market/Property/Jail, auditor gets Rent/Houses/Bankruptcy. No two agents chase the same one. Agents are told that reaching every part of the game is the goal, not winning. They plan multi-turn setups, run `coverage --missing` every 4-5 turns, and try something new every turn. Combine with `--explore`, so the bot seats steer and stage too.
- Personas rotate by seat: **newbie** (reads literally, reports confusion), **trader** (debt, IPOs, shares and trades every turn; checks the money), **breaker** (tries what the rules should refuse), **auditor** (checks every number against Recent events). Choose with `--personas breaker,auditor`. Model `--agent-model` (default `claude-haiku-5-5`), `--agent-effort` (optional; never `max`).
- **Agent cap**: the Pi allows 8 `claude` processes machine-wide (`pgrep -c -x claude`, every T3 thread counts). The launcher refuses anything that would pass it, before building the table. Use `--shared` (counts as 1), fewer agent seats, or the M60e for bigger all-agent games.
- **Time and cost**: an agent turn takes about 4-8 calls and 30-90 s, and the game waits for it. Two all-agent players for 10 rounds is roughly 20-30 min. An 8-seat all-agent game for 20 rounds is 2+ hours, so give it to the M60e or use `--shared`. `agents-status` shows the actual cost per agent.
- Output goes to `evidence/agents/`: `<name>.brief.md` (the exact prompt), `<name>.jsonl` (the full stream: every command and screen), and `<name>.review.md` (its final review). The agents' `note`s are findings in `report.md` with screenshots.
- `down` stops any agents still running. An agent idle for 10 minutes is replaced by the bot (`--human-idle-min`).
- Agents are protected from the harness. Staged setups and harness actions write `Test setup:` / `Test harness:` lines into the game log, and the brief tells agents not to report those as bugs. "Are you sure?" dialogs on an agent seat are dismissed unless it clicks with `--confirm`. A stale ref re-matches only its exact old label. The bot never clicks on an agent's screen: if an agent host doesn't cancel a deadlocked auction within 3 minutes, the harness cancels it through the API and logs it. Idle takeover replaces only the seat that went idle.
- Measured (2026-10-21): 3 Haiku players (breaker, auditor, trader) plus 2 explore-bot seats, 5 players × 12 rounds, took 23 minutes. That was 92-143 tool calls and $0.44-$0.69 per agent, about $1.80 in total. They wrote 20 notes with screenshots, including 6 real money and rule bugs neither bot could judge.
- Read the reviews critically. Haiku misreads screens sometimes, so confirm a reported bug in its `.jsonl` or with `look`/`state` before you call it a bug.

## App journeys (`journeys`, free)

Games test the board. `journeys` tests everything around it, the way people use it: 40 journeys, each in its own fresh browsers (separate contexts, phone 390x844 and desktop 1280x800, an iPhone UA where it matters), with its own accounts and rooms. Agents are real MCP clients: JSON-RPC `tools/call` to `/api/mcp`, no browser Origin, like an agent's connector. Each journey asserts what a person would see, screenshots the key screens, and ends as one pathway: **pass**, **finding** (passed, but something was recorded), **fail** (an assertion failed: a bug, or the harness; triage it) or **skip** (not verifiable headless; the reason is given).

```bash
$S journeys                          # all (~5 min on the Pi); blocks, then prints the table
$S journeys --only accounts,agents.play-turns   # groups or ids
$S journeys --list                   # ids, groups, what each covers
$S journeys --detach && $S journeys-status --wait 590
$S coverage --journeys               # which journeys ever passed, across recorded runs
```

| Group | Journeys |
| --- | --- |
| Accounts | register from the home page (mismatch, short name, taken name); log out and sign in by username; wrong password and unknown user; email code → Set password → sign in by email+password and by username; a guest plays, creates an account and keeps the game; `?next=` (same site honoured, other sites ignored); device transfer code typed on a laptop, single use, and as a link; signed-out game link; Forgot your room code |
| My games | waiting and in-progress games listed and opened; archive, reload, unarchive (per user, game keeps running) |
| Rooms | create as playing host (form refusals, waiting room) and as watching host; Copy Code, Send Invite, host loan rates reach the game; join by home page code (short code, pasted code, same name gets a number) and by invite link (bad code leaves no token); email player joins and stays an account; leave the waiting room, leaving refused after the start; host re-entering their own code; full room; rejoin as an existing player approved, declined and cancelled; hotseat: setup refusals, pass the phone, resume from home |
| Agents | invite by name, join over MCP (host's name wins), rename, revoke joined and pending; agent joins while the host page is hidden with its socket cut, page shows Joined on return; host and agent play turns (`wait_for_turn` must wake, `take_action` shows live); agent-only game with a watching host (pause refuses agent moves, resume, end); New key mid-game (old key fails, new key resumes the same seat) |
| Hosting | Manage players sheet (badges and tools per player, non-host refused, closes cleanly); guest seat link → fresh browser lands in the seat, single use; account seat link → sign in → game, reusable; Make host to a guest → create account → accept → controls move; the same on open game screens without reload; cancel and decline offers seen live; pause, resume, end |
| Resilience | reload mid-turn; offline while the other player moves; two tabs of one player |
| Turn alerts | alerts sheet (blocked, Turn on alerts, subscribe, off); iPhone Add to Home Screen handoff, icon launch, relaunch, expired code |

Every new screen is also checked at 320, 375 and 390px (auth views, My games, create and set-password sheets, waiting room, join form, Manage sheet, agent invite and new-key sheets, home-screen page). Content past the right edge, including inside a fixed sheet, is a `layout` finding with a shot at the worst width.

- Evidence: `journeys-<k>/NNN-<journey>-<person>-<what>.png` + `.txt`, with `FAIL` shots of every open browser when a journey fails. `report.md` has an **App journeys** table (✱ = never passed in any recorded run), and each journeys run is a `<run>/journeys-<k>` entry in the coverage ledger.
- Journeys run one at a time and close their browsers when done, so a full pass stays small on the Pi. `journeys.js` is re-read on every `journeys` command; backend changes still need `down`/`up`. The run raises the dev backend's general auth and rejoin limits so repeated runs from one address don't trip them; the always-on per-account and per-code limits are untouched.
- Mail is off: login codes come from the run DB, and Send Invite / Forgot code only check that the page answers. No `--email` needed.
- Not verifiable headless: push delivery and the test alert. Headless Chromium refuses a push subscription (`Registration failed - permission denied`), so `push.turn-alerts` stops at the Turn on alerts step and reports skip. A real Home Screen install on an iPhone is emulated (`navigator.standalone`), not tested. Real clipboards are emulated by granting clipboard permission.
- Adding one: a `{ id, group, label, run(j) }` entry in `lib/journeys.js`. Use the shared flows there (`register`, `createRoom`, `joinRoom`, `twoPlayerGame`, `takeTurn`, `agentTurn`, `copySeatLink`), `j.see`/`j.gone` (which say what was on screen when they time out), `j.layout`, `j.finding` for problems that shouldn't stop the journey, and `j.skip` for what can't be checked headless.

## Playing a seat yourself (end-user mode)

This is how an agent sees the game as a person does. Mark one or more seats as human, and autoplay plays the rest and waits for you:

```bash
$S play --players 5 --rounds 20 --human 2      # returns immediately; you are seat 2 (Ben, phone)
$S wait 2 --timeout 300    # blocks until you must act: your-turn | auction | trade-offer | game-over; prints your screen
$S click 2 e6              # or by label: $S click 2 "Roll Dice"; prints the new screen
$S fill 2 e9 120 && $S click 2 "Bid"
$S select 2 e12 "Cleo"     # dropdowns by visible option text
$S check 2 e14             # checkboxes (trade assets, IPO assets)
$S tab 2 market            # game | market | log (Recent events) | board
$S shot 2 auction-on-phone # full-page PNG; open it with Read to judge the layout
$S look 2 --full           # all screen text, not just the first 1800 chars
```

`look` output:

```
[seat 1 Ava · desktop 1280x800] game.html?room=… · tab: Game
YOUR TURN · You: $1500.00 at square 0 · v0
--- screen ---
Current Turn: Ava …
--- controls: click <ref|"label">, fill <ref> <value>, select <ref> <option>, check <ref> ---
e6 [button] 🎲 Roll Dice
e11 [button, disabled: Roll before ending your turn] End Turn
```

- When a modal is open, only its controls are listed (`MODAL OPEN:` line). Close it with its Cancel/Close control.
- Refs are renumbered by every `look`/`click`. If the game re-renders, a stale ref is re-matched by its label and the output says so. Labels never go stale, so prefer them for repeated actions.
- `DIALOG` lines show alerts and confirms (auto-accepted; `click … --dismiss` cancels the next confirm). `ISSUE` lines show console or network errors since your last look. `TOAST` lines show transient messages.
- If you go idle for 10 minutes (`--human-idle-min`), autoplay takes the seat over and records it.
- `human <seat> --off` hands the seat back. `state` prints the server's view of everyone. `stop` ends autoplay.

**Token cost.** A human seat costs about 4-6 tool calls a turn (wait, click roll, buy or end, sometimes a modal), so 20 turns of one seat is about 100-120 calls. Run it on Haiku 5.5, which is cheap enough. Having agents play every seat of an 8-player game (160 turns, about 800 calls and 1-2 hours) adds little over the bot, so don't. The intended split: the bot plays everyone for volume, one agent plays one seat as an end user for 20 turns, and a stronger model reviews the screenshots. On the Pi, one human-seat agent per run.

## UX review (what to look at)

After a game, open the screenshots with Read: the PNG plus a `.txt` of the same screen's text view. Key screens get a shot the first time they appear: `lobby-host`, `waiting-room-*`, `game-start`, `after-roll`, `buy-property-modal`, `auction-panel` (bidder and watcher), `house-modal`, `debt-modal`, `ipo-modal`, `corporation-modal`, `market-trade-form`, `trade-offer-recipient`, `in-jail`, `negative-cash-warning`, `declare-bankruptcy-button`, `after-bankruptcy`, `game-paused`, `round-N` (all seats plus the board every 5 rounds), and `game-over` on every seat. Compare phone and desktop for the same moment.

For each screen ask: can a first-time player tell whose turn it is and what to do next? Is the primary action obvious and reachable without scrolling on the phone? Are disabled buttons explained? Do numbers (cash, rent, interest, net worth) agree with the log? Is any text clipped or overlapping? Is the same idea worded the same way everywhere?

Record each problem against the evidence, with a recommendation:

```bash
$S note --seat 2 --severity medium --category ux --title "Bid input hidden under the fold on phone" --detail "auction-panel shot: Bid/Pass sit below 4 player cards; move the auction panel above the cards"
```

`note` screenshots that seat and adds the finding to `report.md`.

## Evidence

Everything is in `test-output/verify-mortgage/<run>/` (gitignored; not `test-results/`, which Playwright empties on every run):

- `report.md`: setup, final table, action timing, findings by severity, API 4xx tally. Also `findings.json` and `summary.json`.
- `steps.log`: every command, action, dialog and finding with timestamps.
- `game-<k>-<N>p/NNN-s<seat>-<name>-<what>.png` + `.txt`: screenshots and their text views. Failure shots are linked from their findings.
- `backend.log` (copied by `down`).

When you report, give the run id, the git rev (`doctor`), the scenarios played (players, rounds, seed), and the high and medium findings with their shots. Say what was not covered (for example, email off, or no human seat). A bot-only run does not prove the UI is pleasant; it proves the flows work and stay in sync.

## Findings so far (2026-10-23, app at `f48348e`)

From explore games with 2, 5 and 8 players × 20 rounds, a 5-player chaos game and a shared Haiku game (5 seats × 12 rounds). Every one was checked in the code or replayed; the harness false alarms these runs exposed are fixed in the harness.

- **Medium, UX/money**: company loans get no End Turn warning. A treasury that can't cover its autopay silently adds unpaid interest, and a maturity it can't repay makes the company insolvent (properties to the Bank, every share wiped). `TurnEndOutlook.forPlayer` (`turn-end-outlook.js`) only reads the player's own loans; only the Debt sheet's loan row warns (Haiku trader).
- **Medium, log**: a roll of doubles that lands on Go to Jail, or on a card that sends you to Jail, is logged "(doubles - roll again!)" though the turn is over. `rollDice` in `movement.js` writes that line before `processLanding` (Haiku newbie).
- **Medium, UX**: a fractional share count in a trade (0.5) is silently dropped (`selectedTradeShares` in `market.js` floors it), so the offer becomes a one-sided gift. Gifts are allowed, but the form should refuse a fraction rather than drop it (Haiku breaker).
- **Low, UX**: a trade offer whose property has since moved (into a company, say) stays pending until Accept is refused with the generic "Can only transfer owned property"; offers are only cancelled automatically on bankruptcy.
- **Low, UI**: after paying a loan in the Debt sheet, switching it to "Take a new loan" shows the old borrowing limit until the sheet is reopened (`debt.js`: payment refreshes only the loan list).
- **Low, wording** (Haiku): company creditors show as "[BENC]" in Recent events; a bid over your cash says only "Insufficient funds"; empty-amount refusals are worded two ways ("Please enter a loan amount", "The amount must be more than $0."); Market's "Payment completed" banner outlives the payment; Create IPO with no property shows an empty list with no reason; the turn panel's Debts omit company loans; Market's two "Player" selects don't say which side gives.
- **Not bugs**: a loan payment above the balance pays off exactly the balance (by design, the rest stays in cash); amounts are rounded to cents everywhere (a bid of 1.005 is $1.00).

Fixed since the 2026-10-21 list (checked in the code): the auction left open after the only bid, trading streets from a built group, overpaid debts vanishing, loans with no limit (now 90% of book value), sub-cent payments, 1-share IPOs (now 12,000 shares) and the 0-share chairman, raw corporation IDs on the landing card and board, "Your Turn!" behind Game Over, refusals hiding the server's reason, Escape and backdrop taps not closing dialogs, and email players becoming guests when joining by room code.

## Helpers

| File | Purpose |
| --- | --- |
| `scripts/verify-mortgage` | Entry point (bash → `cli.js`). |
| `scripts/cli.js` | `up`/`down`/`list`/`doctor`/`logs`/`env`/`play`; forwards the rest to the daemon. |
| `scripts/daemon.js` | One per run: backend child, static+API proxy (`scripts/dev-server.js`), Chromium, control API on `127.0.0.1:<ctl>`, findings and report. |
| `scripts/lib/table.js` | Seats, page watchers, sign-in (switching to the emailed-code view), room creation, invites, joining. |
| `scripts/lib/bot.js` | Autoplay policy, sync/invariant/stuck checks, resilience tests. `tradeParties` sets both Market sides and resets Trading as. |
| `scripts/lib/view.js` | The `look` snapshot and ref/label resolution. |
| `scripts/lib/chaos.js` | Chaos moves and their checks. |
| `scripts/lib/pathways.js` | The pathway map and coverage detection. Add a pathway here when the engine gains an action, event or card effect. |
| `scripts/lib/stages.js` | Staged setups (state repair + fixed dice), including companies with shareholders, policies, treasuries and properties for the chairman's desk. |
| `scripts/lib/explore.js` | Coverage-guided decisions, staging policy, the exploration-only UI actions (including the chairman's desk, and answering policy votes and property offers off-turn), and refusal probes. |
| `scripts/lib/players.js` | Haiku player personas, briefs, agent-cap check, launch, status. |
| `scripts/lib/agentmail.js` | Reads login codes and invites from the AgentMail inboxes. |
| `scripts/lib/runs.js` | Run dirs, ports, evidence paths. |
| `scripts/lib/journeys.js` | App journeys: accounts, rooms, agents (MCP), hosting, resilience, turn alerts; their shared flows and the runner. |

The bot relies on the game's stable hooks: `data-game-action="…"` buttons inside `#game.section.active`, modal ids (`#buyPropertyModal`, `#houseModal`, `#debtModal`, `#ipoModal`, `#corporationModal`, `#addToCorpModal` (`#addToCorpAssets`, `#addToCorpShares`, `#add-to-corp-btn`), `#winnerModal`), the Debt page (`#debtAction` values `loans`/`issue`/`refinance`, `#loanLimit`, `#refinanceLimit`, `#loanTerms-<5|10|15>`, `#loanAutopay`, `#loanList .loan-row` with `[data-loan-autopay]`, `[data-loan-pay]`, `[data-loan-payoff]`), `.modal.active`, Market ids (`#player1Select`, `#player2Select`, `#player1As`/`#player2As` (Trading as), `#player1Destination` radios, `#player1Cash`, `#player2-asset-<id>`, `.trade-share-input[data-corp-id]`, `#executeTradeBtn`, `#paymentToPlayer`, `#paymentAmount`, `#makePaymentBtn`, `#tradeOffersList`), the chairman's desk in `#corporationModal` (`data-game-action` `set-rent-policy`, `propose-rent-policy`, `vote-rent-policy` with `data-approve`, `pay-dividend` with `#dividend-<corpId>`, `build-for-corporation`, `trade-as-corporation`, `open-property-offer`, `offer-property-for-shares`, `respond-property-offer` with `data-response` and `#counter-<offerId>`, all with `data-corp-id` or `data-offer-id`), `#propertyOfferModal` (`#propertyOfferAssets`, radios `propertyOfferBasis` and `propertyOfferPayWith`, `#propertyOfferPriceInput`, `#send-property-offer-btn`), the Buy sheet's `#buyForChoices input[name="buyFor"]`, `#auctionBidAmount`, the `currentGame`/`currentUser` globals, and `#gameContent .game-header h2` containing the current player's name. If a UI change renames any of these, update `lib/bot.js` in the same change. Backend code is loaded when a run starts, so restart the run (`down`, `up`) after backend or harness edits. Frontend files are served live.
