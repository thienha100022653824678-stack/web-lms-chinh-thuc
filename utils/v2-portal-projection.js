import { getV2Env, isV2FlagEnabled, V2_FLAGS } from './v2-flags.js';

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const [name, domain] = email.split('@');
  if (!name || !domain) return email ? '***' : '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function buildError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getPayloadCourseSlug(event) {
  const aggregateId = cleanText(event?.aggregate_id);
  const eventType = cleanText(event?.event_type).toLowerCase();
  const aggregateType = cleanText(event?.aggregate_type).toLowerCase();
  const aggregateSlug = eventType.startsWith('enrollment.') || aggregateType === 'enrollment'
    ? cleanText(aggregateId.split(':')[1])
    : aggregateId;

  return cleanText(
    event?.payload?.course_slug ||
    event?.payload?.courseSlug ||
    event?.payload?.slug ||
    aggregateSlug
  );
}

function getPayloadEmail(event) {
  const aggregateEmail = cleanText(event?.aggregate_id?.split(':')?.[0]);
  return normalizeEmail(event?.payload?.email || event?.payload?.student_email || aggregateEmail);
}

function normalizeEnrollmentAction(event) {
  const payloadAction = cleanText(event?.payload?.action).toLowerCase();
  const eventType = cleanText(event?.event_type).toLowerCase();
  if (payloadAction === 'revoke' || payloadAction === 'delete' || eventType.includes('revoked')) {
    return 'revoke';
  }
  return 'create';
}

export function isV2PortalProjectionEnabled() {
  return isV2FlagEnabled(V2_FLAGS.PORTAL_PROJECTION_ENABLED);
}

export function isV2PortalProjectionDryRun() {
  return isV2FlagEnabled(V2_FLAGS.PORTAL_PROJECTION_DRY_RUN, true);
}

export function getV2PortalProjectionUrl() {
  return getV2Env('V2_PORTAL_PROJECTION_URL') || getV2Env('SYSTEM1_URL');
}

export function getV2PortalProjectionSecret() {
  return getV2Env('V2_PORTAL_PROJECTION_SECRET') || getV2Env('INTERNAL_SYNC_SECRET');
}

async function loadCourseSnapshot(supabase, slug) {
  const { data, error } = await supabase
    .from('courses')
    .select('slug,title,image_url,is_published,expected_start_date,active')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    throw buildError(`Could not load course snapshot for V2 Portal projection: ${error.message}`, 'portal_projection_course_snapshot_failed');
  }

  return data || null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export async function buildPortalProjectionPayload({ supabase, event }) {
  const eventType = cleanText(event?.event_type).toLowerCase();
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};

  if (eventType.startsWith('course.')) {
    const slug = getPayloadCourseSlug(event);
    if (!slug) {
      throw buildError('Portal projection course event is missing course slug.', 'portal_projection_missing_course_slug');
    }

    const snapshot = supabase ? await loadCourseSnapshot(supabase, slug) : null;
    const title = cleanText(snapshot?.title || payload.title || payload.course_title);
    if (!title) {
      throw buildError('Portal projection course event is missing course title.', 'portal_projection_missing_course_title');
    }

    const imageUrl = cleanText(snapshot?.image_url || payload.image_url || payload.imageUrl);
    const isPublished = hasOwn(snapshot, 'is_published')
      ? !!snapshot.is_published
      : !!(payload.is_published ?? payload.isPublished);

    const body = {
      action: eventType === 'course.publish_status_changed' ? 'syncCoursePublishStatus' : 'syncCourse',
      courseSlug: slug,
      title,
      imageUrl,
      active: hasOwn(snapshot, 'active') ? snapshot.active !== false : payload.active !== false,
      isPublished,
    };

    const expectedStartDate = snapshot?.expected_start_date || payload.expected_start_date || null;
    if (expectedStartDate !== undefined) {
      body.expected_start_date = expectedStartDate;
    }

    return body;
  }

  if (eventType.startsWith('enrollment.')) {
    const email = getPayloadEmail(event);
    const courseSlug = getPayloadCourseSlug(event);
    if (!email || !courseSlug) {
      throw buildError('Portal projection enrollment event is missing email or course slug.', 'portal_projection_missing_enrollment_identity');
    }

    return {
      action: normalizeEnrollmentAction(event) === 'revoke' ? 'revokeEnrollment' : 'syncEnrollment',
      email,
      courseSlug,
    };
  }

  throw buildError(`Unsupported Portal projection event type: ${eventType || '(empty)'}.`, 'portal_projection_unsupported_event');
}

function summarizePayload(body) {
  if (body.action === 'syncEnrollment' || body.action === 'revokeEnrollment') {
    return `${body.action} for ${maskEmail(body.email)} / ${body.courseSlug}`;
  }
  return `${body.action} for course ${body.courseSlug}`;
}

async function postPortalSync(body) {
  const baseUrl = getV2PortalProjectionUrl().replace(/\/$/, '');
  const secret = getV2PortalProjectionSecret();

  if (!baseUrl || !secret) {
    throw buildError('V2 Portal projection URL or secret is not configured.', 'portal_projection_missing_config');
  }

  const response = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Secret': secret,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw buildError(
      data?.error || `Portal projection failed with HTTP ${response.status}.`,
      'portal_projection_http_failed'
    );
  }

  return data;
}

export async function deliverPortalProjection({ supabase, event }) {
  const body = await buildPortalProjectionPayload({ supabase, event });
  const summary = summarizePayload(body);

  if (!isV2PortalProjectionEnabled()) {
    return {
      status: 'skipped',
      code: 'portal_projection_disabled',
      summary: `Portal projection disabled: ${summary}.`,
    };
  }

  if (isV2PortalProjectionDryRun()) {
    return {
      status: 'pending',
      code: 'portal_projection_dry_run',
      summary: `Dry-run: would send ${summary}.`,
    };
  }

  const result = await postPortalSync(body);
  const responseParts = [
    result?.postId ? `postId=${result.postId}` : '',
    result?.projectRef ? `projectRef=${result.projectRef}` : '',
  ].filter(Boolean);

  return {
    status: 'success',
    code: 'portal_projection_delivered',
    summary: `Delivered ${summary}${responseParts.length ? ` (${responseParts.join(', ')})` : ''}.`,
  };
}
