# Fixer brief (template)

One implementation agent per area, each in its own worktree. Fill in `<AREA>`, `<REPORT PATH>`,
`<BRANCH>`, ports, what's out of scope and which structural items to leave alone.

---

Fix the bugs and cut the unnecessary text in <AREA> of Mortgage Backed. Read `AGENTS.md` and
`CLAUDE.md` first and follow them (rule documents, `?v=` cache keys, design system, tests), and
`documents/design-system.md` **Writing → Say less**.

The reviewer's report, with a line-by-line table of text changes and a bug list, is at `<REPORT PATH>`
(screenshots beside it). Line numbers may have drifted; verify each against the code.

## Do
1. Fix every suspected bug you can confirm, with a failing test first where practical. If one turns out
   not to be a bug, or is really a rule question, don't change the rule: list it for the owner.
2. Apply the report's text cuts, rewrites and duplication fixes. Keep text that prevents a costly
   mistake whose consequence isn't visible elsewhere.
3. Leave these structural items alone (they need the owner's choice): <STRUCTURAL ITEMS>.
4. Stay in your area: <OUT OF SCOPE> belongs to other agents.
5. If a rule, action, payload or limit changes, update `documents/game-rules.md`, `README.md`,
   `backend/mcp/rules.js` and `backend/domain/actionCatalog.js` in the same commit. If personal data
   or storage keys change, update `documents/privacy.md`.

## Constraints
- Branch `<BRANCH>`. Commit author `Abdullah <abdullah.akareem@gmail.com>` via
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` if no identity is configured, messages ending with the session's
  co-author line. Focused commits. Don't merge, push or deploy.
- Bump `?v=` of every changed `src/` file on every page that loads it. Other agents bump the same files
  in parallel; the parent resolves it.
- Dev only, ports <WEB>/<API> (see the skill's table). `node scripts/run-e2e.js --web-port <WEB>
  --api-port <API> --db-path <scratch>/e2e.db [--config <wrapper with executablePath>]`.
- Update e2e tests and `.agents/skills/verify-mortgage/scripts/lib/{bot,journeys}.js` when text or ids
  they match on change.
- Verify: `npm run test:static`, `npm run test:architecture`, backend tests if the backend changed, the
  full e2e suite, and after-screenshots at 390px of what changed (look at them).

## Report back
Branch and commits; each bug fixed / not a bug (why) / needs the owner; text changes applied vs
skipped (why); check results with exact counts; screenshot paths; open questions.
