// utils/lms-handlers/logout.js
// RP2-B2 — Server-side student logout.
//
// Revokes the student active session server-side and clears the
// course_session_token cookie. Idempotent: a repeat call after a successful
// logout still returns 200. On server failure the handler does NOT clear the
// cookie or fake success — the client only clears local state after a 200.
//
// Identity comes from the LMS verified-session headers
// (X-LMS-Session-Id / X-LMS-Device-Id), never from course_session_token.
// When V2_GLOBAL_ONE_DEVICE_ENABLED is on, a missing/invalid session fails
// closed (401/503). When the flag is off, a missing/invalid session falls
// back to a best-effort client cookie clear (V1 compat).

import { supabase } from "../supabase.js";
import { cookieOptions } from "../lms.js";
import {
  verifyLmsVerifiedSessionAccess,
  markStudentSessionLoggedOut,
  mapLmsAccessReasonToError,
  httpStatusForLmsAccessError
} from "../lms-session-guard.js";
import { isV2GlobalOneDeviceEnabled } from "../v2-flags.js";
import { applyCors } from "../cors.js";

const SESSION_COOKIE = "course_session_token";

function getLmsSessionHeaders(req) {
  return {
    lmsSessionId: String(req.headers["x-lms-session-id"] || "").trim(),
    lmsDeviceId: String(req.headers["x-lms-device-id"] || "").trim()
  };
}

function respondWithAccessError(res, { reason, flagOn, fallbackStatus = 401 }) {
  const errorCode = mapLmsAccessReasonToError(reason);
  const status = httpStatusForLmsAccessError(errorCode, { flagOn }) || fallbackStatus;
  return res.status(status).json({
    success: false,
    allowed: false,
    error: errorCode,
    authError: errorCode,
    code: errorCode
  });
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${cookieOptions(0)}`);
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
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const flagOn = isV2GlobalOneDeviceEnabled();
  const lmsHeaders = getLmsSessionHeaders(req);
  const hasHeaders = Boolean(lmsHeaders.lmsSessionId && lmsHeaders.lmsDeviceId);

  let access = null;
  let failureReason = "";

  if (hasHeaders) {
    let result;
    try {
      if (globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ !== undefined) {
        result = typeof globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ === "function"
          ? await globalThis.__RP2B2_LOGOUT_VERIFY_STUB__(supabase, lmsHeaders)
          : globalThis.__RP2B2_LOGOUT_VERIFY_STUB__;
      } else {
        result = await verifyLmsVerifiedSessionAccess(supabase, { ...lmsHeaders });
      }
      if (result && result.ok) {
        access = result;
      } else {
        failureReason = (result && result.reason) || "invalid_lms_session";
      }
    } catch (err) {
      console.error("[logout] verify failed:", err.message);
      failureReason = "invalid_lms_session";
      access = null;
    }
  } else {
    failureReason = "missing_lms_session";
  }

  // Flag-on: a valid LMS verified session is mandatory. Fail closed; do not
  // touch the cookie.
  if (flagOn && !access) {
    return respondWithAccessError(res, {
      reason: failureReason || "missing_lms_session",
      flagOn: true
    });
  }

  // Flag-off, no valid session: best-effort client logout (V1 compat). We do
  // not fake a server revoke — serverRevoked is false.
  if (!access) {
    clearSessionCookie(res);
    return res.status(200).json({
      success: true,
      loggedOut: true,
      serverRevoked: false
    });
  }

  // Valid session: revoke server-side (idempotent — 0 rows is fine).
  const studentSessionId = access.studentSession?.student_session_id;
  try {
    const logoutFn = globalThis.__RP2B2_LOGOUT_FN_STUB__ ?? markStudentSessionLoggedOut;
    if (studentSessionId) {
      await logoutFn(supabase, studentSessionId);
    }
  } catch (err) {
    console.error("[logout] server revoke failed:", err.message);
    if (flagOn) {
      return res.status(503).json({
        success: false,
        error: "one_device_policy_unavailable",
        code: "one_device_policy_unavailable"
      });
    }
    return res.status(500).json({
      success: false,
      error: "logout_failed",
      code: "logout_failed"
    });
  }

  clearSessionCookie(res);
  return res.status(200).json({
    success: true,
    loggedOut: true,
    serverRevoked: true
  });
}
