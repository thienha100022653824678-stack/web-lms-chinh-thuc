# Risks — web-lms-chinh-thuc

_Append-only. Each risk: severity, evidence, impact, mitigation/owner-action. Labeled VERIFIED
FACT / INFERENCE / UNKNOWN / OWNER DECISION. Recorded 2026-07-16 during agent-system bootstrap._

## R-1 — Tracked env files on this branch (HIGH, security)
- **VERIFIED FACT** — `.env.prod.local`, `.env.prod.raw`, `.env.production` are tracked in HEAD of `feat/v2-runtime-switch` (`git ls-tree -r HEAD` shows all three; added in commit `8758c3a`).
- **VERIFIED FACT** — They were untracked on the v3 branch (`84b8fc3`), but that change is NOT on this branch. `.gitignore` already matches `.env*`, so they are "tracked-despite-ignored".
- **INFERENCE** — Per memory `v3-secret-hygiene-env-untrack`, the committed history carried a populated `VERCEL_OIDC_TOKEN` plus empty placeholders for other secrets.
- **Impact** — Secret material sits in git history. Repo-side untrack does not scrub history.
- **Owner action (OWNER GATE — irreversible):** (1) ROTATE `VERCEL_OIDC_TOKEN` at Vercel FIRST; (2) then history rewrite (`git filter-repo` / BFG) + force-push + collaborator re-clone. On this branch, a controller task can `git rm --cached` the three files (additive, reversible) — but rotation + history rewrite is owner-only. Do NOT print any value.

## R-2 — Two pre-existing test failures (MEDIUM, correctness/regression baseline)
- **VERIFIED FACT** — On `feat/v2-runtime-switch`, `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` → 190/188/2. Failing:
  - `rp2b1-session-device` "lesson: flag on + verification unavailable → 503 one_device_policy_unavailable"
  - `rp2b1-session-device` "verify-entry-token: token ok but student session stale → 401 session_expired" (`500 !== 401`)
- **INFERENCE** — Match the env/timing-sensitive RP2-B1 fail noted as an accepted Stage 1 exception. Not introduced by bootstrap (no product code touched).
- **Impact** — Baseline is not green on this branch. Any future task must distinguish these 2 pre-existing fails from new regressions. The "verify-entry-token stale → 401" case suggests a real error-contract gap (server 500 where a 401 session_expired is expected) that could show students a server error instead of a re-login prompt — worth a dedicated task to confirm on the live code path.
- **Owner action / next** — Candidate for a real builder task AFTER TASK-001 audit (confirm whether it's a test-harness artifact or a genuine 500-instead-of-401 on the lesson/verify-entry-token path).

## R-3 — Uncommitted V2 runtime-switch work-in-progress (HIGH, work-in-progress integrity)
- **VERIFIED FACT** — At bootstrap-commit time the working tree had substantial uncommitted owner WIP for the V2 runtime switch:
  - Modified tracked: `api/lms/admin.js`, `api/lms/portal.js`, `api/sync.js`, `tests/_supabase_stub_loader.mjs`, `utils/v2-diagnostics.js`, `utils/v2-flags.js`.
  - Untracked: `utils/v2-runtime-controller.js`, `utils/v2-runtime-cache.js`, `utils/lms-handlers/admin-runtime-mode.js`, `tests/v2-runtime-controller.test.mjs`, `tests/v2-runtime-mode-endpoint.test.mjs`.
- **INFERENCE** — This is the live `feat/v2-runtime-switch` implementation (runtime active-mode controller + cache + admin mode handler + endpoint + tests). The owner is editing it concurrently with this bootstrap.
- **Impact** — Real, uncommitted work. Any `git add .`, `reset`, `clean`, or `checkout` could destroy or accidentally co-commit it.
- **Mitigation** — Bootstrap staged ONLY `.agent/**` + `.claude/agents/**` by explicit path (`git add .agent/` + `git add -f .claude/agents/*.md`). None of the WIP product files are staged. The bootstrap commit contains zero product-code changes.

## R-4 — Production DB schema state is UNKNOWN from this environment (MEDIUM, data safety)
- **VERIFIED FACT** — No DB-apply tooling here: no `psql`/`supabase`/`docker` on PATH, no `SUPABASE_ACCESS_TOKEN`, tracked `.env.production` holds empty `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` placeholders.
- **Impact** — We cannot verify which migrations/policies are actually applied on Supabase B from here. Memory records prod facts (25 tables, RLS on + 0 policy, `sync_dead_letters` missing, etc.) but those must be re-verified before any DB-touching task.
- **Owner action** — DB inspection/apply is owner-only (Supabase SQL Editor) — OWNER GATE for anything that writes prod.

## R-5 — V2 P5 live delivery is in flight and is an OWNER GATE (HIGH, traffic)
- **VERIFIED FACT** — Memory `v2-prod-canary-p1p2p3`: P5 (set `V2_OUTBOX_WORKER_DRY_RUN=false` + `V2_PORTAL_PROJECTION_DRY_RUN=false`) is IN PROGRESS, owner-authorized auto-run, on production.
- **Impact** — P5 wires LIVE delivery on production. This is OWNER GATE #6 (move real traffic / behavior V1↔V2) and #1/#2-adjacent. The agent system must NOT advance or reverse P5 without explicit owner instruction each step.
- **Mitigation** — Controller treats all canary/cutover steps as OWNER GATES. Bootstrap does not touch prod flags.

## R-6 — Dead/orphan code present (LOW, hygiene)
- **VERIFIED FACT / per transfer doc** — `cloudinary` dep unused (0 imports); `utils/lms-handlers/banhmi4k-lessons.js` dead (0 import); `utils/lms-handlers/exchange-code.js` orphan (no route map); `lesson_progress` table has 0 JS callers.
- **Impact** — Low; cleanup is a Phase-10 destructive-subset item that is owner-gated on the v3 branch.
- **Owner action** — Defer; not in scope for bootstrap or TASK-001.

## R-7 — Docs vs code drift risk (LOW→MEDIUM, trust)
- **VERIFIED FACT** — Rich handover/docs exist (handover/*, docs/v2/*, docs/V3_*). Some columns used in code are absent from the committed `.sql` (schema drift noted in transfer doc §1.3).
- **Impact** — Reports can disagree with code. Rule already in `.agent/README.md`: trust code/git/tests over docs; record contradictions here.
- **Mitigation** — TASK-001 audit will re-derive V3 state from the v3 branch + code, not from docs alone.
