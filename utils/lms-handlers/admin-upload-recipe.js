import { PassThrough } from "stream";
import { supabase } from "../supabase.js";
import { getAdminFromRequest, getGoogleDriveClient } from "../lms.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
};

function bufferToStream(buffer) {
  const pass = new PassThrough();
  pass.end(buffer);
  return pass;
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

    if (!course || !lesson || !title) {
      return res.status(400).json({
        success: false,
        error: "Thiếu course, lesson hoặc title"
      });
    }

    let content = "";
    if (fileData && typeof fileData === "string") {
      try {
        content = Buffer.from(fileData, "base64").toString("utf8").trim();
      } catch {
        return res.status(400).json({ success: false, error: "Dữ liệu file không hợp lệ" });
      }
    } else if (text) {
      content = String(text).trim();
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        error: "Nội dung công thức trống"
      });
    }
    const folderId = (process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "").trim();
    const docName = `${course} - ${lesson} - ${title}`;

    const requestBody = {
      name: docName,
      mimeType: "application/vnd.google-apps.document",
    };
    if (folderId) requestBody.parents = [folderId];

    const contentBuffer = Buffer.from(content, "utf8");
    const bodyStream = bufferToStream(contentBuffer);

    let docFile;
    let isFallback = false;
    try {
      docFile = await drive.files.create({
        requestBody,
        media: { mimeType: "text/plain", body: bodyStream },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
    } catch (err) {
      console.error("[admin-upload-recipe] Drive API doc creation error:", err);
      if (folderId) {
        console.log("[admin-upload-recipe] Attempting fallback to root folder...");
        try {
          const fallbackRequestBody = {
            name: docName,
            mimeType: "application/vnd.google-apps.document",
          };
          const fallbackStream = bufferToStream(contentBuffer);
          docFile = await drive.files.create({
            requestBody: fallbackRequestBody,
            media: { mimeType: "text/plain", body: fallbackStream },
            fields: "id, webViewLink",
            supportsAllDrives: true,
          });
          isFallback = true;
          console.log("[admin-upload-recipe] Fallback upload to root succeeded.");
        } catch (fallbackErr) {
          return res.status(500).json({
            success: false,
            error: "Tạo Google Docs công thức thất bại (kể cả thử lại ở thư mục gốc)",
            message: fallbackErr.message
          });
        }
      } else {
        return res.status(500).json({
          success: false,
          error: "Tạo Google Docs công thức thất bại",
          message: err.message
        });
      }
    }

    const fileId = docFile.data.id;
    if (!fileId) {
      return res.status(500).json({ success: false, error: "Google Drive API không trả về ID tài liệu" });
    }

    // Share publicly
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    } catch (err) {
      console.warn("[admin-upload-recipe] Could not share doc publicly:", err.message);
    }

    const recipeUrl = docFile.data.webViewLink || `https://docs.google.com/document/d/${fileId}/edit`;

    // ── Update recipeUrl in Supabase (lessons table) ──────────────────────────
    let dbUpdated = false;
    let dbErrorMsg = null;
    if (isFallback) {
      dbErrorMsg = "Lưu ý: Không thể ghi vào thư mục được cấu hình trên hệ thống (do sai ID thư mục hoặc tài khoản Drive của bạn chưa được cấp quyền chia sẻ thư mục đó). Tài liệu đã được tạo tạm thời tại thư mục gốc Drive của bạn.";
    }
    try {
      const { data, error } = await supabase
        .from("lessons")
        .update({
          recipe_url: recipeUrl,
          updated_at: new Date().toISOString()
        })
        .eq("course_slug", course)
        .eq("lesson_no", parseInt(lesson, 10))
        .select();

      if (error) throw error;
      if (data && data.length > 0) {
        dbUpdated = true;
      } else {
        const prefix = dbErrorMsg ? dbErrorMsg + "\n" : "";
        dbErrorMsg = prefix + "Đã tạo tài liệu Docs thành công, nhưng không tìm thấy bài học tương ứng trong Supabase để lưu liên kết.";
      }
    } catch (dbErr) {
      console.error("[admin-upload-recipe] DB Update error:", dbErr);
      const prefix = dbErrorMsg ? dbErrorMsg + "\n" : "";
      dbErrorMsg = prefix + `Đã tạo tài liệu Docs nhưng không thể cập nhật Supabase: ${dbErr.message}`;
    }

    return res.status(200).json({
      success: true,
      recipeUrl,
      fileId,
      docName,
      sheetUpdated: dbUpdated, // Keep name compatible with frontend property check
      warning: dbErrorMsg
    });
  } catch (err) {
    console.error("[admin-upload-recipe] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server khi tạo Google Docs",
      message: err.message,
    });
  }
}
