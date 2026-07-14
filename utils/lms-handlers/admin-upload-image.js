import { PassThrough } from "stream";
import { getAdminFromRequest, getGoogleDriveClient, resolveCourseFolderTree, saveCourseFolderId } from "../lms.js";
import { supabase } from "../supabase.js";
import { applyCors } from "../cors.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

function bufferToStream(buffer) {
  const pass = new PassThrough();
  pass.end(buffer);
  return pass;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
};

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);

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
      course,
      lesson,
      title,
      accessToken,
      imageType,
      courseTitle,
      lessonNo,
      lessonTitle
    } = req.body || {};

    let drive;
    try {
      const clientInfo = await getGoogleDriveClient(supabase);
      drive = clientInfo.drive;
    } catch (driveErr) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: driveErr.message || "Chưa kết nối Google Drive"
      });
    }

    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ success: false, error: "Thiếu dữ liệu ảnh (fileData)" });
    }

    let cleanBase64 = fileData;
    let cleanMimeType = mimeType || "image/jpeg";

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
      return res.status(400).json({ success: false, error: "Dữ liệu ảnh không hợp lệ" });
    }

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Ảnh quá lớn (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB). Tối đa 4 MB.`
      });
    }

    const ext = cleanMimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    let finalFileName = fileName || `image_${Date.now()}.${ext}`;
    
    // Resolve clean name for file
    if (course) {
      const lNo = String(lessonNo || lesson || "1").trim();
      const lTitle = String(lessonTitle || title || "Untitled").trim();
      const slugVal = String(course).toUpperCase().trim();
      if (imageType && imageType.startsWith("course_")) {
        finalFileName = `${slugVal} - ${imageType}.${ext}`;
      } else {
        finalFileName = `${slugVal} - Lesson ${lNo} - ${imageType || "image"}_${Date.now()}.${ext}`;
      }
    }
    // Sanitize filename to avoid drive issues
    finalFileName = finalFileName.replace(/[/\\?%*:|"<>']/g, "-");

    let targetFolderId = "";
    let isFallback = false;

    // Resolve structural destination folder
    if (course) {
      try {
        const cTitle = courseTitle || (course ? String(course).toUpperCase() : "");
        const lNo = lessonNo || lesson || "1";
        const lTitle = lessonTitle || title || "Untitled";
        const resolved = await resolveCourseFolderTree(drive, {
          course_slug: course,
          course_title: cTitle,
          lesson_no: lNo,
          lesson_title: lTitle,
          type: imageType || "lesson_media"
        });
        
        targetFolderId = resolved.targetFolderId;
        
        // Save course folder ID
        if (resolved.courseFolderId) {
          await saveCourseFolderId(supabase, course, resolved.courseFolderId);
        }
      } catch (err) {
        console.error("[admin-upload-image] Failed to resolve target folder structure:", err.message);
      }
    }

    // Fallback if targetFolderId cannot be resolved
    if (!targetFolderId) {
      targetFolderId = (process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID || "").trim();
    }

    const fileMetadata = { name: finalFileName };
    if (targetFolderId) {
      fileMetadata.parents = [targetFolderId];
    }

    let driveFile;
    try {
      driveFile = await drive.files.create({
        requestBody: fileMetadata,
        media: { mimeType: cleanMimeType, body: bufferToStream(buffer) },
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true,
      });
    } catch (err) {
      console.error("[admin-upload-image] Drive API error:", err);
      // Fallback upload to root if it was using a preset folder and failed
      if (targetFolderId) {
        console.log("[admin-upload-image] Attempting fallback to root folder...");
        try {
          const fallbackMetadata = { name: finalFileName };
          driveFile = await drive.files.create({
            requestBody: fallbackMetadata,
            media: { mimeType: cleanMimeType, body: bufferToStream(buffer) },
            fields: "id, webViewLink, webContentLink",
            supportsAllDrives: true,
          });
          isFallback = true;
          console.log("[admin-upload-image] Fallback upload to root succeeded.");
        } catch (fallbackErr) {
          return res.status(500).json({
            success: false,
            error: "Upload ảnh lên Google Drive thất bại (kể cả thử lại ở thư mục gốc)",
            message: fallbackErr.message
          });
        }
      } else {
        return res.status(500).json({
          success: false,
          error: "Upload ảnh lên Google Drive thất bại",
          message: err.message
        });
      }
    }

    const fileId = driveFile.data.id;
    if (!fileId) {
      return res.status(500).json({ success: false, error: "Google API không trả về ID file" });
    }

    // Share publicly so they can render in HTML img tags without browser cookie block policy
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    } catch (err) {
      console.warn("[admin-upload-image] Could not share file publicly:", err.message);
    }

    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const webViewLink = driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    return res.status(200).json({
      success: true,
      fileId,
      directUrl,
      webViewLink,
      warning: isFallback ? "Lưu ý: Không thể ghi vào thư mục cấu hình. File đã được tải lên thư mục gốc Drive của bạn." : null
    });
  } catch (err) {
    console.error("[admin-upload-image] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server khi upload ảnh",
      message: err.message,
    });
  }
}
