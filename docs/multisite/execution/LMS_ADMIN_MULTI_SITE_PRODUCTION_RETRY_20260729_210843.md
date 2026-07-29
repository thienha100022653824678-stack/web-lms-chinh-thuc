# LMS Admin Multi-Site — Production Retry Execution

## Final status

**ROLLED BACK / STOPPED AT P3**

- Approval: `OWNER-APPROVAL-20260729-LMS-MULTISITE-02`
- Superseded approval: `OWNER-APPROVAL-20260729-LMS-MULTISITE-01` (not reused)
- Operator: Codex in the owner-authorized deployment environment
- Timezone: Asia/Ho_Chi_Minh
- Actual start: `2026-07-29T21:08:43.597+07:00`
- Stop condition observed: `2026-07-29T21:28+07:00`
- Final-state verification: `2026-07-29T21:30:18.4726134+07:00`
- P4, P5, P6, and P7 were not started.

No secret, token, cookie, raw email, customer record, or payment data is
included in this record.

## Gate timeline

| Gate | Timestamp (Asia/Ho_Chi_Minh) | Result | Evidence |
|---|---:|---|---|
| P0 — Fresh identity | 2026-07-29 21:08–21:10 | PASS | Exact commits, migration hashes, projects, deployments, domains, absent flags, Production ref, counts, mapping, and audit severity matched the approved manifest. |
| P1 — Fresh backup | 2026-07-29 21:10–21:12 | PASS | New encrypted backup was created outside Git and decrypt/readability was verified. |
| P2 — Additive migration | 2026-07-29 21:14:49 | PASS | Corrected verifier separated explicit business data checksum, schema delta, and new-column invariant. |
| P3 — Exact runtime deploy, flags off | 2026-07-29 21:15–21:29 | **STOP / ROLLBACK** | LMS deployed successfully; Commerce main returned `Not authorized`. The concurrently submitted second Commerce project reached READY. Both changed Production artifacts were rolled back immediately. |
| P4 — LMS multi-site enable | — | NOT STARTED | Stop condition at P3. |
| P5 — Controlled canary | — | NOT STARTED | No canary course was created. |
| P6 — Commerce isolation enable | — | NOT STARTED | Commerce flag remained absent. |
| P7 — Observation | — | NOT STARTED | No enabled multi-site observation window began. |

## P0 — identity and baseline

Approved identities were verified:

- Corrective verifier commit:
  `589fdcbdce6186acafcf9cfc3dca907e930a3763`
- Readiness documentation commit:
  `29dc97c849b07f09c8f1b099a84db93d888bddae`
- LMS runtime:
  `94e956f46d879b4bddec66f474fef52eff9d0da7`
- Commerce runtime:
  `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9`
- Production Supabase ref: `aqozjkfwzmyfunqvcyjv`

Fresh read-only Production baseline:

| Object | Count |
|---|---:|
| courses | 9 |
| orders | 30 |
| student_enrollments | 22 |
| lessons | 39 |
| lesson_progress | 0 |
| site_config | 79 |

- unresolved mappings: 0
- duplicate course slugs: 0
- required backfill: 0
- `courses.learning_site` before P2: absent
- LMS audit: 4 moderate, 0 high, 0 critical
- Commerce audit: 0 high, 0 critical
- Both Production multi-site feature flags: absent

The verified mapping remained:

- `yeubep.shop` → `yeunauan`
- `shop.yeunauan.live` → `yeubep`
- legacy alias remained
  `thitxiennuongchaungoc-yeubep` →
  `thitxiennuongchaungoc`

## P1 — fresh backup

The backup contains schema/catalog inventory and retained-table exports. It is
encrypted and stored outside Git. Only sanitized metadata is recorded here.

| Item | Value |
|---|---|
| Encrypted backup filename | `lms-production-backup-20260729-211015.zip.aes` |
| Encrypted backup SHA-256 | `c797fd6ead5ab31509aae92895708692840aaadb2f115317d4e9db2f9931b985` |
| Protected key filename | `lms-production-backup-20260729-211015.key.dpapi` |
| Protected key SHA-256 | `8781265a0dd726a101519aa132dd2bb2f20107d1020264b43ad273cd67019954` |
| Encryption | AES-256; key protected by Windows DPAPI CurrentUser |
| Decrypt/readability check | PASS |
| Schema catalog SHA-256 | `a55182e78412442df69c173d7a49d5bd0a767ad51f19c6adb854ebc36085b52b` |
| Schema SQL SHA-256 | `e27086e4fc08ac33f48524d0586954023a307aa3461343b831209f3302f9c0af` |
| Retained data export SHA-256 | `6a8cead243be79e1e73104d07366b94077dea54f1be7ad64d2efb1dbd551d22c` |
| Plaintext retained | No |

The inventory included extensions, tables, columns, constraints, indexes,
functions, RLS/policies, grants, env-variable names, domains, aliases, current
deployment IDs, and migration hashes. Values of environment variables were not
captured in this report.

## P2 — corrected migration verification

- Forward migration:
  `migrations/20260729_lms_learning_site.sql`
- Forward SHA-256:
  `81dc0a2869831e8b727b26e0056f7de256c94283870b45355c074e16c6a95071`
