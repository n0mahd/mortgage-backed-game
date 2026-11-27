# GitHub Issue Workflow

This repository uses GitHub Issues as the lightweight roadmap and implementation queue. Keep issues small enough for a focused pull request when possible, and use labels to make the queue easy to filter from GitHub, CLI tools, and Codex MCP.

## Labels

Create and maintain these repository labels:

| Label | Use |
| --- | --- |
| `bug` | Broken, incorrect, or surprising behavior. |
| `feature` | Major roadmap work or new player-facing capabilities. |
| `improvement` | Small UX/product polish, copy improvements, and quality-of-life changes. |
| `tech-debt` | Refactors, testing, cleanup, reliability work, and maintainability improvements. |
| `codex-ready` | The issue is scoped, unblocked, and ready for implementation. |
| `blocked` | The issue cannot move until a decision, dependency, or external state changes. |
| `P0` | Critical production breakage or urgent release blocker. |
| `P1` | High priority, important for the next usable release. |
| `P2` | Normal priority. |
| `P3` | Nice-to-have or opportunistic work. |
| `effort:XS` | Tiny change, usually under an hour. |
| `effort:S` | Small focused change. |
| `effort:M` | Medium change that may touch several files or tests. |
| `effort:L` | Large change that should be broken down when possible. |

## Labeling Rules

- Bugs go in `bug`.
- Small UX/product polish goes in `improvement`.
- Major roadmap work goes in `feature`.
- Refactors, testing, cleanup, and maintainability work go in `tech-debt`.
- Only issues ready for implementation get `codex-ready`.
- Use `blocked` when an issue needs a product decision, access, reproduction steps, or another dependency before implementation can start.
- Add exactly one priority label: `P0`, `P1`, `P2`, or `P3`.
- Add exactly one effort label: `effort:XS`, `effort:S`, `effort:M`, or `effort:L`.

## Codex Picking Guidance

When Codex is asked to pick work from the issue queue, it should prioritize issues with `codex-ready`, then prefer `P0`/`P1` issues and `effort:XS`/`effort:S` issues for quick wins. If an issue is missing acceptance criteria or has `blocked`, Codex should ask for clarification or choose another issue.

Good quick-win filters:

```text
label:codex-ready label:P1 label:effort:XS
label:codex-ready label:P1 label:effort:S
label:codex-ready label:P2 label:effort:XS
```

## Milestones

Use milestones for release or planning buckets, not for issue type. Suggested starter milestones:

- `Next playable release`
- `Mobile polish`
- `Production hardening`
- `Backlog`

## Project Board

If GitHub Projects is available, create a repository or user project named `Mortgage Backed Roadmap` with a single-select status field using these statuses:

- `Backlog`
- `Next`
- `In Progress`
- `Review`
- `Done`

Suggested workflow:

- New issues start in `Backlog`.
- Issues selected for the next work session move to `Next`.
- Active implementation moves to `In Progress`.
- Open PRs move to `Review`.
- Merged or intentionally closed work moves to `Done`.

## Issue Templates

Use the matching issue form when opening work:

- `Bug report`
- `Feature request`
- `Small improvement`
- `Tech debt`

Each template asks for the problem, current behavior, desired behavior, acceptance criteria, and notes for Codex so issues stay implementation-ready.
