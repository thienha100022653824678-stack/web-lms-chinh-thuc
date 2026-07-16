# Result — <TASK-ID>

> Written by the **builder** into `.agent/results/<TASK-ID>-RESULT.md` after implementation.
> This is one input to the reviewer — it is NOT proof. The reviewer verifies claims independently.

- **Task ID:**
- **Builder:**
- **Worktree:**
- **Branch:**
- **Base commit:**
- **Finished (UTC):**

## Implementation summary
_What was built, in plain prose. What the change does._

## Files changed
_Exact paths. One per line. Mark new vs modified._

## Commands run
_Every command you ran, in order, with the relevant output summary (counts, exit status).
Never paste secret values._

## Tests run
- **Scoped tests (required by task):** _(files + pass/fail counts)_
- **Broad suite:** `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` → _(total/pass/fail)_
- **Pre-existing failures observed (NOT caused by this task):** _(list, or "none")_

## Security considerations
_If you touched auth/session/cookie/CORS/secret/logging/privacy, state exactly what changed and
why it is safe. If you did not touch any, write "No auth/session/CORS/secret surface changed."_

## Migration status
_One of CREATED_ONLY | TESTED_LOCAL | APPLIED_STAGING | APPLIED_PRODUCTION. Builder may only set
the first two. If a migration file was added, name it and confirm additive/idempotent/rollbackable._

## Deviations
_Anything you did that differs from the task as written, and why. "None" if none._

## Remaining risks
_Things the reviewer/owner should know. Pre-existing issues you did not fix (out of scope).
Follow-ups. "None" if none._

## Git status
_Output of `git status --short` at finish, and whether changes are committed or left uncommitted._

## Commit
_Commit hash + message if you committed (only if the task authorized a commit). "Not committed
(controller to decide)" otherwise._

## Builder conclusion
_One line. e.g. "Task implemented; scoped tests pass; no regression; ready for review."
Never "project complete."_
