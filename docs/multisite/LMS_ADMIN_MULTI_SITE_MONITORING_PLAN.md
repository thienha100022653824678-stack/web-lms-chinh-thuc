# LMS Admin Multi-Site — Monitoring Plan

No monitoring dimension may include email, customer data, payment data, token,
request body or secret. Use timestamp, deployment, route, status, logical site,
course slug where approved, action and error code.

Owner roles:

- release operator: deployment/migration/flag metrics;
- LMS owner: course/lesson/enrollment/progress/Drive metrics;
- Commerce owner: creation/target/deep-link metrics;
- incident owner: stop/rollback decision.

| Signal | Baseline | Warning | Rollback/stop threshold | Window |
|---|---:|---:|---:|---|
| `INVALID_LEARNING_SITE` | 0 expected admin writes | >2 | >5 or any valid UI request | 15m |
| `COURSE_SITE_MISMATCH` | security probes only | >3 non-probe | any confirmed normal-flow mismatch | 15m |
| `CROSS_SITE_LMS_TARGET_FORBIDDEN` | probes only | >3 non-probe | any UI-generated same-flow request | 15m |
| `UNRESOLVED_LEARNING_SITE` | 0 | 1 | 1 | immediate |
| `LEGACY_SHARED_MAPPING_READ_ONLY` | known alias edits only | >2 unrelated edits | any quick toggle changes target | 15m |
| `COURSE_NOT_FOUND_IN_SITE` | 0 normal flow | >3 | >5 or deep-link systematic failure | 15m |
| HTTP 401/403 | existing auth baseline | +25% | +100% with valid admins | 15m |
| HTTP 409 | probes/validation only | >5 non-probe | repeated valid-flow 409 | 15m |
| HTTP 500 | current baseline | 2 attributable | 3 attributable or >1% | 5m |
| DB lock wait | 0 | >2s | 5s timeout | migration |
| Migration duration | 112ms rehearsal | >5s | 30s or timeout | migration |
| Course create/update failure | 0 | 1 | 2 or any wrong-site persist | 15m |
| Lesson write failure | 0 | 2 | wrong-site write or >5% | 15m |
| Enrollment/revoke failure | 0 | 1 | cross-site effect or >2 | immediate/15m |
| Drive error | dry-run baseline 0 | 1 | wrong course/permission action | immediate |
| Unexpected alias use | 0 | 1 | alias mutated/lesson created | immediate |
| Selector/deep-link failure | 0 | >2 | wrong site/course or >5% | 15m |

Observation checkpoints: pre-change baseline, migration completion, 15 minutes,
60 minutes and 24 hours. P7 requires zero cross-site leak/mutation, zero
unresolved site and zero attributable 500 during the first 60 minutes.

Immediate stop conditions:

- any cross-site read leak or mutation;
- wrong-site enrollment revoke, lesson/media or Drive action;
- unresolved owner;
- mapping reversal between domain label and logical site;
- count/checksum change caused by the additive migration;
- high/critical security finding introduced after the reviewed SHA.
