# Dual LMS Tracked Production Secrets Remediation

Date: 2026-07-31 (Asia/Ho_Chi_Minh)
Scope: local/Git only; no Production deploy, migration, flag, environment, or
data mutation.

## Executive result

Three credential-bearing files were found tracked at corrective commit
`1418eb5753a4886732830f18432629d0e0fae58b`:

- `.env.prod.local`
- `.env.prod.raw`
- `.env.production`

An exact safety copy was created outside every repository/worktree under
`C:\Users\gaomi\Documents\_private_backups\dual-lms-secret-remediation-20260731-133211`.
All three copies were present and readable. Their contents and hashes were not
printed or recorded in this report.

The three source files remain locally available but are ignored and removed
from the current Git index. This commit does not rewrite history, delete refs,
or revoke credentials.

## Name-only inventory

Each file contained the same variable-name set:

- `ADMIN_EMAILS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `INTERNAL_SYNC_SECRET`
- `NX_DAEMON`
- `SESSION_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `TURBO_CACHE`
- `TURBO_DOWNLOAD_LOCAL_ENABLED`
- `TURBO_REMOTE_ONLY`
- `TURBO_RUN_SUMMARY`
- `VERCEL`
- `VERCEL_ENV`
- `VERCEL_GIT_COMMIT_AUTHOR_LOGIN`
- `VERCEL_GIT_COMMIT_AUTHOR_NAME`
- `VERCEL_GIT_COMMIT_MESSAGE`
- `VERCEL_GIT_COMMIT_REF`
- `VERCEL_GIT_COMMIT_SHA`
- `VERCEL_GIT_PREVIOUS_SHA`
- `VERCEL_GIT_PROVIDER`
- `VERCEL_GIT_PULL_REQUEST_ID`
- `VERCEL_GIT_REPO_ID`
- `VERCEL_GIT_REPO_OWNER`
- `VERCEL_GIT_REPO_SLUG`
- `VERCEL_OIDC_TOKEN`
- `VERCEL_TARGET_ENV`
- `VERCEL_URL`

The overlap is complete: all 28 names occur in all three files.

No `GOOGLE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, database password variable,
or Drive refresh-token variable was present in this three-file name inventory.
That statement does not prove such credentials are absent from other historical
artifacts.

## Git provenance and residual history exposure

All three files were first added by:

`8758c3a02f53843f82dcbf0922e266dd192f920a`

The current repository ref audit found the files in 34 local branches, 23
remote refs, and 7 tags. This is expected to remain true after current-tree
remediation because history rewrite and ref deletion were explicitly excluded.

Local branches:

`archive/v2-old-rebuild-20260714`,
`backup/before-session-guard-20260711-212942`,
`backup/drive-admin-pool-before-20260706-091314`,
`feat/lms-perf-defertouch-pr`, `feat/v2-4repo-unified-switch`,
`feat/v2-canary-readiness`, `feat/v2-lms-baseline-fix`,
`feat/v2-rp1-auth-hardening`, `feat/v2-rp2-cors-device-policy`,
`feat/v2-rp2b-session-device-guard`,
`feat/v2-rp2b1-session-device-guard`, `feat/v2-rp2b2-logout`,
`feat/v2-rp2b3-revoke-polish`, `feat/v2-runtime-switch`,
`feat/v2-sync-verify`, `feature/lms-admin-multisite-isolation-20260729`,
`feature/lms-dual-system-isolation-20260730`,
`feature/lms-v5-channel-feed-20260727`,
`feature/lms-v5-integration-preview-20260728`,
`fix/lesson-main-video-one-tap`, `fix/lesson-media-save-verification`,
`fix/v2-canary-fixwave`, `integration/v2-lms-baseline-pre-defertouch`,
`main`, `perf/lms-first-lesson-shared-content-cache`,
`v2/platform-rebuild`, `v2/rebuild-20260714`, `v2/rebuild-20260715`,
`wip/protected-course-env`, and five `worktree-agent-*` branches.

Remote refs:

`origin/HEAD`, `origin/archive/v2-old-rebuild-20260714`,
`origin/backup-before-portal-sync-fix-20260703`,
`origin/feat/lms-perf-defertouch-pr`, `origin/feat/v2-lms-baseline-fix`,
`origin/feat/v2-rp1-auth-hardening`,
`origin/feat/v2-rp2-cors-device-policy`,
`origin/feat/v2-rp2b-session-device-guard`,
`origin/feat/v2-rp2b1-session-device-guard`,
`origin/feat/v2-runtime-switch`,
`origin/feature/lms-admin-multisite-isolation-20260729`,
`origin/feature/lms-dual-system-isolation-20260730`,
`origin/feature/lms-v5-channel-feed-20260727`,
`origin/fix/lesson-main-video-one-tap`,
`origin/fix/lesson-media-save-verification`,
`origin/integration/v2-lms-baseline-pre-defertouch`, `origin/main`,
`origin/perf/lms-first-lesson-shared-content-cache`,
`origin/perf/lms-static-tailwind-release`, `origin/v2/platform-rebuild`,
`origin/v2/rebuild-20260714`, `origin/v2/rebuild-20260715`, and
`origin/wip/protected-course-env`.

Tags:

`archive-v2-old-rebuild-20260714`, `backup/B05-2026-07-25`,
`pre-perf-ab-20260719`, `pre-plan-c-20260719`,
`pre-spavite-20260719`, `pre-tailwind-selfhost-20260719`, and
`v1-stable-20260713`.

## Runtime and Vercel audit

Production application code reads configuration through `process.env`.
No Production build or runtime source loads any of the three tracked filenames.
`check_db.js` directly reads `.env.prod.local`, but it is a local diagnostic
utility and is not part of the Vercel build/runtime contract.

The Vercel name/scope audit reported these seven required names with Production
scope, without reading their encrypted values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `ADMIN_EMAILS`
- `INTERNAL_SYNC_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Rotation plan

