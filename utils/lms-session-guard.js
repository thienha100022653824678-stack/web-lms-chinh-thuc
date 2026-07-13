import crypto from "crypto";

export const STUDENT_SESSION_STATUSES = Object.freeze({
  ACTIVE: "active",
  LOGGED_OUT: "logged_out",
  EXPIRED: "expired",
  ADMIN_RESET: "admin_reset",
  SUPERSEDED: "superseded"
});

export const LMS_ENTRY_TOKEN_STATUSES = Object.freeze({
  ACTIVE: "active",
  USED: "used",
  EXPIRED: "expired",
  REVOKED: "revoked"
});

export const LMS_SESSION_STATUSES = Object.freeze({
  ACTIVE: "active",
  LOGGED_OUT: "logged_out",
  EXPIRED: "expired",
  ADMIN_RESET: "admin_reset",
  SUPERSEDED: "superseded"
});

export const DEFAULT_LMS_ENTRY_TOKEN_TTL_MINUTES = 30;
export const DEFAULT_STUDENT_SESSION_IDLE_HOURS = 24;
export const DEFAULT_LMS_SESSION_IDLE_HOURS = 24;

const ACTIVE_ENROLLMENT_STATUSES = new Set([
  "active",
  "approved",
  "approved_ready",
  "approved_waiting_content",
  "completed",
  "da duyet"
]);

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getLmsEntryTokenTtlMinutes() {
  return positiveNumber(
    process.env.LMS_ENTRY_TOKEN_TTL_MINUTES,
    DEFAULT_LMS_ENTRY_TOKEN_TTL_MINUTES
  );
}

export function getStudentSessionIdleHours() {
  return positiveNumber(
    process.env.STUDENT_SESSION_IDLE_HOURS,
    DEFAULT_STUDENT_SESSION_IDLE_HOURS
  );
}

export function getLmsSessionIdleHours() {
  return positiveNumber(
    process.env.LMS_SESSION_IDLE_HOURS,
    DEFAULT_LMS_SESSION_IDLE_HOURS
  );
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function generateSecureToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function generateSessionId(prefix = "sess") {
  return `${prefix}_${generateSecureToken(32)}`;
}

export function generateDeviceId(prefix = "dev") {
  return `${prefix}_${generateSecureToken(24)}`;
}

export function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("rawToken is required");
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function hashOptionalValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export const ACCOUNT_SHARING_EVENT_TYPES = Object.freeze({
  PORTAL_SESSION_CREATED: "portal_session_created",
  PORTAL_SESSION_REUSED: "portal_session_reused",
  LOGIN_BLOCKED_OTHER_DEVICE: "login_blocked_other_device",
  ENTRY_TOKEN_CREATED: "entry_token_created",
  ENTRY_TOKEN_USED: "entry_token_used",
  ENTRY_TOKEN_REJECTED: "entry_token_rejected",
  LMS_SESSION_CREATED: "lms_session_created",
  LMS_SESSION_REJECTED: "lms_session_rejected",
  LOGOUT: "logout",
  ADMIN_RESET: "admin_reset",
  ADMIN_NOTE: "admin_note",
  ADMIN_MARK_REVIEWED: "admin_mark_reviewed",
  ADMIN_MARK_SUSPECTED: "admin_mark_suspected"
});

const ACCOUNT_SHARING_RISK_POINTS = Object.freeze({
  [ACCOUNT_SHARING_EVENT_TYPES.LOGIN_BLOCKED_OTHER_DEVICE]: 25,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_REJECTED]: 10,
  [ACCOUNT_SHARING_EVENT_TYPES.LMS_SESSION_REJECTED]: 10,
  [ACCOUNT_SHARING_EVENT_TYPES.PORTAL_SESSION_CREATED]: 3,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_CREATED]: 1,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_USED]: 1,
  [ACCOUNT_SHARING_EVENT_TYPES.LOGOUT]: 4,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_RESET]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_NOTE]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_MARK_REVIEWED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ADMIN_MARK_SUSPECTED]: 0
});

export function getAccountSharingRiskPoints(eventType) {
  return ACCOUNT_SHARING_RISK_POINTS[eventType] || 0;
}

export function getAccountSharingRiskLevel(score) {
  const value = Number(score) || 0;
  if (value >= 80) return "high";
  if (value >= 45) return "suspicious";
  if (value >= 20) return "watch";
  return "normal";
}

