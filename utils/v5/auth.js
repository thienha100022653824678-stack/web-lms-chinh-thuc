import { supabase } from "../supabase.js";
import { getAdminFromRequest, parseCookies, verifyStudentSession, normalizeEmail } from "../lms.js";
import {
  verifyLmsVerifiedSessionAccess,
  shouldRequireLmsVerifiedSession,
  mapLmsAccessReasonToError,
  httpStatusForLmsAccessError
} from "../lms-session-guard.js";
import { apiError, normalizeCourseSlug } from "./core.js";

const STUDENT_COOKIE = "course_session_token";

export function requireV5Admin(req) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) throw apiError(401, "admin_auth_required", "Admin authentication is required.");
  return { email: normalizeEmail(admin.email) };
}

export async function requireStudentIdentity(req, requestedCourseSlug = "") {
  const courseSlug = requestedCourseSlug ? normalizeCourseSlug(requestedCourseSlug) : "";
  if (requestedCourseSlug && !courseSlug) throw apiError(422, "invalid_course_slug", "Invalid course slug.");
  const headers = {
    lmsSessionId: String(req.headers?.["x-lms-session-id"] || "").trim(),
    lmsDeviceId: String(req.headers?.["x-lms-device-id"] || "").trim()
  };
  const hasVerifiedHeaders = Boolean(headers.lmsSessionId && headers.lmsDeviceId);
  let verified = null;
  let failureReason = hasVerifiedHeaders ? "invalid_lms_session" : "missing_lms_session";

  if (hasVerifiedHeaders) {
    const result = globalThis.__V5_LMS_ACCESS_STUB__ || await verifyLmsVerifiedSessionAccess(supabase, {
      ...headers,
      courseSlug: courseSlug || null
    });
    if (result.ok) verified = result;
    else failureReason = result.reason || failureReason;
  }

  if (courseSlug && shouldRequireLmsVerifiedSession(courseSlug) && !verified) {
    const code = mapLmsAccessReasonToError(failureReason);
    throw apiError(httpStatusForLmsAccessError(code, { flagOn: true }), code, "A valid protected LMS session is required.");
  }

  let email = verified?.email || "";
  if (!email) {
    const cookies = parseCookies(req);
    const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    const decoded = verifyStudentSession(cookies[STUDENT_COOKIE] || bearer);
    email = decoded?.email || "";
  }
  if (!email) throw apiError(401, "student_auth_required", "Student authentication is required.");
  if (courseSlug && verified?.courseSlug && normalizeCourseSlug(verified.courseSlug) !== courseSlug) {
    throw apiError(403, "course_scope_mismatch", "The session is scoped to a different course.");
  }
  return { email: normalizeEmail(email), studentId: verified?.studentId || null, verified, courseSlug };
}

export async function requireEnrollment(identity, courseSlug) {
  const canonical = normalizeCourseSlug(courseSlug);
  if (!canonical) throw apiError(422, "invalid_course_slug", "Invalid course slug.");
  const stub = globalThis.__V5_ENROLLMENT_STUB__;
  const result = stub || await supabase
    .from("student_enrollments")
    .select("id,email,course_slug,status")
    .eq("email", identity.email)
    .eq("course_slug", canonical)
    .maybeSingle();
  if (result.error) throw apiError(503, "enrollment_unavailable", "Enrollment verification is unavailable.");
  const status = String(result.data?.status || "").trim().toLowerCase();
  if (!result.data || !["active", "approved", "paid", "granted"].includes(status)) {
    throw apiError(403, "enrollment_required", "An active course enrollment is required.");
  }
  return result.data;
}
