# Reviewer brief (template)

Fill in `<AREA>`, `<SCREENS>`, `<OUT OF SCOPE>`, `<WEB>`/`<API>` ports and `<SCRATCH>`, then give it to
a sub-agent. Reviewers only read and report.

---

You are auditing the user experience of Mortgage Backed, a multiplayer Monopoly parody web game
(no-build static frontend + Express/SQLite backend). The owner says the app has a chronic problem:
"a ton of unnecessary text or duplicative text or text explaining things that are already clear", users
get fatigued, and the front-end design is weak. Give an honest, opinionated audit of ONE AREA with
concrete fixes. Do NOT edit project files.

## Your area: <AREA>
<SCREENS>
Out of scope (other reviewers): <OUT OF SCOPE>

## Read first
`AGENTS.md` (code map), `documents/design-system.md` (tokens, components, and **Writing → Say less**:
the rules every screen must meet), `.agents/skills/ux-review/audits/backlog.md` (known issues; don't
re-report them unless they're worse, but say if a "shipped" fix didn't hold), and the source for your
screens. Players aren't finance people.

## See it for real (required)
- Start your own servers: `node .agents/skills/ux-review/scripts/servers.js --web <WEB> --api <API>
  --db <SCRATCH>/ux.db` (background; stop it when done). Never use other ports, and never production.
- Stage real states with `.agents/skills/ux-review/scripts/stage.js` (usage at its top) from a script in
  `<SCRATCH>`. Screenshot at 390x844 (full page) and at least a few at 1280x800. Look at every PNG with
  the Read tool, and grep the `.txt` files for repeated facts.

## Report (final message; also save `<SCRATCH>/audit-<area>.md`)
1. Top 5 problems, ranked by how much they hurt a player, each with a screenshot path.
2. A table of every piece of text to change: file:line, current text, verdict (cut / shorten / merge
   with X / move / reword), exact replacement. Be ruthless but correct: keep text that prevents a costly
   mistake whose consequence isn't visible elsewhere.
3. Duplication: each fact shown twice or more on one screen, and which place should win.
4. Structural or visual issues beyond copy (hierarchy, too many sections or tabs, labels so weak they
   need prose, state in words that should be visual, units that force explanations), with a concrete
   fix each. Mark which need the owner's decision.
5. Suspected bugs, separately, with evidence.
No generic UX advice.
