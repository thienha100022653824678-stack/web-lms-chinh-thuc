import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail, syncEnrollment } from "../lms.js";

async function getCourseMeta(courseSlug) {
  try {
    const { data: course } = await supabase
      .from("courses")
      .select("title, image_url")
      .eq("slug", String(courseSlug || "").trim())
      .maybeSingle();

    return {
      courseName: course?.title || String(courseSlug || "").trim(),
      thumbnail: course?.image_url || ""
    };
  } catch (err) {
    console.error("[admin-enrollments] Failed to fetch course meta for portal sync:", err.message);
    return {
      courseName: String(courseSlug || "").trim(),
      thumbnail: ""
    };
  }
}

async function syncPortalEnrollment({ email, courseSlug, action }) {
  const system1Url = String(
    process.env.SYSTEM1_URL ||
    process.env.PORTAL_URL ||
    process.env.STUDENT_PORTAL_URL ||
    ""
  ).trim().replace(/\/$/, "");
  const syncSecret = String(process.env.INTERNAL_SYNC_SECRET || "").trim();

  if (!system1Url || !syncSecret) {
    return {
      success: false,
      skipped: true,
      reason: "Thiếu SYSTEM1_URL/PORTAL_URL hoặc INTERNAL_SYNC_SECRET nên chưa sync sang Portal"
    };
  }

  const cleanEmail = normalizeEmail(email);
  const cleanSlug = String(courseSlug || "").trim();
  const { courseName, thumbnail } = await getCourseMeta(cleanSlug);
  const portalAction = action === "revoke" ? "revokeEnrollment" : "syncEnrollment";

  try {
    const response = await fetch(`${system1Url}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sync-Secret": syncSecret
      },
      body: JSON.stringify({
        action: portalAction,
        email: cleanEmail,
        courseSlug: cleanSlug,
        courseName,
        thumbnail
      })
    });

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = { raw: rawText };
    }

    if (!response.ok || payload?.success === false) {
      console.error("[admin-enrollments] Portal sync failed:", response.status, payload);
      return {
        success: false,
        status: response.status,
        error: payload?.error || payload?.message || rawText || "Portal sync failed"
      };
    }

    return { success: true, action: portalAction, response: payload };
  } catch (err) {
    console.error("[admin-enrollments] Portal sync request error:", err.message);
    return { success: false, error: err.message };
  }
}

async function backfillPortalEnrollments({ email, courseSlug, dryRun = false }) {
  let query = supabase
    .from("student_enrollments")
    .select("id, email, course_slug, status, created_at")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (email) query = query.eq("email", normalizeEmail(email));
  if (courseSlug) query = query.eq("course_slug", String(courseSlug || "").trim());

  const { data: enrollments, error } = await query;
  if (error) throw error;

  const rows = (enrollments || []).filter(row => row.email && row.course_slug);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      total: rows.length,
      details: rows.map(row => ({
        email: normalizeEmail(row.email),
        courseSlug: String(row.course_slug || "").trim(),
        status: row.status
      }))
    };
  }

  let successCount = 0;
  let failedCount = 0;
  const details = [];

  for (const row of rows) {
    const result = await syncPortalEnrollment({
      email: row.email,
      courseSlug: row.course_slug,
      action: "create"
    });

    const detail = {
      email: normalizeEmail(row.email),
      courseSlug: String(row.course_slug || "").trim(),
      success: Boolean(result.success),
      skipped: Boolean(result.skipped),
      error: result.error || result.reason || null
    };

    details.push(detail);
    if (result.success) successCount++;
    else failedCount++;
  }

  return {
    success: failedCount === 0,
    total: rows.length,
    successCount,
    failedCount,
    details
  };
}

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

    // ── POST: Grant Access / Backfill Portal ──────────────────────────────────
    if (req.method === "POST") {
      const { action, email, courseSlug, expiredAt, dryRun } = req.body || {};

      if (action === "backfillPortal") {
        const result = await backfillPortalEnrollments({ email, courseSlug, dryRun });
        try {
          await supabase.from("audit_logs").insert({
            action: "portal_enrollment_backfill",
            detail: `Portal enrollment backfill by ${adminSession.email}: ${result.successCount || 0} success, ${result.failedCount || 0} failed, ${result.total || 0} total`,
            created_at: new Date().toISOString()
          });
        } catch {
          // audit_logs may not exist in older deployments
        }
        return res.status(200).json(result);
      }

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

      const portalSync = await syncPortalEnrollment({ email, courseSlug, action: "create" });

      return res.status(200).json({
        success: true,
        enrollment: syncResult.enrollment,
        portalSync
      });
    }

    // ── PUT: Update Enrollment Status / Expiry ────────────────────────────────
    if (req.method === "PUT") {
      const { id, status, expiredAt } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, error: "Thiếu ID quyền học viên" });
      }

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

      let portalSync = null;

      if (oldEnroll && status && oldEnroll.status !== status) {
        const shouldGrant = status === "active";
        await syncEnrollment(supabase, {
          email: oldEnroll.email,
          courseSlug: oldEnroll.course_slug,
          action: shouldGrant ? "create" : "revoke",
          expiredAt
        });

        portalSync = await syncPortalEnrollment({
          email: oldEnroll.email,
          courseSlug: oldEnroll.course_slug,
          action: shouldGrant ? "create" : "revoke"
        });
      }

      return res.status(200).json({ success: true, enrollment: data, portalSync });
    }

    // ── DELETE: Revoke Access (Delete Enrollment) ────────────────────────────
    if (req.method === "DELETE") {
      const { id } = req.query || {};
      if (!id) {
        return res.status(400).json({ success: false, error: "Thiếu ID quyền học viên để xóa" });
      }

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

      let portalSync = null;

      if (enroll) {
        await syncEnrollment(supabase, {
          email: enroll.email,
          courseSlug: enroll.course_slug,
          action: "revoke"
        });

        portalSync = await syncPortalEnrollment({
          email: enroll.email,
          courseSlug: enroll.course_slug,
          action: "revoke"
        });
      }

      return res.status(200).json({ success: true, message: "Đã thu hồi quyền học thành công", portalSync });
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
