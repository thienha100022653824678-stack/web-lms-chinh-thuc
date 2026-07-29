-- Read-only post-migration verification.
-- BUSINESS_DATA_CHECKSUM_BEFORE must be captured with the same explicit
-- pre-existing column projection before applying the migration.
-- Never replace these projections with SELECT *, row_to_json(t.*), or
-- to_jsonb(t.*): those representations change when a nullable column is added.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

WITH business_rows AS (
  SELECT 'courses' table_name, id::text row_key,
    jsonb_build_object(
      'active',active,'description',description,'drive_folder_id',drive_folder_id,
      'drive_permission_mode',drive_permission_mode,'expected_start_date',expected_start_date,
      'id',id,'image_url',image_url,'is_published',is_published,
      'learning_course_slug',learning_course_slug,'price',price,'raw_data',raw_data,
      'sales_site',sales_site,'slug',slug,'sort_order',sort_order,'subtitle',subtitle,
      'sync_error',sync_error,'sync_lms_status',sync_lms_status,
      'sync_portal_status',sync_portal_status,'teacher_name',teacher_name,'title',title
    ) payload
  FROM public.courses
  UNION ALL
  SELECT 'lessons',id::text,
    jsonb_build_object(
      'active',active,'bunny_library_id',bunny_library_id,'bunny_video_id',bunny_video_id,
      'course_id',course_id,'course_slug',course_slug,'description',description,
      'document_url',document_url,'duration_text',duration_text,'id',id,'is_free',is_free,
      'is_section',is_section,'kind',kind,'lesson_no',lesson_no,'level',level,
      'materials',materials,'media_urls',media_urls,'parent_section_id',parent_section_id,
      'photo_url',photo_url,'position',position,'raw_data',raw_data,'recipe_url',recipe_url,
      'sort_order',sort_order,'status',status,'thumbnail_url',thumbnail_url,'title',title,
      'video_provider',video_provider,'video_url',video_url,'views',views
    )
  FROM public.lessons
  UNION ALL
  SELECT 'student_enrollments',id::text,
    jsonb_build_object(
      'course_id',course_id,'course_slug',course_slug,
      'drive_folder_id',drive_folder_id,'drive_permission_admin_email',drive_permission_admin_email,
      'drive_permission_error',drive_permission_error,'drive_permission_id',drive_permission_id,
      'drive_permission_retry_count',drive_permission_retry_count,
      'drive_permission_status',drive_permission_status,'email',email,'id',id,
      'normalized_email',normalized_email,'source_order_id',source_order_id,
      'source_system',source_system,'status',status,'student_id',student_id,
      'sync_correlation_id',sync_correlation_id
    )
  FROM public.student_enrollments
  UNION ALL
  SELECT 'lesson_progress',id::text,
    jsonb_build_object(
      'completed',completed,'course_slug',course_slug,'email',email,'id',id,
      'lesson_id',lesson_id,'progress_percent',progress_percent
    )
  FROM public.lesson_progress
  UNION ALL
  SELECT 'site_config',key,
    jsonb_build_object('key',key,'value',value)
  FROM public.site_config
),
table_payloads AS (
  SELECT table_name,
    coalesce(string_agg(payload::text,E'\n' ORDER BY row_key),'') payload
  FROM business_rows GROUP BY table_name
),
canonical_payload AS (
  SELECT string_agg(table_name || E'\n' || payload,E'\n--TABLE--\n' ORDER BY table_name) payload
  FROM table_payloads
)
SELECT
  encode(extensions.digest(convert_to(coalesce(payload,''),'UTF8'),'sha256'),'hex')
    AS "BUSINESS_DATA_CHECKSUM_AFTER"
FROM canonical_payload;

WITH expected_indexes(name) AS (
  VALUES
    ('idx_courses_learning_site'),
    ('idx_courses_learning_site_active_status'),
    ('idx_courses_learning_target_site')
),
schema_contract AS (
  SELECT jsonb_build_object(
    'column', (SELECT jsonb_build_object(
      'column_name',column_name,'data_type',data_type,'is_nullable',is_nullable
    ) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='courses' AND column_name='learning_site'),
    'constraint', (SELECT jsonb_build_object(
      'name',conname,'definition',pg_get_constraintdef(oid,true)
    ) FROM pg_constraint
      WHERE conrelid='public.courses'::regclass AND conname='courses_learning_site_check'),
    'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name',indexname,'definition',indexdef
    ) ORDER BY indexname),'[]'::jsonb)
      FROM pg_indexes WHERE schemaname='public' AND tablename='courses'
      AND indexname IN (SELECT name FROM expected_indexes)),
    'comment', col_description('public.courses'::regclass,
      (SELECT ordinal_position FROM information_schema.columns
       WHERE table_schema='public' AND table_name='courses' AND column_name='learning_site'))
  ) payload
)
SELECT
  encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')
    AS "SCHEMA_CHECKSUM_AFTER",
  (
    (payload->'column'->>'data_type')='text'
    AND (payload->'column'->>'is_nullable')='YES'
    AND (payload->'constraint'->>'definition') LIKE '%learning_site IS NULL%'
    AND (payload->'constraint'->>'definition') LIKE '%yeunauan%'
    AND (payload->'constraint'->>'definition') LIKE '%yeubep%'
    AND jsonb_array_length(payload->'indexes')=3
    AND (payload->>'comment')='Logical LMS content owner. Nullable for deterministic legacy compatibility.'
  ) AS "EXPECTED_SCHEMA_DELTA_MATCH"
FROM schema_contract;

SELECT
  count(*) FILTER (WHERE learning_site IS NULL) AS "LEARNING_SITE_NULL_COUNT",
  count(*) FILTER (WHERE learning_site IS NOT NULL) AS "LEARNING_SITE_NON_NULL_COUNT",
  count(*) FILTER (
    WHERE learning_site IS NOT NULL
      AND learning_site NOT IN ('yeunauan','yeubep')
  ) AS "INVALID_LEARNING_SITE_COUNT"
FROM public.courses;

SELECT
  (SELECT count(*) FROM public.courses) AS courses,
  (SELECT count(*) FROM public.orders) AS orders,
  (SELECT count(*) FROM public.student_enrollments) AS enrollments,
  (SELECT count(*) FROM public.lessons) AS lessons,
  (SELECT count(*) FROM public.lesson_progress) AS lesson_progress,
  (SELECT count(*) FROM public.site_config) AS site_config;

SELECT count(*) AS duplicate_course_slugs
FROM (
  SELECT slug FROM public.courses GROUP BY slug HAVING count(*) > 1
) duplicate;

SELECT count(*) AS duplicate_enrollment_identity
FROM (
  SELECT email,course_slug
  FROM public.student_enrollments
  GROUP BY email,course_slug HAVING count(*) > 1
) duplicate;

SELECT
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.courses'::regclass
      AND contype='u' AND pg_get_constraintdef(oid) ~* 'UNIQUE.*\(slug\)'
  ) AS global_slug_unique_preserved,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.student_enrollments'::regclass
      AND contype='u' AND pg_get_constraintdef(oid) ~* 'UNIQUE.*\(email, course_slug\)'
  ) AS enrollment_identity_preserved;