- Rollback migration:
  `migrations/20260729_lms_learning_site_rollback.sql`
- Rollback SHA-256:
  `b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c`
- `lock_timeout`: 5 seconds
- `statement_timeout`: 30 seconds
- Measured migration duration: **548.747 ms**
- Backfill: none

Corrected verifier output:

| Verification | Value |
|---|---|
| `BUSINESS_DATA_CHECKSUM_BEFORE` | `3514d2140a3051e95757cc653c22025bd18ac7a0d4a14ec3cb0b4b5f5e130514` |
| `BUSINESS_DATA_CHECKSUM_AFTER` | `3514d2140a3051e95757cc653c22025bd18ac7a0d4a14ec3cb0b4b5f5e130514` |
| `BUSINESS_DATA_CHECKSUM_MATCH` | true |
| `SCHEMA_CHECKSUM_BEFORE` | `94d1fda7cf7234d14da14ebc7e42719540b7b90d5208d43e7f8be55585baca31` |
| `SCHEMA_CHECKSUM_AFTER` | `e5b8b34c1a2d06b08ba1cc800c0d34b33c7e1a01cff730b19becaaf891b0ccb0` |
| normalized baseline schema checksum after removing approved delta | `94d1fda7cf7234d14da14ebc7e42719540b7b90d5208d43e7f8be55585baca31` |
| `EXPECTED_SCHEMA_DELTA_MATCH` | true |
| `LEARNING_SITE_NULL_COUNT` | 9 |
| `LEARNING_SITE_NON_NULL_COUNT` | 0 |
| `INVALID_LEARNING_SITE_COUNT` | 0 |
| V5 checksum before/after | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` / same |

Additional results:

- row counts unchanged;
- global `courses.slug` uniqueness preserved;
- enrollment identity `(email, course_slug)` preserved;
- duplicate slugs: 0;
- duplicate enrollment identities: 0;
- no business-row mutation;
- no unexpected schema delta;
- no non-NULL `learning_site`;
- no invalid `learning_site`.

The additive schema was left in place after the P3 code rollback. This follows
the approved rollback order: the old artifacts are compatible with the
nullable column, all nine values remain NULL, and schema rollback was not
needed. No business row was deleted, restored, or rewritten.

## P3 — deployment attempt and stop condition

### LMS

Exact runtime source was checked out detached and deployed:

- source SHA:
  `94e956f46d879b4bddec66f474fef52eff9d0da7`
- attempted Production deployment:
  `dpl_EPZJ5M6MYD4XVerfZw4ZBfnpZ8ik`
- result: READY and briefly aliased to `www.daubepnho.store`
- rollback action: successful
- final Production deployment:
  `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`

### Commerce main (`yeubep.shop`)

- exact source SHA:
  `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9`
- attempted deployment:
  `dpl_8UpepKzVzccWSGpLrygf27bpnHsR`
- result: Vercel returned `Not authorized`
- Production alias did not move
- final Production deployment:
  `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ`

### Commerce second (`shop.yeunauan.live`)

The concurrently submitted deployment reached READY even though the combined
job terminated on the main-project authorization error:

- exact source SHA:
  `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9`
- transient Production deployment:
  `dpl_CBrtvhp69TYTJVP7oC9E4GxAjkGY`
- rollback action: successful
- final Production deployment:
  `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`

This mixed deployment outcome was treated as a P3 stop condition. No attempt
was made to repair Production authorization and continue under the same
approval.

## Feature flag transitions

Neither feature flag was created or enabled during the execution:

| Project | Flag | Final state |
|---|---|---|
| LMS | `LMS_ADMIN_MULTI_SITE_ENABLED` | absent / false |
| Commerce main | `COMMERCE_LMS_SITE_ISOLATION_ENABLED` | absent / false |
| Commerce second | `COMMERCE_LMS_SITE_ISOLATION_ENABLED` | absent / false |

## Final verification

Final domain inspection:

| Domain | Final deployment | Target | Status |
|---|---|---|---|
| `www.daubepnho.store` | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | Production | READY |
| `yeubep.shop` | `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ` | Production | READY |
| `shop.yeunauan.live` | `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka` | Production | READY |

Unauthenticated legacy HTTP smoke after rollback:

| URL | HTTP |
|---|---:|
| `https://www.daubepnho.store/lms-admin.html` | 200 |
| `https://www.daubepnho.store/lms.html` | 200 |
| `https://www.daubepnho.store/lesson.html` | 200 |
| `https://yeubep.shop/` | 200 |
| `https://yeubep.shop/admin.html` | 200 |
| `https://shop.yeunauan.live/` | 200 |
| `https://shop.yeunauan.live/admin.html` | 200 |

No canary course, section, lesson, order, enrollment, progress, Drive
permission, email, payment, Portal mutation, domain change, tenant mapping
change, or legacy mapping rewrite was performed.

## Monitoring and review

- Enabled-feature monitoring window: not started.
- 24-hour enabled review: not assigned because multi-site was not enabled.
- Incident/stop reason: Commerce main Production deployment authorization
  failure during P3.
- Required next action: owner must resolve or explicitly authorize resolution
  of the Commerce main Vercel deployment permission mismatch and issue a new
  Production approval. The present approval is consumed and must not be reused.

