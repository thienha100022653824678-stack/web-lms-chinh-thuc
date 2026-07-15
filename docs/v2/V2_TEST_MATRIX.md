# V2 Test Matrix

## Regression V1

- Shop: create/edit course, upload poster, checkout, upload bill, approve order.
- Portal: Google login, my-courses, post page, entry-token button.
- LMS: course-data, lesson, video, image, media, docs, recipe, section/chapter, Drive retry.

## Outbox

- Shadow mode off: no behavior change.
- Shadow mode on: V1 sync still succeeds.
- Duplicate event idempotency key is ignored.
- Delivery failure creates retry/dead-letter state in worker phase.

## Identity mapping

- Course slug maps to exactly one `course_id`.
- Orders backfill `course_id`.
- Enrollments backfill `course_id`.
- Lessons backfill `course_id`.
- Slug case mismatch is detected by reconciliation.

## Session V2

- Same Gmail same device allowed.
- Same Gmail different device blocked while lease active.
- Active device is not auto-superseded.
- Logout releases lease.
- Lease expiry allows new device.
- Token replay blocked.
- Token consume and session create are atomic.

## Drive V2

- Grant success.
- Existing permission idempotent.
- Quota/429 cooldown.
- `invalid_grant` moves account to reauth-required.
- Missing folder/file reports actionable error.

## Privacy/risk

- No raw token stored.
- No secret in logs.
- IP stored only as truncated/HMAC once implemented.
- Risk summary does not count normal heartbeats as suspicious.

## V2 canary scenarios (v2/rebuild-20260715)

### Session guard (RP2-B1 + B2 + B3)
- Flag on: course-data/lesson require `X-LMS-Session-Id` + `X-LMS-Device-Id`; missing/invalid → 401 `invalid_session`.
- Flag on: `exchange-code` returns 410 `legacy_login_disabled`.
- Logout (`endpoint=logout`): valid session → 200 `serverRevoked:true`; repeat call → 200 (idempotent); flag-on revoke failure → 503 `one_device_policy_unavailable`; flag-off no session → 200 `serverRevoked:false` (cookie cleared).
- Admin `reset_session`: no reason → 400 `reason_required`; reason >500 → 400 `reason_too_long`; missing student → 404 `student_not_found`; nothing active → 200 `alreadyRevoked:true`; revoke error → 500 `revoke_failed`; audit contains the real reason; no email/IP/device/session id in any response.

### Sync (outbox / projection / readiness)
- Shadow mode on: V1 `/api/sync` unchanged; `sync_outbox` grows; no duplicate `idempotency_key`.
- Worker dry-run: `POST /api/v2/sync-worker {dryRun:true}` builds a plan, creates no `sync_deliveries`.
- Projection preview: `POST /api/v2/portal-projection-preview` payload matches V1 `/api/sync` for sample course + enrollment events.
- Guarded live (canary scope only): `sync_deliveries` rows created; retries back off; `sync_dead_letters` alertable; `V2_DRIVE_WORKER_DRY_RUN` stays true.
- `/api/v2/readiness` reaches `ready_for_guarded_delivery` for the canary scope; never `blocked` after flags on.

### Canary + rollback
- V1 regression matrix passes on both production and preview-with-flags-off.
- Rollback drill 1 (code): V1 redeploy on preview → all V1 endpoints 200.
- Rollback drill 2 (schema, non-prod): drop V2 objects → V1 reads succeed.
- Rollback drill 3 (flags): all flags off → readiness `blocked`, V1 behavior unchanged.
