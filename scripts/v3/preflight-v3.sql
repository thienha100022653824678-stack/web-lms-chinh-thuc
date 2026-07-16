-- V3 preflight checks for Supabase B / LMS production.
-- Run BEFORE applying any V3 migration (B1-B4). Read-only.
--
-- Target project ref: aqozjkfwzmyfunqvcyjv.
-- Purpose: capture the exact "before" state so the owner can confirm V3
-- migrations apply cleanly against the verified baseline
-- (docs/V3_SCHEMA_GAP_SQL_RESULTS.md) and that no prerequisite drifted.
-- This script performs NO writes. It contains only SELECT / to_regclass /
-- catalog reads. A companion test (tests/v3-preflight-postflight.test.mjs)
-- statically asserts this file is write-free.

-- 1. pgcrypto + gen_random_uuid dependency (inherited from V1/V2).
select
  'pgcrypto_extension' as check_name,
  coalesce(to_regnamespace('extensions') is not null, false) as has_extensions_schema,
  exists (select 1 from pg_extension where extname = 'pgcrypto') as has_pgcrypto,
  to_regprocedure('gen_random_uuid()') is not null as has_gen_random_uuid;

-- 2. V1 core tables must all exist (V3 is additive on top of these).
select
  'core_table' as check_type,
  table_name,
  to_regclass('public.' || table_name) is not null as exists
from (
  values
    ('courses'),
    ('orders'),
    ('lessons'),
    ('students'),
    ('student_enrollments'),
    ('site_config'),
    ('lesson_progress'),
    ('student_active_sessions'),
    ('lms_entry_tokens'),
    ('lms_verified_sessions')
) as required(table_name)
order by table_name;

-- 3. V2 outbox state — V3 Phase 3 reconciles the missing third table.
select
  'outbox_table' as check_type,
  table_name,
  to_regclass('public.' || table_name) is not null as exists
from (
  values
    ('sync_outbox'),
    ('sync_deliveries'),
    ('sync_dead_letters')
) as required(table_name)
order by table_name;
-- Expected BEFORE V3: sync_outbox=true, sync_deliveries=true, sync_dead_letters=false.

-- 4. RLS baseline: every public table has RLS ENABLED and ZERO policies.
-- (VERIFIED 2026-07-15: RLS on, 0 policy, force_rls off on all 25 public tables.)
select
  'rls_baseline' as check_type,
  count(*) filter (where relrowsecurity is true) as tables_with_rls_on,
  count(*) filter (where relrowsecurity is not true) as tables_with_rls_off,
  count(*) as total_public_tables
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

select
  tablename,
  count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;
-- Expected BEFORE V3 Phase 2: zero rows (no policies on any public table).

-- 5. handle_student_session_login — security mode + EXECUTE grants.
-- (VERIFIED: SECURITY INVOKER, proconfig null; service_role EXECUTE=true;
--  PUBLIC/anon/authenticated EXECUTE=false.)
select
  p.proname as function_name,
  p.prosecdef as is_definer,           -- expect false (INVOKER) before Phase 2
  p.proconfig,                         -- expect null before Phase 2
  has_function_privilege('anon','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as anon_exec,
  has_function_privilege('authenticated','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as authenticated_exec,
  has_function_privilege('PUBLIC','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as public_exec,
  has_function_privilege('service_role','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as service_role_exec
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_student_session_login';

-- 6. V3 config tables must NOT exist yet (this is a pre-apply preflight).
select
  'v3_config_table' as check_type,
  table_name,
  to_regclass('public.' || table_name) is not null as exists
from (
  values
    ('platform_runtime_config'),
    ('platform_runtime_config_audit')
) as required(table_name)
order by table_name;
-- Expected BEFORE Phase 0: both false.

-- 7. Verified drift columns already present on prod (V3 Phase 10 DECLARES them
-- additively; ADD COLUMN IF NOT EXISTS is a no-op where they exist). Recording
-- their pre-apply presence confirms the formalize migration will not change data.
select
  'drift_column' as check_type,
  table_name,
  column_name,
  (to_regclass('public.' || table_name) is not null) as table_exists,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  ) as column_exists
from (
  values
    ('lessons','is_section'),
    ('lessons','materials'),
    ('lessons','kind'),
    ('lessons','parent_section_id'),
    ('lessons','position'),
    ('courses','is_published'),
    ('courses','expected_start_date'),
    ('courses','drive_folder_id'),
    ('courses','drive_permission_mode'),
    ('courses','sync_lms_status'),
    ('courses','sync_portal_status'),
    ('courses','sync_error'),
    ('orders','course_id'),
    ('orders','normalized_customer_email'),
    ('orders','sync_correlation_id'),
    ('orders','source_system'),
    ('student_enrollments','course_id'),
    ('student_enrollments','normalized_email'),
    ('student_enrollments','sync_correlation_id'),
    ('student_enrollments','source_system')
) as required(table_name, column_name)
order by table_name, column_name;

-- 8. Invariants inherited from V1/V2 that V3 must not break.
-- 8a. One-active-session partial unique index (invariant #5).
select
  schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'idx_one_active_student_session_per_email';

-- 8b. Enrollment uniqueness (invariant #1).
select
  conname, conrelid::regclass as table_name, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.student_enrollments'::regclass
  and conname = 'student_enrollments_email_course_slug_key';

-- 9. Baseline row counts of V3-touched tables (compare against postflight).
select 'student_active_sessions' as table_name, count(*) as row_count from public.student_active_sessions
union all select 'lms_verified_sessions', count(*) from public.lms_verified_sessions
union all select 'lms_entry_tokens', count(*) from public.lms_entry_tokens
union all select 'lesson_progress', count(*) from public.lesson_progress
union all select 'student_enrollments', count(*) from public.student_enrollments
union all select 'sync_outbox', count(*) from public.sync_outbox
union all select 'sync_deliveries', count(*) from public.sync_deliveries
order by table_name;
