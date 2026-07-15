// utils/v3-metrics.js
// V3 Phase 6 (⑪) — read-only operational metrics for the diagnostics dashboard.
//
// Reads (never writes) the health signals the V3 platform cares about: outbox
// depth by status, delivery success rate, dead-letter count, RLS-deny count,
// and the current effective runtime mode. Productizes the numbers V2 already
// surfaces (utils/v2-diagnostics.js) plus V3-specific signals, in a shape the
// admin diagnostics UI (⑨) can render.
//
// Pure read path: uses the service-role client. Never throws — a failed probe
// returns { ok:false, message } so the dashboard degrades gracefully.

import { supabase } from './supabase.js';
import { getEffectiveMode, getConfig } from './runtime-controller.js';

function compactError(error) {
  return String(error?.message || error || 'metric error').slice(0, 300);
}

async function countRows(table, buildQuery) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (buildQuery) query = buildQuery(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

const OUTBOX_STATUSES = ['pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled'];

// Outbox depth by status + a derived delivery success rate.
export async function getOutboxMetrics() {
  try {
    const counts = {};
    for (const status of OUTBOX_STATUSES) {
      counts[status] = await countRows('sync_outbox', (q) => q.eq('status', status));
    }
    const delivered = counts.delivered || 0;
    const failed = (counts.failed || 0) + (counts.dead_letter || 0);
    const totalTerminal = delivered + failed;
    const successRate = totalTerminal > 0 ? Number((delivered / totalTerminal).toFixed(4)) : null;
    const pending = (counts.pending || 0) + (counts.processing || 0);
    return { ok: true, counts, pending, successRate };
  } catch (error) {
    return { ok: false, message: compactError(error) };
  }
}

// Delivery target health (pending deliveries, dead letters).
export async function getDeliveryMetrics() {
  try {
    const pendingDeliveries = await countRows('sync_deliveries', (q) => q.eq('status', 'pending'));
    const failedDeliveries = await countRows('sync_deliveries', (q) => q.eq('status', 'failed'));
    let deadLetters = 0;
    try {
      deadLetters = await countRows('sync_dead_letters');
    } catch {
      // sync_dead_letters may not be applied yet on this DB (owner-pending) —
      // report -1 as "unknown / table absent" rather than failing the whole probe.
      deadLetters = -1;
    }
    return { ok: true, pendingDeliveries, failedDeliveries, deadLetters };
  } catch (error) {
    return { ok: false, message: compactError(error) };
  }
}

// RLS-deny signal. We can't read Postgres deny counters directly via PostgREST,
// so we expose a placeholder the log-based collector (v3-logs 'rls_deny' events)
// fills in. Here we report the current runtime posture so the dashboard shows
// whether RLS policies are expected to be active (v3) or bypassed (v1/v2 service
// role). Never throws.
export async function getRuntimePosture() {
  try {
    const mode = await getEffectiveMode();
    const cfg = await getConfig();
    return {
      ok: true,
      effective_mode: mode,
      kill_switch: Boolean(cfg.kill_switch),
      v2_shadow: Boolean(cfg.v2_shadow_mode),
      v3_shadow: Boolean(cfg.v3_shadow_mode),
      rls_enforced: mode === 'v3', // v3 uses anon/authenticated keys => RLS enforced
    };
  } catch (error) {
    return { ok: false, message: compactError(error) };
  }
}

// The dashboard payload. Aggregates every probe; each degrades independently.
export async function collectV3Metrics() {
  const [outbox, delivery, posture] = await Promise.all([
    getOutboxMetrics(),
    getDeliveryMetrics(),
    getRuntimePosture(),
  ]);
  return {
    ok: outbox.ok && delivery.ok && posture.ok,
    generatedAt: new Date().toISOString(),
    outbox,
    delivery,
    posture,
  };
}
