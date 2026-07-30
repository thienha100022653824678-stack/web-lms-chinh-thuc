# DUAL LMS — PRODUCTION MIGRATION RUNBOOK

**Status:** draft for owner review; not authorized for execution.

## Gate 0 — identity

1. Record owner approval ID, operators and window.
2. Verify the approved full LMS and Commerce runtime SHAs.
3. Verify both migration SHA-256 values from the implementation report.
4. Verify Production Supabase ref exactly `aqozjkfwzmyfunqvcyjv`.
5. Verify current projects/deployments/domains and required mapping:
   `shop.yeunauan.live → yeunauan`,
   `yeubep.shop → yeubep`.
6. Verify both new flags are absent/false.
7. Run the read-only mapper; require zero unresolved, chain, cycle or duplicate.
8. Stop on any unexplained mismatch, high/critical advisory or dirty runtime
   artifact.

## Gate 1 — backup

Before mutation, create encrypted schema-only and policy/grant/catalog backups
outside Git. Export `courses`, `orders`, `lessons`, `student_enrollments`,
`lesson_progress`, `site_config` and Drive metadata under the existing retention
policy. Record sanitized filenames, row counts, checksums and restore-read
verification. Never place PII or secret values in evidence.

## Gate 2 — additive migration, flags off

Set `lock_timeout='5s'` and `statement_timeout='30s'`. Apply only
`20260730_dual_lms_tenant.sql`; do not backfill.

Verify independently:

- existing business-column checksums and counts unchanged;
- only the two nullable TEXT columns, two constraints, five indexes and comments
  were added;
- all existing `lms_tenant` values are NULL;
- global course slug and enrollment/lesson/progress identities unchanged;
- zero invalid tenant, duplicate slug or unresolved mapping;
- V5 checksum unchanged;
- duration below 30 seconds.

Stop and roll back the transaction on any mismatch or timeout.

## Gate 3 — deploy flags off

Deploy exact approved runtime artifacts to the existing projects with both flags
false. Do not reuse a Preview fixture artifact. Verify source, Production target,
environment-name inventory, domain aliases and absence of Preview ref/mode.
Smoke B05 auth/session, course, lesson, media, material, enrollment, progress and
non-mutating Drive health; smoke both storefronts, Admin, Learning Course
Boundary, Portal/outbox and shared entitlement. Observe at least 15 minutes.

## Gate 4 — LMS Admin canary

Enable only `LMS_DUAL_SYSTEM_ENABLED`. Verify both labels and the exact mapping,
independent lists, deep links, stale-course clearing, global badges and read-only
legacy alias. Run read-only forged tenant/ID probes. Stop immediately on mapping
reversal, leak, unresolved owner or attributable 500.

## Gate 5 — controlled write

With separate owner approval for the exact slug, create one inactive,
unpublished, self-target course in one tenant. Add one section and text-only
lesson. Read after write; verify tenant, no public listing, no order/enrollment,
no email/payment/Portal side effect and no Drive grant. Do not hard-delete.

## Gate 6 — Commerce canary

Enable `COMMERCE_DUAL_LMS_ROUTING_ENABLED` in both Commerce projects. Verify each
deployment fixes its Admin selector to its own `SALES_SITE`, exposes only
same-tenant canonical targets, creates correct self-target routing, emits the
correct deep link, rejects cross target and duplicate slug, preserves target on
quick/unrelated edits, and cannot recreate the legacy mapping. Do not approve a
real order.

## Gate 7 — observation

Observe at 0, 15 and 60 minutes. Require zero cross-LMS leak/mutation, unresolved
owner, wrong-site lesson/enrollment/progress/Drive event or attributable 500.
Keep the canary inactive/unpublished. Assign a 24-hour read-only follow-up; do
not claim the 24-hour review before it has elapsed.

