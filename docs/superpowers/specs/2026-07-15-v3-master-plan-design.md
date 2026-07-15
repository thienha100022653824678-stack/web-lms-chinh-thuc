# V3 Master Plan — Runtime-controlled platform (①–⑫)

> **Status:** APPROVED by owner 2026-07-15. Spec for the full V3 program, scoped as a runtime-controlled platform where V1, V2, and V3 coexist and the owner selects the active version at runtime.
>
> **Owner's requirements (verbatim intent):**
> - Master plan for all of V3 (①–⑫), split into ordered dependent phases.
> - Implement phases sequentially across this session and following turns; auto-advance when a phase's tests pass.
> - Stop only at real owner-only blockers, never because "the work is large" or "takes weeks".
> - V1, V2, V3 must coexist. Owner rotates versions at runtime via runtime mode / feature flags.
> - No self-cutover of production. Owner flips the version they want after V3 tests complete.
>
> **Mandatory architecture:**
> - A unified runtime controller, e.g. `PLATFORM_RUNTIME_MODE=v1|v2|v3` (or better equivalent).
> - Exactly one version performs authoritative writes at a time. No concurrent V1/V2/V3 writes to the same row.
> - Separate shadow mode for V2 and V3.
> - A kill switch. Instant rollback to V1. No redeploy required where a safe runtime-config path exists.
> - Every event, log, and delivery must record its runtime version.
> - Compatibility contract: data produced by V3 must not break V1/V2 on rollback.
> - Migrations always expand-first, additive-only until owner approves final cleanup.

---

## 1. Constraints inherited from V2 (must hold throughout V3)

- **V1 immutable:** `main` / tag `v1-stable-20260713` = `f9220e8` is the rollback target. Never touch until a canary is clean.
- **Expand-and-contract:** additive-only migrations (`ADD COLUMN nullable`, `CREATE TABLE/INDEX/RPC`). No `DROP`/`RENAME`/`ALTER TYPE` until Phase 3 + owner approval.
- **Feature flag + canary + rollback drill:** every new behavior behind a flag; rollback = flag off + alias (not migration reversal).
- **No logging secrets/tokens/private keys/service-role.** Mask email, hash ip/device, hash user_agent.
- **Data ownership:** Supabase B canonical, A projection. Repair needs audit + dry-run, no auto-revoke.
- **12 V1 invariants + V1 keep-behaviors** must hold across all versions.
- **Portal lockstep:** any session/one-device policy change must sync with the `student-web` repo.
- **Test first:** `node --test`, contract tests vs schema, supabase stub. No merge without test.

---

## 2. Runtime controller design (the spine of the whole program)

### 2.1 Mechanism (chosen)

**DB-backed Supabase table** `platform_runtime_config` (single row, on Supabase B), read by a controller util that caches in-memory for ~3–5s. Flip via SQL Editor or an admin endpoint. Kill switch to V1 within the cache TTL — **no redeploy**.

Rationale over alternatives:
- *Vercel Edge Config:* sub-100ms edge reads, but Vercel-coupled, eventual consistency on writes, adds a vendor surface. Reuse existing Supabase instead.
- *Env var only:* simplest, but flipping requires redeploy, so instant rollback is impossible until a later phase anyway. We build DB-backed now so the kill switch exists from Phase 0.

### 2.2 Schema (additive, one migration, owner-applied)

```sql
-- migration_v3_runtime_config.sql (Phase 0, owner-applied)
CREATE TABLE IF NOT EXISTS public.platform_runtime_config (
  id smallint PRIMARY KEY DEFAULT 1,
  active_mode text NOT NULL DEFAULT 'v1'
    CHECK (active_mode IN ('v1','v2','v3')),
  v2_shadow_mode boolean NOT NULL DEFAULT false,
  v3_shadow_mode boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,   -- true => force v1 regardless
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_runtime_config_singleton CHECK (id = 1)
);
ALTER TABLE public.platform_runtime_config ENABLE ROW LEVEL SECURITY;
-- Service-role bypasses RLS; admin endpoint + SQL Editor (service-role) write it.
-- No anon/authenticated policy => browser cannot read/write it.
INSERT INTO public.platform_runtime_config (id, active_mode) VALUES (1, 'v1')
  ON CONFLICT (id) DO NOTHING;

-- Audit (append-only) for every flip
CREATE TABLE IF NOT EXISTS public.platform_runtime_config_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  active_mode text NOT NULL,
  v2_shadow_mode boolean,
  v3_shadow_mode boolean,
  kill_switch boolean,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_runtime_config_audit ENABLE ROW LEVEL SECURITY;
```

