// packages/v3-event-schema/src/errors.mjs
// Canonical error codes for the cross-repo contract. Stable strings so a
// consumer can branch on a code without parsing human text. Expand-only.

export const ERROR_CODES = Object.freeze({
  // Auth/session.
  INVALID_SESSION: 'invalid_session',
  SESSION_REVOKED: 'session_revoked',
  SESSION_EXPIRED: 'session_expired',
  DEVICE_MISMATCH: 'device_mismatch',
  ONE_DEVICE_POLICY_UNAVAILABLE: 'one_device_policy_unavailable',
  // Enrollment.
  ENROLLMENT_INACTIVE: 'enrollment_inactive',
  // Entry token.
  INVALID_ENTRY_TOKEN: 'invalid_entry_token',
  // Sync / outbox.
  UNAUTHORIZED_WORKER: 'unauthorized_worker',
  OUTBOX_ENQUEUE_FAILED: 'outbox_enqueue_failed',
  DELIVERY_FAILED: 'delivery_failed',
  // Generic.
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  SERVER_ERROR: 'server_error',
});

// Map an internal reason string (e.g. from lms-session-guard) to a stable
// public code. Mirrors the spirit of mapLmsAccessReasonToError so all three
// repos share one mapping.
const REASON_TO_CODE = Object.freeze({
  valid: null,
  no_session: ERROR_CODES.INVALID_SESSION,
  device_mismatch: ERROR_CODES.DEVICE_MISMATCH,
  session_revoked: ERROR_CODES.SESSION_REVOKED,
  session_expired: ERROR_CODES.SESSION_EXPIRED,
  enrollment_inactive: ERROR_CODES.ENROLLMENT_INACTIVE,
});

export function reasonToErrorCode(reason) {
  const key = String(reason || '').trim();
  if (key in REASON_TO_CODE) return REASON_TO_CODE[key]; // `valid` maps to null
  return ERROR_CODES.SERVER_ERROR;
}