export async function logStudentDeviceEvent(supabase, {
  email,
  eventType,
  action = null,
  courseSlug = null,
  postId = null,
  oldDeviceHash = null,
  newDeviceHash = null,
  oldDeviceLabel = null,
  newDeviceLabel = null,
  oldStudentSessionId = null,
  newStudentSessionId = null,
  lmsDeviceId = null,
  lmsSessionId = null,
  userAgent = null,
  ip = null,
  ipHash = null,
  reason = null,
  source = "lms",
  riskPoints = null,
  metadata = {},
  adminEmail = null,
  idempotencyKey = null
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedEventType = String(eventType || "").trim();
  if (!normalizedEmail || !normalizedEventType) {
    return { ok: false, reason: "missing_required_fields" };
  }

  const insertPayload = {
    email: normalizedEmail,
    action: String(action || normalizedEventType),
    event_type: normalizedEventType,
    course_slug: courseSlug || null,
    post_id: postId || null,
    old_device_hash: oldDeviceHash || null,
    new_device_hash: newDeviceHash || hashOptionalValue(lmsDeviceId),
    old_device_label: oldDeviceLabel || null,
    new_device_label: newDeviceLabel || null,
    old_student_session_id: oldStudentSessionId || null,
    new_student_session_id: newStudentSessionId || null,
    lms_device_hash: hashOptionalValue(lmsDeviceId),
    lms_session_hash: hashOptionalValue(lmsSessionId),
    user_agent: userAgent || null,
    ip_hash: ipHash || hashOptionalValue(ip),
    reason: reason || null,
    event_source: source || "lms",
    risk_points: Number.isFinite(Number(riskPoints))
      ? Number(riskPoints)
      : getAccountSharingRiskPoints(normalizedEventType),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
    event_idempotency_key: idempotencyKey || null
  };

  const { error } = await supabase
    .from("student_device_change_logs")
    .insert(insertPayload);

  if (error) {
    // Best-effort telemetry only. Never block student access because a warning log failed.
    console.warn("[account-sharing] Could not write device event:", error.message);
    return { ok: false, reason: "insert_failed" };
  }

  return { ok: true };
}

export async function writeAdminAuditLog(supabase, {
  adminEmail = null,
  action,
  targetEmail = null,
  metadata = {},
  ip = null,
  ipHash = null,
  userAgent = null
}) {
  const normalizedAction = String(action || "").trim();
  if (!normalizedAction) {
    return { ok: false, reason: "missing_action" };
  }

  const { error } = await supabase
    .from("admin_audit_logs")
    .insert({
      admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
      action: normalizedAction,
      target_email: targetEmail ? normalizeEmail(targetEmail) : null,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      ip_hash: ipHash || hashOptionalValue(ip),
      user_agent: userAgent || null
    });

  if (error) {
    console.warn("[account-sharing] Could not write admin audit:", error.message);
    return { ok: false, reason: "insert_failed" };
  }

  return { ok: true };
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function cutoffIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isPast(timestamp) {
  return Boolean(timestamp) && new Date(timestamp).getTime() <= Date.now();
}

function isOlderThan(timestamp, hours) {
  if (!timestamp) return true;
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return true;
  return time < new Date(cutoffIso(hours)).getTime();
}

function normalizeEnrollmentStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isActiveEnrollment(status) {
  return ACTIVE_ENROLLMENT_STATUSES.has(normalizeEnrollmentStatus(status));
}

async function throwIfSupabaseError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function createStudentActiveSession(supabase, {
  email,
  portalDeviceId,
  studentSessionId = generateSessionId("student"),
  status = STUDENT_SESSION_STATUSES.ACTIVE,
  ip = null,
  userAgent = null
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  if (!portalDeviceId) throw new Error("portalDeviceId is required");

  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .insert({
      email: normalizedEmail,
      student_session_id: studentSessionId,
      portal_device_id: portalDeviceId,
      status,
      ip,
      user_agent: userAgent
    })
    .select("*")
    .single());
}

export async function getActiveStudentSessionByEmail(supabase, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const data = await throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .select("*")
    .eq("email", normalizedEmail)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .order("last_seen_at", { ascending: false })
    .limit(1));

  return data?.[0] || null;
}

export async function touchStudentSession(supabase, studentSessionId) {
  if (!studentSessionId) throw new Error("studentSessionId is required");

  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      last_seen_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("student_session_id", studentSessionId)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function expireStaleStudentSessions(supabase, {
  idleHours = getStudentSessionIdleHours()
} = {}) {
  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      status: STUDENT_SESSION_STATUSES.EXPIRED,
      updated_at: nowIso()
    })
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .lt("last_seen_at", cutoffIso(idleHours))
    .select("id,email,student_session_id,status"));
}

