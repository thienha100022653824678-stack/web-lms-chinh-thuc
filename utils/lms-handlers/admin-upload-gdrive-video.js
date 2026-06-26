import { PassThrough } from "stream";
import { getAdminFromRequest, getDriveClientWithToken } from "../lms.js";
import { supabase } from "../supabase.js";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB limit

// Map extension → correct IANA video MIME type
// Windows often reports "" or "application/octet-stream" for .mkv, .avi, .mov etc.
const VIDEO_MIME_MAP = {
  "mp4":  "video/mp4",
  "m4v":  "video/mp4",
  "mov":  "video/quicktime",
  "qt":   "video/quicktime",
  "avi":  "video/x-msvideo",
  "mkv":  "video/x-matroska",
  "webm": "video/webm",
  "wmv":  "video/x-ms-wmv",
  "flv":  "video/x-flv",
  "3gp":  "video/3gpp",
  "3g2":  "video/3gpp2",
  "mpeg": "video/mpeg",
  "mpg":  "video/mpeg",
  "ts":   "video/mp2t",
  "mts":  "video/mp2t",
  "m2ts": "video/mp2t",
  "ogv":  "video/ogg",
  "vob":  "video/x-ms-vob",
};

// Map x-* subtype to human-readable extension for safe filename generation
const MIME_TO_EXT = {
  "video/mp4":          "mp4",
  "video/quicktime":    "mov",
  "video/x-msvideo":   "avi",
  "video/x-matroska":  "mkv",
  "video/webm":         "webm",
  "video/x-ms-wmv":    "wmv",
  "video/x-flv":       "flv",
  "video/3gpp":         "3gp",
  "video/3gpp2":        "3g2",
  "video/mpeg":         "mpg",
  "video/mp2t":         "ts",
  "video/ogg":          "ogv",
  "video/x-ms-vob":    "vob",
};

/**
 * Infer the correct video MIME type from filename extension and/or
 * from the data URL mime (if detected by the browser).
 */
function resolveVideoMime(rawMimeFromBrowser, fileName) {
  // 1. Start with what the browser reported
  let mime = (rawMimeFromBrowser || "").trim();

  // 2. If it looks like a real video/* MIME (not generic), accept it
  if (mime && mime.startsWith("video/") && mime !== "video/x-generic") {
    return mime;
  }

  // 3. Otherwise, infer from file extension
  const ext = String(fileName || "").split(".").pop().toLowerCase().trim();
  if (ext && VIDEO_MIME_MAP[ext]) {
    console.log(`[upload-video] Inferred MIME from .${ext} → ${VIDEO_MIME_MAP[ext]}`);
    return VIDEO_MIME_MAP[ext];
  }

  // 4. Final fallback
  console.log(`[upload-video] Could not infer MIME for "${fileName}", defaulting to video/mp4`);
  return "video/mp4";
}

/**
 * Create a proper PassThrough stream from a Buffer so that googleapis
 * receives a single, correctly-sized binary chunk rather than thousands
 * of individual bytes (which is what Readable.from(buffer) would produce
 * when iterating a Uint8Array byte-by-byte in objectMode).
 */
function bufferToStream(buffer) {
  const pass = new PassThrough();
  pass.end(buffer);
  return pass;
}

