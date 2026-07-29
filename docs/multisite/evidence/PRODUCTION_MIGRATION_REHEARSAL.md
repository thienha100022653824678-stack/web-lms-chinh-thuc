# Production Migration Rehearsal

Date: 2026-07-29  
Target: sanitized B05-compatible schema on Supabase Preview
`plgrmaktvudjetfkwmyg`; Production was not connected or mutated.

## Exact artifacts

- Forward: `migrations/20260729_lms_learning_site.sql`
- Forward SHA-256:
  `81dc0a2869831e8b727b26e0056f7de256c94283870b45355c074e16c6a95071`
- Rollback: `migrations/20260729_lms_learning_site_rollback.sql`
- Rollback SHA-256:
  `b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c`

## Procedure and result

1. Verified exact Preview ref and Production deny guard.
2. Loaded the guarded B05 substrate and deterministic synthetic mapping types.
3. Set `lock_timeout='5s'` and `statement_timeout='30s'`.
4. Snapshotted catalog, business counts, seed checksum and V5 checksum.
5. Applied the exact forward migration.
6. Applied it a second time to verify idempotency.
7. Verified nullable `TEXT`, allowlist check, all three indexes, global
   `UNIQUE(slug)` and enrollment `UNIQUE(email, course_slug)`.
8. Rolled back without cascade and verified substrate removal/V5 invariants.
9. Reapplied and reseeded; final checksums matched.

| Operation | Duration |
|---|---:|
| Forward migration | 112.133 ms |
| Second/idempotent forward apply | 111.933 ms |
| Rollback | 125.490 ms |
| Reapply | 114.681 ms |

No lock timeout or statement timeout occurred. The migration is additive and
transactional. The second apply produced an identical contract.

## Checksums and invariants

- V5 checksum before/after:
  `27030333fee663b3129b8c83b4624743b07c32ea7ba58f85449e2e47e90ffb80`
- Seed checksum:
  `c636aba9715faad3e1fd5fe4185fd38160468ab70d5670c1acd5235a62f7734c`
- Final catalog checksum:
  `50cddb1d764770f169b3e3ecde1a13d9fb62269865f8e8b5ac74ca27253b4ec2`
- Rollback catalog checksum:
  `f0759dcde8464f1ba1637c21d73070db59c765e8fae9aab7b3eb483b4c9da797`

Course, order, lesson, progress and enrollment fixture rows were preserved
semantically. No Production data was used as fixture and no whole-database
restore was performed.
