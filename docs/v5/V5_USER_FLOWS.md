# LMS V5 User Flows

## Student

1. Existing LMS session identifies the student server-side.
2. `GET /api/v5/channels` returns only active enrollments and server-enabled V5 channels.
3. A non-enabled course routes to B05. A server kill switch or V5 bootstrap failure links back to B05.
4. Opening a channel loads the newest 24 posts. Older/newer pages use `before_sequence`/`after_sequence`.
5. A persistent first-unread divider is derived from `last_read_sequence`; brief viewport intersection records `seen` only after the configured dwell time.
6. Manual completion and eligible media completion are idempotent and separate from `seen`.
7. Search and topic filters preserve channel identity. Deep links use the post UUID.
8. Realtime events show “Có bài mới”; they never force-scroll a reader away from older content.

## Admin

1. Existing admin cookie/session is checked against the existing allowlist.
2. Admin selects a channel, writes text, chooses type/topic, attaches files, previews, saves a draft, schedules, or publishes.
3. Large files use `uploads/init` → direct provider upload → `uploads/complete`; the API verifies provider metadata before linking media.
4. Every mutation requires an idempotency key, validates transitions, writes a version when content changes, and writes an audit log.
5. Delete is soft-delete. Restore creates an auditable transition. Assets are not hard-deleted with a post.

## Migration operator

Run local dry-run, export JSON/report, compare counts/checksums/media/captions, rerun to prove idempotency, and optionally generate rollback SQL for the batch. Production execution is explicitly out of scope.

