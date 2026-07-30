# DUAL LMS SYSTEM ISOLATION — PROTECTED PREVIEW EVIDENCE

**Date:** 2026-07-30  
**Database:** Supabase Preview `plgrmaktvudjetfkwmyg`  
**Forbidden Production mutation ref:** `aqozjkfwzmyfunqvcyjv`

## Exact protected deployments

| Component | Deployment | URL | Source |
|---|---|---|---|
| LMS | `dpl_EJzbhs29UDcquWYantGm9ZUN49Dm` | `https://web-lms-chinh-thuc-g24eydt80.vercel.app` | `044519300131745bf0e99a98ff152dd2c8afcc92` |
| Commerce `shop.yeunauan.live` | `dpl_EsjG25a7ieikyePWEr2LpRVaMDKi` | `https://web-ban-hang-chinh-thuc-4djgu6vk2.vercel.app` | `94ff084c6ce8fa9988d15432f15f2cdc410045e4` |
| Commerce `yeubep.shop` | `dpl_YkqFJF3HZt4DzNAGoS6jHzkLNDqK` | `https://web-ban-hang-yeubep-shop-78a8xrikp.vercel.app` | `94ff084c6ce8fa9988d15432f15f2cdc410045e4` |

All are Preview targets protected by Vercel authentication. They have no
Production alias and were not promoted.

## Migration rehearsal

The Preview substrate used synthetic `.example.test` identities only.

| Check | Result |
|---|---|
| Apply duration | 911.461 ms |
| Course business checksum before/after | `f037d1d9...0100c` / match |
| Empty-order checksum before/after | `4f53cda1...2b945` / match |
| Columns | `courses.lms_tenant`, `orders.lms_tenant` present |
| Constraints | 2 exact allowlist constraints |
| Indexes | 5 reviewed indexes |
| Existing tenant values | 6 NULL, 0 non-NULL |
| Rollback/reapply | passed |
| Seed checksum repeated | passed |
| V5 checksum before/after | unchanged |

The deterministic seed after both applies had 6 courses and 2 synthetic orders.
No Production row or PII was copied.

## Hosted LMS API and IDOR

Catalogs:

- `yeunauan`: `preview-yeunauan-course-a`,
  `preview-yeunauan-course-b`, `preview-legacy-canonical`;
- `yeubep`: `preview-yeubep-course-a`,
  `preview-yeubep-course-b`.

| Probe | HTTP | Contract |
|---|---:|---|
| Invalid tenant | 400 | `INVALID_LMS_TENANT` |
| Opposite-tenant lesson | 403 | `COURSE_LMS_TENANT_MISMATCH` |
| Opposite-tenant enrollment | 403 | `COURSE_LMS_TENANT_MISMATCH` |
| Opposite-tenant progress | 403 | `COURSE_LMS_TENANT_MISMATCH` |
| Opposite-tenant Drive action | 403 | `COURSE_LMS_TENANT_MISMATCH` |
| Mixed-LMS Drive batch | 409 | `MIXED_LMS_BATCH_FORBIDDEN` |

Nine Drive actions passed dry-run: image, recipe, material and video upload;
media verification; direct permission; permission sync; repair; retry. Each
returned the canonical course and `yeunauan`, wrote sanitized Preview audit
metadata and made no Google request.

## Hosted Commerce routing

Both protected deployments passed:

- server-reported deployment `SALES_SITE`;
- same-tenant target list;
- inactive synthetic self-target with explicit matching `lms_tenant`;
- deep link to the correct LMS Admin tenant;
- forged deployment tenant: 403 `COURSE_LMS_TENANT_MISMATCH`;
- forged cross target: 409 `CROSS_LMS_TARGET_FORBIDDEN`;
- duplicate slug: 409 `COURSE_SLUG_CONFLICT`.

No real order, payment, enrollment sync, email or customer identity was used.

## Browser and UI evidence

Chromium, Firefox and WebKit each passed desktop, iPhone, Android and tablet:
12/12. Switcher labels, deep link, tenant change, stale-course clearing,
localStorage, keyboard focus and responsive rendering passed.

WebKit reported a non-blocking `navigator.storage.persisted` warning from the
Vercel Preview protection layer. The string is absent from application source;
all application assertions passed and no application page error was recorded.

Sanitized evidence is in [screenshots](evidence/screenshots/), including:

1. LMS Admin `shop.yeunauan.live`;
2. LMS Admin `yeubep.shop`;
3. separate course lists across 12 browser/viewport cases;
4. mobile switcher;
5. invalid deep-link state;
6. legacy warning;
7. global badge;
8. Commerce dropdown for `shop.yeunauan.live`;
9. Commerce dropdown for `yeubep.shop`;
10. forged target rejection.

## Regression and security

| Gate | Result |
|---|---|
| LMS regression | 332/332 |
| Commerce regression | 78/78 |
| Browser matrix | 12/12 |
| LMS CSS build | pass |
| Migration apply/rollback/reapply | pass |
| Hosted API/IDOR | pass |
| Drive dry-run | 9/9 |
| `git diff --check` | pass |
| Commerce npm audit | 0 advisories |
| LMS npm audit | 4 moderate, 0 high/critical |
| Secret scan of change set | no committed value |

The four LMS advisories are transitive through the existing Google API/UUID
chain. Their automatic resolution requires a breaking dependency change, which
is deliberately excluded from this isolation release.

## Proof of no Production mutation

- Production schema still has no `lms_tenant` column.
- Production flags were not created or enabled.
- Production deployment IDs remain unchanged.
- No Production database write, Google call, course, order, enrollment,
  payment, domain, alias or Portal mutation was performed.
