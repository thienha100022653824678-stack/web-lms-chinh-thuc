# Incident LMS-MULTISITE-P2-CHECKSUM-20260729-01

## Status

Corrective verification implemented and rehearsed. Production retry is not
authorized by this document.

- Previous approval:
  `OWNER-APPROVAL-20260729-LMS-MULTISITE-01`
- Previous approval status: invalidated when execution stopped at P2
- Gate stopped: P2 — additive migration verification
- Production code deployment: not started
- Feature flags: absent/false
- Canary: not created

The immutable execution record remains
`docs/multisite/execution/LMS_ADMIN_MULTI_SITE_PRODUCTION_EXECUTION_20260729_165951.md`.
It was not edited during incident correction.

## Timeline

| Time (+07) | Event |
|---|---|
| 2026-07-29 16:59:51 | Authorized execution began |
| 2026-07-29 17:07:13 | P1 encrypted backup completed and verified |
| 2026-07-29 17:13 | Exact forward migration applied; P2 checksum mismatch raised |
| 2026-07-29 17:13 | Exact rollback migration executed automatically |
| 2026-07-29 17:14:39 | Read-only rollback verification passed |
| 2026-07-29 17:15 | Execution stopped; P3–P7 not started |
| 2026-07-29 19:40 | Corrective explicit-column Production read-only checksum captured |

## Root cause proven

The failed harness constructed the pre/post invariant with whole-row
`to_jsonb(courses)`. Production's pre-migration `courses` schema has 22 columns,
ending with `learning_course_slug`. The reviewed migration adds column 23,
`learning_site`.

PostgreSQL whole-row JSON is schema-shaped:

- before: the serialized row has the 22 pre-existing keys;
- after: it has the same keys plus `"learning_site": null`.

Consequently the old checksum changed even when no pre-existing business value
changed. This was a verification-design defect, not evidence of a business-data
mutation.

The conclusion is supported by:

1. Fresh read-only `information_schema.columns` evidence showing the exact
   22-column Production baseline after rollback.
2. The encrypted P1 pre-migration export and current post-rollback Production
   data produce the same new explicit-column SHA-256:
   `81ccfa80cf3161d63e62834e2b4dfe84084cacdae92cb401e48f0a464e0e3fc2`.
3. Both snapshots have identical counts: 9 courses, 39 lessons, 22 enrollments,
   0 progress rows and 79 config rows.
4. All 72 explicit allowlisted field checksums match between the P1 backup and
   the post-rollback Production snapshot; field mismatches: zero. This includes
   course ID, slug, all title/content/config fields, `sales_site`,
   `learning_course_slug`, active/published/sort state and `raw_data`.
5. Real PostgreSQL rehearsal adds `learning_site`, keeps every explicit
   pre-existing business-column checksum unchanged, and changes only the
   expected schema contract.

No PII value was emitted during checksum comparison.

## Corrective design

Verification is now split into three independent contracts.

### Business data

`scripts/lib/multisite-business-checksum.mjs` contains explicit allowlists for
courses, lessons, student enrollments, lesson progress and site config.

For `courses`, it covers the stable pre-existing fields including ID, slug,
title/content/config, sales site, canonical learning target, active/published/
sort fields and `raw_data`. It deliberately excludes:

- `learning_site`;
- `created_at` and `updated_at`;
- column order;
- catalog OIDs and physical metadata.

Rows are ordered by the explicit primary key, JSON object keys are sorted,
NULL is canonicalized to JSON null, UTF-8 is fixed and SHA-256 is used.

### Schema

Schema verification independently requires exactly:

- nullable `courses.learning_site TEXT`;
- `courses_learning_site_check`;
- three reviewed indexes;
- reviewed column comment.

Removing the expected objects from the post-migration snapshot must reproduce
the pre-migration schema snapshot. Column ordinal and catalog OID are excluded.

### New column

After migration:

- every existing course must have `learning_site IS NULL`;
- non-NULL count must be zero;
- invalid count must be zero.

## Preventive negative controls

The corrective suite proves:

| Control | Expected detection | Result |
|---|---|---|
| Add nullable `learning_site` | Business checksum unchanged | PASS |
| Change title | Business checksum changes | PASS |
| Change slug | Checksum changes | PASS |
| Create slug collision | Unique invariant rejects | PASS |
| Change sales site | Checksum changes | PASS |
| Change learning target | Checksum and resolver invariant fail | PASS |
| Add/delete row | Count and checksum change | PASS |
| Reverse query column order | Checksum unchanged | PASS |
| `learning_site=NULL` | Not a business mutation | PASS |
| Unexpected explicit learning site | New-column invariant fails | PASS |
| Change `raw_data` value | Checksum changes | PASS |

## Rehearsal evidence

Supabase Preview ref: `plgrmaktvudjetfkwmyg`.

Stable real-PostgreSQL result:

- business checksum before/after:
  `4b0efb8ccc038cf78b66e9ec0ca7ec4028ed8df2dec2db7ca18daf54b3cf92fe`
  in both snapshots;
- schema checksum before:
  `fce90b3ddf60753d7f545c9917737728b50ec4166dc634190e83448431d6ad42`;
- schema checksum after:
  `fc808a86506c250c86860f44699451269d76f0988b1f73cd6d168e376b69ca31`;
- expected schema delta: PASS;
- existing Preview courses NULL/non-NULL/invalid: 6/0/0;
- rollback restores baseline schema and business checksum: PASS;
- reapply deterministic: PASS;
- second apply idempotent: PASS;
- global slug uniqueness and enrollment identity preserved: PASS;
- V5 checksum before/after:
  `27030333fee663b3129b8c83b4624743b07c32ea7ba58f85449e2e47e90ffb80`;
- lock/statement timeouts: 5s/30s;
- representative durations: forward 117.046 ms, second apply 113.926 ms,
  rollback 114.369 ms, reapply 116.150 ms.

During corrective rehearsal, two additional test-harness defects were found and
fixed before the final evidence:

- schema checksum included `ordinal_position`, which changes after drop/re-add;
- synthetic enrollment seed relied on a random UUID default, preventing
  cross-run fixture reproducibility.

Neither issue affected Production.

## Production rollback evidence

Production remains at the pre-migration baseline:

- `courses.learning_site` absent;
- courses/orders/enrollments/lessons/config: 9/30/22/39/79;
- unresolved mappings: 0;
- duplicate slug: 0;
- deployments unchanged:
  `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`,
  `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ`,
  `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`;
- both feature flags absent/false.

No Production migration, deployment, feature enablement or data mutation was
performed during incident correction.

## Conditions before retry

A Production retry requires all of the following:

1. Corrective commit reviewed and pushed without merge.
2. Full LMS and Commerce regression gates pass.
3. Forward/rollback migration hashes remain unchanged.
4. New P1 backup and independent business/schema baselines.
5. New owner approval ID and execution window.
6. The previous approval must not be reused.