export async function markStudentSessionLoggedOut(supabase, studentSessionId) {
  if (!studentSessionId) throw new Error("studentSessionId is required");
  const timestamp = nowIso();

  return throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      status: STUDENT_SESSION_STATUSES.LOGGED_OUT,
      logout_at: timestamp,
      updated_at: timestamp
    })
    .eq("student_session_id", studentSessionId)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function resetStudentSessionByEmail(supabase, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  const timestamp = nowIso();

  const sessions = await throwIfSupabaseError(await supabase
    .from("student_active_sessions")
    .update({
      status: STUDENT_SESSION_STATUSES.ADMIN_RESET,
      logout_at: timestamp,
      updated_at: timestamp
    })
    .eq("email", normalizedEmail)
    .eq("status", STUDENT_SESSION_STATUSES.ACTIVE)
    .select("student_session_id"));

  const studentSessionIds = (sessions || [])
    .map(session => session.student_session_id)
    .filter(Boolean);

  await Promise.all(studentSessionIds.map(studentSessionId => Promise.all([
    revokeEntryTokensByStudentSession(supabase, studentSessionId),
    revokeLmsSessionsByStudentSession(supabase, studentSessionId, LMS_SESSION_STATUSES.ADMIN_RESET)
  ])));

  return sessions || [];
}

export async function createLmsEntryToken(supabase, {
  email,
  studentSessionId,
  portalDeviceId,
  courseSlug,
  postId = null,
  ttlMinutes = getLmsEntryTokenTtlMinutes(),
  createdIp = null,
  createdUserAgent = null
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  if (!studentSessionId) throw new Error("studentSessionId is required");
  if (!portalDeviceId) throw new Error("portalDeviceId is required");
  if (!courseSlug) throw new Error("courseSlug is required");

  const rawToken = generateSecureToken(48);
  const tokenHash = hashToken(rawToken);
  const entryToken = await throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .insert({
      token_hash: tokenHash,
      email: normalizedEmail,
      student_session_id: studentSessionId,
      portal_device_id: portalDeviceId,
      course_slug: courseSlug,
      post_id: postId,
      status: LMS_ENTRY_TOKEN_STATUSES.ACTIVE,
      expires_at: addMinutesIso(ttlMinutes),
      created_ip: createdIp,
      created_user_agent: createdUserAgent
    })
    .select("*")
    .single());

  return {
    rawToken,
    tokenHash,
    entryToken
  };
}

export async function verifyLmsEntryToken(supabase, rawToken) {
  const tokenHash = hashToken(rawToken);
  const entryToken = await throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle());

  if (!entryToken) {
    return { ok: false, reason: "not_found", entryToken: null };
  }

  if (entryToken.status !== LMS_ENTRY_TOKEN_STATUSES.ACTIVE) {
    return { ok: false, reason: "not_active", entryToken };
  }

  if (isPast(entryToken.expires_at)) {
    await supabase
      .from("lms_entry_tokens")
      .update({ status: LMS_ENTRY_TOKEN_STATUSES.EXPIRED })
      .eq("id", entryToken.id)
      .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE);
    return { ok: false, reason: "expired", entryToken };
  }

  return { ok: true, reason: "valid", entryToken };
}

export async function markLmsEntryTokenUsed(supabase, entryTokenId) {
  if (!entryTokenId) throw new Error("entryTokenId is required");

  return throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .update({
      status: LMS_ENTRY_TOKEN_STATUSES.USED,
      used_at: nowIso()
    })
    .eq("id", entryTokenId)
    .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function revokeEntryTokensByStudentSession(supabase, studentSessionId) {
  if (!studentSessionId) throw new Error("studentSessionId is required");

  return throwIfSupabaseError(await supabase
    .from("lms_entry_tokens")
    .update({ status: LMS_ENTRY_TOKEN_STATUSES.REVOKED })
    .eq("student_session_id", studentSessionId)
    .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE)
    .select("id,status"));
}

export async function createLmsVerifiedSession(supabase, {
  email,
  studentSessionId,
  lmsDeviceId,
  courseSlug,
  entryTokenId = null,
  lmsSessionId = generateSessionId("lms"),
  ip = null,
  userAgent = null
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  if (!studentSessionId) throw new Error("studentSessionId is required");
  if (!lmsDeviceId) throw new Error("lmsDeviceId is required");
  if (!courseSlug) throw new Error("courseSlug is required");

  return throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .insert({
      lms_session_id: lmsSessionId,
      email: normalizedEmail,
      student_session_id: studentSessionId,
      lms_device_id: lmsDeviceId,
      course_slug: courseSlug,
      entry_token_id: entryTokenId,
      status: LMS_SESSION_STATUSES.ACTIVE,
      ip,
      user_agent: userAgent
    })
    .select("*")
    .single());
}

export async function getActiveLmsVerifiedSession(supabase, lmsSessionId, {
  lmsDeviceId = null,
  idleHours = getLmsSessionIdleHours()
} = {}) {
  if (!lmsSessionId) return null;

  let query = supabase
    .from("lms_verified_sessions")
    .select("*")
    .eq("lms_session_id", lmsSessionId)
    .eq("status", LMS_SESSION_STATUSES.ACTIVE);

  if (lmsDeviceId) {
    query = query.eq("lms_device_id", lmsDeviceId);
  }

  const session = await throwIfSupabaseError(await query.maybeSingle());
  if (!session) return null;

  if (new Date(session.last_seen_at).getTime() < new Date(cutoffIso(idleHours)).getTime()) {
    await supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE);
    return null;
  }

  return session;
}

