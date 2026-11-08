# Mortgage Backed Monopoly — Game Rules

> *"If they did it in 2008, it's fair game."*

---

## 1. Overview

Mortgage Backed Monopoly is a fully-digital, multiplayer parody of Monopoly layered with Wall Street financial mechanics. On top of buying properties and collecting rent, players can:

- **IPO their properties** — bundle them into corporations, issue shares, and sell equity to other players
- **Borrow** — take loans against property for 1 to 30 turns at the host's rate, paid down or interest only, with compounding interest on anything unpaid
- **Trade freely** — swap cash, properties and corporation shares through the Market tab

The game runs entirely in the browser; there are no physical components, no banker, and no manual bookkeeping. All state is shared in real time.

This document assumes you already know standard Monopoly. It focuses on the new mechanics and the app's UI flow.

---

## 2. Getting Started

### Logging In

Navigate to the site and enter your email address. A one-time code will be sent to that address; enter it to authenticate. No password required. You can also join a room anonymously without logging in.

### Playing on Another Device

To move your game to another phone or browser, tap **Play on another device** at the top of the game screen. It shows a one-time code and a link that work for 10 minutes. Open the link on the other device, or enter the code on the home page under "Have a code from another device?". Both devices stay signed in. Players who signed in with email can also just sign in with their email on the new device.

Rejoining by room code ("Continue as an existing player") only works for guest players, never for players who signed in with email.

### Your Turn

The game vibrates your phone when it becomes your turn (Android browsers; on iPhone it is a light haptic tick where Safari allows it). If your phone sleeps or loses its connection, the game screen catches up automatically when you come back, so there is no need to refresh.

### Creating a Room

1. After logging in, click **Create Room** on the lobby page.
2. Share the invite code shown on screen with the other players.
3. Wait in the lobby until all players have joined.

### Joining a Room

1. Enter the invite code a friend shared with you and click **Join Room**.
2. You will appear in the lobby player list.

### Starting the Game

Only the host (room creator) can start the game. A host who created the room with **Just watch** has no seat: they see the game and keep the host controls (pause, resume, end, cancel stuck auctions and trade offers) but take no turns, so a game can be played entirely by AI agents. Once at least two players have joined, the host clicks **Start Game**. All players are redirected to the game screen automatically.

### Starting Cash

Each player begins with **$1,500**.

---

## 3. Standard Monopoly Rules

The following standard rules apply as normal:

- **Movement**: On your turn, roll two dice and move your token clockwise that many spaces.
- **GO**: Collect **$200** each time you pass or land on GO.
- **Taxes**: Landing on Income Tax costs $200; Luxury Tax costs $100.
- **Chance & Community Chest**: Draw a card and follow its instructions. Effects are applied automatically.
- **Free Parking**: No effect — just a rest square.

Differences or additions are noted in the sections below.

---

## 4. UI Tabs

The game screen has four tabs accessible via the top navigation bar:

| Tab | Purpose |
|-----|---------|
| **Game** | Main action hub — player cards, turn status, action buttons |
| **Market** | Execute trades and direct payments between players |
| **Recent events** | Full timestamped history of every game event |
| **Board** | Visual board — roll dice, move your token, buy houses/hotels |

**Board** is where movement happens. **Game** is where you manage assets (buy property, create IPOs, manage debt). Most turns involve switching between the two.

---

## 5. Movement & the Board Tab

1. Switch to the **Board** tab on your turn.
2. Click **Roll Dice** — your token moves automatically.
3. A toast notification describes what happened (e.g., "unowned — buy it via the Game tab", "rent owed", "Chance card drawn").
4. Rent, taxes, and card effects are applied automatically and recorded in the log.
5. You can roll again only if you rolled doubles; otherwise, complete your actions and click **End Turn** in the **Game** tab.

After doubles, deal with the square you landed on before rolling again: the dock offers **Buy** for an unowned property, with **Roll Again** beside it. Rolling again moves you on, and the property you left stays unowned. Rent you couldn't afford on the first roll is paid before the next one (see §11). You can only buy or auction the property you landed on during this turn, never the square you started the turn on.

