import { supabase } from "../supabase.js";
import {
  verifyStudentSession,
  parseCookies,
  signBunnyEmbedUrl,
  signMediaUrls,
  normalizeEmail
} from "../lms.js";
import { google } from "googleapis";
import {
  isEntryTokenRequiredCourse,
  verifyLmsVerifiedSessionAccess,
  mapLmsAccessReasonToError,
  httpStatusForLmsAccessError,
  shouldRequireLmsVerifiedSession
} from "../lms-session-guard.js";
import { isV2GlobalOneDeviceEnabled } from "../v2-flags.js";
import { applyCors } from "../cors.js";
import { resolveMainMediaInfo } from "../lms-media.js";

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

// RP2-B1 safe access-error response. Mirrors the same helper in
// course-data.js so the wire contract stays identical between the two
// endpoints (no DB error / device id / session id / email leakage).
function respondWithAccessError(res, { reason, flagOn, fallbackStatus = 403 }) {
  const errorCode = mapLmsAccessReasonToError(reason);
  const status = httpStatusForLmsAccessError(errorCode, { flagOn });
  return res.status(status || fallbackStatus).json({
    success: false,
    error: errorCode,
    authError: errorCode,
    code: errorCode
  });
}

function normalizeMaterials(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = String(item.name || item.fileName || "").trim();
      const url = String(item.url || item.webViewLink || item.downloadUrl || "").trim();
      if (!name || !url) return null;
      return {
        id: String(item.id || item.fileId || url),
        name,
        url,
        downloadUrl: String(item.downloadUrl || url),
        mimeType: String(item.mimeType || ""),
        size: Number(item.size || 0),
        source: String(item.source || "google_drive")
      };
    })
    .filter(Boolean);
}

function getGoogleAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey
    },
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly"
    ]
  });
}

async function getDriveClient() {
  const auth = getGoogleAuth();
  return google.drive({ version: "v3", auth });
}

async function getDocsClient() {
  const auth = getGoogleAuth();
  return google.docs({ version: "v1", auth });
}

async function getDriveFileMetadata(fileId) {
  const drive = await getDriveClient();
  const metadata = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,shortcutDetails",
    supportsAllDrives: true
  });
  return metadata.data || {};
}

function getGoogleDocId(url) {
  const match = String(url || "").match(/docs\.google\.com\/document\/d\/([^/]+)/);
  return match ? match[1] : "";
}

function getGoogleDriveFileId(input) {
  const text = String(input || "").trim();
  const iframeMatch = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  const url = iframeMatch?.[1] ? iframeMatch[1].trim() : text;
  
  let match = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (match) return match[1];
  match = url.match(/[?&]id=([^&#]+)/);
  if (match) return match[1];
  return "";
}

function googleDocBodyToText(document) {
  const lines = [];
  const content = document?.body?.content || [];
  content.forEach(block => {
    const paragraph = block.paragraph;
    if (!paragraph) return;
    const text = (paragraph.elements || [])
      .map(element => element.textRun?.content || "")
      .join("")
      .trimEnd();
    if (text.trim()) lines.push(text.trim());
  });
  return lines.join("\n").trim();
}

function htmlToPlainText(html) {
  const text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (/^google drive|^sign in|quota exceeded|virus scan/i.test(text)) {
    return "";
  }
  return text;
}

function recipeTextUrl(recipeUrl) {
  const url = String(recipeUrl || "").trim();
  if (!url) return "";

  const docId = getGoogleDocId(url);
  if (docId) {
    return `https://docs.google.com/document/d/${docId}/export?format=txt`;
  }

  const fileId = getGoogleDriveFileId(url);
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  return url;
}

function recipePublicDownloadUrls(recipeUrl) {
  const url = String(recipeUrl || "").trim();
  const fileId = getGoogleDocId(url) || getGoogleDriveFileId(url);
  if (!fileId) return [url].filter(Boolean);

  return [
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
    `https://docs.google.com/uc?export=download&id=${fileId}`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
    recipeTextUrl(recipeUrl)
  ].filter(Boolean);
}

async function fetchRecipeTextFromGoogleApi(recipeUrl) {
  const docId = getGoogleDocId(recipeUrl);
  let fileId = docId || getGoogleDriveFileId(recipeUrl);
  if (!fileId) return "";

  const drive = await getDriveClient();
  let metadata;
  try {
    metadata = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,shortcutDetails,capabilities",
      supportsAllDrives: true
    });
  } catch (err) {
    return "";
  }

  if (metadata.data.mimeType === "application/vnd.google-apps.shortcut" && metadata.data.shortcutDetails?.targetId) {
    fileId = metadata.data.shortcutDetails.targetId;
    try {
      metadata = await drive.files.get({
        fileId,
        fields: "id,name,mimeType,shortcutDetails,capabilities",
        supportsAllDrives: true
      });
    } catch {
      return "";
    }
  }

  const mimeType = metadata.data.mimeType || "";
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    try {
      const result = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" }
      );
      return String(result.data || "").trim();
    } catch (err) {
      if (mimeType === "application/vnd.google-apps.document") {
        const docs = await getDocsClient();
        const result = await docs.documents.get({ documentId: fileId });
        return googleDocBodyToText(result.data);
      }
      throw err;
    }
  }

  if (docId) {
    const docs = await getDocsClient();
    const result = await docs.documents.get({ documentId: docId });
    return googleDocBodyToText(result.data);
  }

  const result = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true, acknowledgeAbuse: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(result.data || "").toString("utf8").trim();
}

