-- migration_v3_outbox_dead_letters.sql
-- V3 Phase 3 (④) — complete the partially-applied outbox: add sync_dead_letters.
--
-- ADDITIVE ONLY. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS). Owner-applied on B.
--
-- CONTEXT (VERIFIED 2026-07-15, docs/V3_SCHEMA_GAP_SQL_RESULTS.md Q10): the V2
-- outbox migration applied only 2 of 3 tables — sync_outbox + sync_deliveries
-- exist, but sync_dead_letters was NEVER created on production. The V2 sync
-- worker (utils/v2-sync-worker.js moveOutboxToDeadLetter) already writes to it,
-- so the DLQ path is currently broken on B. This migration reconciles prod to
-- the original migration_v2_sync_outbox.sql intent — the table shape is lifted
-- verbatim so the worker's upsert(onConflict:'outbox_id') keeps working.
--
-- RLS ENABLED with no public policy (service-role only), matching every other
-- public table on B. Rollback = DROP TABLE (a new migration), never edit this file.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sync_dead_letters (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.sync_outbox(id) on delete cascade,
  status text not null default 'open' check (
    status in ('open', 'resolved', 'ignored')
  ),
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_sync_dead_letters_status
  ON public.sync_dead_letters (status, created_at desc);

ALTER TABLE public.sync_dead_letters ENABLE ROW LEVEL SECURITY;

COMMIT;
