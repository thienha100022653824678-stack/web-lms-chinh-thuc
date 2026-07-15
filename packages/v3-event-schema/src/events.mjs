// packages/v3-event-schema/src/events.mjs
// Canonical V3 outbox event types — the single source of truth for what events
// flow over the integration backbone (Phase 3 ④). Drift here = test failure in
// every repo that imports it, not a silent production contract break.
//
// Expand-only: existing event strings are frozen. Adding a new event is safe;
// renaming/removing one is a breaking change that must bump the package major.

import { CURRENT_SCHEMA_VERSION, normalizeRuntimeVersion } from './runtime.mjs';

export const EVENT_TYPES = Object.freeze({
  // Course lifecycle (LMS canonical).
  COURSE_PUBLISH_STATUS_CHANGED: 'course.publish_status_changed',
  COURSE_CREATED: 'course.created',
  COURSE_UPDATED: 'course.updated',
  // Enrollment lifecycle.
  ENROLLMENT_UPSERTED: 'enrollment.upserted',
  ENROLLMENT_REVOKED: 'enrollment.revoked',
  // Session / account-sharing (telemetry).
  PORTAL_SESSION_CREATED: 'portal_session_created',
  PORTAL_SESSION_REUSED: 'portal_session_reused',
  LOGIN_BLOCKED_OTHER_DEVICE: 'login_blocked_other_device',
  ENTRY_TOKEN_USED: 'entry_token_used',
  ENTRY_TOKEN_REJECTED: 'entry_token_rejected',
  LMS_SESSION_CREATED: 'lms_session_created',
  LMS_SESSION_REJECTED: 'lms_session_rejected',
  LOGOUT: 'logout',
  ADMIN_RESET: 'admin_reset',
  // Delivery.
  DRIVE_PERMISSION_CREATED: 'drive.permission_created',
  DRIVE_PERMISSION_REVOKED: 'drive.permission_revoked',
});

export const AGGREGATE_TYPES = Object.freeze({
  COURSE: 'course',
  ENROLLMENT: 'enrollment',
  SESSION: 'session',
  DRIVE: 'drive',
});

// The envelope every outbox event carries. Producers build via makeEventEnvelope
// so the runtime_version + schema_version stamps are always present and correct.
export function makeEventEnvelope({ eventType, aggregateType, aggregateId, payload, runtimeVersion }) {
  if (!eventType || !aggregateType) {
    throw new Error('event-schema: eventType and aggregateType are required');
  }
  return Object.freeze({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId ?? null,
    payload: payload && typeof payload === 'object' ? payload : {},
    runtime_version: normalizeRuntimeVersion(runtimeVersion),
    schema_version: CURRENT_SCHEMA_VERSION,
  });
}
