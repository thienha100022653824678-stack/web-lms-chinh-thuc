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
