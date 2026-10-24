# Accounts and game management (decision record, 2026-10-23)

Players can create an account (username and password) so they can sign in on any device, see and
manage their past games, and take over host rights. Hosts can hand each player a personal link back
to their seat, give an agent a fresh key for its existing seat, and transfer host rights.

## Decisions

- **Accounts are users with a password.** A user is an account when it has an email (existing email
  code sign-in) or a username and password. `is_anonymous = 0` for both. Guests stay possible.
- **Upgrading keeps seats.** A guest who registers while signed in keeps the same user id, so every
  seat they hold stays theirs. Nobody re-joins anything.
- **Passwords** are hashed with Node's `crypto.scrypt` (random 16-byte salt, stored as
  `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`), compared with `timingSafeEqual`. 8–200 characters.
  No new dependency.
- **Usernames**: 3–24 characters, letters, digits, `_`, `.`, `-`; unique ignoring case
  (`username_key` = lower case).
- **Archive is per user.** Archiving hides a game from that user's list only; it does not end it.
- **Seat links** belong to one seat (room member). Creating a new link for a seat revokes its older
  links. A link lasts 7 days. Redeeming a link for a guest seat signs that browser in as the seat
  (single use). A seat owned by an account is never handed out by link: the link sends them to sign
  in, then into the game, and stays usable.
- **Agent re-invite** revokes the agent's old key and issues a new one for the same seat (same user
  id, same name), at any time before the game is completed. The prompt tells the agent it already
  has a seat.
- **Host transfer** is an offer to one non-agent player; it needs that player to accept, and they
  must have an account (email or password) to accept. One pending offer per room. Host identity is
  `rooms.host_id` only (passed to `applyAction` as `options.hostId`), so a transfer changes no game
  state.
- **Leaving** a room is only possible while it is waiting. Leaving a started game would orphan a
  player in the game state.

## Schema (migration `008_accounts_and_game_management`)

- `users`: add `username TEXT`, `username_key TEXT` (unique index where not null),
  `password_hash TEXT`, `password_updated_at TEXT`.
- `room_user_prefs (room_id, user_id, archived_at, PRIMARY KEY (room_id, user_id))`, both FKs
  `ON DELETE CASCADE`.
- `seat_links (id PK, room_id FK, member_id FK room_members ON DELETE CASCADE, token_hash UNIQUE,
  created_by FK users, expires_at, used_at, revoked_at, created_at)`.
- `host_transfers (id PK, room_id FK, from_user_id FK, to_user_id FK, status
  'pending'|'accepted'|'declined'|'cancelled', created_at, decided_at)`.

## API

All JSON. Errors are `{ error }` with a 4xx status (`RoomError`).

### Accounts (`routes/auth.js`)

- `GET /api/auth/me` → `{ id, email, username, is_anonymous, has_password }`.
- `POST /api/auth/register { username, password }` → `{ token, user }`. With a valid Bearer token
  of a guest: upgrades that user in place. With a Bearer token of an account: 400 (use
  `/auth/password`). Without a token: a new account. 409 `Username taken`.
- `POST /api/auth/login { login, password }` → `{ token, user }`. `login` is a username or an email.
  401 `Wrong username or password` for every failure. Limited per IP and login (10 per 15 min).
- `POST /api/auth/password { username?, password, current_password? }` (signed in) → `{ user }`.
  Sets or changes the password, and the username if given. `current_password` is required when the
  user already has one. Lets an email account add a password.

`user` objects everywhere have the `/auth/me` shape.

### My games (`routes/rooms.js`)

- `GET /api/rooms/mine` → each room as today plus `archived` (bool), `is_host` (bool),
  `my_member_id` (or null for a watching host).
- `POST /api/rooms/:id/archive`, `DELETE /api/rooms/:id/archive` (anyone who can view the room) →
  `{ ok: true }`.

### Host tools (host only, `403` otherwise)

- `GET /api/rooms/:id/manage` → `{ room, members, agent_seats, host_transfer }` where each member is
  `{ id, player_name, user_id, is_agent, is_host, has_account, agent_seat_id }` and `host_transfer`
  is the pending offer `{ id, to_member_id, to_player_name, created_at }` or null.
