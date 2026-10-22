# Mortgage Backed Monopoly — Game Rules

> *"If they did it in 2008, it's fair game."*

---

## 1. Overview

Mortgage Backed Monopoly is a fully-digital, multiplayer parody of Monopoly layered with Wall Street financial mechanics. On top of buying properties and collecting rent, players can:

- **IPO their properties** — bundle them into corporations, issue shares, and sell equity to other players
- **Issue debt** — borrow cash at the room's debt rate, with compounding interest
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

Only the host (room creator) can start the game. Once at least two players have joined, the host clicks **Start Game**. All players are redirected to the game screen automatically.

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

After doubles, deal with the square you landed on before rolling again: the dock offers **Buy** for an unowned property, with **Roll Again** beside it. Rolling again moves you on, and the property you left stays unowned. You can only buy or auction the property you landed on during this turn, never the square you started the turn on.

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

---

## 9. IPOs (Corporations)

Any player may bundle one or more of their properties into a corporation and sell shares to other players.

### Creating an IPO

1. On your turn, go to the **Game** tab and click **Create IPO**.
2. Select the properties to include as corporate assets. A color group with buildings must go in whole: ticking one of its streets ticks the rest.
3. Set a **ticker symbol** (e.g., `MBS`) and the **number of shares** to issue (default 10, at most 12). There is no IPO price: what your shares are worth is set by the corporation's net asset value, and what someone pays for them is whatever you agree in a trade.
4. Click **Create** — the selected properties transfer into the corporation and you receive all of its shares.

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

If a corporation's treasury falls below $0 when corporate debt interest is charged, the corporation is closed as insolvent:

- Corporation-owned properties return to the bank and any houses/hotels are cleared.
- Corporation debts are wiped.
- Shareholder positions are wiped, and treasury shares become 0.
- The chairman seat is cleared and open chairman votes are closed.
- Insolvent corporations cannot collect rent, sell shares, issue debt, or use chairman governance controls.

The Corporations modal shows an **Insolvent** badge and explains that assets, debt, shares, and governance were closed.

---

## 10. Debt & Interest

Players can issue themselves debt at the room's debt rate — simulating leveraged buyouts, margin loans, or mortgage-backed instruments.

### Issuing Debt

1. Go to the **Game** tab → **Manage Debt** → select **Issue New Debt**.
2. Select the property to pledge as collateral, then enter the loan amount. You can borrow up to **90% of the pledged property's value** (its price plus any houses or hotels), so you always keep at least 10% equity. Every loan needs collateral, and a property can back only one loan at a time.
3. Click **Confirm** — cash is added to your balance immediately.

A corporation's chairman can borrow for the corporation the same way, pledging the corporation's properties. Refinancing follows the same limit; the loans being replaced free up their collateral for the new loan.

### Interest Accrual

Interest compounds **every time you end your turn**:

```
New principal = principal × (1 + interestRate / 100)
Interest charged = new principal − old principal
```

The interest charged is deducted from your cash at turn end, before bankruptcy is checked. This means a high-interest loan can spiral quickly.

The default room debt rate is **5% per turn**.

### Repaying Debt

1. Go to **Manage Debt** → select **Settle Debt**.
2. Choose the loan from the dropdown and enter a payment amount, or use **Full Amount** to fill the remaining principal.
3. The payment reduces the principal. If the principal reaches $0 or below, the debt is fully cleared.

Partial payments are allowed.

### Refinancing Debt

1. Go to **Manage Debt** → select **Refinance Existing Debt**.
2. Select one or more existing personal debts.
3. Enter a new loan amount greater than the selected payoff total, then choose collateral properties.
4. The selected debts are cleared, one new loan is created at the room's debt rate, and only the net cash above the payoff total is added to your balance.

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

