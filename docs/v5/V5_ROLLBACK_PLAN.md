# LMS V5 Rollback Plan

## Immediate runtime rollback

Set the server-side course setting to `enabled=false`/`ui_version=v4` or activate the global V5 kill switch, then route users to unchanged `lms.html`/`lesson.html`. Query parameters cannot re-enable V5.

## Data rollback

Preview migration rollback identifies `migration_batch_id`, archives/soft-deletes V5 posts, removes V5-only read/version/audit rows as approved, and leaves `lessons`, `student_enrollments`, courses, orders, and Drive permissions untouched. The SQL rollback file drops only V5 objects and is never auto-run.

## Deployment rollback

Preview rollback redeploys the prior Preview commit or deletes only the Preview deployment. Production deployment `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` is not promoted, replaced, or aliased during this work.