End Turn is only valid after the current player has rolled. The UI disables it before rolling, and the server rejects unrolled end-turn actions.

**Rolling three consecutive doubles** sends you directly to Jail.

---

## 6. Buying Property

When you land on an unowned property:

1. A toast shows: *"[Property] is unowned — buy it via the Game tab."*
2. Switch to the **Game** tab and click **Buy Property**.
3. Review the property and fixed purchase price.
4. Click **Buy Property** — the price is deducted from your cash immediately.

If you choose not to buy the property, click **Start Auction** from the purchase modal:

- Active players bid or pass from the **Game** tab.
- Bids must exceed the current high bid and must be affordable by the bidder.
- The current high bidder is committed and cannot pass.
- When every other active player has passed, the high bidder pays the winning bid and receives the property.
- If every active player passes before any bid, the property remains unowned.
- Auctions have a two-minute idle timeout by default. Bids and passes refresh the timeout.
- The next game action after timeout resolves the auction automatically: the high bidder wins, or the property remains unowned if there were no bids.
- The current turn cannot end until the auction resolves.
- The host can cancel a stuck auction. Canceling an auction does not move cash or property.

You cannot buy property when it is not your turn.

---

## 7. Houses & Hotels

You may buy houses or a hotel on any property where you own the **complete color group** (all properties of that color).

1. Switch to the **Board** tab on your turn.
2. If you own a complete group, the **Buy Houses** button appears.
3. Use the **+/−** controls to select how many houses to add to each property in the group.
4. Click **Confirm** — the total cost is deducted from your cash.

**Built groups stay together.** Once any street in a color group has a house or hotel, none of that group's streets can be traded, whether directly or into an LLC. The only way to sell a built group is to put the **whole group** into an IPO and sell shares in the corporation (see sections 9 and 12).

### House Costs per Color Group

| Color Group | Cost per House |
|------------|---------------|
| Brown | $50 |
| Light Blue | $50 |
| Pink | $100 |
| Orange | $100 |
| Red | $150 |
| Yellow | $150 |
| Green | $200 |
| Dark Blue | $200 |

A **hotel** is the 5th improvement on a property (displayed as "H" on the board). Hotels cost the same per step as houses.

---

## 8. Rent

### Regular Properties

| Improvements | Rent |
|-------------|------|
| Unimproved, no monopoly | Base rent (printed on property) |
| Unimproved, monopoly | 2× base rent |
| 1 House | Rent table index 1 |
| 2 Houses | Rent table index 2 |
| 3 Houses | Rent table index 3 |
| 4 Houses | Rent table index 4 |
| Hotel | Rent table index 5 |

Owning all properties of a color (a **monopoly**) doubles the base rent even without houses.

### Railroads

Rent scales with how many railroads you own:

| Railroads Owned | Rent |
|----------------|------|
| 1 | $25 |
| 2 | $50 |
| 3 | $100 |
| 4 | $200 |

### Utilities

Rent = dice roll × multiplier:

| Utilities Owned | Multiplier |
|----------------|-----------|
| 1 | ×4 |
| 2 | ×10 |

### Paying Rent

When you land on an owned property, rent is transferred automatically and recorded in the log. The Game tab shows recent cash flow so players can see what they paid and received.

Rent on a corporation's property depends on its **rent policy** (section 9). In **Reinvest** mode everyone pays full rent into the treasury, shareholders included. In **Payout** mode the rent goes straight to the shareholders, and a shareholder who lands there pays only the share of the rent they don't own: with 30% of the corporation, you pay 70%. The landing summary says which mode applies before you pay.

---

## 9. IPOs (Corporations)

Any player may bundle one or more of their properties into a corporation and sell shares to other players.

### Creating an IPO

1. On your turn, go to the **Game** tab and click **Create IPO**.
2. Select the properties to include as corporate assets. A color group with buildings must go in whole: ticking one of its streets ticks the rest.
3. Set a **ticker symbol** (e.g., `MBS`). Every new corporation issues **12,000 shares**. 12,000 splits evenly in halves (6,000), thirds (4,000), quarters (3,000), sixths (2,000) and eighths (1,500), and 120 shares is 1%. There is no IPO price: what your shares are worth is set by the corporation's net asset value, and what someone pays for them is whatever you agree in a trade.
4. Click **Create** — the selected properties transfer into the corporation and you receive all of its shares.

