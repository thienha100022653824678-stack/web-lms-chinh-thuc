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

    // ── GET: Read courses list + Config ───────────────────────────────────────
    if (req.method === "GET") {
      // 1. Get course details from courses table
      const { data: courseRows, error: courseErr } = await supabase
        .from("courses")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (courseErr) throw courseErr;
      const courses = (courseRows || []).map(c => c.slug);

      // 2. Read Config from site_config
      const { data: configRows, error: configErr } = await supabase
        .from("site_config")
        .select("key, value");

      if (configErr) throw configErr;

      const config = {};
      if (configRows) {
        configRows.forEach(row => {
          const valObj = row.value;
          const val = (valObj && typeof valObj === "object" && valObj.val !== undefined) ? valObj.val : valObj;
          config[row.key] = val;
        });
      }

      // Merge courses table values as default/fallbacks into config if not already set in site_config
      if (courseRows) {
        courseRows.forEach(c => {
          const slug = c.slug;
          if (!config[`${slug}_title`]) {
            config[`${slug}_title`] = c.title || "";
          }
          if (!config[`${slug}_subtitle`]) {
            config[`${slug}_subtitle`] = c.subtitle || "";
          }
          if (!config[`${slug}_heroImage`]) {
            const rawData = c.raw_data || {};
            config[`${slug}_heroImage`] = c.image_url || rawData.heroImageUrl || rawData.bannerImageUrl || "";
          }
          if (!config[`${slug}_posterImage`]) {
            const rawData = c.raw_data || {};
            config[`${slug}_posterImage`] = rawData.posterImageUrl || "";
          }
          if (!config[`${slug}_qrImage`]) {
            const rawData = c.raw_data || {};
            config[`${slug}_qrImage`] = rawData.qrImageUrl || "";
          }
        });
      }

      return res.status(200).json({ success: true, courses, config });
    }

    // ── POST: Update Config ───────────────────────────────────────────────────
    if (req.method === "POST") {
      const { action, course, config: newConfig } = req.body || {};

      if (action !== "updateConfig") {
        return res.status(400).json({ success: false, error: "action không hợp lệ" });
      }
      if (!course) {
        return res.status(400).json({ success: false, error: "Thiếu tham số course" });
      }
      if (!newConfig || typeof newConfig !== "object") {
        return res.status(400).json({ success: false, error: "Thiếu dữ liệu config" });
      }

      for (const [field, value] of Object.entries(newConfig)) {
        const prefixedKey = `${course}_${field}`;
        const val = String(value || "").trim();

        const { error: upsertErr } = await supabase
          .from("site_config")
          .upsert({
            key: prefixedKey,
            value: { val },
            updated_at: new Date().toISOString()
          }, {
            onConflict: "key"
          });

        if (upsertErr) throw upsertErr;
      }

      // Synchronize back to 'courses' table
      try {
        const { data: courseRow } = await supabase
          .from("courses")
          .select("raw_data")
          .eq("slug", course)
          .maybeSingle();

        if (courseRow) {
          const rawData = courseRow.raw_data || {};
          
          if (newConfig.qrImage !== undefined) {
            rawData.qrImageUrl = String(newConfig.qrImage || "").trim();
          }
          if (newConfig.posterImage !== undefined) {
            rawData.posterImageUrl = String(newConfig.posterImage || "").trim();
          }

          const updatePayload = {
            updated_at: new Date().toISOString()
          };

          if (newConfig.title !== undefined) {
            updatePayload.title = String(newConfig.title || "").trim();
          }
          if (newConfig.subtitle !== undefined) {
            updatePayload.subtitle = String(newConfig.subtitle || "").trim();
          }
          if (newConfig.heroImage !== undefined) {
            updatePayload.image_url = String(newConfig.heroImage || "").trim();
          }
          
          updatePayload.raw_data = rawData;

          await supabase
            .from("courses")
            .update(updatePayload)
            .eq("slug", course);
        }
      } catch (dbErr) {
        console.error("[admin-courses] Sync to courses table failed:", dbErr.message);
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-courses] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server trong admin-courses",
      message: err.message
    });
  }
}