async function fetchRecipeTextFromPublicUrl(recipeUrl) {
  const urls = recipePublicDownloadUrls(recipeUrl);
  if (!urls.length) return "";

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      if (contentType.includes("text/html") && /<html[\s>]/i.test(text)) {
        const plainText = htmlToPlainText(text);
        if (plainText) return plainText;
        throw new Error("HTML page returned");
      }
      return text.trim();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Public fetch failed");
}

async function fetchRecipeText(recipeUrl) {
  if (!recipeUrl) return "";
  const trimmed = recipeUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const text = await fetchRecipeTextFromGoogleApi(trimmed);
    if (text) return text;
  } catch (err) {
    console.warn("[lesson] Google API recipe fetch failed, trying public fallback:", err.message);
  }
  try {
    return await fetchRecipeTextFromPublicUrl(trimmed);
  } catch (err) {
    console.error("[lesson] Public recipe fetch failed:", err.message);
    return "";
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "portal",
    methods: "GET, OPTIONS",
    allowedHeaders: "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { id } = req.query || {};
  if (!id) {
    return res.status(400).json({ success: false, error: "Thiếu tham số ID bài học" });
  }

  try {
    // 1. Resolve identity. RP2-B1: when the flag is on, the only
    // authorized identity is the LMS verified session. The cookie is
    // parsed only to keep V1 callers happy in the flag-off path; it
    // never authorizes content access on its own.
    const cookies = parseCookies(req);
    const sToken = cookies[SESSION_COOKIE];
    const lmsHeaders = getLmsSessionHeaders(req);
    const hasLmsSessionHeaders = Boolean(lmsHeaders.lmsSessionId && lmsHeaders.lmsDeviceId);
    const flagOn = isV2GlobalOneDeviceEnabled();
    let email = null;
    let lmsSessionAccess = null;
    let lmsSessionFailureReason = "";

    if (hasLmsSessionHeaders) {
      const access = globalThis.__RP2B1_LMS_SESSION_STUB__
        ? globalThis.__RP2B1_LMS_SESSION_STUB__
        : await verifyLmsVerifiedSessionAccess(supabase, lmsHeaders);
      if (access.ok) {
        email = access.email;
        lmsSessionAccess = access;
      } else {
        lmsSessionFailureReason = access.reason || "invalid_lms_session";
      }
    } else {
      lmsSessionFailureReason = "missing_lms_session";
    }

    if (flagOn) {
      if (!lmsSessionAccess) {
        return respondWithAccessError(res, {
          reason: lmsSessionFailureReason || "missing_lms_session",
          flagOn: true
        });
      }
      email = lmsSessionAccess.email;
    } else if (sToken) {
      const decoded = verifyStudentSession(sToken);
      if (decoded && decoded.email) {
        email = decoded.email;
      }
    }

    if (!email) {
      return res.status(401).json({
        success: false,
        error: "Vui lòng đăng nhập để truy cập bài học",
        authError: "missing_login_session"
      });
    }

    // 2. Fetch lesson record
    const { data: lesson, error: fetchError } = globalThis.__RP2B1_LESSONS_STUB__
      ? globalThis.__RP2B1_LESSONS_STUB__
      : await supabase
      .from("lessons")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    // RP2-B1 stub shim: when the production code path runs through the
    // sentinels, the returned `data` is an object (not an array). The
    // production chain returns an array via select().maybeSingle(); we
    // normalize the sentinel into the same shape so the rest of the
    // handler can stay verbatim.
    const lessonRecord = Array.isArray(lesson) ? lesson[0] : lesson;
    if (fetchError) throw fetchError;
    if (!lessonRecord) {
      return res.status(404).json({ success: false, error: "Không tìm thấy bài học" });
    }
    const lessonResolved = lessonRecord;

    if (lmsSessionAccess && String(lessonResolved.course_slug || "").trim() !== lmsSessionAccess.courseSlug) {
      // RP2-B1: safe error contract — never echo the binding course.
      return respondWithAccessError(res, {
        reason: "course_mismatch",
        flagOn,
        fallbackStatus: 403
      });
    }

    if (shouldRequireLmsVerifiedSession(lessonResolved.course_slug) && !lmsSessionAccess) {
      const code = hasLmsSessionHeaders
        ? (lmsSessionFailureReason || "protected_session_invalid")
        : "entry_token_required";
      return res.status(403).json({
        success: false,
        authError: code,
        code,
        course: lessonResolved.course_slug,
        error: "Liên kết lớp học này cần được mở từ Cổng học viên. Vui lòng quay lại trang bài học trên yeunauan.live và bấm “Bài học gốc phục vụ giảng dạy” để vào lớp."
      });
    }

    // 3. Verify student enrollment for the course that this lesson belongs to
    const { data: enrollment, error: enrollError } = globalThis.__RP2B1_ENROLLMENTS_STUB__
      ? globalThis.__RP2B1_ENROLLMENTS_STUB__
      : await supabase
      .from("student_enrollments")
      .select("id, status")
      .eq("email", email)
      .eq("course_slug", lessonResolved.course_slug)
      .limit(10);

    if (enrollError) throw enrollError;
    const activeEnrollment = (enrollment || []).find(e => isActiveEnrollment(e.status));
    if (!activeEnrollment) {
      return res.status(403).json({
        success: false,
        error: "Bạn không có quyền xem bài học của khóa học này.",
        email,
        course: lessonResolved.course_slug
      });
    }

    // 4. Calculate exact displayLesson by querying all non-hidden lessons of this course ordered by lesson_no
    const { data: siblingLessons } = globalThis.__RP2B1_SIBLING_LESSONS_STUB__
      ? globalThis.__RP2B1_SIBLING_LESSONS_STUB__
      : await supabase
      .from("lessons")
      .select("id, is_section")
      .eq("course_slug", lessonResolved.course_slug)
      .neq("status", "hidden")
      .order("lesson_no", { ascending: true });

    const hasSection = (siblingLessons || []).some(l => Boolean(l.is_section));
    let displayLesson = lessonResolved.lesson_no;
    let sectionCounter = 0;
    let globalCounter = 0;

    for (const sib of (siblingLessons || [])) {
      const isSec = Boolean(sib.is_section);
      if (isSec) {
        sectionCounter = 0;
      } else {
        sectionCounter++;
        globalCounter++;
        if (sib.id === lessonResolved.id) {
          displayLesson = hasSection ? sectionCounter : globalCounter;
          break;
        }
      }
    }

    // 5. Secure Video URL & Media URLs
    const securedVideo = signBunnyEmbedUrl(lessonResolved.video_url || "");
    const securedMedia = signMediaUrls(lessonResolved.media_urls || "");
    const mainMediaInfo = Boolean(lessonResolved.is_section)
      ? { mainMediaType: "none", mainMediaMimeType: "", mainMediaName: "" }
      : await resolveMainMediaInfo(lessonResolved.video_url || "", getDriveFileMetadata);

    // 6. Fetch recipe text
    const recipeText = await fetchRecipeText(lessonResolved.recipe_url);

    // Formatted lesson output
    const formattedLesson = {
      id: lessonResolved.id,
      course: lessonResolved.course_slug,
      lesson: lessonResolved.lesson_no,
      displayLesson: displayLesson,
      title: lessonResolved.title,
      description: lessonResolved.description || "",
      duration: lessonResolved.duration_text || "",
      level: lessonResolved.level || "",
      thumbnailUrl: lessonResolved.thumbnail_url || "",
      videoUrl: lessonResolved.video_url || "",
      recipeUrl: lessonResolved.recipe_url || "",
      mediaUrls: securedMedia,
      ...mainMediaInfo,
      materials: Boolean(lessonResolved.is_section) ? [] : normalizeMaterials(lessonResolved.materials),
      isSection: Boolean(lessonResolved.is_section),
      views: lessonResolved.views || 0,
      status: lessonResolved.status || "active",
      recipeText,
      ...securedVideo
    };

    return res.status(200).json({
      success: true,
      email,
      lesson: formattedLesson
    });

  } catch (err) {
    // RP2-B1 fail-closed: when the flag is on we never leak the raw
    // DB error to the client. Telemetry is best-effort and lives in
    // lms-session-guard.
    if (isV2GlobalOneDeviceEnabled()) {
      return res.status(503).json({
        success: false,
        error: "one_device_policy_unavailable",
        authError: "one_device_policy_unavailable",
        code: "one_device_policy_unavailable"
      });
    }
    console.error("[api/lms/lesson] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi hệ thống khi tải bài học",
      detail: err.message
    });
  }
}
