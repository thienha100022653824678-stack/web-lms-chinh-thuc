# LMS Admin Multi-Site — Production Runbook

STATUS: NOT AUTHORIZED FOR EXECUTION

Every Gate requires an evidence timestamp and owner checkpoint. Stop means no
later Gate may start.

## P0 — Final identity

- Precondition: owner approval ID/time, execution window and named operators are
  recorded; worktrees have no unexplained changes.
- Action: verify full LMS SHA
  `94e956f46d879b4bddec66f474fef52eff9d0da7`, Commerce SHA
  `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9`, migration hashes, Production ref
  `aqozjkfwzmyfunqvcyjv` and all deployment IDs in the manifest.
- Verification: remote heads equal SHAs; Preview build logs match implementation
  commits; Production deployments/aliases equal the snapshot.
- Owner checkpoint: approve exact identities, mapping and window.
- Rollback trigger: any mismatch or untracked runtime/migration diff.
- Evidence: Git/Vercel/Supabase identity outputs with no secret.

## P1 — Backup

- Precondition: P0 passed.
- Action: capture encrypted schema-only backup; export `courses`, `lessons`,
  `student_enrollments`, `lesson_progress` and `site_config` under the approved
  retention policy; record counts/checksums, env names, domains/aliases and
  migration hashes. Do not commit data/PII.
- Verification: backup tool exit zero, encrypted artifacts readable, counts are
  at least the read-only baseline 9/39/22/79 where applicable.
- Capture `BUSINESS_DATA_CHECKSUM_BEFORE` using only the explicit pre-existing
  business-column allowlists in
  `scripts/lib/multisite-business-checksum.mjs`. The query must not use
  `SELECT *`, `row_to_json(table.*)` or `to_jsonb(table.*)`. Record
  `SCHEMA_CHECKSUM_BEFORE` independently from the business checksum.
- Owner checkpoint: backup location/retention acknowledged.
- Rollback trigger: incomplete/unreadable backup or count mismatch.
- Evidence: sanitized manifest of filenames, hashes, counts and timestamps.

## P2 — Additive migration

- Precondition: both feature flags remain absent/false; P1 passed.
- Action: set `lock_timeout='5s'`, `statement_timeout='30s'`; apply only
  `migrations/20260729_lms_learning_site.sql`. Do not backfill.
- Verification: run `sql/PRODUCTION_VERIFICATION_READ_ONLY.sql`. Capture and
  compare these independent outputs:
  `BUSINESS_DATA_CHECKSUM_BEFORE`, `BUSINESS_DATA_CHECKSUM_AFTER`,
  `BUSINESS_DATA_CHECKSUM_MATCH`, `SCHEMA_CHECKSUM_BEFORE`,
  `SCHEMA_CHECKSUM_AFTER`, `EXPECTED_SCHEMA_DELTA_MATCH`,
  `LEARNING_SITE_NULL_COUNT`, `LEARNING_SITE_NON_NULL_COUNT` and
  `INVALID_LEARNING_SITE_COUNT`.
- The business checksum uses only explicit columns that existed before the
  migration and excludes `learning_site`, column order, catalog OIDs and
  timestamps. Adding the reviewed nullable column therefore is not a business
  mutation. Any change to an allowlisted existing business column or row count
  remains a stop condition.
- The schema checksum is evaluated separately. The only accepted delta is the
  nullable TEXT column, allowlist constraint, three reviewed indexes and column
  comment. `LEARNING_SITE_NON_NULL_COUNT` and
  `INVALID_LEARNING_SITE_COUNT` must both be zero; unexpected explicit values
  remain an immediate stop condition.
- Owner checkpoint: review catalog/count result before deployment.
- Rollback trigger: lock/statement timeout, duration over 30s, invalid/missing
  object, allowlisted business checksum/count mismatch, unexpected schema delta
  or unexpected non-NULL row.
- Evidence: migration duration, all named checksum/invariant outputs and the
  exact pre/post schema-delta comparison.

## P3 — Deploy with flags off

- Precondition: P2 passed and rollback artifacts recorded.
- Action: deploy/promote the exact LMS and both Commerce implementation
  artifacts while leaving both flags false. Do not enable the selector.
- Verification: B05 auth/session/course/lesson/media/enrollment smoke and both
  storefront/admin legacy flows behave as before; feature field absence cannot
  cause 500.
- Owner checkpoint: approve flags-off health.
- Rollback trigger: any legacy regression, 500 increase or deployment identity
  mismatch.
- Evidence: deployment IDs, alias snapshot and read-only smoke log.

## P4 — LMS admin canary

- Precondition: P3 stable at least 15 minutes and approved admin canary named.
- Action: enable only `LMS_ADMIN_MULTI_SITE_ENABLED`; if a canary allowlist
  control exists, restrict to the approved admin.
- Verification: selector mapping, both course lists, deep links, legacy badge,
  global badges and read-only forged-site/IDOR rejection. Do not create a real
  course.
- Owner checkpoint: approve controlled write canary.
- Rollback trigger: wrong mapping/list, alias shown as empty LMS course,
  cross-site read, unexplained 401/403/409 or any 500.
- Evidence: sanitized screenshots, request IDs and error-code counts.

## P5 — Controlled write canary

- Precondition: explicit owner approval naming logical site, synthetic/canary
  slug and cleanup/archive contract.
- Action: create one approved self-target canary course, verify persisted
  `learning_site`, create one canary lesson; Drive remains dry-run or unused.
- Verification: read-after-write course/lesson identity and site, opposite-site
  GET/write rejection, no order/enrollment/Drive side effect.
- Owner checkpoint: approve Commerce canary.
- Rollback trigger: mismatched site/target, cross-site visibility/write or any
  unintended external side effect.
- Evidence: hashed row IDs, slug/site, persisted fields and rejection codes.

## P6 — Commerce canary

- Precondition: P5 passed and storefront mapping re-confirmed.
- Action: enable `COMMERCE_LMS_SITE_ISOLATION_ENABLED`; inspect target dropdown
  for both domain labels. Do not approve a real order.
- Verification: same-site targets only, forged target returns
  `CROSS_SITE_LMS_TARGET_FORBIDDEN`, duplicate slug returns
  `COURSE_SLUG_CONFLICT`, self-target/deep link use the verified logical site,
  unrelated edit preserves target/site.
- Owner checkpoint: approve observation window.
- Rollback trigger: wrong dropdown/owner/deep link, mapping mutation or external
  sync outside contract.
- Evidence: sanitized UI/API responses and audit event IDs.

## P7 — Full enable

- Precondition: at least 60 minutes after P6 with zero cross-site leak/mutation,
  zero unresolved owner, zero 500 attributable to multisite, and no error rate
  above monitoring thresholds.
- Action: retain both flags enabled for approved admins/workflows.
- Verification: compare 60-minute and 24-hour windows to baseline; review all
  multisite error codes and course writes.
- Owner checkpoint: formally close canary or extend observation.
- Rollback trigger: any stop condition in the monitoring/rollback plans.
- Evidence: metric snapshot at 15m, 60m and 24h.
