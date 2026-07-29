# LMS Admin Multi-Site — Production Readiness

Date: 2026-07-29

Decision: **READY FOR OWNER-APPROVED PRODUCTION CANARY**
Authorization: none. Production execution remains prohibited.

## Exact identity

| Component | Baseline | Implementation SHA | Protected Preview |
|---|---|---|---|
| LMS | `fc12c3b21329158e13a4a027833afd2dec61e973` | `94e956f46d879b4bddec66f474fef52eff9d0da7` | `dpl_BWuhKjmBpbSbATbZTfSKZrRrHjX6` |
| Commerce | `74c70268f0619d9d9a9be5e564ea60200038100c` | `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9` | `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb` |

Build logs identify the exact feature branches and short commits. Both remote
heads match locally; neither uses `origin/main`.

Current Production rollback artifacts:

- LMS: `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.
- Commerce `yeubep.shop`: `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ`.
- Commerce `shop.yeunauan.live`: `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`.

No Preview has a Production alias.

## Mapping and read-only Production preflight

The verified mapping remains counterintuitive and immutable for this rollout:

- `yeubep.shop` → `yeunauan`.
- `shop.yeunauan.live` → `yeubep`.

Production REST preflight selected no PII. Counts are 9 courses, 30 orders, 22
enrollments, 39 lessons and 79 site_config rows. OpenAPI schema SHA-256 is
`15d368bfdb9d5dab4a26d53220fcb4599e7a3f129984799402283dae90216b7a`.

All nine courses resolve deterministically. Unresolved count and duplicate slug
count are zero. The only legacy alias is
`thitxiennuongchaungoc-yeubep` → `thitxiennuongchaungoc`; it remains a
read-only cross-site compatibility mapping. No backfill is required.

See `evidence/PRODUCTION_LEARNING_SITE_DRY_RUN.md` and `.json`.

## Proposed schema delta

Forward `migrations/20260729_lms_learning_site.sql` adds only:

- nullable `courses.learning_site TEXT`;
- allowlist check for NULL/`yeunauan`/`yeubep`;
- indexes on site, site/status and target/site;
- a column comment.

It does not alter global slug uniqueness, enrollment identity, orders, lessons
or progress.

| Artifact | SHA-256 |
|---|---|
| Forward migration | `81dc0a2869831e8b727b26e0056f7de256c94283870b45355c074e16c6a95071` |
| Rollback migration | `b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c` |

Sanitized rehearsal used `lock_timeout=5s`, `statement_timeout=30s`: forward
112.133ms, second apply 111.933ms, rollback 125.490ms and reapply 114.681ms.
Idempotency, rollback and checksums passed.

## Feature flags and env-name manifest

| Flag | Default | LMS Preview | Commerce Preview | Production |
|---|---|---|---|---|
| `LMS_ADMIN_MULTI_SITE_ENABLED` | false | true | n/a | absent/default false |
| `COMMERCE_LMS_SITE_ISOLATION_ENABLED` | false | n/a | true | absent/default false |

Production env names were inventoried without values. Existing LMS names include
the timing, V2, system URL, account-event and entry-token controls. Existing
Commerce names include `SALES_SITE`, `COMMERCE_DATA_MODE`, `PUBLIC_SITE_URL`,
system URLs and server-only Supabase/Google/Cloudinary/admin names. No secret
value is present in this package.

## Evidence and dependencies

- LMS 317/317; Commerce 73/73.
- Protected browser matrix 12/12.
- Hosted IDOR/enrollment/progress and nine Drive dry-run actions passed.
- V5 checksum unchanged; seed checksum reproducible.
- LMS audit: four moderate transitive findings, zero high/critical.
- Commerce audit: clean.
- Breaking dependency upgrade is isolated in `LMS_DEPENDENCY_FOLLOW_UP.md`.

## Backup, verification and rollback readiness

Before execution, capture schema-only backup, counts/checksums, relevant
table exports, Vercel env-name/domain/alias metadata and migration checksums.
Backups containing data remain encrypted/local and are never committed.

Verification SQL:
`sql/PRODUCTION_VERIFICATION_READ_ONLY.sql`.

Rollback order is flags off, code artifact rollback, then schema rollback only
if required after exporting all non-NULL `learning_site` delta. No cascade,
business-row deletion or whole-database restore is permitted.

## GO assessment

| Criterion | Result |
|---|---|
| Documentation/source/deployment identity | Pass |
| Production mapping unresolved | 0 |
| Additive/idempotent migration | Pass |
| Rollback without business-row loss | Pass |
| Flags default false | Pass |
| Preview isolation/no cross-site leak | Pass |
| High/critical dependency issues | 0 |
| Production mutation during readiness | 0 |

Conclusion: **READY FOR OWNER-APPROVED PRODUCTION CANARY**. This is not
authorization to deploy, migrate, merge, promote, canary or enable flags.
