# V3 Phase 3 (④⑤) — Outbox Backbone + Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the outbox the canonical integration backbone in V3 (not the V2 shadow): a V3 write emits an event through `writeViaRpc`/`enqueue` in the same logical unit as its business write, a projector builds read models idempotently, and delivery targets (Portal projection, Drive permission) each succeed/retry independently so partial success cannot corrupt state. Complete the partially-applied outbox by adding the missing `sync_dead_letters` table.

**Architecture:** V3-only additive code gated on `getEffectiveMode()==='v3'`, reusing the proven V2 outbox/worker plumbing (`utils/v2-outbox.js`, `utils/v2-sync-worker.js`, `utils/v2-delivery-handlers.js`) rather than rebuilding it. New `utils/v3-outbox.js` wraps enqueue with a `runtime_version` stamp + idempotency key and exposes an idempotent projector helper. The V2 worker already references `sync_dead_letters` (VERIFIED missing on production) — an additive migration creates it so the DLQ path is complete.

**Tech Stack:** Node 24 (`node:test`, ESM), `@supabase/supabase-js`, Postgres, Phase 0 controller + Phase 2 write path.

## Global Constraints

- Additive-only migrations. No DROP/RENAME/ALTER TYPE.
- V3-only code gated on `getEffectiveMode()`. v1/v2 behavior identical to today.
- No production writes: migration owner-applied, recorded pending, does NOT block auto-advance.
- Idempotency: every event carries a deterministic idempotency key; the projector/consumer is safe to run twice (no double-effect).
- Compatibility contract: events stamped `runtime_version`; V1/V2 consumers skip rows not stamped for them.
- No secret in commits. Don't touch main, tag v1-stable-20260713, Portal repo.
- Phase bar: `node --test` green + secret scan + V1 path unchanged + commit + push.
- If a new committed file contains `V2_GLOBAL_ONE_DEVICE_ENABLED`, add it to the allow-list in `tests/rp2b1-session-device.test.mjs`. (Phase 3 files avoid it.)

---

### Task 1: `sync_dead_letters` additive migration

**Files:**
- Create: `migration_v3_outbox_dead_letters.sql`
- Test: `tests/v3-outbox-migration.test.mjs`

The migration mirrors the shape the V2 worker already writes (`utils/v2-sync-worker.js` `moveOutboxToDeadLetter`: `outbox_id` unique, `reason`, `payload`, `last_error`, `updated_at`, status open/resolved/ignored). `CREATE TABLE IF NOT EXISTS` + indexes + `ENABLE ROW LEVEL SECURITY` (no public policy — service-role only), matching `migration_v2_sync_outbox.sql`'s third table exactly so applying it reconciles prod to the original intent.

- [ ] **Step 1:** Write `tests/v3-outbox-migration.test.mjs`: additive-only (no DROP/RENAME/ALTER TYPE in executable SQL — strip `--` comments); contains `CREATE TABLE IF NOT EXISTS public.sync_dead_letters`, the `outbox_id ... unique references public.sync_outbox`, the status CHECK, `ENABLE ROW LEVEL SECURITY`.
- [ ] **Step 2:** Run → FAIL (file absent).
- [ ] **Step 3:** Write `migration_v3_outbox_dead_letters.sql` (lift the `sync_dead_letters` block + its index from `migration_v2_sync_outbox.sql`, add RLS enable).
- [ ] **Step 4:** Run → PASS. Remove `sync_dead_letters` from `supabase/drift_allowlist.json` `tables` (now declared by a migration, no longer "accepted absent") — update the schema-diff test that references it if needed.
- [ ] **Step 5:** Full suite → pass. Commit.

### Task 2: `utils/v3-outbox.js` backbone + tests

**Files:**
- Create: `utils/v3-outbox.js`
- Test: `tests/v3-outbox.test.mjs`

**Interfaces:**
- Produces:
  - `enqueueV3Event({sourceSystem, aggregateType, aggregateId, eventType, payload, priority}) -> {id,status,idempotency_key}` — v3-gated; builds a deterministic idempotency key; stamps `runtime_version:'v3'` into the payload; upserts on `idempotency_key` (reuses `buildOutboxIdempotencyKey` from `utils/v2-outbox.js`).
  - `projectEvent(event, applyFn) -> {applied:boolean, idempotent:boolean}` — runs `applyFn` only if the event's `runtime_version` is `v3` (skips others per contract); dedups by idempotency key so a re-run is a no-op.
- Consumes: `getEffectiveMode`, `stampEvent` (`utils/runtime-controller.js`); `getClientForRole` (`utils/v3-db.js`); `buildOutboxIdempotencyKey` (`utils/v2-outbox.js`).

- [ ] **Step 1:** Write `tests/v3-outbox.test.mjs` (stub Supabase): `enqueueV3Event` refuses unless v3 mode; stamps `runtime_version:'v3'` in the upserted payload; a stable idempotency key for identical inputs; `projectEvent` skips a `runtime_version:'v1'` event (returns `{applied:false}`); `projectEvent` runs `applyFn` once for a v3 event and is a no-op on a second identical call.
- [ ] **Step 2:** Run → FAIL (module absent).
- [ ] **Step 3:** Implement `utils/v3-outbox.js`.
- [ ] **Step 4:** Run → PASS. Full suite → pass.
- [ ] **Step 5:** Commit.

### Task 3: docs + status + push

**Files:**
- Create: `docs/V3_PHASE_3_OUTBOX_BACKBONE.md`
- Modify: `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` (status line)

- [ ] **Step 1:** Write `docs/V3_PHASE_3_OUTBOX_BACKBONE.md`: what shipped, how the canonical outbox differs from V2 shadow, the DLQ completion, owner-apply step for the migration, worker reuse note (⑤ = productize existing `api/v2/sync-worker.js` claim/lease under v3 gating — no new worker infra this phase; pg_cron/queue service is owner infra deferred).
- [ ] **Step 2:** Update transfer-doc status line → Phase 3 done (repo), migration owner-pending.
- [ ] **Step 3:** Secret scan, reset stub to `{}`, commit + push. Verify V1 tag unchanged.

---

## Self-Review

- **Spec coverage:** ④ (outbox canonical + idempotent projector + independent delivery via existing handlers) → Tasks 1+2. ⑤ (real worker) → documented as reuse of the V2 claim/lease worker under v3 gating; new background infra (pg_cron/queue) is owner-provisioned, recorded pending. DLQ gap (`sync_dead_letters`) → Task 1.
- **Placeholder scan:** none.
- **Type consistency:** `enqueueV3Event`/`projectEvent`/`buildOutboxIdempotencyKey` consistent; reuses V2 helper names verbatim.
