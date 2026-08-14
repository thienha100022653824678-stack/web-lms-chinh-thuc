import { supabase } from "../supabase.js";
import {
  normalizeEmail,
  verifyStudentSession,
  createStudentSession,
  verifyGoogleIdToken,
  parseCookies,
  cookieOptions
} from "../lms.js";
import {
  verifyLmsVerifiedSessionAccess,
  mapLmsAccessReasonToError,
  httpStatusForLmsAccessError
} from "../lms-session-guard.js";
import { isV2GlobalOneDeviceEnabled } from "../v2-flags.js";
import { applyCors } from "../cors.js";

const SESSION_COOKIE = "course_session_token";
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

function getLmsSessionHeaders(req) {
  return {
    lmsSessionId: String(req.headers["x-lms-session-id"] || "").trim(),
    lmsDeviceId: String(req.headers["x-lms-device-id"] || "").trim()
  };
}

function respondAccessError(res, reason, flagOn) {
  const code = mapLmsAccessReasonToError(reason || "missing_lms_session");
  const status = httpStatusForLmsAccessError(code, { flagOn }) || 403;
  return res.status(status).json({
    success: false,
    allowed: false,
    error: code,
    authError: code,
    code
  });
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "portal",
    methods: "POST, OPTIONS",
    allowedHeaders: "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, allowed: false, error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const cookies = parseCookies(req);
    const sessionToken = body.sessionToken || cookies[SESSION_COOKIE] || "";
    const credential = body.credential || "";
    const lmsHeaders = getLmsSessionHeaders(req);
    const hasVerifiedHeaders = Boolean(lmsHeaders.lmsSessionId && lmsHeaders.lmsDeviceId);
    const flagOn = isV2GlobalOneDeviceEnabled();

    let email = "";
    let verifiedAccess = null;
    let verifiedFailure = hasVerifiedHeaders ? "invalid_lms_session" : "missing_lms_session";

    // Production authority first: reuse the exact verified LMS/device session
    // that course-data trusts. courseSlug=null validates the session's own
    // course and enrollment without weakening the one-device policy.
    if (hasVerifiedHeaders) {
      const access = await verifyLmsVerifiedSessionAccess(supabase, {
        ...lmsHeaders,
        courseSlug: null
      });
      if (access.ok) {
        verifiedAccess = access;
        email = normalizeEmail(access.email);
      } else {
        verifiedFailure = access.reason || verifiedFailure;
      }
    }

    // When the global one-device flag is enabled, cookie/Google identity is
    // not sufficient to authorize LMS content. V3 deliberately mirrors
    // course-data's fail-closed posture instead of creating a parallel login.
    if (flagOn && !verifiedAccess) {
      return respondAccessError(res, verifiedFailure, true);
    }

    // Legacy compatibility only when the global one-device gate is off.
    if (!email && sessionToken) {
      const decoded = verifyStudentSession(sessionToken);
      if (decoded?.email) email = normalizeEmail(decoded.email);
    }
    if (!email && credential) {
      email = normalizeEmail(await verifyGoogleIdToken(credential));
    }
    if (!email) {
      return res.status(401).json({
        success: false,
        allowed: false,
        error: "missing_login_session",
        authError: "missing_login_session",
        code: "missing_login_session"
      });
    }

    const { data: enrollments, error: enrollError } = await supabase
      .from("student_enrollments")
      .select("course_slug,status")
      .eq("email", email);
    if (enrollError) throw enrollError;

    const slugs = (enrollments || [])
      .filter(row => isActiveEnrollment(row.status))
      .map(row => String(row.course_slug || "").trim())
      .filter(Boolean);

    if (!slugs.length) {
      return res.status(403).json({
        success: false,
        allowed: false,
        email,
        allowedCourses: [],
        error: "Student has no active course enrollments",
        code: "no_active_enrollment"
      });
    }

    const { data: courseRows } = await supabase
      .from("courses")
      .select("slug,title")
      .in("slug", slugs);
    const titleBySlug = new Map((courseRows || []).map(row => [String(row.slug || ""), String(row.title || row.slug || "")]));
    const allowedCourses = slugs.map(slug => ({
      slug,
      title: titleBySlug.get(slug) || slug
    }));

    const response = {
      success: true,
      allowed: true,
      email,
      allowedCourses,
      verifiedSession: Boolean(verifiedAccess),
      verifiedCourse: verifiedAccess?.courseSlug || ""
    };

    // Keep V1 compatibility identity alive only while the global one-device
    // flag is off. With the flag on, verified LMS session remains authority.
    if (!flagOn) {
      const newSession = createStudentSession(email);
      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(newSession.token)}; ${cookieOptions(newSession.expiresAt - Date.now())}`
      );
      response.sessionToken = newSession.token;
      response.sessionExpiresAt = newSession.expiresAt;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("[v3-bootstrap] error:", err?.message);
    return res.status(503).json({
      success: false,
      allowed: false,
      error: "v3_bootstrap_unavailable",
      code: "v3_bootstrap_unavailable"
    });
  }
}
