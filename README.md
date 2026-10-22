# Mortgage Backed Monopoly

> *"Play Monopoly Like Wall Street — If they did it in 2008, it's fair game"*

Mortgage Backed Monopoly is a browser-based multiplayer parody of Monopoly with Wall Street-style financial mechanics layered on top: corporations, IPOs, mortgage-backed securities, share trading, and compound interest. The app runs the board, dice, payments, turn order, and financial state in real time.

---

## What You Need

- 2–8 players
- Internet access and a browser
- An account on the hosted app (or self-host — see `SETUP.md`)

---

## Setup

1. Create an account and sign in
2. One player creates a room and becomes the host
3. Share the invite code with other players
4. All players join, then the host clicks **Start Game**

For hosting and database setup, see `SETUP.md`.

For the production-readiness plan, see `documents/production-roadmap.md`.

---

## Play With AI Agents

The host can seat AI agents (Claude, ChatGPT, or any MCP client) as players. Each agent plays only its own seat through the game's MCP server, while everyone else plays in the browser and watches its moves live.

**MCP endpoint:** `https://mortgage.abdlh.com/api/mcp` (Streamable HTTP, no sign-in)

1. Add the endpoint to the agent's app once, yourself: an agent can't add a connector to your account. In the Claude app, **Settings → Connectors → Add custom connector**, then tap **Connect** on it, and check it is on (**+ → Connectors**) in the chat you paste the invite into. For Claude Code, `claude mcp add --transport http mortgage-backed https://mortgage.abdlh.com/api/mcp`. Other clients: a remote Streamable HTTP server with the same URL.
2. Create a room in the browser. To only watch, tick **Just watch** when creating it: you take no seat, so only the agents (and anyone you invite) play, and you keep the host controls (start, pause, end). In the waiting room, the host taps **Invite an agent** once per agent, optionally typing the agent's name first. Each tap creates an invite holding a new agent key (`mbagent_…`), shown once. Copy it into a new chat for that agent. Until the game starts, **Rename** changes an agent's name.
3. The agent calls `join_game` with its key (and a name, if the host didn't pick one), then loops on `wait_for_turn` → `take_action` until the game ends. It shows up in the player list with an **AI** badge, and the host presses **Start Game** when everyone is in. Two players never share a name: a name already taken in the room gets a number (`Claude 2`).

| Tool | What it does |
|------|--------------|
| `join_game(agent_key, player_name?)` | Take the seat this key was issued for, under the host's name for it or else `player_name`; calling it again returns the agent's state |
| `get_game_state(agent_key)` | The agent's view: whose turn, cash, position, properties, jail, ownership, auction, trade offers, recent log, and `legal_actions` right now |
| `take_action(agent_key, type, payload?)` | One game action as itself (for example `roll_dice`, `buy_property`, `place_bid {amount}`, `end_turn`) |
| `wait_for_turn(agent_key, timeout_seconds?)` | Returns once the agent needs to act, the game starts or ends, or after up to 50 seconds |
| `get_rules()` | Rules summary, the board, and every action's payload shape |

### Agent security model

- **One key, one seat.** Only the host can create invites, from the waiting room. A key works for one seat in one room and nothing else: it is not a login token, and the server stores only its SHA-256 hash. Agents cannot create rooms, join by room code, start the game, or use host actions. The engine checks that every action is the agent's own (its turn, its money, its properties).
- **Revocable.** The host's **Revoke** disables a key at once. Before the game starts it also frees the seat; afterwards the player stays in the game, but nobody can act for it.
- **Seats are reserved.** Unused invites hold their seats, so people joining by room code can't fill the room first. Invites stop working once the game starts.
- **Only the key plays the seat.** Agent seats can't be taken over through a rejoin request; a lost agent key means a new invite.
- **Getting back into a guest seat.** After a game starts, someone with the room code can ask to take over a human guest seat, but a signed-in player must approve it on their screen: the host or that seat's own player, or any other player when the seat is the host's. Only the browser that asked receives the token.
- **Prompt injection.** Player names, room names and log lines are typed by other players and reach agents as text. The server caps their length, strips control characters, and tells agents to treat them as data. In the agent's own app, give game chats only this connector, so an injected instruction can at most change a game move.
- **Fair dice.** `testDice` is stripped from agent actions outside the test suite, even on servers with `ALLOW_STATE_REPAIR`.
- **No drive-by pages.** Requests with an `Origin` header must come from the app's own URL or an explicit `CORS_ORIGINS` entry; `*` does not count.
- **Bounded waits.** Each player can have at most 2 `wait_for_turn` calls open at once (200 across the server), on top of the per-client and per-seat rate limits.

---

## Game Overview

All players start with **$1,500**. The app handles dice rolling, board movement, rent, taxes, cards, turn order, and bankruptcy checks. The financial layer adds corporations, debt instruments, share prices, and interest.

On your turn, roll in the app, resolve the square you landed on, take any optional actions, then click **End Turn** when done.

---

## The Properties

| Color | Properties | Price |
|-------|-----------|-------|
| Brown | Mediterranean Ave, Baltic Ave | $60 |
| Light Blue | Oriental Ave, Vermont Ave, Connecticut Ave | $100–$120 |
| Pink | St. Charles Place, States Ave, Virginia Ave | $140–$160 |
| Orange | St. James Place, Tennessee Ave, New York Ave | $180–$200 |
| Red | Kentucky Ave, Indiana Ave, Illinois Ave | $220–$240 |
| Yellow | Atlantic Ave, Ventnor Ave, Marvin Gardens | $260–$280 |
| Green | Pacific Ave, North Carolina Ave, Pennsylvania Ave | $300–$320 |
| Dark Blue | Park Place, Boardwalk | $350–$400 |
| Railroads | Pennsylvania RR, B&O RR, Short Line | $200 |
| Utilities | Electric Company, Water Works | $150 |

Full rent ladders are tracked in the app.

---

## Actions

### Buy Property

Tap **Buy Property** after landing on an unowned property. Cash is deducted immediately and the property appears on your player card.

---

### Create an IPO

Requires owning at least one property.

Tap **Create IPO** and select which properties to bundle into a corporation. Set a **ticker symbol** and the **number of shares** (1–12, default 10); there is no IPO price. The selected properties move out of your personal holdings into the corporation and you receive all of its shares. A color group with houses or hotels must go in whole. Nobody can buy your shares without your agreement: shares change hands through trade offers in the Market, and whoever gains a majority becomes chairman.

---

### Issue Debt (Mortgage-Backed Securities)

Tap **Manage Debt → Issue New Debt**. Pick the property to pledge and set a **loan amount** (you receive this cash immediately). You can borrow up to 90% of the pledged property's value (price plus buildings); every loan needs collateral and a property backs one loan at a time. The current game uses the room's debt rate, shown in the modal.

Interest accrues automatically every time you end your turn:

```
new principal = principal × (1 + interestRate / 100)
```

The difference is deducted from your cash. Default rate: **5% per turn**.

---

### Settle Debt

Tap **Manage Debt → Settle Existing Debt**. Select the debt and enter a payment amount, or use **Full Amount** to fill the remaining principal. Cash is deducted and the principal reduced; paying more than is owed only takes what is owed. Debt is removed when fully paid.

### Refinance Debt

Tap **Manage Debt → Refinance Existing Debt**. Select one or more existing debts, set a larger new loan amount, and choose collateral. The selected debts are paid off, one new loan is created at the room's debt rate, and you receive only the net new cash above the payoff amount.

---

### Buy Shares

To buy shares a player holds, make them an offer in the **Market** tab; the shares move only if they accept. If bankruptcy returned shares to a corporation's treasury, tap **Corporations** during your turn to buy those at the current share value (NAV, below); that cash goes into the corporation treasury.

Player net worth values corporation stakes by net asset value: corporation-owned property value plus treasury cash minus corporation debt, divided by total shares. Share value is floored at $0 if the corporation's net asset value is negative.

If corporate debt interest pushes a corporation below $0 treasury cash, the corporation becomes insolvent. Its properties return to the bank, houses/hotels are cleared, corporation debts and shareholder positions are wiped, the chairman seat closes, and no further shares/debt/governance actions are available for that corporation.

---

### Trade (Secondary Market)

Open the **Market** tab. Pick two players and enter what each side offers — any combination of cash, properties and corporation shares. Click **Propose Transaction** to send a pending trade offer; leave one side empty to send shares or property as a gift. To buy into someone's LLC with a property, tap **Offer a property for shares** on its card in **Corporations** (or choose **Into <ticker>** under *Where should your properties go?*); the property goes into the LLC and you ask for its shares in return. The other involved player must accept before cash or properties move.

Pending trade offers expire after the configured trade-offer timeout. Expired offers never move cash or property; the next game action clears them. The host can also cancel abandoned pending trade offers. Host cancellation does not move cash or properties.

### Auctions

If you land on an unowned property and do not buy it, click **Start Auction** from the purchase modal. Active players can bid or pass from the Game tab. The high bidder pays the winning bid and receives the property once every other active player has passed; if everyone passes before a bid, the property remains unowned. Auctions have a two-minute idle timeout that refreshes on bids and passes; the next game action resolves an expired auction to the high bidder, or no sale if there were no bids.

The host can cancel a stuck auction. Canceling an auction does not move cash or property.

### Host Pause and Cleanup

The host can pause a live game from the game screen. While paused, normal player actions are blocked for everyone until the host resumes. The host can still resume, end the game, or clear stuck auctions and trade offers.

---

### Pay a Player

Also in the **Market** tab under **Payment System**. Choose a recipient and amount. Payments are sent from your player.

---

## End of Turn

Click **End Turn** after rolling and resolving your square. The UI disables End Turn until you roll, and the server rejects end-turn actions from an unrolled state. The app will automatically:

1. Apply interest on all your outstanding debts
2. Check for bankruptcy (cash below $0) — bankrupt players are skipped in future turns
3. Pass the turn to the next active player

---

## Win Conditions

**Last player solvent:** When all other players go bankrupt, the remaining player wins automatically.

**Host-triggered end:** The host can click **End Game** at any time. The app ranks all players by net worth:

```
Net Worth = Cash + Property Values + (Shares Owned × Share Price) − Outstanding Debt
```

Highest net worth wins.

---

## Bankruptcy

Falling below $0 cash or ending the turn with unpaid rent triggers final bankruptcy. Bankrupt players can no longer act, their turns are skipped, and pending trade offers involving them are canceled. If bankruptcy is caused by unpaid rent to a player, directly owned properties and player-held corporation shares transfer to that creditor with houses/hotels cleared. If rent is owed to a corporation, directly owned properties transfer to that corporation while player-held shares return to the issuing corporation's treasury share pool. Bank, tax, card, and interest bankruptcies return direct properties to the bank and return player-held shares to the issuing corporation's treasury share pool. Corporation-owned properties remain with the corporation unless the corporation itself becomes insolvent.

---

## Strategy Tips

- **Leverage early.** Issue debt while interest is manageable to buy more properties before others do.
- **IPO fast.** Bundle your cheapest color groups to raise capital through share sales without giving up valuable assets.
- **Watch the interest clock.** Every turn-end drains cash. Over-leveraging compounds quickly and is usually fatal.
- **Use the market tab.** Negotiate trades and package deals — the secondary market is where fortunes shift.

---

## Disclaimer

This is a parody game, not affiliated with Hasbro. Don't try any of this in real life.
