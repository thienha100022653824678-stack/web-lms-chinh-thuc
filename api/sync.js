import { supabase } from "../utils/supabase.js";
import { 
  normalizeEmail, 
  syncEnrollment
} from "../utils/lms.js";

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sync-Secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // Verify internal sync secret
  const syncSecret = req.headers["x-sync-secret"];
  const systemSecret = process.env.INTERNAL_SYNC_SECRET;

  if (!systemSecret || syncSecret !== systemSecret) {
    return res.status(401).json({ success: false, error: "Unauthorized: Sync secret is invalid or missing." });
  }

  try {
    const { action, slug, title, subtitle, imageUrl, active, email, courseSlug } = req.body || {};

    if (!action) {
      return res.status(400).json({ success: false, error: "Thiếu tham số action" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SYNC COURSE (Tạo/Sửa khóa học)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncCourse") {
      if (!slug || !title) {
        return res.status(400).json({ success: false, error: "Thiếu slug hoặc title" });
      }

      // Check if course already exists
      const { data: existingCourse, error: fetchErr } = await supabase
        .from("courses")
        .select("id, raw_data")
        .eq("slug", slug.trim())
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      let result;
      if (existingCourse) {
        // Update metadata without breaking lessons or existing raw_data
        const rawData = existingCourse.raw_data || {};
        const { error: updateErr } = await supabase
          .from("courses")
          .update({
            title: title.trim(),
            subtitle: subtitle ? subtitle.trim() : null,
            image_url: imageUrl ? imageUrl.trim() : null,
            active: active !== undefined ? active : true,
            updated_at: new Date().toISOString()
          })
          .eq("id", existingCourse.id);

        if (updateErr) throw updateErr;
        result = { id: existingCourse.id, updated: true };
      } else {
        // Create new course in draft mode
        const { data: newCourse, error: insertErr } = await supabase
          .from("courses")
          .insert({
            slug: slug.trim(),
            title: title.trim(),
            subtitle: subtitle ? subtitle.trim() : null,
            image_url: imageUrl ? imageUrl.trim() : null,
            active: active !== undefined ? active : true,
            sort_order: 999 // Default to end of list
          })
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        result = { id: newCourse.id, created: true };
      }

      return res.status(200).json({ success: true, course: result });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SYNC ENROLLMENT (Duyệt cấp quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "create"
      });

      return res.status(200).json(syncResult);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. REVOKE ENROLLMENT (Hủy/Thu hồi quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "revokeEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "revoke"
      });

      return res.status(200).json(syncResult);
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ" });
  } catch (error) {
    console.error("[sync] Error in handler:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