If you cannot afford rent owed to another player or corporation, you pay only the cash you actually have and the unpaid remainder is tracked as a claim. If you raise enough cash before ending the turn, End Turn pays the claim from your cash (after loan interest) and bankruptcy is avoided; there is no separate pay button, and the End Turn button shows the amount it will pay. If the claim is still unpaid when you end the turn:

- Rent owed to a player transfers your directly owned properties and player-held corporation shares to that player.
- Rent owed to a corporation transfers your directly owned properties to that corporation. Player-held shares return to their issuing corporation's treasury share pool.
- Houses/hotels on transferred properties are removed.

Bank, tax, card, jail bail, and interest bankruptcies return your directly owned properties to the bank and return player-held shares to their issuing corporation's treasury share pool. Bankruptcy is final. Corporation-owned properties and corporation debts stay with the corporation unless that corporation later becomes insolvent.

---

## 12. Trading & Payments

### Player-to-Player Trades

Trades let two players exchange any combination of cash, properties, corporation (LLC) shares, and Get Out of Jail Free cards after both involved players agree.

1. Go to the **Market** tab.
2. Select **Player 1** and **Player 2** from the dropdowns.
3. Enter how much cash each player contributes to the swap.
4. Check the properties each player is transferring. A player holding a Get Out of Jail Free card can check it too, so the card can be sold for cash or swapped as part of a deal. For each corporation a player holds shares in, enter how many shares they are transferring (up to the number they hold).
5. Click **Propose Transaction** — the offer appears under **Pending Trade Offers**.
6. The other involved player accepts to execute the transfer, or declines to reject it.

Streets in a color group with buildings can't be checked: a built group can only change hands by an IPO of the whole group, whose shares can then be traded here.

To send shares (or property) as a gift, propose a one-sided trade where the other player gives nothing; it moves once they accept. Shares of an insolvent corporation cannot be traded. Whoever gains a majority of a corporation's shares through a trade becomes its chairman.

### Trading a Property for Shares

You can put a property into another player's corporation in exchange for part of its shares, for example "I give you Boardwalk, you give me 3 of your 12 MBS shares".

1. Open **Corporations** from the Game tab and tap **Offer a property for MBS shares** on that corporation's card. The Market tab opens with you on one side and the chairman on the other. You can also set up the same trade in the Market tab directly.
2. Tick the property you're giving. Under **Where should your properties go?**, choose **Into MBS** rather than **To Sam**.
3. Enter how many MBS shares you want back. The box shows the percentage, e.g. 4 shares of 12 = 33.3%. Shares are whole numbers, so not every percentage is possible.
4. The **Your offer** box reads the deal back in one sentence and shows the corporation's value before and after, your stake and your net-worth change. For a straight property-for-shares deal it also shows the even split and a **Use N** button.
5. Propose the trade. The other player sees the same summary from their side and accepts or declines.

When the trade goes through, the property belongs to the corporation: it collects the rent into the treasury and adds to the corporation's net asset value, so every share is worth more. Only a corporation run by the receiving player (its chairman or a majority holder) can take the property, and it must not be insolvent. This is checked again when the offer is accepted. Chairmanship never changes automatically, but if a trade gives someone more than half the shares, they can then replace the chairman; both players see a warning before that happens.

Pending trade offers expire after the configured trade-offer timeout. Expired offers never move cash or properties; the next game action clears the offer and logs the expiration. The host can also cancel abandoned pending trade offers. Host cancellation does not move cash or properties.

Trades can be proposed and accepted at any time, not only on your turn. The acting player must be one side of the trade. There is no built-in chat yet — arrange the terms in chat or voice first.

### Direct Payments

For simple cash transfers (rent side-deals, fines, gifts):

1. Go to the **Market** tab → **Direct Payment** section.
2. Select the recipient and amount.
3. Click **Pay** — funds move instantly.

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
| Interest timing | End of your turn |
| Bankruptcy trigger | Cash < $0 at turn end |
| Win condition | Last solvent player OR host ends game |
