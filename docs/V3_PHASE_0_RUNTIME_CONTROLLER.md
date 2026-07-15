# V3 Phase 0 — Runtime controller spine

> **Status:** Implemented 2026-07-15. Tests green (`node --test tests/runtime-controller.test.mjs` — 14/14). Not applied to production yet — owner action below.
>
> **Goal of Phase 0:** the runtime controller that lets the owner rotate V1/V2/V3 at runtime, with a kill switch and instant rollback to V1, without redeploy. No business behavior changes in this phase.

## What this phase adds

1. **`migration_v3_runtime_config.sql`** — additive migration: a singleton `platform_runtime_config` row + an append-only `platform_runtime_config_audit` table, both RLS-on with no public policy (service-role / SQL Editor only). Defaults to `active_mode='v1'`, `kill_switch=false`.
2. **`utils/runtime-controller.js`** — the single source of truth:
   - `getEffectiveMode()` → `'v1' | 'v2' | 'v3'`. The **one gate** every write path branches on.
   - `kill_switch=true` forces `'v1'` regardless of `active_mode` (instant rollback, no redeploy).
   - **Fail-closed:** any read error / missing row → `'v1'`. The controller never throws.
   - In-memory cache (~3s TTL): a flip propagates in a few seconds without a redeploy.
   - `stampEvent(event, runtimeVersion, schemaVersion)` stamps every event/log/delivery with `runtime_version`.
   - `isShadowEnabledAsync('v2'|'v3')` for read-only shadow observe-and-log modes.
   - The controller **never writes**. Flips go through the admin endpoint or SQL Editor.
3. **`api/v2/runtime.js`** — admin endpoint (service-role gated via `INTERNAL_SYNC_SECRET` / `V2_WORKER_SECRET`, same gate as the V2 sync worker — no new secret):
   - `GET /api/v2/runtime` → current config + `effective_mode`.
   - `POST /api/v2/runtime` → flip `active_mode` / `v2_shadow_mode` / `v3_shadow_mode` / `kill_switch`; appends an audit row; invalidates the controller cache.
4. **`tests/runtime-controller.test.mjs`** — 14 tests: default v1, kill switch, fail-closed, invalid mode, shadow flags, stamping (object/array/preserve-existing/default-v1), single-writer branching, cache TTL stale-then-refresh.

## The single-writer invariant

`getEffectiveMode()` is the sole gate. Only the effective mode's write path runs:

```
const mode = await getEffectiveMode();   // 'v1' | 'v2' | 'v3'
if (mode === 'v1') { /* existing V1 path — unchanged */ }
else if (mode === 'v2') { /* V2 path — api/v2/* + utils/v2-*.js */ }
else if (mode === 'v3') { /* V3 path — built phase by phase */ }
```

Shadow modes (`v2_shadow_mode` / `v3_shadow_mode`) run **read-only** side-by-side: they observe and log, they do not write business data unless their version is the effective mode. No two versions write the same row concurrently, by construction.

## How to flip (owner)

- **Instant rollback to V1:** `POST /api/v2/runtime` with `{ "kill_switch": true }` (or `{ "active_mode": "v1" }`). Effect within the cache TTL (~3s), no redeploy.
- **Select a version:** `POST /api/v2/runtime` with `{ "active_mode": "v2" }` (or `v3`).
- **Turn on a shadow:** `{ "active_mode": "v1", "v3_shadow_mode": true }` — V3 observes while V1 still writes.
- Or directly via SQL Editor on Supabase B (service-role): `UPDATE public.platform_runtime_config SET active_mode='v1' WHERE id=1;`

Every flip appends to `platform_runtime_config_audit` (`changed_by`, `changed_at`, the new values).

## Compatibility contract (holds from this phase)

- V3 writes only to **additive** columns/tables. V1/V2 ignore columns they don't know.
- V3 never overloads a shared column with a meaning V1/V2 would misinterpret.
- Events/deliverables carry `runtime_version`; V1/V2 consumers skip rows not stamped for them.
- Contract test (added in later phases): write a row as V3, read through the V1 path, assert V1 sees a valid V1-shaped view.

## Owner action pending (does NOT block the repo work)

Apply the additive migration on Supabase B (SQL Editor, service-role):

```sql
-- contents of migration_v3_runtime_config.sql
```

Safe: additive, RLS-on, no business data, re-runnable. Until it is applied, the controller reads nothing and stays fail-closed to `v1` — so the system is identical to today. Rollback of this phase = `DROP TABLE public.platform_runtime_config_audit; DROP TABLE public.platform_runtime_config;` (no business data lost).

## Test bar met

- `node --test tests/runtime-controller.test.mjs` → 14/14 pass.
- Full suite (`tests/*.test.mjs`) green: rp1 48, rp2-cors 29, rp2b1 59, rp2b2 9, runtime-controller 14.
- No V1/V2 source file edited. V1 path unchanged (controller returns `v1` by default).
- No secret in any committed file.
- main + `v1-stable-20260713` untouched.
