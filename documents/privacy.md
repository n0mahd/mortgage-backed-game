# Privacy and data inventory

What Mortgage Backed holds about people, where it goes and how long it stays. The `privacy-check`
skill (`~/Knowledge/skills/privacy-check`) keeps this file true: every merge to `main` that changes
personal data, logging, storage or third parties updates it in the same commit.

Last full check: 2026-10-20 at `74cc680` (`privacy-check` baseline, scanner plus manual review,
live probe of https://mortgage.abdlh.com). Last gate: 2026-10-21, before enabling `/api/mcp`.

## Principles

- Collect the minimum the game needs. Every new personal field is an explicit decision recorded here.
- No tracking of individuals. Usage and error insight is anonymous and aggregate.
- Nothing personal goes to a third party unless it's listed below with its reason.

## Personal data held

Production database: SQLite on the M60e at `/mnt/ssd/projects/mortgage-backed/backend/game.db`.

| Data | Where | Why | Who can see it | Retention | Deleted by |
| --- | --- | --- | --- | --- | --- |
| Email address | `users.email` (null for guests) | OTP sign-in, "forgot room code" email | Server only, never sent to other players or agents | Forever | Nothing (no account deletion) |
| Invitee email address | Not stored; passed straight to the email provider | A signed-in room member emails a friend the room's code | Server and email provider | Not kept | n/a |
| Email + login code | `otps` (`email`, `code` in plaintext) | 10-minute sign-in code | Server only | Until the next code is requested for that email; used rows are never deleted | `send-otp` for the same email |
| Player name (free text, chosen per room) | `room_members.player_name`, copied into `games.game_state` | Shown to the room | Everyone in the room | Forever | Leaving the room deletes the member row, but not the copy in game state |
| Room name (free text) | `rooms.name` | Shown in the lobby, in emails and to agents in the room | Room members | Forever | Nothing (no room deletion route) |
| User ID (random UUID, pseudonymous) | Every table, `game_events.player_id`, `game_actions.actor_user_id` | Links a player to their seat and actions | Room members see IDs in room and game payloads | Forever | Cascades only if the user row is deleted |
| Agent invite key | `agent_seats.key_hash` (SHA-256), with an optional `label` and the seat's user ID | Lets one AI agent play one seat | Server only; the host sees the key once when creating it | Forever (revoked rows are kept) | Nothing (room deletion cascades, but there is no room deletion route) |
| Device transfer code | `device_transfer_codes.code_hash` (SHA-256) | Move a session to another device | Server only | Rows are never deleted (expire after 10 minutes) | Next code request for that user deletes unused ones |
| Rejoin request | `rejoin_requests` (room, seat, SHA-256 of the asking browser's secret, status, who answered) | Let a player who lost their token back into their seat once another player approves | Server only; approvers see the seat name | Rows are never deleted (expire after 10 minutes) | Cascades with the room or seat |
| Game history | `game_events`, `game_actions.request_json`/`result_json` | Game log, idempotent retries | Room members (events) | Forever | Nothing |
| Push subscription (turn alerts) | `push_subscriptions`: the browser's push endpoint URL and its encryption keys, per user ID | Send "your turn" alerts to devices the player turned them on for | Server only | Until the player turns alerts off, the push service reports the device gone, or the player adds a sixth device (oldest dropped) | Turn off alerts; 404/410 from the push service |
| Game-on-screen presence | In memory only: user ID to visible socket IDs | Skip turn alerts for players already looking at the game | Server only | While the page is open and visible | Page hidden, socket disconnect, process restart |
| Rate-limit keys (IP, user ID, email sender and recipient) | In memory only | Abuse protection, including per-recipient email limits | Server only | Window length (15 to 60 minutes) | Process restart or window expiry |

## Logs

| Log | Contents | Personal data? | Where / readable by | Retention |
| --- | --- | --- | --- | --- |
| `[game_action]` audit line (`backend/audit.js`) | game, room, `actorUserId`, action type, versions | Pseudonymous user ID: a per-user activity trail | journald on the M60e (`journalctl -u mortgage-backend`) | journald default (unbounded until disk cap) |
| Email send errors (`routes/auth.js`, `routes/rooms.js`) | `err.message` only; the mailer reports the provider's HTTP status, never its response body | No | journald | journald default |
| MCP errors (`mcp/server.js`) | Error and stack for failed agent requests | No request bodies or tokens | journald | journald default |
| OTP console log (`routes/auth.js:85`) | Email and code | Yes | Dev only: needs `LOG_OTPS=true` and is forced off when `isProduction()` | n/a in production |
| nginx access log | Client IP (from `CF-Connecting-IP`), path, user agent | IP address | M60e `/var/log/nginx` | Not verified (blind spot) |

## Client-side storage

| Key | Holds | Lifetime | Cleared on sign-out? |
| --- | --- | --- | --- |
| `localStorage.auth_token` | JWT for the current player (30 days in today's production config) | Until sign-out or expiry | Yes |
| `localStorage.mortgage_hotseat_resume_rooms` | Hotseat rooms and their players' tokens, so a shared device can resume | Until the hotseat game is cleared | No |
| `sessionStorage.saved_tokens_refreshed` | Flag (`1`) so saved hotseat tokens are swapped for new-secret ones once per tab | Browser tab | Yes |
| `sessionStorage.hotseat_tokens` | Tokens for each hotseat seat | Browser tab | Yes |
| Service worker (`/sw.js`) and its push subscription | No data; it only shows alerts and opens the game when one is tapped. Caches nothing. | Until the site's data is cleared | Turning alerts off unsubscribes |

The Home Screen icon on iPhone has its own storage. It is signed in once with a one-time device transfer code carried in the `home-screen.html?code=` address, which works once and expires after 10 minutes.

## Third parties

| Service | Receives | Why | Self-hostable? |
| --- | --- | --- | --- |
| Cloudflare (proxy, tunnel) | All traffic, including client IPs, tokens in headers and request bodies | TLS, DDoS protection, tunnel to the M60e | Not without exposing the home IP |
| Resend | Recipient email, subject, the code or room list | Sends OTP, invite and forgot-code email | Yes (UseSend was self-hosted before the M60e move) |
| Browser push services (Apple, Google, Mozilla, Microsoft) | An encrypted alert ("Your turn", the room name and a game link) sent to the device's push endpoint, signed with our VAPID key. The service can't read the content; it sees the endpoint, timing and size. | Deliver turn alerts while the game isn't open | No: they are the only way to reach a locked phone |
| GitHub (`abdullahak/mortgage-backed-game`, public) | Source code only | Hosting | n/a |
| The AI provider behind each invited agent (whichever app the host pastes an invite into) | That seat's agent key, and the room's game state: player names, room name, cash, properties, game log. Never emails, room codes or other players' keys or tokens. | The host invited an agent | The host chooses the provider, not us |

No analytics, error-reporting, font or CDN scripts are loaded; the only external link is a plain
footer link to claude.ai.

## Usage and error telemetry

None. Errors only reach journald. Any future telemetry must follow
`~/Knowledge/skills/privacy-check/references/telemetry.md`: server-side daily counters with no
user IDs, IPs or free text, and scrubbed error fingerprints.

## Secrets

| Secret | Lives in | Rotate when |
| --- | --- | --- |
| `JWT_SECRET` | Production `backend/.env` only | On any leak. Move the old value to `JWT_SECRET_PREVIOUS` so players are swapped onto the new secret without signing out, then remove it after a week or two (see `SETUP.md`) |
| Email API key (`USESEND_API_KEY`) | Production `backend/.env` only | On any leak |
| Push signing key (`VAPID_PRIVATE_KEY`) | Production `backend/.env` only | On any leak (rotating it drops every subscription; players turn alerts on again) |

## Open findings

Not kept in this public repository. Unfixed findings and secret rotation status live in the
maintainer's private register until they're fixed, so this file never advertises an open hole.

## Agents (MCP)

`/api/mcp` lets an AI agent the host invited play one seat. The host creates one invite per agent
in the waiting room; its agent key is the agent's only credential (no player JWT), works for that
seat only, is stored hashed and can be revoked. Agents see the same room state any member sees,
minus the room code. Server instructions tell agents
that player and room names are data, not instructions; the server clips names and strips control
characters. `testDice` is stripped from agent actions outside tests, and browser `Origin`s other
than the site's own are rejected.

## Development and test tooling

The `verify-mortgage` skill (`.agents/skills/verify-mortgage/`) plays whole games against a disposable dev backend with its own SQLite file under `/mnt/ssd/dev-data/mortgage-backed/verify/`. It never touches production ports, data or users. Every player in those games is made up. With `--email`, login and invite codes go through Resend to the maintainer's own AgentMail test inboxes, whose addresses and key are kept in `~/.config` on the machine running the tests, never in this repo. When the maintainer turns on AI test players (`--agents`), each one's prompts and screenshots of these made-up dev games go to Anthropic through the maintainer's Claude account. Evidence (screenshots, logs, reports) stays under `test-output/`, which is gitignored.

## Accepted risks

- Room state shown to an invited agent goes to the AI provider the host picked. Other players in
  that room share their names and moves with it, as they do with any human member.
- Cloudflare terminates TLS and sees all traffic. That's accepted, because it keeps the home IP
  private and absorbs attacks.
