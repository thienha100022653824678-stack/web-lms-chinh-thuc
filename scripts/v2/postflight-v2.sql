-- V2 postflight checks for Supabase B / LMS production.
-- Run after applying V2 migrations. This script is read-only.

-- 1. V2 schema objects.
select
  'table' as object_type,
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

-- 2. V2 columns on V1 tables.
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'orders' and column_name in ('course_id', 'normalized_customer_email', 'sync_correlation_id', 'source_system'))
    or (table_name = 'student_enrollments' and column_name in ('normalized_email', 'sync_correlation_id', 'source_system'))
    or (table_name = 'lessons' and column_name in ('kind', 'parent_section_id', 'position'))
  )
order by table_name, column_name;

-- 3. V2 index presence.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_sync_outbox_status_available',
    'idx_sync_outbox_aggregate',
    'idx_sync_outbox_event_type',
    'idx_sync_deliveries_target_status',
    'idx_sync_deliveries_outbox',
    'idx_sync_dead_letters_status',
    'idx_orders_course_id',
    'idx_orders_normalized_customer_email',
    'idx_orders_sync_correlation',
    'idx_student_enrollments_normalized_email',
    'idx_student_enrollments_course_id_status',
    'idx_student_enrollments_sync_correlation',
    'idx_lessons_kind_parent_position',
    'idx_course_slug_mappings_course',
    'idx_portal_post_course_mappings_course',
    'idx_portal_post_course_mappings_slug'
  )
order by tablename, indexname;

-- 4. V2 mapping and gap counts.
select 'sync_outbox' as metric, count(*) as value from sync_outbox
union all
select 'sync_deliveries', count(*) from sync_deliveries
union all
select 'sync_dead_letters', count(*) from sync_dead_letters
union all
select 'course_slug_mappings', count(*) from course_slug_mappings
union all
select 'portal_post_course_mappings', count(*) from portal_post_course_mappings
union all
select 'orders_with_slug_course_id_null', count(*) from orders where course_slug is not null and course_id is null
union all
select 'enrollments_with_slug_course_id_null', count(*) from student_enrollments where course_slug is not null and course_id is null
union all
select 'lessons_with_slug_course_id_null', count(*) from lessons where course_slug is not null and course_id is null;

-- 5. Normalization checks.
select
  'orders_missing_normalized_email' as check_name,
  count(*) as row_count
from orders
where customer_email is not null
  and normalized_customer_email is null
union all
select
  'enrollments_missing_normalized_email',
  count(*)
from student_enrollments
where email is not null
  and normalized_email is null;

-- 6. Lesson hierarchy sanity.
select
  'sections_without_kind_section' as check_name,
  count(*) as row_count
from lessons
where is_section is true
  and coalesce(kind, '') <> 'section'
union all
select
  'lesson_rows_without_kind_lesson',
  count(*)
from lessons
where coalesce(is_section, false) is false
  and coalesce(kind, '') <> 'lesson';

