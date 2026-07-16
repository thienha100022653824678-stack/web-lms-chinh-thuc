# Master Plan — web-lms-chinh-thuc

_The controller's overall plan. High-level, evidence-based, updated as phases complete. Not a
task list — see TASK_INDEX.md for tasks. Updated 2026-07-16._

## Context (VERIFIED FACTs — see CURRENT_STATE.md for detail)

- The repo is a V1/V2/V3 coexistence platform. V1 is live production. V2 is mid production-canary
  (P1–P4 PASS, P5 live delivery in flight, OWNER-GATED). V3 is fully built on branch
  `v3/research-20260715` (all 11 phases have a repo-side deliverable, 255/255 tests) but is NOT
  running in production and is owner-gated to enable.
- The owner wants a runtime switch so V1/V2/V3 can coexist and the owner flips `active_mode`.
  The untracked `utils/v2-runtime-controller.js` is the in-progress switch for V1↔V2.

## Goal of this agent system

Deliver, review, and accept changes to the LMS platform through a controller/builder/reviewer
loop that never breaks V1 production, never auto-deploys, never auto-applies prod migrations,
never moves traffic without owner approval, and never loses state across restarts.

## Phases (controller's roadmap)

### Phase AGENT-0 — Bootstrap the agent system (DONE 2026-07-16)
- Created `.claude/agents/{controller,builder,reviewer}.md` + `.agent/` tree.
- Verified agent definitions are loadable; ran a read-only dry run (TASK-DRY-RUN-001).
- Established baseline: 190/188/2 tests on `feat/v2-runtime-switch` (2 pre-existing fails).
- Recorded risks, decisions, owner-gates. No product code touched.

### Phase AGENT-1 — V3 Current-State Audit and Completion Plan (TASK-001, TODO)
- Audit V3 on `v3/research-20260715`: what is done, what is in-progress, what is missing for a
  V1/V2/V3 runtime switch, data/session/routing/feature-flag/rollback risks, missing tests, and
  the proposed next task sequence.
- Output: an evidence-based completion plan in `.agent/results/TASK-001-RESULT.md`, reviewer-verified.
- No product code, no migrations applied, no deploy, no cutover.

### Phase AGENT-2 — First implementation task (TBD from TASK-001's plan)
- The controller converts the highest-priority gap from TASK-001 into a concrete builder task
  (e.g. wire the V3 runtime switch on the appropriate branch, or fix the R-2 500-vs-401 contract
  gap, or author an additive migration). Branch/worktree, allowed files, required tests, rollback,
  and owner-gates will be explicit in that task file.
- Builder implements; reviewer independently verifies; controller accepts only on PASS + tests.

### Phase AGENT-3+ — Subsequent tasks (planned from each prior task's plan)
- Each task is small, scoped, reviewed, and accepted before the next is claimed.
- Production-affecting tasks carry a rollback; V1/V2/V3 tasks carry a regression matrix;
  session/auth tasks carry negative tests; migrations carry status tags.

## Invariants the plan never violates

- V1 stays live until the owner switches traffic.
- No auto-cutover, no auto-prod-deploy, no auto-prod-migration, no secret handling without owner
  approval (the 9 gates).
- Only the builder edits product code; controller/reviewer edit `.agent/` + `.claude/` only.
- State persists in `.agent/` so any session can resume from HANDOFF.md.
- Evidence over assertion: VERIFIED FACT / INFERENCE / UNKNOWN / OWNER DECISION.
