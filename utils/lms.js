import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import crypto from "crypto";

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const STUDENT_SESSION_COOKIE = "course_session_token";
const ADMIN_SESSION_COOKIE = "admin_session_token";

// Normalizes email string
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Check if email is in ADMIN_EMAILS list
export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return getAdminEmails().includes(normalizeEmail(email));
}

// Session secrets
function sessionSecrets() {
  return [
    process.env.SESSION_SECRET,
    process.env.GOOGLE_CLIENT_ID,
    "fallback-session-secret"
  ]
    .filter(Boolean)
    .map(s => String(s).trim())
    .filter((s, idx, self) => s && self.indexOf(s) === idx);
}

function sessionSecret() {
  return sessionSecrets()[0] || "fallback-session-secret";
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payloadBase64, secret = sessionSecret()) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadBase64)
    .digest("base64url");
}

// Student Sessions
export function createStudentSession(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = { email: normalizeEmail(email), exp: expiresAt };
  const payloadBase64 = base64url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt
  };
}

export function verifyStudentSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const validSignature = sessionSecrets().some(secret => {
    const expectedSignature = signPayload(payloadBase64, secret);
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSignature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  if (!validSignature) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (!payload.email || !payload.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;

    return {
      email: normalizeEmail(payload.email),
      expiresAt: Number(payload.exp)
    };
  } catch {
    return null;
  }
}

// Admin Sessions
export function createAdminSession(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = { email: normalizeEmail(email), role: "admin", exp: expiresAt };
  const payloadBase64 = base64url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt
  };
}

export function verifyAdminSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const validSignature = sessionSecrets().some(secret => {
    const expectedSignature = signPayload(payloadBase64, secret);
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSignature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  if (!validSignature) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (!payload.email || !payload.exp || payload.role !== "admin") return null;
    if (Date.now() > Number(payload.exp)) return null;
    if (!isAdminEmail(payload.email)) return null;

    return {
      email: normalizeEmail(payload.email),
      expiresAt: Number(payload.exp)
    };
  } catch {
    return null;
  }
}

// Extract cookies
export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  return header.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
    return cookies;
  }, {});
}

