-- Account sharing warning P1 upgrades.
-- Apply on Supabase B / LMS runtime database after P0 migrations.
-- Additive and idempotent; does not change login/session enforcement.

CREATE TABLE IF NOT EXISTS student_account_risk_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  risk_score integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'normal'
    CHECK (risk_level IN ('normal', 'watch', 'suspicious', 'high')),
  devices_24h integer NOT NULL DEFAULT 0,
  devices_7d integer NOT NULL DEFAULT 0,
  devices_30d integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  device_change_count integer NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  last_device_change_at timestamptz,
  recent_devices jsonb NOT NULL DEFAULT '[]'::jsonb,
  course_slugs jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new', 'monitoring', 'reviewed', 'suspected_sharing', 'false_positive', 'resolved')),
  review_note text,
  assigned_admin_email text,
  monitoring_until timestamptz,
  resolved_at timestamptz,
  false_positive_at timestamptz,
  risk_rule_version text,
  summary_window_days integer NOT NULL DEFAULT 30,
  computed_at timestamptz NOT NULL DEFAULT now(),
  stale_after timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_account_risk_summaries_email
  ON student_account_risk_summaries (email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_account_risk_summaries_normalized_email
  ON student_account_risk_summaries (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_student_account_risk_summaries_risk
  ON student_account_risk_summaries (risk_level, risk_score DESC, last_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_account_risk_summaries_review
  ON student_account_risk_summaries (review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_account_risk_summaries_stale
  ON student_account_risk_summaries (stale_after);

ALTER TABLE student_account_risk_reviews
  ADD COLUMN IF NOT EXISTS monitoring_until timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS false_positive_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_student_account_risk_reviews_monitoring
  ON student_account_risk_reviews (monitoring_until)
  WHERE monitoring_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_device_logs_email_course_created
  ON student_device_change_logs (lower(trim(email)), course_slug, created_at DESC)
  WHERE course_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_device_logs_retention_created
  ON student_device_change_logs (created_at);

CREATE OR REPLACE FUNCTION public.cleanup_student_account_risk_events(
  p_retention_days integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention_days integer := greatest(coalesce(p_retention_days, 180), 30);
  v_cutoff timestamptz := now() - (v_retention_days || ' days')::interval;
  v_device_events integer := 0;
  v_notes integer := 0;
  v_audits integer := 0;
BEGIN
  DELETE FROM student_device_change_logs
  WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_device_events = ROW_COUNT;

  DELETE FROM student_account_admin_notes
  WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM admin_audit_logs
  WHERE created_at < v_cutoff
    AND action LIKE 'account_sharing_%';
  GET DIAGNOSTICS v_audits = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'retentionDays', v_retention_days,
    'cutoff', v_cutoff,
    'deviceEventsDeleted', v_device_events,
    'notesDeleted', v_notes,
    'auditLogsDeleted', v_audits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_student_account_risk_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_student_account_risk_events(integer) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_student_account_risk_events(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_student_account_risk_events(integer) TO service_role;
