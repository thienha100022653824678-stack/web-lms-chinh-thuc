-- V3 postflight checks for Supabase B / LMS production.
-- Run AFTER applying the four V3 migrations (B1-B4), in order:
--   B1 migration_v3_runtime_config.sql      (Phase 0)
--   B2 migration_v3_outbox_dead_letters.sql (Phase 3)
--   B3 migration_v3_rls_policies.sql        (Phase 2)
--   B4 migration_v3_formalize_drift_columns.sql (Phase 10)
-- Read-only: SELECT / to_regclass / catalog reads only. A companion test
-- (tests/v3-preflight-postflight.test.mjs) statically asserts this file is
-- write-free and therefore safe to run on production.

-- 1. V3 config tables created (B1).
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
-- Expected AFTER B1: both true.

-- 2. Singleton row exists and defaults to v1 (the fail-closed rollback target).
select
  id,
  active_mode,                 -- expect 'v1' immediately after apply
  v2_shadow_mode,              -- expect false
  v3_shadow_mode,              -- expect false
  kill_switch,                 -- expect false (active_mode='v1' is already safe)
  updated_by,
  updated_at
from public.platform_runtime_config
where id = 1;
-- Expected: exactly one row, active_mode='v1'.

-- 3. RLS is enabled on both V3 config tables and neither has a public policy
-- (browser cannot read/write the runtime config; only service-role / SQL Editor).
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('platform_runtime_config', 'platform_runtime_config_audit')
order by c.relname;
-- Expected: rls_enabled=true, policy_count=0 for both.

-- 4. Outbox completed: sync_dead_letters now exists (B2).
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
-- Expected AFTER B2: all three true.

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'sync_dead_letters'
order by indexname;
-- Expected: idx_sync_dead_letters_status present (from B2).

-- 5. The 8 V3 RLS policies were created (B3).
select
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and policyname like 'v3_%'
order by tablename, policyname;
-- Expected AFTER B3: exactly these 8 —
--   courses:        v3_anon_read_active_courses, v3_auth_read_active_courses
--   lessons:        v3_anon_read_free_lessons,   v3_auth_read_enrolled_lessons
--   student_enrollments: v3_auth_read_own_enrollments
--   lesson_progress:     v3_auth_read_own_progress, v3_auth_update_own_progress
--   student_active_sessions: v3_auth_read_own_sessions

select
  count(*) as v3_policy_count
from pg_policies
where schemaname = 'public' and policyname like 'v3_%';
-- Expected: 8.

-- 6. handle_student_session_login normalized to SECURITY DEFINER + pinned
-- search_path (B3), and grants remain hardened (service_role-only).
select
  p.prosecdef as is_definer,            -- expect true AFTER B3
  p.proconfig,                          -- expect {search_path=public} AFTER B3
  has_function_privilege('anon','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as anon_exec,
  has_function_privilege('authenticated','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as authenticated_exec,
  has_function_privilege('PUBLIC','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as public_exec,
  has_function_privilege('service_role','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE') as service_role_exec
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_student_session_login';
-- Expected AFTER B3: is_definer=true, proconfig contains search_path=public,
--   anon/authenticated/PUBLIC exec=false, service_role exec=true.

-- 7. Drift columns declared (B4). ADD COLUMN IF NOT EXISTS is a no-op on prod,
-- so this confirms presence (they already existed) — no data changed.
select
  'drift_column' as check_type,
  table_name,
  column_name,
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
-- Expected AFTER B4: all column_exists=true.

-- 8. Invariants inherited from V1/V2 still hold (V3 is additive and must not
-- break them). Compare row counts against the preflight (§9) — they must be
-- unchanged (V3 migrations add no business data).
select 'student_active_sessions' as table_name, count(*) as row_count from public.student_active_sessions
union all select 'lms_verified_sessions', count(*) from public.lms_verified_sessions
union all select 'lms_entry_tokens', count(*) from public.lms_entry_tokens
union all select 'lesson_progress', count(*) from public.lesson_progress
union all select 'student_enrollments', count(*) from public.student_enrollments
union all select 'sync_outbox', count(*) from public.sync_outbox
union all select 'sync_deliveries', count(*) from public.sync_deliveries
union all select 'sync_dead_letters', count(*) from public.sync_dead_letters
order by table_name;
-- Expected: all counts equal the preflight §9 values, except sync_dead_letters
-- which is newly created and should be 0 (no dead-letter rows migrated).

-- 9. One-active-session partial unique index + enrollment uniqueness intact.
select
  schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'idx_one_active_student_session_per_email';

select
  conname, conrelid::regclass as table_name, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.student_enrollments'::regclass
  and conname = 'student_enrollments_email_course_slug_key';

-- 10. Final GO/NO-GO summary: all V3 objects present and posture correct.
-- Each row should be 'true'. If any is 'false', do NOT enable v3 — investigate.
select
  'runtime_config_table' as requirement, to_regclass('public.platform_runtime_config') is not null as ok
union all select
  'runtime_config_singleton_v1', exists (select 1 from public.platform_runtime_config where id=1 and active_mode='v1')
union all select
  'sync_dead_letters_table', to_regclass('public.sync_dead_letters') is not null
union all select
  'v3_policy_count_is_8', (select count(*) = 8 from pg_policies where schemaname='public' and policyname like 'v3_%')
union all select
  'login_rpc_is_definer', exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='handle_student_session_login' and p.prosecdef is true
  )
union all select
  'login_rpc_search_path_pinned', exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='handle_student_session_login'
      and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=public%'
  )
union all select
  'login_grants_hardened',
  (not has_function_privilege('anon','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  and (not has_function_privilege('authenticated','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  and (not has_function_privilege('PUBLIC','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  and has_function_privilege('service_role','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE')
order by requirement;
