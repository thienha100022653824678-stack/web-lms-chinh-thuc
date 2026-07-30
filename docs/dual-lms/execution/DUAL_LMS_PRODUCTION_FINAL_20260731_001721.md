# Dual LMS Production Final Execution

## Final status

`ROLLED BACK / STOPPED AT P4`

- Approval: `OWNER-APPROVAL-20260731-DUAL-LMS-FINAL-04`
- Operator: Codex in the owner-authorized deployment environment
- Window start: `2026-07-31T00:17:21+07:00`
- Stop/rollback completed: `2026-07-31T00:49:00+07:00`
- No canary, order, enrollment, payment, Portal, Drive permission, domain
  ownership, legacy mapping, or customer-data mutation was performed.

## Exact identities

| Component | Approved runtime |
|---|---|
| LMS | `044519300131745bf0e99a98ff152dd2c8afcc92` |
| Commerce | `94ff084c6ce8fa9988d15432f15f2cdc410045e4` |
| Forward migration SHA-256 | `c522fa0a2636155607eb2f44b3057aab119875b19fa82279ad9183d2ee9d7499` |
| Rollback migration SHA-256 | `dd684100800520760afd62f4ee386c82dadcb075a3022a7c6c5223cb87bd2a6e` |
| Production Supabase | `aqozjkfwzmyfunqvcyjv` |

## Gate timeline

| Gate | Timestamp (+07:00) | Result |
|---|---:|---|
| P0 identity/env | 00:17–00:18 | PASS |
| P1 fresh backup | 00:18–00:19 | PASS |
| P2 additive migration | 00:22:49 | PASS |
| P3 exact code, flags off | 00:24–00:43 | PASS |
| P4 LMS enable/verification | 00:43–00:47 | STOP |
| Rollback | 00:47–00:49 | PASS |
| P5–P7 | — | NOT RUN |

## P0 — identity and environment

- Both exact runtime commits and both migration hashes matched.
- LMS and Commerce worktrees had no reviewed runtime/migration divergence.
- Required LMS Production environment-variable names existed. Secret values
  were not printed or recorded.
- `SUPABASE_URL` identity used the owner's attestation for
  `aqozjkfwzmyfunqvcyjv`.
- Both Dual LMS flags were initially absent/false.
- Baseline: courses `8`, orders `28`, enrollments `20`, lessons `39`,
  lesson progress `0`, site config `73`.
- Mapping dry-run: `8` rows, unresolved `0`, duplicate slug `0`.
- LMS dependency audit: four moderate, zero high/critical. Commerce: zero.

## P1 — fresh encrypted safety backups

All payload backups are outside Git under the owner account's Documents
backup area. Each encrypted payload was decrypted and parsed for readability.
Only sanitized metadata is recorded here.

| Backup | Encrypted file SHA-256 | Rows/evidence |
|---|---|---|
| Schema/catalog/core tables | `0e596c087147259378f5586ba53d37416d86215ac36a755e9935c4de353dc2ec` | courses 8, orders 28, enrollments 20, lessons 39, progress 0, site config 73 |
| Session/Drive admin | `b9b1e2645c3b09321a04d9564ca7f604c31d4604522dd0edb854342c57482bce` | active sessions 16, verified sessions 38, Drive admins 3, entry tokens 38 |
| Orders/Drive logs/queue | `c03c83080a241a7ee42d576ba168bb2792a336ee4f3aa0b153e58ca98a77310f` | orders 28, Drive logs 59, queue 9 |

Schema catalog checksum:
`4562f84e2d8c9a3bbc1b3ef935dac1b586528410b91739899eb5d5a33cd71926`.

## P2 — additive migration

- Duration: `499.178 ms`.
- Business checksum before:
  `960053a7e768432952a2d8db96be9a01b9ae08299e53b99cae231c0833eb18d1`.
