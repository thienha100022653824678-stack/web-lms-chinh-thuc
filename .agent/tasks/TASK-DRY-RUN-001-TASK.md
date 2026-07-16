# Task — TASK-DRY-RUN-001  (DRY RUN — NOT A REAL TASK)

> **This is a bootstrap verification artifact. It is marked DRY_RUN and must NOT be confused with
> real work. It did NOT call the builder on product code.** Keep this file for the audit trail;
> do not dispatch a builder against it.

- **Task ID:** TASK-DRY-RUN-001
- **Title:** Dry-run sample task — verify the controller→reviewer path (read-only)
- **Status:** DRY_RUN _(terminal — not a real task)_
- **Owner:** controller
- **Created (UTC):** 2026-07-16
- **Last updated (UTC):** 2026-07-16

## Purpose
Part G of the bootstrap directive: perform a read-only dry run where (a) the controller inventories
a small scope, (b) a sample task is created that does NOT modify product code, and (c) the reviewer
evaluates that sample task. No builder runs on product code during the dry run.

## What was actually done (VERIFIED FACT)
- **Controller small-scope inventory:** confirmed repo root, branch `feat/v2-runtime-switch`,
  HEAD `03e146a`, the single untracked file `utils/v2-runtime-controller.js`, the 5 worktrees, and
  the test baseline (190/188/2). (All recorded in `CURRENT_STATE.md`.)
- **Sample task created:** this file. It changes no product code — it is itself the sample artifact.
- **Reviewer evaluation:** the reviewer path is exercised by checking that the agent definitions
  load and that a review file can be written; the review of the *bootstrap itself* (the agent
  system + state files) is recorded in `.agent/reviews/TASK-DRY-RUN-001-REVIEW.md`.
- **No builder call on product code:** confirmed — bootstrap touched no file under `api/`, `utils/`,
  `tests/`, `*.html`, `migration_*.sql`, `packages/`, `scripts/`, `supabase/`, `docs/`, `handover/`.

## Acceptance criteria for the dry run
1. Three agent definitions exist and parse (frontmatter + body). ✅
2. The harness recognizes them (Part G check). ✅ (see review file)
3. A sample task + a sample review can be written without touching product code. ✅
4. The dry-run task is clearly marked DRY_RUN so it is not mistaken for real work. ✅

## Owner approval gates
None — read-only bootstrap verification.

## Status
DRY_RUN — complete. Do not dispatch a builder. Real work starts at TASK-001.
