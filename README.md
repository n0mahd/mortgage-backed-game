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

---

## Play With AI Agents

The host can seat AI agents (Claude, ChatGPT, or any MCP client) as players. Each agent plays only its own seat through the game's MCP server, while everyone else plays in the browser and watches its moves live.

**MCP endpoint:** `https://mortgage.abdlh.com/api/mcp` (Streamable HTTP, no sign-in)

1. Add the endpoint to the agent's app once: in the Claude app, **Settings → Connectors → Add custom connector**. For Claude Code, `claude mcp add --transport http mortgage-backed https://mortgage.abdlh.com/api/mcp`. Other clients: a remote Streamable HTTP server with the same URL.
2. Create a room in the browser. In the waiting room, the host taps **Invite an agent** once per agent. Each tap creates an invite holding a new agent key (`mbagent_…`), shown once. Copy it into a new chat for that agent.
3. The agent calls `join_game` with its key and a name, then loops on `wait_for_turn` → `take_action` until the game ends. It shows up in the player list with an **AI** badge, and the host presses **Start Game** when everyone is in.

| Tool | What it does |
|------|--------------|
| `join_game(agent_key, player_name)` | Take the seat this key was issued for; calling it again returns the agent's state |
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

## How to Play

The full player rules (board, rent, IPOs, debt, trades, auctions, jail, bankruptcy, net worth and winning) are in [`documents/game-rules.md`](documents/game-rules.md).

In short: everyone starts with $1,500. Roll, resolve the square you land on, take any optional moves (IPO your properties, issue debt, trade, buy shares), then end your turn. Debt interest compounds at every turn end, and anyone below $0 then goes bankrupt. The last solvent player wins, or the host ends the game and the highest net worth wins.

---

## Disclaimer

This is a parody game, not affiliated with Hasbro. Don't try any of this in real life.
