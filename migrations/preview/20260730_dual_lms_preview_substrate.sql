-- PREVIEW-ONLY. Not part of the Production migration chain.
-- The runner must SET LOCAL lms.preview_guard/ref before executing this file.
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

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.lms_b05_preview_substrate_manifest (
  object_kind text NOT NULL,
  object_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_kind, object_name)
);

DO $tables$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'courses','orders','lessons','site_config','students','lesson_progress',
    'admin_audit_logs','drive_permission_logs','drive_sync_queue','drive_admin_accounts'
  ] LOOP
    IF to_regclass('public.' || v_name) IS NULL THEN
      INSERT INTO public.lms_b05_preview_substrate_manifest(object_kind, object_name)
      VALUES ('table', v_name) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END
$tables$;

CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  price text,
  image_url text,
  description text,
  teacher_name text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  active boolean DEFAULT true,
  is_published boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  sync_lms_status text,
  sync_portal_status text,
  sync_error text,
  drive_folder_id text,
  drive_permission_mode text,
  expected_start_date date,
  sales_site text,
  learning_course_slug text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT courses_sales_site_check CHECK (sales_site IS NULL OR sales_site IN ('yeunauan','yeubep'))
);

-- Synthetic Preview orders only. No Production order row or customer identity is copied.
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE,
  course_slug text,
  learning_course_slug text,
  sales_site text,
  status text NOT NULL DEFAULT 'pending',
  customer_email text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS price text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS teacher_name text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sync_lms_status text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sync_portal_status text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sync_error text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS drive_permission_mode text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS expected_start_date date;

