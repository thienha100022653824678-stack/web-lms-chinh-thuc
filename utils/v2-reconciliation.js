import { supabase } from './supabase.js';
import { isV2FlagEnabled, V2_FLAGS } from './v2-flags.js';

const DEFAULT_SAMPLE_LIMIT = 20;
const MAX_SAMPLE_LIMIT = 100;

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeSlug(value) {
  return cleanText(value).toLowerCase();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function clampSampleLimit(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_SAMPLE_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SAMPLE_LIMIT;
  return Math.min(parsed, MAX_SAMPLE_LIMIT);
}

function compactError(error) {
  return String(error?.message || error || 'Unknown reconciliation error').slice(0, 500);
}

async function runCheck(name, fn) {
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      ...result,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      code: 'check_failed',
      message: compactError(error),
    };
  }
}

async function countQuery(table, buildQuery) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  query = buildQuery ? buildQuery(query) : query;
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function sampleQuery(table, columns, buildQuery, sampleLimit) {
  let query = supabase.from(table).select(columns).limit(sampleLimit);
  query = buildQuery ? buildQuery(query) : query;
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function checkCourseSlugMappings(sampleLimit) {
  const { data: courses, error: courseError } = await supabase
    .from('courses')
    .select('id,slug,title')
    .not('slug', 'is', null)
    .limit(5000);
  if (courseError) throw courseError;

  const { data: mappings, error: mappingError } = await supabase
    .from('course_slug_mappings')
    .select('course_id,normalized_slug,status,source_system')
    .eq('source_system', 'canonical')
    .limit(5000);
  if (mappingError) throw mappingError;

  const mappingKeys = new Set(
    (mappings || []).map((mapping) => `${mapping.course_id}:${normalizeSlug(mapping.normalized_slug)}`)
  );

  const missing = (courses || [])
    .filter((course) => !mappingKeys.has(`${course.id}:${normalizeSlug(course.slug)}`));
  const sample = missing.slice(0, sampleLimit).map((course) => ({
      course_id: course.id,
      slug: course.slug,
      title: course.title,
    }));

  return {
    issueCount: missing.length,
    sample,
    totalScanned: (courses || []).length,
  };
}

async function checkOrdersMissingCourseId(sampleLimit) {
  const issueCount = await countQuery('orders', (query) => (
    query.is('course_id', null).not('course_slug', 'is', null)
  ));
  const sample = await sampleQuery(
    'orders',
    'id,course_slug,course_title,customer_email,status,created_at',
    (query) => query.is('course_id', null).not('course_slug', 'is', null).order('created_at', { ascending: false }),
    sampleLimit
  );

  return { issueCount, sample };
}

async function checkEnrollmentsMissingIdentity(sampleLimit) {
  const missingCourseId = await countQuery('student_enrollments', (query) => (
    query.is('course_id', null).not('course_slug', 'is', null)
  ));
  const missingNormalizedEmail = await countQuery('student_enrollments', (query) => (
    query.is('normalized_email', null).not('email', 'is', null)
  ));
  const sample = await sampleQuery(
    'student_enrollments',
    'id,email,course_slug,status,created_at',
    (query) => query
      .or('course_id.is.null,normalized_email.is.null')
      .order('created_at', { ascending: false }),
    sampleLimit
  );

  return {
    issueCount: missingCourseId + missingNormalizedEmail,
    missingCourseId,
    missingNormalizedEmail,
    sample,
  };
}

async function checkDuplicateActiveEnrollments(sampleLimit) {
  const { data, error } = await supabase
    .from('student_enrollments')
    .select('id,email,normalized_email,course_slug,status,created_at')
    .eq('status', 'active')
    .limit(10000);
  if (error) throw error;

  const grouped = new Map();
  for (const enrollment of data || []) {
    const email = normalizeEmail(enrollment.normalized_email || enrollment.email);
    const courseSlug = normalizeSlug(enrollment.course_slug);
    if (!email || !courseSlug) continue;
    const key = `${email}:${courseSlug}`;
    const current = grouped.get(key) || [];
    current.push(enrollment);
    grouped.set(key, current);
  }

  const duplicates = Array.from(grouped.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      enrollment_ids: rows.map((row) => row.id),
      latest_created_at: rows.map((row) => row.created_at).sort().at(-1),
    }));

  return {
    issueCount: duplicates.length,
    sample: duplicates.slice(0, sampleLimit),
    totalScanned: (data || []).length,
  };
}

