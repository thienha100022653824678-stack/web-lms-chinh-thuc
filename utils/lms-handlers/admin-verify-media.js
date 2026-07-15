import { supabase } from "../supabase.js";
import { getAdminFromRequest, getGoogleDriveClient } from "../lms.js";
import { applyCors } from "../cors.js";

// Helper to extract Drive File ID from URL or return raw ID if matched
function extractDriveFileId(value) {
  if (!value || typeof value !== "string") return null;
  value = value.trim();
  
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{25,50})/i,
    /\/d\/([a-zA-Z0-9_-]{25,50})/i,
    /id=([a-zA-Z0-9_-]{25,50})/i,
    /\/open\?id=([a-zA-Z0-9_-]{25,50})/i,
    /\/uc\?id=([a-zA-Z0-9_-]{25,50})/i
  ];
  
  for (const p of patterns) {
    const match = value.match(p);
    if (match) return match[1];
  }
  
  // If it is a raw ID (no slashes, length 25-50, alphanumeric and symbols)
  if (/^[a-zA-Z0-9_-]{25,50}$/.test(value) && !value.includes("/")) {
    return value;
  }
  
  return null;
}

// Helper to check if a value is potentially a Google Drive resource
function isPotentialDriveLink(value) {
  if (!value || typeof value !== "string") return false;
  const val = value.trim();
  if (val.startsWith("http://") || val.startsWith("https://")) {
    return val.includes("drive.google.com") || val.includes("docs.google.com");
  }
  return /^[a-zA-Z0-9_-]{25,50}$/.test(val) && !val.includes("/");
}

// Helper to extract Drive links from a block of text
function extractDriveFileIdsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const matches = [];
  const regex = /(https?:\/\/[^\s"'><]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const url = match[1];
    if (url.includes("drive.google.com") || url.includes("docs.google.com")) {
      const fileId = extractDriveFileId(url);
      if (fileId) {
        matches.push({ id: fileId, url });
      }
    }
  }
  return matches;
}

