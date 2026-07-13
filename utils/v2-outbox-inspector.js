import { supabase } from './supabase.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const OUTBOX_STATUSES = new Set(['pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled']);
const DELIVERY_STATUSES = new Set(['pending', 'success', 'failed', 'skipped']);
const DEAD_LETTER_STATUSES = new Set(['open', 'resolved', 'ignored']);
const RESOURCES = new Set(['outbox', 'deliveries', 'dead_letters']);
const SENSITIVE_KEY_PATTERN = /(token|secret|password|private_key|service_role|api_key|authorization|cookie)/i;
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function cleanText(value) {
  return String(value || '').trim();
}

function clampLimit(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function compactError(error) {
  return String(error?.message || error || 'Unknown V2 outbox inspector error').slice(0, 500);
}

function maskEmail(value) {
  const text = cleanText(value);
  if (!text) return '';
  return text.replace(EMAIL_PATTERN, (_, prefix, domain) => `${prefix}***@${domain}`);
}

function sanitizeText(value) {
  return maskEmail(cleanText(value)).slice(0, 1000);
}

function sanitizeValue(value, key = '') {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey),
      ])
    );
  }

  if (typeof value === 'string') return sanitizeText(value);
  return value;
}

function sanitizeAggregateId(value) {
  const text = cleanText(value);
  if (!text) return null;
  return sanitizeText(text);
}

function sanitizeOutboxRow(row) {
  return {
    id: row.id,
    sourceSystem: row.source_system,
    aggregateType: row.aggregate_type,
    aggregateId: sanitizeAggregateId(row.aggregate_id),
    eventType: row.event_type,
    status: row.status,
    priority: row.priority,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by ? sanitizeText(row.locked_by) : null,
    lastError: row.last_error ? sanitizeText(row.last_error) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: sanitizeValue(row.payload || {}),
  };
}

function sanitizeDeliveryRow(row) {
  return {
    id: row.id,
    outboxId: row.outbox_id,
    targetSystem: row.target_system,
    status: row.status,
    attemptCount: row.attempt_count,
    httpStatus: row.http_status,
    responseSummary: row.response_summary ? sanitizeText(row.response_summary) : null,
    errorMessage: row.error_message ? sanitizeText(row.error_message) : null,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeDeadLetterRow(row) {
  return {
    id: row.id,
    outboxId: row.outbox_id,
    status: row.status,
    reason: sanitizeText(row.reason),
    lastError: row.last_error ? sanitizeText(row.last_error) : null,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by ? sanitizeText(row.resolved_by) : null,
    resolutionNote: row.resolution_note ? sanitizeText(row.resolution_note) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: sanitizeValue(row.payload || {}),
  };
}

function normalizeResource(value) {
  const resource = cleanText(value || 'outbox').toLowerCase();
  return RESOURCES.has(resource) ? resource : 'outbox';
}

function normalizeStatus(resource, value) {
  const status = cleanText(value);
  if (!status) return '';
  if (resource === 'outbox' && OUTBOX_STATUSES.has(status)) return status;
  if (resource === 'deliveries' && DELIVERY_STATUSES.has(status)) return status;
  if (resource === 'dead_letters' && DEAD_LETTER_STATUSES.has(status)) return status;
  return '';
}

function buildCursor(data) {
  const last = data?.[data.length - 1];
  return last?.created_at || null;
}

function applyCommonPagination(query, cursor, limit) {
  let nextQuery = query.order('created_at', { ascending: false }).limit(limit);
  const cleanCursor = cleanText(cursor);
  if (cleanCursor) {
    nextQuery = nextQuery.lt('created_at', cleanCursor);
  }
  return nextQuery;
}

async function inspectOutbox(input) {
  const limit = clampLimit(input.limit);
  let query = supabase
    .from('sync_outbox')
    .select('id,source_system,aggregate_type,aggregate_id,event_type,payload,status,priority,attempt_count,max_attempts,available_at,locked_at,locked_by,last_error,created_at,updated_at');

  const status = normalizeStatus('outbox', input.status);
  if (status) query = query.eq('status', status);
  if (cleanText(input.sourceSystem)) query = query.eq('source_system', cleanText(input.sourceSystem));
  if (cleanText(input.aggregateType)) query = query.eq('aggregate_type', cleanText(input.aggregateType));
  if (cleanText(input.eventType)) query = query.eq('event_type', cleanText(input.eventType));

  query = applyCommonPagination(query, input.cursor, limit);

  const { data, error } = await query;
  if (error) throw error;

  return {
    items: (data || []).map(sanitizeOutboxRow),
    nextCursor: data?.length === limit ? buildCursor(data) : null,
  };
}

async function inspectDeliveries(input) {
  const limit = clampLimit(input.limit);
  let query = supabase
    .from('sync_deliveries')
    .select('id,outbox_id,target_system,status,attempt_count,http_status,response_summary,error_message,delivered_at,created_at,updated_at');

  const status = normalizeStatus('deliveries', input.status);
  if (status) query = query.eq('status', status);
  if (cleanText(input.targetSystem)) query = query.eq('target_system', cleanText(input.targetSystem));
  if (cleanText(input.outboxId)) query = query.eq('outbox_id', cleanText(input.outboxId));

  query = applyCommonPagination(query, input.cursor, limit);

  const { data, error } = await query;
  if (error) throw error;

  return {
    items: (data || []).map(sanitizeDeliveryRow),
    nextCursor: data?.length === limit ? buildCursor(data) : null,
  };
}

async function inspectDeadLetters(input) {
  const limit = clampLimit(input.limit);
  let query = supabase
    .from('sync_dead_letters')
    .select('id,outbox_id,status,reason,payload,last_error,resolved_at,resolved_by,resolution_note,created_at,updated_at');

  const status = normalizeStatus('dead_letters', input.status);
  if (status) query = query.eq('status', status);
  if (cleanText(input.outboxId)) query = query.eq('outbox_id', cleanText(input.outboxId));

  query = applyCommonPagination(query, input.cursor, limit);

  const { data, error } = await query;
  if (error) throw error;

  return {
    items: (data || []).map(sanitizeDeadLetterRow),
    nextCursor: data?.length === limit ? buildCursor(data) : null,
  };
}

export async function inspectV2Outbox(input = {}) {
  const resource = normalizeResource(input.resource);
  const query = {
    resource,
    limit: clampLimit(input.limit),
    status: normalizeStatus(resource, input.status) || null,
    cursor: cleanText(input.cursor) || null,
    sourceSystem: cleanText(input.sourceSystem) || null,
    aggregateType: cleanText(input.aggregateType) || null,
    eventType: cleanText(input.eventType) || null,
    targetSystem: cleanText(input.targetSystem) || null,
    outboxId: cleanText(input.outboxId) || null,
  };

  try {
    const result = resource === 'deliveries'
      ? await inspectDeliveries(query)
      : resource === 'dead_letters'
        ? await inspectDeadLetters(query)
        : await inspectOutbox(query);

    return {
      ok: true,
      mode: 'read_only',
      generatedAt: new Date().toISOString(),
      query,
      ...result,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'read_only',
      generatedAt: new Date().toISOString(),
      query,
      error: 'V2 outbox inspection failed',
      message: compactError(error),
    };
  }
}
