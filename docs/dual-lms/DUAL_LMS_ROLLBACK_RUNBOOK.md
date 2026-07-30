# DUAL LMS — ROLLBACK RUNBOOK

**Status:** draft for owner review; no rollback action has been executed.

## Immediate triggers

- any cross-LMS read or mutation;
- wrong tenant/domain mapping;
- unresolved owner or alias chain/cycle;
- wrong enrollment revoke, lesson/media/progress or Drive course;
- canary becomes public or causes external side effects;
- unexpected business checksum/schema delta;
- attributable HTTP 500 above the approved threshold;
- new high/critical security issue.

## Order of operations

1. Set `COMMERCE_DUAL_LMS_ROUTING_ENABLED=false` on both Commerce projects.
2. Set `LMS_DUAL_SYSTEM_ENABLED=false` on LMS.
3. Verify restored B05 and Commerce legacy behavior.
4. Roll back Commerce and LMS artifacts to the deployment IDs captured
   immediately before rollout.
5. Prefer leaving the nullable schema in place because old code does not depend
   on it.
6. Only if schema rollback is necessary and separately approved, export every
   non-NULL `courses.lms_tenant` and `orders.lms_tenant` delta, then run
   `20260730_dual_lms_tenant_rollback.sql`.
7. Re-run counts, checksums, mapping, auth/session and read-only smoke.

## Prohibitions

Do not cascade, restore the whole database, delete course/order/lesson/
enrollment/progress rows, hard-delete the canary, rewrite the legacy alias,
change domain/tenant mapping, move Drive files or change credentials.

## Trigger matrix

| Trigger | Immediate action | Schema rollback? | Post-check |
|---|---|---:|---|
| Cross-LMS leak/mutation | both flags off, code rollback | normally no | IDOR + audit |
| Mapping reversed | both flags off | no | domain/project/env snapshot |
| Wrong enrollment/lesson/progress | both flags off | no | identity/count checks |
| Wrong Drive course | both flags off, stop Drive actions | no | audit/log and no grant |
| Migration mismatch/timeout | rollback transaction | yes, within transaction | catalog/checksum |
| Canary public/side effect | both flags off | no | storefront/order/email/Drive |
| Attributable 500 | Commerce flag, then LMS flag off | no unless required | legacy smoke |

