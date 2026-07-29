import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  LearningSiteError,
  isLmsAdminMultiSiteEnabled,
  requireLearningSite,
  resolveEffectiveLearningSite
} from "../utils/learning-site.js";

const canonicalA = {
  id: "a",
  slug: "course-a",
  sales_site: null,
  learning_course_slug: null,
  learning_site: null
};
const canonicalB = {
  id: "b",
  slug: "course-b",
  sales_site: "yeubep",
  learning_course_slug: null,
  learning_site: null
};
const legacyAlias = {
  id: "alias",
  slug: "course-a-yeubep",
  sales_site: "yeubep",
  learning_course_slug: "course-a",
  learning_site: null
};

test("feature flag defaults off and enables only explicit true", () => {
  assert.equal(isLmsAdminMultiSiteEnabled({}), false);
  assert.equal(isLmsAdminMultiSiteEnabled({ LMS_ADMIN_MULTI_SITE_ENABLED: "true" }), true);
});

test("learning site allowlist rejects forged, missing and invalid values", () => {
  assert.throws(() => requireLearningSite(), (err) => err.code === "INVALID_LEARNING_SITE");
  assert.throws(() => requireLearningSite("attacker"), (err) => err.code === "INVALID_LEARNING_SITE");
  assert.equal(requireLearningSite("yeubep"), "yeubep");
});

test("legacy self-target fallback and explicit sites resolve deterministically", async () => {
  assert.equal(await resolveEffectiveLearningSite(canonicalA), "yeunauan");
  assert.equal(await resolveEffectiveLearningSite(canonicalB), "yeubep");
  assert.equal(await resolveEffectiveLearningSite({ ...canonicalA, learning_site: "yeubep" }), "yeubep");
});

test("legacy shared alias resolves to canonical owner and remains distinguishable", async () => {
  const site = await resolveEffectiveLearningSite(legacyAlias, {
    findCourseBySlug: async (slug) => slug === canonicalA.slug ? canonicalA : null
  });
  assert.equal(site, "yeunauan");
});

test("missing, chained and invalid targets fail closed", async () => {
  await assert.rejects(
    resolveEffectiveLearningSite(legacyAlias, { findCourseBySlug: async () => null }),
    (err) => err instanceof LearningSiteError && err.code === "UNRESOLVED_LEARNING_SITE"
  );
  await assert.rejects(
    resolveEffectiveLearningSite(legacyAlias, {
      findCourseBySlug: async () => ({ ...canonicalA, learning_course_slug: "third" })
    }),
    (err) => err.code === "UNRESOLVED_LEARNING_SITE"
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
    assert.match(source, /isLmsAdminMultiSiteEnabled/);
    assert.match(source, /learningSiteErrorResponse/);
  }
});

test("lesson, enrollment and Drive mutations write selected/effective site audit metadata", () => {
  for (const name of ["admin-lessons.js", "admin-enrollments.js", "admin-drive-permission.js"]) {
    const source = fs.readFileSync(new URL(`../utils/lms-handlers/${name}`, import.meta.url), "utf8");
    assert.match(source, /auditLearningSiteOperation/);
  }
  const helper = fs.readFileSync(new URL("../utils/learning-site.js", import.meta.url), "utf8");
  assert.match(helper, /selected_learning_site/);
  assert.match(helper, /effective_learning_site/);
});

test("selector supports storage, deep links, empty state and global badges", () => {
  const html = fs.readFileSync(new URL("../lms-admin.html", import.meta.url), "utf8");
  assert.match(html, /HỆ THỐNG QUẢN TRỊ/);
  assert.match(html, /localStorage\.getItem\("lmsAdminLearningSite"\)/);
  assert.match(html, /URLSearchParams\(location\.search\)\.get\("site"\)/);
  assert.match(html, /URLSearchParams\(location\.search\)\.get\("course"\)/);
  assert.match(html, /chưa có khóa học LMS/);
  assert.match(html, /TOÀN HỆ THỐNG/);
  assert.match(html, /X-Learning-Site/);
  assert.match(html, /legacySharedMappings/);
  const coursesHandler = fs.readFileSync(new URL("../utils/lms-handlers/admin-courses.js", import.meta.url), "utf8");
  assert.match(coursesHandler, /read_only:\s*true/);
});
