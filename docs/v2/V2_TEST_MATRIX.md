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