// Get admin session from request
export function getAdminFromRequest(req) {
  const cookies = parseCookies(req);
  const token =
    req.body?.sessionToken ||
    req.query?.sessionToken ||
    (req.headers?.authorization || "").replace(/^Bearer\s+/i, "") ||
    cookies[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  return verifyAdminSession(token);
}

// Google ID token verify
export async function verifyGoogleIdToken(credential) {
  if (!credential) return null;
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return normalizeEmail(payload?.email);
}

// Cookie Options helper
export function cookieOptions(maxAgeMs) {
  const parts = [
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// Bunny Stream Token Signing
function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const match = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? match[1].trim() : text;
}

function parseBunnyVideoIdAndLibraryId(videoUrl) {
  let src = extractIframeSrc(videoUrl).replace(/&amp;/g, "&").trim();
  if (!src) return null;

  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, "");
    if (
      host !== "player.mediadelivery.net" &&
      host !== "iframe.mediadelivery.net" &&
      host !== "video.bunnycdn.com"
    ) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const mode = parts[0];
    const libraryId = parts[1];
    const videoId = parts[2];

    if ((mode !== "embed" && mode !== "play") || !libraryId || !videoId) {
      return null;
    }
    return { libraryId, videoId };
  } catch {
    const match = src.match(/(?:player|iframe)\.mediadelivery\.net\/embed\/([^/]+)\/([^/?#]+)/);
    if (match) return { libraryId: match[1], videoId: match[2] };
    const matchPlay = src.match(/(?:player|iframe)\.mediadelivery\.net\/play\/([^/]+)\/([^/?#]+)/);
    if (matchPlay) return { libraryId: matchPlay[1], videoId: matchPlay[2] };
    return null;
  }
}

export function signBunnyEmbedUrl(videoUrl) {
  const parsed = parseBunnyVideoIdAndLibraryId(videoUrl);
  if (!parsed) {
    return {
      secureVideoUrl: videoUrl || "",
      videoProvider: "",
      videoAuthStatus: "not_bunny_embed"
    };
  }

  const { libraryId, videoId } = parsed;
  const normalizedVideoUrl = `https://player.mediadelivery.net/embed/${libraryId}/${videoId}`;
  const tokenKey = String(process.env.BUNNY_STREAM_TOKEN_KEY || "").trim();

  if (!tokenKey) {
    return {
      secureVideoUrl: "",
      videoProvider: "bunny_embed",
      videoAuthStatus: "missing_bunny_stream_token_key",
      normalizedVideoUrl
    };
  }

  const expires = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  const token = crypto
    .createHash("sha256")
    .update(`${tokenKey}${videoId}${expires}`)
    .digest("hex");

  return {
    secureVideoUrl: `${normalizedVideoUrl}?token=${token}&expires=${expires}`,
    videoProvider: "bunny_embed",
    videoAuthStatus: "signed",
    normalizedVideoUrl,
    secureVideoExpiresAt: expires
  };
}

export function signMediaUrls(rawMediaUrlsStr) {
  const raw = rawMediaUrlsStr || "";
  if (!raw) return "";

  const tokenKey = String(process.env.BUNNY_STREAM_TOKEN_KEY || "").trim();

  return raw.split("\n").map(line => {
    const trimmed = line.trim();
    if (!trimmed) return "";

    const firstPipe = trimmed.indexOf("|");
    if (firstPipe === -1) return line;
    const secondPipe = trimmed.indexOf("|", firstPipe + 1);
    if (secondPipe === -1) return line;

    const type = trimmed.slice(0, firstPipe).trim();
    const title = trimmed.slice(firstPipe + 1, secondPipe).trim();
    const rawUrl = trimmed.slice(secondPipe + 1).trim();
    const url = extractIframeSrc(rawUrl).replace(/&amp;/g, "&").trim();

    if (type === "video") {
      if (
        url.includes("drive.google.com/file/d/") ||
        /drive\.google\.com\/open\?id=/.test(url) ||
        /drive\.google\.com\/uc\?id=/.test(url)
      ) {
        let fileId = "";
        let match = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
        if (match) fileId = match[1];
        else {
          match = url.match(/[?&]id=([^&#]+)/);
          if (match) fileId = match[1];
        }
        const previewUrl = fileId ? `https://drive.google.com/file/d/${fileId}/preview` : url;
        return `${type}|${title}|${previewUrl}`;
      }

      const parsed = parseBunnyVideoIdAndLibraryId(url);
      if (parsed) {
        const { libraryId, videoId } = parsed;
        if (url.includes("token=") && url.includes("expires=")) {
          return `${type}|${title}|${url}`;
        }
        if (!tokenKey) {
          return `video|${title}|error:Thiếu BUNNY_STREAM_TOKEN_KEY nên không ký được media`;
        }

        let queryParams = "";
        try {
          const urlObj = new URL(url);
          urlObj.searchParams.delete("token");
          urlObj.searchParams.delete("expires");
          const search = urlObj.search;
          if (search) queryParams = search.startsWith("?") ? search : "?" + search;
        } catch {
          const qIdx = url.indexOf("?");
          if (qIdx !== -1) {
            const searchParams = new URLSearchParams(url.slice(qIdx));
            searchParams.delete("token");
            searchParams.delete("expires");
            const searchStr = searchParams.toString();
            if (searchStr) queryParams = "?" + searchStr;
          }
        }

        const expires = Math.floor(Date.now() / 1000) + 600;
        const token = crypto
          .createHash("sha256")
          .update(`${tokenKey}${videoId}${expires}`)
          .digest("hex");

        const normalizedVideoUrl = `https://player.mediadelivery.net/embed/${libraryId}/${videoId}`;
        let secureUrl = `${normalizedVideoUrl}?token=${token}&expires=${expires}`;
        if (queryParams) {
          secureUrl = `${normalizedVideoUrl}${queryParams}&token=${token}&expires=${expires}`;
        }
        return `${type}|${title}|${secureUrl}`;
      }
    }
    return `${type}|${title}|${url}`;
  }).filter(Boolean).join("\n");
}

// Auto Enroll Logic when orders are approved
export async function autoEnroll(supabase, { email, courseSlug, name, phone, orderId }) {
  if (!email || !courseSlug) return;
  const cleanEmail = normalizeEmail(email);

  try {
    let studentId;
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (studentError) {
      console.error("Error checking student in autoEnroll:", studentError);
    }

    if (student) {
      studentId = student.id;
      await supabase
        .from("students")
        .update({
          full_name: name || undefined,
          phone: phone || undefined,
          updated_at: new Date().toISOString()
        })
        .eq("id", studentId);
    } else {
      const { data: newStudent, error: insertError } = await supabase
        .from("students")
        .insert({
          email: cleanEmail,
          full_name: name || null,
          phone: phone || null,
          status: "active",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Error inserting student in autoEnroll:", insertError);
        return;
      }
      studentId = newStudent.id;
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", courseSlug)
      .maybeSingle();

    const courseId = course?.id || null;

    const { error: enrollError } = await supabase
      .from("student_enrollments")
      .upsert({
        student_id: studentId,
        course_id: courseId,
        course_slug: courseSlug,
        email: cleanEmail,
        status: "active",
        source_order_id: orderId || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "email,course_slug"
      });

    if (enrollError) {
      console.error("Error upserting enrollment in autoEnroll:", enrollError);
    } else {
      console.log(`AutoEnroll success: Enrolled ${cleanEmail} to ${courseSlug}`);
    }
  } catch (err) {
    console.error("Unexpected error in autoEnroll:", err);
  }
}

export function getDriveClientWithToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export function getDocsClientWithToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.docs({ version: "v1", auth });
}

export async function getCourseDriveFolderId(supabase, courseSlug) {
  const { data } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", `${courseSlug}_gdrive_folder_id`)
    .maybeSingle();
  if (data) {
    const val = data.value;
    return (val && typeof val === "object" && val.val !== undefined) ? val.val : val;
  }
  return null;
}

export async function addDriveFolderPermission(accessToken, folderId, emailAddress) {
  if (!accessToken || !folderId || !emailAddress) return;
  const drive = getDriveClientWithToken(accessToken);
  try {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: "reader",
        type: "user",
        emailAddress: emailAddress
      },
      supportsAllDrives: true,
      sendNotificationEmail: false
    });
  } catch (err) {
    console.error(`[addDriveFolderPermission] Failed for ${emailAddress} on ${folderId}:`, err.message);
  }
}

export async function removeDriveFolderPermission(accessToken, folderId, emailAddress) {
  if (!accessToken || !folderId || !emailAddress) return;
  const drive = getDriveClientWithToken(accessToken);
  try {
    const listRes = await drive.permissions.list({
      fileId: folderId,
      fields: "permissions(id, emailAddress)",
      supportsAllDrives: true
    });
    const permissions = listRes.data.permissions || [];
    const matched = permissions.find(p => p.emailAddress && p.emailAddress.toLowerCase() === emailAddress.toLowerCase());
    if (matched) {
      await drive.permissions.delete({
        fileId: folderId,
        permissionId: matched.id,
        supportsAllDrives: true
      });
    }
  } catch (err) {
    console.error(`[removeDriveFolderPermission] Failed for ${emailAddress} on ${folderId}:`, err.message);
  }
}

export function sanitizeFolderName(name) {
  return String(name || "")
    .trim()
    .replace(/[/\\?%*:|"<>']/g, "-")
    .replace(/\s+/g, " ");
}

export async function getOrCreateFolder(drive, name, parentId = null) {
  const cleanName = sanitizeFolderName(name);
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${cleanName}' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  } else {
    query += ` and 'root' in parents`;
  }

  let files = [];
  try {
    const res = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    files = res.data.files || [];
  } catch {
    try {
      const res = await drive.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive"
      });
      files = res.data.files || [];
    } catch (fallbackErr) {
      throw new Error(`Không thể liệt kê thư mục Drive: ${fallbackErr.message}`);
    }
  }

  if (files.length > 0) return files[0].id;

  const fileMetadata = {
    name: cleanName,
    mimeType: "application/vnd.google-apps.folder"
  };
  if (parentId) fileMetadata.parents = [parentId];

  let folder;
  try {
    folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id",
      supportsAllDrives: true
    });
  } catch {
    try {
      folder = await drive.files.create({
        requestBody: fileMetadata,
        fields: "id"
      });
    } catch (fallbackErr) {
      throw new Error(`Không thể tạo thư mục "${cleanName}": ${fallbackErr.message}`);
    }
  }

  return folder.data.id;
}

export async function resolveCourseFolderTree(drive, { course_slug, course_title, lesson_no, lesson_title, type }) {
  const culinaryLmsId = await getOrCreateFolder(drive, "Culinary LMS");
  const coursesId = await getOrCreateFolder(drive, "Courses", culinaryLmsId);
  
  const slugUpper = String(course_slug).toUpperCase().trim();
  const titleVal = String(course_title || slugUpper).trim();
  const courseFolderName = `${slugUpper} - ${titleVal}`;
  const courseFolderId = await getOrCreateFolder(drive, courseFolderName, coursesId);

  if (type === "course_folder") {
    return { courseFolderId, targetFolderId: courseFolderId };
  }

  if (type === "course_hero" || type === "course_poster" || type === "course_qr" || type === "course_other") {
    const courseAssetsId = await getOrCreateFolder(drive, "Course Assets", courseFolderId);
    let targetFolderName = "Other Course Images";
    if (type === "course_hero") targetFolderName = "Hero Images";
    else if (type === "course_poster") targetFolderName = "Poster Images";
    else if (type === "course_qr") targetFolderName = "QR Images";
    
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, courseAssetsId);
    return { courseFolderId, targetFolderId };
  }

  const lNo = String(lesson_no || "1").trim();
  const lTitle = String(lesson_title || "Untitled").trim();
  const lessonFolderName = `Lesson ${lNo} - ${lTitle}`;
  const lessonFolderId = await getOrCreateFolder(drive, lessonFolderName, courseFolderId);

  if (type === "main_video") {
    const targetFolderId = await getOrCreateFolder(drive, "Main Video", lessonFolderId);
    return { courseFolderId, targetFolderId };
  }

  if (type === "lesson_thumbnail" || type === "lesson_hero") {
    const mainImagesId = await getOrCreateFolder(drive, "Main Images", lessonFolderId);
    let targetFolderName = "Thumbnail Images";
    if (type === "lesson_hero") targetFolderName = "Hero Images";
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, mainImagesId);
    return { courseFolderId, targetFolderId };
  }

  if (type === "lesson_media_image" || type === "lesson_media" || type === "lesson_media_video") {
    const mediaId = await getOrCreateFolder(drive, "Media", lessonFolderId);
    let targetFolderName = "Images";
    if (type === "lesson_media_video") targetFolderName = "Videos";
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, mediaId);
    return { courseFolderId, targetFolderId };
  }

  return { courseFolderId, targetFolderId: courseFolderId };
}

export async function saveCourseFolderId(supabase, courseSlug, folderId) {
  if (!courseSlug || !folderId) return;
  const slug = courseSlug.trim().toLowerCase();
  
  try {
    await supabase.from("site_config").upsert({
      key: `${slug}_gdrive_folder_id`,
      value: { val: folderId },
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });
  } catch (err) {
    console.error(`[saveCourseFolderId] Failed to save to site_config:`, err.message);
  }

  try {
    const { data: course } = await supabase
      .from("courses")
      .select("raw_data")
      .eq("slug", courseSlug)
      .maybeSingle();
      
    if (course) {
      const rawData = course.raw_data || {};
      rawData.course_folder_id = folderId;
      await supabase
        .from("courses")
        .update({
          raw_data: rawData,
          updated_at: new Date().toISOString()
        })
        .eq("slug", courseSlug);
    }
  } catch (err) {
    console.error(`[saveCourseFolderId] Failed to save to courses:`, err.message);
  }
}

export async function getCourseFolderIdOrDiscover(supabase, drive, courseSlug, courseTitle = "") {
  let folderId = await getCourseDriveFolderId(supabase, courseSlug);
  if (folderId) return folderId;

  try {
    const { data: course } = await supabase
      .from("courses")
      .select("raw_data, title")
      .eq("slug", courseSlug)
      .maybeSingle();
      
    if (course && course.raw_data && course.raw_data.course_folder_id) {
      folderId = course.raw_data.course_folder_id;
      await saveCourseFolderId(supabase, courseSlug, folderId);
      return folderId;
    }
    
    if (drive) {
      const title = courseTitle || course?.title || courseSlug.toUpperCase();
      const resolved = await resolveCourseFolderTree(drive, {
        course_slug: courseSlug,
        course_title: title,
        type: "course_folder"
      });
      if (resolved && resolved.courseFolderId) {
        folderId = resolved.courseFolderId;
        await saveCourseFolderId(supabase, courseSlug, folderId);
        return folderId;
      }
    }
  } catch (err) {
    console.error(`[getCourseFolderIdOrDiscover] Error:`, err.message);
  }
  return null;
}

export function getDriveFileId(url) {
  if (!url || typeof url !== "string") return null;
  const match1 = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (match1) return match1[1];
  const match2 = url.match(/[?&]id=([^&#]+)/);
  if (match2) return match2[1];
  
  const cleanId = url.trim();
  if (/^[a-zA-Z0-9_-]{25,50}$/.test(cleanId)) return cleanId;
  return null;
}

// ── Centralized Google Drive Client and Sync Enrollment functions ──────────────

export async function getGoogleDriveClient(supabase) {
  // 1. Service Account authentication
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      const auth = new google.auth.JWT(
        creds.client_email,
        null,
        creds.private_key.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/drive']
      );
      return { drive: google.drive({ version: "v3", auth }), isServiceAccount: true };
    } catch (err) {
      console.error("Failed to initialize Service Account drive client:", err);
    }
  }

  // 2. OAuth Refresh Token authentication fallback
  const { data: configToken } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "google_drive_access_token")
    .maybeSingle();

  const { data: configRefresh } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "google_drive_refresh_token")
    .maybeSingle();

  const accessTokenVal = configToken?.value?.val;
  const expiresAt = configToken?.value?.expires_at || 0;
  const refreshToken = configRefresh?.value?.val;

  if (!refreshToken && !accessTokenVal) {
    throw new Error("Chưa kết nối Google Drive (thiếu Access/Refresh Token hoặc Service Account)");
  }

  // Check if token is still valid (5 mins buffer)
  if (accessTokenVal && expiresAt > Date.now() + 300000) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessTokenVal });
    return { drive: google.drive({ version: "v3", auth }), accessToken: accessTokenVal };
  }

  // Needs refresh
  if (!refreshToken) {
    throw new Error("Access Token hết hạn và thiếu Refresh Token. Vui lòng kết nối lại Google Drive.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const tokenRes = await oauth2Client.getAccessToken();
  const newAccessToken = tokenRes.token;
  if (!newAccessToken) {
    throw new Error("Không thể làm mới Google Drive Access Token");
  }

  const newExpiresAt = Date.now() + 3500 * 1000;
  await supabase.from("site_config").upsert({
    key: "google_drive_access_token",
    value: { val: newAccessToken, expires_at: newExpiresAt },
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: newAccessToken });
  return { drive: google.drive({ version: "v3", auth }), accessToken: newAccessToken };
}

export async function addDriveFolderPermissionDirect(drive, folderId, emailAddress) {
  if (!drive || !folderId || !emailAddress) return;
  await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      role: "reader",
      type: "user",
      emailAddress: emailAddress
    },
    supportsAllDrives: true,
    sendNotificationEmail: false
  });
}

