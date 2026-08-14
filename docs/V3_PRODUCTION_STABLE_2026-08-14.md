# V3 Production Stable — 2026-08-14

## 1. Stable code checkpoint

- Repository: `thienha100022653824678-stack/web-lms-chinh-thuc`
- Stable code commit: `d1ac980057cabc622bc48ed565537986b438d75d`
- Stable backup branch: `backup/v3-production-stable-20260814`
- Production Vercel deployment: `dpl_34dHN2vnycWWE4Y9e4r7Brydu7Wr`
- Canonical domains:
  - `https://www.daubepnho.store`
  - `https://daubepnho.store`
- Vercel project: `web-lms-chinh-thuc` / `prj_TimQqrVhrOLW8y1KI464JBvajwlz`
- Production Supabase project: `aqozjkfwzmyfunqvcyjv`

## 2. Runtime snapshot after V3 cutover

Verified on 2026-08-14 after production canary and end-to-end testing:

```text
v2_active_mode = v2
v3_presentation_enabled = true
v3_kill_switch = false
v2_kill_switch = absent/default false
```

Public runtime endpoint returned:

```json
{
  "configuredMode": "v3",
  "effectiveMode": "v3",
  "globalKillSwitch": false,
  "v3KillSwitch": false,
  "ok": true,
  "source": "db+db"
}
```

Architectural rule: V3 is a presentation layer on top of V2. Do **not** add `v3` to the V2 runtime controller active-mode enum. When V3 is active, the base runtime must remain V2.

## 3. Production routes

- Admin: `https://www.daubepnho.store/admin.html`
- Unified learner router: `https://www.daubepnho.store/learning`
- V2 learner: `https://www.daubepnho.store/lms.html?course=<slug>`
- V3 learner: `https://www.daubepnho.store/v3?course=<slug>`
- V3 Admin: `https://www.daubepnho.store/v3-admin?course=<slug>`
- Runtime state: `https://www.daubepnho.store/api/v3-mode`
- Student Portal: `https://www.yeunauan.live/my-courses`

## 4. Verified E2E state

The following were manually verified after production deploy:

- Student Portal login and course access.
- V2 learner remains functional.
- V3 learner accepts the existing verified LMS session/device guard.
- `/learning` routes to V3 when V3 is effective.
- Multi-course V3 chooser is clickable.
- V3 feed, curriculum index, scrolling, media viewer and documents operate.
- Admin Production shows V1/V2/V3 runtime controls.
- V3 Admin loads using the existing Admin session.
- V3 kill switch rollback to V2 was tested.
- Global kill semantics remain V1 fallback.
- No new HTTP 5xx were observed during cutover testing.

## 5. Rollback runbook

### Level 1 — V3 problem, keep V2 platform

Preferred rollback.

1. Open `Admin → Hệ Thống`.
2. Click **Bật V3 kill (ép V2)**.
3. Confirm runtime endpoint reports:
   - `configuredMode = v3`
   - `effectiveMode = v2`
   - `v3KillSwitch = true`
4. Verify `/learning?course=<slug>` opens V2.

This does not remove V3 configuration or data. Turning V3 kill off returns presentation to V3.

### Level 2 — Permanently select V2

1. Open `Admin → Hệ Thống`.
2. Select **V2**.
3. Confirm:
   - `configuredMode = v2`
   - `effectiveMode = v2`

Controller behavior: leaving V3 disables `v3_presentation_enabled` first, then keeps/sets base runtime to V2.

### Level 3 — Emergency fallback to V1

Use only for broader LMS runtime incidents.

1. Open `Admin → Hệ Thống`.
2. Enable **Global kill switch**.
3. Confirm `effectiveMode = v1`.

Global kill has higher priority than V2/V3 selection.

## 6. Database emergency reference

Use the Admin runtime endpoint/UI whenever possible because it also follows controller ordering and audit behavior. Direct DB changes are emergency-only.

Expected V3-active rows:

```sql
select key, value
from site_config
where key in (
  'v2_active_mode',
  'v2_kill_switch',
  'v3_presentation_enabled',
  'v3_kill_switch'
)
order by key;
```

V3 rollback intent is conceptually:

```text
v2_active_mode = v2
v3_kill_switch = true
```

Do not modify unrelated `site_config` rows.

## 7. Restore code checkpoint

If a code rollback is required, the exact pre-documentation stable source is preserved at:

`backup/v3-production-stable-20260814`

Commit:

`d1ac980057cabc622bc48ed565537986b438d75d`

The Production deployment serving this code at the stable checkpoint is:

`dpl_34dHN2vnycWWE4Y9e4r7Brydu7Wr`

Do not redeploy an older `main` commit as a rollback without checking the V2/V3 runtime and session-guard changes first.

## 8. Git branch state at stable checkpoint

At audit time:

- `main` is an ancestor of the Production baseline.
- Production baseline is **93 commits ahead** of `main`.
- Production baseline is **0 commits behind** `main`.
- Merge base equals current `main` commit `f9220e8128e13e93d803e0c014c39be5819f557c`.

Therefore the safe Git normalization path is a **non-force fast-forward** of `main` to the stable Production lineage. Do not create a synthetic merge or force-push unless the branch relationship changes before execution.
