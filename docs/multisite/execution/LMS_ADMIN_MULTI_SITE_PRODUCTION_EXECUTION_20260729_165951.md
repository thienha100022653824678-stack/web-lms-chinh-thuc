# LMS Admin Multi-Site — Production Execution Evidence

## Final status

`ROLLED BACK / STOPPED AT P2`

- Approval ID: `OWNER-APPROVAL-20260729-LMS-MULTISITE-01`
- Actual start: `2026-07-29T16:59:51.104+07:00`
- Actual stop/evidence close: `2026-07-29T17:15:30.382+07:00`
- Timezone: `Asia/Ho_Chi_Minh`
- Operator: Codex in the owner-authorized deployment environment
- Incident reference: `LMS-MULTISITE-P2-CHECKSUM-20260729-01`

No secret, token, cookie, raw email, order customer field or payment field is
included in this evidence.

## Gate timeline

| Gate | Timestamp (+07) | Result |
|---|---|---|
| P0 start | 2026-07-29 16:59:51.104 | Started |
| P0 complete | 2026-07-29 17:03 | Passed |
| P1 complete | 2026-07-29 17:07:13.797 | Passed |
| P2 apply/verification | 2026-07-29 17:13 | Failed verification; exact rollback executed |
| Rollback read-only verification | 2026-07-29 17:14:39.275 | Passed |
| Flag-state recheck complete | 2026-07-29 17:15:07.816 | Both flags absent/false |
| P3–P7 | Not started | Blocked by P2 stop condition |

The P0/P2 minute-level timestamps are the recorded Gate transition times. The
database operation harness did not persist a finer timestamp after its
fail-closed exception; this limitation is retained rather than reconstructed.

## P0 — Final identity

Result: PASS.

- LMS implementation:
  `94e956f46d879b4bddec66f474fef52eff9d0da7`
- Commerce implementation:
  `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9`
- Both implementation commits exist on their reviewed remote feature branches.
- No runtime or migration diff exists between the reviewed implementation and
  documentation heads.
- Forward SHA-256:
  `81dc0a2869831e8b727b26e0056f7de256c94283870b45355c074e16c6a95071`
- Rollback SHA-256:
  `b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c`
- Production Supabase ref:
  `aqozjkfwzmyfunqvcyjv`
- LMS rollback deployment:
  `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`
- Commerce rollback deployments:
  `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ` and
  `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`
- Domain mapping remained:
  `yeubep.shop → yeunauan`;
  `shop.yeunauan.live → yeubep`.
- Both Production feature flags were absent and therefore false.
- Fresh mapping result: 9 courses, zero unresolved, zero duplicate slug, zero
  required backfill.
- Dependency audit: LMS 4 moderate/0 high/0 critical; Commerce 0 findings.

## P1 — Backup manifest

Result: PASS.

- Captured:
  `2026-07-29T17:07:13.7977603+07:00`
- Storage: outside Git under the operator's protected Documents backup area.
- Encrypted filename:
  `lms-production-backup-20260729-170712.zip.aes`
- Encrypted backup SHA-256:
  `67b4ca1e1d9b84c9e0b42a3a15ecdcc8402b6eb10c5d062f24595dd584d4eac5`
- DPAPI-protected key filename:
  `lms-production-backup-20260729-170712.key.dpapi`
- Protected key SHA-256:
  `8f1ada3ebf0629382c6ad644cf5da8616719ecffbd1807e51b981eeb25588f55`
- Encryption: AES-256; key protected by Windows DPAPI CurrentUser.
- Decryption/readability verification: PASS.
- Plaintext retained: NO.
- Schema catalog SHA-256:
  `ba511f5b8a65a29d2c5e4cb88b501bf2132c26b8a9c228ed9b3aa38b33ebd938`
- Schema SQL SHA-256:
  `4e5be0e644f054d149531194640481469fd30f9a46a3dbc1e86d68d891b63910`
- Retained-table export SHA-256:
  `81c69e37621262008b44024a8be7bc84ef0ab70842aca2918cf9a91c4b0fea71`

Baseline:

| Table | Rows |
|---|---:|
| courses | 9 |
| orders | 30 |
| student_enrollments | 22 |
| lessons | 39 |
| lesson_progress | 0 |
| site_config | 79 |

The encrypted archive contains the fresh extension/table/column/constraint/index/
function/RLS/policy/grant catalog and the five approved retained-table exports.
The sanitized manifest contains no row data.

## P2 — Migration and rollback

Result: FAILED VERIFICATION, ROLLED BACK.

- Exact forward migration was submitted with:
  `lock_timeout='5s'` and `statement_timeout='30s'`.
- No backfill SQL was executed.
- Verification executed the reviewed read-only SQL plus structured catalog,
  count and checksum assertions.
- Error:
  `P2_VERIFICATION_FAILED:BUSINESS_ROW_CHECKSUM_CHANGED`.
- The harness immediately applied the exact reviewed rollback migration.
- Exact migration duration was not persisted before the fail-closed exception.
  The complete client command exited in approximately four seconds; no claim of
  a finer duration is made.

Root-cause assessment:

- The invariant used `to_jsonb(courses)` before and after the additive column.
- Adding `learning_site` changes each JSON row representation by adding
  `"learning_site": null`, even though zero business values were written.
- This makes that checksum unsuitable across an intentional schema delta.
- The owner instruction forbids correcting a mismatch and continuing in the same
  Production execution, so no retry was attempted.

Post-rollback read-only verification at
`2026-07-29T17:14:39.2758098+07:00`:

- `courses.learning_site` absent: PASS.
- OpenAPI/schema checksum restored to
  `15d368bfdb9d5dab4a26d53220fcb4599e7a3f129984799402283dae90216b7a`.
- Counts restored/unchanged: 9 courses, 30 orders, 22 enrollments, 39 lessons,
  79 config rows.
- Unresolved mapping: 0.
- Duplicate slug: 0.
- No canary course or lesson was created.

## Deployment, flags and Production state

P3–P7 were not started.

| Component | Production deployment after stop | Feature flag |
|---|---|---|
| LMS | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | absent/false |
| Commerce — yeubep.shop | `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ` | absent/false |
| Commerce — shop.yeunauan.live | `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka` | absent/false |

- New Production deployment IDs: none.
- Alias/domain change: none.
- Canary slug:
  `multisite-canary-20260729-yeunauan` was not created.
- Hashed canary row IDs: none.
- IDOR Production probes: not run because P4/P5 were not reached.
- Monitoring observation: not started because feature flags remained false.
- Rollback state: schema and flags restored to the pre-execution state; code
  deployments never changed.
- Legacy alias remains unchanged/read-only:
  `thitxiennuongchaungoc-yeubep → thitxiennuongchaungoc`.

## Next action

Owner must review incident `LMS-MULTISITE-P2-CHECKSUM-20260729-01` and issue a
new approval before any new Production attempt. A future rehearsal must compare
business columns excluding the intentionally added nullable column and must
persist the migration duration before verification.

24-hour review: not assigned because Production multi-site was not enabled.
