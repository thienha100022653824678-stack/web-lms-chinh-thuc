import {
  enqueueCoursePublishEvent,
  enqueueEnrollmentAccessEvent,
  isV2OutboxShadowMode,
} from './v2-outbox.js';

function defaultLog(message, error) {
  const detail = error ? ` ${String(error?.message || error).slice(0, 300)}` : '';
  console.warn(`[v2-outbox-shadow] ${message}${detail}`);
}

/**
 * Fail-open shadow write of a course.publish_status_changed event.
 * Never throws. Returns a small status object for diagnostics/tests.
 *
 * deps (optional, for tests):
 *   - isShadowMode(): boolean
 *   - enqueueCourse(course): Promise<{id}>
 *   - log(message, error?)
 */
export async function maybeShadowCoursePublish(course, deps = {}) {
  const isShadowMode = deps.isShadowMode || isV2OutboxShadowMode;
  const enqueueCourse = deps.enqueueCourse || enqueueCoursePublishEvent;
  const log = deps.log || defaultLog;

  try {
    if (!isShadowMode()) {
      return { skipped: true, reason: 'shadow_mode_off' };
    }

    const row = await enqueueCourse(course);
    return {
      ok: true,
      outboxId: row?.id || null,
      status: row?.status || null,
    };
  } catch (error) {
    log('course shadow enqueue failed (fail-open)', error);
    return {
      ok: false,
      failedOpen: true,
      error: String(error?.message || error).slice(0, 300),
    };
  }
}

/**
 * Fail-open shadow write of an enrollment.* event.
 * action should be a short verb (e.g. 'upserted' | 'revoked').
 * Never throws.
 */
export async function maybeShadowEnrollmentAccess(enrollment, action = 'upserted', deps = {}) {
  const isShadowMode = deps.isShadowMode || isV2OutboxShadowMode;
  const enqueueEnrollment = deps.enqueueEnrollment || enqueueEnrollmentAccessEvent;
  const log = deps.log || defaultLog;

  try {
    if (!isShadowMode()) {
      return { skipped: true, reason: 'shadow_mode_off' };
    }

    const row = await enqueueEnrollment(enrollment, action);
    return {
      ok: true,
      outboxId: row?.id || null,
      status: row?.status || null,
    };
  } catch (error) {
    log('enrollment shadow enqueue failed (fail-open)', error);
    return {
      ok: false,
      failedOpen: true,
      error: String(error?.message || error).slice(0, 300),
    };
  }
}
