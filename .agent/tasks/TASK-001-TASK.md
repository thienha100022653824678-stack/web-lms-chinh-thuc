# Task — TASK-001

- **Task ID:** TASK-001
- **Title:** V3 Current-State Audit and Completion Plan
- **Status:** TODO
- **Owner:** unassigned _(controller dispatches when the owner starts it)_
- **Created (UTC):** 2026-07-16
- **Last updated (UTC):** 2026-07-16

## Business goal
Produce an evidence-based picture of where the V3 platform rebuild stands today and a concrete,
ordered plan for what remains so the owner can switch V1/V2/V3 via a runtime switch — without
guessing, and without anyone touching production in this task.

## Current evidence
- **VERIFIED FACT** — V3 lives on branch `v3/research-20260715` (worktree
  `_worktrees/v3-research-20260715`, HEAD `7ce89da`). On `feat/v2-runtime-switch` (this branch)
  the only V3 artifact is `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md`.
- **VERIFIED FACT** — Per `git ls-tree -r v3/research-20260715`, the v3 branch has: `api/v2/runtime.js`,
  `api/v3/diagnostics.js`, `api/v3/lms/[endpoint].js`, `utils/v3-*.js` (implied by tests),
  `migration_v3_*.sql` (runtime_config, rls_policies, outbox_dead_letters, formalize_drift_columns),
  `packages/v3-event-schema/`, `scripts/v3/{preflight,postflight}-v3.sql`, and `tests/v3-*.test.mjs`
  + `tests/runtime-controller.test.mjs`.
- **VERIFIED FACT** — Memory `v3-implementation-progress`: all 11 phases (0→10) have a repo-side
  deliverable on the v3 branch; full suite 255/255 there; remaining work is owner-only (apply 4
  additive migrations on B, provision `SUPABASE_DB_URL_RO` + `SUPABASE_ANON_KEY`, decide `posts`
  ownership, merge Portal session PR, DRM provider, Phase-10 destructive checklist, flip
  `active_mode`→v3).
- **VERIFIED FACT** — V3 Stage 1 (2026-07-16) was audit-only: no migration applied, no prod deploy,
  no `active_mode` change, no `main` merge, no canary. Prod route fingerprint: `/api/v2/runtime`
  404, `/api/v3/diagnostics` 404, `/api/v3/lms/*` 404.
- **INFERENCE** — V3 is "repo-complete but not production-wired." The gap to a runtime switch is
  primarily integration/apply/provision, not new feature code — but this task must verify that
  against the actual v3 branch, not trust the memory.

## Repository
- **Repo:** web-lms-chinh-thuc
- **Required branch:** read `v3/research-20260715` (worktree `_worktrees/v3-research-20260715`) for
  V3 code/tests/docs; also read this branch `feat/v2-runtime-switch` for `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md`
  and the untracked `utils/v2-runtime-controller.js` (read-only).
- **Required worktree:** `_worktrees/v3-research-20260715` for V3 inspection; primary for the V2
  runtime controller. Do NOT switch the primary checkout's branch.
- **Base commit (expected):** `v3/research-20260715` @ `7ce89da`; primary `feat/v2-runtime-switch` @ `03e146a`.

