-- Student session guard for Portal -> LMS anti-share flow.
-- Run on Supabase B / LMS runtime database after review.

CREATE TABLE IF NOT EXISTS student_active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  student_session_id TEXT NOT NULL UNIQUE,
  portal_device_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'logged_out', 'expired', 'admin_reset', 'superseded')),
  login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lms_entry_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  student_session_id TEXT NOT NULL,
  portal_device_id TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  post_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_ip TEXT,
  created_user_agent TEXT
);

CREATE TABLE IF NOT EXISTS lms_verified_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lms_session_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  student_session_id TEXT NOT NULL,
  lms_device_id TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  entry_token_id UUID REFERENCES lms_entry_tokens(id),
  status TEXT NOT NULL
    CHECK (status IN ('active', 'logged_out', 'expired', 'admin_reset', 'superseded')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_active_sessions_email_status
  ON student_active_sessions(email, status);

CREATE INDEX IF NOT EXISTS idx_student_active_sessions_student_session_id
  ON student_active_sessions(student_session_id);

CREATE INDEX IF NOT EXISTS idx_lms_entry_tokens_token_hash
  ON lms_entry_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_lms_entry_tokens_email_course_status
  ON lms_entry_tokens(email, course_slug, status);

CREATE INDEX IF NOT EXISTS idx_lms_entry_tokens_student_session_status
  ON lms_entry_tokens(student_session_id, status);

CREATE INDEX IF NOT EXISTS idx_lms_verified_sessions_lms_session_id
  ON lms_verified_sessions(lms_session_id);

CREATE INDEX IF NOT EXISTS idx_lms_verified_sessions_email_course_status
  ON lms_verified_sessions(email, course_slug, status);

CREATE INDEX IF NOT EXISTS idx_lms_verified_sessions_student_session_status
  ON lms_verified_sessions(student_session_id, status);
