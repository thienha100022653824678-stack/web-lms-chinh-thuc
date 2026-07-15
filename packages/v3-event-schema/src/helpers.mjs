// packages/v3-event-schema/src/helpers.mjs
// Shared helpers every repo currently re-implements: normalizeEmail, and the
// idempotency-key builder (re-exported so the LMS outbox + Portal + Shop agree).

import crypto from 'node:crypto';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Deterministic idempotency key from parts. Identical inputs -> identical key,
// so a retried enqueue/delivery is a no-op (exactly-once). Mirrors the builder
// in utils/v2-outbox.js; defined here so all repos share one definition.
export function buildIdempotencyKey(parts) {
  const source = Array.isArray(parts) ? parts.join(':') : String(parts || '');
  return crypto.createHash('sha256').update(source).digest('hex');
}

// Mask email for logs/UI: keep first 2 chars + domain. Never raw.
export function maskEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return '';
  const [name, domain] = e.split('@');
  if (!name || !domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

// Short stable hash for ip/device/user_agent in telemetry (no raw PII).
export function hashIdentifier(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}
