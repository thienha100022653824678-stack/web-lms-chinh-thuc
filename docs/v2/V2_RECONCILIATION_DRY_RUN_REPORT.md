# V2 Reconciliation Dry-Run Report

Date: 2026-07-13

Status: blocked before dry-run.

## Why Dry-Run Is Blocked

The Supabase B production schema currently has V2 outbox tables, but it is missing expected V2 identity-mapping columns on V1 tables:

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

Running a reconciliation dry-run while these columns are missing would produce incomplete or misleading results.

## Completed Checks

- Confirmed runtime database project ref is `aqozjkfwzmyfunqvcyjv`.
- Confirmed V2 outbox table visibility:
  - `sync_outbox`
  - `sync_deliveries`
  - `sync_dead_letters`
- Confirmed mapping table visibility:
  - `course_slug_mappings`
  - `portal_post_course_mappings`
- Confirmed account-sharing/session/Drive operational tables are present.
- Confirmed no secret values were printed or stored.

## Required Next Step

Run controlled DB preflight and schema completion:

1. Run `scripts/v2/preflight-v2.sql` in Supabase B SQL Editor.
2. Review row counts and mapping gaps.
3. Apply `migration_v2_identity_mapping.sql` if preflight is acceptable.
4. Run `scripts/v2/postflight-v2.sql`.
5. Re-run schema audit.
6. Then call `/api/v2/readiness` and reconciliation endpoints for dry-run validation.

## Dry-Run Acceptance Criteria After Schema Completion

Dry-run can continue only if:

- `/api/v2/readiness` does not return `blocked` for schema.
- V2 identity columns are present.
- `orders_with_slug_course_id_null`, `enrollments_with_slug_course_id_null`, and `lessons_with_slug_course_id_null` counts are understood and documented.
- Portal projection preview samples match the V1 Portal `/api/sync` contract.
- V2 delivery flags remain dry-run/disabled until explicit owner approval.

