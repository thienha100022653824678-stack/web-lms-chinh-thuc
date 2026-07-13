-- V2 postflight checks for Supabase B / LMS production.
-- Run after applying V2 migrations.
--
-- This script is schema-safe: it does not crash when a V2 table/column is
-- missing. It uses a temporary result table only for this SQL session and does
-- not modify persistent application data.

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
  required.table_name,
  required.column_name,
  columns.data_type,
  columns.is_nullable,
  columns.column_name is not null as exists
from (
  values
    ('orders', 'course_id'),
    ('orders', 'normalized_customer_email'),
    ('orders', 'sync_correlation_id'),
    ('orders', 'source_system'),
    ('student_enrollments', 'normalized_email'),
    ('student_enrollments', 'sync_correlation_id'),
    ('student_enrollments', 'source_system'),
    ('lessons', 'kind'),
    ('lessons', 'parent_section_id'),
    ('lessons', 'position')
) as required(table_name, column_name)
left join information_schema.columns columns
  on columns.table_schema = 'public'
 and columns.table_name = required.table_name
 and columns.column_name = required.column_name
order by required.table_name, required.column_name;

-- 3. V2 index presence.
select
  expected.indexname,
  indexes.tablename,
  indexes.indexdef,
  indexes.indexname is not null as exists
from (
  values
    ('idx_sync_outbox_status_available'),
    ('idx_sync_outbox_aggregate'),
    ('idx_sync_outbox_event_type'),
    ('idx_sync_deliveries_target_status'),
    ('idx_sync_deliveries_outbox'),
    ('idx_sync_dead_letters_status'),
    ('idx_orders_course_id'),
    ('idx_orders_normalized_customer_email'),
    ('idx_orders_sync_correlation'),
    ('idx_student_enrollments_normalized_email'),
    ('idx_student_enrollments_course_id_status'),
    ('idx_student_enrollments_sync_correlation'),
    ('idx_lessons_kind_parent_position'),
    ('idx_course_slug_mappings_course'),
    ('idx_portal_post_course_mappings_course'),
    ('idx_portal_post_course_mappings_slug')
) as expected(indexname)
left join pg_indexes indexes
  on indexes.schemaname = 'public'
 and indexes.indexname = expected.indexname
order by expected.indexname;

-- 4. Schema-safe count/gap checks.
create temp table if not exists v2_postflight_results (
  metric text primary key,
  status text not null,
  value bigint,
  note text
) on commit drop;

truncate table v2_postflight_results;

do $$
declare
  v_has_orders_identity boolean;
  v_has_enrollment_identity boolean;
  v_has_lesson_identity boolean;
begin
  -- Table row counts. Missing tables are reported instead of crashing.
  if to_regclass('public.sync_outbox') is not null then
    execute 'insert into v2_postflight_results select ''sync_outbox'', ''ok'', count(*), null from public.sync_outbox';
  else
    insert into v2_postflight_results values ('sync_outbox', 'missing_table', null, 'Apply migration_v2_sync_outbox.sql first.');
  end if;

  if to_regclass('public.sync_deliveries') is not null then
    execute 'insert into v2_postflight_results select ''sync_deliveries'', ''ok'', count(*), null from public.sync_deliveries';
  else
    insert into v2_postflight_results values ('sync_deliveries', 'missing_table', null, 'Apply migration_v2_sync_outbox.sql first.');
  end if;

  if to_regclass('public.sync_dead_letters') is not null then
    execute 'insert into v2_postflight_results select ''sync_dead_letters'', ''ok'', count(*), null from public.sync_dead_letters';
  else
    insert into v2_postflight_results values ('sync_dead_letters', 'missing_table', null, 'Apply migration_v2_sync_outbox.sql first.');
  end if;

  if to_regclass('public.course_slug_mappings') is not null then
    execute 'insert into v2_postflight_results select ''course_slug_mappings'', ''ok'', count(*), null from public.course_slug_mappings';
  else
    insert into v2_postflight_results values ('course_slug_mappings', 'missing_table', null, 'Apply migration_v2_identity_mapping.sql first.');
  end if;

  if to_regclass('public.portal_post_course_mappings') is not null then
    execute 'insert into v2_postflight_results select ''portal_post_course_mappings'', ''ok'', count(*), null from public.portal_post_course_mappings';
  else
    insert into v2_postflight_results values ('portal_post_course_mappings', 'missing_table', null, 'Apply migration_v2_identity_mapping.sql first.');
  end if;

  select count(*) = 4
  into v_has_orders_identity
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'orders'
    and column_name in ('course_slug', 'course_id', 'customer_email', 'normalized_customer_email');

  select count(*) = 4
  into v_has_enrollment_identity
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'student_enrollments'
    and column_name in ('course_slug', 'course_id', 'email', 'normalized_email');

  select count(*) = 4
  into v_has_lesson_identity
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'lessons'
    and column_name in ('course_slug', 'course_id', 'is_section', 'kind');

  if v_has_orders_identity then
    execute 'insert into v2_postflight_results select ''orders_with_slug_course_id_null'', ''ok'', count(*), null from public.orders where course_slug is not null and course_id is null';
    execute 'insert into v2_postflight_results select ''orders_missing_normalized_email'', ''ok'', count(*), null from public.orders where customer_email is not null and normalized_customer_email is null';
  else
    insert into v2_postflight_results values ('orders_identity_checks', 'missing_required_columns', null, 'Expected orders identity columns are incomplete.');
  end if;

  if v_has_enrollment_identity then
    execute 'insert into v2_postflight_results select ''enrollments_with_slug_course_id_null'', ''ok'', count(*), null from public.student_enrollments where course_slug is not null and course_id is null';
    execute 'insert into v2_postflight_results select ''enrollments_missing_normalized_email'', ''ok'', count(*), null from public.student_enrollments where email is not null and normalized_email is null';
  else
    insert into v2_postflight_results values ('enrollments_identity_checks', 'missing_required_columns', null, 'Expected student_enrollments identity columns are incomplete.');
  end if;

  if v_has_lesson_identity then
    execute 'insert into v2_postflight_results select ''lessons_with_slug_course_id_null'', ''ok'', count(*), null from public.lessons where course_slug is not null and course_id is null';
    execute 'insert into v2_postflight_results select ''sections_without_kind_section'', ''ok'', count(*), null from public.lessons where is_section is true and coalesce(kind, '''') <> ''section''';
    execute 'insert into v2_postflight_results select ''lesson_rows_without_kind_lesson'', ''ok'', count(*), null from public.lessons where coalesce(is_section, false) is false and coalesce(kind, '''') <> ''lesson''';
  else
    insert into v2_postflight_results values ('lessons_identity_checks', 'missing_required_columns', null, 'Expected lessons identity columns are incomplete.');
  end if;
end $$;

select *
from v2_postflight_results
order by metric;