### A. Mandatory before any new deployment

| Credential name | Reason | Systems that must be updated consistently |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Production credential was present in Git history. | Supabase project; LMS Vercel; both Commerce Vercel projects, Portal, workers, and approved local secure stores if they use the same key. |
| `SESSION_SECRET` | Session-signing material was present in Git history. Existing sessions must be assumed forgeable. | LMS Vercel and every service that verifies the same LMS session contract; approved local secure store. Expect session invalidation. |
| `INTERNAL_SYNC_SECRET` | Internal service-authentication material was present in Git history. | LMS Vercel; both Commerce Vercel projects; Portal/sync workers and any other caller/verifier of this boundary; approved local secure store. |
| `GOOGLE_CLIENT_SECRET` | OAuth confidential client material was present in Git history. | Google Cloud OAuth client; LMS Vercel; any Commerce/Portal service using the same OAuth client; approved local secure store. |

Rotation must be coordinated so producers and consumers change together. Do
not deploy the clean runtime commit until the owner has completed and verified
this rotation.

### B. May remain if confirmed public/config-only

| Name | Classification |
|---|---|
| `SUPABASE_URL` | Public project endpoint, provided it contains no embedded credential. |
| `GOOGLE_CLIENT_ID` | OAuth client identifier, not the client secret. |
| `ADMIN_EMAILS` | Authorization configuration and potentially personal data; remove from Git, but rotation is not meaningful. Review exposure and access policy. |
| Vercel Git/deployment metadata names and Turbo/NX controls | Build/runtime metadata or non-secret controls; no credential rotation required. |

### C. Owner verification required

| Name | Required check |
|---|---|
| `VERCEL_OIDC_TOKEN` | Confirm the historical token is expired/revoked and cannot be replayed. It is normally ephemeral and is not a persistent env value to rotate manually; escalate to Vercel support/security if its lifetime or revocation state is uncertain. |

No Google service-account/private key or database password was identified by
name in these three files. The owner should separately confirm that no
equivalent credential was embedded under an unexpected variable name or in
other historical artifacts.

## Preventive controls

- `.env`, `.env.*` are ignored; only `.env.example` and
  `.env.*.example` are permitted.
- `.env.example` contains names/placeholders only.
- Current-tree scanning must report zero tracked Production credentials.
- Future builds must source secrets from Vercel Environment Variables or an
  approved secret store.
- A separate owner-approved incident may later rewrite Git history and retire
  old refs. This remediation intentionally does neither.

## Verification

| Gate | Result |
|---|---|
| Full LMS tests | PASS — 333/333 |
| JavaScript syntax | PASS — 72 files |
| LMS CSS build | PASS |
| `git diff --check` | PASS |
| Forbidden env files in `git ls-files` | PASS — 0 |
| Exact compromised credential values in current tracked tree | PASS — 0 |
| Exact compromised credential values in added diff lines | PASS — 0 |
| Generic JWT candidates in current tracked tree | PASS — 0 |
| Complete private-key blocks in current tracked tree | PASS — 0 |
| Production build/runtime dependency on the removed filenames | PASS — 0 |
| `npm audit` high/critical | PASS — 0 high, 0 critical |

`npm audit` continues to report four known moderate transitive advisories through
`googleapis` → `googleapis-common`/`gaxios` → `uuid`. The available automatic
fix requires a semver-major `googleapis` upgrade and was intentionally not mixed
into this remediation.

The generic marker scan found the literal start-marker text in `README.md`, but
there is no matching end marker or encoded key material; it is documentation
syntax, not a complete private-key block. No real value was allowlisted.

Final current-tree result:

**PASS — 0 tracked Production credentials**

## Production state

No Production deployment, migration, feature flag, environment variable,
domain, credential, or business data was changed by this remediation.