// Helper to check if a file is nested under a folder recursively
async function isDescendantOf(drive, fileId, targetFolderId) {
  if (fileId === targetFolderId) return true;
  
  const visited = new Set();
  const queue = [fileId];
  
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    
    try {
      const file = await drive.files.get({
        fileId: currentId,
        fields: "parents",
        supportsAllDrives: true
      });
      
      const parents = file.data.parents || [];
      for (const p of parents) {
        if (p === targetFolderId) {
          return true; // Nested successfully!
        }
        if (!visited.has(p)) {
          queue.push(p);
        }
      }
    } catch (err) {
      console.warn(`[isDescendantOf] Could not fetch parents for file ${currentId}:`, err.message);
    }
  }
  
  return false;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const { courseSlug, lessonData } = req.body || {};
    if (!courseSlug) {
      return res.status(400).json({ success: false, error: "Thiếu courseSlug" });
    }

    // Retrieve course folder
    const { data: course, error: dbErr } = await supabase
      .from("courses")
      .select("drive_folder_id, title")
      .eq("slug", courseSlug)
      .maybeSingle();

    if (dbErr) throw dbErr;
    if (!course) {
      return res.status(404).json({ success: false, error: "Không tìm thấy khóa học" });
    }

    const courseFolderId = course.drive_folder_id;
    if (!courseFolderId) {
      return res.status(200).json({
        success: true,
        hasIssues: true,
        issues: [
          {
            field: "course",
            mediaType: "folder",
            severity: "warning",
            message: `Khóa học "${course.title}" chưa có folder Drive, không thể xác minh vị trí lưu trữ media.`
          }
        ]
      });
    }

    // Initialize Google Drive Client
    let driveClientInfo;
    try {
      driveClientInfo = await getGoogleDriveClient(supabase);
    } catch (err) {
      return res.status(200).json({
        success: true,
        hasIssues: true,
        issues: [
          {
            field: "drive",
            mediaType: "api",
            severity: "error",
            message: `Không kết nối được Google Drive: ${err.message}. Không thể xác minh media.`
          }
        ]
      });
    }

    const { drive } = driveClientInfo;
    
    // Resolve course folder name
    let courseFolderName = "";
    try {
      const folderMeta = await drive.files.get({
        fileId: courseFolderId,
        fields: "name",
        supportsAllDrives: true
      });
      courseFolderName = folderMeta.data.name;
    } catch {
      courseFolderName = course.title || "Thư mục khóa học";
    }

    const issues = [];
    const mediaItems = []; // List of drive items to verify: { field, mediaType, url, id }

    // Parse inputs for potential GDrive items
    const { thumbnailUrl, videoUrl, recipeUrl, mediaUrls, materials, description } = lessonData || {};

    if (thumbnailUrl && isPotentialDriveLink(thumbnailUrl)) {
      const id = extractDriveFileId(thumbnailUrl);
      if (id) mediaItems.push({ field: "Ảnh Thumbnail", mediaType: "thumbnail", url: thumbnailUrl, id });
    }
    if (videoUrl && isPotentialDriveLink(videoUrl)) {
      const id = extractDriveFileId(videoUrl);
      if (id) mediaItems.push({ field: "Video bài học", mediaType: "video", url: videoUrl, id });
    }
    if (recipeUrl && isPotentialDriveLink(recipeUrl)) {
      const id = extractDriveFileId(recipeUrl);
      if (id) mediaItems.push({ field: "Tài liệu công thức", mediaType: "recipe", url: recipeUrl, id });
    }

    if (Array.isArray(mediaUrls)) {
      mediaUrls.forEach((item, index) => {
        if (item.url && isPotentialDriveLink(item.url)) {
          const id = extractDriveFileId(item.url);
          if (id) mediaItems.push({ field: `Ảnh bài học #${index + 1}`, mediaType: "image", url: item.url, id });
        }
      });
    }

    if (Array.isArray(materials)) {
      materials.forEach((item, index) => {
        if (item.url && isPotentialDriveLink(item.url)) {
          const id = extractDriveFileId(item.url);
          if (id) mediaItems.push({ field: `File đính kèm "${item.name || index + 1}"`, mediaType: "attachment", url: item.url, id });
        }
      });
    }

    if (description) {
      const inlineLinks = extractDriveFileIdsFromText(description);
      inlineLinks.forEach((link, index) => {
        mediaItems.push({ field: `Link Drive trong mô tả #${index + 1}`, mediaType: "inline_link", url: link.url, id: link.id });
      });
    }

    // Verify each Google Drive item
    for (const item of mediaItems) {
      try {
        // 1. Check existence and access
        const fileMeta = await drive.files.get({
          fileId: item.id,
          fields: "id, name, parents",
          supportsAllDrives: true
        });

        const fileName = fileMeta.data.name || "Không rõ tên";
        const parents = fileMeta.data.parents || [];

        // 2. Check nesting relationship
        const isNested = await isDescendantOf(drive, item.id, courseFolderId);

        if (!isNested) {
          // Resolve current parents' names
          const parentNames = [];
          for (const pId of parents) {
            try {
              const pMeta = await drive.files.get({
                fileId: pId,
                fields: "name",
                supportsAllDrives: true
              });
              parentNames.push(pMeta.data.name);
            } catch {
              parentNames.push(pId);
            }
          }

          issues.push({
            field: item.field,
            mediaType: item.mediaType,
            fileId: item.id,
            fileName,
            severity: "warning",
            currentFolders: parentNames.length > 0 ? parentNames : ["Nguồn khác / Ngoài folder"],
            correctFolderId: courseFolderId,
            correctFolderName: courseFolderName,
            message: `File "${fileName}" (${item.field}) đang nằm ngoài folder của khóa học. Học viên có thể bị Google Drive hỏi quyền truy cập.`
          });
        }

      } catch (err) {
        // If file.get fails, it represents an unreadable/deleted/invalid ID error
        issues.push({
          field: item.field,
          mediaType: item.mediaType,
          fileId: item.id,
          fileName: "Không thể đọc",
          severity: "error",
          message: `Không tìm thấy file hoặc tài khoản hệ thống không có quyền truy cập vào File ID: "${item.id}" (${item.field}). Chi tiết lỗi: ${err.message}`
        });
      }
    }

    return res.status(200).json({
      success: true,
      hasIssues: issues.length > 0,
      courseFolderId,
      courseFolderName,
      issues
    });

  } catch (err) {
    console.error("[verify-media] Unexpected error:", err);
    return res.status(500).json({ success: false, error: err.message || "Lỗi xử lý server" });
  }
}
