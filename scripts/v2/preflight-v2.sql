-- V2 preflight checks for Supabase B / LMS production.
-- Target project ref must be aqozjkfwzmyfunqvcyjv.
-- This script is read-only.

-- 1. Required extension/function dependency.
select
  'pgcrypto_extension' as check_name,
  coalesce(to_regnamespace('extensions') is not null, false) as has_extensions_schema,
  exists (
    select 1
    from pg_extension
    where extname = 'pgcrypto'
  ) as has_pgcrypto,
  to_regprocedure('gen_random_uuid()') is not null as has_gen_random_uuid;

-- 2. Existing V1 core tables.
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
    ('lesson_progress')
) as required(table_name)
order by table_name;

-- 3. V2 table visibility before/after migration.
select
  'v2_table' as check_type,
  table_name,
  to_regclass('public.' || table_name) is not null as exists
from (
  values
    ('sync_outbox'),
    ('sync_deliveries'),
    ('sync_dead_letters'),
    ('course_slug_mappings'),
    ('portal_post_course_mappings')
) as required(table_name)
order by table_name;

-- 4. Session/account sharing operational tables.
select
  'session_guard_table' as check_type,
  table_name,
  to_regclass('public.' || table_name) is not null as exists
from (
  values
    ('student_active_sessions'),
    ('lms_entry_tokens'),
    ('lms_verified_sessions'),
    ('student_device_change_logs'),
    ('student_account_risk_reviews'),
    ('student_account_risk_summaries'),
    ('student_session_controls'),
    ('admin_audit_logs')
) as required(table_name)
order by table_name;

-- 5. Important functions.
select
  'function' as check_type,
  function_name,
  to_regprocedure(function_signature) is not null as exists
from (
  values
    ('handle_student_session_login', 'public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)'),
    ('reset_student_session_guard', 'public.reset_student_session_guard(text,text,text,text,text,text,boolean)'),
    ('cleanup_student_account_risk_events', 'public.cleanup_student_account_risk_events(integer)')
) as required(function_name, function_signature)
order by function_name;

-- 6. One-active-session guard.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'idx_one_active_student_session_per_email';

select
  lower(trim(email)) as normalized_email,
  count(*) as active_session_count
from student_active_sessions
where status = 'active'
group by lower(trim(email))
having count(*) > 1;

-- 7. Row counts that will affect V2 identity backfill.
select 'courses' as table_name, count(*) as row_count from courses
union all
select 'orders', count(*) from orders
union all
select 'orders_with_course_slug', count(*) from orders where course_slug is not null
union all
select 'student_enrollments', count(*) from student_enrollments
union all
select 'enrollments_with_course_slug', count(*) from student_enrollments where course_slug is not null
union all
select 'lessons', count(*) from lessons
union all
select 'lessons_with_course_slug', count(*) from lessons where course_slug is not null;

-- 8. Potential slug duplicates that can create ambiguous mapping behavior.
select
  lower(trim(slug)) as normalized_slug,
  count(*) as course_count
from courses
where slug is not null
group by lower(trim(slug))
having count(*) > 1
order by course_count desc, normalized_slug;

-- 9. Existing unmapped rows before V2 identity migration.
select
  'orders_missing_course_match' as check_name,
  count(*) as row_count
from orders o
where o.course_slug is not null
  and not exists (
    select 1
    from courses c
    where lower(trim(c.slug)) = lower(trim(o.course_slug))
  )
union all
select
  'enrollments_missing_course_match',
  count(*)
from student_enrollments e
where e.course_slug is not null
  and not exists (
    select 1
    from courses c
    where lower(trim(c.slug)) = lower(trim(e.course_slug))
  )
union all
select
  'lessons_missing_course_match',
  count(*)
from lessons l
where l.course_slug is not null
  and not exists (
    select 1
    from courses c
    where lower(trim(c.slug)) = lower(trim(l.course_slug))
  );

