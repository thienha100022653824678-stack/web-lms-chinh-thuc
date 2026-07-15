# V3 Phase 2 (①) — RLS + Key Tiering + RPC Write Path

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-db` 8, `v3-rls-migration` 7, `v3-write-path` 4; full suite 191/191). Owner-only production steps (apply RLS migration on B after canary, Portal lockstep) recorded **pending** — they do NOT block auto-advance to Phase 3.
>
> **Goal:** shrink the SEC-09 blast radius — V1/V2 give the browser nothing but rely on one service-role key that bypasses all RLS. V3 introduces three key tiers, real RLS policies, and a single RPC write funnel — all gated on `getEffectiveMode()==='v3'` so V1/V2 stay byte-for-byte unchanged.

## What this phase added

| File | Role |
|---|---|
| `utils/v3-db.js` | Tiered Supabase client factory. `getClientForRole('anon'\|'authenticated'\|'service_role')` (throws unless v3 mode; fail-closed on missing anon key — never service-role fallback). `assertServerOnly(role)` (only service_role writes directly). `resolveTierForRequest(req)` (least privilege: worker secret→service_role, verified session→authenticated, else anon). Serverless-only — service-role key never ships to a browser. |
| `migration_v3_rls_policies.sql` | Additive, idempotent, **owner-applied after canary**. anon: SELECT active courses + free lessons. authenticated: own-row scope (enrollments, progress read+update, sessions, enrolled lessons) via `auth.email()`. Normalizes `handle_student_session_login` to SECURITY DEFINER + pinned `search_path` (was INVOKER). No service_role policy — it bypasses RLS, so V1/V2 unaffected. |
| `utils/v3-write-path.js` | `writeViaRpc(name, params)` — the sole sanctioned V3 write path: refuses unless v3 mode, runs a SECURITY DEFINER RPC via the service_role tier, stamps `runtime_version`/`schema_version`. Never does a direct insert/update/delete. `toV1View(row, v1Columns)` — compatibility-contract projection. |
| `tests/v3-db.test.mjs` (8), `tests/v3-rls-migration.test.mjs` (7), `tests/v3-write-path.test.mjs` (4) | Tiering guards, additive-only migration assertions, write-path funnel + the V1 compatibility-contract test (V3-written row reads back valid through the V1 view; additive fields never overload a V1 column). |
| `supabase/drift_allowlist.json` | +8 `policies` entries so the drift gate accepts the post-apply RLS state as baseline once the owner applies the migration. |

## How the tiers work at runtime (v3 mode)

1. A request arrives → `resolveTierForRequest(req)` picks the least-privileged tier.
2. Reads go through `getClientForRole(tier)`; RLS enforces row scope for anon/authenticated at the DB layer (not app logic — can't be bypassed by an app bug).
3. Writes never hit a table directly from anon/authenticated (no INSERT/DELETE policy). They call `writeViaRpc(name, params)`, which uses the service_role client to run a SECURITY DEFINER RPC with advisory locking (the proven `handle_student_session_login` pattern).
4. In `v1`/`v2` mode, none of this is constructed — `utils/supabase.js` (the single service-role client) serves those paths exactly as today.

## Compatibility contract (holds this phase)

- V3 writes only to additive columns/tables; never overloads a V1 column with a new meaning.
- Every V3 write is stamped `runtime_version:'v3'`; V1/V2 consumers skip rows not stamped for them.
- Contract test: a V3-shaped row projected through `toV1View` yields a valid V1 row with additive fields dropped — proven in `tests/v3-write-path.test.mjs`.

## Owner action pending (does NOT block auto-advance)

1. **Apply `migration_v3_rls_policies.sql` on Supabase B after a canary.** Verify on a staging clone that anon can still read the public course surface and an authenticated student reads only their own rows before applying to production. Rollback = a new migration dropping these policies (additive-reverse), never editing the file.
2. **Provision `SUPABASE_ANON_KEY`** in the V3 runtime env (required for anon/authenticated tiers). Until then, v3 mode anon/authenticated reads fail closed — but v1/v2 are unaffected.
3. **Portal lockstep:** if the browser moves from service-role to anon/authenticated keys, coordinate the `student-web` Portal repo (propose PR, owner merges). No Portal change is required until the owner flips `active_mode='v3'`.

## Test bar met (Phase 2)

- `node --test tests/*.test.mjs` → 191/191, 0 fail.
- No runtime code edited outside new V3-only files (`utils/v3-db.js`, `utils/v3-write-path.js`); `utils/supabase.js` untouched → V1 path unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched. No production write (migration owner-applied).