export async function removeDriveFolderPermissionDirect(drive, folderId, emailAddress) {
  if (!drive || !folderId || !emailAddress) return;
  const listRes = await drive.permissions.list({
    fileId: folderId,
    fields: "permissions(id, emailAddress)",
    supportsAllDrives: true
  });
  const permissions = listRes.data.permissions || [];
  const matched = permissions.find(p => p.emailAddress && p.emailAddress.toLowerCase() === emailAddress.toLowerCase());
  if (matched) {
    await drive.permissions.delete({
      fileId: folderId,
      permissionId: matched.id,
      supportsAllDrives: true
    });
  }
}

export async function writeDriveLog(supabase, { course_slug, folder_id, email, action, status, message, request_id = null }) {
  try {
    await supabase.from("drive_permission_logs").insert({
      course_slug,
      folder_id,
      email: normalizeEmail(email),
      action,
      status,
      message,
      request_id,
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to write to drive_permission_logs:", err.message);
  }
}

export async function addToDriveSyncQueue(supabase, { email, course_slug, action, error }) {
  try {
    const cleanEmail = normalizeEmail(email);
    const { data: existing } = await supabase
      .from("drive_sync_queue")
      .select("id, attempts")
      .eq("email", cleanEmail)
      .eq("course_slug", course_slug)
      .eq("action", action)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("drive_sync_queue")
        .update({
          attempts: (existing.attempts || 0) + 1,
          error_message: error,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("drive_sync_queue").insert({
        email: cleanEmail,
        course_slug,
        action,
        attempts: 1,
        error_message: error,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("Failed to add to drive_sync_queue:", err.message);
  }
}

export async function syncGoogleDrivePermission(supabase, { email, courseSlug, action }) {
  const cleanEmail = normalizeEmail(email);
  const actionName = action === "create" || action === "syncEnrollment" ? "create" : "revoke";
  
  let driveClientInfo;
  let folderId = null;
  let attempt = 0;
  const maxAttempts = 3;
  let lastError = null;

  try {
    folderId = await getCourseFolderIdOrDiscover(supabase, null, courseSlug);
  } catch (err) {
    console.error(`[syncDrive] Failed to get folder ID for ${courseSlug}:`, err.message);
    lastError = err;
  }

  if (!folderId) {
    const errorMsg = `Thư mục khóa học chưa được cấu hình Drive cho slug: ${courseSlug}`;
    await writeDriveLog(supabase, {
      course_slug: courseSlug,
      folder_id: null,
      email: cleanEmail,
      action: actionName,
      status: "FAILED",
      message: errorMsg
    });
    await addToDriveSyncQueue(supabase, { email: cleanEmail, course_slug: courseSlug, action: actionName, error: errorMsg });
    return { success: false, error: errorMsg };
  }

  try {
    driveClientInfo = await getGoogleDriveClient(supabase);
  } catch (err) {
    const errorMsg = `Không khởi tạo được GDrive Client: ${err.message}`;
    console.error(`[syncDrive] ${errorMsg}`);
    await writeDriveLog(supabase, {
      course_slug: courseSlug,
      folder_id: folderId,
      email: cleanEmail,
      action: actionName,
      status: "FAILED",
      message: errorMsg
    });
    await addToDriveSyncQueue(supabase, { email: cleanEmail, course_slug: courseSlug, action: actionName, error: errorMsg });
    return { success: false, error: errorMsg };
  }

  const { drive } = driveClientInfo;

  while (attempt < maxAttempts) {
    try {
      if (actionName === "create") {
        let alreadyHasPermission = false;
        try {
          const listRes = await drive.permissions.list({
            fileId: folderId,
            fields: "permissions(id, emailAddress)",
            supportsAllDrives: true
          });
          const permissions = listRes.data.permissions || [];
          alreadyHasPermission = permissions.some(
            p => p.emailAddress && p.emailAddress.toLowerCase().trim() === cleanEmail
          );
        } catch (listErr) {
          console.warn(`[syncDrive] Failed to list permissions (attempt ${attempt + 1}):`, listErr.message);
        }

        if (alreadyHasPermission) {
          await writeDriveLog(supabase, {
            course_slug: courseSlug,
            folder_id: folderId,
            email: cleanEmail,
            action: actionName,
            status: "SUCCESS",
            message: "Gmail đã được chia sẻ trước đó (bỏ qua)"
          });
          return { success: true, skipped: true };
        }

        await addDriveFolderPermissionDirect(drive, folderId, cleanEmail);
      } else {
        await removeDriveFolderPermissionDirect(drive, folderId, cleanEmail);
      }

      await writeDriveLog(supabase, {
        course_slug: courseSlug,
        folder_id: folderId,
        email: cleanEmail,
        action: actionName,
        status: "SUCCESS",
        message: actionName === "create" ? "Cấp quyền Drive thành công" : "Thu hồi quyền Drive thành công"
      });
      return { success: true };
    } catch (err) {
      attempt++;
      lastError = err;
      console.error(`[syncDrive] Attempt ${attempt} failed for ${cleanEmail} on ${courseSlug}:`, err.message);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  const finalErrorMsg = lastError ? lastError.message : "Lỗi Google API không xác định";
  await writeDriveLog(supabase, {
    course_slug: courseSlug,
    folder_id: folderId,
    email: cleanEmail,
    action: actionName,
    status: "FAILED",
    message: `Thất bại sau 3 lần thử. Chi tiết: ${finalErrorMsg}`
  });

  await addToDriveSyncQueue(supabase, {
    email: cleanEmail,
    course_slug: courseSlug,
    action: actionName,
    error: finalErrorMsg
  });

  return { success: false, error: finalErrorMsg };
}

export async function syncEnrollment(supabase, { email, courseSlug, action, name = null, phone = null, orderId = null, expiredAt = null }) {
  if (!email || !courseSlug || !action) {
    throw new Error("Missing required parameters for syncEnrollment");
  }

  const cleanEmail = normalizeEmail(email);
  const normalizedAction = action === "create" || action === "syncEnrollment" ? "create" : "revoke";

  let enrollmentResult = null;

  if (normalizedAction === "create") {
    // 1. Get or create student
    let studentId;
    const { data: student, error: studentFetchErr } = await supabase
      .from("students")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (studentFetchErr) throw studentFetchErr;

    if (student) {
      studentId = student.id;
      if (name || phone) {
        await supabase
          .from("students")
          .update({
            full_name: name || undefined,
            phone: phone || undefined,
            updated_at: new Date().toISOString()
          })
          .eq("id", studentId);
      }
    } else {
      const { data: newStudent, error: studentInsertErr } = await supabase
        .from("students")
        .insert({
          email: cleanEmail,
          full_name: name || null,
          phone: phone || null,
          status: "active",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (studentInsertErr) throw studentInsertErr;
      studentId = newStudent.id;
    }

    // 2. Fetch course ID by slug
    const { data: courseRec } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", courseSlug.trim())
      .maybeSingle();

    // 3. Upsert enrollment
    const { data, error: enrollErr } = await supabase
      .from("student_enrollments")
      .upsert({
        student_id: studentId,
        course_id: courseRec?.id || null,
        course_slug: courseSlug.trim(),
        email: cleanEmail,
        status: "active",
        expired_at: expiredAt || null,
        source_order_id: orderId || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "email,course_slug"
      })
      .select()
      .single();

    if (enrollErr) throw enrollErr;
    enrollmentResult = data;
  } else {
    // Delete enrollment
    const { error: deleteErr } = await supabase
      .from("student_enrollments")
      .delete()
      .eq("email", cleanEmail)
      .eq("course_slug", courseSlug.trim());

    if (deleteErr) throw deleteErr;
  }

  // 4. Sync Google Drive permission (runs asynchronously so it doesn't block but is fully executed)
  const driveResult = await syncGoogleDrivePermission(supabase, {
    email: cleanEmail,
    courseSlug,
    action: normalizedAction
  });

  return {
    success: true,
    action: normalizedAction,
    enrollment: enrollmentResult,
    driveSync: driveResult
  };
}