### Adding Properties to a Corporation You Run

If you run a corporation (you're its chairman or hold more than half its shares), you can move more of your own properties into it on your turn.

1. Open **Corporations** from the Game tab and tap **Add properties to MBS** on that corporation's card. **Create IPO** also lists the companies you run. Or, in the Market tab, keep yourself under **You give** and pick MBS under **They give**: the form becomes **Add to MBS**.
2. Tick the properties to add. A color group with buildings goes in whole: ticking one of its streets ticks the rest.
3. Choose what you get back:
   - **New shares** (the usual choice). You get new shares at today's value per share, so the other holders' stakes keep their value. For example, MBS has 12,000 shares and is worth $1,200, so one share is worth $0.10. Illinois Ave ($240) gets you 2,400 new shares, and MBS then has 14,400. Shares are whole numbers rounded to the nearest share, so rounding can move up to half a share's value between you and the other holders; the screen shows how much before you confirm. A property worth less than half a share gets no new shares and can only go in as a gift. Corporations created before shares went to 12,000 keep their share counts. Any value the new shares don't cover goes to every shareholder, and the screen tells you how much the others gain before you confirm.
   - **Nothing, it's a gift.** Every share rises in value, including the other holders'.
4. Check **Before you confirm** for the corporation's value, your shares and your net-worth change, then tap **Add**. Nobody else has to agree.

There is no cap on how many shares a corporation can have, and you get new shares even if you already hold every share (your stake stays 100%, and your net worth doesn't change either way). New shares can't be priced while a corporation is worth $0 or less. You can't add properties while you owe an unpaid claim.

To put a property into a corporation someone else runs, make it a **property offer** (below), or trade it for the chairman's own shares (see **Trading a Property for Shares** in section 12).

### Running a Corporation

The chairman, or anyone holding more than half the shares, runs a corporation from its card in **Corporations**.

**Rent policy.** Choose **Reinvest** (the default) or **Payout**:

| | Who pays what | Where it goes |
|---|---|---|
| Reinvest | Everyone pays full rent, shareholders included | The treasury, for the chairman to spend |
| Payout | A shareholder pays only the part they don't own; everyone else pays in full | Straight to the shareholders, split by shares. The slice for treasury shares stays in the treasury |

On paper both cost the lander the same: in Reinvest your stake in the treasury grows by your share of what you paid. The difference is cash in hand versus value locked in the company. **Changing the policy.** The chairman (or a majority holder) can change it alone only **on their own turn, before they roll**, so nobody can switch it after seeing where anyone landed. After a change it is **locked for the chairman's next 5 turns**: they can change it alone again on their 6th turn. During the lock it changes only if **every shareholder agrees**. Any shareholder can tap **Ask every shareholder to switch**; each holder sees **Agree** / **Reject** on the corporation card (the Corporations button says when an answer is waiting). The policy switches the moment the last holder agrees, at any point in the game, and that starts a fresh 5-turn lock. One rejection closes the vote. A sole shareholder's proposal passes at once.

Debt interest is still charged to the treasury in Payout mode, so a corporation with debt needs cash to cover it.

**Dividends.** On their turn the chairman can pay any amount of treasury cash to the shareholders, split by shares held. The slice for treasury shares stays in the treasury.

**Buying and building.** When the chairman lands on an unowned property, the Buy sheet asks **Who's buying?** and can buy it for the corporation from its treasury. **Build Houses** has a **Build for** choice for groups the corporation owns whole, paid from its treasury. A group split between the chairman and the corporation can't be built on.

**Trading as the corporation.** In the Market, picking the corporation in a side's **Player** dropdown trades for the corporation: its treasury cash, its properties and its own treasury shares. It can buy its own shares back into the treasury, and trade with another corporation (that one's chairman accepts). Built groups still can't be traded. A runner can't trade personally with their own corporation: treasury cash reaches players only through a dividend every holder shares.

### Property Offers

Anyone who doesn't run a corporation can offer it properties. Tap **Offer a property to MBS** on its card, tick the properties and choose:

- **At what price?** **Book value** (price plus buildings; nobody gains or loses value) or **Set my price**.
- **Paid with** **new shares** at today's value per share, or **treasury cash**.

The preview shows the new shares, each holder's stake before and after, the value per share, and your net-worth change. The offer then waits in **Market > Trade proposals** like any trade (the Moves grid shows **Trade proposals** while one waits for your answer, and the corporation's card links to it). The card shows what each side gives, says in one line how far the price is from book value and what it means for you, and lists your net-worth change and the stakes before and after. The chairman can **Accept**, **Decline** or **Counter** with another price (**Its worth** fills in book value). A counter goes back to the offerer, who can accept, counter or withdraw. Offers expire after 10 minutes, and are checked again on acceptance (the property must still be yours and free of loans). A deal that hands the offerer more than half the shares makes them chairman. The chairman's own properties go in only at book value, through **Add properties**.

