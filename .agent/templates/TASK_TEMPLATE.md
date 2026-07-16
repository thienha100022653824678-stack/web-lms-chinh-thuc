# Task — <TASK-ID>

> Copy this template to `.agent/tasks/<TASK-ID>-TASK.md` and fill every field.
> A field with no value must be written as `_(none)_`, never left blank — blanks hide assumptions.

- **Task ID:** <TASK-ID>
- **Title:**
- **Status:** TODO _(initial; later READY / IN_PROGRESS / REVIEW / CHANGES_REQUESTED / DONE / BLOCKED)_
- **Owner:** _(builder agent name or "unassigned")_
- **Created (UTC):**
- **Last updated (UTC):**

## Business goal
_The user-facing outcome this task delivers, in one or two sentences. Not the implementation._

## Current evidence
_VERIFIED FACTs from the repo/git/tests that motivate this task right now. Cite commands or files.
Separate VERIFIED FACT / INFERENCE / UNKNOWN / OWNER DECISION._

## Repository
- **Repo:** web-lms-chinh-thuc
- **Required branch:**
- **Required worktree:** _(absolute or repo-relative path; "primary" if the main checkout)_
- **Base commit (expected):** _(sha or "current HEAD of required branch")_

## Dependencies
- **Depends on (task IDs):** _(none)_
- **Blocks (task IDs):** _(none)_

## Scope
- **In scope:**
- **Out of scope:**

## Files
- **Files allowed to change:** _(explicit paths; "only these")_
- **Files forbidden to change:** _(explicit paths — e.g. api/sync.js core write path,
  utils/lms.js V1 session helpers, tag v1-stable-20260713, main branch, Portal repo files)_

## Requirements
- **Functional requirements:**
- **Security requirements:** _(auth / authorization / session / cookie / CORS / input validation /
  logging / privacy / secret handling — list each that applies)_
- **Required tests:** _(exact test files that must exist and pass; note if negative tests required)_

## Acceptance criteria
_Concrete, checkable statements. Each must be verifiable by a command or a test, not a feeling._

## Rollback requirement
_How to undo this change safely. Every production-affecting task MUST have a rollback. For
migrations, reference the rollback SQL. For runtime, reference the flag-reversal order._

## Owner approval gates
_Which of the 9 gates this task will hit, if any (deploy prod / prod migration / delete real data
/ DNS-domain / rotate-or-show secret / move V1·V2·V3 traffic / mass email / auto-lock accounts /
force-push-rewrite-delete-branch). If none, write "None — safe to auto-run."_

## Migration status (if a migration is involved)
_One of: CREATED_ONLY | TESTED_LOCAL | APPLIED_STAGING | APPLIED_PRODUCTION.
Builder sets CREATED_ONLY or TESTED_LOCAL only. APPLIED_* is owner-only._

## Notes
_Anything the builder/reviewer needs to know that does not fit above._