No business data; singleton config + append-only audit. Owner applies via SQL Editor or admin endpoint (service-role). Rollback of this migration = `DROP TABLE` (safe, no business data) — but only if V3 is fully rolled back.

### 2.3 Controller util: `utils/runtime-controller.js` (new, V3-only, no V1/V2 file edits)

```js
// Read + in-memory cache (TTL ~3s). Default v1 on any read failure.
// getActiveMode()        => 'v1' | 'v2' | 'v3'
// isShadowEnabled(ver)   => boolean (for v2/v3)
// isKillSwitchOn()       => boolean (true => force v1)
// getEffectiveMode()     => kill_switch ? 'v1' : active_mode
// stampEvent(event)      => returns event with runtime_version + schema_version stamped
// NEVER performs writes. Writes go through admin endpoint or SQL Editor.
```

**Fail-closed:** any read error / missing row => `v1`. Kill switch true => `v1` regardless of `active_mode`. This makes "instant rollback to V1" literally a row update (`kill_switch=true` or `active_mode='v1'`).

### 2.4 Single-writer invariant

`getEffectiveMode()` is the one gate. Every write path branches on it:
- `v1` => existing V1 code path, unchanged.
- `v2` => V2 path (already exists, `api/v2/*` + `utils/v2-*.js`).
- `v3` => V3 path (built phase by phase).

Only the effective mode's write path runs. Shadow modes run read-only side-by-side (they observe and log, they do not write business data unless their version is active). No two versions write the same row concurrently by construction.

### 2.5 Version stamping on every event/log/delivery

Every outbox event, structured log, and delivery record gets a `runtime_version` field (`v1`/`v2`/`v3`) plus existing `schema_version`. The controller's `stampEvent` enforces this; outbox/observability phases (④/⑪) consume it.

### 2.6 Compatibility contract (data must not break V1/V2 on rollback)

