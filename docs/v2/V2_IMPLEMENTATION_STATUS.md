# V2 Implementation Status

This document tracks V2 work on integration branch `v2/rebuild-20260715` (cut from `v2/platform-rebuild`).

V1 production remains unchanged. Do not merge or deploy V2 until the owner
explicitly asks to switch traffic to V2.

## Baseline

- V1 stable tag: `v1-stable-20260713`
- V2 branch: `v2/platform-rebuild`
- Runtime source of truth: Supabase B / LMS & Checkout
- Supabase B project ref: `aqozjkfwzmyfunqvcyjv`
- Cutover rule: V2 is opt-in only; V1 rollback is the stable tag plus current production branches.

## Completed

### Shop

- `8e45899 chore: initialize V2 rollout baseline`
  - Added V2 rollout notes and feature flags.
- `dbba90c chore: add V2 outbox helpers`
  - Added outbox enqueue helper.
- `62880be chore: shadow-write shop sync events to V2 outbox`
  - Shadow-writes course/enrollment sync events when `V2_OUTBOX_SHADOW_MODE` is enabled.
  - Default V1 behavior is unchanged.

### Portal

- `7134019 chore: initialize V2 rollout baseline`
  - Added V2 rollout notes and feature flags.
  - Note: Portal still has a pre-existing dirty file `src/lib/session-guard.ts`; it is not part of V2 baseline.

### LMS

- `0029f47 chore: initialize V2 rollout baseline`
  - Added V2 rollout notes and feature flags.
- `41808c6 chore: add V2 sync outbox migration`
  - Added additive migration `migration_v2_sync_outbox.sql`.
- `7f37cdc chore: add V2 outbox helpers`
  - Added LMS outbox enqueue helpers.
- `0fa9dd1 feat(v2-db): add identity mapping foundation`
  - Added additive migration `migration_v2_identity_mapping.sql`.
  - Adds canonical course/order/enrollment/lesson mapping foundation.
- `45503a8 feat(v2-sync): add dry-run outbox worker`
  - Added internal V2 sync worker endpoint.
  - Default mode is dry-run / plan-only.
  - No V1 delivery behavior is changed.
- `9b53969 feat(v2-reconcile): add read-only reconciliation endpoint`
  - Added internal read-only reconciliation endpoint.
  - Reports identity/outbox mapping gaps without writing database rows.
- `1b74a1d feat(v2-sync): add guarded delivery executor`
  - Added guarded outbox delivery execution behind `V2_DELIVERY_HANDLERS_ENABLED`.
  - Drive delivery remains dry-run by default through `V2_DRIVE_WORKER_DRY_RUN=true`.
  - Portal projection delivery is intentionally not implemented yet and fails safely if enabled too early.
  - Existing V1 sync endpoints and runtime behavior are unchanged.
- Current V2 diagnostics slice
  - Adds internal read-only V2 diagnostics endpoint `/api/v2/diagnostics`.
  - Reports feature flag state, required migration visibility, and outbox health without writing data.
- Current V2 Portal projection slice
  - Adds a guarded Portal projection delivery handler for V2 outbox events.
  - Default behavior is disabled/skipped via `V2_PORTAL_PROJECTION_ENABLED=false`.
  - When enabled, it remains dry-run/pending unless `V2_PORTAL_PROJECTION_DRY_RUN=false`.
  - Course projection reads the current Supabase B course snapshot before building Portal payloads to avoid overwriting Portal with stale or slug-only values.
  - Existing V1 `/api/sync` behavior is unchanged.
- Current V2 outbox inspector slice
  - Adds internal read-only endpoint `/api/v2/outbox`.
  - Allows inspecting `sync_outbox`, `sync_deliveries`, and `sync_dead_letters` with cursor pagination and simple filters.
  - Masks emails and redacts secret-like payload keys before returning JSON.
  - Does not claim, retry, deliver, or mutate outbox rows.
- Current V2 Portal projection preview slice
  - Adds internal read-only endpoint `/api/v2/portal-projection-preview`.
  - Builds the Portal `/api/sync` payload for one `sync_outbox` event without sending it.
  - Masks email values and redacts secret-like keys in the preview response.
  - Lets operators compare V2 projection payloads against the V1 Portal sync contract before enabling live projection.
