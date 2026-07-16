# Task Index — web-lms-chinh-thuc

_Every task the controller has created. One row per task. Keep statuses current._

| Task ID | Title | Status | Owner | Branch / Worktree | Created | Updated |
|---------|-------|--------|-------|-------------------|---------|---------|
| TASK-DRY-RUN-001 | DRY-RUN sample task (bootstrap verification) | DRY_RUN (not a real task) | controller | `feat/v2-runtime-switch` (primary) | 2026-07-16 | 2026-07-16 |
| TASK-001 | V3 Current-State Audit and Completion Plan | TODO | unassigned | read `v3/research-20260715` worktree + docs; writes only to `.agent/` | 2026-07-16 | 2026-07-16 |

## Status legend
`TODO → READY → IN_PROGRESS → REVIEW → CHANGES_REQUESTED → DONE` (or `BLOCKED`). `DRY_RUN` = a
verification artifact, not a real task.

## Notes
- **TASK-DRY-RUN-001** is a read-only dry run used to verify the controller→reviewer path during
  bootstrap. It did NOT call the builder on product code. It is marked DRY_RUN and must not be
  confused with real work. See `.agent/tasks/TASK-DRY-RUN-001-TASK.md`.
- **TASK-001** is the first real task. Audit-only — no product code changes, no migrations
  applied, no deploy, no cutover. Owner starts it with the command at the end of the bootstrap
  report. See `.agent/tasks/TASK-001-TASK.md`.
