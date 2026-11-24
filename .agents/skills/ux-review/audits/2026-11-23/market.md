<!-- Reviewer report from the 2026-11-23 ux-review run. Screenshot paths point to that session's scratch folder and are not kept. -->

# Audit: Market, Corporations, Debt, Recent events, Board

Staged state: 3 players (Alex = viewer, chairman of MBS with 50%; Sam 30%, Kim 20%), KSH run by Kim with 2,000 treasury shares, Alex holding 8.3%. Alex has two personal loans and MBS has one. Also pending: a trade from Sam, a trade from Alex, Sam's property offer to MBS, Kim's open Pass GO vote, Sam's open rent-policy vote and Alex's chairman vote in KSH.
Screenshots are in `shots/` here; `-tall` files show the whole sheet without its inner scroll.
`SHOTS=/tmp/claude-1000/-home-abdullah-Projects-mortgage-backed-game/197a046c-4009-40c2-b65a-78c7ac65b73c/scratchpad/audit-market/shots`

## 1. Top 5 problems (ranked by harm)

1. **The Debt sheet is a wall of text that says each loan's terms 4 times, and it has 3 ways to pay.** `$SHOTS/alex-390-debt-loans-tall.png`
   - Each card shows: the balance; a "10 turns left" badge; "Personal · 10-turn loan at 5% per turn"; a sentence ("Autopay takes $51.80 … paying the loan off in 10 turns"); a select that says "Pay down loan · $51.80"; "Pay an amount"; and "Pay off $400" plus "Refinance".
   - The sheet's own 4-line hint repeats the rate and the autopay rules above all of that.
   - Three loans make a 1,950px sheet with three solid green "Pay off" buttons, so there's no single primary action.
2. **Per-share prices are meaningless.** 12,000 shares means "$0.1792 a share", "Buy treasury shares at $0.0750 each", a default of **1** share and "1 share costs $0.08" (the price rounds in the very next line).
   - Every share number then needs a "6,000 of 12,000 (50%)" gloss, and the "6,001/12,000 shares" majority line needs one too.
   - Players think in % and dollars. This single choice causes much of the prose across corporations, trades and mergers.
   - `$SHOTS/alex-390-corp-ksh-overview-tall.png`, `$SHOTS/alex-390-corp-list.png`
3. **The chairman's "Run it" tab explains everything three times and shows tools twice.** `$SHOTS/alex-390-corp-mbs-overview-tall.png`, desktop `$SHOTS/alex-1280-corp-mbs-overview-tall.png`
   - Rent policy shows up as the header badge, the toggle with its subtitles ("Rent grows the treasury") and a paragraph saying the same thing.
   - Treasury cash appears as a stat tile ($700) and again as "Chairman moves $700 to spend".
   - Build houses and Borrow for MBS appear in Chairman moves and again in the Properties and Debt panels. On desktop, where every panel shows, you see both copies at once.
   - Two closing asides follow: "To buy a property for MBS, land on it…" and "No treasury shares for sale. To buy shares a player holds…".
4. **Trade and offer previews say the same deal 2–3 times.** `$SHOTS/alex-390-market-proposals.png`, `$SHOTS/alex-390-market-trade-add-mode.png`
   - On Alex's own offer card: "You give Kim $150. Kim gives you 1,500 of 12,000 KSH shares (12.5%)", then a table, then the "Alex gives / Kim gives" boxes with the same items.
   - On the property offer, the verdict says "Accepting costs you $24", and the next row says "Your net worth −$24".
   - In Add to MBS, "1,228 new shares" appears three times: the radio detail, the summary sentence and the table.
   - A no-change row reads "Your net worth $0", which looks like "your net worth is zero".
5. **The Market header and the trade form carry too much.**
   - The tabs are 5 segments wrapping onto 3 rows on a phone (`$SHOTS/alex-390-market-trade.png`), under a lede nobody needs.
   - Every trade with a chairman shows a "Where should Sam's properties go?" radio pair (with a 3-line description) before anything is ticked.
   - Send money shows a disabled "From: Alex" select that can never change (`$SHOTS/alex-390-market-payment-player.png`).
   - The button reads "Propose Transaction" (title case, finance-speak).

