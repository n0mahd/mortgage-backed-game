# Design System: "Term Sheet"

The visual and interaction rules for every screen of Mortgage Backed Monopoly. The palette, voice, and
brand rationale come from `documents/brand-book.md`; this page covers how they become UI.

- Tokens: `src/css/tokens.css`. Load it before `src/css/style.css` on every page.
- Components: `src/css/style.css` (one stylesheet for all pages).
- Presentation helpers: `src/js/ui.js` (`formatMoney`, `playerInitials`, `renderDicePair`, `showToast`, `escapeHtml`, `copyText`).
- Specimen: `design-system.html` renders every component against real tokens.
- Turn alerts: `src/js/turn-notifications.js` (state and Web Push), `home-screen.html` with
  `src/js/home-screen.js` (Add to Home Screen handoff).

## Who it's for and what it must do

People play live with friends, mostly on phones, often while talking over each other. Every game screen
answers three questions in this order: whose turn is it, how much money do I have, and what can I do next.
The thing the game needs from you sits under your thumb.

## Concept

The interface is financial paper. Pages are cool banknote paper, money is engraved, and properties are
title deeds. One element is allowed to be bold: the **turn ticket**, a forest-green note with a guilloché
texture, a thin gold engraved frame, and your cash in large Besley numerals. Everything around it stays
quiet, native, and flat.

## Color

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#ECF1EC` | Page background |
| `--note` | `#FAFCF9` | Grouped surfaces, inputs, sheets' cards |
| `--ink` / `--ink-2` / `--ink-3` | `#12261C` / `#3F5247` / `#596A5F` | Text: primary, secondary, tertiary |
| `--rule` / `--rule-strong` | `#D3DDD5` / `#B9C7BD` | Row hairlines / input borders |
| `--forest` | `#1B4332` | Chrome: tab bar, turn ticket, invite code |
| `--emerald` | `#2D6A4F` | Primary action |
| `--mint-wash` | `#DCEFE2` | Secondary buttons, selected rows |
| `--gold` / `--gold-bright` / `--gold-wash` | `#86600A` / `#D4A017` / `#F6EDD3` | Premium only: monopolies, jail card, auctions, current step |
| `--gold-ink` / `--gold-press` | `#6B4D07` / `#BF9014` | Text on gold-wash surfaces / pressed gold buttons |
| `--on-dark` | `#FFFFFF` | Text on forest, emerald, danger and player-color fills |
| `--danger` / `--danger-wash` | `#B42318` / `#FBE7E4` | Bankruptcy, money owed, End Game |

Rules:
- Red means money is at risk. Never use it for decoration or for a neutral "cancel".
- Gold marks something valuable or time-sensitive. One gold element per view is the norm.
- Board property colors (`PROP_COLORS` in `board.js`) and player colors (`PLAYER_COLORS`) are game data,
  not brand colors. Show them as deed bands, swatches, and avatars only.
- The one outside color is Safari's own blue (`--safari-blue`, `#007AFF`), scoped to `.home-screen-steps`
  and used only on the Share and Add to Home Screen glyphs, so people recognise the controls they're
  looking for in Safari. Don't use it anywhere else.

## Type

- **Besley** (self-hosted variable font, OFL, `src/assets/fonts/`) for money, room codes, screen titles,
  and sheet titles. Use `font-variant-numeric: lining-nums proportional-nums`. **Never enable `tnum` on
  Besley**: its tabular zero is drawn at the wrong weight.
- **System UI** (`--font-ui`: SF Pro on iOS, Roboto on Android) for everything else, so the app reads as
  native. Tabular figures are fine here (log times, rent chips).
- Scale follows iOS text styles: caption 13, footnote 14, subhead 15, body 17, title3 20, title2 24,
  title1 32, display 44.
- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows. Room codes are the one
  letter-spaced element, because people read them aloud.

## Layout

- Mobile first: one column, `--page-max` 560px. At 900px and up the game becomes two columns (turn on the
  left, players on the right) and the tab bar becomes a segmented control under the app bar.
- Spacing is a 4pt grid (`--s1`…`--s10`). Page gutters are 16px.
- Respect safe areas: `viewport-fit=cover` plus `--safe-top`/`--safe-bottom` on fixed chrome.
- Corner radius encodes hierarchy: sheet 22 > group 14 > control 12 > deed 6; chips are pills.
- Shadows only on things that float above content (dock, sheets, toasts).

```
Game screen (phone)
┌──────────────────────────────┐
│ ‹  Room name     CODE  ⇄  🔔 │ app bar: back, room, code, devices,
│                              │ turn alerts (sticky, translucent)
├──────────────────────────────┤
│ ▓ Your turn            ⚀ ⚁  │ turn ticket: whose turn, dice,
│ ▓ $612        Net $1,632    │ your cash, 4-step rail
│ ▓ ━━━━ ──── ──── ────       │
│ You are on Vermont Ave       │ context: landing, warnings, card,
│ [auction / debt warning]     │ pause, auction
│ Moves  [Build] [IPO] [Debt]  │ optional moves grid
│ Players  (you, then others)  │ grouped rows, expand to details
│ Recent actions               │
│ Host controls (host only)    │ dashed, away from turn actions
├──────────────────────────────┤
│ [End Turn]  [ Roll Dice   ]  │ action dock (your turn only)
├──────────────────────────────┤
│ Game Market Recent ev. Board │ tab bar
└──────────────────────────────┘
```

