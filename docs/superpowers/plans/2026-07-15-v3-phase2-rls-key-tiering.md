# V3 Phase 2 (①) — RLS + Key Tiering + RPC Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give V3 a security posture where the browser never holds a bypass-everything key: three key tiers (`anon` public-read, `authenticated` row-scoped, `service_role` server-only), RLS policies that actually enforce, and multi-step writes funnelled through `SECURITY DEFINER` RPCs — all gated behind `getEffectiveMode()==='v3'` so V1/V2 remain byte-for-byte unchanged.

**Architecture:** Everything ships as V3-only additive code + owner-applied additive migrations. A tiered DB-client factory (`utils/v3-db.js`) chooses the key tier by caller role; in `v1`/`v2` mode it is never constructed, and `utils/supabase.js` (the single service-role client) is untouched. RLS policies and the RPC security-mode fix land in a new `migration_v3_rls_policies.sql` the owner applies only after a canary. A contract test proves V3-written rows are readable through the V1 path.

**Tech Stack:** Node 24 (`node:test`, `.mjs`/`.js` ESM), `@supabase/supabase-js`, Postgres RLS + `SECURITY DEFINER` plpgsql, the Phase 0 runtime controller.

## Global Constraints

- Additive-only migrations. No `DROP`/`RENAME`/`ALTER TYPE`. RLS policies are `CREATE POLICY` (additive); service-role bypasses RLS so existing paths keep working.
- No self-cutover: never set `active_mode=v2/v3` on production. Owner flips.
- No production writes: RLS/RPC migrations are owner-applied after canary; recorded "pending", do NOT block auto-advance.
- V3-only code gated on `getEffectiveMode()`. `v1`/`v2` behavior identical to today. `utils/supabase.js` unchanged.
- Coexistence/compatibility contract: V3 writes only additive columns/tables; a V3-written row must read back valid through the V1 path (contract test).
- No secret in commits. Don't touch `main`, tag `v1-stable-20260713`, Portal repo.
- Phase bar: `node --test` green + secret scan + V1 path unchanged + commit + push.
- Node 24: parenthesize any `||`+`??` mix.

---

### Task 1: Tiered DB-client factory (`utils/v3-db.js`)

**Files:**
- Create: `utils/v3-db.js`
- Test: `tests/v3-db.test.mjs`

**Interfaces:**
- Produces:
  - `getClientForRole(role) -> supabaseClient` where `role ∈ {'anon','authenticated','service_role'}`.
  - `assertServerOnly(role)` throws if `role !== 'service_role'` is used on a write path.
  - `resolveTierForRequest(req) -> role` (maps an incoming request to the least-privileged tier: admin/worker secret → `service_role`, verified student session → `authenticated`, else `anon`).
