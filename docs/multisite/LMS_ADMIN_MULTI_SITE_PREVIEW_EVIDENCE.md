# LMS Admin Multi-Site — Protected Preview Evidence

Date: 2026-07-29
Status: complete.

| Evidence | Exact result |
|---|---|
| LMS source | `94e956f46d879b4bddec66f474fef52eff9d0da7` |
| LMS Preview | `dpl_BWuhKjmBpbSbATbZTfSKZrRrHjX6` |
| Commerce source | `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9` |
| Commerce Preview | `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb` |
| Supabase Preview | `plgrmaktvudjetfkwmyg` |
| LMS tests | 317/317 |
| Commerce tests | 73/73 |
| Browser | 12/12 |
| V5 checksum | `27030333fee663b3129b8c83b4624743b07c32ea7ba58f85449e2e47e90ffb80` |
| Seed checksum | `c636aba9715faad3e1fd5fe4185fd38160468ab70d5670c1acd5235a62f7734c` |

The protected Preview proved selector/deep-link/responsive behavior, canonical
course lists, legacy warning/no empty alias, course/lesson/media/enrollment/
progress IDOR, independent entitlement revoke and nine Drive dry-run actions.

Commerce fixture flow created self-target courses for both logical owners,
rejected forged cross-site mapping and duplicate slug, and preserved target/site
through unrelated edits.

The exact migration was applied, rolled back and reapplied only on the guarded
sanitized Preview substrate. No Production row, credential, Drive permission,
deployment, alias or flag changed.
