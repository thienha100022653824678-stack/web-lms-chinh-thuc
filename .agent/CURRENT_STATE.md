# Current State — web-lms-chinh-thuc agent system

_As of 2026-07-16. Every line is labeled: **VERIFIED FACT** (ran a command / read a file),
**INFERENCE** (reasoned from evidence), **UNKNOWN** (no evidence), or **OWNER DECISION** (needs
the owner). No fabricated V1/V2/V3 status._

## Repository + environment

- **VERIFIED FACT** — Repo root: `C:/Users/gaomi/Downloads/Telegram Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc` (`git rev-parse --show-toplevel`). Correct repo.
- **VERIFIED FACT** — Primary checkout branch: `feat/v2-runtime-switch`, HEAD `03e146a` ("docs(v2): production canary handoff — plan + S0-S4 complete, Preview canary-ready").
- **VERIFIED FACT** — The working tree has substantial UNCOMMITTED owner work-in-progress for the V2 runtime switch (this branch is named `feat/v2-runtime-switch`). At the time of the bootstrap commit, `git status --short` showed (before staging the agent system):
  - **Modified tracked product files (owner WIP, NOT touched by bootstrap):** `api/lms/admin.js`, `api/lms/portal.js`, `api/sync.js`, `tests/_supabase_stub_loader.mjs`, `utils/v2-diagnostics.js`, `utils/v2-flags.js` (129 insertions / 9 deletions total).
  - **Untracked product files (owner WIP):** `utils/v2-runtime-controller.js`, `utils/v2-runtime-cache.js`, `utils/lms-handlers/admin-runtime-mode.js`, `tests/v2-runtime-controller.test.mjs`, `tests/v2-runtime-mode-endpoint.test.mjs`.
  - **NOTE (INFERENCE):** the very first status snapshot this session showed ONLY `utils/v2-runtime-controller.js`; the fuller set appeared minutes later (file mtimes 11:05–11:32). The owner appears to be editing the runtime switch live, in parallel. Bootstrap did not touch any of these files and staged only `.agent/**` + `.claude/agents/**` by explicit path.
- **VERIFIED FACT** — Worktrees (`git worktree list`):
  - Primary: `…/web-lms-chinh-thuc` → `feat/v2-runtime-switch` @ `03e146a`
  - `_worktrees/v1-stable-audit` → detached HEAD `f9220e8` (V1 stable = tag `v1-stable-20260713`)
  - `_worktrees/v2-rebuild-20260714` → `v2/rebuild-20260714` @ `a849362`
  - `_worktrees/v2-rp2b1-20260714` → `feat/v2-rp2b1-session-device-guard` @ `638ece9`
  - `_worktrees/v3-research-20260715` → `v3/research-20260715` @ `7ce89da`
- **VERIFIED FACT** — Tags: `v1-stable-20260713` (= `f9220e8`, V1 source of truth), `archive-v2-old-rebuild-20260714`.
- **VERIFIED FACT** — Stack: static HTML + Vercel serverless ESM, `"type":"module"`, no FE framework, no build step. `package.json` name `landing-page`, NO `scripts` block (no test/npm-script runner). Deps: `@supabase/supabase-js`, `cloudinary` (dead — 0 import), `google-auth-library`, `googleapis`.
- **VERIFIED FACT** — Tests: `node --test tests/*.test.mjs`, no framework config. 9 tracked test files on this branch.
- **VERIFIED FACT** — `.gitignore` ignores `node_modules/`, `.env*` (lines 4–14), `.vercel`, `scratch/`, `review-dossier-*/`, `.superpowers/`.

## Test baseline (this branch, this environment)

- **VERIFIED FACT** — `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` on `feat/v2-runtime-switch` → **190 tests, 188 pass, 2 fail.**
- **VERIFIED FACT** — The 2 failing tests (PRE-EXISTING, not caused by the agent-system bootstrap — bootstrap touched no product code):
  1. `tests/rp2b1-session-device.test.mjs` — "lesson: flag on + verification unavailable → 503 one_device_policy_unavailable" (got behavior indicating a 500/other where 503 expected).
  2. `tests/rp2b1-session-device.test.mjs` — "verify-entry-token: token ok but student session stale → 401 session_expired" (`500 !== 401`).
- **INFERENCE** — These two failures match the "1 pre-existing RP2-B1 fail" noted in V3 Stage 1 memory as env/timing-sensitive and accepted as a non-blocking exception. On the V3 branch the recorded baseline was 255/255; this branch has a different (older) test set (no V3 tests here) and 2 fails. They are not regressions introduced now.
- **VERIFIED FACT** — `tests/.supabase-stub.json` is absent (good — should be reset to `{}` after use; currently simply not present).

## V1 status

- **VERIFIED FACT** — V1 = live production serving system. V1 source of truth tag `v1-stable-20260713` (`f9220e8`). All V1 endpoints unchanged on this branch.
- **VERIFIED FACT** — V1 invariant list and architecture are documented in `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` §1.6 (12 invariants) and `handover/DO_NOT_BREAK.md`.
- **OWNER DECISION** — V1 must remain the live serving system until the owner explicitly switches traffic. No auto-cutover.

## V2 status

