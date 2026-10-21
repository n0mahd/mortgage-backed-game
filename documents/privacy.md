# Privacy and data inventory

What Mortgage Backed holds about people, where it goes and how long it stays. The `privacy-check`
skill (`~/Knowledge/skills/privacy-check`) keeps this file true: every merge to `main` that changes
personal data, logging, storage or third parties updates it in the same commit.

Last full check: 2026-10-20 at `74cc680` (`privacy-check` baseline, scanner plus manual review,
live probe of https://mortgage.abdlh.com).

## Principles

- Collect the minimum the game needs. Every new personal field is an explicit decision recorded here.
- No tracking of individuals. Usage and error insight is anonymous and aggregate.
- Nothing personal goes to a third party unless it's listed below with its reason.

## Personal data held

Production database: SQLite on the M60e at `/mnt/ssd/projects/mortgage-backed/backend/game.db`.

| Data | Where | Why | Who can see it | Retention | Deleted by |
| --- | --- | --- | --- | --- | --- |
| Email address | `users.email` (null for guests) | OTP sign-in, "forgot room code" email | Server only, never sent to other players | Forever | Nothing (no account deletion) |
| Email + login code | `otps` (`email`, `code` in plaintext) | 10-minute sign-in code | Server only | Until the next code is requested for that email; used rows are never deleted | `send-otp` for the same email |
| Player name (free text, chosen per room) | `room_members.player_name`, copied into `games.game_state` | Shown to the room | Everyone in the room | Forever | Leaving the room deletes the member row, but not the copy in game state |
| Room name (free text) | `rooms.name` | Shown in the lobby and in emails | Room members | Forever | Nothing (no room deletion route) |
| User ID (random UUID, pseudonymous) | Every table, `game_events.player_id`, `game_actions.actor_user_id` | Links a player to their seat and actions | Room members see IDs in room and game payloads | Forever | Cascades only if the user row is deleted |
| Device transfer code | `device_transfer_codes.code_hash` (SHA-256) | Move a session to another device | Server only | Rows are never deleted (expire after 10 minutes) | Next code request for that user deletes unused ones |
| Game history | `game_events`, `game_actions.request_json`/`result_json` | Game log, idempotent retries | Room members (events) | Forever | Nothing |
| Rate-limit keys (IP + email) | In memory only | Abuse protection | Server only | Window length (15 to 60 minutes) | Process restart or window expiry |

## Logs

| Log | Contents | Personal data? | Where / readable by | Retention |
| --- | --- | --- | --- | --- |
| `[game_action]` audit line (`backend/audit.js`) | game, room, `actorUserId`, action type, versions | Pseudonymous user ID: a per-user activity trail | journald on the M60e (`journalctl -u mortgage-backend`) | journald default (unbounded until disk cap) |
| Email send errors (`routes/auth.js:84`, `routes/rooms.js:242,252`) | Full `err`, which may echo the provider response | Possibly the recipient address | journald | journald default |
| OTP console log (`routes/auth.js:85`) | Email and code | Yes | Dev only: needs `LOG_OTPS=true` and is forced off when `isProduction()` | n/a in production |
| nginx access log | Client IP (from `CF-Connecting-IP`), path, user agent | IP address | M60e `/var/log/nginx` | Not verified (blind spot) |

## Client-side storage

| Key | Holds | Lifetime | Cleared on sign-out? |
| --- | --- | --- | --- |
| `localStorage.auth_token` | JWT for the current player (30 days in today's production config) | Until sign-out or expiry | Yes |
| `localStorage.mortgage_hotseat_resume_rooms` | Hotseat rooms and their players' tokens, so a shared device can resume | Until the hotseat game is cleared | No |
| `sessionStorage.hotseat_tokens` | Tokens for each hotseat seat | Browser tab | Yes |

## Third parties

| Service | Receives | Why | Self-hostable? |
| --- | --- | --- | --- |
| Cloudflare (proxy, tunnel) | All traffic, including client IPs, tokens in headers and request bodies | TLS, DDoS protection, tunnel to the M60e | Not without exposing the home IP |
| Resend | Recipient email, subject, the code or room list | Sends OTP, invite and forgot-code email | Yes (UseSend was self-hosted before the M60e move) |
| GitHub (`n0mahd/mortgage-backed-game`, public) | Source code only | Hosting | n/a |

No analytics, error-reporting, font or CDN scripts are loaded; the only external link is a plain
footer link to claude.ai.

## Usage and error telemetry

None. Errors only reach journald. Any future telemetry must follow
`~/Knowledge/skills/privacy-check/references/telemetry.md`: server-side daily counters with no
user IDs, IPs or free text, and scrubbed error fingerprints.

## Secrets

| Secret | Lives in | Rotate when |
| --- | --- | --- |
| `JWT_SECRET` | Production `backend/.env` only | On any leak (rotation logs everyone out; guests rejoin by room code) |
| Email API key (`USESEND_API_KEY`) | Production `backend/.env` only | On any leak |

## Open findings

Not kept in this public repository. Unfixed findings and secret rotation status live in the
maintainer's private register until they're fixed, so this file never advertises an open hole.

## Accepted risks

- Cloudflare terminates TLS and sees all traffic. That's accepted, because it keeps the home IP
  private and absorbs attacks.
