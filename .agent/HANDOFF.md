# Handoff — agent-system bootstrap complete, TASK-001 pending start

_This file lets a fresh Claude Code session resume with NO chat history. Read this first, then the
pointers at the bottom._

- **Written at (UTC):** 2026-07-16
- **Written by:** main session (acting as controller during bootstrap)
- **Reason:** Bootstrap complete; ready to start TASK-001, but starting it is the owner's call.

## Where the repo is right now

- **Repo:** web-lms-chinh-thuc
- **Primary checkout branch:** `feat/v2-runtime-switch`, HEAD `03e146a`
- **Working tree status:** substantial UNCOMMITTED owner WIP for the V2 runtime switch — modified tracked (`api/lms/admin.js`, `api/lms/portal.js`, `api/sync.js`, `tests/_supabase_stub_loader.mjs`, `utils/v2-diagnostics.js`, `utils/v2-flags.js`) + untracked (`utils/v2-runtime-controller.js`, `utils/v2-runtime-cache.js`, `utils/lms-handlers/admin-runtime-mode.js`, `tests/v2-runtime-controller.test.mjs`, `tests/v2-runtime-mode-endpoint.test.mjs`). This is the owner's in-progress `feat/v2-runtime-switch` work — do NOT touch. The bootstrap commit staged only `.agent/**` + `.claude/agents/**` by explicit path; zero product code is in that commit.
- **Active worktrees:**
  - Primary `…/web-lms-chinh-thuc` → `feat/v2-runtime-switch` @ `03e146a`
  - `_worktrees/v1-stable-audit` → detached `f9220e8` (= tag `v1-stable-20260713`, V1 source of truth)
  - `_worktrees/v2-rebuild-20260714` → `v2/rebuild-20260714` @ `a849362`
  - `_worktrees/v2-rp2b1-20260714` → `feat/v2-rp2b1-session-device-guard` @ `638ece9`
  - `_worktrees/v3-research-20260715` → `v3/research-20260715` @ `7ce89da`
- **Uncommitted changes NOT part of the current task:** the full V2 runtime-switch WIP set listed above (owner's; leave it). The bootstrap commit stages only `.claude/agents/**` + `.agent/**` by explicit path (`git add .agent/` + `git add -f .claude/agents/*.md`); `.claude/` is gitignored, so the three agent files required `git add -f`.

## Current task in flight

- **Task ID:** TASK-001 — V3 Current-State Audit and Completion Plan
- **Status:** TODO (created, not started)
- **Owner (builder):** unassigned
- **Branch / worktree:** read across `v3/research-20260715` worktree `_worktrees/v3-research-20260715` + this branch for docs; writes only to `.agent/`.
- **Last result file:** _(none yet)_
- **Last review file:** _(none yet)_
- **Last review verdict:** _(pending)_
- **What is done so far:** task file written at `.agent/tasks/TASK-001-TASK.md`; recorded in TASK_INDEX.
- **What remains:** dispatch builder/agent to perform the audit and produce the completion plan (a `.agent/results/TASK-001-RESULT.md`-style report, even though no code is written — reviewer verifies the audit is evidence-based).

## What to do next (the very next action)

The owner starts TASK-001 by sending the single command at the bottom of the bootstrap report
(equivalently): **invoke the `controller` agent with "Start TASK-001 per .agent/tasks/TASK-001-TASK.md."**

The controller will:
1. Verify env (branch/worktree/status) read-only.
2. Dispatch the audit (builder or a read-only research pass) over `v3/research-20260715` + docs + code — read-only, no product code, no migration apply, no deploy.
3. Produce the V3 completion plan in `.agent/results/TASK-001-RESULT.md`.
4. Have the reviewer verify the audit is evidence-based (PASS/conditions/FAIL).
5. Update CURRENT_STATE, TASK_INDEX, DECISIONS, RISKS, and this HANDOFF.

Do NOT start any V3 product-code fix in TASK-001. Do NOT deploy. Do NOT apply migrations. Do NOT move traffic.

## Open OWNER APPROVAL GATES

- **V2 P5 live delivery** (in flight, owner-authorized auto-run) — do not advance/reverse without explicit owner instruction each step. (RISKS R-5)
- **Tracked env files on this branch** — `git rm --cached` is additive/reversible and could be a controller task, but rotating `VERCEL_OIDC_TOKEN` + history rewrite is owner-only. (RISKS R-1)
- **Any V3 prod step** (apply migrations on B, provision `SUPABASE_DB_URL_RO`/`SUPABASE_ANON_KEY`, `posts` ownership, Portal PR merge, DRM provider, Phase-10 destructive checklist, `active_mode`→v3) — owner-only.

## Open risks (summary — full list in .agent/RISKS.md)

1. R-1 — 3 env files tracked on this branch (security; owner-gated rotation + history rewrite).
2. R-2 — 2 pre-existing test failures on this branch (`rp2b1-session-device` 503 + 401 cases).
3. R-3 — untracked `utils/v2-runtime-controller.js` (owner's WIP; do not touch).
4. R-4 — prod DB schema state UNKNOWN from this env (no DB tooling/credentials here).
5. R-5 — V2 P5 live delivery in flight, OWNER GATE.

## Pointers a fresh session must read first

1. `.agent/README.md` — the flow and the rules.
2. `.agent/CURRENT_STATE.md` — where things stand.
3. `.agent/TASK_INDEX.md` — every task and its status.
4. `.agent/DECISIONS.md` — decisions already made (do not re-litigate).
5. `.agent/RISKS.md` — known risks + pre-existing issues.
6. `.agent/OWNER_APPROVALS.md` — what is owner-gated and what has been approved.
7. `.agent/tasks/TASK-001-TASK.md` — the next task.

## Things NOT to do (this cycle)

- Do NOT start V3 product-code fixes — TASK-001 is audit-only.
- Do NOT commit `utils/v2-runtime-controller.js` or any of the V2 runtime-switch WIP files — they are the owner's uncommitted work. The bootstrap commit stages only `.agent/**` + `.claude/agents/**`.
- Do NOT `git add .` — stage by explicit path only.
- Do NOT run prod migrations, deploy, or move V1/V2/V3 traffic (OWNER GATES).
- Do NOT print or read secret values (check env var existence by name only).
- Do NOT modify `main` or touch tag `v1-stable-20260713`.
