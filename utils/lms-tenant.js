export const LMS_TENANTS = Object.freeze(["yeunauan", "yeubep"]);
const SITE_SET = new Set(LMS_TENANTS);

export class LmsTenantError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "LmsTenantError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isLmsDualSystemEnabled(env = process.env) {
  return String(env.LMS_DUAL_SYSTEM_ENABLED || "").trim().toLowerCase() === "true";
}

export function normalizeLmsTenant(value) {
  return String(value || "").trim().toLowerCase();
}

export function requireLmsTenant(value) {
  const site = normalizeLmsTenant(value);
  if (!SITE_SET.has(site)) {
    throw new LmsTenantError("INVALID_LMS_TENANT", "lms_tenant không hợp lệ", 400);
  }
  return site;
}

export function requestLmsTenant(req) {
  return requireLmsTenant(
    req?.body?.lms_tenant ||
    req?.query?.lms_tenant ||
    req?.headers?.["x-lms-tenant"]
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

export async function resolveEffectiveLmsTenant(course, { findCourseBySlug } = {}) {
  return resolveEffectiveLmsTenantInternal(course, { findCourseBySlug }, new Set());
}

async function resolveEffectiveLmsTenantInternal(course, { findCourseBySlug } = {}, visited) {
  if (!course) {
    throw new LmsTenantError("COURSE_NOT_FOUND_IN_LMS", "Không tìm thấy khóa học", 404);
  }
  const slug = cleanSlug(course.slug);
  if (!slug || visited.has(slug)) {
    throw new LmsTenantError("UNRESOLVED_LMS_TENANT", "Canonical LMS target bị vòng lặp", 409);
  }
  visited.add(slug);

  const explicit = normalizeLmsTenant(course.lms_tenant);
  if (explicit) return requireLmsTenant(explicit);

  if (isSelfTargetCourse(course)) {
    const salesSite = normalizeLmsTenant(course.sales_site);
    if (SITE_SET.has(salesSite)) return salesSite;
    if (!salesSite) return "yeunauan";
    throw new LmsTenantError("UNRESOLVED_LMS_TENANT", "Không resolve được LMS tenant", 409);
  }

  const targetSlug = cleanSlug(course.learning_course_slug);
  if (!targetSlug || typeof findCourseBySlug !== "function") {
    throw new LmsTenantError("UNRESOLVED_LMS_TENANT", "Không resolve được canonical LMS target", 409);
  }
  const target = await findCourseBySlug(targetSlug);
  if (!target || target.active === false || !isSelfTargetCourse(target)) {
    throw new LmsTenantError("UNRESOLVED_LMS_TENANT", "Canonical LMS target không hợp lệ", 409);
  }
  return resolveEffectiveLmsTenantInternal(target, { findCourseBySlug }, visited);
}

export async function loadCourseBySlug(supabase, slug) {
  const clean = cleanSlug(slug);
  if (!clean) {
    throw new LmsTenantError("COURSE_NOT_FOUND_IN_LMS", "Thiếu slug khóa học", 404);
  }
  const { data, error } = await supabase
    .from("courses")
    .select("id,slug,title,sales_site,learning_course_slug,lms_tenant,active,is_published,raw_data,drive_folder_id")
    .eq("slug", clean)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new LmsTenantError("COURSE_NOT_FOUND_IN_LMS", "Không tìm thấy khóa học trong site", 404);
  }
  return data;
}

export async function assertCourseInLmsTenant(supabase, slug, requestedTenant, options = {}) {
  const tenant = requireLmsTenant(requestedTenant);
  const course = await loadCourseBySlug(supabase, slug);
  const effectiveTenant = await resolveEffectiveLmsTenant(course, {
    findCourseBySlug: (target) => loadCourseBySlug(supabase, target)
  });
  if (effectiveTenant !== tenant) {
    throw new LmsTenantError("COURSE_LMS_TENANT_MISMATCH", "Khóa học không thuộc hệ thống đã chọn", 403, {
      requestedTenant: tenant,
      effectiveTenant,
      courseSlug: course.slug
    });
  }
  if (options.canonicalOnly && !isSelfTargetCourse(course)) {
    throw new LmsTenantError(
      "LEGACY_SHARED_MAPPING_READ_ONLY",
      "Liên kết dùng chung cũ chỉ được quản trị tại khóa học canonical",
      409
    );
  }
  return { course, requestedTenant: tenant, effectiveTenant };
}

export async function resolveCourseLmsTenant(supabase, slug) {
  const course = await loadCourseBySlug(supabase, slug);
  const effectiveTenant = await resolveEffectiveLmsTenant(course, {
    findCourseBySlug: (target) => loadCourseBySlug(supabase, target)
  });
  return { course, effectiveTenant };
}

export async function listCanonicalCoursesForTenant(supabase, requestedTenant) {
  const tenant = requireLmsTenant(requestedTenant);
  const { data, error } = await supabase
    .from("courses")
    .select("id,slug,title,sales_site,learning_course_slug,lms_tenant,active,is_published,raw_data,drive_folder_id")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const result = [];
  for (const row of rows) {
    if (!isSelfTargetCourse(row)) continue;
    const owner = await resolveEffectiveLmsTenant(row, {
      findCourseBySlug: async (slug) => bySlug.get(slug) || null
    });
    if (owner === tenant) result.push({ ...row, effective_lms_tenant: owner });
  }
  return result;
}

export function lmsTenantErrorResponse(res, error) {
  if (!(error instanceof LmsTenantError)) return false;
  res.status(error.status).json({
    success: false,
    code: error.code,
    error: error.message,
    ...error.details
  });
  return true;
}

export async function auditLmsTenantOperation(supabase, {
  adminEmail,
  action,
  courseSlug,
  selectedTenant,
  effectiveTenant,
  metadata = {}
}) {
  return writeAdminAuditLog(supabase, {
    adminEmail,
    action,
    metadata: {
      course_slug: cleanSlug(courseSlug),
      selected_lms_tenant: normalizeLmsTenant(selectedTenant),
      effective_lms_tenant: normalizeLmsTenant(effectiveTenant),
      ...metadata
    }
  });
}
import { writeAdminAuditLog } from "./lms-session-guard.js";
