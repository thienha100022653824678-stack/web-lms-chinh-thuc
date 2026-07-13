# V2 Migration Inventory

Scope: controlled V2 database readiness for Supabase B / LMS production.

Runtime source of truth:

- Supabase B project ref: `aqozjkfwzmyfunqvcyjv`
- Org: `thienha336501903-a11y's Org`
- Supabase A remains the old Portal / legacy post system and must not be mixed into Supabase B checks.

This inventory separates:

- V2 migrations that support the new platform/sync model.
- Existing operational migrations that V2 depends on or must not break.
- Legacy/baseline migrations that document older schema shape.

No secret values belong in this document.

## V2 Core Migrations

| Repo | File | Purpose | Apply Risk | Idempotent | Writes Existing Rows | Notes |
|---|---|---:|---:|---:|---:|---|
| LMS | `migration_v2_sync_outbox.sql` | Creates V2 outbox tables: `sync_outbox`, `sync_deliveries`, `sync_dead_letters`. | Low | Yes | No | Additive worker-only tables. Uses `gen_random_uuid()`; ensure `pgcrypto` is available. |
| LMS | `migration_v2_identity_mapping.sql` | Adds canonical mapping fields and mapping tables for courses, orders, enrollments, lessons, and Portal posts. | Medium | Mostly | Yes | Adds columns and runs backfill `UPDATE`s on `orders`, `student_enrollments`, and `lessons`. Needs preflight row counts and postflight drift checks. |

## Session Guard / Account Sharing Migrations

These are not V2 sync migrations, but they are active operational schema used by the Portal-to-LMS anti-sharing flow and admin risk dashboard. V2 must preserve them.

| Repo | File | Purpose | Apply Risk | Idempotent | Writes Existing Rows | Notes |
|---|---|---:|---:|---:|---:|---|
| LMS | `migration_student_session_guard.sql` | Creates `student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`. | Low | Yes | No | Base tables for entry-token and LMS verified session flow. |
| LMS | `migration_atomic_session_guard.sql` | Enforces one active Portal session per normalized Gmail and creates `handle_student_session_login(...)`. | Medium | Mostly | Yes | Supersedes duplicate active sessions before adding unique partial index. RPC returns `active_session_on_another_device` for blocked new devices when policy is `block`. |
| LMS | `migration_account_sharing_alerts.sql` | Creates account-sharing event logs, review records, admin notes, audit logs. | Low | Yes | Light | Updates old log rows to fill `event_type` / `event_source`. |
| LMS | `migration_account_sharing_p0_hardening.sql` | Adds P0 telemetry hardening columns, event idempotency, `student_session_controls`, and admin reset RPC. | Medium | Yes | No during apply | Replaces `reset_student_session_guard(...)`. Enables RLS on `student_session_controls`. Assumes `admin_audit_logs` exists. |
| LMS | `migration_account_sharing_p1.sql` | Adds `student_account_risk_summaries`, review workflow columns, indexes, and retention RPC. | Medium | Yes | No during apply | Migration itself is additive. The created RPC `cleanup_student_account_risk_events(...)` deletes old events/notes/audits when invoked. |

## Drive Permission Migrations

These are operational V1/V1.5 migrations. V2 must not break them.

| Repo | File | Purpose | Apply Risk | Idempotent | Writes Existing Rows | Notes |
|---|---|---:|---:|---:|---:|---|
| LMS | `migration_drive_admin_pool.sql` | Adds Drive admin pool tables/columns and Drive permission status fields. | Low | Yes | No | Adds `drive_admin_accounts`, `drive_permission_logs`, `courses.drive_folder_id`, `student_enrollments.drive_permission_*`. |
| LMS | `migration_drive_sync.sql` | Older Drive sync log/queue foundation. | Low | Yes | No | Creates `drive_permission_logs` and `drive_sync_queue`. Overlaps with newer Drive admin pool migration. |

## Shop Migrations

| Repo | File | Purpose | Apply Risk | Idempotent | Writes Existing Rows | Notes |
|---|---|---:|---:|---:|---:|---|
| Shop | `migration_sync_status.sql` | Adds V1 sync status columns to `courses` and `orders`. | Low | Yes | No | Required for existing Shop/LMS/Portal sync status display. |
| Shop | `migration_expected_start_date.sql` | Adds `courses.expected_start_date` and backfills from `raw_data.expectedStartDate`. | Low | Yes | Yes | Backfill is scoped to valid `YYYY-MM-DD` strings. |

## Portal / Supabase A Legacy Migrations

These belong to the old Portal / Supabase A side unless explicitly re-run in another project. They are listed to avoid applying them to Supabase B by mistake.

| Repo | File | Purpose | Apply Risk | Idempotent | Writes Existing Rows | Notes |
|---|---|---:|---:|---:|---:|---|
| Portal | `migration_gated_access.sql` | Adds `posts.course_slug` and creates `gated_posts_access`. | Low | Yes | No | Supabase A / old Portal access model. |
| Portal | `migration_post_source.sql` | Adds `posts.source` and marks course-linked posts as `shop_admin`. | Medium | Yes | Yes | Updates all posts with non-null `course_slug`. Supabase A only. |
| Portal | `migration_telegram.sql` | Adds Telegram source fields to `posts`. | Low | Yes | No | Supabase A only. |

## Baseline Schema Files

| Repo | File | Purpose | Notes |
|---|---|---|---|
| LMS | `supabase_schema.sql` | Historical Supabase B schema baseline and seed examples. | Do not blindly apply to production; it contains seed `INSERT`s. |
| LMS | `supabase_sub_posts.sql` | Historical post table helper. | Do not use as V2 migration. |
| Shop | `supabase_schema.sql` | Historical Shop schema baseline. | Do not blindly apply to production. |
| Portal | `database.sql` | Historical Portal schema baseline. | Do not blindly apply to production. |

## Risk Summary

### Safe/Additive for controlled production apply

- `migration_v2_sync_outbox.sql`
- `migration_student_session_guard.sql` if not already applied
- `migration_account_sharing_alerts.sql` if not already applied
- `migration_drive_admin_pool.sql` if not already applied
- `migration_expected_start_date.sql` if not already applied on the target courses DB

### Needs preflight row-count review

- `migration_v2_identity_mapping.sql`
- `migration_atomic_session_guard.sql`
- `migration_post_source.sql` on Supabase A only

### Runtime-destructive only when RPC is invoked

- `migration_account_sharing_p1.sql` creates `cleanup_student_account_risk_events(...)`, which deletes old rows only when explicitly called.

## Required Preflight Principles

1. Confirm target project is Supabase B `aqozjkfwzmyfunqvcyjv` before any V2 LMS migration.
2. Confirm Supabase A migrations are not applied to Supabase B unless explicitly redesigned.
3. Run schema/row-count snapshot before `migration_v2_identity_mapping.sql`.
4. Run postflight drift queries after each migration.
5. Keep V2 feature flags off until database and dry-run validation pass.
6. Never copy secret/token/private-key values into migration docs or reports.

