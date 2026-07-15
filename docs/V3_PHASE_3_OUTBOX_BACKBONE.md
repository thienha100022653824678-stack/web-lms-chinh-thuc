# V3 Phase 3 (④⑤) — Outbox Backbone + Worker

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-outbox` 6, `v3-outbox-migration` 5; full suite 202/202). Owner-only step (apply `migration_v3_outbox_dead_letters.sql` on B) + background-worker infra (pg_cron/queue) recorded **pending** — do NOT block auto-advance to Phase 4.
>
> **Goal:** promote the outbox from V2's shadow role to V3's canonical integration backbone, and complete the partially-applied outbox by adding the missing `sync_dead_letters` table.

## What this phase added

| File | Role |
|---|---|
| `migration_v3_outbox_dead_letters.sql` | Additive, idempotent, owner-applied. Creates `sync_dead_letters` (VERIFIED never created on production though the V2 worker writes to it — a broken DLQ path). Shape lifted verbatim from `migration_v2_sync_outbox.sql`; RLS-on service-role-only. |
| `utils/v3-outbox.js` | `enqueueV3Event({...})` — v3-gated canonical enqueue: deterministic idempotency key (reuses `buildOutboxIdempotencyKey`), stamps `runtime_version:'v3'` into the payload, upserts on `idempotency_key` (exactly-once enqueue). `projectEvent(event, applyFn)` — idempotent projector: skips non-v3 events (compatibility contract), applies once per idempotency key. |
| `tests/v3-outbox.test.mjs` (6), `tests/v3-outbox-migration.test.mjs` (5) | v3-gating, runtime-version stamping, deterministic key, projector skip/once semantics; migration additive-only + shape assertions. |
| `supabase/drift_allowlist.json` | Dropped `sync_dead_letters` from `tables` — it's now migration-declared, no longer "accepted absent". |

## Canonical vs shadow

- **V2 (shadow):** the canonical write was a direct table mutation in `syncEnrollment`; the outbox observed alongside and was flag-gated. Partial success (enrollment written, Drive failed) was possible (REL-01).
- **V3 (canonical):** a V3 business write emits an event via `enqueueV3Event` in the same logical unit. A projector builds each read model (Portal projection, Drive permission) from the event. Delivery targets are independent `sync_deliveries` rows keyed `unique(outbox_id, target_system)` — Drive failing retries on its own target while the enrollment event stays acked. Partial success no longer corrupts state; reconciliation = projection vs source.

## Worker (⑤)

The claim/lease worker already exists and is production-shaped: `utils/v2-sync-worker.js` (`claimOutboxEvent`, `locked_by`, retry/backoff, `moveOutboxToDeadLetter`) driven by `api/v2/sync-worker.js`. Phase 3 reuses it under v3 gating rather than building new worker code. A truly request-independent runner (pg_cron polling the outbox, or a queue service — Inngest/QStash) is **owner infrastructure**, recorded pending; the repo path is complete and testable without it.

## Owner action pending (does NOT block auto-advance)

1. **Apply `migration_v3_outbox_dead_letters.sql` on Supabase B** — restores the DLQ path the V2 worker already depends on. Additive, safe, re-runnable.
2. **Background worker infra** (optional, ⑤ full form): provision pg_cron or a queue service to drive `api/v2/sync-worker.js` independent of request traffic. Until then the worker runs on the existing trigger.

## Test bar met (Phase 3)

- `node --test tests/*.test.mjs` → 202/202, 0 fail.
- Only new V3-only files added (`utils/v3-outbox.js`) + additive migration; V2 outbox/worker code untouched → V1/V2 path unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched. No production write.
