-- V2 rollback helper for Supabase B / LMS.
--
-- Production rule:
-- - Prefer feature-flag rollback first.
-- - Do not drop V2 data in production unless the owner explicitly approves it
--   after export/backup.
--
-- This file intentionally contains no executable DROP statements by default.

-- Safe runtime rollback order in Vercel:
-- 1. V2_PLATFORM_ENABLED=false
-- 2. V2_OUTBOX_SHADOW_MODE=false
-- 3. V2_DELIVERY_HANDLERS_ENABLED=false
-- 4. V2_PORTAL_PROJECTION_ENABLED=false
-- 5. V2_PORTAL_PROJECTION_DRY_RUN=true
-- 6. V2_DRIVE_WORKER_DRY_RUN=true

-- Safe database inspection after feature-flag rollback:
select 'sync_outbox' as table_name, count(*) as row_count from sync_outbox
union all
select 'sync_deliveries', count(*) from sync_deliveries
union all
select 'sync_dead_letters', count(*) from sync_dead_letters;

-- Non-production cleanup template only.
-- Uncomment only in a disposable/staging database after export.
--
-- drop table if exists public.sync_dead_letters;
-- drop table if exists public.sync_deliveries;
-- drop table if exists public.sync_outbox;
-- drop table if exists public.portal_post_course_mappings;
-- drop table if exists public.course_slug_mappings;
--
-- alter table public.orders
--   drop column if exists course_id,
--   drop column if exists normalized_customer_email,
--   drop column if exists sync_correlation_id,
--   drop column if exists source_system;
--
-- alter table public.student_enrollments
--   drop column if exists normalized_email,
--   drop column if exists sync_correlation_id,
--   drop column if exists source_system;
--
-- alter table public.lessons
--   drop column if exists kind,
--   drop column if exists parent_section_id,
--   drop column if exists position;

