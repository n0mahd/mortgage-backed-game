<!-- Reviewer report from the 2026-11-23 ux-review run. Screenshot paths point to that session's scratch folder and are not kept. -->

# UX audit: everything outside the game board

Worktree: `.claude/worktrees/turn-alerts-prompt` (branch feature/turn-alerts-prompt). Screenshots: `/tmp/claude-1000/-home-abdullah-Projects-mortgage-backed-game/197a046c-4009-40c2-b65a-78c7ac65b73c/scratchpad/audit-outside/shots/` (shortened to `shots/` below). Phone screenshots are 390x844 and desktop ones 1280x800. I drove signed-out, guest, username-account host and non-host, a hotseat game, a rejoin request and error states against my own dev servers on ports 3041 and 3141, which are now stopped. Production was not touched.

## 1. Top 5 problems (ranked by harm)

1. **Starting a "Play on one phone" game silently signs out the guest or account on this browser.** `hotseat.js:198-215` calls `setToken()` with fresh guest tokens and never saves the previous `auth_token`. In my test a guest in "Sunday Night Game" started a hotseat game. Their token was replaced (I logged `guest token kept after hotseat? false`), and My games then showed only "Ann's Local Game". The guest's real seat is gone from this browser with no warning. An account user gets signed out the same way. Screenshots: `shots/29-lobby-guest-phone.png` (before) and `shots/51-lobby-after-hotseat-phone.png` (after). This is a data-loss bug presented as a menu choice.
2. **A returning player can't find their games from the home page, and a new player has to create an account to host.** `index.html` never checks for a token. A signed-in guest or account lands on the marketing hero, which offers "Already have an account? Sign in to see your games" and no link to My games (`shots/32-home-as-guest-phone.png`). Meanwhile "Create New Game" goes to `auth.html?mode=register` (index.html:75, 125), so the first thing a new host sees is a username-and-password form (`shots/06-auth-register-phone.png`). The server lets guests create rooms: the guest lobby has "Create New Game", and hotseat creates rooms as guests. On the same page, the deed card says "Accounts for guests: None" and the steps start with "Create an account". The most important first-run path has an unnecessary wall, and the most important return path has none of the right buttons.
3. **The waiting room puts host settings and invite tools above the fold and buries "what happens next".** On a phone, the host scrolls through the code card, Players, Start, Manage players, a House rules panel (two 3-line paragraphs), Invite AI agents (another paragraph and a status sentence) and Invite by email, then an "Activity" log (`shots/20-waiting-host-phone.png`, desktop `shots/25-waiting-host-desktop.png`). A non-host sees no "Waiting for Alice to start" line at all. The only status is an Activity log that says "Waiting for players to join…" while three players are listed (`shots/28-waiting-nonhost-phone.png`). The app bar also says "Guest" for a signed-in username account (bug 5a).
4. **The "Know when it's your turn" card takes two taps and repeats itself.** Tapping "Turn on alerts" on the card (game.html:65-69) opens a sheet whose steps say "1 Tap Turn on alerts below, 2 Tap Allow", with another "Turn on alerts" button and a hint that restates the card ("Get a buzz when it's your turn and the game isn't open."). Screenshots: `shots/40-game-topbar-rejoin-phone.png`, `shots/42-turn-alerts-modal-phone.png` and `shots/44-turn-alerts-from-card-phone.png`. In the `off` state the card's tap is already a user gesture, so it can call `TurnNotifications.enable()` directly. Only `needs-home-screen` and `denied` need the sheet. On desktop the card is a full-width banner above the turn ticket (`shots/45-game-desktop.png`).
5. **Recovery screens (rejoin, full room, bad links) are muddled and sometimes silent.**
   - Opening a started room by code shows "Join game / Pick the name other players will see", then "Continue as an existing player", then a big "Continue Hotseat" button for a game that isn't a hotseat, then an empty card holding only a read-only room code (`shots/34-join-started-room-phone.png`).
   - Picking an account player gives "This player signed in with email…" even when they use a username and password (`shots/35-rejoin-waiting-phone.png`).
   - A bad `?transfer=` link shows nothing at all, because the error renders inside the closed "Other ways back in" `<details>` (`shots/11-home-bad-transfer.png`).
   - A "not a player" game page offers "Try again", which can never work, and shows the raw "Not a room member" error (`shots/46-game-not-a-player-phone.png`).

