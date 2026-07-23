import crypto from "crypto";
import { getAccountEventHashSecret, AuthSecretError } from "./lms-secrets.js";
import { isV2GlobalOneDeviceEnabled } from "./v2-flags.js";
import { timeLmsAsync } from "./lms-server-timing.js";

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
export const ACCOUNT_SHARING_SCHEMA_VERSION = "v2";
export const ACCOUNT_SHARING_RISK_RULE_VERSION = "risk_v2_p0";

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
  // RP-1: fail-closed. Hash values must use HMAC-SHA256 with a real secret.
  // The legacy SHA-256 fallback is removed; configuration error is raised
  // when the secret is missing.
  const secret = getAccountEventHashSecret();
  return crypto.createHmac("sha256", secret).update(normalized).digest("hex");
}

export function warnMissingAccountEventHashSecret() {
  // Backward-compatible no-op. The fail-closed behavior now lives inside
  // hashOptionalValue (which raises AuthSecretError on missing secret).
  // This function is intentionally silent; callers should handle the error.
  return false;
}

export function getAccountEventHashVersion() {
  // RP-1: any successful hash uses HMAC-SHA256 with the configured secret.
  // The legacy "sha256_v1" version is no longer emitted.
  return "hmac_sha256_v2";
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
  [ACCOUNT_SHARING_EVENT_TYPES.PORTAL_SESSION_CREATED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.PORTAL_SESSION_REUSED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_CREATED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_USED]: 0,
  [ACCOUNT_SHARING_EVENT_TYPES.LMS_SESSION_CREATED]: 0,
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

function sanitizeEventMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    const cleanKey = String(key || "").slice(0, 80);
    if (!cleanKey) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      output[cleanKey] = value;
    } else if (typeof value === "string") {
      output[cleanKey] = value.slice(0, 500);
    }
  }
  return output;
}

function isMissingTelemetryColumn(error) {
  return /column .* does not exist|relation .* does not exist|schema cache|PGRST204/i.test(String(error?.message || ""));
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
  idempotencyKey = null,
  correlationId = null,
  requestId = null,
  flowId = null,
  result = null,
  reasonCode = null
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedEventType = String(eventType || "").trim();
  if (!normalizedEmail || !normalizedEventType) {
    return { ok: false, reason: "missing_required_fields" };
  }

  const safeReason = reason || reasonCode || "unspecified";
  const safeReasonCode = reasonCode || reason || "unspecified";

  // RP-1: hashOptionalValue is fail-closed; if a required hash secret is
  // missing we degrade telemetry by recording null hashes and flagging the
  // configuration issue in metadata. We never block the request because
  // telemetry is best-effort, but we DO avoid producing unverifiable hashes.
  let newDeviceHashResolved = newDeviceHash;
  let lmsDeviceHashResolved = null;
  let lmsSessionHashResolved = null;
  let ipHashResolved = ipHash;
  let hashSecretMissing = false;
  try {
    newDeviceHashResolved = newDeviceHash || hashOptionalValue(lmsDeviceId);
    lmsDeviceHashResolved = hashOptionalValue(lmsDeviceId);
    lmsSessionHashResolved = hashOptionalValue(lmsSessionId);
    ipHashResolved = ipHash || hashOptionalValue(ip);
  } catch (err) {
    if (err instanceof AuthSecretError) {
      hashSecretMissing = true;
      // Leave hashes null; the metadata flag records the config issue.
    } else {
      throw err;
    }
  }

  const insertPayload = {
    email: normalizedEmail,
    action: String(action || normalizedEventType),
    event_type: normalizedEventType,
    course_slug: courseSlug || null,
    post_id: postId || null,
    old_device_hash: oldDeviceHash || null,
    new_device_hash: newDeviceHashResolved,
    old_device_label: oldDeviceLabel || null,
    new_device_label: newDeviceLabel || null,
    old_student_session_id: oldStudentSessionId || null,
    new_student_session_id: newStudentSessionId || null,
    lms_device_hash: lmsDeviceHashResolved,
    lms_session_hash: lmsSessionHashResolved,
    user_agent: userAgent || null,
    ip_hash: ipHashResolved,
    reason: safeReason,
    event_source: source || "lms",
    risk_points: Number.isFinite(Number(riskPoints))
      ? Number(riskPoints)
      : getAccountSharingRiskPoints(normalizedEventType),
    metadata: hashSecretMissing
      ? { ...sanitizeEventMetadata(metadata), hash_secret_missing: true }
      : sanitizeEventMetadata(metadata),
    admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
    event_idempotency_key: idempotencyKey || null,
    correlation_id: correlationId || null,
    request_id: requestId || null,
    flow_id: flowId || null,
    result: result || null,
    reason_code: safeReasonCode,
    schema_version: ACCOUNT_SHARING_SCHEMA_VERSION,
    hash_version: hashSecretMissing ? "hmac_sha256_v2_unavailable" : getAccountEventHashVersion()
  };

  let { error } = await supabase
    .from("student_device_change_logs")
    .insert(insertPayload);

  if (error && isMissingTelemetryColumn(error)) {
    const fallbackPayload = { ...insertPayload };
    delete fallbackPayload.correlation_id;
    delete fallbackPayload.request_id;
    delete fallbackPayload.flow_id;
    delete fallbackPayload.result;
    delete fallbackPayload.reason_code;
    delete fallbackPayload.schema_version;
    delete fallbackPayload.hash_version;
    ({ error } = await supabase
      .from("student_device_change_logs")
      .insert(fallbackPayload));
  }

  if (error) {
    if (error.code === "23505" && idempotencyKey) {
      return { ok: true, duplicate: true };
    }
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

  let resolvedIpHash = ipHash;
  let hashSecretMissing = false;
  try {
    resolvedIpHash = ipHash || hashOptionalValue(ip);
  } catch (err) {
    if (err instanceof AuthSecretError) {
      hashSecretMissing = true;
      resolvedIpHash = null;
    } else {
      throw err;
    }
  }

  const auditMetadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
  if (hashSecretMissing) auditMetadata.hash_secret_missing = true;

  const { error } = await supabase
    .from("admin_audit_logs")
    .insert({
      admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
      action: normalizedAction,
      target_email: targetEmail ? normalizeEmail(targetEmail) : null,
      metadata: auditMetadata,
      ip_hash: resolvedIpHash,
      user_agent: userAgent || null
    });

  if (error) {
    console.warn("[account-sharing] Could not write admin audit:", error.message);
    return { ok: false, reason: "insert_failed" };
  }

  return { ok: true };
}

export async function getStudentSessionControl(supabase, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const { data, error } = await supabase
    .from("student_session_controls")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error && isMissingTelemetryColumn(error)) return null;
  if (error) throw error;
  return data || null;
}

