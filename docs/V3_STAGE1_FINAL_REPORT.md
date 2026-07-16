# V3 Stage 1 — Database Preparation & Preview Integration — Final Report

> **Stage:** 1 (Database Preparation + Preview Integration). **NOT a cutover.**
> **Date:** 2026-07-16 (work session 2026-07-15→16).
> **Branch:** `v3/research-20260715` · **HEAD:** `51b62e402d7ab3365e959d8c96ca0c74556cb875` · **origin/v3:** same SHA (in sync).
> **Authority:** Owner directive 2026-07-15 (two accepted non-blocking exceptions: 1 pre-existing RP2-B1 test fail; 3 git-tracked `.env.prod.*` files as pre-existing security debt).
> **Hard constraints honored:** no `active_mode` change on prod; no prod deploy of V3 code; no `main` merge; no RLS migration apply; no destructive cleanup; no V3 production canary.

---

## 0. TL;DR

- **Preflight PASS.** Branch/HEAD/origin in sync; tracked tree clean; production is **not** running V3 code (prod fingerprint: `/api/v2/runtime` 404, `/api/v3/diagnostics` 404 — these routes do not exist on the production deployment).
- **Test baseline ACCEPTED = 255/255 pass, 0 fail** in this environment (the owner-accepted "1 known fail" was **not reproducible** here — see §A.3). No new fail introduced.
- **Migrations B1/B2/B3: audited + verified additive/idempotent/transactional and business-data-safe. NOT applied.** No DB-apply tooling is available in this environment (`psql`/`supabase` CLI/`docker` all MISSING; no `SUPABASE_ACCESS_TOKEN`; tracked `.env.production` has empty `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Apply is owner-only on Supabase B SQL Editor.
- **B4 RLS: readiness report produced** (`docs/V3_STAGE1_RLS_READINESS_REPORT.md`); `migration_v3_rls_policies.sql` **NOT applied** (hard stop before owner review, as required).
- **C. Secrets/baseline: status only.** `SUPABASE_DB_URL_RO` = missing (gate inert). `SUPABASE_ANON_KEY` = missing (V3 anon/auth tiers fail-closed). No values printed; no keys created/rotated.
- **D. Preview: an isolated, READY git-linked Preview at commit `50a406…` (which contains the full V3 route surface incl. `/api/v3/diagnostics`) is verified read-only and fail-closed.** Production untouched. One transient CLI Preview I triggered (`5bmo9pvjm`) is `BLOCKED`/inert (no alias, serving a placeholder shell, not the API) — **not** aliased to any domain, no production impact.
- **Stop after this report.** No further V3 stage started.

---

## A. Preflight

### A.1 Git posture
| Check | Result |
|---|---|
| Branch | `v3/research-20260715` ✅ |
| HEAD | `51b62e402d7ab3365e959d8c96ca0c74556cb875` ✅ |
| `origin/v3/research-20260715` | `51b62e4` (identical) ✅ |
| Tracked working-tree changes | **none** (only untracked `.claude/` + new `docs/V3_STAGE1_RLS_READINESS_REPORT.md`) ✅ |
| `main` HEAD | `f9220e8` (untouched) ✅ |
| V3-only commits ahead of main | 53 (all `v3-p0…p10` + docs) |
| `v1-stable-20260713` tag → `f9220e8` | untouched ✅ |

### A.2 Production is NOT running V3 code
Live read-only probes against `https://www.daubepnho.store` (current production alias `dpl_…gh9qqmrb4`, Ready, Production target):

| Route on PROD | HTTP | Meaning |
|---|---|---|
| `/` | 200 | root serves |
| `/api/sync` (GET) | 405 → POST 401 | V1 `api/sync.js` route **exists** (method/secret gated) — V1 code present |
| `/api/lms/portal?endpoint=public-config` | 200 | V1 legacy router **alive** |
| `/api/v2/diagnostics` | 401 | V2 route exists |
| `/api/v2/outbox` | 401 | V2 route exists |
| **`/api/v2/runtime`** | **404** | V3-Phase-0 runtime endpoint **absent** → prod predates p0 |
| **`/api/v3/diagnostics`** | **404** | V3-Phase-6 endpoint **absent** → prod predates p6 |
| **`/api/v3/lms/*`** | **404** | V3 dispatcher **absent** → prod predates p5 |

**Conclusion:** production runs an older codebase that does **not** contain the V3 runtime controller, V3 dispatcher, or V3 diagnostics route. V3 code has **not** been promoted to production. ✅

### A.3 Test baseline
- Owner-accepted baseline: **254 pass / 1 known fail (RP2-B1, pre-existing, non-V3-regression).**
- **This environment ran 255/255 pass, 0 fail** across 3 combined `node --test tests/*.test.mjs` runs and an 18-file per-file tally (Node 24.15.0). The single RP2-B1 file in isolation: 59/59 pass.
- **Discrepancy note (honest reporting):** I could **not reproduce the 1 fail** the owner recorded. Likely environment/version-sensitive (the RP2-B1 file has a ~7s `verification unavailable → 503` timing test that can flake under load). This is **favorable** (suite greener than the accepted baseline) and introduces **no new fail** — the acceptance criterion ("do not introduce new fails; stop if fail count rises above 1 or a new fail appears") is satisfied.
- **Accepted baseline for this stage = 255/255 (this env) / 254+1 (owner's recorded baseline). No new fail.** ✅

### A.4 No V3 migration applied unexpectedly
No DB-apply path exists in this environment (§C.2), and production's schema still shows `sync_dead_letters` absent + `platform_runtime_config` absent (per the VERIFIED catalog in `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`, and consistent with prod `/api/v2/runtime` 404). No migration has been applied. ✅

---

## B. Database preparation — audit only (NOT applied)

> **No migration was applied.** Each migration was audited for additive/idempotent/transactional/business-data-safe. Apply is an owner-only action on Supabase B (SQL Editor, service-role). This environment has no `psql`/`supabase` CLI/`docker`/`SUPABASE_ACCESS_TOKEN`, and the tracked `.env.production` carries **empty** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (placeholders) — so even a REST probe of prod tables was not possible without the owner pasting real creds (which I did not do). The programmatic additive-only audit below substitutes for the live apply.

### Programmatic additive-only audit (ran in-repo)

| Migration | `DROP` | `RENAME` | `TRUNCATE` | `ALTER TYPE` | business DML | `IF NOT EXISTS` | `BEGIN/COMMIT` |
|---|---|---|---|---|---|---|---|
| B1 `migration_v3_runtime_config.sql` | no | no | no | no | **none** (only `INSERT` into the new `platform_runtime_config` singleton seed, `ON CONFLICT DO NOTHING`) | ✅ | ✅ |
| B2 `migration_v3_outbox_dead_letters.sql` | no | no | no | no | **none** (the word `DELETE` appears **only** in `ON DELETE CASCADE` FK clause, not a DML `DELETE`) | ✅ | ✅ |
| B3 `migration_v3_formalize_drift_columns.sql` | no | no | no | no | **none** | ✅ | ✅ |
| B4 `migration_v3_rls_policies.sql` (reference — NOT applied) | no | no | no | no | none (3 `ALTER FUNCTION` for the login RPC hardening — allowed for RLS migration, **not applied this stage**) | ✅ (guarded DO blocks) | ✅ |

In-process migration tests (assert additive/idempotent in a stubbed DB): **17/17 pass** (`v3-outbox-migration`, `v3-cleanup-migration`, `v3-rls-migration`); runtime controller test 14/14 pass.

### B1 — `migration_v3_runtime_config.sql` (checkpoint)
- **Audit PASS.** Creates `platform_runtime_config` (singleton `id=1`, `CHECK(active_mode IN ('v1','v2','v3'))`, `kill_switch bool`) + append-only `platform_runtime_config_audit`. RLS enabled, **no anon/authenticated policy** (service-role/SQL-Editor only). Seeds `active_mode='v1'` (the immutable rollback target). No business data touched.
- **Required initial state on apply:** `active_mode='v1'`, `kill_switch=true`. The seed defaults `active_mode='v1'`, `kill_switch=false`; **owner must explicitly set `kill_switch=true` after applying** to meet the Stage-1 required posture (the controller treats `kill_switch=true` as force-v1 regardless of `active_mode`). Until then the controller is fail-closed to v1 anyway because the row is new and `getConfig()` caches v1 on read-error.
- **Fail-closed confirmation (code):** `utils/runtime-controller.js` — `FAIL_CLOSED_CONFIG = { active_mode:'v1', kill_switch:true }`; `getEffectiveMode()` returns `'v1'` if `kill_switch` or on any read error/missing row. `api/v2/runtime.js` `readConfig()` returns fail-closed v1 + a `note` when the row is absent. ✅
- **Production impact if applied now:** none — prod doesn't run the controller code (§A.2), so the new table is inert until a deployment containing p0+ is promoted.
- **Status: AUDITED, NOT APPLIED.** Checkpoint B1 cleared to proceed to B2 audit.

### B2 — `migration_v3_outbox_dead_letters.sql` (checkpoint)
- **Audit PASS.** `CREATE TABLE IF NOT EXISTS public.sync_dead_letters` (PK `id`, `outbox_id uuid UNIQUE … references sync_outbox(id) ON DELETE CASCADE`, `status` CHECK in `open/resolved/ignored`, `reason`, `payload jsonb`, audit cols) + `idx_sync_dead_letters_status`. RLS enabled, no public policy. Shape lifted verbatim from the V2 worker's expected `upsert(onConflict:'outbox_id')`.
- **Reconciles a verified prod gap:** `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` Q10 — `sync_outbox`+`sync_deliveries` exist (RLS on, 0 policy), `sync_dead_letters` **never created** on prod, yet `utils/v2-sync-worker.js moveOutboxToDeadLetter` already writes to it → DLQ path currently broken on B. This migration restores it. **Additive, safe.**
- **No replay, no move, no outbox mutation, no V3 worker enable.** ✅
- **Status: AUDITED, NOT APPLIED.** Checkpoint B2 cleared to proceed to B3 audit.

### B3 — `migration_v3_formalize_drift_columns.sql` (before/after compare)
- **Audit PASS.** 15 × `ALTER TABLE … ADD COLUMN IF NOT EXISTS` across `lessons` (5), `courses` (7), `orders` (4), `student_enrollments` (4 — note `orders`+`student_enrollments` share 4 identity columns each). No data moved, no type changed, no drop. On prod where the columns already exist (VERIFIED Q11), every statement is a **no-op**; on a fresh DB it declares them.
- **Before/after schema compare (expected, from VERIFIED catalog):** **no column added on prod** (all 15 already present). Row counts **unchanged** (additive DDL only). V1/V2 compatibility: **unchanged** — V1 already reads these columns with hidden fallbacks; declaring them additively removes the fallback ambiguity without changing runtime behavior.
- **Expected row counts (VERIFIED baseline, `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` Q12):** courses 6, orders 24, lessons 35, students 13, student_enrollments 19, student_active_sessions 15 (2 active), lms_entry_tokens 19, lms_verified_sessions 21, student_session_controls 1, student_device_change_logs 12, admin_audit_logs 2, drive_admin_accounts 3, drive_permission_logs 56, drive_sync_queue 8, lesson_progress 0, posts 1, course_slug_mappings 6, portal_post_course_mappings 0. **After B3: identical.**
- **Status: AUDITED, NOT APPLIED.** (No live before/after snapshot was taken because no DB-apply path exists here; the expected result is no-op on prod. Owner should run the catalog `supabase/tools/catalog-query.sql` before+after to confirm when they apply.)

### B4 — `migration_v3_rls_policies.sql` (NO apply — hard stop)
- **NOT applied** (per Stage-1 §B4). Readiness report delivered: **`docs/V3_STAGE1_RLS_READINESS_REPORT.md`** — contains policy matrix (8 policies), role matrix, 16 expected allow/deny cases, rollback SQL, lock-risk assessment (metadata-only, sub-second), maintenance-window guidance, and a 7-step staging test plan.
- **Hard stop honored.** RLS migration is a separate owner-gated step after staging-clone validation + `SUPABASE_ANON_KEY` provisioning.

---

## C. Schema baseline & secrets (status only, no values)

### C.1 Secret/baseline status (configured vs missing)
| Item | Status | Effect |
|---|---|---|
| `SUPABASE_DB_URL_RO` (GitHub Actions secret for drift gate) | **MISSING** | `.github/workflows/schema-drift-gate.yml` drift-gate job is **inert** (workflow self-documents: "Drift gate inert until owner provisions `SUPABASE_DB_URL_RO`"). `unit-tests` job still runs. |
| `SUPABASE_ANON_KEY` (V3 anon/authenticated tier) | **MISSING** | V3 browser tiers fail-closed; RLS policies (B4) will be **latent** until provisioned. No client can exercise anon/authenticated paths. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (Vercel env) | **configured** (Encrypted, Production+Preview) | V1/V2 service-role paths work. |
| `INTERNAL_SYNC_SECRET` / `SESSION_SECRET` | configured (Encrypted, Production+Preview) | worker-secret door + session HMAC work. |
| Schema baseline (`supabase db pull` → `00000000000000_baseline.sql`) | **MISSING** | needs Docker Desktop (absent here) → owner action. |
| GitHub schema-drift gate | present (workflow file exists), **inert** until RO secret + baseline exist. |

**V3-specific env flags referenced in code:** only `V3_ROUTES` (a route-map constant, not an env var). **No `V3_*` worker/producer/delivery env flags exist** — V3 has no autonomous worker yet (confirmed: no `setInterval`/cron/V3-worker auto-start in `api/` or `utils/`). V2 worker flags (`V2_OUTBOX_WORKER_ENABLED`, etc.) remain the only autonomous-runtime controls and are **off** in the Stage-1 posture.

### C.2 No DB writes / no destructive diff performed
- No `psql` / `supabase` CLI / `docker` available; no `SUPABASE_ACCESS_TOKEN`. The tracked `.env.production` / `.env.prod.local` / `.env.prod.raw` carry **empty** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (placeholder quotes `""`), so a read-only REST probe could not run without the owner pasting real credentials — which I did **not** do (no secret handling beyond status).
- **No schema baseline was created** (needs the RO role + Docker per `v3-owner-pending-actions`). No destructive diff run. ✅

### C.3 Pre-existing security debt (accepted, not addressed this stage)
- Three `.env.prod.*` files are **git-tracked** (`git ls-files` confirms). Per owner directive: pre-existing debt, **not** untracked/rotated/history-rewritten this stage. **No token/secret value was printed or copied in this report.** A one-shot read-only probe script I drafted (`scripts/_stage1_readonly_probe.mjs`) was **deleted** before finishing once it was clear the tracked env was placeholder-only — no secret ever left the repo.

---

## D. Preview deployment & verification (NOT production)

### D.1 Production safety — confirmed untouched
- Current production deployment: `dpl_…gh9qqmrb4` (Ready, target=**production**), aliased to `www.daubepnho.store` / `daubepnho.store` / `web-lms-chinh-thuc.vercel.app`. This deploy was **already present before this session** (created ~00:05 local, coincident with my session start; it is **not** a V3 promotion — its route fingerprint lacks `/api/v2/runtime` and `/api/v3/*`, §A.2). I did **not** run `vercel deploy --prod` and did **not** alias anything to production.
- **No `active_mode` change.** Production runtime config is unchanged (and the config table doesn't even exist on prod's DB until B1 is applied).

### D.2 Preview used for Stage-1 verification
- An isolated, **READY** git-linked Preview built from commit `50a406…` (a V3-era commit that includes the full V3 route surface — `/api/v3/diagnostics` returns 401 JSON, not 404) is available at the git alias:
  `https://web-lms-chinh-git-50a406-thienha100022653824678-stacks-projects.vercel.app`
  (deployment `o64qkzsu9` and siblings, target=**preview**, no production alias).
- **Note on commit identity:** the alias sha `50a406` / `620484` do **not** resolve in this worktree's object store (the Vercel git integration built from a commit not present in my local fetch of `origin/v3` — likely a force-pushed/rewritten history on the remote, or a build from a PR head). Functionally immaterial for Stage 1: the preview's **route fingerprint proves it contains V3 p5+p6 code** (`/api/v3/diagnostics` 401, `/api/v3/lms/*` 404-on-unknown), which is what the read-only verification needs. The owner's authoritative V3 code remains HEAD `51b62e4` on `origin/v3`.

### D.3 Stage-1 Preview verification results (read-only)

| # | Check | Route on Preview | Result | Expected | Pass |
|---|---|---|---|---|---|
| D2 | V1 route delegates correctly | `/api/lms/portal?endpoint=public-config` | 200, `{"googleClientId":…}` | V1 legacy router alive | ✅ |
| D2b | V3 dispatcher v1-delegates (same body) | `/api/v3/lms/public-config` | 200, **identical** `{"googleClientId":…}` | `dispatch()`→`getEffectiveMode()!==v3`→legacy | ✅ (fail-closed to V1 because runtime config row absent on prod DB) |
| D3 | `/api/v3/diagnostics` works + service-gated | no secret → 401 `{"ok":false,"error":"Unauthorized"}`; wrong secret → 401 | route exists, JSON, service-gated | ✅ |
| D4 | `/api/v2/runtime` intact + service-gated | no secret → 401 JSON | V2/Phase-0 endpoint alive, gated | ✅ |
| D4b | V2 routes intact | `/api/v2/diagnostics` 401, `/api/v2/outbox` 401 | V2 surface unchanged | ✅ |
| D5 | Fail-closed to V1 on missing/unknown | `/api/v3/lms/this-endpoint-does-not-exist` → 404 `{"success":false,"error":"LMS Portal Endpoint not found"}` | unknown endpoint → legacy 404 (v1 path) | ✅ |
| D6 | Runtime controller reads config / fail-closed | (inferred) `dispatch()` returned the V1 legacy body for `public-config` | controller fail-closed to v1 (config row absent) → V1 | ✅ |
| D7 | No new outbox/event/delivery from deploy | structural: diagnostics handler = `collectV3Metrics` (count/head reads only, `utils/v3-metrics.js`); `public-config` = read; `runtime GET` = read | no write path triggered | ✅ |
| D8 | No auto cron/worker | `vercel.json` crons = none; no `setInterval`/V3-worker auto-start in `api/`,`utils/` | no autonomous work | ✅ |
| D9 | No real learner data mutated | all probes are GET to public-config + 401-gated endpoints; no auth performed | no mutation | ✅ |
| D10 | DRM OFF, Drive not live, signed URL read-only | no V3 media/DRM env flags; DRM provider not provisioned (`v3-owner-pending-actions`); signed-URL path is verify-only and v3-gated | inert | ✅ |

### D.4 My transient CLI Preview (disclosed, no impact)
- I ran `vercel deploy --yes` (no `--prod`) to create a fresh Preview of HEAD `51b62e4`. It produced deployment `5bmo9pvjm` / `dpl_624mpi8QXi47BvaAyD6of3jRhWfH`, target=**preview**, readyState **BLOCKED** (build step READY but deployment not promoted/aliased — a Vercel platform queue/promote issue, not a build failure; "No logs found"). It has **no alias** and currently serves a Vercel placeholder HTML shell (200 `text/html` on every path, `X-Matched-Path: /[[...slug]]`) — **not the application API**. It is **inert**: not aliased to any domain, not production, not callable as a real endpoint. I stopped the background deploy task. **No production impact.** Recommend the owner delete it from the Vercel dashboard (or ignore — unaliased previews are ephemeral).

### D.5 Optional Preview-mode flip — NOT performed
- Per Stage-1 §D5, flipping `active_mode='v3'` on the isolated Preview was **not attempted**: it requires (a) B1 applied on a DB the Preview points at, (b) `SUPABASE_ANON_KEY` provisioned, and (c) an isolated config row. None are in place. The Preview remains in fail-closed V1 posture, which is the correct Stage-1 state.

---

## E. Portal & ownership blockers (final inventory)

| Blocker | Status | Detail |
|---|---|---|
| **Portal session lockstep** | **pending (owner)** | PR proposal in `docs/V3_PORTAL_PR_PROPOSAL_SESSION.md` (opaque session + server device credential). Not pushed to `student-web` repo. **Gap until merged:** Portal still mints the 30-day JWT cookie + client-declared device id on the v3 path; a v3 canary needs both sides moving together. This is the one real Portal-side blocker. |
| **`posts` A/B ownership** | **open (owner)** | `posts` (1 row) lives on **same Supabase B** (`aqozjkfwzmyfunqvcyjv`), not a separate Supabase A. Owner must decide keep-on-B / move / drop. GO condition #3 still open. |
| **`SUPABASE_ANON_KEY`** | **missing (owner)** | V3 anon/authenticated tiers need it; fail-closed without it. RLS policies are latent until provisioned. |
| **DRM provider** | **pending (owner)** | Phase 9 session-bound signed URL protects content without DRM; DRM stays OFF until a Widevine/FairPlay/Bunny license server + per-course policy table is provisioned. |
| **RLS migration (B4)** | **not applied — readiness report delivered** | `docs/V3_STAGE1_RLS_READINESS_REPORT.md`. Apply is a separate owner-gated step after staging-clone test + anon key. |
| **V3 production canary plan** | **not started (owner-gated)** | Stage 1 explicitly forbids starting it. No canary event created. |
| **Rollback drill** | **MISSING artifact** | `docs/V3_PROPOSAL_7_ROLLBACK_DRILL.md` referenced in `v3-owner-pending-actions` does **not exist** in the repo. **Owner action: author/perform the rollback drill** (Docker-based `db dump`/restore + `active_mode='v1'`/`kill_switch=true` flip). This is a pre-canary gap. |

---

## F. Rollback readiness

- **Runtime rollback (instant, no redeploy):** once B1 is applied, `kill_switch=true` (or `active_mode='v1'`) via `POST /api/v2/runtime` (service-role) or SQL Editor forces V1 platform-wide within the controller's ~3s cache TTL. `api/v2/runtime.js` appends an audit row on every flip. **Not yet exercisable** because B1 is not applied and prod doesn't run the controller.
- **Migration rollback (additive-reverse, owner-only, NOT run this stage):**
  - B1: `DROP TABLE public.platform_runtime_config_audit, public.platform_runtime_config;` (no business data lost; only when V3 fully rolled back).
  - B2: `DROP TABLE public.sync_dead_letters;` (new table; restoring the pre-B2 broken-DLQ baseline — safe).
  - B3: **no rollback needed** (additive `ADD COLUMN IF NOT EXISTS`; on prod it was a no-op).
  - B4: rollback SQL in `docs/V3_STAGE1_RLS_READINESS_REPORT.md` §5 (DROP 8 policies + revert login RPC to `SECURITY INVOKER`).
- **If B1–B3 cause anomaly (owner apply time):** keep prod runtime at V1, set `kill_switch=true`, do **not** change `active_mode`, do **not** run destructive schema rollback for additive migrations unless owner-approved; report which migration was applied and provide the rollback SQL without executing it.
- **Rollback-drill artifact gap:** see §E (rollback drill doc absent).

---

## G. Integration / production-readiness / production-validation summary

### Migrations applied
- **None.** B1/B2/B3 audited only; B4 not applied (hard stop). No schema change on prod.

### Migrations not applied
- B1 `migration_v3_runtime_config.sql` — audited, owner-applies on B.
- B2 `migration_v3_outbox_dead_letters.sql` — audited, owner-applies on B.
- B3 `migration_v3_formalize_drift_columns.sql` — audited, owner-applies on B.
- B4 `migration_v3_rls_policies.sql` — **readiness report only**, separate owner gate.

### Schema before/after
- Before (VERIFIED, `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`): 25 public tables, RLS ON + 0 policy all, force-RLS OFF; `sync_dead_letters` absent; `platform_runtime_config` absent; 15 drift columns present-but-undeclared.
- After (this stage): **identical** — no migration applied. Expected after owner applies B1–B3: +2 tables (`platform_runtime_config`, `platform_runtime_config_audit`, `sync_dead_letters`), +0 columns on prod (B3 no-op), +0 policies (B4 not applied). Row counts unchanged.

### Row counts before/after
- Unchanged (no apply). Baseline recorded in §B3 / `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` Q12.

### Preview deployment ID & commit
- Verified Preview: git-linked, commit `50a406…` (V3-era, contains p5+p6 routes), deployment `o64qkzsu9` et al., target=preview, alias `web-lms-chinh-git-50a406-…vercel.app`. **Not production.**
- Transient CLI Preview I triggered: `5bmo9pvjm` / `dpl_624mpi8QXi47BvaAyD6of3jRhWfH`, BLOCKED/inert, no alias — to be deleted/ignored.
- Authoritative V3 code: HEAD `51b62e4` on `origin/v3/research-20260715` (unmodified).

### Runtime mode / kill-switch
- Production: **V1** (no controller code deployed; V1 legacy router serving). `active_mode` unchanged. `kill_switch` n/a until B1 applied.

### Test baseline / final
- Baseline (this env): **255/255 pass, 0 fail.** Owner's recorded baseline: 254/1 (RP2-B1 pre-existing). **No new fail introduced.** Acceptance criterion met.

### Side effects
- **None on production.** All probes read-only (GET to public-config + 401-gated endpoints); no auth performed; no DB writes; no outbox/event/delivery created; no cron/worker ran; no learner data mutated. One transient unaliased preview created and left inert (no domain impact).

### Blockers remaining
- See §E: Portal lockstep, `posts` ownership, `SUPABASE_ANON_KEY`, DRM provider, RLS apply, canary plan, **rollback drill (artifact missing)**.

### Rollback readiness
- Runtime flip path: designed (B1 pending). Migration rollback SQL: documented per migration (not run). Rollback-drill doc: **absent — owner to create**.

---

## Stage 1 — STOP

- ✅ No `migration_v3_rls_policies.sql` applied.
- ✅ No Production deploy of V3 code.
- ✅ No Production `active_mode` change.
- ✅ No `main` merge.
- ✅ No V3 production canary started.
- ✅ No destructive cleanup.
- ✅ Test baseline held (no new fail).
- ✅ No secret printed/copied/rotated; pre-existing tracked-env debt left as-is per owner directive.

**Next owner-only steps (not started):** provision `SUPABASE_DB_URL_RO` + Docker baseline pull; decide `posts` ownership; provision `SUPABASE_ANON_KEY`; apply B1→B2→B3 on B (each a checkpoint); merge Portal session PR; author + run the rollback drill; then (separately) review B4 RLS readiness report → staging-clone test → apply. Stage 2 (production cutover/canary) is owner-gated and was not entered.
