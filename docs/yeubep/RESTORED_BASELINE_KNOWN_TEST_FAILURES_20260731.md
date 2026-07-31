# Restored LMS baseline — known test failures

Date: 2026-07-31

## Baseline identity

This derivative is based on the owner-selected restored source from the
26–27/07/2026 backup:

- Original baseline: `fc12c3b21329158e13a4a027833afd2dec61e973`
- Worktree: `yeubep-independent-lms-production`
- Branch: `feature/yeubep-independent-lms-production`
- No cloud, DNS, Vercel, Supabase, Drive, or Production mutation was performed.

The three tracked environment files were removed from this derivative. The
runtime contract is represented by the placeholder-only `.env.example`; real
values must be supplied by the deployment secret store.

## Full baseline test result

The restored baseline test run discovered 285 tests:

- 279 passed
- 6 failed (accepted as known restored-baseline failures by owner decision)

No test or production source was changed to obtain this result.

## Known failures and classification

| Failure | Classification | Notes |
|---|---|---|
| `tests/lms-server-timing.test.mjs` | B — V2/performance | Server-timing instrumentation contract; not a required Yeubep LMS business-flow test. The failure was observed with the restored environment lacking live Supabase configuration. |
| `tests/v2-4repo-integration.test.mjs` | B — V2/performance | Four-repository V2 integration behavior; outside the restored LMS core fork checkpoint. |
| `tests/rp2b1-session-device.test.mjs` — `deferTouch: touch update failure returns legacy 500 with flag off` | C — not yet determined | Harness reached a `fetch failed`/503 path instead of the simulated database response. |
| `tests/rp2b1-session-device.test.mjs` — `deferTouch: 404 drains a failed touch without unhandledRejection` | C — not yet determined | Harness returned 503 because the restored baseline has no live Supabase test endpoint. |
| `tests/rp2b1-session-device.test.mjs` — `deferTouch: course mismatch drains a failed touch without unhandledRejection` | C — not yet determined | Same unavailable database/fetch harness condition; no production data was contacted. |
| `tests/rp2b1-session-device.test.mjs` — `deferTouch: empty-email 401 drains a failed touch without unhandledRejection` | C — not yet determined | Harness returned 500 while the expected isolated fixture response was 401. |

These six failures are not used as an exemption for new Yeubep code. Any new
failure, or any failure in a required LMS core flow, is a stop condition.

## Core LMS verification

The focused core suite passed 141/141 tests, covering:

- Google OAuth verification and admin authorization contracts;
- student/admin session signing, verification, cookie restoration and secret
  fail-closed behavior;
- course/lesson content loading and cache behavior;
- lesson video, image and supplemental media rendering;
- Drive/admin handler boot and media endpoint contracts;
- enrollment/admin authorization surfaces;
- logout and session revoke behavior;
- sync authentication, wrong-secret rejection and secret-safe errors;
- CORS/API authorization and no-secret-leak assertions.

This focused suite does not provision or connect to Production Supabase.

## Build and safety gates

- JavaScript syntax: PASS, 81 files checked, 0 failures.
- LMS CSS build: PASS (`npm run build:lms-css`).
- Application build script: not defined in the restored `package.json`.
- `git diff --check`: PASS.
- Secret scan: PASS; no tracked production credential detected. The only
  private-key match was a redacted placeholder/marker in README documentation.
- `npm audit`: 4 moderate `uuid` transitive findings; no high/critical finding.

## Remaining risk

The deferred-touch/session-device failures remain unclassified until an
isolated non-Production database fixture is available. They must be rerun in
the Yeubep test harness and must not be allowed to mask a new regression in
login, course, lesson, enrollment, progress, media, Drive, sync, or
authorization flows.
