# V2 Pre-Migration Snapshot

Date: 2026-07-13

Target confirmed by local runtime env:

- Supabase B / LMS production
- Project ref: `aqozjkfwzmyfunqvcyjv`

No secret values were printed or stored.

## Snapshot Method

Automated check used a temporary script under `scratch/`:

- `scratch/v2-schema-audit.mjs`
- `scratch/v2-column-audit.mjs`

These files are untracked and must not be committed.

The scripts read local env names/values only at runtime and printed only:

- project ref
- table visibility
- row counts where available
- selected column visibility

## Row Counts Observed

| Table | Count |
|---|---:|
| `courses` | 6 |
| `orders` | 24 |
| `lessons` | 35 |
| `student_enrollments` | 19 |
| `student_active_sessions` | 15 |
| `lms_entry_tokens` | 19 |
| `lms_verified_sessions` | 21 |
| `student_device_change_logs` | 12 |
| `student_account_risk_reviews` | 0 |
| `student_account_risk_summaries` | 1 |
| `student_session_controls` | 0 |
| `admin_audit_logs` | 2 |
| `drive_admin_accounts` | 3 |
| `drive_permission_logs` | 56 |

The REST count check did not return exact counts for these V2 tables, though table visibility was confirmed:

- `sync_outbox`
- `sync_deliveries`
- `sync_dead_letters`
- `course_slug_mappings`
- `portal_post_course_mappings`

## Current V2 Readiness

Current state: not ready for V2 dry-run/cutover.

Reason: identity-mapping schema drift.

Missing expected columns:

- `orders.course_id`
- `orders.normalized_customer_email`
- `orders.sync_correlation_id`
- `orders.source_system`
- `student_enrollments.normalized_email`
- `student_enrollments.sync_correlation_id`
- `student_enrollments.source_system`
- `lessons.kind`
- `lessons.parent_section_id`
- `lessons.position`

## Required Before Controlled Migration

1. Run `scripts/v2/preflight-v2.sql` in Supabase B SQL Editor.
2. Confirm no duplicate normalized course slugs.
3. Confirm row counts and missing mapping counts are acceptable.
4. Apply the missing V2 identity migration only after review.
5. Run `scripts/v2/postflight-v2.sql`.
6. Re-run the REST schema audit.

## Production Safety Note

Do not enable V2 live delivery flags while this drift exists.

Keep:

- `V2_DELIVERY_HANDLERS_ENABLED=false`
- `V2_PORTAL_PROJECTION_ENABLED=false`
- `V2_PORTAL_PROJECTION_DRY_RUN=true`
- `V2_DRIVE_WORKER_DRY_RUN=true`

