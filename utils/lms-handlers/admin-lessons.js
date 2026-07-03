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

      const hasSection = (lessons || []).some(l => Boolean(l.is_section));
      let sectionCounter = 0;
      let globalCounter = 0;

      const formattedLessons = (lessons || []).map(l => {
        const isSec = Boolean(l.is_section);
        let displayLesson = l.lesson_no;
        if (isSec) {
          sectionCounter = 0;
        } else {
          sectionCounter++;
          globalCounter++;
          displayLesson = hasSection ? sectionCounter : globalCounter;
        }

        return {
          id: l.id,
          course: l.course_slug,
          lesson: l.lesson_no,
          displayLesson: displayLesson,
          title: l.title,
          description: l.description || "",
          duration: l.duration_text || "",
          level: l.level || "",
          thumbnailUrl: l.thumbnail_url || "",
          videoUrl: l.video_url || "",
          recipeUrl: l.recipe_url || "",
          mediaUrls: l.media_urls || "",
          isSection: isSec,
          status: l.status || "active"
        };
      });

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

        // Calculate next unique lesson_no for backend to guarantee no duplicate key error
        const { data: existingLessons } = await supabase
          .from("lessons")
          .select("lesson_no")
          .eq("course_slug", lessonData.course);

        let maxLessonNo = 0;
        (existingLessons || []).forEach(l => {
          const no = parseInt(l.lesson_no, 10);
          if (!isNaN(no) && no > maxLessonNo) maxLessonNo = no;
        });
        const targetLessonNo = maxLessonNo + 1;

        const insertPayload = {
          course_id: courseRec?.id || null,
          course_slug: lessonData.course,
          lesson_no: targetLessonNo,
          title: lessonData.title,
          description: lessonData.description || "",
          duration_text: lessonData.duration || "",
          level: lessonData.level || "",
          thumbnail_url: lessonData.thumbnailUrl || "",
          video_url: lessonData.videoUrl || "",
          recipe_url: lessonData.recipeUrl || "",
          media_urls: lessonData.mediaUrls || "",
          is_section: Boolean(lessonData.isSection),
          status: "active",
          sort_order: targetLessonNo,
          updated_at: new Date().toISOString()
        };

    let { error: insertErr } = await supabase.from("lessons").insert(insertPayload);

        // Fallback: If insert fails for any reason (e.g. is_section column missing), retry without is_section
        if (insertErr) {
          console.warn("[admin-lessons] Insert with is_section failed:", insertErr.message, "- retrying without is_section...");
          delete insertPayload.is_section;
          const retryRes = await supabase.from("lessons").insert(insertPayload);
          if (!retryRes.error) {
            insertErr = null;
          } else {
            console.error("[admin-lessons] Insert retry also failed:", retryRes.error.message);
          }
        }

        if (insertErr) throw insertErr;

        // Sync recipe text to System 1 Portal
        if (lessonData.recipeUrl) {
          try {
            const recipeText = await fetchRecipeText(lessonData.recipeUrl);
            const sys1Url = process.env.SYSTEM1_URL;
            const secret = process.env.INTERNAL_SYNC_SECRET;
            if (sys1Url && secret && recipeText) {
              await fetch(`${sys1Url.trim().replace(/\/$/, '')}/api/sync`, {
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
            }
          } catch (syncErr) {
            console.error("[admin-lessons] Sync recipe failed on create:", syncErr.message);
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

        const updatePayload = {
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
          is_section: Boolean(lessonData.isSection),
          status: lessonData.status || "active",
          sort_order: parseInt(lessonData.lesson, 10),
          updated_at: new Date().toISOString()
        };

        let { error: updateErr } = await supabase
          .from("lessons")
          .update(updatePayload)
          .eq("course_slug", originalCourse)
          .eq("lesson_no", parseInt(originalLesson, 10));

        // Fallback: If update fails for any reason, retry without is_section
        if (updateErr) {
          console.warn("[admin-lessons] Update with is_section failed:", updateErr.message, "- retrying without is_section...");
          delete updatePayload.is_section;
          const retryRes = await supabase
            .from("lessons")
            .update(updatePayload)
            .eq("course_slug", originalCourse)
            .eq("lesson_no", parseInt(originalLesson, 10));
          if (!retryRes.error) {
            updateErr = null;
          } else {
            console.error("[admin-lessons] Update retry also failed:", retryRes.error.message);
          }
        }

        if (updateErr) throw updateErr;

        // Sync recipe text to System 1 Portal
        if (lessonData.recipeUrl) {
          try {
            const recipeText = await fetchRecipeText(lessonData.recipeUrl);
            const sys1Url = process.env.SYSTEM1_URL;
            const secret = process.env.INTERNAL_SYNC_SECRET;
            if (sys1Url && secret && recipeText) {
              await fetch(`${sys1Url.trim().replace(/\/$/, '')}/api/sync`, {
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
            }
          } catch (syncErr) {
            console.error("[admin-lessons] Sync recipe failed on update:", syncErr.message);
          }
        }

        return res.status(200).json({ success: true, message: "Cập nhật bài học thành công" });
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
      error: `Lỗi server trong admin-lessons: ${err.message || String(err)}`,
      message: err.message
    });
  }
}
