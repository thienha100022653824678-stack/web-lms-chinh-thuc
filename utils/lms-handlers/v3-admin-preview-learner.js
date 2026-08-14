import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { applyCors } from "../cors.js";
import { fetchRecipeText } from "./public-lesson.js";

function previewOnly() {
  return String(process.env.VERCEL_ENV || "").toLowerCase() !== "production";
}

function normalizeMaterials(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = String(item.name || item.fileName || "").trim();
      const url = String(item.url || item.webViewLink || item.downloadUrl || "").trim();
      if (!name || !url) return null;
      return {
        id: String(item.id || item.fileId || url),
        name,
        url,
        downloadUrl: String(item.downloadUrl || url),
        mimeType: String(item.mimeType || ""),
        size: Number(item.size || 0),
        source: String(item.source || "google_drive")
      };
    })
    .filter(Boolean);
}

async function getCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("slug,title")
    .order("slug", { ascending: true });
  if (error) throw error;
  return (data || [])
    .map((row) => ({
      slug: String(row.slug || "").trim(),
      title: String(row.title || row.slug || "").trim()
    }))
    .filter((row) => row.slug);
}

async function getCourseData(courseSlug, adminEmail) {
  const { data: courseRow, error: courseError } = await supabase
    .from("courses")
    .select("slug,title")
    .eq("slug", courseSlug)
    .maybeSingle();
  if (courseError) throw courseError;
  if (!courseRow) {
    return { status: 404, body: { success: false, allowed: false, error: "course_not_found" } };
  }

  const { data: rows, error } = await supabase
    .from("lessons")
    .select("*")
    .eq("course_slug", courseSlug)
    .neq("status", "hidden")
    .order("lesson_no", { ascending: true });
  if (error) throw error;

  const lessons = await Promise.all((rows || []).map(async (l) => {
    let recipeText = "";
    if (l.recipe_url && !l.is_section) {
      try {
        recipeText = await fetchRecipeText(l.recipe_url);
      } catch {
        recipeText = "";
      }
    }
    return {
      id: l.id,
      course: l.course_slug,
      lesson: l.lesson_no,
      title: l.title,
      description: l.description || "",
      duration: l.duration_text || "",
      level: l.level || "",
      thumbnailUrl: l.thumbnail_url || "",
      videoUrl: l.video_url || "",
      secureVideoUrl: l.video_url || "",
      recipeUrl: l.recipe_url || "",
      recipeText,
      mediaUrls: l.media_urls || "",
      materials: normalizeMaterials(l.materials),
      isSection: Boolean(l.is_section),
      status: l.status || "active",
      views: Number(l.views || 0)
    };
  }));

  return {
    status: 200,
    body: {
      success: true,
      allowed: true,
      previewReadOnly: true,
      adminPreview: true,
      email: adminEmail,
      course: String(courseRow.slug || courseSlug),
      courseInfo: {
        slug: String(courseRow.slug || courseSlug),
        title: String(courseRow.title || courseRow.slug || courseSlug)
      },
      lessons
    }
  };
}

export default async function handler(req, res, { kind = "course" } = {}) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  res.setHeader("Cache-Control", "no-store");

  if (!previewOnly()) {
    return res.status(404).json({ success: false, allowed: false, error: "preview_only" });
  }

  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(401).json({ success: false, allowed: false, error: "admin_auth_required" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, allowed: false, error: "method_not_allowed" });
  }

  try {
    if (kind === "bootstrap") {
      const allowedCourses = await getCourses();
      return res.status(200).json({
        success: true,
        allowed: true,
        previewReadOnly: true,
        adminPreview: true,
        email: admin.email,
        allowedCourses,
        verifiedSession: false,
        verifiedCourse: ""
      });
    }

    const courseSlug = String(req.body?.course || "").trim();
    if (!courseSlug) {
      return res.status(400).json({ success: false, allowed: false, error: "missing_course" });
    }

    const result = await getCourseData(courseSlug, admin.email);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[v3-admin-preview-learner] error:", err?.message);
    return res.status(503).json({
      success: false,
      allowed: false,
      error: "preview_course_unavailable"
    });
  }
}

export const _internals = { previewOnly, normalizeMaterials, getCourses, getCourseData };
