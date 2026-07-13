import crypto from 'crypto';

import { supabase } from './supabase.js';
import { getV2Env, isV2FlagEnabled, V2_FLAGS } from './v2-flags.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function clampLimit(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function compactError(error) {
  if (!error) return null;
  return String(error.message || error).slice(0, 500);
}

function cleanText(value) {
  return String(value || '').trim();
}

function isTrueLike(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(cleanText(value).toLowerCase());
}

export function isV2SyncWorkerEnabled() {
  return isV2FlagEnabled(V2_FLAGS.OUTBOX_WORKER_ENABLED);
}

export function isV2SyncWorkerDryRun() {
  return isV2FlagEnabled(V2_FLAGS.OUTBOX_WORKER_DRY_RUN, true);
}

export function createV2WorkerId(prefix = 'v2-sync-worker') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

export function getV2SyncWorkerSecret() {
  return getV2Env('V2_WORKER_SECRET') || getV2Env('INTERNAL_SYNC_SECRET');
}

export function assertV2WorkerAuthorized(req) {
  const expectedSecret = getV2SyncWorkerSecret();
  const providedSecret = cleanText(req.headers['x-v2-worker-secret'] || req.headers['x-sync-secret']);

  if (!expectedSecret || providedSecret !== expectedSecret) {
    const error = new Error('Unauthorized V2 worker request');
    error.statusCode = 401;
    throw error;
  }
}

export function parseV2Boolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return isTrueLike(value);
}

export function getDeliveryTargetsForEvent(event) {
  const payloadTargets = Array.isArray(event?.payload?.targets)
    ? event.payload.targets.map(cleanText).filter(Boolean)
    : [];
  if (payloadTargets.length > 0) return [...new Set(payloadTargets)];

  const eventType = cleanText(event?.event_type);
  if (eventType.startsWith('course.')) return ['portal_projection'];
  if (eventType.startsWith('enrollment.')) return ['portal_projection', 'drive_permission'];
  if (eventType.startsWith('drive.')) return ['drive_permission'];

  return ['manual_review'];
}

export async function listPendingOutboxEvents({ limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = clampLimit(limit);
  const { data, error } = await supabase
    .from('sync_outbox')
    .select('id,source_system,aggregate_type,aggregate_id,event_type,idempotency_key,payload,status,priority,attempt_count,max_attempts,available_at,created_at')
    .eq('status', 'pending')
    .lte('available_at', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(safeLimit);

  if (error) throw error;
  return data || [];
}

async function claimOutboxEvent(event, workerId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sync_outbox')
    .update({
      status: 'processing',
      locked_at: now,
      locked_by: workerId,
      updated_at: now,
    })
    .eq('id', event.id)
    .eq('status', 'pending')
    .select('id,source_system,aggregate_type,aggregate_id,event_type,idempotency_key,payload,status,priority,attempt_count,max_attempts,available_at,created_at')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function ensurePendingDelivery(outboxId, targetSystem) {
  const { error } = await supabase
    .from('sync_deliveries')
    .upsert({
      outbox_id: outboxId,
      target_system: targetSystem,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'outbox_id,target_system' });

  if (error) throw error;
}

async function releaseClaimAsPending(eventId, workerId, message) {
  const { error } = await supabase
    .from('sync_outbox')
    .update({
      status: 'pending',
      locked_at: null,
      locked_by: null,
      last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('locked_by', workerId);

  if (error) throw error;
}

export async function runV2SyncWorker({ limit = DEFAULT_LIMIT, dryRun = isV2SyncWorkerDryRun(), workerId = createV2WorkerId() } = {}) {
  if (!isV2SyncWorkerEnabled()) {
    return {
      ok: false,
      code: 'v2_worker_disabled',
      message: 'V2 sync worker is disabled by feature flag.',
      processed: 0,
      planned: [],
    };
  }

  const events = await listPendingOutboxEvents({ limit });
  const planned = events.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    aggregateType: event.aggregate_type,
    aggregateId: event.aggregate_id,
    targets: getDeliveryTargetsForEvent(event),
  }));

  if (dryRun) {
    return {
      ok: true,
      mode: 'dry_run',
      processed: 0,
      planned,
    };
  }

  const processed = [];
  const errors = [];

  for (const event of events) {
    let claimed = null;
    try {
      claimed = await claimOutboxEvent(event, workerId);
      if (!claimed) continue;

      const targets = getDeliveryTargetsForEvent(claimed);
      for (const target of targets) {
        await ensurePendingDelivery(claimed.id, target);
      }

      await releaseClaimAsPending(
        claimed.id,
        workerId,
        'V2 delivery handlers are not enabled yet; deliveries were planned only.'
      );

      processed.push({
        id: claimed.id,
        eventType: claimed.event_type,
        targets,
      });
    } catch (error) {
      if (claimed?.id) {
        try {
          await releaseClaimAsPending(claimed.id, workerId, compactError(error) || 'V2 worker failed while planning deliveries.');
        } catch (releaseError) {
          errors.push({
            id: claimed.id,
            error: `Failed to release V2 outbox claim: ${compactError(releaseError)}`,
          });
        }
      }
      errors.push({
        id: event.id,
        error: compactError(error),
      });
    }
  }

  return {
    ok: errors.length === 0,
    mode: 'plan_deliveries_only',
    workerId,
    processed: processed.length,
    planned,
    deliveriesPlanned: processed,
    errors,
  };
}