### Selling Shares

Nobody can buy your shares without your agreement. Shares change hands only through a **trade offer** in the **Market** tab that the holder accepts: offer cash (or property) for someone's shares, or offer your own shares to someone.

The one exception is the corporation's own **treasury shares**. If bankruptcy returns shares to the corporation, it sells them from the **Corporations** modal at the current share value (net asset value per share, below), and the payment goes to the corporation treasury. A corporation whose shares are worth $0 cannot sell treasury shares.

### Founder and Chairman

The founder starts as chairman and holds 100% of the shares. Whoever **gains a majority** (more than half the shares) becomes chairman automatically. A majority holder can then appoint someone else as chairman, and shareholders can propose and support chairman votes.

### Corporation Value in Net Worth

A player's stake in any corporation contributes `sharesOwned × shareValue` to their net worth at game end. Share value uses corporation net asset value:

```
shareValue = max(0, corporation property value + treasury cash - corporation debt) / totalShares
```

### Corporation Insolvency

If a corporation's treasury falls below $0 because a loan comes due that it can't repay, the corporation is closed as insolvent:

- Corporation-owned properties return to the bank and any houses/hotels are cleared.
- Corporation debts are wiped.
- Shareholder positions are wiped, and treasury shares become 0.
- The chairman seat is cleared and open chairman votes are closed.
- Insolvent corporations cannot collect rent, sell shares, issue debt, or use chairman governance controls.

The Corporations modal shows an **Insolvent** badge and explains that assets, debt, shares, and governance were closed.

---

## 10. Debt & Interest

Players can borrow against their properties — simulating leveraged buyouts, margin loans, or mortgage-backed instruments. Every loan has a term, and the whole balance is due when it ends, so a loan can't be carried forever.

### Loan rate

Before the game starts, the host sets one interest rate per turn in the waiting room (default **5%**, between 0% and 25%). Every loan pays that rate, whatever its term. A longer term doesn't change the rate; it spreads the payments over more turns, so interest compounds for longer and the loan costs more overall. The rate is fixed for the rest of the game and shown at the top of the Debt page.

### Taking a loan

1. Go to the **Game** tab → **Manage Debt** → **Take a new loan**.
2. Enter the loan amount. No property is pledged: your loans are limited by your whole portfolio. All your loans together can reach **90% of the book value of what you own**, so you always keep at least 10% equity:

   ```
   book value = properties (price + houses/hotels) + shares (shares held × book value per share)
   you can borrow = 90% of book value − what you already owe
   ```

   Cash doesn't count. The form shows how much you can still borrow.
3. Pick a term from the dropdown: **1 to 30 turns** (10 by default). A longer term means smaller payments but more interest overall.
4. Choose what **Autopay** takes each turn: **Pay down loan** (the default), **Interest only**, or **Off**. Below the two choices the form shows what the loan costs: the payment per turn and the total you'd repay.
5. Tap **Take loan**: the cash is added to your balance immediately.

A corporation's chairman can borrow for the corporation the same way; its limit is 90% of the book value of the corporation's properties, less what it owes. The limit is checked only when a loan is taken (or refinanced): a portfolio that later loses value doesn't call in existing loans, but it does stop new ones.

