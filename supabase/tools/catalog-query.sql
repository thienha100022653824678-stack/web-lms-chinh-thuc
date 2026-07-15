-- supabase/tools/catalog-query.sql
-- V3 Phase 1 (⑦) — emit a single-row JSON catalog snapshot of schema `public`.
-- READ-ONLY (SELECT catalog only). Same catalog surface the drift gate compares.
-- Run against EXPECTED (ephemeral PG with migrations applied) and ACTUAL
-- (production B via the read-only role). Output feeds supabase/tools/schema-diff.mjs.
--
-- Usage: psql "$DB_URL" -tA -f supabase/tools/catalog-query.sql > snapshot.json

WITH cols AS (
  SELECT
    c.relname AS table_name,
    jsonb_object_agg(a.attname, format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
      FILTER (WHERE a.attnum > 0 AND NOT a.attisdropped) AS columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname
),
tbls AS (
  SELECT jsonb_object_agg(
           c.relname,
           jsonb_build_object(
             'columns', COALESCE(cols.columns, '{}'::jsonb),
             'rls_enabled', c.relrowsecurity,
             'rls_forced', c.relforcerowsecurity
           )
         ) AS tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN cols ON cols.table_name = c.relname
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
idx AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table', t.relname,
           'name', ic.relname,
           'unique', i.indisunique,
           'partial', pg_get_expr(i.indpred, i.indrelid),
           'def', pg_get_indexdef(i.indexrelid)
         )), '[]'::jsonb) AS indexes
  FROM pg_index i
  JOIN pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
),
cons AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table', rel.relname,
           'name', con.conname,
           'type', con.contype,
           'def', pg_get_constraintdef(con.oid)
         )), '[]'::jsonb) AS constraints
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
  WHERE n.nspname = 'public'
),
pol AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table', tablename, 'name', policyname
         )), '[]'::jsonb) AS policies
  FROM pg_policies WHERE schemaname = 'public'
),
fns AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'security', CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,
           'grants', (
             SELECT COALESCE(jsonb_agg(r.rolname ORDER BY r.rolname), '[]'::jsonb)
             FROM pg_roles r
             WHERE has_function_privilege(r.rolname, p.oid, 'EXECUTE')
               AND r.rolname IN ('service_role','anon','authenticated')
           )
         )), '[]'::jsonb) AS functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)
SELECT jsonb_build_object(
         'tables', (SELECT tables FROM tbls),
         'indexes', (SELECT indexes FROM idx),
         'constraints', (SELECT constraints FROM cons),
         'policies', (SELECT policies FROM pol),
         'functions', (SELECT functions FROM fns)
       );
