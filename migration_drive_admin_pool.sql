-- Drive admin pool for LMS Google Drive permission grants.
-- Run on Supabase B / LMS runtime database.

CREATE TABLE IF NOT EXISTS drive_admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'quota_limited', 'error')),
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  daily_share_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_permission_mode TEXT DEFAULT 'folder';

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS drive_permission_status TEXT,
  ADD COLUMN IF NOT EXISTS drive_permission_admin_email TEXT,
  ADD COLUMN IF NOT EXISTS drive_permission_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_permission_error TEXT,
  ADD COLUMN IF NOT EXISTS drive_permission_retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_permission_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS drive_permission_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time TIMESTAMPTZ DEFAULT now(),
  course_slug TEXT NOT NULL,
  folder_id TEXT,
  email TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  request_id TEXT
);

ALTER TABLE drive_permission_logs
  ADD COLUMN IF NOT EXISTS student_email TEXT,
  ADD COLUMN IF NOT EXISTS course_id UUID,
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_admin_email TEXT,
  ADD COLUMN IF NOT EXISTS permission_id TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_drive_admin_accounts_status
  ON drive_admin_accounts(status);

CREATE INDEX IF NOT EXISTS idx_drive_permission_logs_student_course
  ON drive_permission_logs(student_email, course_slug);

CREATE INDEX IF NOT EXISTS idx_drive_permission_logs_admin_status
  ON drive_permission_logs(drive_admin_email, status);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_drive_status
  ON student_enrollments(drive_permission_status);
