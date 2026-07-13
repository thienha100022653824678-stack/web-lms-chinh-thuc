import { supabase } from './supabase.js';
import { buildPortalProjectionPayload } from './v2-portal-projection.js';

const EMAIL_PATTERN = /([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function cleanText(value) {
  return String(value || '').trim();
}

function compactError(error) {
  return String(error?.message || error || 'Unknown Portal projection preview error').slice(0, 500);
}

function maskEmail(value) {
  return cleanText(value).replace(EMAIL_PATTERN, (_, prefix, domain) => `${prefix}***@${domain}`);
}

function sanitizeValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        /token|secret|password|private_key|service_role|api_key|authorization|cookie/i.test(key)
          ? '[redacted]'
          : sanitizeValue(entryValue),
      ])
    );
  }
  if (typeof value === 'string') return maskEmail(value).slice(0, 1000);
  return value;
}

function sanitizeEvent(event) {
  return {
    id: event.id,
    sourceSystem: event.source_system,
    aggregateType: event.aggregate_type,
    aggregateId: sanitizeValue(event.aggregate_id),
    eventType: event.event_type,
    status: event.status,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
}

async function loadOutboxEvent(outboxId) {
  const { data, error } = await supabase
    .from('sync_outbox')
    .select('id,source_system,aggregate_type,aggregate_id,event_type,payload,status,created_at,updated_at')
    .eq('id', outboxId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function previewPortalProjectionForOutbox(input = {}) {
  const outboxId = cleanText(input.outboxId || input.outbox_id || input.id);
  if (!outboxId) {
    return {
      ok: false,
      mode: 'read_only',
      code: 'missing_outbox_id',
      message: 'outboxId is required.',
    };
  }

  try {
    const event = await loadOutboxEvent(outboxId);
    if (!event) {
      return {
        ok: false,
        mode: 'read_only',
        code: 'outbox_not_found',
        message: 'No sync_outbox event was found for this id.',
      };
    }

    const body = await buildPortalProjectionPayload({ supabase, event });

    return {
      ok: true,
      mode: 'read_only',
      generatedAt: new Date().toISOString(),
      outbox: sanitizeEvent(event),
      portalProjection: {
        endpoint: '/api/sync',
        method: 'POST',
        body: sanitizeValue(body),
      },
      note: 'Preview only. This endpoint does not send the payload or mutate sync_outbox rows.',
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'read_only',
      code: error.code || 'portal_projection_preview_failed',
      message: compactError(error),
    };
  }
}