## Components

**Buttons** (`.btn` plus a variant). Height 48 by default, 54 in the dock, 44 minimum for `.btn-sm`.
Press state scales to 0.97; there are no hover-only affordances.
- `.btn-primary` / `.btn-success`: the one action the screen wants. At most one per view, plus the dock.
- `.btn-secondary`: tinted mint, for alternatives (Start Auction, Decline, Cancel).
- `.btn-warning`: gold tint, for actions that cost money or pause play (Pay $50 Fine, Pause Game).
- `.btn-danger`: outlined red, for destructive actions (End Game, Declare Bankruptcy).
- `.btn-ghost`: text-only, in app bars.
- `.btn-gold`, `.btn-on-dark`: only on forest backgrounds (landing hero, invite code).

**Action dock** (`.turn-dock`, rendered by `renderActionButtons`). Fixed above the tab bar on your turn.
The right-hand button is the move the game needs now: Roll Dice, then Buy for $X if you can buy, then
End Turn. End Turn is always present, disabled and narrow until you roll, so the sequence is visible.
Jail choices get their own row above. Never put optional moves or host controls in the dock.

**Moves grid** (`.moves-grid` via `renderMovesGrid`). Two-column tiles with a title and a one-line
`<small>` explaining the move. `.is-featured` highlights a move that just became available (a full set).

**Host panel** (`renderHostPanel`). Pause/Resume and End Game, host only, dashed outline at the bottom
of the game tab.

**App bar icons** (`.app-bar-icon`). 44px square tap targets in emerald with a 24px inline SVG and an
`aria-label` that names the action. The game app bar holds at most three: "Play on another device"
(`#move-device-btn`) and the turn alerts bell (`#turn-alerts-btn`), after the room code chip. The bell is
an outline when alerts are off and fills (`.is-on`) when they're on for this device, so state shows
without words. Below 360px wide the icons narrow to 36px and the code chip tightens so the room name
keeps its room. A fourth control goes in a sheet, not the bar.

**Turn alerts sheet** (`#turnAlertsModal`, rendered by `renderTurnAlerts` in `game.js`). A standard sheet
whose copy depends on the device (`TurnNotifications.status()`):
- iPhone Safari: `.modal-hint` says alerts need the game on the Home Screen, and `.turn-alerts-note`
  (a quiet note surface) says it's a shortcut to the site, not an App Store app. Actions: Add to Home
  Screen (primary), Not now.
- Off: Turn on alerts (primary), Not now.
- On: Send a test alert, Turn off alerts, Done, all secondary: nothing urgent is left to do.
- Blocked or unsupported: one sentence on where to fix it (iPhone Settings or the browser's site
  settings), and Done.
Results of an action show in `.turn-alerts-status` (emerald, footnote) rather than a toast, because the
sheet is still open.

