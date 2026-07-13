# V2 Implementation Status

This document tracks V2 work on branch `v2/platform-rebuild`.

V1 production remains unchanged. Do not merge or deploy V2 until the owner
explicitly asks to switch traffic to V2.

## Baseline

- V1 stable tag: `v1-stable-20260713`
- V2 branch: `v2/platform-rebuild`
- Runtime source of truth: Supabase B / LMS & Checkout
- Supabase B project ref: `aqozjkfwzmyfunqvcyjv`
- Cutover rule: V2 is opt-in only; V1 rollback is the stable tag plus current production branches.

## Completed

### Shop

- `8e45899 chore: initialize V2 rollout baseline`
  - Added V2 rollout notes and feature flags.
- `dbba90c chore: add V2 outbox helpers`
  - Added outbox enqueue helper.
- `62880be chore: shadow-write shop sync events to V2 outbox`
  - Shadow-writes course/enrollment sync events when `V2_OUTBOX_SHADOW_MODE` is enabled.
  - Default V1 behavior is unchanged.

### Portal

- `7134019 chore: initialize V2 rollout baseline`
  - Added V2 rollout notes and feature flags.
  - Note: Portal still has a pre-existing dirty file `src/lib/session-guard.ts`; it is not part of V2 baseline.

### LMS

- `0029f47 chore: initialize V2 rollout baseline`
  - Added V2 rollout notes and feature flags.
- `41808c6 chore: add V2 sync outbox migration`
  - Added additive migration `migration_v2_sync_outbox.sql`.
- `7f37cdc chore: add V2 outbox helpers`
  - Added LMS outbox enqueue helpers.
- `0fa9dd1 feat(v2-db): add identity mapping foundation`
  - Added additive migration `migration_v2_identity_mapping.sql`.
  - Adds canonical course/order/enrollment/lesson mapping foundation.
- `45503a8 feat(v2-sync): add dry-run outbox worker`
  - Added internal V2 sync worker endpoint.
  - Default mode is dry-run / plan-only.
  - No V1 delivery behavior is changed.
- `9b53969 feat(v2-reconcile): add read-only reconciliation endpoint`
  - Added internal read-only reconciliation endpoint.
  - Reports identity/outbox mapping gaps without writing database rows.
- `1b74a1d feat(v2-sync): add guarded delivery executor`
  - Added guarded outbox delivery execution behind `V2_DELIVERY_HANDLERS_ENABLED`.
  - Drive delivery remains dry-run by default through `V2_DRIVE_WORKER_DRY_RUN=true`.
  - Portal projection delivery is intentionally not implemented yet and fails safely if enabled too early.
  - Existing V1 sync endpoints and runtime behavior are unchanged.
- Current V2 diagnostics slice
  - Adds internal read-only V2 diagnostics endpoint `/api/v2/diagnostics`.
  - Reports feature flag state, required migration visibility, and outbox health without writing data.

## Not Applied Automatically

The following V2 migrations are committed but must not be applied to production
without an explicit apply/test step:

- `migration_v2_sync_outbox.sql`
- `migration_v2_identity_mapping.sql`

They are additive, but the system should still apply and verify them in a controlled
Supabase B session.

## In Progress / Next

- Add real Portal projection delivery handler after dry-run reports are stable.
- Add read-only reconciliation runbook and expected result thresholds.
- Add admin V2 diagnostics page guarded by admin auth.
- Add session lease V2 only after sync/reconciliation is stable.
- Add Drive permission job queue after outbox delivery is proven.

## Still Not Done

- No V2 traffic cutover.
- No V2 production deployment.
- No V2 database migration has been applied by this branch work.
- No V1 endpoint has been removed or blocked.

## Current Guardrails

- Keep `main` / production branches on V1 until explicit cutover approval.
- Keep V2 feature flags off by default.
- Keep `V2_DELIVERY_HANDLERS_ENABLED=false` until staging verification is complete.
- Keep `V2_DRIVE_WORKER_DRY_RUN=true` until Drive admin pool and folder IDs are verified for V2 worker traffic.
- Do not commit secrets, env files, `scratch/`, or `review-dossier-session-guard/`.
- Do not modify `/api/sync`, OAuth, session restore, Drive permission, or enrollment mapping outside a scoped V2 task.
