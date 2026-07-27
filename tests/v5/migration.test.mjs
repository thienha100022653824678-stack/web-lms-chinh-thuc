import test from "node:test";
import assert from "node:assert/strict";
import { checksum, mapLessons, parseLooseArray, stableStringify } from "../../scripts/v5/migrate-lessons.mjs";

const batchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const lessons = [
  { id: "11111111-1111-4111-8111-111111111111", course_slug: "lop-a", course_title: "Lớp A", lesson_no: 1, title: "Chương 1", is_section: true },
  { id: "22222222-2222-4222-8222-222222222222", course_slug: "lop-a", lesson_no: 2, title: "Bài 1", content: "Nội dung", image_url: "https://res.cloudinary.com/demo/image/upload/a.jpg", media_urls: [{ url: "https://drive.google.com/file/d/x", caption: "Ảnh bổ sung" }], materials: [{ url: "https://drive.google.com/file/d/y", name: "Tài liệu.pdf" }] },
  { id: "33333333-3333-4333-8333-333333333333", course_slug: "lop-b", lesson_no: 1, title: "Bài B", video_url: "https://video.bunny.net/x.mp4" }
];

test("stable stringify sorts keys", () => assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}'));
test("checksum is sha256", () => assert.match(checksum({ a: 1 }), /^[a-f0-9]{64}$/));
test("loose array handles JSON", () => assert.deepEqual(parseLooseArray('["a","b"]'), ["a", "b"]));
test("loose array handles CSV", () => assert.deepEqual(parseLooseArray("a,b"), ["a", "b"]));
test("migration maps two courses", () => assert.equal(mapLessons(lessons, { batchId }).report.mapped_courses, 2));
test("migration maps section to topic and topic header", () => { const { output } = mapLessons(lessons, { batchId }); assert.equal(output.courses[0].topics.length, 1); assert.equal(output.courses[0].posts[0].post_type, "topic_header"); });
test("migration retains source identifiers and batch", () => { const post = mapLessons(lessons, { batchId }).output.courses[0].posts[1]; assert.equal(post.source_lesson_id, lessons[1].id); assert.equal(post.migration_batch_id, batchId); });
test("migration creates main, supplemental, document media in order", () => assert.deepEqual(mapLessons(lessons, { batchId }).output.courses[0].posts[1].media.map((m) => [m.position, m.media_type]), [[0, "image"], [1, "video"], [2, "document"]]));
test("migration maps captions", () => assert.equal(mapLessons(lessons, { batchId }).report.caption_mapping[0].caption, "Ảnh bổ sung"));
test("migration output is idempotent for fixed batch", () => { const a = mapLessons(lessons, { batchId }); const b = mapLessons(lessons, { batchId }); assert.equal(a.report.output_checksum, b.report.output_checksum); assert.deepEqual(a.output, b.output); });
test("migration detects duplicate source lesson", () => assert.deepEqual(mapLessons([...lessons, lessons[1]], { batchId }).report.duplicates, [lessons[1].id]));
test("migration never marks posts published", () => assert.equal(mapLessons(lessons, { batchId }).output.courses.every((c) => c.posts.every((p) => p.status === "draft")), true));

