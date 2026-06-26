import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    // ── GET: Read sub posts for a course ────────────────────────────────────────
    if (req.method === "GET") {
      const { course } = req.query || {};
      if (!course) {
        return res.status(400).json({ success: false, error: "Thiếu tham số course" });
      }
      const courseSlug = String(course).trim();

      const { data: posts, error } = await supabase
        .from("posts")
        .select("*")
        .eq("course_slug", courseSlug)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.status(200).json({ success: true, subPosts: posts || [] });
    }

    // ── POST: Create / Update / Delete ────────────────────────────────────────
    if (req.method === "POST") {
      const { action, id, courseSlug, title, recipe, heroMediaUrl, images, status } = req.body || {};

      if (!action) {
        return res.status(400).json({ success: false, error: "Thiếu tham số action" });
      }

      // Action: SAVE (create or update)
      if (action === "save") {
        if (!courseSlug) {
          return res.status(400).json({ success: false, error: "Thiếu courseSlug" });
        }
        if (!title) {
          return res.status(400).json({ success: false, error: "Thiếu tiêu đề" });
        }

        const postData = {
          course_slug: courseSlug.trim(),
          title: title.trim(),
          recipe: recipe || "",
          hero_media_url: heroMediaUrl || "",
          images: Array.isArray(images) ? images : [],
          status: status || "active",
        };

        // Use upsert to handle both insert and update with client-generated UUIDs
        const { error: upsertErr } = await supabase
          .from("posts")
          .upsert({
            id: id || undefined,
            ...postData
          });

        if (upsertErr) throw upsertErr;
        return res.status(200).json({ success: true, message: "Lưu cấu hình khóa học phụ thành công" });
      }

      // Action: DELETE
      if (action === "delete") {
        if (!id) {
          return res.status(400).json({ success: false, error: "Thiếu id bài viết cần xóa" });
        }

        const { error: deleteErr } = await supabase
          .from("posts")
          .delete()
          .eq("id", id);

        if (deleteErr) throw deleteErr;
        return res.status(200).json({ success: true, message: "Xóa bài viết phụ thành công" });
      }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("Error in admin-sub-posts handler:", err);
    return res.status(500).json({ success: false, error: err.message || "Lỗi hệ thống" });
  }
}
