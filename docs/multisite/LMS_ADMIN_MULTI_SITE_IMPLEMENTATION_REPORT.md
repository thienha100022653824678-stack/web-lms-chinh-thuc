# LMS Admin Multi-Site Isolation — Implementation Report

Date: 2026-07-29
Status: **READY FOR OWNER-APPROVED PRODUCTION CANARY; not authorized**

## Exact source and Preview

| Component | Baseline | Implementation SHA | Protected Preview | Tests |
|---|---|---|---|---:|
| LMS | `fc12c3b21329158e13a4a027833afd2dec61e973` | `94e956f46d879b4bddec66f474fef52eff9d0da7` | `dpl_BWuhKjmBpbSbATbZTfSKZrRrHjX6`, `https://web-lms-chinh-thuc-c2kpdmspq.vercel.app` | 317/317 |
| Commerce | `74c70268f0619d9d9a9be5e564ea60200038100c` | `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9` | `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb`, `https://web-ban-hang-chinh-thuc-1sltsu4zu.vercel.app` | 73/73 |

Browser matrix is 12/12. Vercel build logs identify the exact feature branch
and source commit for each Preview. Neither Preview has a Production alias.

## Current mapping and architecture

- `yeubep.shop` → project `web-ban-hang-chinh-thuc` → logical `yeunauan`.
- `shop.yeunauan.live` → project `web-ban-hang-yeubep-shop` → logical `yeubep`.
- One LMS contains both namespaces; `sales_site`, canonical
  `learning_course_slug` and content owner `learning_site` remain distinct.
- Global course slug uniqueness and enrollment `(email, course_slug)` remain
  unchanged.

Production dry-run resolves 9/9 courses, with zero unresolved/duplicates and no
required backfill. The known legacy cross-site alias remains compatible and
read-only.

## Implemented controls

- fixed LMS selector, storage/deep-link/empty/global/legacy states;
- server-side course/lesson/media/enrollment/progress/Drive scope and IDOR deny;
- same-site Commerce target list, backend validation and self-target ownership;
- additive nullable migration, deterministic resolver and safe rollback;
- Preview-only fixed admin harness and Drive dry-run adapter;
- feature-off compatibility.

## Feature flags

| Flag | Default | LMS Preview | Commerce Preview | Production |
|---|---|---|---|---|
| `LMS_ADMIN_MULTI_SITE_ENABLED` | false | true | n/a | absent/default false |
| `COMMERCE_LMS_SITE_ISOLATION_ENABLED` | false | n/a | true | absent/default false |

## Evidence

- LMS 317/317; Commerce 73/73; browser 12/12.
- Hosted IDOR/enrollment/progress passed.
- Nine Drive actions passed dry-run without Google Production credentials.
- Migration/rollback/reapply and idempotency passed.
- V5 and deterministic seed checksums reproduced.
- Production read-only preflight selected no PII and performed no write.

## Previous resolved blockers

Earlier documents recorded that an LMS Preview schema was absent, hosted
browser evidence was unavailable and LMS E2E had not run. These were historical
Gate states and are resolved by the guarded B05 Preview substrate, protected
deployments and evidence above. Earlier Commerce Preview deployment IDs are
superseded by `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb`.

## Hạng mục

| Hạng mục | Trước | Sau Preview | Production Ready |
|---|---|---|---|
| LMS selector | Global list | Protected server-scoped selector | Owner canary ready |
| Course-dependent API | Admin-only, no site scope | Site/canonical IDOR enforcement | Owner canary ready |
| Commerce LMS target | Global target list | Same-site list + backend denial | Owner canary ready |
| Legacy alias | Shared, hard to identify | Preserved/read-only/warning | Owner canary ready |
| Migration | No `learning_site` | Additive/idempotent/reversible | Owner canary ready |
| Production | Existing behavior | Unchanged; flags default false | Awaiting approval |

No Production deployment, migration, merge, promotion, flag, canary, domain or
data mutation was performed.