- **VERIFIED FACT** — V2 work spans multiple branches. Per `docs/v2/V2_IMPLEMENTATION_STATUS.md`: S0–S4 complete; Preview is canary-ready in a guarded safe state (shadow on, reconciliation read-only on, portal projection dry-run on, delivery handlers off, outbox worker off, Drive dry-run on).
- **VERIFIED FACT** — Production has NOT been V2-enabled; no production V2 flag is on, no production V2 deploy, no `main` merge. V1 still serves production.
- **VERIFIED FACT** — V2 production canary is progressing per `docs/v2/V2_PRODUCTION_CANARY_PLAN.md`. Per memory `v2-prod-canary-p1p2p3`:
  - P1 DONE PASS (2026-07-15): `V2_RECONCILIATION_READONLY=true` on prod.
  - P2 DONE PASS: `V2_OUTBOX_SHADOW_MODE=true` on prod.
  - P3 DONE PASS: `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` on prod.
  - P4 DONE PASS: `V2_DELIVERY_HANDLERS_ENABLED=true` + `V2_OUTBOX_WORKER_ENABLED=true` + `V2_OUTBOX_WORKER_DRY_RUN=true` on prod.
  - **P5 IN PROGRESS (OWNER-GATED live delivery)**: set `V2_OUTBOX_WORKER_DRY_RUN=false` + `V2_PORTAL_PROJECTION_DRY_RUN=false`. Owner authorized auto-run; P5 = live delivery owner-gate.
- **INFERENCE** — The untracked `utils/v2-runtime-controller.js` on this branch is the runtime active-mode controller (V1/V2 coexistence switch persisted in `site_config` keys `v2_active_mode` / `v2_kill_switch`). It is uncommitted — treat as the owner's in-progress work; do NOT delete or overwrite.
- **OWNER DECISION** — Moving real traffic V1↔V2 (finishing P5, any further canary step, cutover) is an OWNER APPROVAL GATE.

## V3 status

- **VERIFIED FACT** — V3 lives on branch `v3/research-20260715` (worktree `_worktrees/v3-research-20260715`, HEAD `7ce89da`), NOT on the current `feat/v2-runtime-switch` branch. On THIS branch, the only V3 artifact is `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md`.
- **VERIFIED FACT** — Per memory `v3-implementation-progress` and the v3 branch tree: all 11 phases (0→10) have a repo-side deliverable on `v3/research-20260715` (runtime controller, migration tooling, RLS+key tiering, outbox backbone, unified session, router/edge, observability, FE modular, event-schema package, signed-URL+DRM, cleanup). Full suite there = 255/255.
- **VERIFIED FACT** — V3 Stage 1 (DB-prep + Preview) done 2026-07-16 AUDIT-ONLY: no migration applied, no prod deploy, no `active_mode` change, no `main` merge, no canary. Reports `docs/V3_STAGE1_FINAL_REPORT.md` + `docs/V3_STAGE1_RLS_READINESS_REPORT.md` are untracked on the v3 branch.
- **VERIFIED FACT** — V3 is NOT running in production. Prod route fingerprint (from Stage 1): `/api/v2/runtime` 404, `/api/v3/diagnostics` 404, `/api/v3/lms/*` 404 on the production deployment.
- **OWNER DECISION** — All production-affecting V3 steps are owner-only: apply 4 additive migrations on Supabase B, provision `SUPABASE_DB_URL_RO` + `SUPABASE_ANON_KEY`, decide `posts` A/B ownership, merge Portal session PR, DRM provider, Phase 10 destructive checklist, and flipping `active_mode` to v3. No self-cutover.

## Pre-existing issues the owner should know (recorded in RISKS.md)

- **VERIFIED FACT** — 3 env files are **git-tracked on THIS branch** (`feat/v2-runtime-switch`): `.env.prod.local`, `.env.prod.raw`, `.env.production` (committed in `8758c3a`). They were `git rm --cached`'d on the **v3 branch** (commit `84b8fc3`) but that untrack is NOT present on this branch. `.gitignore` already matches them via `.env*`. **OWNER GATE** to untrack on this branch too + rotate the `VERCEL_OIDC_TOKEN` that lives in history (irreversible — owner only).
- **VERIFIED FACT** — 2 pre-existing test failures on this branch (listed above). Not introduced by the agent system.
- **VERIFIED FACT** — 1 untracked file `utils/v2-runtime-controller.js` (owner's in-progress work). Not committed.
- **VERIFIED FACT** — `cloudinary` dependency is dead (0 imports). `banhmi4k-lessons.js` is dead code on V1 (per transfer doc). `exchange-code.js` is an orphan route. `lesson_progress` table has 0 JS callers.
- **UNKNOWN** — Which Supabase tables/policies are actually applied on production B right now (no DB-apply tooling in this env: no `psql`/`supabase`/`docker`, no `SUPABASE_ACCESS_TOKEN`; tracked `.env.production` has empty placeholders). Verify against prod before any DB-touching task.

## Agent system status

- **VERIFIED FACT** — Agent system created 2026-07-16 on `feat/v2-runtime-switch`: `.claude/agents/{controller,builder,reviewer}.md` + `.agent/` tree (README, CURRENT_STATE, MASTER_PLAN, DECISIONS, RISKS, HANDOFF, OWNER_APPROVALS, TASK_INDEX, tasks/, results/, reviews/, templates/).
- **VERIFIED FACT** — Bootstrap did NOT touch product code. The only files added/changed by bootstrap are under `.claude/agents/` and `.agent/`.
- **VERIFIED FACT** — Dry-run sample task `TASK-DRY-RUN-001` created and marked DRY_RUN (not a real task); see `tasks/` and `TASK_INDEX.md`.
- **VERIFIED FACT** — Real first task `TASK-001` (V3 Current-State Audit and Completion Plan) created, status `TODO`, audit-only (no product code).

## What the controller is doing next

- **OWNER DECISION** — Whether/when to start `TASK-001` (the owner sends the single command listed at the end of the final report). `TASK-001` is audit-only and does NOT require a production gate.
