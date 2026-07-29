# Production Read-Only Preflight

Date: 2026-07-29

No PII was selected and no SQL mutation, migration or Production environment
change was performed.

## Current evidence

- Production Supabase ref: `aqozjkfwzmyfunqvcyjv`.
- REST OpenAPI schema SHA-256:
  `15d368bfdb9d5dab4a26d53220fcb4599e7a3f129984799402283dae90216b7a`.
- Counts: courses 9, orders 30, student_enrollments 22, lessons 39,
  site_config 79.
- `courses.learning_site` is absent before migration.
- Course mapping: 9 deterministic, 0 unresolved, 0 duplicate slug.
- Known legacy alias: one, read-only and deterministic.

The current authorized REST interface does not expose `pg_extension` or live
`pg_catalog` index rows. The last full read-only public-schema snapshot confirms
`courses_slug_key UNIQUE(slug)`,
`student_enrollments_email_course_slug_key UNIQUE(email,course_slug)` and
`idx_courses_slug`; the current OpenAPI contract and counts remain compatible.
The multisite migration has no extension dependency and changes no extension.

Gate P1 therefore requires a fresh schema-only backup and extension/index/
constraint inventory before any authorized migration. Any difference from the
reviewed contract is a mandatory stop; this readiness work does not bypass P1.

## Production deployment/domain snapshot

| Domain/component | Project/deployment | Status |
|---|---|---|
| `www.daubepnho.store` | LMS / `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | Production Ready |
| `yeubep.shop` | Commerce main / `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ` | Production Ready |
| `shop.yeunauan.live` | Commerce second / `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka` | Production Ready |

Logical mapping remains `yeubep.shop→yeunauan` and
`shop.yeunauan.live→yeubep`.

## Production env names

Values were not read. The two multisite flag names are absent in Production and
therefore default false. Existing LMS env-name metadata covers timing/V2/system/
account-event controls; Commerce covers tenant/data-mode/public URL/system and
server-only Supabase/Google/Cloudinary/admin controls.
