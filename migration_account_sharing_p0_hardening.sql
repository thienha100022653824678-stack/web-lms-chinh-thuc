-- Account sharing warning P0 hardening.
-- Apply on Supabase B / LMS runtime database after migration_account_sharing_alerts.sql.
-- Additive and idempotent; does not auto-lock or revoke enrollments.

ALTER TABLE student_device_change_logs
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS flow_id text,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS hash_version text NOT NULL DEFAULT 'sha256_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_student_device_change_logs_event_type'
  ) THEN
    ALTER TABLE student_device_change_logs
      ADD CONSTRAINT chk_student_device_change_logs_event_type
      CHECK (
        event_type IS NULL
        OR event_type IN (
          'portal_session_created',
          'portal_session_reused',
          'login_blocked_other_device',
          'entry_token_created',
          'entry_token_used',
          'entry_token_rejected',
          'lms_session_created',
          'lms_session_rejected',
          'logout',
          'admin_reset',
          'admin_note',
          'admin_mark_reviewed',
          'admin_mark_suspected'
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_device_logs_correlation_created
  ON student_device_change_logs (correlation_id, created_at DESC)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_device_logs_reason_created
  ON student_device_change_logs (reason_code, created_at DESC)
  WHERE reason_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_device_logs_event_idempotency
  ON student_device_change_logs (event_idempotency_key)
  WHERE event_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_session_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  session_generation integer NOT NULL DEFAULT 1,
  sessions_revoked_before timestamptz,
  updated_by_admin_email text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_session_controls_email
  ON student_session_controls (lower(trim(email)));

ALTER TABLE student_session_controls ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reset_student_session_guard(
  p_email text,
  p_admin_email text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_now timestamptz := now();
  v_session_ids text[];
  v_student_count integer := 0;
  v_lms_count integer := 0;
  v_token_count integer := 0;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('reset_student_session_guard:' || v_email));

  INSERT INTO student_session_controls (
    email,
    session_generation,
    sessions_revoked_before,
    updated_by_admin_email,
    reason,
    updated_at
  )
  VALUES (
    v_email,
    1,
    v_now,
    lower(trim(coalesce(p_admin_email, ''))),
    p_reason,
    v_now
  )
  ON CONFLICT (lower(trim(email))) DO UPDATE
  SET session_generation = student_session_controls.session_generation + 1,
      sessions_revoked_before = v_now,
      updated_by_admin_email = lower(trim(coalesce(p_admin_email, ''))),
      reason = p_reason,
      updated_at = v_now;

  SELECT coalesce(array_agg(student_session_id), ARRAY[]::text[])
  INTO v_session_ids
  FROM student_active_sessions
  WHERE lower(trim(email)) = v_email
    AND status = 'active';

  UPDATE student_active_sessions
  SET status = 'admin_reset',
      logout_at = v_now,
      updated_at = v_now
  WHERE lower(trim(email)) = v_email
    AND status = 'active';
  GET DIAGNOSTICS v_student_count = ROW_COUNT;

  IF coalesce(array_length(v_session_ids, 1), 0) > 0 THEN
    UPDATE lms_entry_tokens
    SET status = 'revoked'
    WHERE student_session_id = ANY(v_session_ids)
      AND status = 'active';
    GET DIAGNOSTICS v_token_count = ROW_COUNT;

    UPDATE lms_verified_sessions
    SET status = 'admin_reset',
        logout_at = v_now,
        updated_at = v_now
    WHERE student_session_id = ANY(v_session_ids)
      AND status = 'active';
    GET DIAGNOSTICS v_lms_count = ROW_COUNT;
  END IF;

  INSERT INTO admin_audit_logs (
    admin_email,
    action,
    target_email,
    metadata,
    created_at
  )
  VALUES (
    nullif(lower(trim(coalesce(p_admin_email, ''))), ''),
    'reset_student_session_guard',
    v_email,
    jsonb_build_object(
      'reason', p_reason,
      'studentSessions', v_student_count,
      'entryTokens', v_token_count,
      'lmsSessions', v_lms_count,
      'revokedBefore', v_now
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_email,
    'studentSessions', v_student_count,
    'entryTokens', v_token_count,
    'lmsSessions', v_lms_count,
    'revokedBefore', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_student_session_guard(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_student_session_guard(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reset_student_session_guard(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_student_session_guard(text, text, text) TO service_role;
