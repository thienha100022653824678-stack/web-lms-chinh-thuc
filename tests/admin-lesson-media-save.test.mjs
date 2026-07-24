import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminPage = readFileSync(join(ROOT, "lms-admin.html"), "utf8");
const handler = readFileSync(join(ROOT, "utils", "lms-handlers", "admin-lessons.js"), "utf8");

test("editor preserves the lesson UUID from loaded row through update payload", () => {
  assert.match(adminPage, /originalLessonId:\s*""/);
  assert.match(adminPage, /STATE\.originalLessonId\s*=\s*l\.id\s*\|\|\s*""/);
  assert.match(
    adminPage,
    /originalLessonId:\s*STATE\.isEditMode\s*\?\s*STATE\.originalLessonId\s*:\s*undefined/
  );
});

test("backend updates by UUID and rejects zero or ambiguous matches", () => {
  assert.match(handler, /query\s*=\s*query\.eq\("id",\s*String\(originalLessonId\)\.trim\(\)\)/);
  assert.match(
    handler,
    /select\("id, course_slug, lesson_no, video_url, thumbnail_url, updated_at"\)/
  );
  assert.match(handler, /updatedRows\.length\s*!==\s*1/);
  assert.match(handler, /lesson_update_no_match/);
  assert.match(handler, /lesson_update_ambiguous/);
});

test("success response returns the persisted media row for client verification", () => {
  assert.match(handler, /matchedCount:\s*1/);
  assert.match(handler, /videoUrl:\s*savedRow\.video_url\s*\|\|\s*""/);
  assert.match(adminPage, /savedVideoUrl\s*!==\s*expectedVideoUrl/);
  assert.match(adminPage, /refreshedVideoUrl\s*!==\s*expectedVideoUrl/);

  const responseCheck = adminPage.indexOf("database verification mismatch");
  const reloadCheck = adminPage.indexOf("read-after-write mismatch");
  const successToast = adminPage.indexOf(
    'toast(payload.action === "update" ? "Cập nhật bài học thành công!"'
  );
  assert.ok(responseCheck >= 0);
  assert.ok(reloadCheck > responseCheck);
  assert.ok(successToast > reloadCheck, "success toast must happen only after both DB checks");
});

test("admin and student reads explicitly bypass browser HTTP caches", () => {
  assert.match(
    adminPage,
    /endpoint=lessons&course=\$\{encodeURIComponent\(course\)\}[\s\S]*?cache:\s*"no-store"/
  );
  const lessonPage = readFileSync(join(ROOT, "lesson.html"), "utf8");
  assert.match(
    lessonPage,
    /endpoint=lesson&id=\$\{encodeURIComponent\(lessonId\)\}[\s\S]*?cache:\s*"no-store"/
  );
});