export async function touchLmsVerifiedSession(supabase, lmsSessionId) {
  if (!lmsSessionId) throw new Error("lmsSessionId is required");

  return throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .update({
      last_seen_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("lms_session_id", lmsSessionId)
    .eq("status", LMS_SESSION_STATUSES.ACTIVE)
    .select("*")
    .maybeSingle());
}

export async function revokeLmsSessionsByStudentSession(
  supabase,
  studentSessionId,
  status = LMS_SESSION_STATUSES.LOGGED_OUT
) {
  if (!studentSessionId) throw new Error("studentSessionId is required");
  const timestamp = nowIso();

  return throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .update({
      status,
      logout_at: timestamp,
      updated_at: timestamp
    })
    .eq("student_session_id", studentSessionId)
    .eq("status", LMS_SESSION_STATUSES.ACTIVE)
    .select("id,status"));
}

export async function verifyLmsVerifiedSessionAccess(supabase, {
  lmsSessionId,
  lmsDeviceId,
  courseSlug = null,
  lmsIdleHours = getLmsSessionIdleHours(),
  studentIdleHours = getStudentSessionIdleHours()
}) {
  if (!lmsSessionId || !lmsDeviceId) {
    return { ok: false, reason: "missing_lms_session", session: null };
  }

  const session = await throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .select("*")
    .eq("lms_session_id", lmsSessionId)
    .maybeSingle());

  if (!session) {
    return { ok: false, reason: "invalid_lms_session", session: null };
  }

  if (session.lms_device_id !== lmsDeviceId) {
    return { ok: false, reason: "device_mismatch", session };
  }

  if (session.status !== LMS_SESSION_STATUSES.ACTIVE) {
    return { ok: false, reason: `lms_session_${session.status}`, session };
  }

  if (isOlderThan(session.last_seen_at, lmsIdleHours)) {
    await supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE);
    return { ok: false, reason: "lms_session_expired", session };
  }

  const expectedCourseSlug = String(courseSlug || "").trim();
  const sessionCourseSlug = String(session.course_slug || "").trim();
  if (expectedCourseSlug && sessionCourseSlug !== expectedCourseSlug) {
    return { ok: false, reason: "course_mismatch", session };
  }

  const { data: studentSession, error: studentError } = await supabase
    .from("student_active_sessions")
    .select("*")
    .eq("student_session_id", session.student_session_id)
    .eq("email", normalizeEmail(session.email))
    .maybeSingle();

  if (studentError) throw studentError;
  if (!studentSession) {
    return { ok: false, reason: "student_session_inactive", session };
  }
  if (studentSession.status !== STUDENT_SESSION_STATUSES.ACTIVE) {
    return { ok: false, reason: `student_session_${studentSession.status}`, session };
  }

  if (isOlderThan(studentSession.last_seen_at, studentIdleHours)) {
    await supabase
      .from("student_active_sessions")
      .update({
        status: STUDENT_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("student_session_id", session.student_session_id)
      .eq("status", STUDENT_SESSION_STATUSES.ACTIVE);
    return { ok: false, reason: "student_session_expired", session };
  }

  const { data: enrollments, error: enrollError } = await supabase
    .from("student_enrollments")
    .select("id,status")
    .eq("email", normalizeEmail(session.email))
    .eq("course_slug", sessionCourseSlug)
    .limit(10);

  if (enrollError) throw enrollError;
  const activeEnrollment = (enrollments || []).find(enrollment => isActiveEnrollment(enrollment.status));
  if (!activeEnrollment) {
    return { ok: false, reason: "enrollment_inactive", session };
  }

  await Promise.all([
    touchLmsVerifiedSession(supabase, lmsSessionId),
    touchStudentSession(supabase, session.student_session_id)
  ]);

  return {
    ok: true,
    reason: "valid",
    email: normalizeEmail(session.email),
    courseSlug: sessionCourseSlug,
    session,
    studentSession,
    enrollment: activeEnrollment
  };
}

export function getEntryTokenRequiredCourses() {
  return String(process.env.LMS_ENTRY_TOKEN_REQUIRED_COURSES || "")
    .split(",")
    .map((slug) => String(slug || "").trim())
    .filter(Boolean);
}

export function isEntryTokenRequiredCourse(courseSlug) {
  const normalizedCourseSlug = String(courseSlug || "").trim();
  if (!normalizedCourseSlug) return false;
  return getEntryTokenRequiredCourses().includes(normalizedCourseSlug);
}