### Each turn

Every time you end your turn, each of your loans:

1. Charges one turn of interest on its balance: `interest = balance × rate / 100`.
2. Takes the autopay payment from your cash:
   - **Pay down loan** takes the installment that pays the loan off exactly when its term ends. Make every payment and the balance is zero after the last one. It is recalculated each turn: skip a payment and later ones get bigger, pay extra and they get smaller.
   - **Interest only** takes just that turn's interest, so the balance stays the same and the whole of it is due on the last turn.
   - **Off** takes nothing. The interest is added to the balance and earns interest itself from then on.

   Autopay never takes more than the cash you have; whatever it can't take stays on the loan.
4. Counts down one turn.

### Maturity

On a loan's last turn the whole balance is due when you end your turn, with or without autopay. If your cash covers it, the loan is repaid. If it doesn't, you go **bankrupt** (see §11): your properties return to the bank. The turn screen warns you before you end a turn on which a loan comes due, so you can raise cash first by selling, trading or refinancing.

### The Debt page

**Manage Debt → Your loans** starts with **When you end this turn**: a card for you and for each corporation you run that has loans, showing its cash, the loans due in full, the autopay payments, any unpaid interest that will be added, and the cash left after End Turn. If that would leave you bankrupt or the corporation insolvent, the card shows how much is missing, with buttons to refinance the loan that's due or to borrow the amount.

Below it is each loan you can manage (your own and those of corporations you run) with its balance, term, turns left and next payment. For each loan you can:

