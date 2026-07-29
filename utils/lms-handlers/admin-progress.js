import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { applyCors } from "../cors.js";
import {
  assertCourseInLearningSite,
  auditLearningSiteOperation,
  isLmsAdminMultiSiteEnabled,
  learningSiteErrorResponse,
  requestLearningSite
} from "../learning-site.js";

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const admin = getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    const multiSite = isLmsAdminMultiSiteEnabled();
    const site = multiSite ? requestLearningSite(req) : null;

    if (req.method === "GET") {
      const course = String(req.query?.course || "").trim();
      if (!course) return res.status(400).json({ success: false, error: "Thiếu course" });
      if (multiSite) await assertCourseInLearningSite(supabase, course, site, { canonicalOnly: true });
      let query = supabase.from("lesson_progress").select("*").eq("course_slug", course);
      if (req.query?.email) query = query.eq("email", String(req.query.email).trim().toLowerCase());
      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ success: true, progress: data || [] });
    }

    if (req.method === "PUT") {
      const { id, progressPercent, completed } = req.body || {};
      if (!id) return res.status(400).json({ success: false, error: "Thiếu progress ID" });
      const { data: current, error: currentError } = await supabase
        .from("lesson_progress")
        .select("id,email,course_slug,lesson_id")
        .eq("id", id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) {
        return res.status(404).json({ success: false, code: "COURSE_NOT_FOUND_IN_SITE", error: "Không tìm thấy progress" });
      }
      if (multiSite) await assertCourseInLearningSite(supabase, current.course_slug, site, { canonicalOnly: true });
      const { data: lesson, error: lessonError } = await supabase
        .from("lessons")
        .select("id,course_slug")
        .eq("id", current.lesson_id)
        .maybeSingle();
      if (lessonError) throw lessonError;
      if (!lesson || lesson.course_slug !== current.course_slug) {
        return res.status(409).json({ success: false, code: "COURSE_SITE_MISMATCH", error: "Lesson/progress không cùng canonical course" });
      }
      const nextPercent = Math.max(0, Math.min(100, Number(progressPercent ?? 0)));
      const { data: written, error } = await supabase
        .from("lesson_progress")
        .update({
          progress_percent: nextPercent,
          completed: Boolean(completed),
          updated_at: new Date().toISOString()
        })
        .eq("id", current.id)
        .select("id,email,course_slug,lesson_id,progress_percent,completed")
        .single();
      if (error) throw error;
      if (
        written.id !== current.id ||
        written.course_slug !== current.course_slug ||
        written.lesson_id !== current.lesson_id ||
        Number(written.progress_percent) !== nextPercent
      ) throw new Error("Progress read-after-write verification failed");
      if (multiSite) {
        await auditLearningSiteOperation(supabase, {
          adminEmail: admin.email,
          action: "lms_multisite_progress_update",
          courseSlug: written.course_slug,
          selectedSite: site,
          effectiveSite: site,
          metadata: { progress_id: written.id, lesson_id: written.lesson_id }
        });
      }
      return res.status(200).json({ success: true, progress: written });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    if (learningSiteErrorResponse(res, error)) return;
    console.error("[admin-progress] Error:", error);
    return res.status(500).json({ success: false, error: "Lỗi quản trị tiến độ" });
  }
}
