-- migration_v3_runtime_config.sql
-- V3 Phase 0 — Runtime controller spine.
-- ADDITIVE ONLY. Creates a singleton runtime-config row + append-only audit.
-- No business data. Service-role writes it; browser (anon/authenticated) cannot.
-- Owner applies this on Supabase B (SQL Editor, service-role). Safe to re-run.
-- Rollback: DROP TABLE public.platform_runtime_config_audit, public.platform_runtime_config;
--           (only when V3 is fully rolled back — no business data is lost).

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_runtime_config (
  id             smallint    PRIMARY KEY DEFAULT 1,
  active_mode    text        NOT NULL DEFAULT 'v1'
                             CHECK (active_mode IN ('v1', 'v2', 'v3')),
  v2_shadow_mode boolean     NOT NULL DEFAULT false,
  v3_shadow_mode boolean     NOT NULL DEFAULT false,
  kill_switch    boolean     NOT NULL DEFAULT false,  -- true => force v1 regardless of active_mode
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_runtime_config_singleton CHECK (id = 1)
);

ALTER TABLE public.platform_runtime_config ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy is created on purpose: only service-role
-- (which bypasses RLS) and SQL Editor can read/write. Browser clients cannot.

-- Seed the singleton row defaulting to v1 (the immutable rollback target).
INSERT INTO public.platform_runtime_config (id, active_mode)
VALUES (1, 'v1')
ON CONFLICT (id) DO NOTHING;

-- Append-only audit of every flip, so version changes are traceable.
CREATE TABLE IF NOT EXISTS public.platform_runtime_config_audit (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  active_mode    text        NOT NULL,
  v2_shadow_mode boolean,
  v3_shadow_mode boolean,
  kill_switch    boolean,
  changed_by     text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_runtime_config_audit ENABLE ROW LEVEL SECURITY;

COMMIT;
