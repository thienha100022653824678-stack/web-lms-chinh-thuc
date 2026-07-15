# V2 Cutover Runbook (owner decision — NOT executed by the canary-ready plan)

This runbook documents the flag order for switching production traffic to V2. It is executed only by the owner after canary readiness is signed off and a canary has passed on the preview deployment. The canary-ready plan does NOT perform cutover.

## Preconditions (must all be true)

- `/api/v2/readiness` reports `ready_for_guarded_delivery` on the canary scope.
- Reconciliation report reviewed; `course_id is null` counts acknowledged.
- All three rollback drills passed and recorded in `V2_ROLLBACK_RUNBOOK.md`.
- V1 rollback path is hot (tag `v1-stable-20260713` deployable; all V2 flags can be turned off).
- Auth secrets configured on production: `SESSION_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`, `INTERNAL_SYNC_SECRET`, `V2_WORKER_SECRET`, `ADMIN_EMAILS`.

## Cutover flag order (production env)

1. `V2_CORS_ALLOWLIST_ENABLED=true` (with `LMS_ADMIN_ORIGINS` + `LMS_PORTAL_ORIGINS` set).
2. `V2_GLOBAL_ONE_DEVICE_ENABLED=true` (one-device LMS guard; requires Portal V2 to also enforce login-block for full policy — see dependency note).
3. `V2_OUTBOX_SHADOW_MODE=true` (observe; V1 `/api/sync` still authoritative).
4. `V2_RECONCILIATION_READONLY=true`.
5. `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` (preview live).
6. Owner confirms projection payloads match V1 on production samples.
7. `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false` (live portal projection). Keep `V2_DRIVE_WORKER_DRY_RUN=true` until the Drive job queue phase.
8. Observe `/api/v2/readiness`, `/api/v2/outbox`, and V1 `/api/sync` for the observation window.

## Rollback during cutover

At any step, reverse the flags in the opposite order (see `V2_ROLLBACK_RUNBOOK.md` Drill 3) and redeploy `v1-stable-20260713` if needed. Additive schema means no destructive rollback is required for a runtime rollback.

## Out of scope for this runbook

- Removing V1 endpoints (belongs to a later cutover-completion phase).
- Drive permission job queue (separate phase after outbox delivery is proven).
- Risk V2 incremental summaries.
- Admin UI diagnostics page.
- Portal repo (`student-web`) one-device login-block enforcement — must be enabled on the Portal side in lockstep with step 2 for the full one-device policy.
