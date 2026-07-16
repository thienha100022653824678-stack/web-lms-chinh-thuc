-- migration_v3_formalize_drift_columns.sql
-- V3 Phase 10 (⑧) — formalize the VERIFIED undocumented drift columns.
--
-- ADDITIVE ONLY. Idempotent (ADD COLUMN IF NOT EXISTS). Owner-applied on B.
--
-- CONTEXT (VERIFIED 2026-07-15, docs/V3_SCHEMA_GAP_SQL_RESULTS.md Q11): several
-- columns exist in production but were never declared in supabase_schema.sql or
-- any committed migration — they drifted in via SQL Editor / V2 drafts. V1 code
-- reads them with hidden fallbacks. This migration DECLARES them additively so:
--   - the schema is an honest source of truth (no more "is this column real?"),
--   - the drift gate stops allowlisting them (they move from drift -> declared),
--   - Phase 8 shared-schema DTOs can reference them by name.
--
-- No data is moved, no type changed, no column dropped. Columns that already
-- exist are left exactly as they are (ADD COLUMN IF NOT EXISTS is a no-op there).
-- Rollback is not needed (additive); if ever required, a new migration.

BEGIN;

-- lessons: section/material support (V2 identity columns + drift).
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS is_section boolean DEFAULT false;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS materials jsonb DEFAULT '{}'::jsonb;

-- courses: publish scheduling + drive folder + sync projection (drift; V1 doc
-- only documented sync_* on orders, but courses has them too).
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS is_published boolean DEFAULT false;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS expected_start_date date;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS drive_folder_id text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS drive_permission_mode text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sync_lms_status text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sync_portal_status text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sync_error text;

-- orders / student_enrollments: V2 identity columns (VERIFIED present on prod,
-- declared here for the record; ADD COLUMN IF NOT EXISTS is a no-op).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS course_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS normalized_customer_email text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sync_correlation_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_system text;

ALTER TABLE public.student_enrollments ADD COLUMN IF NOT EXISTS course_id uuid;
ALTER TABLE public.student_enrollments ADD COLUMN IF NOT EXISTS normalized_email text;
ALTER TABLE public.student_enrollments ADD COLUMN IF NOT EXISTS sync_correlation_id uuid;
ALTER TABLE public.student_enrollments ADD COLUMN IF NOT EXISTS source_system text;

-- lessons: V2 identity ordering/parenting (VERIFIED present).
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS parent_section_id uuid;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS position integer;

COMMIT;
