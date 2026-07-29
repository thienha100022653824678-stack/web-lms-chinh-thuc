# LMS Admin Multi-Site — Production Retry Readiness

## Decision

`READY FOR NEW OWNER APPROVAL`

This status is readiness only. It does not authorize a Production migration,
deployment, feature flag, canary or continuation of P0–P7.

- Incident: `LMS-MULTISITE-P2-CHECKSUM-20260729-01`
- Invalidated approval:
  `OWNER-APPROVAL-20260729-LMS-MULTISITE-01`
- Corrective commit:
  `589fdcbdce6186acafcf9cfc3dca907e930a3763`
- Corrective branch:
  `feature/lms-admin-multisite-isolation-20260729`

## Root cause and correction

The previous harness hashed whole `courses` rows using `to_jsonb(table)`.
Adding nullable `learning_site` changed the serialized row shape by adding a
NULL key, causing a false business-data mismatch.

The replacement has three independent gates:

1. SHA-256 over explicit pre-existing business-column allowlists.
2. A separate expected schema-delta checksum/contract.
3. A separate NULL/non-NULL/invalid invariant for `learning_site`.

Whole-row JSON, `SELECT *`, column order, catalog OIDs and volatile timestamps
are excluded from the business checksum.

## Production rollback proof

Production was queried read-only during correction.

- `courses.learning_site`: absent.
- Counts: courses 9; orders 30; enrollments 22; lessons 39; config 79.
- Unresolved mapping: 0.
- Duplicate slug: 0.
- Feature flags: absent/false.
- Production deployments remain:
  - LMS `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`;
  - yeubep.shop `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ`;
  - shop.yeunauan.live `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`.

The P1 pre-migration encrypted export and current post-rollback Production
snapshot have:

- identical explicit business SHA-256:
  `81ccfa80cf3161d63e62834e2b4dfe84084cacdae92cb401e48f0a464e0e3fc2`;
- 72 explicit field checks compared;
- field mismatches: 0;
- identical retained-table counts.

No PII value was written to evidence.

## Corrective test and rehearsal evidence

### Local controls

- Checksum/canonicalization controls: 12/12.
- Title, slug, sales site, learning target and `raw_data` mutations change the
  business checksum.
- Add/delete changes checksum and count.
- Slug collision is rejected.
- Query column order and a nullable new column do not change the checksum.
- Unexpected non-NULL `learning_site` fails its independent invariant.
- Verification SQL source test rejects executable whole-row/`SELECT *`
  checksum patterns.

### Sanitized PostgreSQL / Supabase Preview

- Preview ref: `plgrmaktvudjetfkwmyg`.
- Production ref mutation guard:
  `aqozjkfwzmyfunqvcyjv`.
- Only synthetic `.example.test` fixture identities were used.

| Output | Result |
|---|---|
| BUSINESS_DATA_CHECKSUM_BEFORE | `4b0efb8ccc038cf78b66e9ec0ca7ec4028ed8df2dec2db7ca18daf54b3cf92fe` |
| BUSINESS_DATA_CHECKSUM_AFTER | `4b0efb8ccc038cf78b66e9ec0ca7ec4028ed8df2dec2db7ca18daf54b3cf92fe` |
| BUSINESS_DATA_CHECKSUM_MATCH | true |
| SCHEMA_CHECKSUM_BEFORE | `fce90b3ddf60753d7f545c9917737728b50ec4166dc634190e83448431d6ad42` |
| SCHEMA_CHECKSUM_AFTER | `fc808a86506c250c86860f44699451269d76f0988b1f73cd6d168e376b69ca31` |
| EXPECTED_SCHEMA_DELTA_MATCH | true |
| LEARNING_SITE_NULL_COUNT | 6 |
| LEARNING_SITE_NON_NULL_COUNT | 0 |
| INVALID_LEARNING_SITE_COUNT | 0 |
| V5 checksum before/after | `27030333fee663b3129b8c83b4624743b07c32ea7ba58f85449e2e47e90ffb80` |

- Forward, rollback, reapply and second/idempotent apply: PASS.
- Baseline schema restored after rollback: PASS.
- Business rows/checksum preserved after rollback: PASS.
- Reapply schema checksum deterministic: PASS.
- Eight PostgreSQL negative mutation controls: PASS.
- Global slug uniqueness: preserved.
- Enrollment `(email, course_slug)` identity: preserved.
- Unresolved mapping and duplicate slug: zero.
- Timeouts: lock 5s, statement 30s.
- Representative durations: forward 117.046 ms; second apply 113.926 ms;
  rollback 114.369 ms; reapply 116.150 ms.

Two consecutive final Preview passes reproduced the same business, schema and
V5 checksums after the synthetic seed was made deterministic.

## Regression

| Gate | Result |
|---|---|
| LMS | 329/329 |
| Commerce | 73/73 |
| New checksum controls | 12/12 |
| Preview PostgreSQL negative controls | 8/8 |
| Syntax | PASS |
| CSS build | PASS |
| Protected runtime diff from incident evidence commit | empty |
| Secret scan | PASS |
| `git diff --check` | PASS |
| LMS dependency audit | 4 moderate, 0 high, 0 critical |
| Commerce dependency audit | 0 |

No dependency upgrade or automatic breaking audit fix was performed.

## Migration identity

The Production forward and rollback migrations were not edited.

- Forward:
  `migrations/20260729_lms_learning_site.sql`
- SHA-256:
  `81dc0a2869831e8b727b26e0056f7de256c94283870b45355c074e16c6a95071`
- Rollback:
  `migrations/20260729_lms_learning_site_rollback.sql`
- SHA-256:
  `b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c`

The corrective diff is classified as:

| Class | Files |
|---|---|
| Runtime Product/API/UI | none |
| Production migration | none |
| Verification | checksum library, read-only verifier and verification SQL |
| Preview rehearsal | guarded runner and deterministic substrate/seed |
| Tests | checksum/negative-control suite |
| Documentation | incident, runbook, manifest and rehearsal evidence |

## Retry conditions

The next Production attempt requires:

1. A new owner approval ID; the old ID cannot be reused.
2. A new execution window and operators.
3. Fresh P0 identity verification.
4. Fresh encrypted P1 backup.
5. Both `BUSINESS_DATA_CHECKSUM_BEFORE` and
   `SCHEMA_CHECKSUM_BEFORE` captured before mutation.
6. Exact corrective commit and unchanged migration hashes reviewed.

No Production migration, deployment, flag enablement, canary, merge, alias,
domain or legacy-data change was performed while resolving this incident.
