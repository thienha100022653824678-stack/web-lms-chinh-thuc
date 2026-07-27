import test from "node:test";
import assert from "node:assert/strict";
import {
  POST_TYPES, TRANSITIONS, applyFeedCursor, assertTransition, canonicalChecksum,
  normalizeCourseSlug, parseCursor, parseLimit, sanitizeText, validateMedia, validatePostInput
} from "../../utils/v5/core.js";

test("course slug accepts canonical values", () => assert.equal(normalizeCourseSlug("  Khoa-Hoc_01 "), "khoa-hoc_01"));
for (const bad of ["", "../admin", "space slug", "a/", "á"]) test(`course slug rejects ${JSON.stringify(bad)}`, () => assert.equal(normalizeCourseSlug(bad), ""));
test("cursor accepts positive integer", () => assert.equal(parseCursor("42"), 42));
for (const bad of ["0", "-1", "1.5", "x", "9007199254740992"]) test(`cursor rejects ${bad}`, () => assert.throws(() => parseCursor(bad), { code: "invalid_cursor" }));
test("limit defaults to 24", () => assert.equal(parseLimit(undefined), 24));
for (const value of [1, 24, 50]) test(`limit accepts ${value}`, () => assert.equal(parseLimit(value), value));
for (const value of [0, 51, 1.2]) test(`limit rejects ${value}`, () => assert.throws(() => parseLimit(value), { code: "invalid_limit" }));
test("sanitization strips executable and markup tags", () => assert.equal(sanitizeText("<script>alert(1)</script><b>Xin chào</b>"), "Xin chào"));
test("sanitization removes null and normalizes line endings", () => assert.equal(sanitizeText(" a\u0000\r\nb "), "a\nb"));
for (const type of POST_TYPES) test(`post type ${type} validates`, () => assert.equal(validatePostInput({ post_type: type, body_text: "ok" }).post_type, type));
test("unknown post type is rejected", () => assert.throws(() => validatePostInput({ post_type: "iframe", body_text: "" }), { code: "invalid_post_type" }));
test("media ordering is rewritten from array position", () => assert.deepEqual(validatePostInput({ post_type: "image_album", body_text: "", media: [{ media_type: "image", url: "https://example.test/a.jpg", position: 99 }, { media_type: "image", url: "https://example.test/b.jpg", position: 88 }] }).media.map((m) => m.position), [0, 1]));
test("media blocks insecure URL", () => assert.throws(() => validateMedia({ media_type: "image", url: "http://example.test/a.jpg" }), { code: "invalid_media_url" }));
test("media permits local fixture URL", () => assert.equal(validateMedia({ media_type: "document", url: "/fixtures/a.txt" }).url, "/fixtures/a.txt"));
test("media limits album to 20", () => assert.throws(() => validatePostInput({ post_type: "image_album", body_text: "", media: Array.from({ length: 21 }, () => ({ media_type: "image", url: "https://example.test/a.jpg" })) }), { code: "invalid_media" }));
for (const [from, targets] of Object.entries(TRANSITIONS)) for (const target of targets) test(`transition ${from}->${target}`, () => assert.equal(assertTransition(from, target), true));
test("invalid transition published->draft blocked", () => assert.throws(() => assertTransition("published", "draft"), { code: "invalid_status_transition" }));
test("checksum ignores object key insertion order", () => assert.equal(canonicalChecksum({ b: 2, a: 1 }), canonicalChecksum({ a: 1, b: 2 })));
test("checksum changes with content", () => assert.notEqual(canonicalChecksum({ a: 1 }), canonicalChecksum({ a: 2 })));

const feed = Array.from({ length: 100 }, (_, i) => ({ id: `p${i + 1}`, sequence_no: i + 1, status: i === 4 ? "draft" : "published", topic_id: i % 2 ? "a" : "b", body_text: `Bài ${i + 1}`, pinned_at: i === 8 ? "now" : null }));
test("feed first page has 24 and descending cursor order", () => { const page = applyFeedCursor(feed, {}); assert.equal(page.rows.length, 24); assert.equal(page.rows[0].sequence_no, 100); });
test("feed before cursor excludes cursor", () => assert.equal(applyFeedCursor(feed, { before_sequence: 50, limit: 10 }).rows[0].sequence_no, 49));
test("feed after cursor returns ascending newer rows", () => assert.deepEqual(applyFeedCursor(feed, { after_sequence: 95, limit: 5 }).rows.map((p) => p.sequence_no), [96, 97, 98, 99, 100]));
test("feed excludes drafts", () => assert.equal(applyFeedCursor(feed, { before_sequence: 7, limit: 10 }).rows.some((p) => p.sequence_no === 5), false));
test("feed filters topic", () => assert.equal(applyFeedCursor(feed, { topic_id: "a", limit: 50 }).rows.every((p) => p.topic_id === "a"), true));
test("feed filters pinned", () => assert.deepEqual(applyFeedCursor(feed, { pinned: "true" }).rows.map((p) => p.sequence_no), [9]));
test("feed search filters body", () => assert.deepEqual(applyFeedCursor(feed, { search: "Bài 100" }).rows.map((p) => p.sequence_no), [100]));
test("feed rejects offset", () => assert.throws(() => applyFeedCursor(feed, { offset: 1 }), { code: "offset_not_supported" }));
test("feed rejects dual cursor", () => assert.throws(() => applyFeedCursor(feed, { before_sequence: 10, after_sequence: 5 }), { code: "ambiguous_cursor" }));

