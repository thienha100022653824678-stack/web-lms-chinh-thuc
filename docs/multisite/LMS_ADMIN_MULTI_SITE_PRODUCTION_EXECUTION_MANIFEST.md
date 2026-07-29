STATUS: NOT AUTHORIZED FOR EXECUTION

# LMS Admin Multi-Site — Production Execution Manifest

Owner approval ID/time: `________________`

Execution window: `________________`
Operators: `________________`

The previous approval `OWNER-APPROVAL-20260729-LMS-MULTISITE-01` is invalid
after incident `LMS-MULTISITE-P2-CHECKSUM-20260729-01`. A new owner approval ID
is mandatory. This template cannot inherit or reuse the previous authorization.

## Exact source and projects

| Component | Full SHA | Vercel project |
|---|---|---|
| LMS | `94e956f46d879b4bddec66f474fef52eff9d0da7` | `prj_TimQqrVhrOLW8y1KI464JBvajwlz` |
| Commerce main | `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` |
| Commerce second storefront | same approved Commerce source | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` |

Implementation Preview artifacts:

- LMS `dpl_BWuhKjmBpbSbATbZTfSKZrRrHjX6`.
- Commerce `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb`.

Current Production/rollback artifacts:

- LMS `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.
- Commerce main `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ`.
- Commerce second storefront `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`.

## Database artifacts

- Target ref: `aqozjkfwzmyfunqvcyjv`.
- Forward:
  `migrations/20260729_lms_learning_site.sql`,
  SHA-256 `81dc0a2869831e8b727b26e0056f7de256c94283870b45355c074e16c6a95071`.
- Rollback:
  `migrations/20260729_lms_learning_site_rollback.sql`,
  SHA-256 `b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c`.
- Verification:
  `docs/multisite/sql/PRODUCTION_VERIFICATION_READ_ONLY.sql`.

## Environment names

Initial values:

- `LMS_ADMIN_MULTI_SITE_ENABLED=false`
- `COMMERCE_LMS_SITE_ISOLATION_ENABLED=false`

Existing names are snapshotted by P1. No secret value belongs in this manifest.
`SALES_SITE` mapping remains `yeubep.shop→yeunauan` and
`shop.yeunauan.live→yeubep`.

## Ordered checklist

- [ ] P0 identity and owner authorization complete.
- [ ] P1 encrypted backup/count/env/domain snapshots plus independent
  `BUSINESS_DATA_CHECKSUM_BEFORE` and `SCHEMA_CHECKSUM_BEFORE` complete.
- [ ] P2 exact additive migration with flags false; explicit-column business
  checksum matches, expected schema delta matches, and new-column NULL invariant
  passes.
- [ ] P3 exact artifacts deployed with flags false; legacy smoke passed.
- [ ] P4 LMS admin canary and read-only IDOR passed.
- [ ] P5 owner-approved controlled write canary passed.
- [ ] P6 Commerce canary passed without real order approval.
- [ ] P7 60-minute quantitative observation passed.
- [ ] 24-hour review assigned.

## Backup checklist

- [ ] Schema-only backup encrypted and hash recorded.
- [ ] Relevant table exports retained outside Git.
- [ ] Counts/schema checksum recorded.
- [ ] No whole-row JSON/`SELECT *` checksum is present in the execution harness.
- [ ] Negative-control suite and corrective Preview rehearsal evidence attached.
- [ ] Vercel env-name and domain/alias snapshot recorded.
- [ ] Forward/rollback hashes reverified.
- [ ] Rollback deployment IDs reverified.

All commands/actions and stop rules are defined in
`LMS_ADMIN_MULTI_SITE_PRODUCTION_RUNBOOK.md`. This manifest cannot be executed
until the status is changed by a separate owner approval.
