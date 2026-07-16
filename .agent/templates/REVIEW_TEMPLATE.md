# Review — <TASK-ID>

> Written by the **reviewer** into `.agent/reviews/<TASK-ID>-REVIEW.md`.
> Independent review based on the task, the diff, and the real repo/test state — NOT just the
> builder's RESULT. First pass: no product-code edits.

- **Task ID:**
- **Reviewer:**
- **Reviewed at (UTC):**
- **Worktree / branch:**
- **Base commit:**
- **Builder's result file:** `.agent/results/<TASK-ID>-RESULT.md` _(read for claims, verified
  independently — not trusted as proof)_

## Reviewed evidence
_What you actually ran and read. Commands + outputs, files + lines, diffs inspected. Be specific._

## Scope verification
_Did the builder edit ONLY "Files allowed to change"? Any forbidden file touched? Any scope creep?
State the changed-file list and the verdict._

## Functional verification
_For each functional requirement / acceptance criterion: does the change satisfy it? Cite the
command or test that proves it. Unmet items are findings._

## Regression verification
_Required for any V1/V2/V3-touching change. Regression matrix:_
| Area | Before | After | Verdict |
|------|--------|-------|---------|
| V1 … | … | … | … |
| V2 … | … | … | … |
| V3 … | … | … | … |

_Broad suite result: `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` → total/pass/fail.
Distinguish NEW regressions from pre-existing failures._

## Security review
_Authentication / authorization / session / cookie / CORS / input validation / logging / privacy
/ secret handling. For each that the task touches: what was checked, what passed, what didn't._

## Migration review
_If a migration is involved: additive? idempotent? rollbackable? business-data-safe? Status tag
correct (CREATED_ONLY/TESTED_LOCAL, never APPLIED_PRODUCTION without evidence+owner approval)?
Rollback SQL present and real? If no migration, write "No migration in this task."_

## Test quality
_Do the required tests actually assert the requirement? Any fake-green tests (assert true / shape
only / mock away the unit under test)? For session/auth changes: are NEGATIVE tests present
(wrong token, expired session, missing header, wrong device, revoked session)?_

## Findings by severity
_List each finding with: evidence, file/line, impact, fix criteria. Use the sub-headers that apply._

### CRITICAL
### HIGH
### MEDIUM
### LOW

## Required fixes
_The ordered list the builder must address if the verdict is not PASS. One item per finding that
must be fixed. "None" if PASS._

## Final verdict
_Exactly one of:_
- [ ] **PASS**
- [ ] **PASS_WITH_CONDITIONS** — _(list conditions; only acceptable if none touch safety, data,
  core function, or production)_
- [ ] **FAIL**
