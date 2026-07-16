# V2 4-Repo Unified Switch — Emergency Rollback Runbook

**Switch source of truth:** DB B (`aqozjkfwzmyfunqvcyjv`) `site_config` rows `v2_active_mode` (v1|v2) + `v2_kill_switch`.
**One switch controls all 4 components** (LMS, Shop, Portal, System1 Admin).

## RAPID hard-stop (any V2 problem) — no redeploy, ~3s
The switch is RESTRICT-ONLY: flipping to V1 (or arming the kill switch) immediately withdraws ALL V2 behavior across every component within the cache TTL (5s), even if per-feature env flags stay set. This is the FIRST rollback action for any V2 issue.

### Option A — kill switch (strongest, survives a stuck v2 row)
Via LMS admin UI: `https://www.daubepnho.store/admin.html` → "⚙️ Hệ Thống" tab → kill switch ON.
Or via SQL on DB B:
```sql
insert into site_config (key, value) values ('v2_kill_switch', true)
  on conflict (key) do update set value = true;
```
Effect: every component forces V1 regardless of `v2_active_mode`. To clear:
```sql
update site_config set value = false where key = 'v2_kill_switch';
```

### Option B — flip active_mode to v1
Via LMS admin UI: "⚙️ Hệ Thống" tab → press V1 (confirm).
Or via SQL:
```sql
insert into site_config (key, value) values ('v2_active_mode', 'v1')
  on conflict (key) do update set value = 'v1';
```
Effect: all components return to V1 within 5s. V1 behavior is fully preserved (cold-cache fail-open + restrict-only gate).

## Per-component code rollback (if a V2 code deploy itself is broken)
Each component has its own Vercel project + production deployment history. Roll back to the PREVIOUS production deployment (Vercel retains them). This is independent of the DB switch.

| Component | Vercel project | Prod domain | Rollback command |
|---|---|---|---|
| LMS | web-lms-chinh-thuc | www.daubepnho.store | `vercel promote <prev-deployment-id> --scope thienha100022653824678-stacks-projects` (from `web-lms-chinh-thuc` checkout) |
| Shop | web-ban-hang-chinh-thuc | yeubep.shop | `vercel promote <prev>` (from `git-repo` checkout) |
| Portal | student-web | www.yeunauan.live | `vercel promote <prev>` (from `yeubep-shop/student-web`) |
| Admin | admin-web-tra-bai | admin.yeunauan.live | `vercel promote <prev>` (from `yeubep-shop/admin-web`) |

Find the previous production deployment:
```
vercel ls <project> --scope thienha100022653824678-stacks-projects
```
Pick the deployment that was "Production" BEFORE the V2 deploy, copy its ID (`dpl_...`), promote it.

## Verify rollback succeeded
After applying A or B (and waiting >5s for TTL):
```
# All four must report activeMode=v1 (or killSwitch=true) and the SAME mode:
curl -s -H "x-v2-worker-secret: $V2_WORKER_SECRET" https://www.daubepnho.store/api/v2/diagnostics
curl -s -H "x-v2-worker-secret: $V2_WORKER_SECRET" https://yeubep.shop/api/v2/diagnostics
curl -s -H "x-v2-worker-secret: $V2_WORKER_SECRET" https://www.yeunauan.live/api/v2/diagnostics
curl -s -H "x-v2-worker-secret: $V2_WORKER_SECRET" https://admin.yeunauan.live/api/v2/diagnostics
```
Expect each `activeMode: "v1"` (or `killSwitch: true`). If any still says `v2`, force a redeploy of that component OR clear its `V2_RUNTIME_FORCE_MODE` env (an operator escape hatch that overrides the DB — if left set to v2 it bypasses the switch).

## Data safety
- The switch is **additive-only**: `site_config` upserts. No destructive migration is part of the V2 switch. V2 outbox shadow writes (`sync_outbox`) are additive telemetry; flipping to V1 stops new writes but does not delete existing rows.
- No V1 data is deleted by flipping. V2 behavioral changes are gated reads, not data mutations.
- If a V2 feature wrote bad data, identify the table and restore from the Supabase B daily backup (owner action — Supabase dashboard → DB B → backups).

## Owner escape hatches (env, per Vercel project)
- `V2_RUNTIME_FORCE_MODE=v1` on any component forces V1 on that component regardless of DB (operator override). Use to isolate a single misbehaving component without touching the shared switch.
- `V2_RUNTIME_FORCE_KILL=1` forces V1 + kill on that component.
- **Remember to clear these after the incident** or they will silently bypass the shared switch.

## Decision order
1. V2 misbehaves → flip `v2_active_mode` to v1 (Option B) or arm kill switch (Option A). ~3s, no redeploy. Verify 4 diagnostics agree on v1.
2. If a specific component's V2 CODE is broken (not just behavior) → `vercel promote <prev>` that component only. The shared switch can stay v2 for the others.
3. If unsure → kill switch (forces ALL to V1) is the safest single action.
