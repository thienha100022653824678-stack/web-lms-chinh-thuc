import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { applyCors } from "../cors.js";

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

    // ── GET: Read courses list + Config ───────────────────────────────────────
    if (req.method === "GET") {
      // 1. Get course slugs from courses table
      const { data: courseRows, error: courseErr } = await supabase
        .from("courses")
        .select("slug, title, subtitle, image_url, raw_data")
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

      for (const course of courseRows || []) {
        const slug = course.slug;
        const rawData = course.raw_data || {};
        if (!slug) continue;

        if (course.title) {
          config[`${slug}_title`] = course.title;
        }
        if (!config[`${slug}_subtitle`] && course.subtitle) {
          config[`${slug}_subtitle`] = course.subtitle;
        }
        if (!config[`${slug}_heroImage`] && course.image_url) {
          config[`${slug}_heroImage`] = course.image_url;
        }
        if (!config[`${slug}_posterImage`] && rawData.posterImageUrl) {
          config[`${slug}_posterImage`] = rawData.posterImageUrl;
        }
        if (!config[`${slug}_qrImage`] && rawData.qrImageUrl) {
          config[`${slug}_qrImage`] = rawData.qrImageUrl;
        }
        if (!config[`${slug}_studentDisplayTitle`] && rawData.studentDisplayTitle) {
          config[`${slug}_studentDisplayTitle`] = rawData.studentDisplayTitle;
        }
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
        if (field === "title") continue;
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
          
          const nextQrImage = String(newConfig.qrImage || "").trim();
          const nextPosterImage = String(newConfig.posterImage || "").trim();
          const nextStudentDisplayTitle = String(newConfig.studentDisplayTitle || "").trim();
          const nextSubtitle = String(newConfig.subtitle || "").trim();
          const nextHeroImage = String(newConfig.heroImage || "").trim();

          if (newConfig.qrImage !== undefined && nextQrImage) {
            rawData.qrImageUrl = nextQrImage;
          }
          if (newConfig.posterImage !== undefined && nextPosterImage) {
            rawData.posterImageUrl = nextPosterImage;
          }
          if (newConfig.studentDisplayTitle !== undefined) {
            rawData.studentDisplayTitle = nextStudentDisplayTitle;
          }

          const updatePayload = {
            updated_at: new Date().toISOString()
          };

          if (newConfig.subtitle !== undefined && nextSubtitle) {
            updatePayload.subtitle = nextSubtitle;
          }
          if (newConfig.heroImage !== undefined && nextHeroImage) {
            updatePayload.image_url = nextHeroImage;
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