- change **Autopay each turn** between Pay down loan, Interest only and Off; each choice shows what it takes (any time, even when it isn't your turn: off your turn, open it from **Your Loans** in Moves);
- **Pay an amount** of your choice;
- **Pay off** the whole balance;
- **Refinance** it, which opens the refinance form with that loan selected.

**Take a new loan** and **Refinance loans** show your borrowing limit as a sum (90% of book value, less what's already owed) and an **After** box. It shows cash, what End Turn takes, total owed and the cash left after End Turn, and updates as you type, so you can see whether the loan gets you through the turn.

Payments are made on your turn. Paying more than is owed only takes what is owed.

### Refinancing

1. Go to **Manage Debt** → **Refinance loans**.
2. If you run a corporation with loans, choose whose loans: yours or the corporation's.
3. Select one or more of those loans. The new amount starts at their combined balance.
4. Enter the new loan amount, pick a term and choose Autopay (Pay down loan by default):
   - **More than the balance** takes out the difference as cash. It follows the same 90% limit, with the loans being replaced not counted as owed.
   - **Less than the balance** pays the difference down from the borrower's cash (yours, or the corporation's treasury), which must cover it.
   - **The same amount** just moves the balance onto the new term.
5. The selected loans are replaced by one new loan on the new term at the game's rate.

### Corporation loans

A corporation's loans work the same way, paid from its treasury cash. They count down at the end of its chairman's turn (or, with the chair vacant, its majority holder's), once per round. A corporation that can't repay a loan when it comes due becomes insolvent.

Loans taken before terms existed were given a 10-turn term, paid down. Loans taken when autopay was a plain on/off switch kept their setting (on became Pay down loan) and their rate.

---

## 11. Bankruptcy

Bankruptcy is triggered automatically when your **cash drops below $0 at the end of your turn** or when you end the turn with an **unpaid rent claim**.

- A `BANKRUPT` flag is set on your account.
- The game log shows a bankruptcy announcement.
- You can no longer act through the server API.
- Pending trade offers involving you are canceled automatically.
- You are **skipped** in the turn order.
- Your personal debts are cleared.
- If you were a corporation chairman, chairmanship passes to the active non-bankrupt shareholder with the most shares. If no active shareholder exists, it falls back to an active non-bankrupt founder. If neither exists, the chair is left vacant.
- Open chairman votes involving you are closed.
- A liquidation summary appears after bankruptcy so players can see the cause, destination of assets, share movement, and debt cleanup.

If you cannot afford rent owed to another player or corporation, you pay only the cash you actually have and the unpaid remainder is tracked as a claim. If you raise enough cash before ending the turn, End Turn pays the claim from your cash (before loan payments) and bankruptcy is avoided; there is no separate pay button, and the End Turn button shows the amount it will pay. After doubles the claim is paid before you roll again instead: **Pay $X & Roll Again** takes it from your cash first. If you can't cover it, you can't roll again: raise the cash (borrow, trade, IPO), or End Turn declares bankruptcy. If the claim is still unpaid when you end the turn:

- Rent owed to a player transfers your directly owned properties and player-held corporation shares to that player.
- Rent owed to a corporation transfers your directly owned properties to that corporation. Player-held shares return to their issuing corporation's treasury share pool.
- Houses/hotels on transferred properties are removed.

Bank, tax, card, jail bail, and loan bankruptcies return your directly owned properties to the bank and return player-held shares to their issuing corporation's treasury share pool. Bankruptcy is final. Corporation-owned properties and corporation debts stay with the corporation unless that corporation later becomes insolvent.

---

## 12. Trading & Payments

### Player-to-Player Trades

Trades let two players exchange any combination of cash, properties, corporation (LLC) shares, and Get Out of Jail Free cards after both involved players agree.

1. Go to the **Market** tab.
2. Choose who gives on each side from the **Player** dropdowns. Corporations are listed there too, under **Companies**: picking one trades for that corporation with its chairman (see **Running a Corporation** in section 9). Picking yourself under **You give** and a corporation you run under **They give** adds your properties to it instead (see **Adding Properties to a Corporation You Run** in section 9).
3. Enter how much cash each player contributes to the swap.
4. Check the properties each player is transferring. A player holding a Get Out of Jail Free card can check it too, so the card can be sold for cash or swapped as part of a deal. For each corporation a player holds shares in, enter how many shares they are transferring (up to the number they hold).
5. Click **Propose Transaction** — the offer appears under **Trade proposals**.
6. The other involved player accepts to execute the transfer, declines to reject it, or counters.

**Countering.** Tap **Counter** on an offer made to you and the trade form opens with that offer's terms, your side under **You give**. Change anything (cash, properties, shares, a card) and tap **Send Counteroffer**. The original offer closes as *Countered* and your counter goes to the other player, who can accept, decline or counter in turn. A counter is always between the same two players; pick someone else and it becomes an ordinary new trade, leaving the original open. Every closed offer in the game, with how it ended (Accepted, Declined, Countered, Expired or Canceled), is listed under **Past transactions**: your own trades by default, or everyone's, or one player's, from the **Show** menu.

Streets in a color group with buildings can't be checked: a built group can only change hands by an IPO of the whole group (or by adding the whole group to a corporation you run), whose shares can then be traded here. A property backing a loan can't be traded, put into an IPO or added to a corporation until that loan is paid off or refinanced onto other properties.

To send shares (or property) as a gift, propose a one-sided trade where the other player gives nothing; it moves once they accept. Shares of an insolvent corporation cannot be traded. Whoever gains a majority of a corporation's shares through a trade becomes its chairman.

### Trading a Property for Shares

You can put a property into another player's corporation in exchange for part of its shares, for example "I give you Boardwalk, you give me 3,000 of your 12,000 MBS shares".

1. Open **Corporations** from the Game tab and tap **Offer a property for MBS shares** on that corporation's card. The Market tab opens with you on one side and the chairman on the other. You can also set up the same trade in the Market tab directly.
2. Tick the property you're giving. Under **Where should your properties go?**, choose **Into MBS** rather than **To Sam**.
3. Enter how many MBS shares you want back. The box shows the percentage, e.g. 3,000 shares of 12,000 = 25%.
4. The **Your offer** box reads the deal back in one sentence and shows the corporation's value before and after, your stake and your net-worth change. For a straight property-for-shares deal it also shows the even split and a **Use N** button.
5. Propose the trade. The other player sees the same summary from their side and accepts or declines.

When the trade goes through, the property belongs to the corporation: it collects the rent into the treasury and adds to the corporation's net asset value, so every share is worth more. Only a corporation run by the receiving player (its chairman or a majority holder) can take the property, and it must not be insolvent. This is checked again when the offer is accepted. Chairmanship never changes automatically, but if a trade gives someone more than half the shares, they can then replace the chairman; both players see a warning before that happens.

Pending trade offers expire after the configured trade-offer timeout. Expired offers never move cash or properties; the next game action clears the offer and logs the expiration. The host can also cancel abandoned pending trade offers. Host cancellation does not move cash or properties.

Trades can be proposed and accepted at any time, not only on your turn. The acting player must be one side of the trade. There is no built-in chat yet — arrange the terms in chat or voice first.

### Direct Payments

For simple cash transfers (rent side-deals, fines, gifts):

1. Go to the **Market** tab → **Send money**.
2. Select the recipient (a player, or a corporation under **Companies**) and the amount.
3. Click **Make Payment**: funds move instantly.

Paying a corporation puts the cash into its treasury. If you run it, you choose what you get back, as when adding properties: **new shares** at today's value per share, or **nothing, it's a gift**. Anyone else's payment is a gift: no shares come back, but every share is worth more, including theirs. Payments to a corporation can be made any time, but not while you owe an unpaid claim.

---

## 13. Jail

### Getting Sent to Jail

- Landing on the **Go to Jail** square (position 30).
- Drawing a "Go to Jail" Chance or Community Chest card.
- Rolling **three consecutive doubles** in one turn.

Going to Jail ends your move. Even if the roll that took you there was doubles, you do not roll again, and the Jail choices below only start on your next turn. You can still trade, manage debt, and so on before you end the turn.

### Escaping Jail

At the start of each turn while in Jail, choose one available option:

- **Roll for doubles** → if you roll doubles, you are released immediately and move that many spaces.
- **Pay the $50 fine** → leave Jail, then roll normally to move.
- **Use a Get Out of Jail Free card** → leave Jail, then roll normally to move.
- **No doubles, turns 1–2** → still in Jail; turn ends.
- **No doubles, turn 3** → forced to pay **$50 bail**, then move.

Leaving Jail by paying the fine or using a card happens before your move roll. Leaving Jail by rolling doubles or by forced third-turn bail consumes that turn's roll; you do not roll again afterward.

If you hold a **Get Out of Jail Free** card (from a Chance or Community Chest draw), it stays in your hand until you choose to use it, or until you sell or trade it to another player through the Market tab. A player can hold one card at a time, so a player who already has one cannot receive another in a trade.

While in Jail you can still buy properties, create IPOs, manage debt, and trade via the Market tab.

---

## 14. Winning

### Automatic Win

If all players except one are bankrupt, the game ends automatically and that player is declared the winner.

### Host-Ended Game

At any point, the **host** can click **End Game**. The game ends immediately and winners are ranked by net worth.

### Host Pause / Resume

The host can pause a live game from the game screen. While paused, normal player actions are blocked for everyone and the game shows a paused banner. The host can resume the game, end it, or clear stuck auctions and trade offers. Pause and resume actions are written to the game log and event stream.

---

## 15. Net Worth Formula

When the game ends, final standings are determined by:

```
Net Worth = Cash
          + Sum of owned property values
          + Sum of (sharesOwned × corporation share value) across all corporations
          − Total outstanding debt principal
```

Property value is recorded at purchase price plus houses/hotels. Corporation share value is based on the corporation's property value, treasury cash, and outstanding corporate debt.

---

## Quick Reference

| Thing | Value |
|-------|-------|
| Starting cash | $1,500 |
| Pass GO | $200 |
| Income Tax | $200 |
| Luxury Tax | $100 |
| Jail bail (forced, turn 3) | $50 |
| End Turn gate | Current player must roll first |
| Loan terms | 1 to 30 turns, one rate per turn set by the host |
| Loan payments | End of your turn (autopay: pay down, interest only or off), whole balance at maturity |
| Bankruptcy trigger | Cash < $0 at turn end |
| Win condition | Last solvent player OR host ends game |
| Shares per new corporation | 12,000 (120 shares = 1%) |
| Default rent policy | Reinvest |
| Rent policy change | Chairman alone: own turn, before rolling; then locked for their next 5 turns. Anytime: every shareholder agrees |
| Property / trade offers expire | 10 minutes |