- Business checksum after: identical.
- Schema checksum changed from
  `bdfc547f0fe4c409f0e72b7bb543d375b512b59a574e8d7c5295cdb6d2d73a55`
  to
  `416d0353451e9084f59ee32e0069f1e7f0fa2cbbce4536bdec71d628f10d6fbf`;
  the verifier confirmed only the reviewed delta.
- V5 checksum unchanged.
- Course tenant invariant: NULL `8`, non-NULL `0`, invalid `0`.
- Order tenant invariant: NULL `28`, non-NULL `0`, invalid `0`.
- Counts, global slug uniqueness, and enrollment identity were unchanged.
- No backfill occurred.

The additive schema remains installed after the application rollback because
the restored B05/Commerce code is compatible with nullable extra columns.
Schema rollback was therefore neither necessary nor safer.

## P3 — exact runtime with flags off

Temporary Production deployments built from Git archives of the exact
approved trees:

| Component | Temporary deployment | Result |
|---|---|---|
| LMS | `dpl_EL4Liwt49TrAH36QPcf7QhgUSK6p` | READY, flags off |
| Commerce shop.yeunauan.live | `dpl_AAnNz1qfwmLtDGwE49F9eNbpDjUR` | READY, flags off |
| Commerce yeubep.shop | `dpl_2fKdMsnFMMcNNYu15BoqYCLwrMR2` | READY, flags off |

Vercel initially blocked Commerce uploads carrying Git author metadata with
`TEAM_ACCESS_REQUIRED`. No commit was rewritten. The exact approved Git trees
were archived and uploaded directly; both resulting builds were READY.

Flags-off smoke:

- LMS homepage, `lms.html`, `lesson.html`, and `lms-admin.html`: HTTP 200.
- Both storefronts and both Commerce Admin pages: HTTP 200.
- Google client configuration was non-empty.
- Invalid admin session was rejected with HTTP 401, not HTTP 500.

## P4 stop condition

The LMS flag was enabled and exact runtime was redeployed as
`dpl_2Ve3a9EXudGkCyJN8yqTUfaMZJtj` (READY).

Mandatory authenticated verification could not be completed:

- a locally generated admin session using the existing local secret was
  rejected by Production with HTTP 401;
- Vercel Sensitive variables were present but downloaded as empty/redacted
  values, so no Production session could be generated read-only;
- the public Google OAuth client configuration endpoint remained healthy.

This does not prove an application regression, but it prevents proof of the
required admin login/session restore and all authenticated tenant/IDOR checks.
The execution contract prohibited skipping that verification, so execution
stopped before P5 and rollback began immediately. No secret, token, cookie,
admin email, or PII was recorded.

## Rollback evidence

1. `LMS_DUAL_SYSTEM_ENABLED` was removed from Production.
2. LMS was promoted back to
   `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.
3. `shop.yeunauan.live` was reassigned to
   `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h`.
4. `yeubep.shop` was promoted/reassigned to
   `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6`.
5. `COMMERCE_DUAL_LMS_ROUTING_ENABLED` was never enabled.
6. Post-rollback HTTP checks returned 200 for LMS homepage/Admin and both
   storefront/Admin pairs.
7. Post-rollback mapper: courses `8`, orders `28`, enrollments `20`, lessons
   `39`, site config `73`, unresolved `0`.
8. Both new columns remain all NULL; no canary slug exists.

## Final Production state

| Item | State |
|---|---|
| LMS deployment | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |
| shop.yeunauan.live deployment | `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h` |
| yeubep.shop deployment | `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6` |
| `LMS_DUAL_SYSTEM_ENABLED` | absent/false |
| `COMMERCE_DUAL_LMS_ROUTING_ENABLED` | absent/false |
| Additive Dual LMS schema | present, all historical tenant values NULL |
| Canary | not created |
| P5/P6/P7 | not executed |

The next execution requires a fresh owner approval and an authenticated,
non-PII admin smoke mechanism that can prove Google login/session restore
without exposing credentials.
