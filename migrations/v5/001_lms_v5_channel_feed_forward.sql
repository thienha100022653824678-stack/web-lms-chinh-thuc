-- LMS V5 channel feed. Forward-only until explicitly approved.
-- DO NOT apply to Production as part of the Preview phase.
begin;

create extension if not exists pgcrypto;

create or replace function public.lms_v5_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table public.lms_v5_channels (
  id uuid primary key default gen_random_uuid(),
  course_slug text unique not null check (course_slug = lower(btrim(course_slug)) and length(course_slug) between 1 and 160),
  display_title text not null default '',
  description text not null default '',
  avatar_url text,
  cover_url text,
  status text not null default 'active' check (status in ('active','hidden','archived')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lms_v5_topics (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.lms_v5_channels(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 240),
  description text not null default '',
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','hidden','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, sort_order)
);

create table public.lms_v5_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.lms_v5_channels(id) on delete restrict,
  topic_id uuid references public.lms_v5_topics(id) on delete set null,
  post_type text not null check (post_type in ('text','image','image_album','video','audio','document','lesson','announcement','topic_header')),
  body_text text not null default '',
  body_json jsonb not null default '{}'::jsonb check (jsonb_typeof(body_json) = 'object'),
  sequence_no bigint not null check (sequence_no > 0),
  status text not null default 'draft' check (status in ('draft','scheduled','published','hidden','archived','deleted')),
  published_at timestamptz,
  scheduled_at timestamptz,
  edited_at timestamptz,
  pinned_at timestamptz,
  author_admin_email text,
  reply_to_post_id uuid references public.lms_v5_posts(id) on delete set null,
  source_lesson_id uuid,
  migration_batch_id uuid,
  source_checksum text check (source_checksum is null or source_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint lms_v5_posts_publish_shape check (
    (status = 'published' and published_at is not null)
    or status <> 'published'
  ),
  constraint lms_v5_posts_schedule_shape check (
    (status = 'scheduled' and scheduled_at is not null)
    or status <> 'scheduled'
  ),
  constraint lms_v5_posts_delete_shape check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  ),
  unique (channel_id, sequence_no),
  unique (channel_id, source_lesson_id)
);

create table public.lms_v5_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.lms_v5_posts(id) on delete restrict,
  position integer not null check (position >= 0),
  media_type text not null check (media_type in ('image','video','audio','document','thumbnail')),
  provider text not null check (provider in ('cloudinary','google_drive','bunny','external','fixture')),
  provider_asset_id text,
  url text not null,
  thumbnail_url text,
  mime_type text,
  file_name text,
  file_size bigint check (file_size is null or file_size >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  caption text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (post_id, position),
  unique (provider, provider_asset_id)
);

