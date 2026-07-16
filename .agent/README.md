# Agent System — web-lms-chinh-thuc

A 3-agent software development system (controller / builder / reviewer) running inside the
`web-lms-chinh-thuc` LMS repository. Its purpose: plan, build, and review work **without breaking
V1 production**, **without auto-deploying**, and **without losing state across power loss or
closed sessions**.

This directory (`.agent/`) is the durable coordination state. `.claude/agents/` holds the three
custom-agent definitions the harness dispatches.

## Agents

| Agent | Role | Edits product code? |
|-------|------|---------------------|
| **controller** | Inventory, plan, decompose, dispatch, accept, maintain state in `.agent/`. Enforces the OWNER APPROVAL GATE. Never marks DONE without reviewer PASS + tests. | No (only `.agent/` + `.claude/`, unless a scoped agent-infra task says otherwise) |
| **builder** | Implement one task: code, migration, tests. Self-fix within scope. Records result. | Yes — only the task's allowed files |
| **reviewer** | Independent review from task + diff + repo + tests (not the builder's report). Returns PASS / PASS_WITH_CONDITIONS / FAIL. First pass: no product-code edits. | No (only `.agent/reviews/`) |

## The flow

```
OWNER GOAL
  → CONTROLLER INVENTORY        (read-only: repo, branch, worktree, tests, docs)
  → CONTROLLER TASK             (write .agent/tasks/<ID>-TASK.md + TASK_INDEX)
  → BUILDER IMPLEMENTATION      (code/migration/tests; writes .agent/results/<ID>-RESULT.md)
  → REVIEWER REVIEW             (independent; writes .agent/reviews/<ID>-REVIEW.md + verdict)
  → BUILDER FIX                 (only if CHANGES_REQUESTED / FAIL)
  → REVIEWER RE-REVIEW
  → CONTROLLER ACCEPTANCE       (DONE only if PASS + required tests pass)
  → OWNER EXPERIENCE TEST       (owner drives the real app on a non-prod surface)
  → OWNER PRODUCTION APPROVAL   (OWNER GATE — never auto)
```

## Task states

`TODO → READY → IN_PROGRESS → REVIEW → CHANGES_REQUESTED → DONE` (or `BLOCKED`).

A task is **DONE** only when the reviewer returns PASS (or PASS_WITH_CONDITIONS the controller
judges safe) AND every required test passes. The controller never overrides a FAIL.

## OWNER APPROVAL GATE — stop and ask the owner for:

1. deploy to production;
2. run a migration on production;
3. delete or overwrite real data;
4. change DNS or domain;
5. rotate, print, or replace a secret;
6. move real traffic between V1, V2, and V3;
7. send email or mass notifications;
8. auto-lock student accounts;
9. force-push, rewrite Git history, or delete an important branch.

Everything else (read-only checks, local tests, additive migration files authored but not
applied, `.agent` state, dispatching builder/reviewer on a non-production branch/worktree)
proceeds without asking.

## Hard rules

- **Secrets:** never print/commit/read secret values. Check existence by name only.
- **Branches:** never modify `main` or production branches; never touch tag `v1-stable-20260713`.
- **Worktrees:** do not create a new worktree if a suitable one exists (`git worktree list`).
- **Concurrency:** never let two agents edit code in the same worktree at once. One builder owns a
  task at a time.
- **Scope:** only the builder edits product code; controller/reviewer edit only `.agent/` +
  `.claude/` (unless a scoped agent-infra task explicitly allows more).
- **Uncommitted work:** never ignore, reset, clean, checkout, or overwrite the user's uncommitted
  changes. Surface them instead.
- **Commits:** never `git add .` blindly. Stage by explicit path. Never commit `.env`, secrets,
  build artifacts, or sensitive data. Keep agent-system commits separate from product commits.
- **Evidence:** every conclusion is backed by a command/file, labeled VERIFIED FACT / INFERENCE /
  UNKNOWN / OWNER DECISION. Never fabricate V1/V2/V3 status.
- **Reviewer independence:** reviewer does not trust the builder's RESULT; verifies against the
  repo. Does not rewrite the builder's solution in the first pass.
- **Controller acceptance:** never DONE without reviewer PASS + required tests passing. Never
  override a FAIL.

## Per-task-type requirements

- **Production task** → must have a rollback.
- **V1/V2/V3-affecting task** → must have a regression matrix in the review.
- **Session/auth change** → must have negative tests.
- **Migration** → must be tagged `CREATED_ONLY | TESTED_LOCAL | APPLIED_STAGING | APPLIED_PRODUCTION`.
  `APPLIED_PRODUCTION` requires evidence AND owner approval — never self-set.

## Files in this directory

| File | Purpose |
|------|---------|
| `README.md` | This file — the flow and the rules. |
| `CURRENT_STATE.md` | Where things stand right now (facts). |
| `MASTER_PLAN.md` | The overall plan the controller is executing. |
| `DECISIONS.md` | Decisions made, with rationale + date. |
| `RISKS.md` | Known risks + pre-existing issues. |
| `HANDOFF.md` | Enough for a fresh session to resume with no chat history. |
| `OWNER_APPROVALS.md` | What is owner-gated and what has been approved. |
| `TASK_INDEX.md` | Every task, its status, owner, branch/worktree. |
| `tasks/` | `<TASK-ID>-TASK.md` per task. |
| `results/` | `<TASK-ID>-RESULT.md` written by builders. |
| `reviews/` | `<TASK-ID>-REVIEW.md` written by reviewers. |
| `templates/` | TASK / RESULT / REVIEW / HANDOFF templates. |

## Surviving a restart

State lives in these files, not in chat. To resume after a power loss or closed session:
read `HANDOFF.md` → `CURRENT_STATE.md` → `TASK_INDEX.md` → the in-flight task file + its latest
result/review. Then continue from "What to do next" in `HANDOFF.md`.