CREATE TABLE IF NOT EXISTS public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  course_slug text NOT NULL,
  lesson_no integer NOT NULL,
  title text NOT NULL,
  description text,
  video_provider text DEFAULT 'fixture',
  video_url text,
  bunny_library_id text,
  bunny_video_id text,
  recipe_url text,
  document_url text,
  photo_url text,
  thumbnail_url text,
  duration_text text,
  level text,
  media_urls text,
  views integer DEFAULT 0,
  is_free boolean DEFAULT false,
  active boolean DEFAULT true,
  status text DEFAULT 'active',
  sort_order integer DEFAULT 0,
  raw_data jsonb DEFAULT '{}'::jsonb,
  is_section boolean DEFAULT false,
  materials jsonb DEFAULT '[]'::jsonb,
  kind text,
  parent_section_id uuid,
  position integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(course_slug, lesson_no)
);

ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS duration_text text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS level text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS bunny_library_id text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS bunny_video_id text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS views integer DEFAULT 0;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS is_free boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.site_config (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  phone text,
  status text DEFAULT 'active',
  note text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  course_slug text NOT NULL,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  progress_percent integer DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  completed boolean DEFAULT false,
  last_watched_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(email, lesson_id)
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text,
  action text NOT NULL,
  target_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.drive_permission_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time timestamptz DEFAULT now(),
  course_slug text NOT NULL,
  folder_id text,
  email text NOT NULL,
  action text NOT NULL,
  status text NOT NULL,
  message text,
  request_id text,
  student_email text,
  course_id uuid,
  drive_folder_id text,
  drive_admin_email text,
  permission_id text,
  error_code text,
  error_message text,
  retry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_retry_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.drive_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  course_slug text NOT NULL,
  action text NOT NULL,
  attempts integer DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.drive_admin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  daily_share_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- V5 Preview already owns student_enrollments. Track and add only missing B05 columns.
DO $enrollment_columns$
DECLARE
  v_col text;
  v_type text;
BEGIN
  IF to_regclass('public.student_enrollments') IS NULL THEN
    RAISE EXCEPTION 'PREVIEW_V5_ENROLLMENT_TABLE_MISSING';
  END IF;
  FOR v_col, v_type IN
    SELECT * FROM (VALUES
      ('student_id','uuid'),('course_id','uuid'),('source_order_id','uuid'),
      ('expired_at','timestamptz'),('drive_permission_status','text'),
      ('drive_permission_admin_email','text'),('drive_permission_id','text'),
      ('drive_folder_id','text'),('drive_permission_error','text'),
      ('drive_permission_retry_count','integer DEFAULT 0'),
      ('drive_permission_updated_at','timestamptz'),('normalized_email','text'),
      ('sync_correlation_id','uuid DEFAULT gen_random_uuid()'),('source_system','text DEFAULT ''lms''')
    ) AS x(name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='student_enrollments' AND column_name=v_col
    ) THEN
      EXECUTE format('ALTER TABLE public.student_enrollments ADD COLUMN %I %s', v_col, v_type);
      INSERT INTO public.lms_b05_preview_substrate_manifest(object_kind, object_name)
      VALUES ('student_enrollments_column', v_col) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END
$enrollment_columns$;

DO $enrollment_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='lms_b05_preview_student_enrollments_student_fkey'
      AND conrelid='public.student_enrollments'::regclass
  ) THEN
    ALTER TABLE public.student_enrollments
      ADD CONSTRAINT lms_b05_preview_student_enrollments_student_fkey
      FOREIGN KEY(student_id) REFERENCES public.students(id) ON DELETE CASCADE;
    INSERT INTO public.lms_b05_preview_substrate_manifest(object_kind,object_name)
    VALUES ('constraint','lms_b05_preview_student_enrollments_student_fkey') ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='lms_b05_preview_student_enrollments_course_fkey'
      AND conrelid='public.student_enrollments'::regclass
  ) THEN
    ALTER TABLE public.student_enrollments
      ADD CONSTRAINT lms_b05_preview_student_enrollments_course_fkey
      FOREIGN KEY(course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
    INSERT INTO public.lms_b05_preview_substrate_manifest(object_kind,object_name)
    VALUES ('constraint','lms_b05_preview_student_enrollments_course_fkey') ON CONFLICT DO NOTHING;
  END IF;
END
$enrollment_constraints$;

CREATE INDEX IF NOT EXISTS idx_courses_slug ON public.courses(slug);
CREATE INDEX IF NOT EXISTS idx_lessons_course_slug ON public.lessons(course_slug);
CREATE INDEX IF NOT EXISTS idx_lessons_sort ON public.lessons(course_slug,sort_order,lesson_no);
DO $existing_indexes$
BEGIN
  IF to_regclass('public.idx_student_enrollments_course_slug') IS NULL THEN
    INSERT INTO public.lms_b05_preview_substrate_manifest(object_kind,object_name)
    VALUES ('index','idx_student_enrollments_course_slug') ON CONFLICT DO NOTHING;
  END IF;
  IF to_regclass('public.idx_student_enrollments_email') IS NULL THEN
    INSERT INTO public.lms_b05_preview_substrate_manifest(object_kind,object_name)
    VALUES ('index','idx_student_enrollments_email') ON CONFLICT DO NOTHING;
  END IF;
END
$existing_indexes$;
CREATE INDEX IF NOT EXISTS idx_student_enrollments_course_slug ON public.student_enrollments(course_slug);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_email ON public.student_enrollments(email);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lookup ON public.lesson_progress(email,lesson_id);
CREATE INDEX IF NOT EXISTS idx_drive_permission_logs_student_course ON public.drive_permission_logs(student_email,course_slug);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_permission_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_b05_preview_substrate_manifest ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.courses, public.orders, public.lessons, public.site_config, public.students,
  public.student_enrollments, public.lesson_progress, public.admin_audit_logs,
  public.drive_permission_logs, public.drive_sync_queue, public.drive_admin_accounts,
  public.lms_b05_preview_substrate_manifest FROM anon, authenticated;
GRANT ALL ON public.courses, public.orders, public.lessons, public.site_config, public.students,
  public.student_enrollments, public.lesson_progress, public.admin_audit_logs,
  public.drive_permission_logs, public.drive_sync_queue, public.drive_admin_accounts,
  public.lms_b05_preview_substrate_manifest TO service_role;

COMMIT;
