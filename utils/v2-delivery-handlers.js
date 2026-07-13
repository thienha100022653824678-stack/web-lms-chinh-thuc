import { syncGoogleDrivePermission } from './lms.js';
import { V2_FLAGS, isV2FlagEnabled } from './v2-flags.js';

function cleanText(value) {
  return String(value || '').trim();
}

function maskEmail(value) {
  const email = cleanText(value).toLowerCase();
  const [name, domain] = email.split('@');
  if (!name || !domain) return email ? '***' : '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function normalizeAction(event) {
  const payloadAction = cleanText(event?.payload?.action).toLowerCase();
  const eventType = cleanText(event?.event_type).toLowerCase();

  if (payloadAction === 'revoke' || payloadAction === 'delete' || eventType.includes('revoked')) {
    return 'revoke';
  }

  return 'create';
}

function getPayloadCourseSlug(event) {
  return cleanText(
    event?.payload?.course_slug ||
    event?.payload?.courseSlug ||
    event?.aggregate_id?.split(':')?.[1]
  );
}

function getPayloadEmail(event) {
  const aggregateEmail = cleanText(event?.aggregate_id?.split(':')?.[0]);
  return cleanText(event?.payload?.email || event?.payload?.student_email || aggregateEmail).toLowerCase();
}

function buildError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function isV2DeliveryHandlersEnabled() {
  return isV2FlagEnabled(V2_FLAGS.DELIVERY_HANDLERS_ENABLED);
}

export function isV2DriveDeliveryDryRun() {
  return isV2FlagEnabled(V2_FLAGS.DRIVE_WORKER_DRY_RUN, true);
}

async function deliverDrivePermission({ supabase, event }) {
  const email = getPayloadEmail(event);
  const courseSlug = getPayloadCourseSlug(event);
  const action = normalizeAction(event);

  if (!email || !courseSlug) {
    throw buildError('Drive delivery is missing email or course_slug.', 'drive_delivery_missing_identity');
  }

  if (isV2DriveDeliveryDryRun()) {
    return {
      status: 'pending',
      code: 'drive_delivery_dry_run',
      summary: `Dry-run: would ${action} Drive permission for ${maskEmail(email)} / ${courseSlug}.`,
    };
  }

  const result = await syncGoogleDrivePermission(supabase, {
    email,
    courseSlug,
    action,
  });

  if (!result?.success) {
    throw buildError(
      result?.error || 'Drive permission sync failed.',
      result?.pendingRetry ? 'drive_delivery_pending_retry' : 'drive_delivery_failed'
    );
  }

  return {
    status: 'success',
    code: action === 'revoke' ? 'drive_permission_revoked' : 'drive_permission_granted',
    summary: `${action === 'revoke' ? 'Revoked' : 'Granted'} Drive permission for ${maskEmail(email)} / ${courseSlug}.`,
  };
}

export async function deliverV2Target({ supabase, event, target }) {
  const targetName = cleanText(target);

  if (targetName === 'manual_review') {
    return {
      status: 'skipped',
      code: 'manual_review_required',
      summary: 'Event requires manual review.',
    };
  }

  if (targetName === 'drive_permission') {
    return deliverDrivePermission({ supabase, event });
  }

  if (targetName === 'portal_projection') {
    throw buildError(
      'V2 portal projection delivery is not implemented yet.',
      'portal_projection_not_implemented'
    );
  }

  throw buildError(`Unsupported V2 delivery target: ${targetName || '(empty)'}.`, 'unsupported_delivery_target');
}
