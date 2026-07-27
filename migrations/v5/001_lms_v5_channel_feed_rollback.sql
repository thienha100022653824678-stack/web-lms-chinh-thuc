-- LMS V5 rollback. DO NOT apply to Production without owner approval and backup.
begin;
drop table if exists public.lms_v5_upload_sessions;
drop table if exists public.lms_v5_idempotency_keys;
drop table if exists public.lms_v5_channel_settings;
drop table if exists public.lms_v5_audit_logs;
drop table if exists public.lms_v5_post_versions;
drop table if exists public.lms_v5_channel_read_states;
drop table if exists public.lms_v5_post_reads;
drop table if exists public.lms_v5_post_media;
drop table if exists public.lms_v5_posts;
drop table if exists public.lms_v5_topics;
drop table if exists public.lms_v5_channels;
drop function if exists public.lms_v5_set_updated_at();
commit;
