export const LEARNING_SITES = Object.freeze(["yeunauan", "yeubep"]);
const SITE_SET = new Set(LEARNING_SITES);

export class LearningSiteError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "LearningSiteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isLmsAdminMultiSiteEnabled(env = process.env) {
  return String(env.LMS_ADMIN_MULTI_SITE_ENABLED || "").trim().toLowerCase() === "true";
}

export function normalizeLearningSite(value) {
  return String(value || "").trim().toLowerCase();
}

export function requireLearningSite(value) {
  const site = normalizeLearningSite(value);
  if (!SITE_SET.has(site)) {
    throw new LearningSiteError("INVALID_LEARNING_SITE", "learning_site không hợp lệ", 400);
  }
  return site;
}

export function requestLearningSite(req) {
  return requireLearningSite(
    req?.body?.learning_site ||
    req?.query?.learning_site ||
    req?.headers?.["x-learning-site"]
  );
}

function cleanSlug(value) {
  return String(value || "").trim();
}

export function isSelfTargetCourse(course) {
  const slug = cleanSlug(course?.slug);
  const target = cleanSlug(course?.learning_course_slug);
  return Boolean(slug) && (!target || target === slug);
}

export async function resolveEffectiveLearningSite(course, { findCourseBySlug } = {}) {
  if (!course) {
    throw new LearningSiteError("COURSE_NOT_FOUND_IN_SITE", "Không tìm thấy khóa học", 404);
  }

  const explicit = normalizeLearningSite(course.learning_site);
  if (explicit) return requireLearningSite(explicit);

  if (isSelfTargetCourse(course)) {
    const salesSite = normalizeLearningSite(course.sales_site);
    if (SITE_SET.has(salesSite)) return salesSite;
    if (!salesSite) return "yeunauan";
    throw new LearningSiteError("UNRESOLVED_LEARNING_SITE", "Không resolve được learning site", 409);
  }

  const targetSlug = cleanSlug(course.learning_course_slug);
  if (!targetSlug || typeof findCourseBySlug !== "function") {
    throw new LearningSiteError("UNRESOLVED_LEARNING_SITE", "Không resolve được canonical LMS target", 409);
  }
  const target = await findCourseBySlug(targetSlug);
  if (!target || !isSelfTargetCourse(target)) {
    throw new LearningSiteError("UNRESOLVED_LEARNING_SITE", "Canonical LMS target không hợp lệ", 409);
  }
  return resolveEffectiveLearningSite(target, { findCourseBySlug });
}

export async function loadCourseBySlug(supabase, slug) {
  const clean = cleanSlug(slug);
  if (!clean) {
    throw new LearningSiteError("COURSE_NOT_FOUND_IN_SITE", "Thiếu slug khóa học", 404);
  }
  const { data, error } = await supabase
    .from("courses")
    .select("id,slug,title,sales_site,learning_course_slug,learning_site,active,is_published,raw_data,drive_folder_id")
    .eq("slug", clean)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new LearningSiteError("COURSE_NOT_FOUND_IN_SITE", "Không tìm thấy khóa học trong site", 404);
  }
  return data;
}

export async function assertCourseInLearningSite(supabase, slug, requestedSite, options = {}) {
  const site = requireLearningSite(requestedSite);
  const course = await loadCourseBySlug(supabase, slug);
  const effectiveSite = await resolveEffectiveLearningSite(course, {
    findCourseBySlug: (target) => loadCourseBySlug(supabase, target)
  });
  if (effectiveSite !== site) {
    throw new LearningSiteError("COURSE_SITE_MISMATCH", "Khóa học không thuộc hệ thống đã chọn", 403, {
      requestedSite: site,
      effectiveSite,
      courseSlug: course.slug
    });
  }
  if (options.canonicalOnly && !isSelfTargetCourse(course)) {
    throw new LearningSiteError(
      "LEGACY_SHARED_MAPPING_READ_ONLY",
      "Liên kết dùng chung cũ chỉ được quản trị tại khóa học canonical",
      409
    );
  }
  return { course, requestedSite: site, effectiveSite };
}

export async function listCanonicalCoursesForSite(supabase, requestedSite) {
  const site = requireLearningSite(requestedSite);
  const { data, error } = await supabase
    .from("courses")
    .select("id,slug,title,sales_site,learning_course_slug,learning_site,active,is_published,raw_data,drive_folder_id")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const result = [];
  for (const row of rows) {
    if (!isSelfTargetCourse(row)) continue;
    const owner = await resolveEffectiveLearningSite(row, {
      findCourseBySlug: async (slug) => bySlug.get(slug) || null
    });
    if (owner === site) result.push({ ...row, effective_learning_site: owner });
  }
  return result;
}

export function learningSiteErrorResponse(res, error) {
  if (!(error instanceof LearningSiteError)) return false;
  res.status(error.status).json({
    success: false,
    code: error.code,
    error: error.message,
    ...error.details
  });
  return true;
}

export async function auditLearningSiteOperation(supabase, {
  adminEmail,
  action,
  courseSlug,
  selectedSite,
  effectiveSite,
  metadata = {}
}) {
  return writeAdminAuditLog(supabase, {
    adminEmail,
    action,
    metadata: {
      course_slug: cleanSlug(courseSlug),
      selected_learning_site: normalizeLearningSite(selectedSite),
      effective_learning_site: normalizeLearningSite(effectiveSite),
      ...metadata
    }
  });
}
import { writeAdminAuditLog } from "./lms-session-guard.js";
