-- V2 canonical identity and mapping foundation.
-- Additive-only migration for Supabase B / LMS & Checkout.
-- This keeps V1 slug-based flows intact while preparing UUID-backed lookups.

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists course_id uuid references public.courses(id) on delete set null,
  add column if not exists normalized_customer_email text,
  add column if not exists sync_correlation_id uuid default gen_random_uuid(),
  add column if not exists source_system text default 'shop';

alter table public.student_enrollments
  add column if not exists normalized_email text,
  add column if not exists sync_correlation_id uuid default gen_random_uuid(),
  add column if not exists source_system text default 'lms';

alter table public.lessons
  add column if not exists kind text check (kind in ('section', 'lesson')),
  add column if not exists parent_section_id uuid references public.lessons(id) on delete set null,
  add column if not exists position integer;

create table if not exists public.course_slug_mappings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slug text not null,
  normalized_slug text not null,
  source_system text not null default 'canonical',
  status text not null default 'active' check (status in ('active', 'deprecated', 'conflict', 'ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_slug, source_system)
);

create table if not exists public.portal_post_course_mappings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete set null,
  course_slug text,
  normalized_course_slug text,
  post_id text not null,
  portal_project_ref text,
  source_system text not null default 'portal',
  status text not null default 'active' check (status in ('active', 'missing_course', 'deprecated', 'ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, source_system)
);

insert into public.course_slug_mappings (course_id, slug, normalized_slug, source_system, status)
select c.id, c.slug, lower(trim(c.slug)), 'canonical', 'active'
from public.courses c
where c.slug is not null and trim(c.slug) <> ''
on conflict (normalized_slug, source_system) do update set
  course_id = excluded.course_id,
  slug = excluded.slug,
  status = 'active',
  last_seen_at = now(),
  updated_at = now();

update public.orders o
set
  course_id = c.id,
  normalized_customer_email = nullif(lower(trim(o.customer_email)), ''),
  updated_at = coalesce(o.updated_at, now())
from public.courses c
where o.course_id is null
  and o.course_slug is not null
  and lower(trim(o.course_slug)) = lower(trim(c.slug));

update public.orders
set normalized_customer_email = nullif(lower(trim(customer_email)), '')
where normalized_customer_email is null
  and customer_email is not null;

update public.student_enrollments e
set
  course_id = c.id,
  normalized_email = nullif(lower(trim(e.email)), ''),
  updated_at = coalesce(e.updated_at, now())
from public.courses c
where e.course_id is null
  and e.course_slug is not null
  and lower(trim(e.course_slug)) = lower(trim(c.slug));

update public.student_enrollments
set normalized_email = nullif(lower(trim(email)), '')
where normalized_email is null
  and email is not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lessons'
      and column_name = 'is_section'
  ) then
    update public.lessons l
    set
      course_id = c.id,
      kind = case when coalesce(l.is_section, false) then 'section' else 'lesson' end,
      position = coalesce(l.sort_order, l.lesson_no)
    from public.courses c
    where l.course_slug is not null
      and lower(trim(l.course_slug)) = lower(trim(c.slug))
      and (l.course_id is null or l.kind is null or l.position is null);
  else
    update public.lessons l
    set
      course_id = c.id,
      kind = 'lesson',
      position = coalesce(l.sort_order, l.lesson_no)
    from public.courses c
    where l.course_slug is not null
      and lower(trim(l.course_slug)) = lower(trim(c.slug))
      and (l.course_id is null or l.kind is null or l.position is null);
  end if;
end $$;

create index if not exists idx_orders_course_id
  on public.orders (course_id);

create index if not exists idx_orders_normalized_customer_email
  on public.orders (normalized_customer_email);

create index if not exists idx_orders_sync_correlation
  on public.orders (sync_correlation_id);

create index if not exists idx_student_enrollments_normalized_email
  on public.student_enrollments (normalized_email);

create index if not exists idx_student_enrollments_course_id_status
  on public.student_enrollments (course_id, status);

create index if not exists idx_student_enrollments_sync_correlation
  on public.student_enrollments (sync_correlation_id);

create index if not exists idx_lessons_kind_parent_position
  on public.lessons (course_id, kind, parent_section_id, position);

create index if not exists idx_course_slug_mappings_course
  on public.course_slug_mappings (course_id, status);

create index if not exists idx_portal_post_course_mappings_course
  on public.portal_post_course_mappings (course_id, status);

create index if not exists idx_portal_post_course_mappings_slug
  on public.portal_post_course_mappings (normalized_course_slug, status);
