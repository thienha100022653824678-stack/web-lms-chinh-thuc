import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail, syncEnrollment } from "../lms.js";
import { applyCors } from "../cors.js";
import {
  maybeShadowEnrollmentAccess,
} from "../v2-outbox-shadow.js";

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);

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
          *,
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

      // V2 shadow: mirror the enrollment upsert to the outbox (fail-open).
      await maybeShadowEnrollmentAccess(
        { email: normalizeEmail(email), course_slug: courseSlug, status: "active" },
        "upserted"
      );

      return res.status(200).json({ success: true, enrollment: syncResult.enrollment, driveSync: syncResult.driveSync });
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

        // V2 shadow: mirror the status change to the outbox (fail-open).
        await maybeShadowEnrollmentAccess(
          { email: oldEnroll.email, course_slug: oldEnroll.course_slug, status },
          status === "active" ? "upserted" : "revoked"
        );
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

        // V2 shadow: mirror the revoke to the outbox (fail-open).
        await maybeShadowEnrollmentAccess(
          { email: enroll.email, course_slug: enroll.course_slug },
          "revoked"
        );
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
