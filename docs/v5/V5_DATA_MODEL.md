# LMS V5 Data Model

The authoritative DDL is `migrations/v5/001_lms_v5_channel_feed_forward.sql`; rollback is `001_lms_v5_channel_feed_rollback.sql`.

## Entities

- `lms_v5_channels`: one channel per canonical course slug.
- `lms_v5_topics`: ordered channel topics.
- `lms_v5_posts`: immutable identity plus lifecycle, sequence, scheduling, pinning, reply, and migration provenance.
- `lms_v5_post_media`: ordered provider metadata; no embedded secret.
- `lms_v5_post_reads`: per normalized identity/post seen and completion state.
- `lms_v5_channel_read_states`: last contiguous/read sequence per identity/channel.
- `lms_v5_post_versions`: pre-change snapshots.
- `lms_v5_audit_logs`: append-only administrative evidence.
- `lms_v5_channel_settings`: server-side course rollout and kill-switch settings.
- `lms_v5_idempotency_keys`: scoped mutation replay protection.
- `lms_v5_upload_sessions`: expiring upload authorization lifecycle and orphan tracking.

## Identity

Normalized email is obtained from the server session. `student_id` is optional until the existing schema exposes a stable student UUID. Uniqueness is implemented with separate partial indexes for student ID and normalized email; clients never choose the authorized email.

## Lifecycle

Posts are never hard-deleted. `deleted` requires `deleted_at`; restore moves to `draft` or `published` according to an explicit request and audit entry. Media rows are retained on post soft-delete.

