-- =============================================================================
-- V3 — Production Schema Gap Verification (READ-ONLY)
-- Target: Supabase B SQL Editor (LMS runtime project)
-- Date prepared: 2026-07-15
--
-- RULES FOR OWNER:
--   * Paste this entire file into Supabase SQL Editor and run block-by-block,
--     OR run the whole file if the editor allows multi-statement SELECT.
--   * ONLY SELECT. No CREATE / ALTER / DROP / GRANT / REVOKE / UPDATE / INSERT /
--     DELETE / TRUNCATE / VACUUM / COPY.
--   * Do NOT paste secrets, service-role keys, or full connection URLs into the
--     result file. Project ref alone (already public in docs) is fine.
--   * After each block, copy the result grid into:
--       docs/V3_SCHEMA_GAP_SQL_RESULTS.md
--     under the matching section heading.
--
-- Why this file exists:
--   PostgREST cannot read pg_catalog / information_schema privileges, so 4 gaps
--   remain after the 2026-07-15 REST snapshot (see V3_PRODUCTION_SCHEMA_SNAPSHOT.md).
--   This file queries catalogs so we do not guess constraint / index / policy names.
-- =============================================================================


-- =============================================================================
-- BLOCK 1 — RLS enabled/forced + policies on public tables
-- Answers: which tables have rowsecurity / forcerowsecurity, and which policies
-- exist (name, roles, cmd, qual, with_check).
-- Input for V3 proposal ① (RLS) and for Proposal ⑦ baseline fidelity.
-- =============================================================================

-- 1a. RLS flags on every public base table
SELECT
  c.relname                              AS table_name,
  c.relrowsecurity                       AS rls_enabled,
  c.relforcerowsecurity                  AS rls_forced,
  c.relkind                              AS relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')            -- ordinary + partitioned tables
ORDER BY c.relname;

-- 1b. All policies on public schema (catalog-driven; no assumed policy names)
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 1c. Quick count: tables with RLS on but zero policies (common footgun)
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  COALESCE(p.policy_count, 0) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
  SELECT tablename, COUNT(*) AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity = true
ORDER BY c.relname;


-- =============================================================================
-- BLOCK 2 — Unique + partial indexes (catalog-driven)
-- Answers: which unique / partial indexes exist; specifically look for
--   * one-active-session-per-email (invariant #5)
--   * event_idempotency_key uniqueness (account-sharing telemetry)
--   * any unique on student_enrollments / posts / courses
-- Do NOT assume index names — scan pg_indexes + pg_index.
-- =============================================================================

-- 2a. All indexes on public schema (definition text; easy to paste)
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 2b. Unique / partial / expression index flags from pg_index
SELECT
  n.nspname                              AS schema_name,
  t.relname                              AS table_name,
  i.relname                              AS index_name,
  ix.indisunique                         AS is_unique,
  ix.indisprimary                        AS is_primary,
  ix.indisexclusion                      AS is_exclusion,
  pg_get_expr(ix.indpred, ix.indrelid)   AS partial_predicate,
  pg_get_indexdef(ix.indexrelid)         AS index_def
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
ORDER BY t.relname, i.relname;

-- 2c. Highlight candidates for one-active-session + enrollment uniqueness
--     (filter by table name + unique/partial; still catalog-driven)
SELECT
  t.relname                              AS table_name,
  i.relname                              AS index_name,
  ix.indisunique                         AS is_unique,
  pg_get_expr(ix.indpred, ix.indrelid)   AS partial_predicate,
  pg_get_indexdef(ix.indexrelid)         AS index_def
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
    'student_active_sessions',
    'student_enrollments',
    'student_device_change_logs',
    'lms_entry_tokens',
    'lms_verified_sessions',
    'posts',
    'courses',
    'orders',
    'students',
    'lessons'
  )
ORDER BY t.relname, i.relname;


-- =============================================================================
-- BLOCK 3 — Constraints, especially UNIQUE(email, course_slug) or equivalent
-- Answers: which UNIQUE / PRIMARY / FOREIGN / CHECK constraints exist on
-- student_enrollments and related tables. Catalog-driven via pg_constraint —
-- do NOT assume constraint names.
-- =============================================================================

-- 3a. All constraints in public schema
SELECT
  n.nspname                              AS schema_name,
  c.conrelid::regclass                   AS table_name,
  c.conname                              AS constraint_name,
  c.contype                              AS constraint_type,  -- p/u/f/c/x
  pg_get_constraintdef(c.oid)            AS constraint_def
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
ORDER BY c.conrelid::regclass::text, c.contype, c.conname;

