import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  LmsTenantError,
  isLmsDualSystemEnabled,
  requireLmsTenant,
  resolveEffectiveLmsTenant
} from "../utils/lms-tenant.js";

const canonicalA = {
  id: "a",
  slug: "course-a",
  sales_site: null,
  learning_course_slug: null,
  lms_tenant: null
};
const canonicalB = {
  id: "b",
  slug: "course-b",
  sales_site: "yeubep",
  learning_course_slug: null,
  lms_tenant: null
};
const legacyAlias = {
  id: "alias",
  slug: "course-a-yeubep",
  sales_site: "yeubep",
  learning_course_slug: "course-a",
  lms_tenant: null
};

test("feature flag defaults off and enables only explicit true", () => {
  assert.equal(isLmsDualSystemEnabled({}), false);
  assert.equal(isLmsDualSystemEnabled({ LMS_DUAL_SYSTEM_ENABLED: "true" }), true);
});

test("LMS tenant allowlist rejects forged, missing and invalid values", () => {
  assert.throws(() => requireLmsTenant(), (err) => err.code === "INVALID_LMS_TENANT");
  assert.throws(() => requireLmsTenant("attacker"), (err) => err.code === "INVALID_LMS_TENANT");
  assert.equal(requireLmsTenant("yeubep"), "yeubep");
});

test("legacy self-target fallback and explicit sites resolve deterministically", async () => {
  assert.equal(await resolveEffectiveLmsTenant(canonicalA), "yeunauan");
  assert.equal(await resolveEffectiveLmsTenant(canonicalB), "yeubep");
  assert.equal(await resolveEffectiveLmsTenant({ ...canonicalA, lms_tenant: "yeubep" }), "yeubep");
});

test("legacy shared alias resolves to canonical owner and remains distinguishable", async () => {
  const site = await resolveEffectiveLmsTenant(legacyAlias, {
    findCourseBySlug: async (slug) => slug === canonicalA.slug ? canonicalA : null
  });
  assert.equal(site, "yeunauan");
});

test("missing, chained and invalid targets fail closed", async () => {
  await assert.rejects(
    resolveEffectiveLmsTenant(legacyAlias, { findCourseBySlug: async () => null }),
    (err) => err instanceof LmsTenantError && err.code === "UNRESOLVED_LMS_TENANT"
  );
  await assert.rejects(
    resolveEffectiveLmsTenant(legacyAlias, {
      findCourseBySlug: async () => ({ ...canonicalA, learning_course_slug: "third" })
    }),
    (err) => err.code === "UNRESOLVED_LMS_TENANT"
  );
});

test("course-dependent handlers enforce server-side scope", () => {
  const handlers = [
    "admin-courses.js",
    "admin-lessons.js",
    "admin-enrollments.js",
    "admin-bulk-enroll.js",
    "admin-drive-permission.js",
    "admin-drive-retry.js",
    "admin-sync-drive-permissions.js",
    "admin-repair-drive.js",
    "admin-upload-image.js",
    "admin-upload-material.js",
    "admin-upload-gdrive-video.js",
    "admin-upload-recipe.js",
    "admin-verify-media.js"
  ];
  for (const name of handlers) {
    const source = fs.readFileSync(new URL(`../utils/lms-handlers/${name}`, import.meta.url), "utf8");
    assert.match(source, /isLmsDualSystemEnabled/);
    assert.match(source, /lmsTenantErrorResponse/);
  }
});

test("lesson, enrollment and Drive mutations write selected/effective site audit metadata", () => {
  for (const name of [
    "admin-lessons.js", "admin-enrollments.js", "admin-drive-permission.js",
    "admin-drive-retry.js", "admin-sync-drive-permissions.js", "admin-repair-drive.js",
    "admin-upload-image.js", "admin-upload-material.js", "admin-upload-gdrive-video.js",
    "admin-upload-recipe.js", "admin-verify-media.js"
  ]) {
    const source = fs.readFileSync(new URL(`../utils/lms-handlers/${name}`, import.meta.url), "utf8");
    assert.match(source, /auditLmsTenantOperation/);
  }
  const helper = fs.readFileSync(new URL("../utils/lms-tenant.js", import.meta.url), "utf8");
  assert.match(helper, /selected_lms_tenant/);
  assert.match(helper, /effective_lms_tenant/);
});

test("student entry and content resolve tenant from the server-bound canonical course", () => {
  for (const name of ["verify-entry-token.js", "course-data.js", "lesson.js"]) {
    const source = fs.readFileSync(new URL(`../utils/lms-handlers/${name}`, import.meta.url), "utf8");
    assert.match(source, /resolveCourseLmsTenant/);
    assert.match(source, /effectiveTenant/);
  }
  const legacyLogin = fs.readFileSync(new URL("../utils/lms-handlers/exchange-code.js", import.meta.url), "utf8");
  assert.match(legacyLogin, /isV2GlobalOneDeviceEnabled\(\) \|\| isLmsDualSystemEnabled\(\)/);
});

test("student identity stays global while lists derive visibility from tenant enrollments", () => {
  const students = fs.readFileSync(new URL("../utils/lms-handlers/admin-students.js", import.meta.url), "utf8");
  assert.match(students, /listCanonicalCoursesForTenant/);
  assert.match(students, /student_enrollments/);
  assert.match(students, /\.in\("email", emails\)/);
  assert.doesNotMatch(students, /students[\s\S]{0,80}lms_tenant/);
});

test("mixed-LMS Drive retry is rejected before any global batch query", () => {
  const source = fs.readFileSync(new URL("../utils/lms-handlers/admin-drive-retry.js", import.meta.url), "utf8");
  const rejection = source.indexOf("MIXED_LMS_BATCH_FORBIDDEN");
  const previewAdapter = source.indexOf("handlePreviewDriveDryRun");
  const adapterCall = source.indexOf("await handlePreviewDriveDryRun", previewAdapter + 1);
  const globalQuery = source.indexOf('if (type === "all")', rejection + 1);
  assert.ok(rejection > 0 && globalQuery > rejection && adapterCall > rejection);
});

test("selector supports storage, deep links, empty state and global badges", () => {
  const html = fs.readFileSync(new URL("../lms-admin.html", import.meta.url), "utf8");
  assert.match(html, /HỆ THỐNG QUẢN TRỊ/);
  assert.match(html, /localStorage\.getItem\("lmsAdminTenant"\)/);
  assert.match(html, /URLSearchParams\(location\.search\)\.get\("lms"\)/);
  assert.match(html, /URLSearchParams\(location\.search\)\.get\("course"\)/);
  assert.match(html, /chưa có khóa học LMS/);
  assert.match(html, /TOÀN HỆ THỐNG/);
  assert.match(html, /X-LMS-Tenant/);
  assert.match(html, /legacySharedMappings/);
  const coursesHandler = fs.readFileSync(new URL("../utils/lms-handlers/admin-courses.js", import.meta.url), "utf8");
  assert.match(coursesHandler, /read_only:\s*true/);
});
