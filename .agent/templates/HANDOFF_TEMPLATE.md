# Handoff — <context>

> A handoff is complete when a fresh Claude Code session, with NO chat history, can resume the
> work by reading this file plus the linked `.agent/` files. Do not rely on conversation memory.

- **Written at (UTC):**
- **Written by:** _(controller / builder / reviewer / main session)_
- **Reason:** _(end of cycle / session closing / BLOCKED / OWNER GATE / power-loss recovery point)_

## Where the repo is right now
- **Repo:** web-lms-chinh-thuc
- **Primary checkout branch:** _(branch of the main worktree)_
- **Primary checkout HEAD:** _(sha + one-line subject)_
- **Working tree status:** _(clean / list uncommitted paths — but never secret values)_
- **Active worktrees:** _(from `git worktree list` — path, HEAD, branch)_
- **Uncommitted changes that are NOT part of the current task:** _(list, or "none" — these block
  new work until the owner resolves them)_

## Current task in flight
- **Task ID:**
- **Status:** _(TODO / READY / IN_PROGRESS / REVIEW / CHANGES_REQUESTED / DONE / BLOCKED)_
- **Owner (builder):**
- **Branch / worktree:**
- **Last result file:** `.agent/results/<TASK-ID>-RESULT.md` _(if any)_
- **Last review file:** `.agent/reviews/<TASK-ID>-REVIEW.md` _(if any)_
- **Last review verdict:** _(PASS / PASS_WITH_CONDITIONS / FAIL / pending)_
- **What is done so far:**
- **What remains:**

## What to do next (the very next action)
_A single, concrete next step a fresh session can execute without asking questions. Example:
"Read .agent/tasks/TASK-002-TASK.md, then dispatch the builder agent on worktree X, branch Y.
Do NOT deploy. Required tests: tests/foo.test.mjs."_

## Open OWNER APPROVAL GATES (if any)
_Which of the 9 gates are pending owner approval, and what the owner must approve. "None" if none._

## Open risks (summary — full list in .agent/RISKS.md)
_Top 1–3 risks a fresh session must know before touching anything._

## Pointers a fresh session must read first
1. `.agent/README.md` — the flow and the rules.
2. `.agent/CURRENT_STATE.md` — where things stand.
3. `.agent/TASK_INDEX.md` — every task and its status.
4. `.agent/DECISIONS.md` — decisions already made (do not re-litigate).
5. `.agent/RISKS.md` — known risks and pre-existing issues.
6. `.agent/OWNER_APPROVALS.md` — what is owner-gated and what has been approved.
7. The current task file + its latest result/review.

## Things NOT to do (this cycle)
_Explicit prohibitions for the next session — e.g. "Do not start V3 product-code fixes; that is
TASK-001's scope and it is audit-only." "Do not commit; uncommitted changes include the owner's
scratch file." "Do not run the broad suite until the stub file is reset to {}."_
