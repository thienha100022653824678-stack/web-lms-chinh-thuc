import { assertCourseInLearningSite, auditLearningSiteOperation, requestLearningSite } from "./learning-site.js";
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
  const selectedSite = requestLearningSite(req);
  const verified = await assertCourseInLearningSite(
    supabase, String(courseSlug || "").trim(), selectedSite, { canonicalOnly: true }
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
  await auditLearningSiteOperation(supabase, {
    adminEmail,
    action: `lms_multisite_drive_${action}`,
    courseSlug: verified.course.slug,
    selectedSite,
    effectiveSite: verified.effectiveSite,
    metadata: { preview_drive_dry_run: true }
  });
  res.status(200).json({
    success: true,
    dryRun: true,
    action,
    courseSlug: verified.course.slug,
    learning_site: verified.effectiveSite,
    resource: `https://media.example.test/${verified.course.slug}/${action}`
  });
  return true;
}