-- 3b. Focus: student_enrollments + posts uniqueness (invariant #1 + portal upsert)
SELECT
  c.conrelid::regclass                   AS table_name,
  c.conname                              AS constraint_name,
  c.contype                              AS constraint_type,
  pg_get_constraintdef(c.oid)            AS constraint_def
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
  AND c.conrelid::regclass::text IN (
    'student_enrollments',
    'posts',
    'students',
    'courses',
    'orders',
    'lessons',
    'portal_post_course_mappings',
    'course_slug_mappings'
  )
ORDER BY c.conrelid::regclass::text, c.contype, c.conname;

-- 3c. Specifically: does any UNIQUE constraint cover (email, course_slug)
--     OR a unique INDEX equivalent (covers Portal onConflict: 'email,course_slug')?
--     This query surfaces any unique constraint/index whose definition text
--     mentions both email and course_slug (case-insensitive).
SELECT
  'constraint' AS kind,
  c.conrelid::regclass::text             AS table_name,
  c.conname                              AS name,
  pg_get_constraintdef(c.oid)            AS def
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
  AND c.contype = 'u'
  AND pg_get_constraintdef(c.oid) ILIKE '%email%'
  AND pg_get_constraintdef(c.oid) ILIKE '%course_slug%'

UNION ALL

SELECT
  'unique_index' AS kind,
  t.relname                              AS table_name,
  i.relname                              AS name,
  pg_get_indexdef(ix.indexrelid)         AS def
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND ix.indisunique = true
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%email%'
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%course_slug%'

ORDER BY table_name, kind, name;


-- =============================================================================
-- BLOCK 4 — handle_student_session_login owner, security mode, grants
-- Answers: function exists? SECURITY DEFINER/INVOKER? owner? search_path?
--          who has EXECUTE? (critical: Portal calls via service_role)
-- Also covers sibling RPCs for comparison (reset_student_session_guard,
-- cleanup_student_account_risk_events) — still SELECT only.
-- =============================================================================

-- 4a. Function identity + owner + security mode + config (search_path etc.)
SELECT
  n.nspname                              AS schema_name,
  p.proname                              AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  pg_get_function_result(p.oid)          AS result_type,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
                                         AS security_mode,
  pg_get_userbyid(p.proowner)            AS owner,
  p.proconfig                            AS config_settings,  -- e.g. search_path
  p.provolatile                          AS volatility,       -- i/s/v
  p.proleakproof                         AS leakproof,
  p.prosecdef                            AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'handle_student_session_login',
    'reset_student_session_guard',
    'cleanup_student_account_risk_events',
    'record_view'                        -- Portal A RPC (may be absent on B)
  )
ORDER BY p.proname, identity_args;

-- 4b. EXECUTE privileges (information_schema)
SELECT
  routine_schema,
  routine_name,
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'handle_student_session_login',
    'reset_student_session_guard',
    'cleanup_student_account_risk_events',
    'record_view'
  )
ORDER BY routine_name, grantee, privilege_type;

-- 4c. EXECUTE privileges via pg_catalog (catches PUBLIC / role-level more reliably)
SELECT
  n.nspname                              AS schema_name,
  p.proname                              AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  r.rolname                              AS grantee_role,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS has_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'handle_student_session_login',
    'reset_student_session_guard',
    'cleanup_student_account_risk_events'
  )
  AND r.rolname IN (
    'PUBLIC',
    'anon',
    'authenticated',
    'service_role',
    'postgres',
    'supabase_admin',
    'authenticator'
  )
  AND has_function_privilege(r.oid, p.oid, 'EXECUTE') = true
ORDER BY p.proname, identity_args, r.rolname;

-- 4d. Default privileges / PUBLIC EXECUTE leak check specifically for
--     handle_student_session_login (the V2 grant-hardening target)
SELECT
  p.proname                              AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  has_function_privilege('public', p.oid, 'EXECUTE')         AS public_has_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_has_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS authenticated_has_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')   AS service_role_has_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'handle_student_session_login'
ORDER BY identity_args;


-- =============================================================================
-- END OF FILE
-- After running, paste each block's result grid into:
--   docs/V3_SCHEMA_GAP_SQL_RESULTS.md
-- Then re-open the V3 research session so Fable 5 can mark gaps VERIFIED.
-- =============================================================================
