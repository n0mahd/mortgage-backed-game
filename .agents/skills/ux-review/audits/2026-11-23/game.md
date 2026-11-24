<!-- Reviewer report from the 2026-11-23 ux-review run. Screenshot paths point to that session's scratch folder and are not kept. -->

# Game tab audit (during play)

Screenshots: /tmp/claude-1000/-home-abdullah-Projects-mortgage-backed-game/197a046c-4009-40c2-b65a-78c7ac65b73c/scratchpad/audit-game/shots/ (390x844 phone unless noted; `*-full.png` = whole page, rendered with a tall viewport so the dock sits at the bottom).
Staged via the real API on my own dev servers (3021/3121, scratch DB), driven with testDice. Production untouched; servers stopped.

## 1. Top 5 problems (ranked by player harm)

1. **The same money fact is shown 3 to 5 times per screen, so the one that matters gets lost.** After buying Reading Railroad (A04-after-buy-full.png) the $200 shows in: the ticket cash, the "This turn −$200 / In $0 · Out $200" block, the "Bought Reading Railroad −$200" row, the player card's "Paid this turn $200 / Received this turn $0 / Received between turns $0", and Recent actions' "Alice purchased Reading Railroad for $200.00". Cash and net worth also show in both the ticket and your player card, side by side. On a phone the Game tab is about 2,400px long; the actual next step sits in the dock while the player scrolls through copies.
2. **The square you're on is written out in three places, and the card that should say what happened doesn't.** Ticket status "Rolled 5, now on Reading Railroad", landing card "You are on / Reading Railroad / Unowned railroad. Buy it or send it to auction.", the rail's "Resolve" step, then a dock button that only says "Action" (A02-landed-unowned-railroad.png). When you pay rent (D01-paid-rent.png) the landing card says only "Owned by Bob." The $28 you just paid sits in a different card, under the wrong heading ("Before your first turn"). Before you roll, the landing card describes the square you're leaving ("You already own this square", "Collect salary when you pass GO"; A06, A01).
3. **Game over has no summary you can get back to.** The ticket says "Final standings are in the Game Over summary", but that modal only opens from a live update. After a reload, or for anyone who closed it, it never shows again (C05-bob-game-over.png, D02-host-ended-game-over.png). The screen underneath still offers Moves (Corporations, Trade or pay), "Since your turn ended", "3 still solvent" and a step rail. On a bankruptcy the liquidation sheet and the winner sheet open stacked on top of each other (C03-after-bankruptcy.png).
4. **The auction panel buries the bid controls under explanation, and the dock fights it.** Large-type "No bids yet", then "Alice started this auction. Resolve it before the turn can continue.", then a frozen "Timeout if idle for 120s more." (it never counts down). The bid box defaults to "1" with no $. The host's red Cancel Auction sits right under Bid/Pass. The dock shows a disabled "Resolve Auction", and the Moves grid turns into four greyed tiles, including "Auction Open / Bid in the panel above" (A08-auction-starter-alice-full.png, A09-auction-bidder-bob.png). On Alice's phone the dock covers the Bid/Pass row (A10-auction-alice-after-bob-bid.png).
5. **Status words repeat what badges, buttons and the rail already show (jail, pause, step rail).** In Jail (B01b-jail-full.png): ticket status "In Jail. Roll doubles, pay $50, or use a card.", rail step "Jail", landing "Jail / Just Visiting – You are in Jail.", an "In Jail" badge, a "Get Out of Jail Free card" badge, and three dock buttons that already say all of it. Paused (A17-paused-host-full.png): "Paused by the host" (ticket), "Game Paused / Host paused the game / Alice paused the session. Paused just now." (banner), plus the log line "Alice paused the game: Host paused the game". The 4-step rail (Roll/Resolve/Actions/End) is in every state, even off-turn and at game over. Its per-step details are computed but hidden with `display:none`, so it's a progress bar whose labels mean nothing to a new player ("Resolve"? "Actions"?).

## 2. Text changes

