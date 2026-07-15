// utils/v3-logs.js
// V3 Phase 6 (⑪) — structured logging with correlation tracing + PII masking.
//
// V1/V2 telemetry was best-effort and swallowed errors (REL-02), making account-
// sharing investigations hard. V3 standardizes on one structured JSON log line
// per event, carrying correlation_id / request_id / flow_id / runtime_version,
// with email masked and ip/device/user_agent hashed — never raw. Pure + sync
// (writes to console so Vercel captures it); never throws.

import { createHash } from 'node:crypto';
import { stampEvent } from './runtime-controller.js';

const SCHEMA_VERSION = '2026-07-15';

function cleanText(value) {
  return String(value || '').trim();
}

// Mask email: keep first 2 chars + domain. Empty -> ''.
export function maskEmail(value) {
  const email = cleanText(value).toLowerCase();
  if (!email) return '';
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

// Hash ip / device / user_agent with a short, stable digest (no raw PII).
export function hashIdentifier(value) {
  const s = cleanText(value);
  if (!s) return null;
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// Build a structured log entry. Always includes runtime_version + schema_version
// (compatibility contract: V1/V2 consumers skip rows not stamped for them).
// `level` defaults to 'info'. PII fields (email/ip/device/userAgent) are masked
// or hashed at the boundary; the caller passes raw values.
export function buildLogEntry(fields = {}) {
  const {
    level = 'info',
    event,
    message,
    email,
    ip,
    deviceId,
    userAgent,
    correlationId,
    requestId,
    flowId,
    runtimeVersion,
    ...rest
  } = fields;

  const entry = {
    level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    event: cleanText(event) || undefined,
    message: cleanText(message) || undefined,
    ts: new Date().toISOString(),
    runtime_version: ['v1', 'v2', 'v3'].includes(runtimeVersion) ? runtimeVersion : 'v1',
    schema_version: SCHEMA_VERSION,
    correlation_id: cleanText(correlationId) || undefined,
    request_id: cleanText(requestId) || undefined,
    flow_id: cleanText(flowId) || undefined,
  };

  if (email) entry.email_masked = maskEmail(email);
  if (ip) entry.ip_hash = hashIdentifier(ip);
  if (deviceId) entry.device_hash = hashIdentifier(deviceId);
  if (userAgent) entry.ua_hash = hashIdentifier(userAgent);

  // Attach extra structured fields, but never overwrite the reserved keys.
  for (const [k, v] of Object.entries(rest)) {
    if (!(k in entry)) entry[k] = v;
  }

  return entry;
}

// Emit a structured log. Never throws. Uses console so Vercel's log drain
// captures it. The stamped entry is returned for testing/assertion.
export function logEvent(fields = {}) {
  const entry = buildLogEntry(fields);
  try {
    const line = JSON.stringify(entry);
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
  } catch {
    // Swallow: logging must never break the request path (REL-02 lesson).
  }
  return entry;
}

// Stamp an arbitrary telemetry payload with runtime_version (reuses the
// controller's stampEvent so outbox events + logs share one stamper).
export function stampTelemetry(payload, runtimeVersion) {
  return stampEvent(payload, runtimeVersion, SCHEMA_VERSION);
}

export const _internals = { SCHEMA_VERSION };
