import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { fetchRecipeText } from "./public-lesson.js";

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

    // ── GET: Read lessons for a course ────────────────────────────────────────
    if (req.method === "GET") {
      const { course } = req.query || {};
      if (!course) {
        return res.status(400).json({ success: false, error: "Thiếu tham số course" });
      }
      const courseSlug = String(course).trim();

      const { data: lessons, error } = await supabase
        .from("lessons")
        .select("*")
        .eq("course_slug", courseSlug)
        .order("lesson_no", { ascending: true });

      if (error) throw error;

      const formattedLessons = (lessons || []).map(l => ({
        id: l.id,
        course: l.course_slug,
        lesson: l.lesson_no,
        title: l.title,
        description: l.description || "",
        duration: l.duration_text || "",
        level: l.level || "",
        thumbnailUrl: l.thumbnail_url || "",
        videoUrl: l.video_url || "",
        recipeUrl: l.recipe_url || "",
        mediaUrls: l.media_urls || "",
        status: l.status || "active",
        isSection: l.is_section || false,
        materials: l.materials || []
      }));

      return res.status(200).json({ success: true, lessons: formattedLessons });
    }

    // ── POST: Create / Update / Delete ────────────────────────────────────────
    if (req.method === "POST") {
      const { action, course, lesson, originalCourse, originalLesson, lessonData } = req.body || {};

      if (!action) {
        return res.status(400).json({ success: false, error: "Thiếu tham số action" });
      }

      // Action: CREATE
      if (action === "create") {
        if (!lessonData || typeof lessonData !== "object") {
          return res.status(400).json({ success: false, error: "Thiếu dữ liệu lessonData" });
        }

        // Fetch course ID by slug
        const { data: courseRec } = await supabase
          .from("courses")
          .select("id")
          .eq("slug", lessonData.course)
          .maybeSingle();

        const { error: insertErr } = await supabase
          .from("lessons")
          .insert({
            course_id: courseRec?.id || null,
            course_slug: lessonData.course,
            lesson_no: parseInt(lessonData.lesson, 10),
            title: lessonData.title,
            description: lessonData.description || "",
            duration_text: lessonData.duration || "",
            level: lessonData.level || "",
            thumbnail_url: lessonData.thumbnailUrl || "",
            video_url: lessonData.videoUrl || "",
            recipe_url: lessonData.recipeUrl || "",
            media_urls: lessonData.mediaUrls || "",
            status: "active",
            sort_order: parseInt(lessonData.lesson, 10),
            is_section: lessonData.isSection || false,
            materials: lessonData.materials || [],
            updated_at: new Date().toISOString()
          });

        if (insertErr) throw insertErr;

        // Sync recipe text to System 1 Portal
        if (lessonData.recipeUrl) {
          try {
            console.log(`[Recipe Sync] course_slug: ${lessonData.course}`);
            const recipeText = await fetchRecipeText(lessonData.recipeUrl);
            const sys1Url = process.env.SYSTEM1_URL;
            const secret = process.env.INTERNAL_SYNC_SECRET;
            if (sys1Url && secret && recipeText) {
              const syncRes = await fetch(`${sys1Url.trim().replace(/\/$/, '')}/api/sync`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Sync-Secret": secret
                },
                body: JSON.stringify({
                  action: "syncRecipe",
                  courseSlug: lessonData.course,
                  recipe: recipeText,
                  title: lessonData.title
                })
              });
              const responseText = await syncRes.text();
              if (syncRes.ok) {
                try {
                  const resJson = JSON.parse(responseText);
                  console.log(`[Recipe Sync] post id: ${resJson.postId} - success`);
                } catch {
                  console.log(`[Recipe Sync] success - response: ${responseText}`);
                }
              } else {
                console.error(`[Recipe Sync] failed - status: ${syncRes.status}, error: ${responseText}`);
              }
            } else {
              console.warn(`[Recipe Sync] skipped - sys1Url: ${!!sys1Url}, secret: ${!!secret}, hasRecipeText: ${!!recipeText}`);
            }
          } catch (syncErr) {
            console.error("[Recipe Sync] failed with error:", syncErr.message);
          }
        }

        return res.status(200).json({ success: true, message: "Tạo bài học thành công" });
      }

      // Action: UPDATE
      if (action === "update") {
        if (!originalCourse || !originalLesson) {
          return res.status(400).json({ success: false, error: "Thiếu originalCourse hoặc originalLesson" });
        }
        if (!lessonData || typeof lessonData !== "object") {
          return res.status(400).json({ success: false, error: "Thiếu dữ liệu lessonData" });
        }

        // Fetch course ID by slug
        const { data: courseRec } = await supabase
          .from("courses")
          .select("id")
          .eq("slug", lessonData.course)
          .maybeSingle();

        const { error: updateErr } = await supabase
          .from("lessons")
          .update({
            course_id: courseRec?.id || null,
            course_slug: lessonData.course,
            lesson_no: parseInt(lessonData.lesson, 10),
            title: lessonData.title,
            description: lessonData.description || "",
            duration_text: lessonData.duration || "",
            level: lessonData.level || "",
            thumbnail_url: lessonData.thumbnailUrl || "",
            video_url: lessonData.videoUrl || "",
            recipe_url: lessonData.recipeUrl || "",
            media_urls: lessonData.mediaUrls || "",
            status: lessonData.status || "active",
            sort_order: parseInt(lessonData.lesson, 10),
            is_section: lessonData.isSection || false,
            materials: lessonData.materials || [],
            updated_at: new Date().toISOString()
          })
          .eq("course_slug", originalCourse)
          .eq("lesson_no", parseInt(originalLesson, 10));

        if (updateErr) throw updateErr;

        // Sync recipe text to System 1 Portal
        if (lessonData.recipeUrl) {
          try {
            console.log(`[Recipe Sync] course_slug: ${lessonData.course}`);
            const recipeText = await fetchRecipeText(lessonData.recipeUrl);
            const sys1Url = process.env.SYSTEM1_URL;
            const secret = process.env.INTERNAL_SYNC_SECRET;
            if (sys1Url && secret && recipeText) {
              const syncRes = await fetch(`${sys1Url.trim().replace(/\/$/, '')}/api/sync`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Sync-Secret": secret
                },
                body: JSON.stringify({
                  action: "syncRecipe",
                  courseSlug: lessonData.course,
                  recipe: recipeText,
                  title: lessonData.title
                })
              });
              const responseText = await syncRes.text();
              if (syncRes.ok) {
                try {
                  const resJson = JSON.parse(responseText);
                  console.log(`[Recipe Sync] post id: ${resJson.postId} - success`);
                } catch {
                  console.log(`[Recipe Sync] success - response: ${responseText}`);
                }
              } else {
                console.error(`[Recipe Sync] failed - status: ${syncRes.status}, error: ${responseText}`);
              }
            } else {
              console.warn(`[Recipe Sync] skipped - sys1Url: ${!!sys1Url}, secret: ${!!secret}, hasRecipeText: ${!!recipeText}`);
            }
          } catch (syncErr) {
            console.error("[Recipe Sync] failed with error:", syncErr.message);
          }
        }

        return res.status(200).json({ success: true, message: "Cập nhật bài học thành công" });
      }

      // Action: REORDER
      if (action === "reorder") {
        const { course, orderedIds } = req.body || {};
        if (!course || !Array.isArray(orderedIds)) {
          return res.status(400).json({ success: false, error: "Thiếu tham số course hoặc orderedIds" });
        }

        // To prevent UNIQUE constraint conflicts on lesson_no,
        // we first assign temporary negative numbers, then positive numbers.
        for (let i = 0; i < orderedIds.length; i++) {
          const { error: tempErr } = await supabase
            .from("lessons")
            .update({
              lesson_no: -(i + 1),
              sort_order: -(i + 1),
              updated_at: new Date().toISOString()
            })
            .eq("id", orderedIds[i])
            .eq("course_slug", course);
          if (tempErr) throw tempErr;
        }

        for (let i = 0; i < orderedIds.length; i++) {
          const { error: finalErr } = await supabase
            .from("lessons")
            .update({
              lesson_no: i + 1,
              sort_order: i + 1,
              updated_at: new Date().toISOString()
            })
            .eq("id", orderedIds[i])
            .eq("course_slug", course);
          if (finalErr) throw finalErr;
        }

        return res.status(200).json({ success: true, message: "Đã sắp xếp lại bài học thành công" });
      }

      // Action: DELETE (Soft delete)
      if (action === "delete") {
        if (!course || !lesson) {
          return res.status(400).json({ success: false, error: "Thiếu tham số course hoặc lesson" });
        }

        const { error: deleteErr } = await supabase
          .from("lessons")
          .update({
            status: "hidden",
            updated_at: new Date().toISOString()
          })
          .eq("course_slug", course)
          .eq("lesson_no", parseInt(lesson, 10));

        if (deleteErr) throw deleteErr;
        return res.status(200).json({ success: true, message: "Đã ẩn bài học thành công" });
      }

      return res.status(400).json({ success: false, error: `Action '${action}' không hợp lệ` });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-lessons] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server trong admin-lessons",
      message: err.message
    });
  }
}