function isRevokedBySessionControl(row, control) {
  if (!row || !control?.sessions_revoked_before) return false;
  const revokedBefore = new Date(control.sessions_revoked_before).getTime();
  const createdAt = new Date(row.created_at || 0).getTime();
  return Number.isFinite(revokedBefore) && Number.isFinite(createdAt) && createdAt <= revokedBefore;
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

export async function resetStudentSessionByEmail(supabase, email, {
  adminEmail = null,
  reason = null
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("email is required");
  const rpcResult = await supabase.rpc("reset_student_session_guard", {
    p_email: normalizedEmail,
    p_admin_email: adminEmail ? normalizeEmail(adminEmail) : null,
    p_reason: reason || "admin_reset"
  });

  if (!rpcResult.error) {
    return {
      ok: true,
      studentSessions: Number(rpcResult.data?.studentSessions || 0),
      entryTokens: Number(rpcResult.data?.entryTokens || 0),
      lmsSessions: Number(rpcResult.data?.lmsSessions || 0),
      revokedBefore: rpcResult.data?.revokedBefore || null,
      usedRpc: true
    };
  }

  if (!/function .*reset_student_session_guard|schema cache|does not exist/i.test(String(rpcResult.error.message || ""))) {
    throw rpcResult.error;
  }

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

  return {
    ok: true,
    studentSessions: (sessions || []).length,
    entryTokens: null,
    lmsSessions: null,
    revokedBefore: timestamp,
    usedRpc: false,
    sessions: sessions || []
  };
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

  const control = await getStudentSessionControl(supabase, entryToken.email);
  if (isRevokedBySessionControl(entryToken, control)) {
    await supabase
      .from("lms_entry_tokens")
      .update({ status: LMS_ENTRY_TOKEN_STATUSES.REVOKED })
      .eq("id", entryToken.id)
      .eq("status", LMS_ENTRY_TOKEN_STATUSES.ACTIVE);
    return { ok: false, reason: "entry_token_revoked_by_reset", entryToken };
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
  studentIdleHours = getStudentSessionIdleHours(),
  deferTouch = false
}, timing = null) {
  if (!lmsSessionId || !lmsDeviceId) {
    return { ok: false, reason: "missing_lms_session", session: null };
  }

  const session = await timeLmsAsync(timing, "auth_session_db", async () => throwIfSupabaseError(await supabase
    .from("lms_verified_sessions")
    .select("*")
    .eq("lms_session_id", lmsSessionId)
    .maybeSingle()));

  if (!session) {
    return { ok: false, reason: "invalid_lms_session", session: null };
  }

  if (session.lms_device_id !== lmsDeviceId) {
    return { ok: false, reason: "device_mismatch", session };
  }

  if (session.status !== LMS_SESSION_STATUSES.ACTIVE) {
    return { ok: false, reason: `lms_session_${session.status}`, session };
  }

  // course slug is needed by the parallel enrollment query below; compute it
  // before starting the independent control/student/enrollment cluster.
  const expectedCourseSlug = String(courseSlug || "").trim();
  const sessionCourseSlug = String(session.course_slug || "").trim();

  // A1: control, student-session, and enrollment are all provably dependent
  // ONLY on `session` (which has passed null/device/status checks above) —
  // none depends on the result of the others, so they can run concurrently.
  // Promise.all fast-rejects on any throw, preserving fail-closed behavior.
  const [control, studentResult, enrollResult] = await Promise.all([
    timeLmsAsync(timing, "auth_control_db", () => getStudentSessionControl(supabase, session.email)),
    timeLmsAsync(timing, "auth_student_db", () => supabase
      .from("student_active_sessions")
      .select("*")
      .eq("student_session_id", session.student_session_id)
      .eq("email", normalizeEmail(session.email))
      .maybeSingle()),
    timeLmsAsync(timing, "auth_enrollment_db", () => supabase
      .from("student_enrollments")
      .select("id,status")
      .eq("email", normalizeEmail(session.email))
      .eq("course_slug", sessionCourseSlug)
      .limit(10))
  ]);
  const { data: studentSession, error: studentError } = studentResult;
  const { data: enrollments, error: enrollError } = enrollResult;
  if (studentError) throw studentError;
  if (enrollError) throw enrollError;

  // Checks run in the ORIGINAL semantic order, preserving every side-effect
  // UPDATE branch and every reason string verbatim.
  if (isRevokedBySessionControl(session, control)) {
    await timeLmsAsync(timing, "auth_touch_db", () => supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.ADMIN_RESET,
        logout_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE));
    return { ok: false, reason: "lms_session_revoked_by_reset", session };
  }

  if (isOlderThan(session.last_seen_at, lmsIdleHours)) {
    await timeLmsAsync(timing, "auth_touch_db", () => supabase
      .from("lms_verified_sessions")
      .update({
        status: LMS_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("id", session.id)
      .eq("status", LMS_SESSION_STATUSES.ACTIVE));
    return { ok: false, reason: "lms_session_expired", session };
  }

  if (expectedCourseSlug && sessionCourseSlug !== expectedCourseSlug) {
    return { ok: false, reason: "course_mismatch", session };
  }

  if (!studentSession) {
    return { ok: false, reason: "student_session_inactive", session };
  }
  if (studentSession.status !== STUDENT_SESSION_STATUSES.ACTIVE) {
    return { ok: false, reason: `student_session_${studentSession.status}`, session };
  }

  if (isRevokedBySessionControl(studentSession, control)) {
    await timeLmsAsync(timing, "auth_touch_db", () => supabase
      .from("student_active_sessions")
      .update({
        status: STUDENT_SESSION_STATUSES.ADMIN_RESET,
        logout_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("student_session_id", session.student_session_id)
      .eq("status", STUDENT_SESSION_STATUSES.ACTIVE));
    return { ok: false, reason: "student_session_revoked_by_reset", session };
  }

  if (isOlderThan(studentSession.last_seen_at, studentIdleHours)) {
    await timeLmsAsync(timing, "auth_touch_db", () => supabase
      .from("student_active_sessions")
      .update({
        status: STUDENT_SESSION_STATUSES.EXPIRED,
        updated_at: nowIso()
      })
      .eq("student_session_id", session.student_session_id)
      .eq("status", STUDENT_SESSION_STATUSES.ACTIVE));
    return { ok: false, reason: "student_session_expired", session };
  }

  const activeEnrollment = (enrollments || []).find(enrollment => isActiveEnrollment(enrollment.status));
  if (!activeEnrollment) {
    return { ok: false, reason: "enrollment_inactive", session };
  }

  // Happy-path touch: a heartbeat that updates last_seen_at on BOTH tables.
  // It does NOT affect any access decision above. When deferTouch is true
  // (lesson endpoint only), start the touch WITHOUT awaiting inside the guard
  // so it overlaps with the lesson-side work; the lesson handler MUST await
  // __touchPromise before sending the response so a touch failure still trips
  // the existing fail-closed catch. When false (course-data/logout/tests),
  // await the touch here exactly as before.
  if (deferTouch) {
    const __touchPromise = timeLmsAsync(timing, "auth_touch_db", () => Promise.all([
      touchLmsVerifiedSession(supabase, lmsSessionId),
      touchStudentSession(supabase, session.student_session_id)
    ]));
    return {
      ok: true,
      reason: "valid",
      email: normalizeEmail(session.email),
      courseSlug: sessionCourseSlug,
      session,
      studentSession,
      enrollment: activeEnrollment,
      __touchPromise
    };
  }

  await timeLmsAsync(timing, "auth_touch_db", () => Promise.all([
    touchLmsVerifiedSession(supabase, lmsSessionId),
    touchStudentSession(supabase, session.student_session_id)
  ]));

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

export function isEntryTokenRequiredCourse(courseSlug, env = process.env) {
  const normalizedCourseSlug = String(courseSlug || "").trim();
  if (!normalizedCourseSlug) return false;
  const list = String(env?.LMS_ENTRY_TOKEN_REQUIRED_COURSES || "")
    .split(",")
    .map((slug) => String(slug || "").trim())
    .filter(Boolean);
  return list.includes(normalizedCourseSlug);
}

/**
 * RP2-B1 centralized access policy.
 *
 * - When V2_GLOBAL_ONE_DEVICE_ENABLED is ON: every course is treated as
 *   protected content that requires LMS verified session access. The
 *   caller must invoke `verifyLmsVerifiedSessionAccess` and reject when
 *   it fails. The legacy course allowlist is irrelevant.
 * - When the flag is OFF: fall back to the V1 behavior
 *   (`isEntryTokenRequiredCourse`). Public lessons remain public.
 *
 * Returned boolean does NOT mean the caller has access; it only tells the
 * caller that this content path is part of the one-device scope. The
 * caller is responsible for actual verification.
 */
export function shouldRequireLmsVerifiedSession(courseSlug, env = process.env) {
  if (isV2GlobalOneDeviceEnabled(env)) return true;
  return isEntryTokenRequiredCourse(courseSlug, env);
}

/**
 * RP2-B1 error mapping. Source-of-truth helpers for translating the
 * raw `reason` returned by `verifyLmsVerifiedSessionAccess` (and the
 * LMS `student_session_*` / `lms_session_*` lifecycle) into the safe
 * external error contract documented in the plan.
 *
 * The mapping intentionally never leaks:
 *   - the raw DB error
 *   - the email
 *   - the device id / session id
 *   - the IP or user agent
 *   - which internal lifecycle state was hit
 *
 * Callers can rely on this mapping for both course-data and lesson
 * responses so the wire contract stays uniform.
 */
const PUBLIC_REASON_TO_ERROR = Object.freeze({
  // The caller supplied no X-LMS-Session-Id / X-LMS-Device-Id headers,
  // or the session row could not be found.
  missing_lms_session: "invalid_session",
  invalid_lms_session: "invalid_session",
  // The headers identified a different device than the one stored
  // on the LMS session. Per the plan, LMS reports this as
  // `device_mismatch` (Portal owns the `device_active_elsewhere`
  // case at login time).
  device_mismatch: "device_mismatch",
  // The course expected by the request does not match the course bound
  // to the LMS verified session.
  course_mismatch: "invalid_session",
  // LMS verified session is no longer active. We surface the same
  // generic contract as a missing session.
  lms_session_logged_out: "session_revoked",
  lms_session_expired: "session_expired",
  lms_session_admin_reset: "session_revoked",
  lms_session_revoked_by_reset: "session_revoked",
  lms_session_superseded: "session_replaced",
  // Underlying student session lifecycle.
  student_session_inactive: "session_revoked",
  student_session_logged_out: "session_revoked",
  student_session_expired: "session_expired",
  student_session_admin_reset: "session_revoked",
  student_session_revoked_by_reset: "session_revoked",
  student_session_superseded: "session_replaced",
  // Enrollment is missing or not active. Caller treats it as a session
  // problem because that is how the contract reads from the
  // learner's perspective when the entry path is required.
  enrollment_inactive: "invalid_session"
});

export function mapLmsAccessReasonToError(reason) {
  if (!reason) return "invalid_session";
  return PUBLIC_REASON_TO_ERROR[reason] || "invalid_session";
}

/**
 * RP2-B1 HTTP status mapping. Kept centralized so response shapes
 * stay identical between course-data and lesson. `one_device_policy_unavailable`
 * is the only 503 outcome (fail-closed); everything else is 401/403
 * depending on whether the failure is a session shape problem (401) or
 * an explicit device mismatch (403). Per the plan we pick 401 for
 * device_mismatch too so the contract is uniform and the mapping
 * easier to reason about.
 */
export function httpStatusForLmsAccessError(errorCode, { flagOn = false } = {}) {
  if (errorCode === "one_device_policy_unavailable") return 503;
  if (errorCode === "device_mismatch") return 401;
  return 401;
}

export function isLmsAccessVerificationError(reason) {
  return Boolean(reason) && PUBLIC_REASON_TO_ERROR.hasOwnProperty(reason);
}
