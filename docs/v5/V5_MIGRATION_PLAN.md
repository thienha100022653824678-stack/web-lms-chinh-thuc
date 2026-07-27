# LMS V5 Migration Plan

## Mapping

Course → channel; section/is_section → topic or topic header; lesson → lesson post; title/content → structured body; main media → position 0; supplemental media → subsequent positions; materials → document media; `lesson_no` → deterministic sequence.

Every migrated post stores `source_lesson_id`, `migration_batch_id`, and a canonical SHA-256 `source_checksum`.

## Procedure

1. Export sanitized/local lesson JSON read-only.
2. Run `scripts/v5/migrate-lessons.mjs --dry-run --input … --output … --report …`.
3. Review count, duplicate, missing-media, caption, mapping, and checksum reports.
4. Rerun with the same batch to prove byte-stable/idempotent output.
5. Import only into an approved Preview database or fixture mode.
6. Roll back by batch with generated soft-archive/delete statements; never remove legacy lessons.

There is no Production migration in this project phase and no indefinite dual-write. During rollout, V4 remains source/fallback until an approved cutover freezes/admin-routes one course at a time.