## Dependencies
- **Depends on (task IDs):** none (bootstrap complete).
- **Blocks (task IDs):** the first V3 implementation task (to be created from this task's plan).

## Scope
- **In scope:**
  - Read-only inventory of the v3 branch: which `utils/v3-*`, `api/v3/*`, `migration_v3_*`,
    `packages/v3-event-schema/*`, `tests/v3-*` exist; what each phase doc claims vs. what the code
    shows.
  - Run the V3 test suite in the v3 worktree (`LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs`
    inside `_worktrees/v3-research-20260715`) and record the real pass/fail count.
  - Determine what is missing for a V1/V2/V3 runtime switch: is there a single `active_mode`
    controller on the v3 branch (analogous to the untracked `utils/v2-runtime-controller.js` on
    this branch)? what gates each mode? what is the rollback?
  - Enumerate data / session / routing / feature-flag / rollback risks for switching.
  - Enumerate missing tests (e.g. the 2 pre-existing RP2-B1 fails on this branch — do they exist
    on the v3 branch too? is the 500-vs-401 contract gap real in the code?).
  - Propose the ordered next-task sequence (each future task as a one-line candidate with its
    branch/worktree, allowed files, required tests, rollback, and which of the 9 owner-gates it hits).
- **Out of scope:**
  - Any product-code change (no edits to `api/`, `utils/`, `*.html`, `migration_*.sql`, `packages/`).
  - Applying any migration on any DB.
  - Any deploy, any `active_mode` change, any `main` merge, any cutover, any canary step.
  - Touching `utils/v2-runtime-controller.js` (untracked owner WIP — read only).
  - Pushing anything to the Portal repo.

## Files
- **Files allowed to change:** only files under `.agent/` — specifically write
  `.agent/results/TASK-001-RESULT.md` (the audit + plan). Update `.agent/CURRENT_STATE.md`,
  `.agent/TASK_INDEX.md`, `.agent/DECISIONS.md`, `.agent/RISKS.md`, `.agent/HANDOFF.md`,
  `.agent/MASTER_PLAN.md` as needed. The reviewer writes `.agent/reviews/TASK-001-REVIEW.md`.
- **Files forbidden to change:** everything under `api/`, `utils/`, `tests/`, `packages/`,
  `*.html`, `migration_*.sql`, `scripts/`, `supabase/`, `docs/`, `handover/`, plus `main`, tag
  `v1-stable-20260713`, and any Portal repo file. Do not modify `utils/v2-runtime-controller.js`.

## Requirements
- **Functional requirements:**
  1. Produce a verified inventory of V3 deliverables on `v3/research-20260715` (file list per phase,
     cross-checked against the phase docs and the memory).
  2. Record the real V3 test-suite result (run it in the v3 worktree; report total/pass/fail and
     any failing test names).
  3. State, with evidence, what is DONE vs IN-PROGRESS vs MISSING for a V1/V2/V3 runtime switch.
  4. Identify the runtime-switch mechanism on the v3 branch (controller file, config keys, gate
     function, fail-open/fail-closed behavior) and compare with the untracked V2 runtime controller.
  5. Produce a regression/risk matrix for switching (data, session, routing, feature-flag, rollback)
     covering V1, V2, V3.
  6. Propose an ordered next-task sequence (≥3 candidate tasks), each with branch/worktree, allowed
     files, required tests, rollback, and owner-gate flags.
- **Security requirements:** none directly (read-only), BUT the audit must call out any
  auth/session/CORS/secret/RLS risk it observes in the V3 code (e.g. the RLS migration that is
  owner-applied, the `SUPABASE_ANON_KEY` provisioning gap, the fail-closed behavior).
- **Required tests:** run `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` in the v3 worktree
  and record the result. No new tests required (this task writes no code).

## Acceptance criteria
1. `.agent/results/TASK-001-RESULT.md` exists and contains: verified V3 inventory, real test-suite
   counts, DONE/IN-PROGRESS/MISSING table, runtime-switch mechanism description, risk matrix, and
   an ordered ≥3-task next-task plan.
2. Every claim is labeled VERIFIED FACT / INFERENCE / UNKNOWN / OWNER DECISION and backed by a
   command or file reference.
3. No file outside `.agent/` was modified (`git status --short` in the primary worktree shows no
   product change; the v3 worktree is left clean).
4. The reviewer returns PASS or PASS_WITH_CONDITIONS (the audit is evidence-based and the plan is
   concrete). If the reviewer finds unsupported claims or scope violations, the task loops.

## Rollback requirement
This task changes only `.agent/` markdown. Rollback = delete or revert the `.agent/` files it
wrote. No data, no deploy, no migration, no traffic impact.

## Owner approval gates
**None — safe to auto-run.** This task is read-only across the repo + v3 worktree and writes only
`.agent/` markdown. It does not deploy, apply migrations, move traffic, touch secrets, or modify
production. (It will LIST owner-gated next steps; it does not perform them.)

## Migration status (if a migration is involved)
_(No migration in this task — audit only.)_

## Notes
- Use the Explore/general-purpose agent or dispatch a read-only research pass to read the v3
  branch; do not switch the primary checkout's branch (that would disturb the untracked
  `utils/v2-runtime-controller.js`).
- The v3 worktree is at `_worktrees/v3-research-20260715`; run commands there with an explicit
  working directory or `git -C`.
- Do not trust memory or docs alone — verify against the actual v3 branch tree and code. If a
  memory claim disagrees with the code, record it in `.agent/RISKS.md`.
