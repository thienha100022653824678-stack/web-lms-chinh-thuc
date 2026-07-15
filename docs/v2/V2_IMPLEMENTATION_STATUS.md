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

**Status of S3 Step 5 sub-steps 4–7 (flag progression + `/api/v2/readiness`):** NOT yet performed. These require a Vercel preview deploy of `v2/rebuild-20260715` with the V2 flags set — an owner action. The DB foundation is ready; the readiness endpoint cannot be exercised until the branch is deployed to a preview and flags are flipped per runbook §5.

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

- Enable and observe Portal projection dry-run after diagnostics are clean.
- **S3 flag progression (owner, post-migration):** on a Vercel preview deploy of `v2/rebuild-20260715`, flip `V2_OUTBOX_SHADOW_MODE=true` → verify `/api/v2/outbox`; then `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` → verify `/api/v2/portal-projection-preview` vs V1; then owner approves live delivery. `/api/v2/readiness` must reach `ready_for_guarded_delivery`. DB foundation is already applied + postflight-clean (see S3 results above).
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
