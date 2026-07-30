# ADR — DUAL LMS LOGICAL TENANT ISOLATION

**Status:** accepted for local/protected Preview implementation  
**Date:** 2026-07-30  
**Production authorization:** none

## Context

Two Commerce tenants use one LMS codebase, domain, Vercel project and Supabase.
The business requires independently managed learning catalogs, lessons,
enrollments, progress and course-dependent Drive operations without duplicating
infrastructure.

## Decision

“Two LMS riêng” means two server-enforced logical LMS tenants:

- `yeunauan`, labeled `LMS — shop.yeunauan.live`;
- `yeubep`, labeled `LMS — yeubep.shop`.

Isolation is an authorization/data-ownership boundary, not a frontend filter.

## Tenant field

Use only `lms_tenant`; do not create or retain `learning_site`.

Add:

```sql
courses.lms_tenant TEXT NULL
orders.lms_tenant TEXT NULL
```

Allowed values are `yeunauan` and `yeubep`.

Reason for not reusing `learning_site`:

- Production has neither field, so no deployed compatibility benefit exists;
- the new requirement includes Admin and student system routing, not only
  learning content ownership;
- `lms_tenant` directly states the authorization boundary;
- old multisite helpers will be ported selectively and renamed consistently.

## Effective tenant resolver

For a course:

1. valid explicit `courses.lms_tenant`;
2. canonical/self legacy course with valid `sales_site`;
3. canonical/self legacy course with NULL `sales_site` → restored legacy
   fallback `yeunauan`;
4. alias → exactly one canonical/self target → target tenant;
5. missing, inactive, chained, circular or invalid target → fail closed.

Never infer tenant from browser domain/query/body/header, forwarded host, title,
slug suffix or project name.

For an order:

1. valid explicit `orders.lms_tenant`;
2. historical order valid `sales_site`;
3. historical NULL `sales_site` → restored fallback `yeunauan`;
4. verify the snapshotted canonical learning target resolves consistently;
5. mismatch/unresolved → fail closed.

New feature-on orders snapshot `lms_tenant`. Historical orders are not rewritten.

## Shared versus isolated

| Component | Shared | Isolated by LMS tenant | Enforcement |
|---|---:|---:|---|
| Supabase/project/domain/codebase | yes | no | one infrastructure |
| Admin auth/allowlist | yes | no | existing auth |
| Student identity/email | yes | no | one `students` identity |
| Session/cookie/device guard | yes | context resolved | token/session course → tenant |
| Course catalog | no | yes | canonical course resolver |
| Lesson/section/material/media | no | yes | ID → course → tenant |
| Enrollment | no | yes | canonical course + tenant |
| Progress | no | yes | lesson ID → course → tenant |
| Course-specific config | no | yes | authorized course prefix |
| Drive credential pool | yes | no | global secret boundary |
| Drive folder/permission action | no | yes | authorize before Google call |
| Risk/account sharing | yes | no | global normalized email |
| Diagnostics/runtime/outbox | yes | course actions scoped | global badge + handler checks |
| Audit infrastructure | yes | course event includes tenant | selected/effective tenant metadata |

## LMS Admin UX

One `lms-admin.html` exposes two accessible switch cards. `?lms=` and
localStorage are navigation hints. Changing tenant clears an invalid selected
course. Alias rows are excluded from canonical course lists and rendered only
as a legacy shared warning.

Global tabs display `TOÀN HỆ THỐNG`.

## Student flow

Student identity and session signing remain shared. Entry token/session carries
canonical course slug; backend resolves tenant from that course. Catalog and
entitlement responses are scoped to the resolved LMS context. The same email
may hold independent enrollments in both tenants.

No student-facing switcher is required.

## Commerce routing

Deployment `SALES_SITE` maps one-to-one to `lms_tenant`. With the new flag on:

- target dropdown lists only same-tenant canonical courses;
- self-target course stores explicit `courses.lms_tenant`;
- new order stores `orders.lms_tenant`;
- approve/resync/revoke sends the tenant in authenticated server payload;
- LMS reloads canonical course and rejects mismatch.

With the flag off, exact restored Commerce payload and behavior remain.

## Legacy alias

`thitxiennuongchaungoc-yeubep → thitxiennuongchaungoc` is a historical
cross-LMS shared mapping. It remains readable for historical entitlement but:

- cannot be recreated;
- cannot change target;
- cannot own lessons;
- is not a canonical LMS course;
- displays `LIÊN KẾT DÙNG CHUNG CŨ`.

Hard split is a separate migration project.

## Drive

Credentials/OAuth pool remain shared. No Production file or folder is moved.
Tenant authorization occurs before every upload, verify, permission, sync,
repair or retry call. Preview uses a dry-run adapter.

Per-tenant root folders are deferred: they are not needed to enforce ownership
and would introduce external migration/credential risk.

## Feature flags

```text
LMS_DUAL_SYSTEM_ENABLED=false
COMMERCE_DUAL_LMS_ROUTING_ENABLED=false
```

Feature-off code must tolerate absence of new columns. Feature-on requires the
additive migration and fails closed otherwise.

## Error contract

- `INVALID_LMS_TENANT`
- `COURSE_LMS_TENANT_MISMATCH`
- `CROSS_LMS_TARGET_FORBIDDEN`
- `UNRESOLVED_LMS_TENANT`
- `COURSE_NOT_FOUND_IN_LMS`
- `LEGACY_SHARED_MAPPING_READ_ONLY`
- `MIXED_LMS_BATCH_FORBIDDEN`

## Migration and rollback

Migration is additive/nullable, preserves all global identities and performs no
backfill. Rollback order:

1. flags off;
2. export non-NULL course/order tenant delta;
3. deploy compatible code if needed;
4. remove only new indexes/constraints/comments/columns;
5. never delete or rewrite business rows.

## Consequences

Benefits:

- strict logical isolation without new infrastructure;
- legacy-compatible rollout;
- one identity/session and credential pool;
- reversible additive schema.

Limitations:

- database/service-role blast radius remains shared;
- tenant isolation depends on every privileged handler using the resolver;
- global slug uniqueness remains;
- legacy shared alias is a deliberate exception;
- no physical data residency or separate failure domain.
