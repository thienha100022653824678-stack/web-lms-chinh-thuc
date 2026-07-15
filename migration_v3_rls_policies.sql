-- migration_v3_rls_policies.sql
-- V3 Phase 2 (①) — RLS policies + RPC security-mode hardening.
--
-- ADDITIVE ONLY. No DROP / RENAME / ALTER TYPE. Idempotent (guarded DO blocks +
-- CREATE POLICY IF NOT EXISTS semantics via pg_policies checks).
--
-- CONTEXT (VERIFIED 2026-07-15, docs/V3_SCHEMA_GAP_SQL_RESULTS.md): every public
-- table has RLS ENABLED but ZERO policies, and service_role bypasses RLS. So
-- today the system is only safe because every read/write goes through the
-- service-role key (SEC-09). These policies give anon/authenticated a real,
-- least-privilege surface WITHOUT removing service-role's implicit bypass — so
-- V1/V2 (all service-role) keep working byte-for-byte. V3 flips the browser to
-- anon/authenticated keys (utils/v3-db.js) and relies on these policies.
--
-- OWNER-APPLIED, after a canary. Do NOT apply blind on production: verify on a
-- staging clone that anon can still read the public course surface and an
-- authenticated student can read only their own rows. Rollback = a new
-- migration dropping these policies (additive-reverse), never editing this file.

BEGIN;

-- ── anon: public read surface (courses + active/free lessons) ────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='courses' AND policyname='v3_anon_read_active_courses') THEN
    CREATE POLICY v3_anon_read_active_courses ON public.courses
      FOR SELECT TO anon
      USING (active IS TRUE);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='courses' AND policyname='v3_auth_read_active_courses') THEN
    CREATE POLICY v3_auth_read_active_courses ON public.courses
      FOR SELECT TO authenticated
      USING (active IS TRUE);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lessons' AND policyname='v3_anon_read_free_lessons') THEN
    CREATE POLICY v3_anon_read_free_lessons ON public.lessons
      FOR SELECT TO anon
      USING (active IS TRUE AND is_free IS TRUE);
  END IF;
END $$;

-- ── authenticated: student scoped to their own rows (auth.email() = email) ───
-- auth.email() returns the JWT email claim; matched case-insensitively against
-- the stored email. Service-role bypasses RLS so admin/worker paths are
-- unaffected.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lessons' AND policyname='v3_auth_read_enrolled_lessons') THEN
    CREATE POLICY v3_auth_read_enrolled_lessons ON public.lessons
      FOR SELECT TO authenticated
      USING (
        active IS TRUE
        AND EXISTS (
          SELECT 1 FROM public.student_enrollments se
          WHERE se.course_slug = lessons.course_slug
            AND lower(se.email) = lower(auth.email())
            AND se.status = 'active'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_enrollments' AND policyname='v3_auth_read_own_enrollments') THEN
    CREATE POLICY v3_auth_read_own_enrollments ON public.student_enrollments
      FOR SELECT TO authenticated
      USING (lower(email) = lower(auth.email()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lesson_progress' AND policyname='v3_auth_read_own_progress') THEN
    CREATE POLICY v3_auth_read_own_progress ON public.lesson_progress
      FOR SELECT TO authenticated
      USING (lower(email) = lower(auth.email()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lesson_progress' AND policyname='v3_auth_update_own_progress') THEN
    CREATE POLICY v3_auth_update_own_progress ON public.lesson_progress
      FOR UPDATE TO authenticated
      USING (lower(email) = lower(auth.email()))
      WITH CHECK (lower(email) = lower(auth.email()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_active_sessions' AND policyname='v3_auth_read_own_sessions') THEN
    CREATE POLICY v3_auth_read_own_sessions ON public.student_active_sessions
      FOR SELECT TO authenticated
      USING (lower(email) = lower(auth.email()));
  END IF;
END $$;

-- ── RPC hardening: normalize the login RPC to SECURITY DEFINER + pinned path ──
-- VERIFIED gap: handle_student_session_login is SECURITY INVOKER with proconfig
-- null, unlike reset_student_session_guard / cleanup_* (both DEFINER + pinned
-- search_path). Standardize WITHOUT touching the body/signature so anon/
-- authenticated can safely reach it via RPC in v3. ALTER FUNCTION is additive.
ALTER FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) SECURITY DEFINER;

ALTER FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) SET search_path = public;

COMMIT;
