# LMS V5 Channel Feed — Implementation Plan

## Goal
Build and verify an isolated, feature-flagged LMS V5 channel-feed Preview from exact B05 SHA `fc12c3b21329158e13a4a027833afd2dec61e973`, preserving B05 as the default fallback and making no Production mutation, merge, domain change, or Production deployment.

## Guardrails
- Work only on branch `feature/lms-v5-channel-feed-20260727` in this worktree.
- Do not use `origin/main` as the base.
- Do not change commerce, Portal, tenant, domain, canonical course slug, enrollment identity, or the existing auth/session guard contract.
- V5 defaults off; B05 remains intact.
- Do not call Production mutations, apply Production migrations, send real email, grant real Drive access, merge, or deploy Production.
- Stop if implementation requires any prohibited action or breaks the verified B05 boundary.

## Phases
- [completed] 0. Audit exact B05 source/docs/deployment and produce the 12 Gate 0 design documents.
- [completed] 1. Scaffold isolated V5 frontend/admin build and shared server modules without replacing B05 entry points.
- [completed] 2. Add forward/rollback database migrations, fixture data, migration dry-run tooling, and reports.
- [completed] 3. Implement student/admin V5 APIs with current server-side auth/session/enrollment boundaries.
- [completed] 4. Implement student channel list/feed/search/topics/progress/realtime-fallback UI.
- [completed] 5. Implement admin feed/composer/media lifecycle/preview/version/audit UI.
- [completed] 6. Add and run unit, integration, E2E, security, accessibility, and performance tests; retain B05 baseline.
- [in_progress] 7. Commit exact source, push branch, deploy isolated Preview with fixture-only/no-production-write configuration, and probe desktop/mobile.
- [pending] 8. Write `docs/v5/V5_PREVIEW_IMPLEMENTATION_REPORT.md`, verify all gates, and stop before Production rollout.

## Completion Criteria
- All user-defined Preview gates pass with evidence recorded in the final report.
- Feature flag is server-controlled and off by default; B05 files and flows remain operational.
- Final branch commit is pushed and Preview is Ready without Production aliases or Production writes.
- Report clearly separates complete functionality, Preview/fixture functionality, and prohibited Production work.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Exact audit worktree contained untracked handover/planning files | 1 | Created a fresh clean target worktree directly from the verified exact SHA. |
| PowerShell inventory command piped directly from a `foreach` block and failed to parse | 1 | Will collect files into an array first, then sort/process the array. |
| First B05 test run failed because the fresh worktree had no installed npm dependencies | 1 | Run `npm ci` from the exact lockfile, then rerun the unchanged baseline suite. |
| First V5 module import check lacked local Supabase env and also exposed that `getLmsSessionHeaders` is handler-local, not exported | 1 | V5 now parses the two existing headers locally; rerun import checks with the test-only Supabase stub. |
| Requested `@vitejs/plugin-react@^7.0.0` did not exist in the current npm registry | 1 | Queried registry metadata and aligned React/Vite/plugin/TypeScript packages to available current versions. |
| First migration CLI dry-run produced no files because the Windows main-module path check did not match | 1 | Replaced URL pathname normalization with Node `fileURLToPath(import.meta.url)`. |
| First headless screenshots captured `ERR_CONNECTION_REFUSED` because the hidden Vite process exited before binding | 1 | Relaunch through `npm.cmd`, verify HTTP 200 before recapturing, and discard the failed screenshots as evidence. |
| `npm ci` could not replace the Vite native binding because a prior local dev process still held it open | 1 | Resolve the exact Vite PID inside this worktree, stop only that process, then rerun install/E2E. |
| First Vercel Preview build expected the project-level `dist` output and failed after source upload | 1 | Set branch-local `outputDirectory=dist-v5` and add a deterministic bundle step that copies unchanged B05 static fallback files beside V5 assets before retrying Preview. |
| First authenticated Preview probe placed `--scope` after the URL, so beta `vercel curl` forwarded it to curl | 1 | Use the CLI global option before the `curl` subcommand and keep curl flags after `--`. |
| Preview catch-all function received no `req.query.path` and returned `route_not_found` for `/api/v5/channels` | 1 | Added a Vercel-compatible fallback that derives the catch-all path from `req.url`; keep query-derived path as the primary test/runtime seam. |