- Current V2 readiness slice
  - Adds internal read-only endpoint `/api/v2/readiness`.
  - Aggregates diagnostics, outbox health, flag posture, and reconciliation summary into operator gates.
  - Returns readiness levels without returning raw reconciliation samples or secret values.
  - Does not mutate rows and does not enable any V2 delivery behavior.
- Current V2 database readiness slice
  - Adds `docs/v2/V2_MIGRATION_INVENTORY.md`.
  - Adds `docs/v2/V2_DATABASE_ACTUAL_STATE.md`.
  - Adds `docs/v2/V2_SCHEMA_DRIFT_REPORT.md`.
  - Adds `docs/v2/V2_PRE_MIGRATION_SNAPSHOT.md`.
  - Adds `docs/v2/V2_RECONCILIATION_DRY_RUN_REPORT.md`.
  - Adds SQL runbooks:
    - `scripts/v2/preflight-v2.sql`
    - `scripts/v2/postflight-v2.sql`
    - `scripts/v2/rollback-v2.sql`
  - Confirms Supabase B project ref `aqozjkfwzmyfunqvcyjv` from local runtime env.
  - Finds schema drift: V2 outbox tables exist, but identity-mapping columns on `orders`, `student_enrollments`, and `lessons` are incomplete.
  - Keeps V2 dry-run blocked until `migration_v2_identity_mapping.sql` is reviewed/applied and postflight passes.

## v2/rebuild-20260715 Integration

- S0 base: merged `v2/rebuild-20260714` (RP-1, RP2-A, RP2-B0) and `feat/v2-rp2b1-session-device-guard` (RP2-B1) into a branch cut from `v2/platform-rebuild`. Single conflict `utils/v2-flags.js` resolved as union. Inherited tests pass (RP-1 48, RP2-A 29, RP2-B1 full).
- S1 RP2-B2: server-side logout endpoint `api/lms/portal.js?endpoint=logout` (`utils/lms-handlers/logout.js`). Idempotent, fail-closed on flag-on, V1-compat on flag-off. 9 tests pass.
- S2 RP2-B3: admin `reset_session` now requires reason, returns `student_not_found` / `already_revoked` / `revoke_failed`, audits the real reason. Tests pass.

### S3 operator steps (owner-driven, gate on /api/v2/readiness)

1. Backup Supabase B, run `scripts/v2/preflight-v2.sql`.
2. Apply `migration_v2_sync_outbox.sql` then `migration_v2_identity_mapping.sql` (transactional).
3. Run `scripts/v2/postflight-v2.sql`; all V2 objects `exists=true`.
4. Preview env: `V2_OUTBOX_SHADOW_MODE=true` → verify `/api/v2/outbox`.
5. `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` → verify `/api/v2/portal-projection-preview` vs V1.
6. Owner approves → `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`, keep `V2_DRIVE_WORKER_DRY_RUN=true`.
7. `/api/v2/readiness` must reach `ready_for_guarded_delivery` for the canary scope.

### S3 migration + postflight results (applied 2026-07-15, Supabase B `aqozjkfwzmyfunqvcyjv`)

Applied by the owner's agent via the Supabase CLI (`supabase link` + `supabase db query --linked -f`), in the runbook §3 order. Additive-only; no V1 column dropped/renamed. Backup posture: `walg_enabled=true`, `pitr_enabled=false`, no physical backup snapshot present at apply time (owner accepted additive-only apply).

