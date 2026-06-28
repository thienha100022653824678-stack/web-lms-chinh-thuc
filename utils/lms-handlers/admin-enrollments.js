import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail, syncEnrollment } from "../lms.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    // ── GET: List enrollments with filters ────────────────────────────────────
    if (req.method === "GET") {
      const { course, search } = req.query || {};
      let query = supabase
        .from("student_enrollments")
        .select(`
          id,
          email,
          course_slug,
          status,
          expired_at,
          created_at,
          student_id,
          student:students (
            full_name,
            phone
          )
        `);

      if (course) {
        query = query.eq("course_slug", course);
      }
      if (search) {
        query = query.ilike("email", `%${search.trim()}%`);
      }

      const { data: enrollments, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return res.status(200).json({ success: true, enrollments });
    }

    // ── POST: Grant Access (Enroll Student) ──────────────────────────────────
    if (req.method === "POST") {
      const { email, courseSlug, expiredAt } = req.body || {};
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc course slug" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "create",
        expiredAt
      });

      if (!syncResult.success) {
        return res.status(500).json({ success: false, error: syncResult.error || "Lỗi đồng bộ phân quyền" });
      }

      return res.status(200).json({ success: true, enrollment: syncResult.enrollment });
    }

    // ── PUT: Update Enrollment Status / Expiry ────────────────────────────────
    if (req.method === "PUT") {
      const { id, status, expiredAt } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, error: "Thiếu ID quyền học viên" });
      }

      // Fetch existing details before updating to check if status changed
      const { data: oldEnroll } = await supabase
        .from("student_enrollments")
        .select("email, course_slug, status")
        .eq("id", id)
        .maybeSingle();

      const { data, error } = await supabase
        .from("student_enrollments")
        .update({
          status: status || "active",
          expired_at: expiredAt || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Sync Google Drive permissions if status changed
      if (oldEnroll && status && oldEnroll.status !== status) {
        await syncEnrollment(supabase, {
          email: oldEnroll.email,
          courseSlug: oldEnroll.course_slug,
          action: status === "active" ? "create" : "revoke",
          expiredAt
        });
      }

      return res.status(200).json({ success: true, enrollment: data });
    }

    // ── DELETE: Revoke Access (Delete Enrollment) ────────────────────────────
    if (req.method === "DELETE") {
      const { id } = req.query || {};
      if (!id) {
        return res.status(400).json({ success: false, error: "Thiếu ID quyền học viên để xóa" });
      }

      // Fetch enrollment details before deleting to revoke Drive folder permission
      const { data: enroll } = await supabase
        .from("student_enrollments")
        .select("email, course_slug")
        .eq("id", id)
        .maybeSingle();

      const { error } = await supabase
        .from("student_enrollments")
        .delete()
        .eq("id", id);

      if (error) throw error;

      if (enroll) {
        await syncEnrollment(supabase, {
          email: enroll.email,
          courseSlug: enroll.course_slug,
          action: "revoke"
        });
      }

      return res.status(200).json({ success: true, message: "Đã thu hồi quyền học thành công" });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-enrollments] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi hệ thống khi phân quyền học viên",
      message: err.message
    });
  }
}
