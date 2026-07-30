# DUAL LMS SYSTEM ISOLATION — PREFLIGHT

**Captured:** 2026-07-30 15:51 Asia/Ho_Chi_Minh  
**Mode:** Production read-only, non-PII  
**Decision:** safe to proceed with local/protected Preview implementation; no
Production mutation is authorized.

## 1. Exact identity

| Component | Exact restored source | Branch created for this task |
|---|---|---|
| LMS | `fc12c3b21329158e13a4a027833afd2dec61e973`, tag `backup/B05-2026-07-25` | `feature/lms-dual-system-isolation-20260730` |
| Commerce | `e65262f3e8eca39d8224f5b010bd376f27e1f9e3`, tag `launch/yeubep-shop-2026-07-25` | `feature/commerce-dual-lms-routing-20260730` |

Neither worktree is based on `origin/main`.

## 2. Current Production deployment and domain mapping

Fresh Vercel inspect:

| Domain | Project | Deployment | Runtime tenant |
|---|---|---|---|
| `shop.yeunauan.live` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h` | `SALES_SITE=yeunauan` |
| `yeubep.shop` | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` | `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6` | `SALES_SITE=yeubep` |
| `www.daubepnho.store` | `prj_TimQqrVhrOLW8y1KI464JBvajwlz` | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | shared LMS B05 |

All deployments are Production/READY. Public HTTP checks returned 200 for both
storefronts and LMS Admin; `www.yeubep.shop` returns 308 to `yeubep.shop`.

The mapping is the restored pre-swap mapping and must not be inferred from old
domain-swap reports.

## 3. Supabase identity, schema and counts

Production ref: `aqozjkfwzmyfunqvcyjv`.

OpenAPI schema SHA-256:
`15d368bfdb9d5dab4a26d53220fcb4599e7a3f129984799402283dae90216b7a`.

Current `courses` has 22 columns and does not contain `learning_site` or
`lms_tenant`. Current `orders` has 24 columns and does not contain `lms_tenant`.

Relevant identities remain:

- `courses.slug` global UNIQUE;
- enrollment UNIQUE `(email, course_slug)`;
- lesson UNIQUE `(course_slug, lesson_no)`;
- progress UNIQUE `(email, lesson_id)`.

| Table | Count |
|---|---:|
| courses | 8 |
| orders | 28 |
| student_enrollments | 20 |
| lessons | 39 |
| lesson_progress | 0 |
| site_config | 73 |
| drive_admin_accounts | 3 |
| drive_permission_logs | 59 |
| drive_sync_queue | 9 |
| lms_verified_sessions | 38 |
| student_active_sessions | 16 |

## 4. Post-restore operational drift

A fresh full-table comparison against the restore snapshot found 25/27 exact
matches. Counts and all business tables remain unchanged. The two expected
runtime-mutable tables are:

- `site_config`: same 73 keys/rows, value checksum changed after runtime Drive
  token refresh/use;
- `lms_verified_sessions`: same 38 rows, session runtime fields changed after
  user/admin access.

Course, order, enrollment, lesson, progress, Drive logs/queue/admin accounts,
sync/audit and all other tables still match the restored snapshot. This is not a
source/schema/course-mapping baseline mismatch and does not authorize a restore.

## 5. Current course mapping dry-run

The read-only mapper selected no PII and found:

- 8 courses;
- 0 duplicate slug;
- 0 unresolved tenant;
- 0 alias chain/cycle/missing target;
- 1 legacy cross-tenant alias;
- no required backfill.

| Course | Sales site | Canonical target | Proposed LMS tenant | Lessons | Orders by target | Enrollments by target | Warning |
|---|---|---|---|---:|---:|---:|---|
| `banhmi4k` | NULL | self | `yeunauan` | 6 | 13 | 3 | legacy NULL fallback |
| `banhmicamsicula` | NULL | self | `yeunauan` | 6 | 0 | 0 | legacy NULL fallback |
| `bonglancuonnhatban` | NULL | self | `yeunauan` | 11 | 1 | 6 | legacy NULL fallback |
| `heomoixaolan` | NULL | self | `yeunauan` | 5 | 4 | 8 | legacy NULL fallback |
| `nguyencammongtimHT` | NULL | self | `yeunauan` | 2 | 0 | 0 | legacy NULL fallback |
| `puddingnama` | NULL | self | `yeunauan` | 5 | 3 | 2 | legacy NULL fallback |
| `thitxiennuongchaungoc` | NULL | self | `yeunauan` | 4 | 4 | 1 | legacy NULL fallback |
| `thitxiennuongchaungoc-yeubep` | `yeubep` | `thitxiennuongchaungoc` | canonical owner `yeunauan` | 0 | 4 | 1 | legacy shared cross-LMS alias |

The alias has no lesson of its own and must remain read-only compatibility. It
must not appear as an empty LMS course.

## 6. Commerce current behavior

Confirmed source contracts:

- tenant comes from deployment `SALES_SITE`;
- public course lookup is server-filtered by tenant;
- create/edit stores `sales_site`;
- `learning_course_slug` maps sales course to a canonical LMS target;
- order snapshots `sales_site`, `sales_host`, price and learning target;
- approve/resync/revoke canonicalize learning slug;
- shared entitlement prevents revoke while another approved order grants the
  same `(normalized email, canonical learning slug)`;
- dry-run blocks external sync side effects.

Gap: the existing target dropdown and backend do not know canonical LMS tenant.

## 7. LMS Admin and student endpoint inventory

Course-dependent:

