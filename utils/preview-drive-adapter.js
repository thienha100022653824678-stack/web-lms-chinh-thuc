import { assertCourseInLmsTenant, auditLmsTenantOperation, requestLmsTenant } from "./lms-tenant.js";
import { assertLmsPreviewRuntime } from "./preview-runtime.js";

const ACTIONS = new Set([
  "upload_image", "upload_recipe", "upload_material", "upload_video",
  "verify_media", "sync_permissions", "repair", "retry", "direct_permission"
]);

export function isPreviewDriveDryRun() {
  return process.env.LMS_PREVIEW_DRIVE_DRY_RUN === "1";
}

export async function handlePreviewDriveDryRun({
  req, res, supabase, adminEmail, courseSlug, action, email = ""
}) {
  if (!isPreviewDriveDryRun()) return false;
  assertLmsPreviewRuntime();
  if (!ACTIONS.has(action)) throw new Error("INVALID_PREVIEW_DRIVE_ACTION");
  const selectedTenant = requestLmsTenant(req);
  const verified = await assertCourseInLmsTenant(
    supabase, String(courseSlug || "").trim(), selectedTenant, { canonicalOnly: true }
  );
  const normalizedEmail = String(email || "drive-student.preview@example.test").trim().toLowerCase();
  if (!normalizedEmail.endsWith("@example.test")) {
    const error = new Error("PREVIEW_IDENTITY_REQUIRED");
    error.status = 400;
    throw error;
  }
  await supabase.from("drive_permission_logs").insert({
    course_slug: verified.course.slug,
    folder_id: `dry-run:${verified.course.slug}`,
    email: normalizedEmail,
    student_email: normalizedEmail,
    action,
    status: "dry_run",
    message: "Preview adapter: no Google Drive request was made",
    drive_admin_email: "drive-adapter.preview@example.test"
  });
  await auditLmsTenantOperation(supabase, {
    adminEmail,
    action: `lms_dual_drive_${action}`,
    courseSlug: verified.course.slug,
    selectedTenant,
    effectiveTenant: verified.effectiveTenant,
    metadata: { preview_drive_dry_run: true }
  });
  res.status(200).json({
    success: true,
    dryRun: true,
    action,
    courseSlug: verified.course.slug,
    lms_tenant: verified.effectiveTenant,
    resource: `https://media.example.test/${verified.course.slug}/${action}`
  });
  return true;
}