| Where | Current | Verdict | Replacement |
|---|---|---|---|
| turn-panel.js:19 | "Final standings are in the Game Over summary" | reword (and fix bug 5.1) | "Bob won" (winner name). Add a "Final standings" button in the dock that reopens #winnerModal |
| turn-panel.js:21 | "Doubles! Now on St. Charles Pl., roll again" | shorten (wraps to 2 lines; square is in the landing card) | "Doubles – roll again" / off-turn "Doubles – rolling again" |
| turn-panel.js:22 | "In Jail. Roll doubles, pay $50, or use a card." | cut (the dock buttons are exactly these three choices) | "In Jail" |
| turn-panel.js:22 | "In Jail, deciding how to get out" | shorten | "In Jail" |
| turn-panel.js:23 | "Roll to move" | cut (Roll Dice button is under the thumb) | no status line, or "Your move" |
| turn-panel.js:23 | "About to roll" | keep | – |
| turn-panel.js:24 | "Rolled 5, now on Reading Railroad" | shorten (dice show 5; landing card names square) | "Rolled 5" |
| turn-panel.js:38 | "Your cash" on someone else's ticket (A05) | reword: the ticket is coloured as Bob's but shows Alice's money | keep "Your cash" but only when it's your turn; off-turn, move your cash out of the ticket (see 4.1) |
| turn-panel.js:42 | "Net worth" in ticket | merge with player card: one place only (ticket wins, see §3) | – |
| turn-panel.js:235/245/250 | checklist details "Waiting for dice", "Assets, debt, market", "Interest and next player" | cut code: hidden by CSS (style.css:1210), dead | – |
| turn-panel.js:229/239/243/248 | rail labels "Jail/Roll", "Resolve", "Actions", "End" | cut the rail (see 4.2) | – |
| turn-panel.js:303-305 | "Unowned railroad. You can only buy where you land, so roll first." | cut (pre-roll you're on the square you're leaving) | hide the landing card before the roll |
| turn-panel.js:312 | "Unowned railroad. Buy it or send it to auction." | shorten | "For sale" (price is shown right beside it) |
| turn-panel.js:317 | "You already own this square." | shorten | "Yours" |
| turn-panel.js:317 | "Owned by Bob." | reword: say the money consequence that just happened | "Bob's – you paid $28 rent" (from the ledger entry this turn) / "Bob's – you owe $960 rent" |
| turn-panel.js:323 | "Collect salary when you pass GO." | cut | – |
| turn-panel.js:324/325 | "Community Chest effect is applied automatically." / "Chance effect…" | cut (the card summary shows the card) | – |
| turn-panel.js:326 | "Tax square. Amount: $200." | reword | "You paid $200 tax" |
| turn-panel.js:327 | "You are in Jail." / "Just visiting." | cut "You are in Jail." (badge, status, buttons); keep "Just visiting" | – |
| turn-panel.js:357 | "Applied: …" / "Card effect was applied automatically." | cut the fallback; drop "Applied:" prefix | effect text alone |
| turn-panel.js:76-79 | "Game Paused" / reason "Host paused the game" / "Alice paused the session. Paused just now." | merge into one line | "Paused by Alice · 2 min ago" (show reason only if it isn't the default) |
| game.js:494 | pause reason default 'Host paused the game' | cut default; leaves log as "Alice paused the game" | `reason: ''` |
| turn-panel.js:194 | "Property Auction" | shorten | "Auction" |
| turn-panel.js:199 | "Alice started this auction. Resolve it before the turn can continue." | cut | – |
| turn-panel.js:222 | "Timeout if idle for 120s more." | reword plus tick it, or cut. The player needs to know what happens at timeout. | "Closes in 1:54 if no one bids – high bid wins" |
| turn-panel.js:221 | "Auction timeout reached. The next action will resolve it." | shorten | "Time's up – closing" |
| turn-panel.js:185/187 | "You passed on this auction." / "You are the current high bidder." | shorten | "You passed" / "You're winning" |
| turn-panel.js:180 | "High bid: $90.00 by Bob" (cents, Besley headline size) | reword | "Bob leads at $90"; "No bids yet" at body size |
| turn-panel.js:432 | dock "Resolve Auction" (disabled) | cut: not an action | hide dock while an auction is open, or show "Waiting on auction" non-button text |
| turn-panel.js:434 | dock "Action" | reword: weakest label in the app | "Buy $200" (opens sheet) or split to two dock buttons "Buy $200" + "Auction" |
| turn-panel.js:438 | "Auction Open / Bid in the panel above" | cut | – |
| turn-panel.js:439, 497-501 | "Already Yours / Reading Railroad", "Property Owned / Pennsylvania Ave", "No Property to Buy" disabled tiles | cut: dead tiles that only restate the landing card | – |
| turn-panel.js:383 | "Hotels Built / Every set is maxed out" | cut tile | – |
| turn-panel.js:387 / game.js:415 | "After the auction" on 3 disabled tiles | cut: hide anytime moves during an auction | – |
| turn-panel.js:390 | "You own a full set" (always `is-featured`) | shorten; feature only when newly built-able | "Build Houses" / small: none |
| turn-panel.js:465 | "Create IPO / Take properties public" | reword for non-finance players | "Start a company / Sell shares in your properties" |
| turn-panel.js:466 | "Manage Debt / Borrow, repay, refinance" | shorten | "Loans / Borrow or repay" |
| turn-panel.js:488 | "Corporations / Shares and chairmen" | reword; hide the tile when no corporation exists | "Companies" (small only when something waits: "2 votes waiting") |
| turn-panel.js:510 | "Trade or pay / Opens the market" | cut small text (Market tab is one tap below) | "Trade or pay" |
| turn-panel.js:518 | "You're hosting this game without a seat. The players move on their own; host controls are below." | shorten | "You're watching. Host controls are below." |
| turn-panel.js:536-538 | "Host controls" + "Only you can see these. They affect every player." | cut the sentence | – |
| turn-panel.js:139 etc. | "You have $960 unpaid to Bob. Raise $960 more before ending your turn or End Turn will declare bankruptcy." | keep-but-reword: says $960 twice, doesn't say how | "You owe Bob $960. Raise it (Loans, sell, trade) or you go bankrupt." |
| turn-panel.js:154 | "You are $X below zero. Raise $Y before ending your turn or End Turn will declare bankruptcy." | reword | "You're $X short. Raise it or you go bankrupt." |
| turn-panel.js:160 | "End Turn repays $X of loans that come due, leaving you $Y." | keep (money consequence not visible elsewhere) | – |
| turn-panel.js:91-104 | company loan warnings | keep; trim "If it can't repay them it becomes insolvent and is closed." → "or it closes" | – |
| game.js:312 | "3 still solvent" | cut (bankrupt players have a badge) | – |
| property-display.js:129 | "3 owned, worth $320" | shorten (count already in the stat tile) | "Worth $320" |
| property-display.js:186-198 | stat tiles Cash / Properties / Net worth on *your* card | cut Cash and Net worth (in ticket); cut Properties (list is right below) | – |
| property-display.js:199-203 | "Paid this turn / Received this turn / Received between turns" | cut (duplicate of Since card, mislabelled; see bug 5.4) | – |
| property-display.js:138-147 | "Brown street", "Value $60", "No buildings", empty house pip | cut type label for streets (colour band says it), cut "No buildings"/empty pip; keep set chip and rent | row: name · set chip · houses (if any) · rent |
| property-display.js:72 | "Monopoly" chip | keep (gold, meaningful) | – |
| property-display.js:211-212 | "MBS: 6,000 of 12,000 shares (50.0%)" + "NAV: $x/share" | reword | "MBS · 50% · $x a share" |
| property-display.js:222 | "Debts" rows | keep | – |
| property-display.js:216 | "Get Out of Jail Free card" badge | shorten | "Jail card" |
| cash-since-turn.js:186 | "Before your first turn" while it *is* your first turn (A04, C01, D01, B01) | reword | when isMyTurn and no previous turn: no heading for the empty group; show only "This turn" |
| cash-since-turn.js:186 | "Since your turn ended" | keep | – |
| cash-since-turn.js:199 | "No money in or out." | cut: hide the card when both groups are empty | – |
| cash-since-turn.js:176 | "In $8 · Out $0" | cut (net in the summary, rows below; with 1-2 rows it's a third copy) | show only when ≥4 rows |
| game.html:199-201 | "Buy or Auction" + card with name/price + "Buy it at list price, or let every player bid on it." | shorten | title "Reading Railroad · $200"; hint: "Auction: everyone bids, high bid wins." and "You'll have $1,140 left" |
| game.html:203-206 | sr-only "Price $0.00" | cut (dead; price is in the card) | – |
| game.html:208 | "Start Auction" | keep | – |
| purchase.js:66-67 | "Who's buying?" / "Your cash $1,340 → $1,140" | keep (prevents a mistake) | – |
| game.html:435 | "Add up to 4 houses per property. A fifth improvement swaps them for a hotel." | shorten | "4 houses, then a hotel." |
| houses.js:78 | "$50 per improvement" on every row | move to group header (same for the whole set) | "$50 each" |
| houses.js:90-91 | "Total cost $50. You have $820." | merge into button | button "Build for $50 · $770 left" |
| game.html:443 | "Confirm Purchase" | reword | "Build for $50" |
| game.html:478-480 | "Game over" header + winnerReason "Game over - Bob wins - last player standing!" | cut reason duplication | header "Bob wins"; reason "Last player standing" |
| game.js:489 | 'Host ended the game.' | keep, reword | "Host ended the game – ranked by net worth" |
| game.js:693-700 | "Alice Bankruptcy Summary", "Direct properties were returned to…", "houses/hotels cleared", "share(s) returned to availability", "Personal debts cleared" | reword plainly | title "Alice is bankrupt"; rows "Properties → Bob", "Houses removed", "Shares → back to the company", "Loans cleared" |
| game.html:66 | turn-alerts offer | other thread; note it pushes the ticket below the fold on every load until answered | – |

## 3. Duplication (same fact, same screen) and which wins

| Fact | Where shown | Winner |
|---|---|---|
| Your cash | ticket, your player-card Cash tile | ticket (on your turn). Off-turn, see 4.1 |
| Net worth | ticket, player-card tile | ticket |
| Property count | player-card tile, "3 owned, worth $320", the list itself | the list |
| Money in/out this turn | Since card totals, Since rows, player-card "Paid/Received", Recent actions | Since card rows |
| Rent you received | Since row ("Rent from Bob / Bob landed on Baltic Avenue") + Recent actions ("Bob paid $8.00 to Alice for Rent for Baltic Ave") | Since row |
| Current square | ticket status, landing card, rail "Resolve", disabled moves tile ("Already Yours / Reading Railroad"), other player's collapsed row subtitle | landing card |
| Purchasable + price | landing card ($200 + "Buy it or send it to auction"), dock "Action", buy-sheet card, sheet hint | dock button carrying price ("Buy $200") |
| Jail | status, rail, landing text, badge, dock buttons | dock buttons + badge |
| Paused | ticket status, banner label, banner title, banner body, log | ticket status ("Paused by Alice") |
| Auction state | panel, dock "Resolve Auction", moves tile "Auction Open", 3 "After the auction" tiles, rail "Resolve" | the panel |
| Game over | ticket title, ticket status, rail "End", winner modal header + reason | winner sheet + one ticket line |
| Doubles | status "Doubles! … roll again", dock "Roll Again", log "(doubles!)" | dock |

## 4. Structural and visual issues

1. **The ticket mixes "whose turn" with "your money".** Off your turn it is painted in Bob's colour with Bob's avatar, yet the big number is *your* cash labelled "Your cash" (A05, A13). Fix: off-turn, shrink the ticket to one row ("Bob's turn · rolled 3 · Baltic Ave") and put your cash/net worth in a slim strip or your own card. On your turn, keep the big banknote.
2. **Drop the 4-step rail.** The dock already shows the one next move, and the rail's labels are jargon whose details are hidden in CSS. It even reads wrong: after an auction the rail shows Roll as current but Resolve as complete (A11). On game over it lights "Resolve" and "End" (C05). Remove `renderTurnChecklist` and the CSS, which saves ~40px on every screen.
3. **Hide the landing card until you've moved.** Before the roll it describes the square you're leaving. After the roll, make it the outcome card: one line saying what happened, in money ("Bob's – you paid $28", "For sale · $200", "Paid $200 tax", the drawn card). Fold the card summary (`renderLastCardSummary`) into it rather than stacking a second card.
4. **Moves grid: show only moves you can take.** Remove disabled tiles (Already Yours, Property Owned, No Property to Buy, Hotels Built, Auction Open, After the auction ×3). Hide Corporations when no company exists. Use `is-featured` only for something new (votes, offers), not permanently for Build Houses. During an auction, hide the grid entirely.
5. **Make the dock's buy step one tap and self-explaining.** Replace "Action" + sheet with "Buy $200" and "Auction" in the dock, or keep the sheet but label the dock "Buy or auction". The sheet should show cash after the purchase even when you run no company (today it only does with companies).
6. **Auction panel order:** property + current bid on one line, then the bid row ($-prefixed input, preset +$10/+$50 chips, Bid, Pass), then a live countdown. Move the host's Cancel Auction to the host panel (Design system: host controls never next to turn actions). Hide the dock while the auction is open, or pad the page so it doesn't cover Bid/Pass (A10).
7. **Player cards:** your own card should be a compact deed list (no stat tiles, no cash-flow block). Collapsed others are good. The expanded other card repeats cash in the summary row *and* the Cash tile (A13); drop the tiles there too. Deed rows: three chips plus two meta lines per property is too much. Use one line: colour band, name, set progress, house pips, rent.
8. **Recent actions on the Game tab** repeats the Since card and the Recent events tab. Cut it to the last 2 events, or remove it (the tab exists), so the Game tab ends at the players.
9. **Game over screen:** replace the turn ticket with a results banner (winner, your rank, "Final standings" button that reopens the sheet). Hide Moves, the Since card, the landing card and the dice.
10. **Paused:** one ticket line plus a dimmed dock area. No separate banner card.
11. **Jail:** status "In Jail", the three dock buttons, no landing text. Show "Pay $50 Fine" as the gold warning button only (already so), and the badge in your card. That's enough.

## 5. Suspected bugs

1. **Game over summary can't be reached after a reload.** `loadGameData` (game.js:101-157) renders the ended state but never calls `showWinnerFromState`, and nothing on the page reopens #winnerModal. The ticket text points to it anyway (turn-panel.js:19). Seen in C05 and D02.
2. **Liquidation and winner sheets open at the same time** on a bankruptcy that ends the game (C03; `.modal.active` = liquidationModal, winnerModal). `performGameAction` suppresses the winner for sequencing (game.js:561-566), but the socket `game:state_update` reaches `applyGameUpdate` without `suppressWinner` and opens it anyway (game.js:272-274).
3. **"Before your first turn" during your first turn** (cash-since-turn.js:186, `hadTurn` false when isMyTurn). Money from this turn appears under both a "Before your first turn" heading (empty) and "This turn" (A04, C01, D01).
4. **Player-card cash flow is mislabelled and double counts.** In ledger.js:127-140 `received` counts everything and `receivedBetweenTurns` is a subset of it, but the card shows them as separate lines. So Bob shows "Received this turn $40" *and* "Received between turns $40" for one $40 rent, during Alice's turn (C02). "Paid this turn $200" is still shown after Alice's turn ended (A05), because the counters reset only at the entity's own turn start.
5. **Auction countdown is frozen.** `formatAuctionExpiry` runs only on render, and nothing re-renders each second, so "Timeout if idle for 120s more" stays put until some other update arrives.
6. **Step rail state is wrong after an auction on doubles.** Roll shows current while Resolve shows complete (A11). The "current" de-dupe loop in turn-panel.js:253-258 keeps the first current, which is Roll.
7. **The dock covers the auction's Bid/Pass row** on a 390x844 phone for the turn player (A10); the bottom padding doesn't account for the dock.
8. **Bid input default is $1 and accepts decimals** (`parseFloat`), while the panel shows "$90.00" style cents. That's inconsistent with formatMoney elsewhere (turn-panel.js:180 uses toFixed(2) instead of formatMoney).
9. `buyUnavailableLabel` (turn-panel.js:497) branches on the English text of `landing.detail` (`startsWith('Owned by')`), so rewording the landing copy silently breaks the tile label. Moot if those tiles are cut as proposed.
10. Off-turn ticket "Your cash" shows the viewer's money under the turn player's avatar and colour (A05). Not a code bug, but players will read it as Bob's cash.