**Add to Home Screen page** (`home-screen.html`). A plain page, not a sheet, because people leave Safari's
chrome to follow it: the real app icon at 72px, a `.page-title` ("Add to Home Screen" plus one sentence
saying what it is), then the steps as one `.group` list (`.home-screen-steps`): Tap Share, Tap Add to Home
Screen, Open Mortgage from your Home Screen, Turn on alerts. Each row leads with a 40px glyph tile showing
what to look for (Safari's Share and plus-square glyphs in Safari blue, our app icon, the emerald bell).
The order is a real sequence, so the list is an `<ol>`; the glyphs carry it, so there are no number
markers. A tertiary footnote says the address works once and expires in 10 minutes. Opened from the Home
Screen, the same page shows "Opening your game" while it signs in; if the code has expired it says
"Sign in again" in ordinary text with a primary button to the home page. That's a next step, not money at
risk, so it isn't red.

**Turn ticket** (`.turn-ticket`). The signature element: `--banknote`, the guilloché (`--guilloche`)
over the forest gradient. Don't reuse it elsewhere except the invite code, the hotseat hand-off, the Board
tab's turn strip, and the landing hero, which share its meaning: this is the money moment.

**Board tab** (`renderBoard` in `board.js`, `.board-view`). A real square board, GO bottom-right, play
clockwise, sized to fit: the screen's width on phones, the window's height on desktop (players and
recent events beside it). No scaling transforms: everything inside scales with `--u`, one edge
square's width. Rules that keep it readable:
- Text stays upright on every side. Desktop squares show name and price; phone squares drop the name.
- The set colour is only ever the band on the square's inner edge.
- Ownership is the owner tag (`.board-owner-tag`): initials, or a corporation's ticker, in the owner's
  player colour, replacing the price. It's squared off so it never reads as a round token.
- Buildings: a green house with the count (`.board-house`) or a red H (`.board-hotel`).
- Tokens sit in their own layer on the square's inner edge and step square by square after a roll.
- The centre holds a small banknote strip (whose turn, dice, Roll Dice when that's the only move,
  else "Go to turn"), then the square in focus (the mover's, or one you point at or tap) as one line,
  then the last card. Keep it to that. The "It's your turn" pill stays hidden on this tab.

**Sheets** (`.modal > .modal-content`). Bottom sheets on phones with a grabber, centered dialogs at 720px
and up. Title in `.modal-header` (Besley), optional `.modal-hint`, actions in `.sheet-actions`, stacked
full width with the primary action first.

**Corporations sheet** (`#corporationModal`, `.corp-sheet`, rendered by `openCorporationModal` in
`corporations.js`). Two levels. The list has one `.corp-summary` card per corporation: ticker, policy
badge, share price, the viewer's role and stake, an ownership bar (`.corp-owners-bar`, one segment per
shareholder in their player colour) and a gold line for anything waiting on the viewer. Tapping a card
shows its detail: four stat tiles (`.corp-stats`), then panels for Overview (called "Run it" for the
chairman), Owners, Properties and Debt. On phones the panels are tabs (a four-across `.segmented`);
from 720px the sheet widens to 920px, the tabs hide and every panel shows in two columns, so nothing
needs scrolling. The rent policy is a two-way toggle (`.policy-toggle`): the current policy is the
forest half, the other half is the switch when the viewer may use it. Actions inside the detail keep
the corporation and tab in view when the sheet re-renders.

**Grouped lists.** Rows sit in one `.group`-style surface separated by hairlines (players, log, deeds,
rooms, steps), not in separate cards. Cards are reserved for things that stand alone (auction, trade
offer, corporation).

**Deed rows** (`.owned-property-row`). A 6px band in the property's color on the leading edge, then
name, type and value, then chips: set progress (gold when complete), buildings, current rent.

**Property dots** (`propertyDot(id)`, `.property-dot`). Everywhere else a property is named in a list
(IPO and trade pickers, auction, corporation assets, loan details), a small square in its
board color goes before the name so groups are recognisable at a glance.

**Segmented control** (`.segmented` with `.segmented-option` buttons, `role="tablist"`/`"tab"`). Tabs
inside one page section, like the Market's New trade, Send money, Trade proposals and Past transactions.
Two by two on phones, one row from 480px; the selected option is forest with white text. A
`.segmented-count` pill shows how many items wait in a pane.

**Badges** (`.badge`, `.badge-gold`, `.badge-danger`, `.badge-info`). Pills in sentence
case.

**Feedback.** `showToast(message, tone)` for transient confirmations (top of screen, under the status
bar). `.turn-warning.danger` for blocking problems inline; plain `.turn-warning` (gold) when money is owed but End Turn will cover it. `.error-message` under form fields.
`.empty-state` text tells people what to do next.

**Dice** (`renderDicePair`). CSS pips, not Unicode die glyphs, which render inconsistently on Android.

## Motion

- One orchestrated moment: the dice tumble when a new roll arrives (`.dice-pair.is-rolling`).
- Responsive motion only otherwise: sheets slide up, toasts drop in, buttons press.
- `prefers-reduced-motion` zeroes `--dur` and `--dur-fast`.
- No scroll-reveal, marquees, or looping animation.

## Writing

- Plain verbs and the same name through a flow: "Create IPO" opens "Create IPO", "Buy Property" buys it.
- Money is always `formatMoney`: `$1,500`, cents only when they matter.
- The satirical voice (see the brand book) lives in marketing copy and empty states, never in a button
  or an error. Errors say what happened and what to do.
- Existing button labels that tests match on stay Title Case (`End Turn`, `Roll Dice`, `Start Auction`).
  New labels use sentence case.
- Name things the way the phone does. It's "Add to Home Screen", Apple's wording, never "install" or
  "download the app": the game isn't an App Store app, and people should know nothing is being installed.
  The feature is "turn alerts": "Turn on alerts", "Send a test alert", "Turn off alerts".

## Building new UI

1. Use existing classes before writing CSS. Add new component CSS to the matching section of
   `style.css`, using tokens only (no raw hex, no inline styles except data-driven colors such as
   `--property-color` or `--token-color`).
2. Turn actions go in `renderActionButtons()`; optional moves go in the moves grid; host-only controls go
   in `renderHostPanel()`.
3. Check it at 320px, 375px, and 390px wide, and at 1280px. App bar controls are `.app-bar-icon`s with
   an inline SVG and an `aria-label`; there's room for three after the room code, no more. `tests/e2e/mobile-layout.spec.js` guards
   against horizontal overflow and dock placement.
4. Bump the `?v=` cache key of every CSS and JS file you change, in every HTML page that loads it.
