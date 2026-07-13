# V2 Operations Runbook

Use this runbook only for branch `v2/platform-rebuild`.

V1 production must keep running until the owner explicitly approves a V2 cutover.

## 1. Preflight

Confirm all three repos have the V1 stable tag:

- Shop: `v1-stable-20260713`
- Portal: `v1-stable-20260713`
- LMS: `v1-stable-20260713`

Confirm Supabase B:

- Project ref: `aqozjkfwzmyfunqvcyjv`
- Org: `thienha336501903-a11y's Org`

Never apply V2 migrations to Supabase A unless a task explicitly says so.

## 2. Migration Order

Apply additive migrations in this order after a manual DB backup:

1. `migration_v2_sync_outbox.sql`
2. `migration_v2_identity_mapping.sql`

Postflight checks:

```sql
select count(*) from sync_outbox;
select count(*) from sync_deliveries;
select count(*) from sync_dead_letters;
select count(*) from course_slug_mappings;
select count(*) from portal_post_course_mappings;
select count(*) from orders where course_slug is not null and course_id is null;
select count(*) from student_enrollments where course_slug is not null and course_id is null;
select count(*) from lessons where course_slug is not null and course_id is null;
```

Non-zero mapping gaps are not always fatal, but they must be reviewed before cutover.

## 3. Feature Flags

Keep all V2 flags off by default:

```text
V2_PLATFORM_ENABLED=false
V2_OUTBOX_SHADOW_MODE=false
V2_OUTBOX_WORKER_ENABLED=false
V2_OUTBOX_WORKER_DRY_RUN=true
V2_DELIVERY_HANDLERS_ENABLED=false
V2_DRIVE_WORKER_DRY_RUN=true
V2_RECONCILIATION_READONLY=false
```

Recommended staging order:

1. Enable `V2_RECONCILIATION_READONLY=true`.
2. Run read-only reconciliation and resolve high-risk mismatches.
3. Enable `V2_OUTBOX_SHADOW_MODE=true`.
4. Verify V1 sync still works and outbox rows are created.
5. Enable `V2_OUTBOX_WORKER_ENABLED=true` with `V2_OUTBOX_WORKER_DRY_RUN=true`.
6. Run worker dry-run and inspect planned deliveries.
7. Keep `V2_DELIVERY_HANDLERS_ENABLED=false` until every delivery target is reviewed.
8. Enable `V2_DELIVERY_HANDLERS_ENABLED=true` only in staging first.
9. Keep `V2_DRIVE_WORKER_DRY_RUN=true` while validating Drive delivery plans.
10. Disable `V2_DRIVE_WORKER_DRY_RUN` only after confirming target emails, folders, and admin pool health.

## 4. Internal Endpoints

Both endpoints require the worker secret header:

```text
x-v2-worker-secret: <secret>
```

or the legacy-compatible header:

```text
x-sync-secret: <secret>
```

Do not print the secret in logs, screenshots, or issue reports.

### Diagnostics

```http
GET /api/v2/diagnostics
```

Expected behavior:

- Returns feature flag state without returning secret values.
- Reports whether worker secrets are configured as booleans only.
- Checks required V2 tables and additive columns are visible to runtime.
- Reports outbox counts, stale processing rows, pending deliveries, and dead letters.
- Does not write database rows.

Expected pre-migration state:

- `ok=false`
- `migrations.missingTables` and/or `migrations.missingColumnGroups` may be non-empty.

Expected after applying committed V2 migrations:

- `ok=true`
- `migrations.missingTables=[]`
- `migrations.missingColumnGroups=[]`

Do not enable `V2_DELIVERY_HANDLERS_ENABLED` until diagnostics and reconciliation
are both understood.

### Reconciliation

```http
GET /api/v2/reconciliation?sampleLimit=20
```

Expected behavior:

- Returns read-only report.
- Does not write database rows.
- Returns `v2_reconciliation_disabled` when the flag is off.

### Sync Worker

```http
POST /api/v2/sync-worker
Content-Type: application/json

{
  "limit": 10,
  "dryRun": true
}
```

Expected behavior:

- With dry-run: only reports planned work.
- With dry-run off and `V2_DELIVERY_HANDLERS_ENABLED=false`: creates pending delivery plans and releases the outbox claim back to pending.
- With `V2_DELIVERY_HANDLERS_ENABLED=true`: executes enabled delivery handlers.
- Drive delivery remains pending dry-run unless `V2_DRIVE_WORKER_DRY_RUN=false`.
- Portal projection delivery is intentionally not implemented yet and will fail safely if enabled before implementation.

## 5. Cutover Gate

Do not cut over to V2 until all are true:

- V1 regression tests pass on Shop, Portal, LMS.
- Reconciliation has no unresolved high-risk identity mismatches.
- Outbox shadow mode has run without breaking V1 sync.
- Worker dry-run output matches expected targets.
- Delivery handlers are implemented, idempotent, and tested.
- Rollback has been rehearsed.

## 6. Rollback

Rollback runtime first, schema later if needed:

1. Disable V2 flags.
2. Redeploy V1 production branches or tag `v1-stable-20260713`.
3. Smoke test Shop, Portal, LMS.
4. Keep additive V2 tables/columns unless a separate backup/export and schema rollback plan exists.

Do not drop V2 tables from production during an incident unless the owner explicitly approves it.
