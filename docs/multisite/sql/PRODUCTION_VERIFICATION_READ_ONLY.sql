-- Read-only post-migration verification. Do not run inside a write transaction.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

SELECT column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='courses'
  AND column_name='learning_site';

SELECT conname,pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid='public.courses'::regclass
  AND conname IN ('courses_learning_site_check','courses_slug_key')
ORDER BY conname;

SELECT indexname,indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='courses'
  AND indexname IN (
    'idx_courses_learning_site',
    'idx_courses_learning_site_active_status',
    'idx_courses_learning_target_site',
    'courses_slug_key'
  )
ORDER BY indexname;

SELECT
  count(*) FILTER (WHERE learning_site IS NOT NULL) AS explicit_rows,
  count(*) FILTER (
    WHERE learning_site IS NOT NULL
      AND learning_site NOT IN ('yeunauan','yeubep')
  ) AS invalid_rows
FROM public.courses;

SELECT
  (SELECT count(*) FROM public.courses) AS courses,
  (SELECT count(*) FROM public.orders) AS orders,
  (SELECT count(*) FROM public.student_enrollments) AS enrollments,
  (SELECT count(*) FROM public.lessons) AS lessons,
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
