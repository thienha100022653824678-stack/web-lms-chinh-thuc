// utils/v3-outbox.js
// V3 Phase 3 (④) — outbox as the canonical integration backbone.
//
// In V2 the outbox was shadow: the canonical write was still a direct table
// mutation and the outbox observed alongside. In V3 the outbox IS the
// integration path — a V3 write emits an event; a projector builds read models
// idempotently; each delivery target (Portal projection, Drive permission)
// succeeds/retries independently, so partial success cannot corrupt state.
//
// This module reuses the proven V2 plumbing (idempotency key builder, the
// sync_outbox/sync_deliveries schema, the claim/lease worker in
// utils/v2-sync-worker.js) rather than rebuilding it. It is v3-gated: every
// entrypoint refuses unless getEffectiveMode()==='v3', so v1/v2 behavior is
// unchanged.

import { getEffectiveMode, stampEvent } from './runtime-controller.js';
import { getClientForRole } from './v3-db.js';
import { buildOutboxIdempotencyKey } from './v2-outbox.js';

const SCHEMA_VERSION = '2026-07-15';

function cleanText(value) {
  return String(value || '').trim();
}

async function assertV3Mode() {
  const mode = await getEffectiveMode();
  if (mode !== 'v3') {
    throw new Error(`v3-outbox: requires v3 mode, effective mode is ${mode}`);
  }
}

// Enqueue an event onto the canonical outbox. v3-gated. Builds a deterministic
// idempotency key (reusing the V2 builder) and stamps runtime_version:'v3' into
// the payload so V1/V2 consumers skip it. Upserts on idempotency_key so a
// retried enqueue is a no-op (exactly-once enqueue).
export async function enqueueV3Event(params = {}) {
  await assertV3Mode();

  const sourceSystem = cleanText(params.sourceSystem || 'lms');
  const aggregateType = cleanText(params.aggregateType);
  const aggregateId = cleanText(params.aggregateId);
  const eventType = cleanText(params.eventType);

  if (!sourceSystem || !aggregateType || !eventType) {
    throw new Error('v3-outbox: sourceSystem, aggregateType and eventType are required');
  }

  const idempotencyKey =
    cleanText(params.idempotencyKey) ||
    buildOutboxIdempotencyKey([eventType, aggregateType, aggregateId, params.dedupe || '']);

  const basePayload = params.payload && typeof params.payload === 'object' ? params.payload : {};
  const payload = stampEvent({ ...basePayload }, 'v3', SCHEMA_VERSION);

  const client = await getClientForRole('service_role');
  const { data, error } = await client
    .from('sync_outbox')
    .upsert(
      {
        source_system: sourceSystem,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId || null,
        event_type: eventType,
        idempotency_key: idempotencyKey,
        payload,
        status: 'pending',
        available_at: params.availableAt || new Date().toISOString(),
        priority: Number.isFinite(params.priority) ? params.priority : 100,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'idempotency_key' }
    )
    .select('id,status,idempotency_key')
    .single();

  if (error) throw error;
  return data;
}

// Idempotent projector. Runs applyFn(event) only when the event is stamped for
// v3 (skips others per the compatibility contract) and only once per
// idempotency key within this process (a re-run of an already-applied key is a
// no-op). Returns {applied, idempotent, skipped}.
//
// Cross-process idempotency is the consumer's responsibility via the
// sync_deliveries unique(outbox_id, target_system) record; this in-process
// guard prevents accidental double-apply within a single worker pass.
const _appliedKeys = new Set();

export async function projectEvent(event, applyFn) {
  const runtimeVersion = cleanText(event?.payload?.runtime_version || event?.runtime_version);
  if (runtimeVersion !== 'v3') {
    return { applied: false, idempotent: false, skipped: true };
  }
  const key = cleanText(event?.idempotency_key);
  if (key && _appliedKeys.has(key)) {
    return { applied: false, idempotent: true, skipped: false };
  }
  if (typeof applyFn === 'function') {
    await applyFn(event);
  }
  if (key) _appliedKeys.add(key);
  return { applied: true, idempotent: false, skipped: false };
}

// Test hook: clear the in-process dedup set.
export const _test = {
  resetProjector() {
    _appliedKeys.clear();
  },
  SCHEMA_VERSION,
};
