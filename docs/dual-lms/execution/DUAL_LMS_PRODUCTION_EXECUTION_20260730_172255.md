# DUAL LMS PRODUCTION EXECUTION — STOPPED AT P0

**Approval ID:** `OWNER-APPROVAL-20260730-DUAL-LMS-01`  
**Operator:** Codex in the owner-authorized deployment environment  
**Timezone:** Asia/Ho_Chi_Minh  
**Started:** 2026-07-30 17:18 +07:00  
**Stopped:** 2026-07-30 17:22:55 +07:00  
**Final status:** `STOPPED BEFORE MUTATION — IDENTITY/ENV/BACKUP MISMATCH`

## Scope actually executed

Only P0 read-only source, deployment, domain, project, environment-name and
Supabase project identity checks were run. P1–P7 were not started.

No Production database write, backup data export, migration, deployment,
promotion, feature-flag change, canary, order, enrollment, Google Drive action,
domain change or legacy mutation occurred.

## Approved identity verification

| Item | Expected | Result |
|---|---|---|
| LMS runtime | `044519300131745bf0e99a98ff152dd2c8afcc92` | exists on pushed feature branch |
| LMS evidence | `c8cd7ac924d1c4f7faebb5c26f6751f183bcbc7f` | remote branch HEAD, clean worktree |
| Commerce runtime | `94ff084c6ce8fa9988d15432f15f2cdc410045e4` | exists on pushed feature branch |
| Commerce evidence | `5c03c2da21ccd6ae12dbb80a8695b448d4a11565` | remote branch HEAD, clean worktree |
| Forward SHA-256 | `c522fa0a2636155607eb2f44b3057aab119875b19fa82279ad9183d2ee9d7499` | match |
| Rollback SHA-256 | `dd684100800520760afd62f4ee386c82dadcb075a3022a7c6c5223cb87bd2a6e` | match |

The LMS post-runtime diff contains only documents, sanitized evidence and
Preview test scripts. The Commerce post-runtime diff contains only
`.gitignore`. No unreviewed runtime or migration diff was found.

## Production deployment and domain snapshot

| Component | Project | Deployment | State |
|---|---|---|---|
| LMS | `prj_TimQqrVhrOLW8y1KI464JBvajwlz` | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | Production / READY |
| Commerce main | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h` | Production / READY |
| Commerce second | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` | `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6` | Production / READY |

Domain ownership remained:

- LMS: `daubepnho.store`, `www.daubepnho.store`;
- Commerce main: `shop.yeunauan.live`;
- Commerce second: `yeubep.shop`, `www.yeubep.shop`.

Supabase ref `aqozjkfwzmyfunqvcyjv` was found as `ACTIVE_HEALTHY`.

## Production environment-name audit

### LMS project

The Vercel Production environment currently reports these 14 project variables:

`ACCOUNT_EVENT_HASH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`LMS_ENTRY_TOKEN_REQUIRED_COURSES`, `LMS_SERVER_TIMING`, `SYSTEM1_URL`,
`V2_DELIVERY_HANDLERS_ENABLED`, `V2_DRIVE_WORKER_DRY_RUN`,
`V2_OUTBOX_SHADOW_MODE`, `V2_OUTBOX_WORKER_DRY_RUN`,
`V2_OUTBOX_WORKER_ENABLED`, `V2_PORTAL_PROJECTION_DRY_RUN`,
`V2_PORTAL_PROJECTION_ENABLED`, `V2_RECONCILIATION_READONLY`.

The following required runtime names are absent:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `SESSION_SECRET`;
- `ADMIN_EMAILS`;
- `INTERNAL_SYNC_SECRET`.

Source verification:

- `utils/supabase.js` directly requires both Supabase variables;
- `utils/lms-secrets.js` fails closed for `SESSION_SECRET` and reads
  `INTERNAL_SYNC_SECRET`;
- admin authorization reads `ADMIN_EMAILS`.

The three restored local LMS env snapshots contain the relevant key names but
their values are empty; they are not a valid Production source. No secret value
was printed or copied.

Google OAuth client names are present in Production, so Google-only absence is
not the blocker.

### Commerce projects

Both Commerce projects expose the same required 15 Production names:

`ADMIN_EMAILS`, `ADMIN_PASSWORD`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME`, `COMMERCE_DATA_MODE`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INTERNAL_SYNC_SECRET`,
`PUBLIC_SITE_URL`, `SALES_SITE`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`,
`SYSTEM1_URL`, `SYSTEM3_URL`.

No value was emitted. Because LMS already failed P0, no secret-bearing
Production env pull or value mutation was attempted.

## Stop decision

The approved P0 explicitly requires stopping before mutation if any mandatory
Production env is missing or if runtime source/environment cannot be safely
reproduced. The current LMS deployment may retain an older deployment-time env
snapshot, which explains why it remains READY, but a new build from the
approved runtime commit would use the current project environment and cannot be
assumed to inherit missing values.

Codex did not copy values from Preview, another project, source files or old
deployments because the approval explicitly forbids unverified secret copying.

## Gate status

| Gate | Status | Mutation |
|---|---|---|
| P0 identity | source/deploy/domain identity passed | none |
| P0 environment | **failed: mandatory LMS env names absent** | none |
| P1 backup | not started | none |
| P2 migration | not started | none |
| P3 deployment | not started | none |
| P4–P6 enable/canary | not started | none |
| P7 observation | not started | none |

## Required next action

The owner must restore or explicitly approve the authoritative Production
values for the five missing LMS variables in project
`prj_TimQqrVhrOLW8y1KI464JBvajwlz`, then issue a new Production execution
approval. The stopped approval must not be reused.

