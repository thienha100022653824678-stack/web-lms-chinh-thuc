import { supabase } from "../supabase.js";
import {
  normalizeEmail,
  createStudentSession,
  cookieOptions,
  signBunnyEmbedUrl,
  signMediaUrls
} from "../lms.js";
import { OAuth2Client } from "google-auth-library";
import { applyCors } from "../cors.js";
import { isV2GlobalOneDeviceEnabled } from "../v2-flags.js";

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

/**
 * Exchange Google authorization code for tokens, verify, check enrollment,
 * and return course data in one call.
 *
 * This replaces the old implicit-flow (response_type=id_token) approach
 * which Google has deprecated for newer OAuth clients.
 */
export default async function handler(req, res) {
  // RP2-B1: this handler is currently an orphan (no router mapping and
  // no caller in either the LMS or Portal repos), but its existence
  // constitutes a future bypass vector — if a future developer wires
  // it back up, the V1 path will mint a `course_session_token` cookie
  // and grant course access without ever invoking the Portal one-
  // device login RPC. To make that bypass impossible to re-enable
  // accidentally, we fail closed BEFORE any Google/Supabase/session
  // work whenever the V2 one-device flag is on.
  if (isV2GlobalOneDeviceEnabled()) {
    const cors = applyCors(req, res, {
      mode: "portal",
      methods: "POST, OPTIONS",
      allowedHeaders: "Content-Type"
    });
    if (cors.handled) return res.status(cors.status).json(cors.body);
    if (req.method === "OPTIONS") return res.status(200).end();
    return res.status(410).json({
      allowed: false,
      error: "legacy_login_disabled",
      code: "legacy_login_disabled",
      message: "This login flow is disabled. Vui long dang nhap qua Cong hoc vien de su dung lop hoc."
    });
  }

  const cors = applyCors(req, res, {
    mode: "portal",
    methods: "POST, OPTIONS",
    allowedHeaders: "Content-Type"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ allowed: false, error: "Method not allowed" });

  try {
    const { code, redirectUri, course } = req.body || {};
    if (!code) return res.status(400).json({ allowed: false, error: "Missing authorization code" });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error("[exchange-code] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
      return res.status(500).json({ allowed: false, error: "Server config error: missing Google OAuth credentials" });
    }

    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri && redirectUri.startsWith("http") ? redirectUri : "https://www.daubepnho.store/lms.html",
        grant_type: "authorization_code"
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error) {
      // RP-1: never log the full tokenData object — on some error shapes it
      // can still carry id_token / access_token. Log only the error fields.
      console.error(
        "[exchange-code] Token exchange failed:",
        tokenData?.error || "unknown_error"
      );
      return res.status(401).json({
        allowed: false, error: "Google token exchange failed",
        detail: tokenData.error_description || tokenData.error || "Unknown error"
      });
    }

    // 2. Verify id_token signature server-side using Google's OAuth2 client.
    //    RP-1: do NOT trust the raw id_token returned by the token endpoint
    //    without verifying the signature. Previously the code only checked
    //    the audience claim from a base64url-decoded payload.
    const idToken = tokenData.id_token;
    if (!idToken) return res.status(401).json({ allowed: false, error: "No id_token in Google response" });

    let email = null;
    let oauthClient = null;
    try {
      oauthClient = new OAuth2Client(clientId);
      const ticket = await oauthClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      email = normalizeEmail(payload?.email);
    } catch (verifyErr) {
      console.error("[exchange-code] id_token verification failed:", verifyErr.message);
      return res.status(401).json({ allowed: false, error: "Invalid or unverified id_token" });
    }
    if (!email) return res.status(401).json({ allowed: false, error: "No email in token" });

    // 3. Check enrollment
    const courseSlug = String(course || "").trim();
    const { data: enrollments, error: enrollError } = await supabase
      .from("student_enrollments").select("course_slug, status").eq("email", email);
    if (enrollError) throw enrollError;

    const allowedCourses = (enrollments || [])
      .filter(e => isActiveEnrollment(e.status))
      .map(e => String(e.course_slug || "").trim())
      .filter(Boolean);
    if (allowedCourses.length === 0) {
      return res.status(403).json({ allowed: false, email, error: "Student has no active course enrollments" });
    }

    const activeCourseSlug = courseSlug && allowedCourses.includes(courseSlug) ? courseSlug : allowedCourses[0];
    if (courseSlug && !allowedCourses.includes(courseSlug)) {
      return res.status(403).json({
        allowed: false, email,
        error: "Tai khoan " + email + " chua kich hoat khoa hoc nay.",
        allowedCourses
      });
    }

    // 4. Load course info & lessons
    const { data: courseRow } = await supabase.from("courses").select("title, subtitle, image_url, raw_data").eq("slug", activeCourseSlug).maybeSingle();
    const courseRawData = (courseRow && courseRow.raw_data) || {};
    const { data: configRows } = await supabase.from("site_config").select("key, value");
    const rawConfig = {};
    if (configRows) configRows.forEach(row => {
      const valObj = row.value;
      rawConfig[row.key] = (valObj && typeof valObj === "object" && valObj.val !== undefined) ? valObj.val : valObj;
    });

    const studentDisplayTitle = String(
      courseRawData.studentDisplayTitle ||
      rawConfig[activeCourseSlug + "_studentDisplayTitle"] ||
      ""
    ).trim();
    const originalCourseTitle = (courseRow && courseRow.title) || rawConfig[activeCourseSlug + "_title"] || rawConfig.title || activeCourseSlug;

    const courseInfo = {
      title: studentDisplayTitle || originalCourseTitle || "Culinary Academy",
      originalTitle: originalCourseTitle,
      studentDisplayTitle,
      subtitle: (courseRow && courseRow.subtitle) || rawConfig[activeCourseSlug + "_subtitle"] || rawConfig.subtitle || "",
      heroImage: (courseRow && courseRow.image_url) || courseRawData.heroImageUrl || courseRawData.bannerImageUrl || rawConfig[activeCourseSlug + "_heroImage"] || rawConfig.heroImage || ""
    };

    const { data: lessonsRows, error: lessonsError } = await supabase
      .from("lessons").select("*").eq("course_slug", activeCourseSlug).neq("status", "hidden").order("lesson_no", { ascending: true });
    if (lessonsError) throw lessonsError;

    let lessons = (lessonsRows || []).map(l => {
      const securedVideo = signBunnyEmbedUrl(l.video_url || "");
      const securedMedia = signMediaUrls(l.media_urls || "");
      return {
        id: l.id, course: l.course_slug, lesson: l.lesson_no, title: l.title,
        description: l.description || "", duration: l.duration_text || "", level: l.level || "",
        thumbnailUrl: l.thumbnail_url || "", videoUrl: l.video_url || "", recipeUrl: l.recipe_url || "",
        mediaUrls: securedMedia, views: l.views || 0, status: l.status || "active",
        isSection: l.is_section || false, materials: l.materials || [], ...securedVideo
      };
    });

    // 5. Create session & return
    const newSession = createStudentSession(email);
    res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + encodeURIComponent(newSession.token) + "; " + cookieOptions(newSession.expiresAt - Date.now()));

    return res.status(200).json({
      allowed: true, apiVersion: "premium-bunny-stream-v1", email,
      course: activeCourseSlug, allowedCourses, courseInfo, lessons,
      sessionToken: newSession.token, sessionExpiresAt: newSession.expiresAt
    });
  } catch (err) {
    console.error("[exchange-code] Unexpected error:", err);
    // RP2-B1: when the flag is on this branch is never reached
    // because the early guard returned 410. Sanitize the response so
    // the JSON body never leaks the raw DB error to the client.
    return res.status(500).json({ allowed: false, error: "Server error" });
  }
}