- course list/create/update and course-prefixed `site_config`;
- lessons/sections, original-course moves and direct lesson IDs;
- enrollment list/create/update/revoke and bulk enroll;
- lesson progress;
- media verification and image/recipe/material/video uploads;
- Drive permission/sync/repair/retry and direct log/queue IDs;
- student trace/actions when scoped to a course.

Global/shared:

- admin auth/allowlist;
- Google GSI and session signing;
- global student identity;
- device/session guard;
- account-sharing/risk;
- Drive credential/OAuth pool;
- runtime flags, diagnostics/readiness, outbox/reconciliation and audit
  infrastructure.

Gap: B05 handlers use course slug/IDs under service-role but have no LMS tenant
authorization boundary.

## 8. Student/session routing

Current entry tokens and verified sessions carry `course_slug` but no tenant.
Tenant can be resolved server-side from canonical course, so a new mandatory
token column is not required for the initial additive migration. Feature-on
handlers must resolve token/session course to canonical course and fail closed.
Student identity remains global by normalized email.

## 9. `site_config` ownership

Current schema is a global key/value table. Course keys generally use:

```text
<course_slug>_<config_name>
```

Global keys include Drive credentials/cursor and runtime mode. Course-specific
keys can be scoped safely by first authorizing the canonical course and then
reading/writing its exact prefix. No table redesign is required.

Several historical/orphan-looking prefixes exist. They must not be assigned a
tenant by prefix guessing; only a resolved course permits course-dependent use.

## 10. Drive/session health

Read-only aggregates:

- Drive admin accounts: 1 active, 2 error;
- Drive permission logs: 45 success variants, 9 failed variants, 5 pending retry;
- Drive sync queue: 9 create actions;
- verified sessions: 16 active plus expired/logged-out/superseded/reset history;
- active-session table: 3 active plus logged-out/superseded/reset history.

This does not block local/Preview dry-run work. It is a known Production
operations limitation: no implementation/rehearsal may call Google Production,
and Production rollout would need a separate Drive health gate.

## 11. Portal/sync boundary

Commerce calls Portal/LMS server-to-server through `SYSTEM1_URL`, `SYSTEM3_URL`
and an internal secret. Current LMS sync contract is:

- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`.

Dual-LMS needs a tenant field in the authenticated server payload when the new
Commerce flag is enabled. Feature-off must preserve the exact old payload. LMS
must verify tenant against the canonical course; it must never trust the
payload alone. No Portal schema change is required because Portal entitlement
continues to use canonical course slug.

## 12. Environment-name inventory

Values were not read or recorded.

Commerce projects contain names for Supabase, Cloudinary, Google, admin,
internal sync, `SYSTEM1_URL`, `SYSTEM3_URL`, `SALES_SITE`, `PUBLIC_SITE_URL`
and `COMMERCE_DATA_MODE`.

LMS contains names for Google, LMS timing, account-event hashing, entry-token
policy and V2 worker/projection/reconciliation flags. The new dual-LMS flags do
not exist in Production and must default false in source.

## 13. Reusable old multisite artifacts

Reusable by manual review, not blind cherry-pick:

- allowlist/error class and canonical resolver pattern;
- server-side course assertion and canonical-only checks;
- LMS selector/deep-link/localStorage UX;
- course/lesson/enrollment/Drive IDOR tests;
- guarded Preview substrate/seed/auth harness;
- nine-action Drive dry-run adapter;
- browser matrix and screenshot harness;
- business-vs-schema checksum correction.

Must be renamed/redesigned:

- `learning_site` → `lms_tenant`;
- old feature flags → new dual-system flags;
- `?site=` → `?lms=`;
- error contracts;
- reversed post-domain-swap labels/mapping;
- student/token routing and optional `orders.lms_tenant`, which the old feature
  did not fully model.

Preview secrets, fixture runtime and Production execution scripts must not be
copied into Production runtime.

## 14. Data-model decision input

Use one concept/name: `lms_tenant`.

Recommended additive columns:

- `courses.lms_tenant TEXT NULL`;
- `orders.lms_tenant TEXT NULL` as immutable snapshot for new feature-on orders.

Both use the same allowlist. No `learning_site` field is created. Existing
orders remain NULL and use deterministic legacy resolver. This avoids routing
revoke/resync from a course owner that may change after order creation.

No token/session tenant column is required initially because their canonical
course slug is already present and must be resolved server-side.

## 15. Drive tenant-root decision

Do not add or move Production roots in this task. Existing course folders are
legacy and immutable. Course ownership is enforced before every Drive call.
An optional per-tenant root can be configured later for newly created courses,
but would require explicit non-secret env/config and a separate Google dry-run
and rollout gate.

## 16. Stop-condition assessment

| Condition | Result |
|---|---|
| Baseline/source/deployment unclear | PASS |
| Domain → project → `SALES_SITE` unclear | PASS |
| Unresolved target / alias chain / cycle | PASS: zero |
| Portal change required | PASS: no |
| Production Drive file move required | PASS: no |
| Historical order/enrollment rewrite required | PASS: no |
| Global identity change required | PASS: no |
| Preview requires Production credential/data | Must remain forbidden |
| High/critical security issue identified | None in current evidence |

## 17. Preflight conclusion

Proceed with exact-baseline local implementation and sanitized protected
Preview. The architecture must:

- use `lms_tenant` only;
- add nullable course and order snapshot columns;
- preserve feature-off B05/Commerce behavior without depending on migrated
  columns;
- keep the legacy shared alias read-only;
- resolve every course-dependent ID back to canonical course and tenant;
- keep student/session/Drive credentials/global infrastructure shared;
- perform no Production mutation.
