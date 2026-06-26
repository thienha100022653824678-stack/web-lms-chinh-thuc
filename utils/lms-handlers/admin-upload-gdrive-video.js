import { Readable } from "stream";
import { getAdminFromRequest, getDriveClientWithToken } from "../lms.js";
import { supabase } from "../supabase.js";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB limit

async function getOrCreateFolder(drive, name, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
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
  } catch (err) {
    console.warn("[getOrCreateFolder] List with shared drives failed, trying standard list:", err.message);
    try {
      const res = await drive.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive"
      });
      files = res.data.files || [];
    } catch (fallbackErr) {
      console.error("[getOrCreateFolder] Standard list failed:", fallbackErr.message);
      throw fallbackErr;
    }
  }

  if (files.length > 0) {
    return files[0].id;
  }

  // Create folder if not found
  const fileMetadata = {
    name: name,
    mimeType: "application/vnd.google-apps.folder"
  };
  if (parentId) {
    fileMetadata.parents = [parentId];
  }

  let folder;
  try {
    folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id",
      supportsAllDrives: true
    });
  } catch (err) {
    console.warn("[getOrCreateFolder] Create with supportsAllDrives failed, trying standard create:", err.message);
    try {
      folder = await drive.files.create({
        requestBody: fileMetadata,
        fields: "id"
      });
    } catch (fallbackErr) {
      console.error("[getOrCreateFolder] Standard create failed:", fallbackErr.message);
      throw fallbackErr;
    }
  }

  return folder.data.id;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Chưa kết nối Google Drive"
      });
    }

    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ success: false, error: "Thiếu dữ liệu video (fileData)" });
    }

    if (!course_slug) {
      return res.status(400).json({ success: false, error: "Thiếu slug khóa học (course_slug)" });
    }

    let cleanBase64 = fileData;
    let cleanMimeType = mimeType || "video/mp4";

    if (fileData.includes(";base64,")) {
      const parts = fileData.split(";base64,");
      const mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) cleanMimeType = mimeMatch[1];
      cleanBase64 = parts[1];
    }

    let buffer;
    try {
      buffer = Buffer.from(cleanBase64, "base64");
    } catch {
      return res.status(400).json({ success: false, error: "Dữ liệu video không hợp lệ" });
    }

    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Video quá lớn (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB). Tối đa 500 MB.`
      });
    }

    const drive = getDriveClientWithToken(accessToken);

    // 1. Resolve / Create folders recursively
    // A. "Culinary LMS"
    const culinaryLmsId = await getOrCreateFolder(drive, "Culinary LMS");

    // B. "Courses" inside "Culinary LMS"
    const coursesId = await getOrCreateFolder(drive, "Courses", culinaryLmsId);

    // C. "[course_slug] - [course_title]" inside "Courses"
    const slugUpper = String(course_slug).toUpperCase().trim();
    const titleVal = String(course_title || slugUpper).trim();
    const courseFolderCleanName = `${slugUpper} - ${titleVal}`.replace(/[/\\?%*:|"<>]/g, "-");
    const courseFolderId = await getOrCreateFolder(drive, courseFolderCleanName, coursesId);

    // Save the course folder ID to site_config for permissions syncing!
    try {
      await supabase.from("site_config").upsert({
        key: `${course_slug.trim().toLowerCase()}_gdrive_folder_id`,
        value: { val: courseFolderId },
        updated_at: new Date().toISOString()
      }, {
        onConflict: "key"
      });
    } catch (dbErr) {
      console.error("[upload-video] Failed to save folder ID to site_config:", dbErr.message);
    }

    // D. "Lesson [lesson_no] - [lesson_title]" inside course folder
    const lNo = String(lesson_no || "1").trim();
    const lTitle = String(lesson_title || "Untitled").trim();
    const lessonFolderCleanName = `Lesson ${lNo} - ${lTitle}`.replace(/[/\\?%*:|"<>]/g, "-");
    const lessonFolderId = await getOrCreateFolder(drive, lessonFolderCleanName, courseFolderId);

    // E. Target folder ("Main Video" or "Media Videos") inside lesson folder
    const targetFolderName = media_type === "main_video" ? "Main Video" : "Media Videos";
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, lessonFolderId);

    // 2. Upload file to target folder (Keep it restricted/private by default)
    const ext = cleanMimeType.split("/")[1] || "mp4";
    const finalFileName = fileName || `${media_type}_${Date.now()}.${ext}`;

    const fileMetadata = {
      name: finalFileName,
      parents: [targetFolderId]
    };

    let driveFile;
    try {
      driveFile = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: cleanMimeType,
          body: Readable.from(buffer)
        },
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true
      });
    } catch (err) {
      console.warn("[upload-video] Create with supportsAllDrives failed, trying standard create:", err.message);
      try {
        driveFile = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: cleanMimeType,
            body: Readable.from(buffer)
          },
          fields: "id, webViewLink, webContentLink"
        });
      } catch (fallbackErr) {
        console.error("[upload-video] Standard create failed:", fallbackErr.message);
        throw fallbackErr;
      }
    }

    const fileId = driveFile.data.id;
    if (!fileId) {
      return res.status(500).json({ success: false, error: "Google API không trả về ID file" });
    }

    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const webViewLink = driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    return res.status(200).json({
      success: true,
      fileId,
      directUrl,
      webViewLink
    });

  } catch (err) {
    console.error("[admin-upload-gdrive-video] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: `Lỗi server khi upload video: ${err.message}`,
      message: err.message
    });
  }
}