- `POST /api/rooms/:id/members/:memberId/link` → `{ url, expires_at }` for a non-agent member. `url`
  is `${PUBLIC_APP_URL}/index.html?seat=<token>`.
- `POST /api/rooms/:id/agent-seats/:seatId/reissue` → same shape as creating an agent invite
  (`{ seat, key, mcp_url, prompt }`). 400 once the game is completed.
- `POST /api/rooms/:id/host-transfer { member_id }` → `{ host_transfer }`. Target must be a non-agent
  member other than the host. Replaces any pending offer.
- `DELETE /api/rooms/:id/host-transfer` → `{ ok: true }` (cancel).

### Seat links and host offers (the player's side)

- `POST /api/seat-links/redeem { token }` (no sign-in needed; rate limited) →
  - guest seat: `{ token, user, room }` (link now used);
  - account seat, caller already signed in as it: `{ room }`;
  - account seat otherwise: `{ requires_sign_in: true, room: { id, name } }`.
  400 `This link has expired or was replaced` for unknown, used, revoked or expired links.
- `GET /api/host-transfers/mine` → `[{ id, room_id, room_name, from_player_name, created_at }]`.
- `POST /api/host-transfers/:id/accept` → `{ room }`; 403 with `code: 'account_required'` if the
  caller is a guest. `POST /api/host-transfers/:id/decline` → `{ ok: true }`.
- Socket: `room:member_change` is emitted to the room after a transfer is accepted (the room's
  `host_id` changed), and `room:host_transfer` `{ roomId }` when an offer is made, cancelled or
  answered.

## Screens

- `auth.html`: sign in with username or email and password (default), create an account, or get an
  email code (kept). Honors `?next=<same-origin path>` after sign-in.
- `lobby.html` (My games): Active and Archived lists, Archive/Unarchive per game, pending host
  offers at the top (Accept, Decline; a guest is asked to create an account first), a banner
  inviting guests to create an account, and for hosts a Manage sheet: per player "Copy link", per
  agent "New key", "Make host", and cancel a pending offer. The page and an open Manage sheet stay
  live: room events (`room:member_change`, `room:status_change`, `room:host_transfer`) and every
  socket rejoin resync them, and so does the page being shown again, the network coming back and a
  15-second poll, which is what catches per-user changes that emit nothing (archiving on another
  device, a game made or joined elsewhere). Signing in as someone else in another tab reloads it.
- `index.html?seat=<token>`: redeems a seat link.
- Waiting room and the game's host panel link to Manage players (`lobby.html?manage=<roomId>`).

## Implementation notes (backend)

Choices the spec left open, as built:

- Code: `services/accounts.js`, `services/roomManagement.js`, `services/seatLinks.js`,
  `services/hostTransfers.js`, `reissueAgentSeat` in `services/agentSeats.js`; routes in
  `routes/auth.js`, `routes/rooms.js`, `routes/seatLinks.js` and `routes/hostTransfers.js`.
- Error bodies may carry a machine-readable `code` next to `error` (a `RoomError` built with a
  third argument); today only `account_required`.
- `POST /auth/password`: a wrong or missing `current_password` is a 400 `Current password is wrong`
  (not 401, which clients treat as signed out). A guest may use it too if they give a username,
  which makes them an account like `/auth/register`. Username clash is a 409 `Username taken`.
- `POST /auth/anonymous` also answers with the `/auth/me` user shape.
- Agent reissue answers 201 like creating an invite. A pending (not yet joined) invite can be
  reissued too; its prompt is the normal invite text. A joined seat's prompt says it already holds
  the seat and should call `join_game` with the new key, then `wait_for_turn`.
- Seat link redeem is limited to 20 per IP per 15 minutes (always on). Links can be made for any
  non-agent member, the host's own seat included, in any room status.
- Host offers may go to guests (they get `account_required` when accepting). Accepting lapses the
  offer (400 `This offer is no longer valid`) if the host changed or the player left meanwhile.
