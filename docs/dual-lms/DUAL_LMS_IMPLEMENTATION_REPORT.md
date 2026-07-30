# DUAL LMS SYSTEM ISOLATION — IMPLEMENTATION REPORT

**Date:** 2026-07-30  
**Scope:** local implementation and protected Preview only  
**Production:** unchanged

## Exact source

| Repository | Restored baseline | Feature branch | Preview-tested runtime commit |
|---|---|---|---|
| LMS | `fc12c3b21329158e13a4a027833afd2dec61e973` | `feature/lms-dual-system-isolation-20260730` | `044519300131745bf0e99a98ff152dd2c8afcc92` |
| Commerce | `e65262f3e8eca39d8224f5b010bd376f27e1f9e3` | `feature/commerce-dual-lms-routing-20260730` | `94ff084c6ce8fa9988d15432f15f2cdc410045e4` |

The final LMS documentation/evidence commit is intentionally newer than its
runtime deployment commit. No runtime file changed after the LMS Preview build.

## Architecture delivered

| Component | Shared | Isolated by LMS tenant | Enforcement |
|---|---:|---:|---|
| Supabase, LMS codebase/project/domain | yes | no | existing infrastructure |
| Admin authentication/allowlist | yes | no | existing signed admin session |
| Student identity | yes | no | one normalized-email identity |
| Session/device/risk | yes | course context | server-bound canonical course |
| Canonical courses | no | yes | effective `lms_tenant` resolver |
| Sections/lessons/media/material/config | no | yes | ID/slug → canonical course → tenant |
| Enrollment/progress | no | yes | canonical course/lesson → tenant |
| Course-dependent audit | infrastructure | yes | selected and effective tenant metadata |
| Drive credential pool | yes | no | existing pool; never exposed client-side |
| Course Drive actions | no | yes | tenant assertion before adapter/Google call |
| Portal/outbox/diagnostics | yes | no | existing contracts retained |

| Commerce domain | `SALES_SITE` | LMS tenant | LMS Admin label |
|---|---|---|---|
| `shop.yeunauan.live` | `yeunauan` | `yeunauan` | `LMS — shop.yeunauan.live` |
| `yeubep.shop` | `yeubep` | `yeubep` | `LMS — yeubep.shop` |

## Data model and flags

- One tenant name only: `lms_tenant`; `learning_site` is not introduced.
- Nullable `courses.lms_tenant` identifies explicit canonical ownership.
- Nullable `orders.lms_tenant` snapshots routing for new feature-on orders.
- Allowed values: `yeunauan`, `yeubep`.
- No backfill, delete, rewrite, cascade, identity change or global slug change.
- `LMS_DUAL_SYSTEM_ENABLED=false` by default.
- `COMMERCE_DUAL_LMS_ROUTING_ENABLED=false` by default.
- Feature-off code paths do not select the additive columns.

Migration:

- `migrations/20260730_dual_lms_tenant.sql`
- SHA-256 `c522fa0a2636155607eb2f44b3057aab119875b19fa82279ad9183d2ee9d7499`

Rollback:

- `migrations/20260730_dual_lms_tenant_rollback.sql`
- SHA-256 `dd684100800520760afd62f4ee386c82dadcb075a3022a7c6c5223cb87bd2a6e`

## Server-side boundaries

The LMS resolver accepts an explicit valid tenant, otherwise resolves canonical
legacy ownership from `sales_site`; NULL canonical legacy ownership uses the
audited `yeunauan` fallback. Aliases resolve exactly one canonical target.
Missing, inactive, chained, circular or invalid targets fail closed.

Every course-dependent handler validates the requested context, loads the
database resource, resolves its canonical course and effective tenant, compares
both tenants, performs the operation, verifies persisted identity on writes,
and records selected/effective tenant when applicable. Direct lesson,
enrollment, progress and Drive identifiers resolve backwards to their course.

Commerce feature-on writes are bound to the deployment's server-side
`SALES_SITE`. Browser-supplied `sales_site`, target slug or tenant cannot move a
write to the opposite LMS. The Admin form also fixes and disables the opposite
storefront option in each protected Preview deployment.

## LMS Admin and student behavior

- One responsive switcher at the top of `lms-admin.html`.
- `?lms=yeunauan|yeubep` and `?course=<slug>` are navigation hints only.
- Last selection persists in `localStorage`; switching clears an invalid course.
- Aliases are not rendered as empty LMS courses.
- Historical shared mapping shows `LIÊN KẾT DÙNG CHUNG CŨ`.
- Global functions show `TOÀN HỆ THỐNG`.
- Student identity remains global, while entry/session/course data resolves the
  tenant from the server-bound canonical course.
- The same email may keep independent enrollments in both LMS tenants.

## Legacy behavior

`thitxiennuongchaungoc-yeubep → thitxiennuongchaungoc` remains a read-only
historical exception. Existing entitlement remains compatible. The system does
not clone lessons, move progress, rewrite orders, change the target or create
new equivalent cross-LMS mappings.

## Drive decision

The OAuth/admin credential pool remains shared. No Production file is moved and
no tenant root migration is introduced. New and existing course operations are
isolated by resolving course ownership before any Google call. Protected Preview
uses a fail-closed dry-run adapter for all nine required actions.

## Production state

No Production migration, deployment, flag change, domain/alias change, course,
order, enrollment, Drive permission or legacy mutation occurred. Current
Production deployments remain:

- LMS `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`;
- Commerce `shop.yeunauan.live`: `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h`;
- Commerce `yeubep.shop`: `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6`.

