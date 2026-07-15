# V2 Reconciliation Runbook

Read-only reconciliation for branch `v2/rebuild-20260715` on Supabase B (ref `aqozjkfwzmyfunqvcyjv`). V1 production is untouched. Run these checks on the **V2 preview** environment only.

## 1. Prerequisites

- `V2_RECONCILIATION_READONLY=true` on the preview env.
- `V2_WORKER_SECRET` (or `INTERNAL_SYNC_SECRET`) configured; pass it as the `x-v2-worker-secret` header.
- Identity migration applied (Section 3 below) and `postflight-v2.sql` clean.

## 2. Read reconciliation summary

```bash
curl -s -H "x-v2-worker-secret: $V2_WORKER_SECRET" \
  "$V2_PREVIEW_URL/api/v2/reconciliation" | jq
```

`/api/v2/readiness` also embeds a reconciliation summary in `diagnostics` + the `reconciliation_clean` gate.

## 3. Identity migration apply (owner action)

Order (after a manual Supabase B backup):

1. Open Supabase B SQL Editor for project `aqozjkfwzmyfunqvcyjv`.
2. Run `scripts/v2/preflight-v2.sql`. Save the output (snapshot).
3. Apply `migration_v2_sync_outbox.sql` in a transaction.
4. Apply `migration_v2_identity_mapping.sql` in a transaction.
5. Run `scripts/v2/postflight-v2.sql`. Every V2 table/column/index row must show `exists = true`; identity check rows must show `status = ok`.

If any postflight row is missing, run `scripts/v2/rollback-v2.sql` (non-production cleanup section, commented — uncomment only on a disposable DB) and stop. Do NOT proceed to Section 4.

## 4. Acceptance thresholds (canary-ready)

| Check | Source | Threshold |
|---|---|---|
| V2 tables visible | `postflight-v2.sql` §1 | `sync_outbox`, `sync_deliveries`, `sync_dead_letters`, `course_slug_mappings`, `portal_post_course_mappings` all `exists=true` |
| V2 columns visible | `postflight-v2.sql` §2 | all required rows `exists=true` |
| V2 indexes visible | `postflight-v2.sql` §3 | all required rows `exists=true` |
| `course_id is null` (orders/enrollments/lessons) | `postflight-v2.sql` §4 + `/api/v2/reconciliation` | tracked in report; **not required to be 0**, but every non-zero count must appear in the reconciliation report |
| Outbox shadow volume | `/api/v2/outbox` | rows increase with real sync events; no duplicate `idempotency_key` |
| Projection preview matches V1 | `/api/v2/portal-projection-preview` | sample course + enrollment payloads match the V1 `/api/sync` contract (owner compares sample-by-sample) |
| Worker dry-run plan | `/api/v2/sync-worker` with `dryRun=true` | delivery plan builds without delivering; no `sync_deliveries` rows created |
| Readiness level | `/api/v2/readiness` | `ready_for_dry_run` (shadow/dry-run) → then `ready_for_guarded_delivery` after owner approves live canary delivery |

## 5. Progression order (preview env flags)

1. `V2_OUTBOX_SHADOW_MODE=true` (all delivery flags off). Verify with `/api/v2/outbox`.
2. `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true`. Verify preview payloads.
3. Owner confirms sample payloads match V1.
4. `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`. **Keep `V2_DRIVE_WORKER_DRY_RUN=true`** (Drive job queue is out of scope for canary).
5. After each flip, re-check `/api/v2/readiness`; it must not regress to `blocked`.

## 6. Repair policy

- Reconciliation never auto-revokes. A serious mismatch moves the affected record to "needs admin review" (Data Ownership Contract §repair).
- Any repair that touches enrollment/order/Drive requires an `admin_audit_logs` entry.
- Do not auto-resolve `course_id is null` counts; surface them in the report for owner review.
