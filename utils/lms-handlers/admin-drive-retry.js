import { supabase } from "../supabase.js";
import { getAdminFromRequest, syncGoogleDrivePermission } from "../lms.js";

const ACTIVE_ENROLLMENT_STATUSES = ["active", "approved", "approved_ready", "approved_waiting_content", "completed", "da duyet"];
const ERROR_DRIVE_STATUSES = ["failed", "FAILED", "pending_retry", "PENDING_RETRY", "error", "quota_limited", "QUOTA_LIMITED"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { type, email, courseSlug } = req.body || {};

    if (type === "single") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug cho retry single" });
      }

      // Check if student has valid enrollment
      const { data: enrollment, error: fetchErr } = await supabase
        .from("student_enrollments")
        .select("status, drive_permission_status")
        .eq("email", email.trim().toLowerCase())
        .eq("course_slug", courseSlug.trim())
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!enrollment) {
        return res.status(404).json({ success: false, error: "Không tìm thấy thông tin phân quyền học viên" });
      }

      if (!ACTIVE_ENROLLMENT_STATUSES.includes(enrollment.status)) {
        return res.status(400).json({ success: false, error: "Học viên không còn quyền học hợp lệ trên LMS" });
      }

      // Call provisioning logic
      const result = await syncGoogleDrivePermission(supabase, {
        email: email.trim().toLowerCase(),
        courseSlug: courseSlug.trim(),
        action: "create"
      });

      if (result.success) {
        return res.status(200).json({ success: true, result });
      } else {
        return res.status(200).json({ success: false, error: result.error || "Cấp quyền thất bại", result });
      }
    }

    if (type === "course") {
      if (!courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu courseSlug cho retry course" });
      }

      // Fetch all enrollments for this course in error state and active enrollment status
      const { data: enrollments, error: fetchErr } = await supabase
        .from("student_enrollments")
        .select("email, course_slug")
        .eq("course_slug", courseSlug.trim())
        .in("status", ACTIVE_ENROLLMENT_STATUSES)
        .in("drive_permission_status", ERROR_DRIVE_STATUSES);

      if (fetchErr) throw fetchErr;

      let successCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const details = [];

      for (const en of (enrollments || [])) {
        try {
          const result = await syncGoogleDrivePermission(supabase, {
            email: en.email,
            courseSlug: en.course_slug,
            action: "create"
          });
          if (result.success) {
            successCount++;
            details.push({ email: en.email, status: "success" });
          } else {
            failedCount++;
            details.push({ email: en.email, status: "failed", error: result.error });
          }
        } catch (err) {
          failedCount++;
          details.push({ email: en.email, status: "failed", error: err.message });
        }
      }

      return res.status(200).json({
        success: true,
        report: {
          processed: (enrollments || []).length,
          success: successCount,
          failed: failedCount,
          skipped: skippedCount
        },
        details
      });
    }

    if (type === "all") {
      // Fetch all enrollments in error state and active enrollment status in the entire system
      const { data: enrollments, error: fetchErr } = await supabase
        .from("student_enrollments")
        .select("email, course_slug")
        .in("status", ACTIVE_ENROLLMENT_STATUSES)
        .in("drive_permission_status", ERROR_DRIVE_STATUSES);

      if (fetchErr) throw fetchErr;

      let successCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const details = [];

      for (const en of (enrollments || [])) {
        try {
          const result = await syncGoogleDrivePermission(supabase, {
            email: en.email,
            courseSlug: en.course_slug,
            action: "create"
          });
          if (result.success) {
            successCount++;
            details.push({ email: en.email, course_slug: en.course_slug, status: "success" });
          } else {
            failedCount++;
            details.push({ email: en.email, course_slug: en.course_slug, status: "failed", error: result.error });
          }
        } catch (err) {
          failedCount++;
          details.push({ email: en.email, course_slug: en.course_slug, status: "failed", error: err.message });
        }
      }

      return res.status(200).json({
        success: true,
        report: {
          processed: (enrollments || []).length,
          success: successCount,
          failed: failedCount,
          skipped: skippedCount
        },
        details
      });
    }

    return res.status(400).json({ success: false, error: "Loại retry không hợp lệ" });

  } catch (err) {
    console.error("[drive-retry] Error in handler:", err);
    return res.status(500).json({ success: false, error: err.message || "Lỗi xử lý server" });
  }
}