async function checkLessonsMissingIdentity(sampleLimit) {
  const missingCourseId = await countQuery('lessons', (query) => (
    query.is('course_id', null).not('course_slug', 'is', null)
  ));
  const missingKind = await countQuery('lessons', (query) => query.is('kind', null));
  const sample = await sampleQuery(
    'lessons',
    'id,course_slug,lesson_no,title,is_section,sort_order,created_at',
    (query) => query
      .or('course_id.is.null,kind.is.null')
      .order('created_at', { ascending: false }),
    sampleLimit
  );

  return {
    issueCount: missingCourseId + missingKind,
    missingCourseId,
    missingKind,
    sample,
  };
}

async function checkOutboxHealth(sampleLimit) {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const pendingCount = await countQuery('sync_outbox', (query) => query.eq('status', 'pending'));
  const staleProcessingCount = await countQuery('sync_outbox', (query) => (
    query.eq('status', 'processing').lt('locked_at', staleBefore)
  ));
  const deadLetterCount = await countQuery('sync_outbox', (query) => query.eq('status', 'dead_letter'));
  const sample = await sampleQuery(
    'sync_outbox',
    'id,aggregate_type,aggregate_id,event_type,status,attempt_count,locked_at,last_error,created_at',
    (query) => query
      .in('status', ['processing', 'dead_letter'])
      .order('created_at', { ascending: false }),
    sampleLimit
  );

  return {
    issueCount: staleProcessingCount + deadLetterCount,
    pendingCount,
    staleProcessingCount,
    deadLetterCount,
    sample,
  };
}

async function checkPortalMappings(sampleLimit) {
  const missingCourseId = await countQuery('portal_post_course_mappings', (query) => (
    query.is('course_id', null).eq('status', 'active')
  ));
  const sample = await sampleQuery(
    'portal_post_course_mappings',
    'id,post_id,course_slug,normalized_course_slug,status,created_at',
    (query) => query.is('course_id', null).eq('status', 'active').order('created_at', { ascending: false }),
    sampleLimit
  );

  return {
    issueCount: missingCourseId,
    sample,
  };
}

export function isV2ReconciliationEnabled() {
  return isV2FlagEnabled(V2_FLAGS.RECONCILIATION_READONLY);
}

export async function runV2ReadOnlyReconciliation({ sampleLimit = DEFAULT_SAMPLE_LIMIT } = {}) {
  if (!isV2ReconciliationEnabled()) {
    return {
      ok: false,
      code: 'v2_reconciliation_disabled',
      message: 'V2 read-only reconciliation is disabled by feature flag.',
      checks: [],
    };
  }

  const safeSampleLimit = clampSampleLimit(sampleLimit);
  const checks = await Promise.all([
    runCheck('course_slug_mappings', () => checkCourseSlugMappings(safeSampleLimit)),
    runCheck('orders_missing_course_id', () => checkOrdersMissingCourseId(safeSampleLimit)),
    runCheck('enrollments_missing_identity', () => checkEnrollmentsMissingIdentity(safeSampleLimit)),
    runCheck('duplicate_active_enrollments', () => checkDuplicateActiveEnrollments(safeSampleLimit)),
    runCheck('lessons_missing_identity', () => checkLessonsMissingIdentity(safeSampleLimit)),
    runCheck('outbox_health', () => checkOutboxHealth(safeSampleLimit)),
    runCheck('portal_post_course_mappings', () => checkPortalMappings(safeSampleLimit)),
  ]);

  const failedChecks = checks.filter((check) => !check.ok).length;
  const issueCount = checks.reduce((total, check) => total + (Number(check.issueCount) || 0), 0);

  return {
    ok: failedChecks === 0,
    mode: 'read_only',
    generatedAt: new Date().toISOString(),
    sampleLimit: safeSampleLimit,
    issueCount,
    failedChecks,
    checks,
  };
}
