import crypto from 'crypto';

import { supabase } from './supabase.js';
import { deliverV2Target, isV2DeliveryHandlersEnabled } from './v2-delivery-handlers.js';
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
  const { data: existing, error: fetchError } = await supabase
    .from('sync_deliveries')
    .select('id,status')
    .eq('outbox_id', outboxId)
    .eq('target_system', targetSystem)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('sync_deliveries')
    .insert({
      outbox_id: outboxId,
      target_system: targetSystem,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .select('id,status')
    .single();

  if (error) throw error;
  return data;
}

async function listDeliveriesForOutbox(outboxId) {
  const { data, error } = await supabase
    .from('sync_deliveries')
    .select('id,outbox_id,target_system,status,attempt_count')
    .eq('outbox_id', outboxId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function markDeliveryResult(delivery, result) {
  const status = ['pending', 'success', 'failed', 'skipped'].includes(result.status)
    ? result.status
    : 'failed';
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('sync_deliveries')
    .update({
      status,
      attempt_count: (delivery.attempt_count || 0) + 1,
      response_summary: result.summary ? String(result.summary).slice(0, 500) : null,
      error_message: status === 'failed' ? compactError(result.error || result.summary) : null,
      delivered_at: status === 'success' || status === 'skipped' ? now : null,
      updated_at: now,
    })
    .eq('id', delivery.id);

  if (error) throw error;
}

async function markOutboxDelivered(eventId, workerId) {
  const { error } = await supabase
    .from('sync_outbox')
    .update({
      status: 'delivered',
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('locked_by', workerId);

  if (error) throw error;
}

async function moveOutboxToDeadLetter(event, workerId, message) {
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('sync_outbox')
    .update({
      status: 'dead_letter',
      locked_at: null,
      locked_by: null,
      last_error: message,
      attempt_count: (event.attempt_count || 0) + 1,
      updated_at: now,
    })
    .eq('id', event.id)
    .eq('locked_by', workerId);

  if (updateError) throw updateError;

  const { error: deadLetterError } = await supabase
    .from('sync_dead_letters')
    .upsert({
      outbox_id: event.id,
      reason: message || 'V2 delivery failed too many times.',
      payload: event.payload || {},
      last_error: message || null,
      updated_at: now,
    }, { onConflict: 'outbox_id' });

  if (deadLetterError) throw deadLetterError;
}

async function scheduleOutboxRetry(event, workerId, message) {
  const attemptCount = (event.attempt_count || 0) + 1;
  const maxAttempts = Number(event.max_attempts || 10);
  if (attemptCount >= maxAttempts) {
    await moveOutboxToDeadLetter(event, workerId, message);
    return { status: 'dead_letter', attemptCount };
  }

  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attemptCount, 6)));
  const availableAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('sync_outbox')
    .update({
      status: 'pending',
      locked_at: null,
      locked_by: null,
      last_error: message,
      attempt_count: attemptCount,
      available_at: availableAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', event.id)
    .eq('locked_by', workerId);

  if (error) throw error;
  return { status: 'retry_scheduled', attemptCount, availableAt };
}

async function executeDeliveriesForEvent(event, workerId) {
  const targets = getDeliveryTargetsForEvent(event);
  for (const target of targets) {
    await ensurePendingDelivery(event.id, target);
  }

  const deliveries = await listDeliveriesForOutbox(event.id);
  const outcomes = [];
  const failures = [];
  const pending = [];

  for (const delivery of deliveries) {
    if (delivery.status === 'success' || delivery.status === 'skipped') {
      outcomes.push({
        target: delivery.target_system,
        status: delivery.status,
        code: 'already_terminal',
      });
      continue;
    }

    try {
      const result = await deliverV2Target({
        supabase,
        event,
        target: delivery.target_system,
      });
      await markDeliveryResult(delivery, result);
      outcomes.push({
        target: delivery.target_system,
        status: result.status,
        code: result.code,
      });
      if (result.status === 'pending') {
        pending.push({
          target: delivery.target_system,
          code: result.code,
          summary: result.summary,
        });
      }
    } catch (error) {
      const message = compactError(error) || 'V2 delivery failed.';
      await markDeliveryResult(delivery, {
        status: 'failed',
        summary: message,
        error,
      });
      failures.push({
        target: delivery.target_system,
        code: error.code || 'delivery_failed',
        error: message,
      });
    }
  }

  if (failures.length > 0) {
    const retry = await scheduleOutboxRetry(event, workerId, failures.map((failure) => `${failure.target}: ${failure.error}`).join(' | '));
    return {
      status: retry.status,
      outcomes,
      failures,
      retry,
    };
  }

  if (pending.length > 0) {
    await releaseClaimAsPending(
      event.id,
      workerId,
      pending.map((item) => `${item.target}: ${item.summary || item.code}`).join(' | ')
    );
    return {
      status: 'pending_delivery',
      outcomes,
      failures: [],
      pending,
    };
  }

  await markOutboxDelivered(event.id, workerId);
  return {
    status: 'delivered',
    outcomes,
    failures: [],
  };
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

      if (!isV2DeliveryHandlersEnabled()) {
        await releaseClaimAsPending(
          claimed.id,
          workerId,
          'V2 delivery handlers are disabled; deliveries were planned only.'
        );

        processed.push({
          id: claimed.id,
          eventType: claimed.event_type,
          targets,
          status: 'planned_only',
        });
        continue;
      }

      const deliveryResult = await executeDeliveriesForEvent(claimed, workerId);
      processed.push({
        id: claimed.id,
        eventType: claimed.event_type,
        targets,
        status: deliveryResult.status,
        outcomes: deliveryResult.outcomes,
        failures: deliveryResult.failures,
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
    mode: isV2DeliveryHandlersEnabled() ? 'delivery_handlers' : 'plan_deliveries_only',
    workerId,
    processed: processed.length,
    planned,
    deliveriesPlanned: processed,
    errors,
  };
}