- V3 writes only to **additive** columns/tables. V1/V2 ignore columns they don't know.
- V3 never writes a value into a shared column that V1/V2 would misinterpret (no semantic overload of an existing column).
- V3 outbox/delivery records carry `runtime_version`; V1/V2 consumers skip rows not stamped for them (or rows they don't understand).
- Contract test (Phase 1+): write a row as V3, read it back through the V1 code path, assert V1 sees a valid V1-shaped view.

---

## 3. Phase graph (dependency order)

```
Phase 0  Runtime controller spine (config table + util + stamping + tests)   [foundation, no business behavior]
   │
   ├─► Phase 1  ⑦ Migration tooling + CI schema-drift gate + baseline B       [needs controller to stamp migrations' runtime_version]
   │      │
   │      ├─► Phase 2  ① RLS + key tiering + RPC write path                   [needs baseline + gate to change schema safely]
   │      │      │
   │      │      └─► Phase 3  ④ Outbox as integration backbone + ⑤ worker    [needs RPC write path + schema gate]
   │      │             │
   │      │             └─► Phase 4  ② Session unify + ③ server device-id     [needs outbox + RLS; Portal lockstep]
   │      │
   │      └─► Phase 5  ⑥ Router split + edge runtime for read-only            [needs schema gate; parallel to 2-4]
   │
   ├─► Phase 6  ⑪ Structured logs + metrics + tracing                         [needs controller stamping; can start after Phase 0]
   │
   ├─► Phase 7  ⑨ FE modular / SPA admin + diagnostics dashboard              [after backend phases; can start after Phase 6]
   │      │
   │      └─► Phase 8  ⑩ TypeScript + monorepo + shared event schema          [needs stable event schema from ④/⑪]
   │
   └─► Phase 9  ⑫ Signed-URL CDN per-session + DRM (opt-in per course)        [needs session unify ②; independent track]
            │
            └─► Phase 10  ⑧ Dead code/schema cleanup                          [LAST, only after owner approves final cleanup]
```

**Critical path (longest dependent chain):** 0 → 1 → 2 → 3 → 4. These must complete in order. Phase 5/6/7/8/9/10 can interleave once their dependencies are met.

### 3.1 Phase-to-proposal map

| Phase | Proposal(s) | Touches | Owner-only steps |
|---|---|---|---|
| 0 | (spine) | repo: `utils/runtime-controller.js`, `api/v2/runtime.js`, `migration_v3_runtime_config.sql`, tests; B: 1 migration (owner-apply) | apply runtime_config migration on B |
| 1 | ⑦ | repo: `supabase/` CLI dir, baseline, seeds, CI gate, drift allowlist, ERD, docs | `db pull`, `migration repair --status applied`, drill rollback, create read-only CI role |
| 2 | ① | repo: RPC SECURITY DEFINER write path, key tiering, RLS policy migrations; Portal lockstep | apply RLS migrations on B (after canary), Portal PR |
| 3 | ④⑤ | repo: outbox-as-backbone, projector, idempotent consumer, worker claim/lease | apply outbox migrations (additive), seed `sync_dead_letters` |
| 4 | ②③ | repo: session unify, server-minted device credential; Portal lockstep (FE) | apply session migrations, Portal PR (FE onboarding) |
| 5 | ⑥ | repo: per-route functions, edge runtime for read-only | none (code only) |
| 6 | ⑪ | repo: structured log util, metrics, correlation_id everywhere | none (code only) |
| 7 | ⑨ | repo: ES-module admin split, diagnostics dashboard UI | none (code only) |
| 8 | ⑩ | repo: TS migration, pnpm workspace, shared event-schema pkg | none (code only, large) |
| 9 | ⑫ | repo: signed-URL bound session, DRM opt-in | Bunny/DRM provider config |
| 10 | ⑧ | repo: drop dead schema, formalize drift columns | owner approves final cleanup |

---

## 4. Phase completion bar (what "tests pass" means per phase)

Each phase must satisfy before auto-advancing:
1. **`node --test` green** for new/affected tests (stub Supabase via `*_STUB=1`).
2. **No secret in any committed file** (scan: service-role JWT, `sbp_`, DB URL with password, access token).
3. **No production write** unless the phase's owner-step is explicitly approved (audit log for any config flip).
4. **V1 path unchanged & green:** running in `v1` mode produces V1 behavior exactly (contract test).
5. **Compatibility contract test green** where the phase produces data (V3 data readable by V1 path).
6. **Docs updated:** the phase's spec section + `V3_SYSTEM_KNOWLEDGE_TRANSFER.md` status line.
7. **Committed on `v3/research-20260715`** (or a sub-branch merged back), pushed. main + V1 tag untouched.

Owner-only production steps do **not** block auto-advance of the repo work; they are recorded as "owner action pending" and the phase's test bar is met by stubs + local migration apply + dry-run gate.

---

## 5. What I will NOT do (guardrails)

- No self-cutover: I never set `active_mode` to `v2`/`v3` in production. That is the owner's flip.
- No migration `db push` to production without an owner action recorded in audit.
- No `DROP`/`RENAME`/`ALTER TYPE` until Phase 10 + owner approval.
- No touching `main`, `v1-stable-20260713`, or the Portal repo's production branch (Portal PRs are proposed, owner merges).
- No logging secrets.
- No stopping because a phase is large; I stop only at a real owner-only blocker (production DB access, provider config, Portal merge, final cleanup approval).

---

## 6. Phase 0 detail (what starts this turn)

**Goal:** the runtime controller spine. After Phase 0, the system can read `PLATFORM_RUNTIME_MODE` from DB, default/fail-closed to v1, stamp events with runtime version, and expose an admin endpoint to flip (service-role guarded). No business behavior changes yet.

**Deliverables:**
1. `migration_v3_runtime_config.sql` — additive, owner-applied (the two tables above).
2. `utils/runtime-controller.js` — read + cache + fail-closed + stamping.
3. `api/v2/runtime.js` — admin endpoint: `GET /api/v2/runtime` (read config), `POST /api/v2/runtime` (flip, service-role only, audit write). No anon/authenticated access.
4. `test/runtime-controller.test.js` — `node --test`: default v1, kill switch forces v1, cache TTL, stamping, fail-closed on read error, single-writer branching.
5. `docs/V3_PHASE_0_RUNTIME_CONTROLLER.md` — what it does, how to flip, rollback (= set `active_mode='v1'` or `kill_switch=true`), owner apply step.
6. Update `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` — add Phase 0 status line.

**Test bar for Phase 0:** `node --test` green; no secret; V1 path unchanged (controller returns v1 by default, no V1 file edited); committed + pushed.

**Owner action pending after Phase 0:** apply `migration_v3_runtime_config.sql` on Supabase B (1 additive migration, RLS on, no business data). Until applied, controller reads nothing => fail-closed to v1 (safe).

---

## 7. Self-review notes

- No placeholders/TBD: phase graph is complete, each phase mapped to a proposal with owner-steps.
- Internal consistency: the controller (Phase 0) is a dependency of ①-⑫ stamping, and Phase 1 (⑦) provides the schema gate that ①/④/② need — graph reflects this.
- Scope: this is a master plan (program-level). Each phase gets its own focused implementation plan via the writing-plans skill before coding that phase. Phase 0 is scoped tightly enough to implement directly after this spec.
- Ambiguity resolved: "instant rollback to V1" = `kill_switch=true` OR `active_mode='v1'` row update (within cache TTL, no redeploy). "single writer" = `getEffectiveMode()` is the sole gate; shadow modes are read-only unless active.