- Consumes: `getEffectiveMode` from `utils/runtime-controller.js`; env keys `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Rules:
- The factory throws if called while `getEffectiveMode() !== 'v3'` — a guard so V3 wiring can never be reached in v1/v2 mode.
- `service_role` client is only ever returned server-side; the module exports nothing that hands a service-role key to a browser bundle (it is a serverless-only util, same as `utils/supabase.js`).
- Missing `SUPABASE_ANON_KEY` → `anon`/`authenticated` requests fail closed with a clear error, never silently fall back to service-role.

- [ ] **Step 1:** Write `tests/v3-db.test.mjs` (stub Supabase via `LMS_RP2B1_SUPABASE_STUB=1`): factory throws when mode≠v3; `resolveTierForRequest` returns `service_role` for a valid worker secret header, `authenticated` for a verified-session marker, `anon` otherwise; `assertServerOnly` throws for `anon`/`authenticated`; missing anon key fails closed.
- [ ] **Step 2:** Run `node --test tests/v3-db.test.mjs` → FAIL (module not found).
- [ ] **Step 3:** Implement `utils/v3-db.js` per the interface. Reuse the worker-secret check from `utils/v2-sync-worker.js` (`assertV2WorkerAuthorized`) rather than re-implementing.
- [ ] **Step 4:** Run `node --test tests/v3-db.test.mjs` → PASS.
- [ ] **Step 5:** Full suite `node --test tests/*.test.mjs` → all pass.
- [ ] **Step 6:** Commit.

### Task 2: RLS policy + RPC-hardening migration (owner-applied)

**Files:**
- Create: `migration_v3_rls_policies.sql`
- Test: `tests/v3-rls-migration.test.mjs` (static assertions on the SQL text — additive-only, no DROP, expected policies present)

The migration (additive, idempotent, `CREATE POLICY IF NOT EXISTS`-style via guarded `DO` blocks):
- `anon`: `SELECT` policy on public-readable tables (`courses`, `lessons` where `active`/`is_free` as today's public surface allows).
- `authenticated`: `SELECT`/`UPDATE` scoped to the caller's own rows (`student_enrollments`, `lesson_progress`, `student_active_sessions`) via `auth.email()`/`auth.uid()` matching `email`.
- Normalize `handle_student_session_login` to `SECURITY DEFINER` + `SET search_path = public` (currently INVOKER, per VERIFIED gap) via `ALTER FUNCTION` — additive, no body change.
- No policy is added that would remove service-role's implicit bypass; V1/V2 (all service-role) keep working.

- [ ] **Step 1:** Write `tests/v3-rls-migration.test.mjs`: assert the SQL contains no `DROP`/`RENAME`/`ALTER TYPE`; asserts it contains `ENABLE ROW LEVEL SECURITY` guards, `CREATE POLICY`, and `ALTER FUNCTION ... SECURITY DEFINER` + `SET search_path`.
- [ ] **Step 2:** Run → FAIL (file absent).
- [ ] **Step 3:** Write `migration_v3_rls_policies.sql`.
- [ ] **Step 4:** Run → PASS. Add the migration's known drift (new policies) to `supabase/drift_allowlist.json` under `policies` so the gate treats the post-apply state as baseline once owner applies it.
- [ ] **Step 5:** Full suite → pass. Commit. Record apply-on-B as owner-pending in docs.

### Task 3: V3 RPC write-path wrapper + V1 contract test

**Files:**
- Create: `utils/v3-write-path.js`
- Test: `tests/v3-write-path.test.mjs`
- Modify: `docs/V3_PHASE_2_RLS_KEY_TIERING.md` (create)

**Interfaces:**
- Produces: `writeViaRpc(name, params)` — the only sanctioned V3 write entrypoint; calls a `SECURITY DEFINER` RPC through the `service_role` client, stamps `runtime_version` via `stampEvent`, refuses if mode≠v3.
- Consumes: `getEffectiveMode`, `stampEvent` from `utils/runtime-controller.js`; `getClientForRole` from `utils/v3-db.js`.

- [ ] **Step 1:** Write `tests/v3-write-path.test.mjs`: `writeViaRpc` refuses when mode≠v3; stamps `runtime_version:'v3'`; a contract case — a row shaped as V3 writes it is read through a simulated V1 read (only V1-known columns) and asserts V1 sees a valid V1-shaped view (extra additive fields ignored).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `utils/v3-write-path.js`.
- [ ] **Step 4:** Run → PASS. Full suite → pass.
- [ ] **Step 5:** Write `docs/V3_PHASE_2_RLS_KEY_TIERING.md` (what shipped, how tiers work, owner apply steps for `migration_v3_rls_policies.sql` + canary + Portal lockstep note). Update `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` status line.
- [ ] **Step 6:** Secret scan, reset stub to `{}`, commit + push. Verify V1 tag unchanged.

---

## Self-Review

- **Spec coverage:** proposal ① three parts → Task 1 (key tiering), Task 2 (RLS policies + RPC DEFINER fix), Task 3 (RPC-only write path + contract test). Owner-apply + canary + Portal lockstep recorded pending.
- **Placeholder scan:** none — interfaces and rules concrete.
- **Type consistency:** `getClientForRole`/`resolveTierForRequest`/`assertServerOnly`/`writeViaRpc` used consistently across tasks.
- **Coexistence:** every V3 entrypoint guards on `getEffectiveMode()==='v3'`; v1/v2 never construct the tiered client → V1 path byte-identical.