async function getOrCreateFolder(drive, name, parentId = null) {
  const safeName = name.replace(/'/g, "\\'");
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${safeName}' and trashed = false`;
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
    // Fallback: try without shared-drive parameters (personal Drive accounts)
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

  // Folder not found → create it
  const fileMetadata = {
    name,
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
      throw new Error(`Không thể tạo thư mục "${name}": ${fallbackErr.message}`);
    }
  }

  return folder.data.id;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const {
      fileData,
      fileName,
      mimeType,
      course_slug,
      course_title,
      lesson_no,
      lesson_title,
      media_type,
      accessToken
    } = req.body || {};

    // Validate required fields
    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({ success: false, needsOAuth: true, error: "Chưa kết nối Google Drive" });
    }
    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ success: false, error: "Thiếu dữ liệu video (fileData)" });
    }
    if (!course_slug) {
      return res.status(400).json({ success: false, error: "Thiếu slug khóa học (course_slug)" });
    }

    // ── Extract base64 and MIME from data URL ──────────────────────────────
    let cleanBase64 = fileData;
    let mimeFromDataUrl = "";

    if (fileData.includes(";base64,")) {
      const parts = fileData.split(";base64,");
      const mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) mimeFromDataUrl = mimeMatch[1];
      cleanBase64 = parts[1];
    }

    // Determine correct MIME type (browser mimeType > data URL MIME > extension fallback)
    const effectiveMime = resolveVideoMime(mimeType || mimeFromDataUrl, fileName);
    console.log(`[upload-video] File: "${fileName}" | Browser MIME: "${mimeType}" | DataURL MIME: "${mimeFromDataUrl}" | Final MIME: "${effectiveMime}"`);

    // ── Decode base64 to binary Buffer ─────────────────────────────────────
    let buffer;
    try {
      buffer = Buffer.from(cleanBase64, "base64");
    } catch {
      return res.status(400).json({ success: false, error: "Dữ liệu video base64 không hợp lệ" });
    }

    if (buffer.byteLength === 0) {
      return res.status(400).json({ success: false, error: "File video rỗng, không thể tải lên" });
    }

    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Video quá lớn (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Tối đa 500 MB.`
      });
    }

    console.log(`[upload-video] Buffer size: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // ── Build folder hierarchy in Google Drive ──────────────────────────────
    const drive = getDriveClientWithToken(accessToken);

    const culinaryLmsId = await getOrCreateFolder(drive, "Culinary LMS");
    const coursesId     = await getOrCreateFolder(drive, "Courses", culinaryLmsId);

    const slugUpper  = String(course_slug).toUpperCase().trim();
    const titleVal   = String(course_title || slugUpper).trim();
    const courseFolder = `${slugUpper} - ${titleVal}`.replace(/[/\\?%*:|"<>]/g, "-");
    const courseFolderId = await getOrCreateFolder(drive, courseFolder, coursesId);

    // Persist folder ID for Drive permission syncing (non-blocking)
    supabase.from("site_config").upsert({
      key: `${course_slug.trim().toLowerCase()}_gdrive_folder_id`,
      value: { val: courseFolderId },
      updated_at: new Date().toISOString()
    }, { onConflict: "key" }).catch(e =>
      console.error("[upload-video] site_config upsert failed:", e.message)
    );

    const lNo   = String(lesson_no || "1").trim();
    const lTitle = String(lesson_title || "Untitled").trim();
    const lessonFolder = `Lesson ${lNo} - ${lTitle}`.replace(/[/\\?%*:|"<>]/g, "-");
    const lessonFolderId = await getOrCreateFolder(drive, lessonFolder, courseFolderId);

    const targetFolderName = media_type === "main_video" ? "Main Video" : "Media Videos";
    const targetFolderId   = await getOrCreateFolder(drive, targetFolderName, lessonFolderId);

    // ── Upload the video file ───────────────────────────────────────────────
    // IMPORTANT: Use bufferToStream() (PassThrough) instead of Readable.from(buffer).
    // Readable.from(buffer) iterates the Buffer as a Uint8Array, yielding individual
    // NUMBERS (0-255) in objectMode — not binary chunks — causing the multipart
    // uploader to produce garbled data → Google Drive "invalid media type" error.
    // PassThrough.end(buffer) sends the whole buffer as ONE binary chunk. ✓

    const origExt    = String(fileName || "").split(".").pop().toLowerCase().trim();
    const fallbackExt = MIME_TO_EXT[effectiveMime] || "mp4";
    const finalExt   = origExt || fallbackExt;
    const finalFileName = fileName || `${media_type}_${Date.now()}.${finalExt}`;

    const fileMetadata = {
      name: finalFileName,
      parents: [targetFolderId]
    };

    let driveFile;
    try {
      driveFile = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: effectiveMime,
          body: bufferToStream(buffer)     // ← THE FIX
        },
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true
      });
    } catch (err) {
      console.warn("[upload-video] Upload with supportsAllDrives failed:", err.message, "| Retrying without...");
      try {
        driveFile = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: effectiveMime,
            body: bufferToStream(buffer)   // ← THE FIX (fallback too)
          },
          fields: "id, webViewLink, webContentLink"
        });
      } catch (fallbackErr) {
        throw new Error(`Upload lên Drive thất bại: ${fallbackErr.message}`);
      }
    }

    const fileId = driveFile?.data?.id;
    if (!fileId) {
      return res.status(500).json({ success: false, error: "Google API không trả về ID file sau khi upload" });
    }

    console.log(`[upload-video] Success! fileId=${fileId}`);

    return res.status(200).json({
      success: true,
      fileId,
      directUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      webViewLink: driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
    });

  } catch (err) {
    console.error("[admin-upload-gdrive-video] Error:", err);
    return res.status(500).json({
      success: false,
      error: `Upload thất bại: ${err.message}`,
      message: err.message
    });
  }
}
