import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail, syncGoogleDrivePermission } from "../lms.js";
import { applyCors } from "../cors.js";

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

    const { enrollmentId, email, courseSlug } = req.body || {};
    let targetEmail = normalizeEmail(email);
    let targetCourseSlug = String(courseSlug || "").trim();

    if (enrollmentId) {
      const { data: enrollment, error } = await supabase
        .from("student_enrollments")
        .select("email, course_slug, status")
        .eq("id", enrollmentId)
        .maybeSingle();

      if (error) throw error;
      if (!enrollment) {
        return res.status(404).json({ success: false, error: "Không tìm thấy phân quyền học viên" });
      }
      const ACTIVE_ENROLLMENT_STATUSES = ["active", "approved", "approved_ready", "approved_waiting_content", "completed", "da duyet"];
      if (!ACTIVE_ENROLLMENT_STATUSES.includes(enrollment.status)) {
        return res.status(400).json({ success: false, error: "Chỉ cấp lại Drive cho học viên có quyền học hợp lệ trên LMS" });
      }
      targetEmail = normalizeEmail(enrollment.email);
      targetCourseSlug = String(enrollment.course_slug || "").trim();
    }

    if (!targetEmail || !targetCourseSlug) {
      return res.status(400).json({ success: false, error: "Thiếu email hoặc course slug" });
    }

    const driveSync = await syncGoogleDrivePermission(supabase, {
      email: targetEmail,
      courseSlug: targetCourseSlug,
      action: "create"
    });

    return res.status(200).json({
      success: !!driveSync.success,
      driveSync,
      error: driveSync.success ? null : driveSync.error || "Cấp lại quyền Drive thất bại"
    });
  } catch (err) {
    console.error("[admin-drive-permission] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi hệ thống khi cấp lại quyền Drive",
      message: err.message
    });
  }
}