## 2. Text changes

| Where | Current | Verdict | Replacement |
|---|---|---|---|
| index.html:30-32 | "This browser isn't signed in to that game yet. On the device you've been playing on, tap "Play on another device" and enter its code under "Other ways back in". You can also enter your room code, or sign in if you have an account." | shorten (4 instructions in one blob, and the code input sits right below) | "This browser isn't signed in to that game. Enter the code from **Play on another device** below, or [sign in]." |
| index.html:49 | "Moving from another phone or browser? In your game, tap "Play on another device" to get a code." | shorten | "Code from **Play on another device**" (as the input's visible label) |
| index.html:44 summary | "Other ways back in" | reword | "Lost access to a game?" |
| index.html:62 | "We'll email you the codes for every game you're in." | keep-but-reword | "We'll email the room codes for your games." |
| index.html:64 | "Sent. Check your email for your room codes." | shorten | "Sent. Check your email." |
| index.html:78 | "Already have an account? Sign in to see your games." | replace by state | Signed out: "Have an account? [Sign in]". Signed in: replace the whole line with a "My games" button (see §4) |
| index.html:85 | "Classic Monopoly, plus the financial engineering that made the crisis possible." | cut (restates the h2 and the hero) | — |
| index.html:99 | "Interest per turn 5%" | reword (the host sets it) | "Interest per turn: host's call" |
| index.html:100 | "Collateral: Your streets" | fix, false: no property is pledged (game-rules.md:328) | "Borrow up to: 90% of what you own" |
| index.html:101 | "Maximum leverage ∞" | fix, false: there's a 90% loan-to-value cap and loans have terms | cut the row, or "Loan terms: 5–30 turns" |
| index.html:110 | "Accounts for guests: None" | keep only if fix §4.1 lands; otherwise it's false for hosts | — |
| index.html:119 | "Create an account. A username and password, or just your email." | cut once guests can host | "Name your room." becomes step 1 |
| index.html:122 | "Watch it collapse. Or don't. Either way it beats 2008." | keep (marketing voice, allowed) | — |
| index.html:125 | second "Create New Game" CTA | keep | — |
| auth.html:33 | "Use your username or email and your password." | cut (the two labels say exactly this) | — |
| auth.html:35-38 | guest note "...Signing in to another account leaves those games here; create an account instead to keep them." | keep-but-reword (prevents a real loss) | "You're a guest here. Signing in switches accounts; your guest games stay on this device. [Create an account] to keep them." |
| auth.html:61 | "Pick a username and password to sign in on any device and keep your games." | shorten | "Sign in on any device and keep your games." |
| auth.html:63 | "Your current games stay with you." | merge into the line above for guests | "Your guest games move to this account." |
| auth.html:67 / 72 | "3 to 24 letters, numbers, dots, dashes or underscores." / "At least 8 characters." | keep (prevents errors); move the first one into the error only | — |
| auth.html:93 | "Enter your email and we'll send a 6-digit code. No password needed." | shorten | "We'll email you a 6-digit code." |
| auth.html:117 / auth.js:138 | "Please enter the 6-digit code" | drop "Please" | "Enter the 6-digit code." |
| lobby.html:34 | "Pick up where you left off, or start a new room for your friends." | cut (the title and the Create button say it) | — |
| lobby.html:38-41 | guest banner "You're playing as a guest, so your games live only on this device. Create an account to keep them across devices." | keep-but-shorten (prevents loss) | "Guest games live only on this device. [Create an account] to keep them." |
| lobby.html:44-45 | "Signed in as alice" | cut: the app bar already shows the name (duplicate). Keep the row only to hold "Set password" | — |
| lobby.html:71 | "Only hidden from your list" | reword | "Hidden from your list; still playable" or cut |
| lobby.js:135 | "Alice offered to make you host. You can start, pause and manage the game once you accept." | shorten | "Alice offered you host." |
| lobby.js:199 | "No games yet. Create one and share the room code with friends." | keep | — |
| lobby.js:275 | "Created 3 days ago" on every card | cut, or replace with something useful ("Your turn", "Waiting for 1 more") | — |
| lobby.js:278 | "Open" button | cut (the whole card is tappable, onRoomListClick) | — |
| lobby.html:87 | "Max players (2–8)" | reword with a stepper | "Players" (stepper 2–8) |
| lobby.html:92 | "Just watch: only AI agents (and people you invite) play" | move below the name field, shorten | "I'll watch, not play" |
| lobby.html:96 | placeholder "Your in-game name" under the label "Your player name" | cut (duplicate) | placeholder empty, or "Alice" |
| lobby.html:109 | "Then you can sign in with your username or email and this password." | keep-but-shorten | "Sign in with this password as well as email codes." |
| lobby.js:109 toast | "Password saved. You can sign in with it on any device." | shorten | "Password saved." |
| lobby.js:368/373/390 | `alert('Please fill in all fields')`, "Max players must be between 2 and 8", "Error creating game: …" | move to an inline `.error-message` in the sheet | "Name the game and yourself." |
| lobby.html:154 | "The old key no longer works. Paste this into the agent's chat: it holds the new key, shown only now, and tells the agent it already has its seat." | shorten | "The old key is dead. Paste this into the agent's chat. Shown only once." |
| manage-room.js:177-182 | "Link for Bob copied. Send it only to them. It lasts 7 days, and a new link for Bob replaces it." | shorten | "Link for Bob copied. Send it only to Bob; it works for 7 days." |
| manage-room.js:209 | confirm "Offer host to Bob?\n\nThey must accept, and they need an account (a username and password, or email) to do it. You stay host until they accept." | shorten | "Offer host to Bob? They accept from My games (needs an account)." |
| manage-room.js:109 | "Host offer sent to Bob. You stay host until they accept." | keep | — |
| manage-room.js:216 | "Offer sent. Bob will see it in My games." | merge: the banner above already says it | cut the status; the banner is enough |
| waiting.html:34 | "Pick the name other players will see." | cut (the label "Your player name" says it). Also wrong for a rejoin | Subtitle: the room name ("Sunday Night Game · hosted by Alice") |
| waiting.html:40 | read-only "Room code" field | cut / move: fold into the subtitle | — |
| waiting.html:64 | "Friends join with this code" | keep | — |
| waiting.html:84 | "You need at least 2 players to start." | cut: the disabled button already reads "Need at least 2 players" (waiting.js:288) | — |
| waiting.html:85 | "You're watching, not playing. Invite at least 2 agents, then start." | keep | — |
| waiting.html:89-99 | House rules: "Interest per turn on every loan. Players pick how many turns (5 to 30, in steps of 5) when they borrow, and whether autopay pays the loan down or covers the interest only." + "What everyone collects for passing GO, $0 to $1,000. Players can change either rule during the game if everyone agrees (Market › Rule proposals)." | cut both; collapse the panel by default | One line under the heading: "Can be changed mid-game by unanimous vote." The ranges go in the inputs (min/max) and in the error |
| waiting.html:105 | "Each invite seats one agent and controls only that seat. Give each agent its own name so players can tell them apart." | cut (the placeholder "Agent name (optional)" covers naming) | — |
| agent-invites.js:45 | "1 invited agent hasn't joined yet. Invites stop working once the game starts." | shorten; the row already says "Waiting for the agent to join" (duplicate) | Show only near Start: "1 agent hasn't joined. Starting now drops its seat." |
| agent-invites.js:11 | "Waiting for the agent to join" | shorten | "Not joined" (matches the Manage sheet's badge) |
| waiting.html:125-127, waiting.js:230 | "Activity" / "Waiting for players to join…" / "[10:28:01 PM] Player list updated" | cut the whole section | Replace with a status line (see §4) |
| waiting.html:139 | "Do this in your Claude app." | keep | — |
| waiting.html:141-142 | "…First time only." ×2 | merge | Heading "First time only" over steps 1–2 |
| waiting.html:148 | "Paste this into that chat. It holds the agent's key, shown only now: anyone with it can play that seat." | keep-but-shorten (security-relevant) | "Paste into that chat. Shown only once; anyone with it plays this seat." |
| waiting.js:263 | "Joined just now" on every row | cut (nobody needs join times in a lobby) | — |
| waiting.js:34 | app bar shows `currentUser.email \|\| 'Guest'` | fix (bug) | username, else email, else player name |
| room-resume.js:197-198 | "Continue this saved hotseat game" / "Use local hotseat on this device, or continue online as one player." | shorten | "Saved game on this phone" / buttons "Everyone on this phone" and "Just me: [name]" |
| room-resume.js:215-216 | "Continue as an existing player" / "This room is already full. Pick who you are; a player in the game approves it on their screen." | reword | "Already in this game? Pick your name. Another player approves it." |
| room-resume.js:243 | "Continue Hotseat" (shown for online rooms too) | fix | Show only when every member is a guest from one device; label it "Everyone on this phone" |
| room-resume.js:252 | "Continue online as:" | cut once the title says "Pick your name" | — |
| room-resume.js:380 | "Keep this page open. It continues as soon as they approve." | shorten | "Keep this page open." |
| rejoinRequests.js:66 (server) | "This player signed in with email. Sign in with that email to continue." | fix (wrong for password accounts) | "Bob has an account. [Sign in] to continue." |
| rejoin-prompts.js:440-444 | "Someone on another device wants to continue as Gil." + "Approve only if Gil just asked you. Approving signs that device in as Gil." | merge | "A device wants to play as Gil. Approve only if Gil just asked you." |
| hotseat.html:29 | "Add 2 to 6 players and pass the phone around. A hand-off screen hides each player's view between turns." | shorten | "Pass the phone between turns." |
| hotseat.html:46 | "Up to 6 players" | cut (duplicate of line 29; the button disables at 6) | — |
| hotseat.html:36/40, hotseat.js:158 | placeholder "Player 1 name" under the label "Player 1" | cut the placeholder | — |
| hotseat.html:51 | "Start Local Game" | reword | "Start game" |
| hotseat.js:219 | "Setup failed: " + raw error | reword | "Couldn't start the game. Try again." |
| home-screen.html:34 | "A Mortgage Backed icon next to your apps that opens the game full screen and buzzes you on your turn. It's a shortcut to this site, not an App Store app." | shorten (the design system requires the not-an-app point; keep it) | "An icon that opens the game full screen and can alert you on your turn. Nothing to download." |
| home-screen.html:44 | "The square with an arrow in Safari's toolbar." | keep (the glyph alone is ambiguous) | — |
| home-screen.html:60 | "Within 10 minutes. It opens your game, already signed in." | merge with the footnote | "Do this within 10 minutes." |
| home-screen.html:74 | "This page's address signs the new icon in as you. It works once and expires in 10 minutes, so add it from this phone only." | shorten (keep: security) | "This page signs the icon in as you. Don't share it." |
| game.html:66 | "Alerts when the app is running in the background" | reword (unclear; it's actually when the game isn't open) | "Get an alert when the game isn't open." |
| device-alerts.js:34 | "Get a buzz when it's your turn and the game isn't open." | cut when opened from the card (duplicate) | — |
| device-alerts.js:51-52 | steps "Tap Turn on alerts below" / "Tap Allow — When your browser asks to send notifications." | cut (restates the button) | Hint: "Your browser will ask; tap Allow." |
| device-alerts.js:72 | note "It's a shortcut to the site, not an App Store app, so there's nothing to download." | keep (design-system rule), shorten | "Nothing to download." |
| device-alerts.js:82 | "Alerts are on for this device. You'll get one when it's your turn and the game isn't open." | shorten | "Alerts are on for this device." |
| game.html:453 | "On the other phone or browser, open this link. Or go to the home page, tap "Other ways back in", and enter the code." | shorten | "Open this link on the other device, or enter the code on the home page." |
| device-alerts.js:24 | "Works once, for the next 10 minutes. Anyone with this code can play as you, so only share it with yourself." | keep-but-reword (security) | "Works once, for 10 minutes. Anyone with it can play as you." |
| game.js:91 | "Couldn't load this game: Not a room member" + Try again | reword, drop the retry for 403 | "You're not in this game." + [Your games] |
| waiting.js:23,170,301,347,352,370,396 | `alert()` calls ("No room ID provided", "Error loading room: …", "Code: … Please copy manually.", "Error starting game: …") | move to inline errors or a toast | — |
| waiting.js:379 | confirm "Are you sure you want to leave this room?" | reword | "Leave Sunday Night Game? Your seat opens for someone else." |
| seat-link.js:138 / server | "This link has expired or was replaced" | keep-but-extend | "…Ask the host for a new link." |

## 3. Duplication (same fact twice on one screen)

- **Lobby: who's signed in.** The app bar shows "alice4xt…" and the body shows "Signed in as alice4xt98" (`shots/22`). Keep the app bar. Move Set password into an account menu behind the name.
- **Lobby: room open.** The card is tappable and also has an "Open" button. Keep the card tap and drop "Open".
- **Waiting room: start rule.** "You need at least 2 players to start" appears both as help text and as the disabled button label. Keep the button label.
- **Waiting room: player count.** "3/6 players" in the header plus the Players list. Keep the header and drop "Joined just now" from the rows.
- **Waiting room: agent status.** The status line "1 invited agent hasn't joined yet" plus the row "Waiting for the agent to join". Keep the row.
- **Waiting room: agents are missing from Players.** An invited agent appears only in the agent panel, not in Players. Show pending agents in Players with a "Not joined" badge and drop the separate list.
- **Waiting room: house rule ranges.** Ranges are given in prose and again in input min/max. Keep the inputs.
- **Hotseat: player limit.** "2 to 6 players" in the intro plus "Up to 6 players" by the button. Keep neither; the button disables at 6.
- **Hotseat and Create game: labels.** Each label is repeated as a placeholder ("Player 1" / "Player 1 name", "Your player name" / "Your in-game name"). Keep the label.
- **Turn alerts.** The card says "Know when it's your turn", the sheet hint says "Get a buzz when it's your turn…", the step says "Tap Turn on alerts below" and the button says "Turn on alerts". Keep the card and one tap.
- **Agent invite modal.** "First time only." appears twice. Use one subheading.
- **Rejoin prompt.** "Someone on another device wants to continue as Gil" plus "Approving signs that device in as Gil". Merge into one sentence.
- **Home: account.** "Create an account" is step 1 and "Accounts for guests: None" is a deed row, and they contradict each other.
- **Join game screen.** The room code appears in the URL, in a read-only field and in the subtitle context, but the room name is never shown. Show the room name instead.

## 4. Structural and visual issues, with fixes

1. **Home page ignores who you are.** On load, call `getCurrentUser()` (already in api.js). If signed in, swap the hero buttons for **My games** (primary) and **New game**, and hide "Already have an account?". Let "Create New Game" go to `lobby.html` for a signed-in user. For a signed-out user, create a guest on the spot and open the Create sheet; the guest banner in My games already invites them to make an account. This removes registration from the first-run path, which is the biggest friction in the app.
2. **Hotseat must not reuse `auth_token`.** Keep hotseat tokens only in `hotseat_tokens` and the resume store, and have `apiFetch` pick the hotseat token when in hotseat mode. Alternatively, save the previous `auth_token` and restore it when leaving the hotseat game. Until then, show a confirm when a token already exists ("This signs this browser out of your games").
3. **Waiting room order and grouping.** Proposed order:
   1. Room name and status line: "Waiting for Alice to start" for non-hosts, "Ready to start" or "Need 1 more player" for hosts.
   2. Code card with Share and Copy.
   3. Players, with pending agents included.
   4. Start (sticky at the bottom on phones).
   5. One collapsible **Settings** panel (house rules).
   6. One **Invite** panel with tabs or rows: Email, AI agent.

   Drop Activity entirely. Move "Manage players" into the app bar or the Players header ("Manage") instead of a lone link between Start and settings.
4. **Join / rejoin screen is two screens in one.** Split by state:
   - **Open room:** title "Join Sunday Night Game", one name field, a Join button.
   - **Full or started room:** title "Rejoin Sunday Night Game", the list of names, and "Everyone on this phone" only for all-guest same-device rooms.

   Remove the read-only code card in both.
5. **Lobby cards.** Make the whole card the open target, show a status that matters ("Your turn", "Waiting: 3/6", "Finished"), and move Archive and Manage into a "⋯" menu. Today every card has three equal-weight buttons, so a list of five games is fifteen buttons.
6. **Create game sheet.** Field order: Game name, Your name, Players (stepper), then the "I'll watch, not play" toggle last. Errors go inline, not in `alert()`.
7. **Destructive "Log out" for guests.** The guest lobby shows "Log out" next to "Sign in" with no confirm (`handleLogout`). For a guest, logging out loses every game permanently. Hide it for guests, or confirm with "You'll lose access to your guest games unless you create an account."
8. **Error placement.** `showPageLoadError` prepends a red box above the app bar while the "Loading your games…" spinner keeps spinning underneath (`shots/48-lobby-load-error-phone.png`). Replace the content area instead, under the app bar. On the game page's load error, hide the move-device and alerts icons and the tab bar, which stay active on an empty page (`shots/46`).
9. **Native dialogs.** `alert()`, `confirm()` and `prompt()` (agent rename) appear throughout the waiting room, lobby and Manage sheet. They look broken next to the styled sheets. Use the existing modal and `.error-message` patterns.
10. **Manage sheet row layout is inconsistent.** Agent rows put "New key" on the right; human rows wrap "Copy link" and "Make host" below (`shots/23`). Use one layout (actions right, or one "⋯" per row). "Copy link" is unclear as a label. Use "Seat link" with a one-line explainer shown once at the top of the sheet ("Seat link: sends a player straight back into their seat.").

## 5. Suspected bugs

1. **Hotseat clobbers the signed-in token** (hotseat.js:198-215). Confirmed: the guest's online game disappeared from My games (`shots/51`).
2. **Waiting room app bar shows "Guest" for username accounts** (waiting.js:34, `currentUser.email || 'Guest'`; `shots/20`, `shots/28`). After a guest joins, it shows the player name (waiting.js:137), which is inconsistent.
3. **Bad or expired `?transfer=` link shows no error** (index.js:33-38 doesn't open `.resume-more`; `#transfer-error` is inside the closed `<details>`; `shots/11`). The `?signin=game` path opens it (index.js:27-28); the transfer path should too.
4. **Rejoin error names the wrong sign-in method:** "signed in with email" for any non-guest seat (backend/services/rejoinRequests.js:66; `shots/35`).
5. **"Continue Hotseat" appears for ordinary online rooms** (room-resume.js:217 always passes `onHotseat`). Tapping it requests "this whole game", which the server rejects unless every seat is a guest.
6. **Read-only "Room code" card stays when the join form is hidden**, leaving an orphan card (waiting.js:93-98 hides only the name group and button; `shots/34`, `shots/60`).
7. **Lobby load error leaves the spinner** "Loading your games…" running under the error, and puts the error above the app bar (`shots/48`).
8. **The "Manage players" link is hidden when the waiting room was opened by `?code=`** (manage-link.js reads only `?room=`). It also doesn't update after `joinAsGuest` replaces the URL.
9. **Landing page states false rules**: "Collateral: Your streets" and "Maximum leverage ∞" contradict the engine (`MAX_LOAN_TO_VALUE = 0.9` in debt.js:21; game-rules.md:328 says no property is pledged). This breaks the project's "rule documents stay true" rule in spirit.
10. **Hotseat Enter key**: `document.addEventListener('keypress')` (hotseat.js:228) starts the game on Enter from anywhere, including while focus is on "Add Player".
11. **Guest "Log out" has no confirm** and is irreversible for a guest (api.js:214).
12. **Not-a-player page offers "Try again"** for a 403 that can't succeed, and shows the raw server text "Not a room member" (game.js:91; `shots/46`).
