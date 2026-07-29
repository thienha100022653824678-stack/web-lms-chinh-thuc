# Production Learning Site Dry-Run

Generated: 2026-07-29T09:16:43.232Z

Mode: Production REST read-only, non-PII

Production ref: `aqozjkfwzmyfunqvcyjv`
OpenAPI schema SHA-256: `15d368bfdb9d5dab4a26d53220fcb4599e7a3f129984799402283dae90216b7a`

Counts: courses 9, orders 30, enrollments 22, lessons 39, site_config 79.

Unresolved mappings: **0**. Duplicate slugs: **0**. Required backfill: **0**.

| Course | Sales site | Canonical target | Proposed learning site | Reason | Explicit write required | Legacy warning |
|---|---|---|---|---|---|---|
| `banhmi4k` | NULL | `banhmi4k` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `banhmicamsicula` | NULL | `banhmicamsicula` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `bonglancuonnhatban` | NULL | `bonglancuonnhatban` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `heomoixaolan` | NULL | `heomoixaolan` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `nguyencammongtimHT` | NULL | `nguyencammongtimHT` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `puddingnama` | NULL | `puddingnama` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `thitkhomamtep` | yeubep | `thitkhomamtep` | yeubep | self_target_sales_site_fallback | no | — |
| `thitxiennuongchaungoc` | NULL | `thitxiennuongchaungoc` | yeunauan | legacy_null_yeunauan_fallback | no | — |
| `thitxiennuongchaungoc-yeubep` | yeubep | `thitxiennuongchaungoc` | yeunauan | canonical_target_owner | no | LEGACY_CROSS_SITE_SHARED_MAPPING |

No backfill was executed. The known cross-site alias is deterministic,
compatible and read-only. An optional explicit backfill is outside this
manifest and requires separate owner approval.
