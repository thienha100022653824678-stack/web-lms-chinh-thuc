-- Account sharing warning dashboard.
-- Apply on Supabase B / LMS runtime database after migration_atomic_session_guard.sql.
-- This migration is additive and idempotent; it does not change auth enforcement.

CREATE TABLE IF NOT EXISTS student_device_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  action text NOT NULL,
  old_device_hash text,
  new_device_hash text,
  old_device_label text,
  new_device_label text,
  old_student_session_id text,
  new_student_session_id text,
  user_agent text,
  ip_hash text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE student_device_change_logs
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS course_slug text,
  ADD COLUMN IF NOT EXISTS post_id text,
  ADD COLUMN IF NOT EXISTS lms_device_hash text,
  ADD COLUMN IF NOT EXISTS lms_session_hash text,
  ADD COLUMN IF NOT EXISTS event_source text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS risk_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS admin_email text,
  ADD COLUMN IF NOT EXISTS event_idempotency_key text;

UPDATE student_device_change_logs
SET event_type = coalesce(event_type, action, 'unknown'),
    event_source = coalesce(event_source, 'system')
WHERE event_type IS NULL
   OR event_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_student_device_logs_event_email_created
  ON student_device_change_logs (lower(trim(email)), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_device_logs_event_type_created
  ON student_device_change_logs (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_device_logs_course_created
  ON student_device_change_logs (course_slug, created_at DESC)
  WHERE course_slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_device_logs_event_idempotency
  ON student_device_change_logs (event_idempotency_key)
  WHERE event_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_account_risk_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new',
      'monitoring',
      'reviewed',
      'suspected_sharing',
      'false_positive',
      'resolved'
    )),
  risk_level text,
  risk_score integer NOT NULL DEFAULT 0,
  note text,
  assigned_admin_email text,
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_account_risk_reviews_email
  ON student_account_risk_reviews (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_student_account_risk_reviews_status_updated
  ON student_account_risk_reviews (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS student_account_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  admin_email text,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_account_admin_notes_email_created
  ON student_account_admin_notes (lower(trim(email)), created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text,
  action text NOT NULL,
  target_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created
  ON admin_audit_logs (lower(target_email), created_at DESC);
