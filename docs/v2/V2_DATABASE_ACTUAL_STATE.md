# V2 Database Actual State

Inspection date: 2026-07-13

Target checked:

- Supabase B / LMS production
- Project ref from `SUPABASE_URL`: `aqozjkfwzmyfunqvcyjv`
- Expected project ref: `aqozjkfwzmyfunqvcyjv`
- Match: yes

Inspection method:

- Local env names were read from `.env.local`; secret values were not printed.
- A temporary script in `scratch/` used Supabase REST with the service role key to check table visibility, row counts, and selected column visibility.
- Postgres indexes, function security, RLS policies, and constraint definitions still require SQL Editor checks using:
  - `scripts/v2/preflight-v2.sql`
  - `scripts/v2/postflight-v2.sql`

## Table Visibility

| Table | Exists | Row Count Observed |
|---|---:|---:|
| `courses` | yes | 6 |
| `orders` | yes | 24 |
| `lessons` | yes | 35 |
| `student_enrollments` | yes | 19 |
| `student_active_sessions` | yes | 15 |
| `lms_entry_tokens` | yes | 19 |
| `lms_verified_sessions` | yes | 21 |
| `student_device_change_logs` | yes | 12 |
| `student_account_risk_reviews` | yes | 0 |
| `student_account_risk_summaries` | yes | 1 |
| `student_session_controls` | yes | 0 |
| `admin_audit_logs` | yes | 2 |
| `drive_admin_accounts` | yes | 3 |
| `drive_permission_logs` | yes | 56 |
| `sync_outbox` | yes | count not available via this REST check |
| `sync_deliveries` | yes | count not available via this REST check |
| `sync_dead_letters` | yes | count not available via this REST check |
| `course_slug_mappings` | yes | count not available via this REST check |
| `portal_post_course_mappings` | yes | count not available via this REST check |

## Column Checks

### Confirmed Present

`courses`:

- `id`
- `slug`
- `title`
- `expected_start_date`
- `drive_folder_id`
- `drive_permission_mode`

`student_enrollments`:

- `id`
- `email`
- `course_slug`
- `course_id`
- `drive_permission_status`

`lessons`:

- `id`
- `course_slug`
- `course_id`
- `is_section`

`student_device_change_logs`:

- `id`
- `email`
- `event_type`
- `event_source`
- `risk_points`
- `correlation_id`
- `request_id`
- `flow_id`
- `result`
- `reason_code`
- `schema_version`
- `hash_version`
- `event_idempotency_key`

`student_account_risk_reviews`:

- `id`
- `email`
- `status`
- `monitoring_until`
- `resolved_at`
- `false_positive_at`

`student_account_risk_summaries`:

- `id`
- `email`
- `risk_score`
- `risk_level`
- `review_status`
- `updated_at`

`sync_outbox`:

- `id`
- `event_type`
- `aggregate_type`
- `aggregate_id`
- `status`
- `available_at`
- `payload`

`sync_deliveries`:

- `id`
- `outbox_id`
- `target_system`
- `status`
- `attempt_count`

`sync_dead_letters`:

- `id`
- `outbox_id`
- `status`
- `reason`

### Missing or Not Visible Through REST

The following expected V2 identity-mapping columns were not visible through the REST column checks:

`orders`:

- `course_id`
- `normalized_customer_email`
- `sync_correlation_id`
- `source_system`

`student_enrollments`:

- `normalized_email`
- `sync_correlation_id`
- `source_system`

`lessons`:

- `kind`
- `parent_section_id`
- `position`

## Current Interpretation

Supabase B already has:

- V2 outbox tables.
- Account-sharing P0/P1 tables.
- Session guard tables.
- Drive admin pool tables.

Supabase B does not appear to have the full V2 identity-mapping column set on the existing V1 tables. This means V2 sync/delivery must remain disabled until the drift is resolved.

## Checks Still Required in Supabase SQL Editor

Run `scripts/v2/preflight-v2.sql` in Supabase B SQL Editor to verify:

- `pgcrypto` / `gen_random_uuid()`
- function existence/security
- indexes
- duplicate active sessions
- pre-migration mapping gaps

Run `scripts/v2/postflight-v2.sql` after applying missing V2 identity migration pieces to verify:

- expected V2 columns
- expected indexes
- mapping row counts
- unmapped order/enrollment/lesson counts

