import { supabase } from "../supabase.js";
import {
  ACCOUNT_SHARING_EVENT_TYPES,
  createLmsVerifiedSession,
  logStudentDeviceEvent,
  markLmsEntryTokenUsed,
  normalizeEmail,
  touchStudentSession,
  verifyLmsEntryToken
} from "../lms-session-guard.js";
import { applyCors } from "../cors.js";
import { isV2GlobalOneDeviceEnabled } from "../v2-flags.js";

const ACTIVE_ENROLLMENT_STATUSES = new Set([
  "active",
  "approved",
  "approved_ready",
  "approved_waiting_content",
  "completed",
  "da duyet"
]);

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

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

function isStale(timestamp, idleHours) {
  if (!timestamp) return true;
  const lastSeen = new Date(timestamp).getTime();
  if (!Number.isFinite(lastSeen)) return true;
  return Date.now() - lastSeen > idleHours * 60 * 60 * 1000;
}

function jsonError(res, status, error, code) {
  return res.status(status).json({ ok: false, error, code });
}

async function logDeviceEventSafe(payload) {
  try {
    await logStudentDeviceEvent(supabase, payload);
  } catch (error) {
    console.warn("[account-sharing] LMS event skipped:", error.message);
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "portal",
    methods: "POST, OPTIONS",
    allowedHeaders: "Content-Type"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return jsonError(res, 405, "Phuong thuc khong duoc ho tro.", "method_not_allowed");
  }

  try {
    const entryToken = String(req.body?.entry_token || "").trim();
    const lmsDeviceId = String(req.body?.lms_device_id || "").trim();

    if (!entryToken) {
      return jsonError(res, 400, "Thieu ma vao lop.", "missing_entry_token");
    }

    if (!lmsDeviceId) {
      return jsonError(res, 400, "Thieu ma thiet bi hoc.", "missing_lms_device_id");
    }

    // RP2-B1 test seam: when the test runner activates the supabase
    // stub (LMS_RP2B1_SUPABASE_STUB=1 + JSON stub on disk), the stub
    // loader also injects a `verifyLmsEntryTokenStub` sentinel via
    // globalThis so this handler does not call the real
    // `verifyLmsEntryToken` (which would fail in the absence of a
    // real database). Production never sets the sentinel.
    const entryTokenStub = globalThis.__RP2B1_ENTRY_TOKEN_STUB__;
    const tokenResult = entryTokenStub
      ? entryTokenStub
      : await verifyLmsEntryToken(supabase, entryToken);
    if (!tokenResult.ok || !tokenResult.entryToken) {
      if (tokenResult.entryToken?.email) {
        await logDeviceEventSafe({
          email: tokenResult.entryToken.email,
          eventType: ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_REJECTED,
          courseSlug: tokenResult.entryToken.course_slug,
          postId: tokenResult.entryToken.post_id,
          lmsDeviceId,
          userAgent: req.headers["user-agent"] || null,
          ip: getClientIp(req),
          reason: tokenResult.reason || "invalid_entry_token",
          reasonCode: tokenResult.reason || "invalid_entry_token",
          result: "rejected",
          source: "lms",
          correlationId: tokenResult.entryToken.id,
          flowId: tokenResult.entryToken.id,
          idempotencyKey: `entry_token_rejected:${tokenResult.entryToken.id}:${tokenResult.reason || "invalid"}`,
          metadata: {
            tokenStatus: tokenResult.entryToken.status || null
          }
        });
      }
      // RP2-B1: never echo DB-derived identifiers (token id, raw reason
      // text, user agent, IP) in the response body. The client receives
      // a stable error code that maps back to the entry-token lifecycle.
      return jsonError(
        res,
        401,
        "Lien ket lop hoc khong hop le hoac da het han. Vui long quay lai bai tra bai va bam lai nut Bai hoc goc phuc vu giang day.",
        "invalid_entry_token"
      );
    }

    const entry = tokenResult.entryToken;
    const email = normalizeEmail(entry.email);
    const courseSlug = String(entry.course_slug || "").trim();
    const studentSessionId = String(entry.student_session_id || "").trim();

    if (!email || !courseSlug || !studentSessionId) {
      return jsonError(res, 401, "Lien ket lop hoc thieu thong tin can thiet.", "invalid_entry_payload");
    }

    const { data: studentSession, error: sessionError } = globalThis.__RP2B1_STUDENT_SESSION_STUB__
      ? globalThis.__RP2B1_STUDENT_SESSION_STUB__
      : await supabase
      .from("student_active_sessions")
      .select("*")
      .eq("student_session_id", studentSessionId)
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!studentSession) {
      // RP2-B1: sanitize the public error code so the body never leaks
      // internal state details.
      return jsonError(res, 401, "Phien dang nhap hoc vien khong con hieu luc. Vui long dang nhap lai tu cong hoc vien.", "session_revoked");
    }

    if (isStale(studentSession.last_seen_at, 24)) {
      await supabase
        .from("student_active_sessions")
        .update({
          status: "expired",
          updated_at: new Date().toISOString()
        })
        .eq("student_session_id", studentSessionId)
        .eq("status", "active");

      // RP2-B1: surface as session_expired (no DB row id in body).
      return jsonError(res, 401, "Phien dang nhap hoc vien da het han. Vui long dang nhap lai tu cong hoc vien.", "session_expired");
    }

    const { data: enrollments, error: enrollError } = globalThis.__RP2B1_ENROLLMENTS_STUB__
      ? globalThis.__RP2B1_ENROLLMENTS_STUB__
      : await supabase
      .from("student_enrollments")
      .select("id, status")
      .eq("email", email)
      .eq("course_slug", courseSlug)
      .limit(10);

    if (enrollError) throw enrollError;
    const activeEnrollment = (enrollments || []).find(enrollment => isActiveEnrollment(enrollment.status));
    if (!activeEnrollment) {
      // RP2-B1: never echo the email back when flag is on; keep the
      // generic 403 contract otherwise. The response stays as before.
      return jsonError(res, 403, "Gmail nay chua duoc cap quyen hoc khoa nay.", "enrollment_inactive");
    }

    const lmsSession = globalThis.__RP2B1_CREATED_LMS_SESSION_STUB__
      ? globalThis.__RP2B1_CREATED_LMS_SESSION_STUB__
      : await createLmsVerifiedSession(supabase, {
        email,
        studentSessionId,
        lmsDeviceId,
        courseSlug,
        entryTokenId: entry.id,
        ip: getClientIp(req),
        userAgent: req.headers["user-agent"] || null
      });

    if (!globalThis.__RP2B1_CREATED_LMS_SESSION_STUB__) {
      await markLmsEntryTokenUsed(supabase, entry.id);
    }
    if (!globalThis.__RP2B1_SKIP_TOUCH__) {
      await touchStudentSession(supabase, studentSessionId);
    }
    if (!globalThis.__RP2B1_SKIP_EVENT_LOG__) {
      await logDeviceEventSafe({
        email,
        eventType: ACCOUNT_SHARING_EVENT_TYPES.ENTRY_TOKEN_USED,
        courseSlug,
        postId: entry.post_id,
        newStudentSessionId: studentSessionId,
        lmsDeviceId,
        lmsSessionId: lmsSession.lms_session_id,
        userAgent: req.headers["user-agent"] || null,
        ip: getClientIp(req),
        source: "lms",
        result: "success",
        correlationId: entry.id,
        flowId: entry.id,
        idempotencyKey: `entry_token_used:${entry.id}`,
        metadata: {
          entryTokenStatus: "used"
        }
      });
      await logDeviceEventSafe({
        email,
        eventType: ACCOUNT_SHARING_EVENT_TYPES.LMS_SESSION_CREATED,
        courseSlug,
        postId: entry.post_id,
        newStudentSessionId: studentSessionId,
        lmsDeviceId,
        lmsSessionId: lmsSession.lms_session_id,
        userAgent: req.headers["user-agent"] || null,
        ip: getClientIp(req),
        source: "lms",
        result: "success",
        correlationId: entry.id,
        flowId: entry.id,
        idempotencyKey: `lms_session_created:${lmsSession.id || lmsSession.lms_session_id}`
      });
    }

    return res.status(200).json({
      ok: true,
      course_slug: courseSlug,
      lms_session_id: lmsSession.lms_session_id
      // RP2-B1: response intentionally omits the LMS device id and any
      // raw `lms_session` row metadata. The LMS client already knows the
      // `lms_device_id` it submitted; echoing device A's metadata back
      // would leak the verified binding to a caller that does not need
      // it. Course slug remains so the client can pivot its UI.
    });
  } catch (err) {
    // RP2-B1: when the flag is on, fail-closed. Do not log or return
    // the raw DB error. Telemetry stays best-effort elsewhere.
    if (isV2GlobalOneDeviceEnabled()) {
      console.error("[verify-entry-token] Flag-on fail-closed path engaged:", err.message);
      return jsonError(
        res,
        503,
        "He thong chua the xac minh phien hoc. Vui long thu lai sau.",
        "one_device_policy_unavailable"
      );
    }
    console.error("[verify-entry-token] Unexpected error:", err.message);
    return jsonError(res, 500, "Khong xac thuc duoc lien ket vao lop. Vui long thu lai sau.", "server_error");
  }
}