**Preflight (read-only snapshot, saved):**
- pgcrypto extension + `gen_random_uuid()` present. ✓
- All 7 V1 core tables exist (courses, orders, lessons, students, student_enrollments, site_config, lesson_progress). ✓
- All 8 session-guard tables exist (RP2-B0/B1 surface). ✓
- `handle_student_session_login` + `cleanup_student_account_risk_events` present. `reset_student_session_guard` **exists but with a different signature** than preflight expects (`(p_email text, p_admin_email text DEFAULT, p_reason text DEFAULT)` → jsonb, vs preflight's `(text×7, boolean)`). Pre-existing; not touched by these migrations; not a V2-sync blocker. Flagged for owner review of the preflight script.
- `idx_one_active_student_session_per_email` present; **0 emails with >1 active session**. ✓
- Row counts: courses 6, orders 24 (24 with course_slug), student_enrollments 19 (19 with course_slug), lessons 35 (35 with course_slug). No slug duplicates. Pre-migration unmatched: orders 3, enrollments 0, lessons 0.

**Applied:**
1. `migration_v2_sync_outbox.sql` → created `sync_outbox`, `sync_deliveries`, `sync_dead_letters` + 6 indexes (additive).
2. `migration_v2_identity_mapping.sql` → added V2 columns on orders/student_enrollments/lessons, created `course_slug_mappings` + `portal_post_course_mappings` + 10 indexes, backfilled identity.

**Postflight (all gates pass):**
- V2 tables: all 5 `exists=true`. ✓
- V2 columns: all 10 `exists=true`. ✓
- V2 indexes: all 16 `exists=true`. ✓
- Row counts: `sync_outbox` 0, `sync_deliveries` 0, `sync_dead_letters` 0 (no shadow events yet — flags still off, expected), `course_slug_mappings` 6 (= course count), `portal_post_course_mappings` 0.
- Identity gaps (tracked, not required to be 0): `orders_with_slug_course_id_null` = **3** (`donut` ×1, `test-bake_1` ×2 — no matching `courses` row for those slugs); enrollments 0; lessons 0; `orders_missing_normalized_email` 0; `sections_without_kind_section` 0; `lesson_rows_without_kind_lesson` 0.

**V1 integrity (unchanged after apply):** courses 6, orders 24, student_enrollments 19, lessons 35, lesson_progress 0, students 13, site_config 66 — identical to preflight. Slug-duplicate groups 0. Session-guard tables intact (student_active_sessions 15, lms_verified_sessions 21, admin_audit_logs 2). ✓

**Status of S3 Step 5 sub-steps 4–7 (flag progression + `/api/v2/readiness`):** Partially complete on preview (2026-07-15). See "S3 flag progression results" below for details. Live delivery (step 6) still requires explicit owner approval. Production flags remain off.

### S3 flag progression results (preview only, 2026-07-15)

**Preview deployment:**
- URL: `https://web-lms-chinh-thuc-1dty4wvrt.vercel.app`
- Deploy id: `dpl_5XR2aSgsda33Asqn1kCG3CJULrKF`
- Target: preview (not production). Branch tip of `v2/rebuild-20260715` at the time of deploy.
- Redeployed after flag write so the new env values were bound at build/runtime.

**Preview env flags (Preview only — production untouched):**

| Flag | Value | Notes |
|---|---|---|
| `V2_OUTBOX_SHADOW_MODE` | `true` | step 4 |
| `V2_RECONCILIATION_READONLY` | `true` | readiness prerequisite |
| `V2_PORTAL_PROJECTION_ENABLED` | `true` | step 5 |
| `V2_PORTAL_PROJECTION_DRY_RUN` | `true` | step 5 (still guarded) |
| `V2_DRIVE_WORKER_DRY_RUN` | `true` | keep Drive out of canary scope |
| `V2_DELIVERY_HANDLERS_ENABLED` | *(unset / false)* | step 6 NOT flipped — needs owner approve |
| `V2_OUTBOX_WORKER_ENABLED` | *(unset / false)* | worker still disabled (no pending rows) |
| `V2_PLATFORM_ENABLED` | *(unset / false)* | runtimeMode stays `off` |

Note: earlier empty-string values for `V2_OUTBOX_SHADOW_MODE` / `V2_RECONCILIATION_READONLY` on preview were rewritten as real `true` before the redeploy (empty strings were treated as disabled by the flag parser).

**Endpoint results (auth via `x-v2-worker-secret` = `INTERNAL_SYNC_SECRET`):**

1. `/api/v2/diagnostics` — `ok: true`
   - Migrations: all 5 V2 tables + 3 column groups present.
   - Outbox health: pending/processing/delivered/failed/dead_letter = 0; staleProcessing = 0.
   - Flags match the table above. Secrets: `INTERNAL_SYNC_SECRET` configured; `V2_WORKER_SECRET` / `V2_PORTAL_PROJECTION_URL` / `V2_PORTAL_PROJECTION_SECRET` not set (fallback to `INTERNAL_SYNC_SECRET` for auth is fine).

2. `/api/v2/outbox?resource=outbox&limit=20` — `ok: true`, **0 rows**.
   - Expected: shadow write path (`utils/v2-outbox.js` → `enqueueCoursePublishEvent` / `enqueueEnrollmentAccessEvent`) is **not yet wired into any V1 call site**. Flag-on alone cannot produce shadow volume until producers are hooked. Inspector + schema are healthy; volume will stay 0 until producer wiring lands.

3. `/api/v2/outbox?resource=deliveries` — `ok: true`, 0 rows. ✓

4. `/api/v2/portal-projection-preview` (no id) — HTTP 409 `missing_outbox_id` (contract-correct fail-closed). Cannot sample a payload until at least one outbox row exists. Endpoint itself is live and authorized.

5. `/api/v2/reconciliation` — `ok: true`, `failedChecks: 0`, `issueCount: 3`.
   - All 7 checks `ok: true`. The 3 issues are the same tracked identity gaps already recorded in postflight (`orders_missing_course_id` for slugs `donut` / `test-bake_1`). Outbox health check is clean.

6. `/api/v2/readiness` — HTTP 200, `ok: true`, **level = `needs_review`** (before classifier fix; see "S3 readiness classifier alignment" below).
   - Gates:
     - `migrations_visible:pass`
     - `worker_secret_configured:pass`
     - `outbox_readable:pass`
     - `outbox_no_stale_processing:pass`
     - `outbox_no_dead_letters:pass`
     - `reconciliation_enabled:pass`
     - **`reconciliation_clean:review`** ← only review gate (issueCount=3 from known junk slugs)
     - `live_delivery_still_guarded:pass` (handlers off)
     - `portal_projection_still_guarded:pass` (dry-run still on)
   - Pre-fix classification: `classifyReadiness` required `reconciliation_clean.ok && issueCount===0` for `ready_for_dry_run`, so with 3 tracked gaps it stayed at `needs_review`. This conflicted with runbook §4 ("course_id is null not required to be 0, but every non-zero count must appear in the reconciliation report" — they do).

### S3 readiness classifier alignment (2026-07-15)

The original `reconciliation_clean` gate treated any `issueCount > 0` as not-clean, which kept readiness at `needs_review` even though the reconciliation checks themselves all ran successfully (`failedChecks === 0`) and the only "issues" were the runbook-accepted tracked identity gaps. This made the readiness level lie about whether dry-run/shadow validation could begin.

Fix applied to `utils/v2-readiness.js` (with `tests/v2-readiness.test.mjs`, 6 cases):
- `reconciliation_clean` gate `ok` is now `reconciliationSummary.ok && failedChecks === 0` (checks-healthy), decoupled from `issueCount`.
- The gate `status` stays `review` while `issueCount > 0` (tracked gaps exist) and `pass` only when `issueCount === 0`. This keeps the level capped at `ready_for_dry_run` (not `ready_for_guarded_delivery`) until the owner accepts or cleans the gaps — exactly the §4 contract.
- `buildGates` and `classifyReadiness` are now exported (pure functions, unit-testable without DB/network).
- New levels confirmed by tests:
  - clean (issueCount=0, all pass) → `ready_for_guarded_delivery`
  - tracked gaps (failedChecks=0, issueCount=3) → `ready_for_dry_run`
  - failed check (failedChecks>0) → `needs_review`
  - missing migrations → `blocked`
  - live delivery + portal both live → `ready_for_dry_run` (review gates surface the intentional canary state)
  - reconciliation disabled → `needs_review`

Net effect on preview: readiness moved `needs_review → ready_for_dry_run` (the tracked 3 junk-slug gaps no longer block shadow/dry-run validation), while still refusing `ready_for_guarded_delivery` until the gaps are resolved and the owner approves live delivery.

### S3 step 6 live delivery results (preview only, 2026-07-15)

Owner approved live delivery on preview. Production flags still off.

**Preview env after flip (Preview only):**

| Flag | Value | Notes |
|---|---|---|
| `V2_OUTBOX_SHADOW_MODE` | true | still on |
| `V2_RECONCILIATION_READONLY` | true | still on |
| `V2_PORTAL_PROJECTION_ENABLED` | true | still on |
| `V2_PORTAL_PROJECTION_DRY_RUN` | **false** | flipped for live trial |
| `V2_DELIVERY_HANDLERS_ENABLED` | **true** | flipped for live trial |
| `V2_OUTBOX_WORKER_ENABLED` | **true** | required for sync-worker to run |
| `V2_OUTBOX_WORKER_DRY_RUN` | **false** | so the worker actually delivers |
| `V2_DRIVE_WORKER_DRY_RUN` | true | kept — Drive out of canary scope |
| `SYSTEM1_URL` | `https://admin.yeunauan.live` | set on preview; secret falls back to `INTERNAL_SYNC_SECRET` |

**Live preview deploy:** `https://web-lms-chinh-thuc-23k6tils5.vercel.app` (READY).

**Seeded outbox event (manual seed via service role, not a real V1 write):**
- `sync_outbox.id = 56a38d11-c86a-43e2-9bad-fbf851f3376b`
- event: `course.publish_status_changed` for existing course `banhmi4k` (payload includes title/image/`is_published=true`).

**First live attempt failed → fix → success:**
1. Worker planned `targets: ["portal_projection"]` correctly.
2. First delivery returned `status=retry_scheduled`, failure `portal_projection_http_failed: "Action không hợp lệ"`.
3. Root cause: `buildPortalProjectionPayload` projected course.publish_status_changed to `action=syncCoursePublishStatus`. System1 `/api/sync` only accepts `syncCourse` / `syncEnrollment` / `revokeEnrollment` (confirmed by probe — that action returns 400 `"Action không hợp lệ"`).
4. Fix in `utils/v2-portal-projection.js` (commit `06bd01e`): always project course.* events as `action=syncCourse`. The publish-status intent is carried by `isPublished` on the body, which System1 already handles. Verified System1 returns `{success:true, postId, updated:true}` for `syncCourse` with `courseSlug`.
5. Reset the outbox row to `pending` and re-ran the worker on the fixed deploy.

**Second live attempt (post-fix) — SUCCESS:**
```
mode=delivery_handlers
processed=1
status=delivered
outcomes=[{target:portal_projection, status:success, code:portal_projection_delivered}]
failures=[]
```
- `sync_outbox` row: `status=delivered`.
- `sync_deliveries` row: `target_system=portal_projection`, `status=success`, `attempt_count=2` (1 failed pre-fix + 1 success post-fix).
- System1 re-sync of the same course is idempotent (`updated:true`, same `postId=4a0142fc-…`).

**Readiness after live delivery:** still `ready_for_dry_run` (correct — `live_delivery_still_guarded` and `portal_projection_still_guarded` are both `review` because the live flags are intentionally on, and `reconciliation_clean` is still `review` for the 3 tracked junk-slug gaps). Ready for guarded delivery remains blocked until the owner accepts those gaps (or cleans them) and re-flips the guarded flags if desired.

**What is intentionally NOT done:**
- Production flag flip — never performed.
- Drive live delivery — `V2_DRIVE_WORKER_DRY_RUN` stays true.
- No enrollment live sample yet (only a course publish event was delivered). Enrollment path is next if the owner wants a full canary.

### S4 canary-ready (complete pending owner canary sign-off)

- `V2_ROLLBACK_RUNBOOK.md` updated with the 3-drill procedure (code, schema, flags).
- `V2_CUTOVER_RUNBOOK.md` added (documentation only; owner executes).
- `V2_TEST_MATRIX.md` extended with canary scenarios.
- Canary-ready state: all V2 flags off on production; V2 preview canary gated on `/api/v2/readiness`; rollback path practiced. Cutover traffic remains the owner's decision.

## Not Applied Automatically

- ~~`migration_v2_sync_outbox.sql`~~ **applied 2026-07-15** on Supabase B `aqozjkfwzmyfunqvcyjv` (see S3 results above).
- ~~`migration_v2_identity_mapping.sql`~~ **applied 2026-07-15** on Supabase B `aqozjkfwzmyfunqvcyjv` (see S3 results above).

Both migrations remain additive; V1 production code/flags are still off. Do not drop V2 objects on production without owner approval + export (see `scripts/v2/rollback-v2.sql`).

## In Progress / Next

- ~~Enable and observe Portal projection dry-run after diagnostics are clean.~~ **Done on preview 2026-07-15** — flags on, diagnostics/readiness/outbox/reconciliation exercised (see S3 flag progression results).
- ~~**S3 flag progression steps 4–5 (shadow + projection dry-run):**~~ **Done on preview.** Steps 6–7 (live delivery + `ready_for_guarded_delivery`) still owner-gated.
- ~~**Wire outbox producers into V1 write paths**~~ **done (this commit):**
  - New fail-open helper `utils/v2-outbox-shadow.js` (`maybeShadowCoursePublish`, `maybeShadowEnrollmentAccess`). Never throws; logs and returns `{failedOpen:true}` on error. 7 unit tests in `tests/v2-outbox-shadow.test.mjs`.
  - Wired into `api/sync.js` after successful `syncCourse` / `syncEnrollment` / `revokeEnrollment`.
  - Wired into `utils/lms-handlers/admin-enrollments.js` after successful POST grant / PUT status change / DELETE revoke.
  - Flag-off path is a pure no-op (V1 behavior unchanged). Flag-on only enqueues when `V2_OUTBOX_SHADOW_MODE=true` (already set on preview).
  - Still no live traffic triggered in this session — shadow volume will grow on the next real course/enrollment write against the preview.
- **Open follow-ups before live delivery can be meaningful:**
  1. Trigger a real course/enrollment write on the preview (or wait for natural traffic) → confirm `/api/v2/outbox` has rows → sample `/api/v2/portal-projection-preview?outboxId=…` vs V1 `/api/sync` contract.
  2. Decide owner policy on the 3 tracked `orders_missing_course_id` junk slugs (`donut`, `test-bake_1`) — accept as non-blocking, or clean them, before expecting readiness `ready_for_dry_run` / `ready_for_guarded_delivery`.
  3. Owner approve step 6: flip `V2_DELIVERY_HANDLERS_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=false` on **preview only**, keep `V2_DRIVE_WORKER_DRY_RUN=true`. Do not touch production.
  4. Optionally enable `V2_OUTBOX_WORKER_ENABLED=true` + `V2_OUTBOX_WORKER_DRY_RUN=true` on preview for dry-run plan inspection once shadow rows exist.
- Use `/api/v2/readiness` as the top-level gate before enabling worker dry-run or guarded delivery.
- Use `/api/v2/outbox` to inspect shadow outbox rows and delivery plans before enabling live V2 handlers.
- Use `/api/v2/portal-projection-preview` on sampled course/enrollment events before disabling Portal projection dry-run.
- Enable live Portal projection only after payload samples match V1 `/api/sync` behavior.
- Add read-only reconciliation runbook and expected result thresholds.  *(done — see `V2_RECONCILIATION_RUNBOOK.md`)*
- Add admin V2 diagnostics page guarded by admin auth.
- Add session lease V2 only after sync/reconciliation is stable.
- Add Drive permission job queue after outbox delivery is proven.

## Still Not Done

- No V2 production cutover.
- No V2 production flag flip.
- No V1 endpoint removal.
- All pending owner cutover approval.

## Current Guardrails

- Keep `main` / production branches on V1 until explicit cutover approval.
- Keep V2 feature flags off by default.
- Keep `V2_DELIVERY_HANDLERS_ENABLED=false` until staging verification is complete.
- Keep `V2_DRIVE_WORKER_DRY_RUN=true` until Drive admin pool and folder IDs are verified for V2 worker traffic.
- Do not commit secrets, env files, `scratch/`, or `review-dossier-session-guard/`.
- Do not modify `/api/sync`, OAuth, session restore, Drive permission, or enrollment mapping outside a scoped V2 task.