create table public.lms_v5_post_reads (
  id uuid primary key default gen_random_uuid(),
  email text,
  student_id uuid,
  post_id uuid not null references public.lms_v5_posts(id) on delete restrict,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  completed_at timestamptz,
  progress_percent numeric not null default 0 check (progress_percent between 0 and 100),
  completion_source text check (completion_source is null or completion_source in ('auto_seen','manual_complete','media_complete','migration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (student_id is not null or (email is not null and email = lower(btrim(email))))
);

create unique index lms_v5_post_reads_student_uq
  on public.lms_v5_post_reads(student_id, post_id) where student_id is not null;
create unique index lms_v5_post_reads_email_uq
  on public.lms_v5_post_reads(email, post_id) where student_id is null and email is not null;

create table public.lms_v5_channel_read_states (
  id uuid primary key default gen_random_uuid(),
  email text,
  student_id uuid,
  channel_id uuid not null references public.lms_v5_channels(id) on delete restrict,
  last_read_sequence bigint not null default 0 check (last_read_sequence >= 0),
  last_read_post_id uuid references public.lms_v5_posts(id) on delete set null,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  check (student_id is not null or (email is not null and email = lower(btrim(email))))
);

create unique index lms_v5_channel_reads_student_uq
  on public.lms_v5_channel_read_states(student_id, channel_id) where student_id is not null;
create unique index lms_v5_channel_reads_email_uq
  on public.lms_v5_channel_read_states(email, channel_id) where student_id is null and email is not null;

create table public.lms_v5_post_versions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.lms_v5_posts(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  body_snapshot jsonb not null,
  media_snapshot jsonb not null,
  changed_by text not null,
  changed_at timestamptz not null default now(),
  unique (post_id, version_no)
);

create table public.lms_v5_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_type text not null,
  target_id uuid,
  admin_email text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.lms_v5_channel_settings (
  course_slug text primary key check (course_slug = lower(btrim(course_slug)) and length(course_slug) between 1 and 160),
  channel_id uuid references public.lms_v5_channels(id) on delete restrict,
  ui_version text not null default 'v4' check (ui_version in ('v4','v5')),
  enabled boolean not null default false,
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or (ui_version = 'v5' and channel_id is not null))
);

create table public.lms_v5_idempotency_keys (
  scope text not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  actor_hash text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (scope, idempotency_key)
);

create table public.lms_v5_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  provider text not null check (provider in ('cloudinary','google_drive','bunny','fixture')),
  provider_asset_id text,
  declared_metadata jsonb not null default '{}'::jsonb,
  verified_metadata jsonb,
  status text not null default 'initialized' check (status in ('initialized','uploading','completed','cancelled','expired','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);

create index lms_v5_topics_channel_status_order_idx on public.lms_v5_topics(channel_id, status, sort_order);
create index lms_v5_posts_feed_idx on public.lms_v5_posts(channel_id, sequence_no desc) where status = 'published';
create index lms_v5_posts_topic_feed_idx on public.lms_v5_posts(channel_id, topic_id, sequence_no desc) where status = 'published';
create index lms_v5_posts_pinned_idx on public.lms_v5_posts(channel_id, pinned_at desc) where status = 'published' and pinned_at is not null;
create index lms_v5_posts_schedule_idx on public.lms_v5_posts(scheduled_at) where status = 'scheduled';
create index lms_v5_posts_migration_idx on public.lms_v5_posts(migration_batch_id, source_lesson_id);
create index lms_v5_media_post_idx on public.lms_v5_post_media(post_id, position);
create index lms_v5_reads_post_idx on public.lms_v5_post_reads(post_id, completed_at);
create index lms_v5_audit_target_idx on public.lms_v5_audit_logs(target_type, target_id, created_at desc);
create index lms_v5_upload_expiry_idx on public.lms_v5_upload_sessions(status, expires_at);
create index lms_v5_idempotency_expiry_idx on public.lms_v5_idempotency_keys(expires_at);

create trigger lms_v5_channels_updated before update on public.lms_v5_channels
for each row execute function public.lms_v5_set_updated_at();
create trigger lms_v5_topics_updated before update on public.lms_v5_topics
for each row execute function public.lms_v5_set_updated_at();
create trigger lms_v5_posts_updated before update on public.lms_v5_posts
for each row execute function public.lms_v5_set_updated_at();
create trigger lms_v5_post_reads_updated before update on public.lms_v5_post_reads
for each row execute function public.lms_v5_set_updated_at();
create trigger lms_v5_channel_reads_updated before update on public.lms_v5_channel_read_states
for each row execute function public.lms_v5_set_updated_at();
create trigger lms_v5_settings_updated before update on public.lms_v5_channel_settings
for each row execute function public.lms_v5_set_updated_at();
create trigger lms_v5_uploads_updated before update on public.lms_v5_upload_sessions
for each row execute function public.lms_v5_set_updated_at();

alter table public.lms_v5_channels enable row level security;
alter table public.lms_v5_topics enable row level security;
alter table public.lms_v5_posts enable row level security;
alter table public.lms_v5_post_media enable row level security;
alter table public.lms_v5_post_reads enable row level security;
alter table public.lms_v5_channel_read_states enable row level security;
alter table public.lms_v5_post_versions enable row level security;
alter table public.lms_v5_audit_logs enable row level security;
alter table public.lms_v5_channel_settings enable row level security;
alter table public.lms_v5_idempotency_keys enable row level security;
alter table public.lms_v5_upload_sessions enable row level security;

revoke all on public.lms_v5_channels, public.lms_v5_topics, public.lms_v5_posts,
  public.lms_v5_post_media, public.lms_v5_post_reads, public.lms_v5_channel_read_states,
  public.lms_v5_post_versions, public.lms_v5_audit_logs, public.lms_v5_channel_settings,
  public.lms_v5_idempotency_keys, public.lms_v5_upload_sessions from anon, authenticated;
grant all on public.lms_v5_channels, public.lms_v5_topics, public.lms_v5_posts,
  public.lms_v5_post_media, public.lms_v5_post_reads, public.lms_v5_channel_read_states,
  public.lms_v5_post_versions, public.lms_v5_audit_logs, public.lms_v5_channel_settings,
  public.lms_v5_idempotency_keys, public.lms_v5_upload_sessions to service_role;

commit;
