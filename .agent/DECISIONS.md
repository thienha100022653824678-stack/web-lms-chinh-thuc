# Decisions — web-lms-chinh-thuc agent system

_Append-only. Each decision: what, why, date. Do not re-litigate decisions here without new evidence._

## D-1 — Bootstrap runs on `feat/v2-runtime-switch`, the current primary checkout (2026-07-16)
- **What** — Built the agent system (`.claude/agents/*`, `.agent/*`) on the branch the session was opened on, rather than switching to `v3/research-20260715` or `main`.
- **Why** — The user's directive is to build the agent system in THIS repository; the active worktree is `feat/v2-runtime-switch` @ `03e146a`. Switching branches would risk the untracked `utils/v2-runtime-controller.js` and would be an unrequested branch change. The agent system is branch-agnostic admin infra; it belongs on the working branch and can be merged/cherry-picked later.
- **Bound** — Did NOT touch `main`, did NOT touch `v1-stable-20260713`, did NOT switch branches.

## D-2 — Bootstrap touches NO product code (2026-07-16)
- **What** — The only files created by bootstrap are under `.claude/agents/` and `.agent/`. No file under `api/`, `utils/`, `tests/`, `*.html`, `migration_*.sql`, etc. was modified.
- **Why** — The builder-only-edits-product-code rule and the "bootstrap does not start V3 fixes" rule. Keeps the 2 pre-existing test failures attributable (not to bootstrap) and keeps `utils/v2-runtime-controller.js` untracked work intact.
- **Verification** — `git status --short` after bootstrap shows only the new `.claude/agents/*` + `.agent/*` files plus the pre-existing untracked `utils/v2-runtime-controller.js`. No tracked product file is modified.

## D-3 — Custom-agent definitions use the harness frontmatter format (2026-07-16)
- **What** — `.claude/agents/{controller,builder,reviewer}.md` each start with `name` + `description` (+ `tools` restricted to what each role needs) frontmatter, followed by the full system prompt body.
- **Why** — That is the format Claude Code loads as custom subagents (see Part G verification). Controller gets read/search/bash/write/edit + Task + web; builder gets read/search/bash/write/edit (no Task — it does not dispatch); reviewer gets read/search/bash/write/edit (writes only to `.agent/reviews/`).
- **Note on nesting** — If the current harness config does not allow the controller to *invoke* builder/reviewer as nested subagents, the controller returns a handoff instruction to the main session, which performs the dispatch. This is stated explicitly in `controller.md`.

## D-4 — Migration status tags are builder-limited (2026-07-16)
- **What** — Builders may set a migration tag only to `CREATED_ONLY` or `TESTED_LOCAL`. `APPLIED_STAGING` / `APPLIED_PRODUCTION` are owner-only.
- **Why** — Applying a migration on staging/production is OWNER GATE #2. No self-set `APPLIED_PRODUCTION` ever.

## D-5 — The untracked `utils/v2-runtime-controller.js` is left uncommitted (2026-07-16)
- **What** — Bootstrap did not commit, stage, move, or delete `utils/v2-runtime-controller.js`.
- **Why** — It is the owner's in-progress work on the `feat/v2-runtime-switch` branch. Committing someone else's in-progress file (or `git add .`-ing it) violates the guardrails. The bootstrap commit, if made, stages ONLY `.claude/agents/**` and `.agent/**` by explicit path.
- **Status** — See RISKS.md R-3.

## D-6 — TASK-001 is audit-only, no product code (2026-07-16)
- **What** — The first real task is `TASK-001 — V3 Current-State Audit and Completion Plan`: inventory V3 done/in-progress/missing, risks, missing tests, and propose the next task sequence. It does NOT modify product code.
- **Why** — The user's directive: bootstrap must not start V3 fixes in the same task; audit first so the controller has an evidence-based plan before any build task.
- **Scope** — Read-only across the v3 branch/worktree + docs + code; writes only to `.agent/` (a new result/plan doc). No migration apply, no deploy, no cutover.
