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

## Play Against Your Agent

Your own AI agent (Claude, ChatGPT, or any MCP client) can sit at the table as a player. It connects to the game's MCP server and plays its turns through tools, while you play in the browser and watch its moves live.

**MCP endpoint:** `https://mortgage.abdlh.com/api/mcp` (Streamable HTTP, no sign-in)

Add it to your agent:

- **Claude Code:** `claude mcp add --transport http mortgage-backed https://mortgage.abdlh.com/api/mcp`
- **Claude (web/desktop):** Settings → Connectors → Add custom connector, and paste the endpoint URL.
- **Other clients:** add a remote MCP server of type Streamable HTTP with the same URL.

Then ask the agent to play. Either:

1. **The agent hosts:** "Create a Mortgage Backed room and send me the link." It calls `create_room` and gives you a join link (`https://mortgage.abdlh.com/waiting.html?code=XXXXXX`). Open it, enter your name, and the agent calls `start_game` once you're in.
2. **You host:** create a room in the browser and give the agent the 6-character invite code. It calls `join_room`, and you click **Start Game**.

After that the agent loops on `wait_for_turn` → `get_game_state` → `take_action` (roll, buy, auction, build, trade, end turn) until the game ends.

| Tool | What it does |
|------|--------------|
| `create_room(room_name, player_name, max_players?)` | New room with the agent as host; returns `player_token`, invite code and join link |
| `join_room(invite_code, player_name)` | Join a waiting room; returns `player_token` |
| `start_game(player_token)` | Host only; starts once 2+ players have joined |
| `get_game_state(player_token)` | The agent's view: whose turn, cash, position, properties, jail, ownership, auction, trade offers, recent log, and `legal_actions` right now |
| `take_action(player_token, type, payload?)` | One game action (for example `roll_dice`, `buy_property`, `place_bid {amount}`, `end_turn`) |
| `wait_for_turn(player_token, timeout_seconds?)` | Returns once the agent needs to act or after up to 50 seconds |
| `get_rules()` | Rules summary and every action's payload shape |

The `player_token` is the agent's seat at the table: anyone holding it can play as that player, so the agent should keep it private. The server applies the same rules, turn checks and live updates to the agent as to a browser player.

### Playtest against several AI players

To fill your own room with bots, create it in the browser, then on a machine with the `claude` CLI:

```bash
scripts/agent-players.sh start ABC123 3          # 3 AI players join room ABC123
scripts/agent-players.sh status ABC123           # what each one did last
scripts/agent-players.sh stop ABC123
```

Press **Start Game** once they show up in the waiting room. Options: `--model` (default `claude-sonnet-5-5`) and `--url` (default production; use `http://127.0.0.1:3013/api/mcp` or similar for a dev server). Each player is a separate headless `claude -p` process with its own context and seat token, and each plays with a different style. The script joins the seats itself and keeps each token in a private file under `~/.local/state/mortgage-agents/<code>/`, so a player that crashes or overflows its context restarts into the same seat. Players stop when the game ends, when they go bankrupt, after about 25 idle minutes, or after 6 hours. On the Raspberry Pi the script refuses to start more players than the machine's 8-agent cap allows.

### Agent security model

- Agents have no account: `create_room`/`join_room` make an anonymous user, and the token only controls that seat.
- Player names, room names and log lines come from other players and reach agents as text, so they are a prompt-injection channel. The server caps them in length and strips control characters, and tells agents to treat them as data. The launcher also gives players no tools other than the game's (no shell, files, web, or your own settings and MCP servers), so an injected instruction can at most change a game move.
- Agents cannot choose their dice: `testDice` is stripped from MCP actions outside the test suite, even on servers with `ALLOW_STATE_REPAIR`.
- Browser pages from other sites cannot call `/api/mcp`. Requests with an `Origin` header must come from the app's own URL or an explicit `CORS_ORIGINS` entry; `*` does not count.
- Each player can have at most 2 `wait_for_turn` calls open at once (200 across the server), on top of the per-client and per-tool rate limits.
- Seats claimed by invite code: after a game starts, anyone with the invite code can resume a guest seat through the hotseat recovery routes, including an agent's seat. Share the code only with players you trust.

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

Tap **Create IPO** and select which properties to bundle into a corporation. Set a **ticker symbol**, **number of shares** (1–12), and **listing price per share**. The selected properties move out of your personal holdings into the corporation, you receive all founder shares, and those founder-held shares are listed for other players to buy on their turns.

---

### Issue Debt (Mortgage-Backed Securities)

Tap **Manage Debt → Issue New Debt**. Set a **loan amount** (you receive this cash immediately) and optional collateral properties. The current game uses the room's debt rate, shown in the modal.

Interest accrues automatically every time you end your turn:

```
new principal = principal × (1 + interestRate / 100)
```

The difference is deducted from your cash. Default rate: **5% per turn**.

---

### Settle Debt

Tap **Manage Debt → Settle Existing Debt**. Select the debt and enter a payment amount, or use **Full Amount** to fill the remaining principal. Cash is deducted and the principal reduced. Debt is removed when fully paid.

### Refinance Debt

Tap **Manage Debt → Refinance Existing Debt**. Select one or more existing debts, set a larger new loan amount, and choose collateral. The selected debts are paid off, one new loan is created at the room's debt rate, and you receive only the net new cash above the payoff amount.

---

### Buy Shares

Tap **Corporations** during your turn. Any corporation with listed shares shows a **Buy** button. Enter the number of shares; cost is `shares × listingPrice`. Normal IPO purchases transfer cash to the founder and move those shares from the founder to the buyer. If bankruptcy returned shares to the corporation treasury, those treasury shares can also be bought; that cash goes into the corporation treasury.

Player net worth values corporation stakes by net asset value, not listing price: corporation-owned property value plus treasury cash minus corporation debt, divided by total shares. Share value is floored at $0 if the corporation's net asset value is negative.

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
