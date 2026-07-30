# Production Dual LMS Mapping Dry-Run

Captured read-only on 2026-07-30. No PII was selected and no write occurred.

Production ref: `aqozjkfwzmyfunqvcyjv`

Result: 8 courses, 0 unresolved, 0 duplicate slug, 0 required backfill and one
read-only historical cross-LMS alias.

| Course | Sales site | Canonical target | Proposed LMS tenant | Reason | Explicit write required | Legacy warning |
|---|---|---|---|---|---|---|
| `banhmi4k` | NULL | `banhmi4k` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `banhmicamsicula` | NULL | `banhmicamsicula` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `bonglancuonnhatban` | NULL | `bonglancuonnhatban` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `heomoixaolan` | NULL | `heomoixaolan` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `nguyencammongtimHT` | NULL | `nguyencammongtimHT` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `puddingnama` | NULL | `puddingnama` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `thitxiennuongchaungoc` | NULL | `thitxiennuongchaungoc` | `yeunauan` | legacy NULL canonical fallback | no | — |
| `thitxiennuongchaungoc-yeubep` | `yeubep` | `thitxiennuongchaungoc` | `yeunauan` | canonical target owner | no | `LEGACY_CROSS_LMS_SHARED_MAPPING` |

The resolver makes these mappings deterministic without backfill. The alias
must remain read-only and must not appear as an empty LMS course.

