-- V2 sync outbox foundation.
-- Additive-only migration. It does not change existing V1 sync behavior.

create table if not exists public.sync_outbox (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  aggregate_type text not null,
  aggregate_id text,
  event_type text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled')
  ),
  priority integer not null default 100,
  attempt_count integer not null default 0,
  max_attempts integer not null default 10,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.sync_outbox(id) on delete cascade,
  target_system text not null,
  status text not null default 'pending' check (
    status in ('pending', 'success', 'failed', 'skipped')
  ),
  attempt_count integer not null default 0,
  http_status integer,
  response_summary text,
  error_message text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outbox_id, target_system)
);

create table if not exists public.sync_dead_letters (
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

create index if not exists idx_sync_outbox_status_available
  on public.sync_outbox (status, available_at, priority, created_at);

create index if not exists idx_sync_outbox_aggregate
  on public.sync_outbox (aggregate_type, aggregate_id, created_at desc);

create index if not exists idx_sync_outbox_event_type
  on public.sync_outbox (event_type, created_at desc);

create index if not exists idx_sync_deliveries_target_status
  on public.sync_deliveries (target_system, status, updated_at desc);

create index if not exists idx_sync_deliveries_outbox
  on public.sync_deliveries (outbox_id);

create index if not exists idx_sync_dead_letters_status
  on public.sync_dead_letters (status, created_at desc);
