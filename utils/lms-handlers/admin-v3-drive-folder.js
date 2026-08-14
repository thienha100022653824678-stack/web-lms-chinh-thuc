import { getAdminFromRequest, getGoogleDriveClient, resolveCourseFolderTree, saveCourseFolderId } from "../lms.js";
import { supabase } from "../supabase.js";
import { applyCors } from "../cors.js";

const ALLOWED_TYPES = new Set([
  "main_video",
  "lesson_media_video",
  "lesson_media_image",
  "lesson_media",
  "lesson_material"
]);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "method_not_allowed" });

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) return res.status(401).json({ success: false, error: "admin_auth_required" });

    const body = req.body || {};
    const courseSlug = String(body.course_slug || "").trim();
    const mediaType = String(body.media_type || "lesson_media").trim();
    if (!courseSlug) return res.status(400).json({ success: false, error: "missing_course_slug" });
    if (!ALLOWED_TYPES.has(mediaType)) return res.status(400).json({ success: false, error: "invalid_media_type" });

    let drive;
    try {
      const clientInfo = await getGoogleDriveClient(supabase);
      drive = clientInfo.drive;
    } catch (err) {
      return res.status(200).json({ success: false, needsOAuth: true, error: err.message || "drive_not_connected" });
    }

    const resolved = await resolveCourseFolderTree(drive, {
      course_slug: courseSlug,
      course_title: String(body.course_title || courseSlug).trim(),
      lesson_no: String(body.lesson_no || "1").trim(),
      lesson_title: String(body.lesson_title || "Untitled").trim(),
      type: mediaType
    });

    if (resolved.courseFolderId) {
      await saveCourseFolderId(supabase, courseSlug, resolved.courseFolderId);
    }

    return res.status(200).json({
      success: true,
      folderId: resolved.targetFolderId,
      courseFolderId: resolved.courseFolderId || null,
      mediaType
    });
  } catch (err) {
    console.error("[admin-v3-drive-folder] error:", err?.message);
    return res.status(500).json({ success: false, error: "v3_drive_folder_failed" });
  }
}
