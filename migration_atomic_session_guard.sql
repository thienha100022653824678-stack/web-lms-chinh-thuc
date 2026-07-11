-- Atomic student session guard for one active Portal/LMS session per Gmail.
-- Apply on Supabase B / LMS runtime database.

ALTER TABLE student_active_sessions
  ADD COLUMN IF NOT EXISTS device_hash text,
  ADD COLUMN IF NOT EXISTS device_label text,
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- Normalize any historical duplicate active rows before adding the one-active-session guard.
-- Keep the newest active session by last_seen_at/login_at and supersede older active rows.
WITH ranked_active_sessions AS (
  SELECT
    id,
    student_session_id,
    row_number() OVER (
      PARTITION BY lower(email)
      ORDER BY last_seen_at DESC NULLS LAST, login_at DESC NULLS LAST, created_at DESC NULLS LAST
    ) AS rn
  FROM student_active_sessions
  WHERE status = 'active'
),
superseded_sessions AS (
  UPDATE student_active_sessions sas
  SET status = 'superseded',
      logout_at = coalesce(sas.logout_at, now()),
      updated_at = now()
  FROM ranked_active_sessions ranked
  WHERE sas.id = ranked.id
    AND ranked.rn > 1
  RETURNING sas.student_session_id
)
UPDATE lms_verified_sessions lvs
SET status = 'superseded',
    logout_at = coalesce(lvs.logout_at, now()),
    updated_at = now()
FROM superseded_sessions superseded
WHERE lvs.student_session_id = superseded.student_session_id
  AND lvs.status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_student_session_per_email
  ON student_active_sessions (lower(email))
  WHERE status = 'active';

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

CREATE INDEX IF NOT EXISTS idx_student_device_change_logs_email_created
  ON student_device_change_logs (lower(email), created_at DESC);

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

CREATE OR REPLACE FUNCTION handle_student_session_login(
  p_email text,
  p_portal_device_id text,
  p_new_student_session_id text,
  p_device_hash text DEFAULT NULL,
  p_device_label text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_ip_hash text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_conflict_policy text DEFAULT 'block',
  p_idle_hours integer DEFAULT 24
) RETURNS jsonb AS $$
DECLARE
  v_timestamp timestamptz := now();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_policy text := lower(trim(coalesce(p_conflict_policy, 'block')));
  v_existing student_active_sessions%rowtype;
  v_student_session_id text := trim(coalesce(p_new_student_session_id, ''));
  v_idle_hours integer := greatest(coalesce(p_idle_hours, 24), 1);
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  IF trim(coalesce(p_portal_device_id, '')) = '' THEN
    RAISE EXCEPTION 'portal_device_id is required';
  END IF;

  IF v_student_session_id = '' THEN
    RAISE EXCEPTION 'student_session_id is required';
  END IF;

  -- Lock by email, including the first-session case where no row exists yet.
  PERFORM pg_advisory_xact_lock(hashtext(v_email));

  SELECT *
  INTO v_existing
  FROM student_active_sessions
  WHERE lower(email) = v_email
    AND status = 'active'
  ORDER BY last_seen_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.last_seen_at < v_timestamp - make_interval(hours => v_idle_hours) THEN
      UPDATE student_active_sessions
      SET status = 'expired',
          logout_at = v_timestamp,
          updated_at = v_timestamp
      WHERE id = v_existing.id;

      UPDATE lms_verified_sessions
      SET status = 'expired',
          logout_at = v_timestamp,
          updated_at = v_timestamp
      WHERE student_session_id = v_existing.student_session_id
        AND status = 'active';

      UPDATE lms_entry_tokens
      SET status = 'expired'
      WHERE student_session_id = v_existing.student_session_id
        AND status = 'active';
    ELSIF v_existing.portal_device_id = p_portal_device_id THEN
      UPDATE student_active_sessions
      SET last_seen_at = v_timestamp,
          updated_at = v_timestamp,
          ip = coalesce(p_ip, ip),
          user_agent = coalesce(p_user_agent, user_agent),
          device_hash = coalesce(p_device_hash, device_hash),
          device_label = coalesce(p_device_label, device_label),
          ip_hash = coalesce(p_ip_hash, ip_hash)
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'ok', true,
        'action', 'reused',
        'student_session_id', v_existing.student_session_id,
        'portal_device_id', v_existing.portal_device_id
      );
    ELSIF v_policy = 'supersede' THEN
      UPDATE student_active_sessions
      SET status = 'superseded',
          logout_at = v_timestamp,
          updated_at = v_timestamp
      WHERE id = v_existing.id;

      UPDATE lms_verified_sessions
      SET status = 'superseded',
          logout_at = v_timestamp,
          updated_at = v_timestamp
      WHERE student_session_id = v_existing.student_session_id
        AND status = 'active';

      UPDATE lms_entry_tokens
      SET status = 'revoked'
      WHERE student_session_id = v_existing.student_session_id
        AND status = 'active';

      INSERT INTO student_device_change_logs (
        email, action, old_device_hash, new_device_hash,
        old_device_label, new_device_label,
        old_student_session_id, new_student_session_id,
        user_agent, ip_hash, reason, created_at
      ) VALUES (
        v_email, 'superseded', v_existing.device_hash, p_device_hash,
        v_existing.device_label, p_device_label,
        v_existing.student_session_id, v_student_session_id,
        p_user_agent, p_ip_hash, 'new_device_superseded_active_session', v_timestamp
      );
    ELSE
      RETURN jsonb_build_object(
        'ok', false,
        'action', 'blocked',
        'reason', 'existing_active_session',
        'student_session_id', v_existing.student_session_id,
        'portal_device_id', v_existing.portal_device_id,
        'last_seen_at', v_existing.last_seen_at
      );
    END IF;
  END IF;

  INSERT INTO student_active_sessions (
    email, student_session_id, portal_device_id, status,
    login_at, last_seen_at, logout_at, ip, user_agent,
    device_hash, device_label, ip_hash, created_at, updated_at
  ) VALUES (
    v_email, v_student_session_id, p_portal_device_id, 'active',
    v_timestamp, v_timestamp, NULL, p_ip, p_user_agent,
    p_device_hash, p_device_label, p_ip_hash, v_timestamp, v_timestamp
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'created',
    'student_session_id', v_student_session_id,
    'portal_device_id', p_portal_device_id
  );
END;
$$ LANGUAGE plpgsql;
