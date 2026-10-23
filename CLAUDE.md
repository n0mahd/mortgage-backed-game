# mortgage-backed-game — Claude Code Context

The project map, architecture rules, hosting and dev/prod rules are in AGENTS.md:

@AGENTS.md

## Keep the Rule Documents Up to Date

The game's rules are written down in four places, and each one must match what the rules engine (`backend/domain/gameRulesInternal/`) actually does:

- `documents/game-rules.md`: the full player rulebook.
- `README.md`: the player-facing summary of how to play.
- `backend/mcp/rules.js`: the rules text AI-agent players read through `get_rules`.
- `backend/domain/actionCatalog.js`: the action descriptions and example payloads agents act on.

Whenever a change adds, removes or alters a rule, an action, a payload field, a price or a limit, update every one of these that mentions it **in the same commit**, then grep them for the old wording to catch leftovers. If you notice any of them describing behaviour the engine no longer has, fix it or flag it to the user; don't leave it. A stale rule text misleads both people and AI players.
