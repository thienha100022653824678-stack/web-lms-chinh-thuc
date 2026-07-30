-- PREVIEW-ONLY rollback. Removes only objects tracked as substrate-created.
BEGIN;

DO $guard$
BEGIN
  IF current_setting('lms.preview_guard', true) <> '1'
     OR current_setting('lms.preview_ref', true) <> 'plgrmaktvudjetfkwmyg'
     OR current_setting('lms.preview_ref', true) = 'aqozjkfwzmyfunqvcyjv' THEN
    RAISE EXCEPTION 'PRODUCTION_DATABASE_FORBIDDEN';
  END IF;
END
$guard$;

DELETE FROM public.lesson_progress WHERE email LIKE '%@example.test';
DELETE FROM public.admin_audit_logs WHERE admin_email LIKE '%@example.test' OR target_email LIKE '%@example.test';
DELETE FROM public.drive_permission_logs WHERE email LIKE '%@example.test' OR student_email LIKE '%@example.test';
DELETE FROM public.drive_sync_queue WHERE email LIKE '%@example.test';
DELETE FROM public.student_enrollments
  WHERE email IN (
    'student-a.yeunauan@example.test','student-b.yeubep@example.test',
    'student-no-enrollment@example.test','student-revoked@example.test',
    'student-shared@example.test'
  );
DELETE FROM public.students WHERE email LIKE '%@example.test'
  AND email NOT LIKE '%@v5.preview@example.test';
DELETE FROM public.site_config WHERE key LIKE 'preview-%';
DELETE FROM public.orders WHERE order_code LIKE 'PREVIEW-%';
DELETE FROM public.lessons WHERE course_slug LIKE 'preview-%';
DELETE FROM public.courses WHERE slug LIKE 'preview-%';

DO $constraints$
DECLARE v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT object_name FROM public.lms_b05_preview_substrate_manifest WHERE object_kind='constraint'
  LOOP
    EXECUTE format('ALTER TABLE public.student_enrollments DROP CONSTRAINT IF EXISTS %I', v_constraint);
  END LOOP;
END
$constraints$;

DO $columns$
DECLARE v_col text;
BEGIN
  FOR v_col IN
    SELECT object_name FROM public.lms_b05_preview_substrate_manifest
    WHERE object_kind='student_enrollments_column'
  LOOP
    EXECUTE format('ALTER TABLE public.student_enrollments DROP COLUMN IF EXISTS %I', v_col);
  END LOOP;
END
$columns$;

DO $indexes$
DECLARE v_index text;
BEGIN
  FOR v_index IN
    SELECT object_name FROM public.lms_b05_preview_substrate_manifest WHERE object_kind='index'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_index);
  END LOOP;
END
$indexes$;

DO $tables$
DECLARE v_name text;
BEGIN
  FOR v_name IN
    SELECT object_name FROM public.lms_b05_preview_substrate_manifest
    WHERE object_kind='table'
    ORDER BY CASE object_name
      WHEN 'lesson_progress' THEN 1 WHEN 'lessons' THEN 2
      WHEN 'orders' THEN 3 WHEN 'courses' THEN 4 ELSE 0 END
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I', v_name);
  END LOOP;
END
$tables$;

DROP TABLE public.lms_b05_preview_substrate_manifest;
COMMIT;