## 2. Text to change

| Where | Current | Verdict | Replacement |
|---|---|---|---|
| game.html:83 | "Trades wait for the other player to accept. Payments move cash right away." | cut | — (the buttons say Propose / Make Payment; the toast already confirms) |
| game.html:180 | "The latest 100 events, newest first." | cut | — |
| game.html:90 | "Past transactions" | reword (it lists only trade offers; Kim's $75 payment isn't there) | "Past trades" |
| game.html:131, market.js:362 | "Propose Transaction" / "Send Counteroffer" | reword | "Send offer" / "Send counter" |
| game.html:138-139 | From select (always you, disabled) | cut | — (label the amount "Send" instead) |
| game.html:142 | "To player or company" | shorten | "To" |
| game.html:102/118 | "Player or company" (×2) | cut label | — (the headings "You give"/"They give" say it; the select alone is enough) |
| game.html:151 | "Make Payment" | reword | "Send $X" (live amount) |
| game.html:201 | — | out of scope | — |
| game.html:222 | "The company issues 12,000 shares and you hold all of them. 12,000 splits evenly: a half is 6,000, a third 4,000…" | cut (after the % fix in §4); otherwise shorten | "You'll own 100% of it." |
| game.html:220 | placeholder "e.g., PROP" | keep | — |
| corporations.js:27 | "Or add these properties to a company you already run:" | shorten | "Or add to:" + ticker buttons |
| game.html:292 | "Book value / Price plus buildings. Fair to everyone: no holder gains or loses value." | reword | "Fair price ($X)" / no detail line |
| game.html:296 | "Set my price / You name it. The chairman accepts, declines or counters." | shorten | "My price" (no small text) |
| game.html:307 | "New shares / Issued at today's value per share." | cut small text | "KSH shares" |
| game.html:311 / corporation-desk.js:521 | "Treasury cash / KSH buys it outright. Its treasury has $900." | shorten | "Cash (KSH has $900)" |
| corporation-desk.js:520 | "Kim decides. KSH will own it and collect its rent." | cut | — (title says "Offer … to KSH"; Kim deciding is in the button toast and the card) |
| corporation-desk.js:269 | "At book value or your price, for new KSH shares or treasury cash. Kim accepts, declines or counters." | cut | — |
| corporation-desk.js:270 | "Or trade it for Kim's own shares" | keep-but-reword | "Trade with Kim instead" |
| corporation-desk.js:73-75 | Rent policy paragraph ("Everyone pays full rent into the MBS treasury, shareholders included. Your 50% stake grows with it.") | cut for Reinvest; keep the Payout one only for holders, shortened | Payout: "You pay only 50% rent on MBS properties." |
| corporation-desk.js:119-120 | toggle subtitles "Rent goes to the owners" / "Rent grows the treasury" | keep (they're the definition), and drop the paragraph above instead | — |
| corporation-desk.js:88-89 | "You have rolled. You can switch again after your turn." / "Switch before you roll." | shorten | "Locked until your turn ends" / cut the second (the button is enabled; that says it) |
| corporation-desk.js:147 | "Proposed by Sam. Agreed: Sam. Waiting for: you, Kim. It switches when everyone agrees; one no closes it." | replace with avatars + ticks like the rule vote | "Sam asks: switch to Payout?" + avatar row |
| corporation-desk.js:124 | "Ask every shareholder to switch to Payout" | shorten | "Ask to switch to Payout" |
| corporation-desk.js:188 | "Chairman moves $700 to spend" | cut the note | "Chairman moves" |
| corporation-desk.js:190 | "Pay a dividend, split by shares" | shorten | "Dividend" |
| corporation-desk.js:191 | input prefilled with half the treasury | change | empty, with placeholder "Up to $700" |
| corporation-desk.js:196 | "Trade as MBS / Opens the Market" | cut small text | "Trade as MBS" |
| corporation-desk.js:200 | "To buy a property for MBS, land on it and choose MBS when you buy." | cut | — |
| corporations.js:354/358 | "Add properties / Yours in, for new shares", "Add cash / Into the treasury, for new shares" | cut small text | "Add properties", "Add cash" |
| corporations.js:372-374 | "No treasury shares for sale. To buy shares a player holds, make them an offer in the Market." | cut (hide the Shares block when nothing is for sale; never show it to the chairman) | — |
| corporations.js:366 | "Buy treasury shares at $0.0750 each (up to 2,000)" | reword | "Buy KSH shares · up to 16.7% for sale" with a % or $ input |
| corporations.js:173 | "1 share costs $0.08" | reword | "= $X for Y%" (exact, no 2-dp rounding of sub-cent prices) |
| corporations.js:273 | "Worth (net assets)" | shorten | "Worth" |
| corporations.js:274 | "Share price $0.1792" | replace | "Your stake $1,075" (or hide for non-holders) |
| corporations.js:275-276 | "Treasury cash", "Owes / Debt None" | shorten | "Cash"; hide the tile when no debt |
| corporations.js:400 | "MBS <span>MBS Corporation</span>" | cut the name when it's just ticker+"Corporation" | "MBS" |
| corporations.js:236 | "No corporations yet. Create an IPO to start one." | keep | — |
| corporations.js:301 | "Owners 12,000 shares" | cut note | "Owners" |
| corporations.js:304 | "2,000 more in the treasury, for sale." | reword as a row in the owner list | "For sale · 16.7%" |
| corporations.js:325 | "No corporation debt" | cut (hide the tab or panel when there's no debt) | — |
| corporations.js:323 | "$100, 5-turn loan at 5% per turn: 5 turns left. Autopay off: $5 interest added next turn." | shorten | "$100 · 5 turns left · autopay off" |
| corporations.js:331 | "Only KSH's chairman, Kim, can borrow for it." | cut | — |
| corporations.js:413 | Properties tab: value column shows land price only | add houses | "Park Place 🏠2  $350" |
| corporations.js:456-457 | "Changing the chairman / Changing chairman requires 6,001/12,000 shares." | merge | heading "Chairman" + "Needs over 50%" |
| corporations.js:452 | "No open chairman votes" | cut | — |
| corporations.js:446 | "1,000/12,000 shares supporting, 6,001 needed" | reword | "8.3% of 50% needed" + progress bar |
| corporations.js:460/467 | "Majority change:" / "Propose vote:" | reword | "Make chairman" / "Vote for chairman" |
| corporations.js:564 | "MBS will own them and collect their rent, so every MBS share is worth more." | cut | — (the "Nothing, it's a gift" option says it) |
| corporations.js:618 | "1,228 new shares at today's value per share, so the other holders' stakes keep their value." | shorten | "1,228 shares" (the preview has the rest) |
| corporations.js:621-622 | "Every MBS share rises in value, including the other holders'." | shorten | "Sam and Kim gain too." |
| corporations.js:626 + market.js:327 | "What do you get back?" under heading "You get back" | merge | keep heading "You get back", drop the title |
| corporations.js:642 | "Before you confirm" | cut heading | — |
| corporations.js:703 | "The cash goes into MBS's treasury, where you can spend it on property, houses and loan payments as chairman." | cut | — |
| share-deals.js:208/297/355/420 | "Your net worth $0" row | change | hide when 0, or "No change" |
| share-deals.js:334/407 | "Value per share $0.0750 → $0.0750" | hide when unchanged | — |
| share-deals.js:405 + table | summary sentence repeats the gives boxes (e.g. "You give Kim $150. Kim gives you…") | cut sentences on offer cards, keep the table | — |
| market.js:856 | "Alex proposed a trade" (viewer is Alex) | reword | "Your offer to Kim" / "Sam's offer"; sides "You give" |
| market.js:1056 | tag label "LLC shares" | reword | "Shares" (or the %) |
| market.js:1093 | "1500 KSH shares" | bug: no thousands separator | `ShareDeals.count(shares)` → "1,500 KSH shares (12.5%)" |
| market.js:1047ff (cash tag) | "$300 / Cash" | cut sub-label | "$300" |
| market.js:880 | "Waiting on the involved players" / "Clear this expired offer from the involved player view." | reword | "Waiting on Kim" / "Expired" |
| market.js:273 | "MBS shares (holds 6,000 of 12,000)" | reword | "MBS · you have 50%" |
| market.js:413 | "KSH treasury shares (has 2,000 of 12,000)" | reword | "KSH shares for sale · 16.7%" |
| market.js:478-479 | "Where should your properties go? / To Kim — Kim owns them outright." | show only after a property is ticked; cut "owns them outright" | — |
| market.js:480 (option('…Into KSH…')) | "KSH owns them and collects the rent, so every KSH share is worth more. Ask for KSH shares in return." | shorten | "Into KSH, for KSH shares" |
| market.js:303-304 | merge choice details | shorten | "Some of its properties or cash" (no detail) / "Merge all of KSH into MBS" + "KSH's owners vote" |
| market.js:1281 | "Trade proposal sent. It will execute when the other player accepts." | shorten | "Sent to Kim." |
| corporation-desk.js:252 | "You're trading for MBS: its treasury cash, properties and treasury shares. Pick who to trade with." | shorten | "Trading as MBS." |
| corporation-desk.js:362 | "Offer to MBS · you decide as chairman" | shorten | "Offer to MBS · your call" |
| corporation-desk.js:388 | "You own of MBS" | bug | "You own" |
| corporation-desk.js:325-343 + row 376 | verdict "Accepting costs you $24…" plus the "Your net worth −$24" row | merge | keep the verdict, drop the net-worth row on property-offer cards |
| debt.js:16 | "Loans this game cost 5% interest per turn, for 5 to 30 turns. Paying the loan down every turn clears it by the last turn; with interest only, the whole balance is due then." | shorten | "5% interest per turn." (show only in Take a new loan) |
| game.html:327 | "What do you want to do?" (select) | replace with a segmented control | "Loans · New loan · Refinance" |
| debt.js:88 | "Personal · 10-turn loan at 5% per turn" | cut (rate is game-wide; turns are in the badge) | show the borrower only when there's a corp loan: "MBS" |
| debt.js:71-75 | schedule sentence | cut for pay_down and interest_only (the select shows the amount); keep only "due in full" and "off" (it adds to the balance) | off: "Interest is added to the balance." |
| debt.js:94 | "Pay an amount" + "Pay off $400" + "Refinance" | merge | one "Pay" input with a "Max" chip; Refinance as a text link |
| debt.js:105 | "Paying off needs $400; you have $X." | keep (prevents a confusing disabled button) | — |
| debt.js:196 vs 274 | "MBS Corporation" vs "MBS (corporation)" | unify | "MBS" |
| debt-outlook.js:85 | "Unpaid interest added to loans +$5" inside a *cash* card | move | under the MBS card as a note: "+$5 added to MBS's loan" |
| debt-outlook.js:179-181 | 3-row maths table "90% of the $1,670 book value of your properties and shares / Already owed / You can borrow up to" | shorten | one line: "You can borrow up to $953" (put the maths behind a tap) |
| debt.js:181 | "…$388.50 in total. Nothing is owed after the last payment." | cut second sentence | — |
| debt.js:375 | "Selected balance $550. Same balance on a new term; no cash changes hands." | shorten | "No cash changes hands." |
| debt.js:324 | "Loan #1: $400, 10-turn loan at 5% per turn, 10 turns left" | shorten | "$400 · 10 turns left" |
| rule-proposals.js:99 | "Set by host" chip on every rule | cut (keep "Changed by vote") | — |
| rule-proposals.js:126 | "Expires when it's Kim's turn again." | keep | — |
| mergers.js:491 | "Worth = properties + cash − loans" | cut | — |
| mergers.js:492/494 | "KSH: 12,000 shares" above percentages that are out of 10,000 | fix (see §5) | — |
| mergers.js "After the merger" | "MBS today $2,150 / + KSH today $900" repeats the Before tiles | cut those 2 rows | keep "Merged MBS is worth $3,050" |
| log-format.js:186 + rows | category label beside the icon ("📈 Company", "🏦 Loan") | cut the text label (the icon and filter carry it) | — |
| log rows | "Alex borrowed for [MBS] $100.00…", "Kim paid $75.00" | fix: "you", no brackets, no ".00" | "You borrowed $100 for MBS…" |
| board.js ticket overlay | "Your turn / You" | cut "You" | — |

## 3. Duplication (same fact twice on one screen; winner in **bold**)

- Corporation detail: rent policy shows in the **toggle**, the header badge and a paragraph. Drop the badge in the detail view; keep it on the list cards.
- Corporation detail: treasury cash shows in the **stat tile** and in "Chairman moves $700 to spend".
- Corporation detail: debt shows in the **"Owes $100" tile** and the Debt tab's line, and the tab is headed "Debt" twice (tab label + h4).
- Build houses and Borrow for MBS appear in Chairman moves and again in the Properties and Debt panels. Keep them **only in Chairman moves**; on desktop both copies are visible at once.
- Owners: "Owners 12,000 shares" plus each row's "6,000 · 50.0%" → **the %**.
- Chairman threshold: "requires 6,001/12,000" and "6,001 needed" in the vote row → **one progress bar in the vote row**.
- Role line ("You're the chairman, you own 50%") repeats the Owners row "(you) chairman · 50%". On phones they're on different tabs, so fine; on desktop drop the **role line** from the detail head.
- Property offer to a corporation: "Kim decides" (hint) + "The chairman accepts, declines or counters" (radio) + the corp sheet's "Kim accepts, declines or counters" → **none**; the offer card says "Waiting on Kim".
- Property offer card: the verdict's "costs you $24" and the "Your net worth −$24" row → **the verdict**.
- Trade card for your own offer: summary sentences vs the gives boxes → **the gives boxes** (plus net-worth row).
- Add to company: "1,228 new shares" ×3 → **the preview table**.
- "You get back" heading + "What do you get back?" title → **the heading**.
- Debt card: term and rate ×3 (hint, card subline, schedule sentence) and the autopay amount ×2 (sentence, select) → **badge + select**.
- Market: the Trade proposals count badge, the 📜 badge on the bottom Market tab and the Rule proposals count → keep the **counts**. The 📜 emoji sits on top of the Market icon on phones.
- Merger: Before tiles vs "MBS today / KSH today" rows → **Before tiles**.
- Recent events: icon + category word on every row → **icon**.

## 4. Structural / visual fixes

1. **Show shares as % and $ instead of share counts.**
   - Keep the 12,000 shares internally, but show "50%" and "$1,075" everywhere a player reads or types shares: trade inputs, buy treasury shares, owners, previews.
   - The share-count input becomes a % input with a live "= 1,200 shares" hint.
   - Drop "Share price" as a headline stat. This removes the "X of 12,000" glosses, the IPO divisibility sentence and most "at today's value per share" clauses.
2. **Merge the duplicate paths into a company.**
   - "Add properties" (sheet), "Market › You → MBS (add mode)", "Add cash" (sheet) and "Send money → MBS" are four UIs over two actions, each with its own explanatory copy.
   - Keep the two sheets (launched from the corporation) and have the Market route "you ↔ your company" there, instead of re-rendering a different form in place.
3. **Market tabs: 5 → 3.**
   - "Trade" (with Send money as a mode toggle inside it, since it's just a one-sided trade with no acceptance).
   - "Offers" (trade + property + merger + rule votes in one inbox; one badge, sorted by "waiting on you").
   - "History".
   - This fits in one row at 320px and kills the lede.
4. **Corporation detail on phones:**
   - Change the tabs to Overview / Owners / Properties, and fold Debt into Overview as a line under the stat tiles ("Owes $100 · 5 turns left") that links to the Debt sheet.
   - Hide "Changing the chairman" from the chairman unless someone else has an open vote.
   - Move the non-chairman's "Offer a property" and "Buy shares" to the top. They're the only things a non-chairman can do, and they currently sit below a rent-policy essay.
5. **Rent-policy vote**: render it like the rule vote (avatars with ticks, Yes/No). That component already exists in rule-proposals.js and reads far better than the sentence at corporation-desk.js:147.
6. **Debt sheet**:
   - Replace the "What do you want to do?" select with a segmented control.
   - Collapse each loan to one row: "$400 · 10 turns left · Pay down $51.80 ▾". Tapping it expands Pay, Max and Refinance.
   - Make one primary button per view.
   - The End Turn outlook cards are good. Remove the "Covered"/"Nothing taken" badges (the total row's ✓ already says it), and drop MBS's card when nothing is taken.
7. **Trade form**:
   - Hide the destination radios until a property is ticked on that side.
   - Collapse a side's long property list behind "Add property ▸" once a side has more than ~4 items.
   - Put the preview (net-worth change) beside the button instead of in a separate bordered box with a heading.
8. **Recent events filters**: 7 segments in 2 rows → 4 (All, Money, Property & trades, Companies), or a single select. "Moves" and "Rules" are rarely wanted.
9. **Corporation Properties tab** doesn't show houses (Park Place shows $350 with 2 houses on it, yet "Worth $2,150" includes them). Add the house glyph used on the Board legend.
10. **Dividend form**: don't prefill half the treasury. One accidental tap pays $350 out.

## 5. Suspected bugs

- **"You own of MBS"**: grammar bug in the property-offer card table (corporation-desk.js:388). `$SHOTS/alex-390-market-proposals.png`
- **"1500 KSH shares"**: no thousands separator in trade-card share tags (market.js:1093, raw `${shares}`).
- **Merger sheet percentages contradict the corporation sheet.**
  - The sheet labels "KSH: 12,000 shares" and then lists Kim 90% / You 10%. The Corporations sheet says Kim 75% / you 8.3%.
  - Cause: `ownersList` divides by player-held shares (10,000, treasury excluded) right under a 12,000 label (mergers.js:192-197, 492-494).
  - At minimum, label it "of player-held shares", or show the treasury as a row. `$SHOTS/alex-390-merger-tall.png`
- **The chairman can "Propose vote" for themselves.** The MBS Owners tab defaults the candidate select to Alex, who is already chairman (`chairmanCandidateOptions` includes the current chairman). `$SHOTS/alex-390-corp-mbs-owners-tall.png`
- **The Propose control stays visible while a vote for the same candidate is already open** (KSH, Alex). The open vote row also says "Alex", not "You". `$SHOTS/alex-390-corp-ksh-owners-tall.png`
- **The share cost line rounds a sub-cent price**: "1 share costs $0.08" next to "$0.0750 each" (corporations.js:173 uses formatMoney).
- **Cents shown inconsistently**:
  - In the log: "$75.00", "$110.00", "$400.00", next to "$300".
  - In the refinance amount: "550.00", while every other money input is whole.
- **Raw "[MBS]" brackets in the log** ("Alex borrowed for [MBS] $100.00"), and the log uses your own name instead of "You".
- **"Your net worth $0" rows**: zero change is rendered as an unsigned "$0" (share-deals `signedMoney(0)`), which reads as a balance.
- **Past transactions** omits payments (Kim's $75 to Sam is absent) despite the tab name.
- **Corporation Properties tab omits houses** (see §4.9).

Servers I started (3031/3131) are stopped. No project files were edited and production wasn't touched.
