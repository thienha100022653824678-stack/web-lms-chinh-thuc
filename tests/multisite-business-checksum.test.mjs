import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUSINESS_COLUMN_ALLOWLIST,
  businessDataChecksum,
  businessTableCounts
} from "../scripts/lib/multisite-business-checksum.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  return {
    courses: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "preview-course-a",
        title: "Course A",
        subtitle: null,
        price: "100",
        image_url: null,
        description: "Description A",
        teacher_name: "Teacher",
        active: true,
        sort_order: 1,
        raw_data: { z: 2, a: 1 },
        sync_lms_status: "synced",
        sync_portal_status: null,
        sync_error: null,
        is_published: false,
        drive_folder_id: null,
        drive_permission_mode: null,
        expected_start_date: "2026-08-01",
        sales_site: "yeunauan",
        learning_course_slug: "preview-course-a",
        learning_site: null,
        created_at: "unstable",
        updated_at: "unstable"
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        slug: "preview-course-b",
        title: "Course B",
        active: false,
        sort_order: 2,
        raw_data: null,
        sales_site: "yeubep",
        learning_course_slug: "preview-course-b",
        learning_site: null
      }
    ],
    lessons: [{
      id: "10000000-0000-4000-8000-000000000001",
      course_id: "00000000-0000-4000-8000-000000000001",
      course_slug: "preview-course-a",
      lesson_no: 1,
      title: "Lesson",
      raw_data: { b: 2, a: 1 },
      active: true,
      sort_order: 1
    }],
    student_enrollments: [{
      id: "20000000-0000-4000-8000-000000000001",
      student_id: null,
      course_id: "00000000-0000-4000-8000-000000000001",
      course_slug: "preview-course-a",
      email: "synthetic@example.test",
      status: "active"
    }],
    lesson_progress: [{
      id: "30000000-0000-4000-8000-000000000001",
      email: "synthetic@example.test",
      course_slug: "preview-course-a",
      lesson_id: "10000000-0000-4000-8000-000000000001",
      progress_percent: 50,
      completed: false
    }],
    site_config: [{ key: "course_preview-course-a_title", value: { title: "Display A" } }]
  };
}

function clone(value) {
  return structuredClone(value);
}

function duplicateSlugs(rows) {
  return rows.length - new Set(rows.map((row) => row.slug)).size;
}

function unresolvedMappings(rows) {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return rows.filter((row) => !bySlug.has(row.learning_course_slug || row.slug)).length;
}

test("nullable learning_site schema addition leaves business checksum unchanged", () => {
  const before = fixture();
  const after = clone(before);
  for (const row of after.courses) row.learning_site = null;
  assert.equal(businessDataChecksum(before), businessDataChecksum(after));
});

test("title mutation changes business checksum", () => {
  const before = fixture();
  const after = clone(before);
  after.courses[0].title = "Mutated";
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(after));
});

test("slug mutation changes checksum and collision invariant detects duplicate", () => {
  const before = fixture();
  const after = clone(before);
  after.courses[0].slug = after.courses[1].slug;
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(after));
  assert.equal(duplicateSlugs(after.courses), 1);
});

test("sales_site mutation changes checksum", () => {
  const before = fixture();
  const after = clone(before);
  after.courses[0].sales_site = "yeubep";
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(after));
});

test("learning_course_slug mutation changes checksum and resolver invariant fails", () => {
  const before = fixture();
  const after = clone(before);
  after.courses[0].learning_course_slug = "missing-target";
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(after));
  assert.equal(unresolvedMappings(after.courses), 1);
});

test("adding and deleting a business row changes counts and checksum", () => {
  const before = fixture();
  const added = clone(before);
  added.courses.push({ ...clone(before.courses[0]), id: "00000000-0000-4000-8000-000000000003", slug: "preview-course-c" });
  assert.notDeepEqual(businessTableCounts(before), businessTableCounts(added));
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(added));

  const deleted = clone(before);
  deleted.lessons.pop();
  assert.notDeepEqual(businessTableCounts(before), businessTableCounts(deleted));
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(deleted));
});

test("query column order cannot change canonical checksum", () => {
  const rows = fixture();
  const reversed = Object.fromEntries(
    Object.entries(BUSINESS_COLUMN_ALLOWLIST).map(([table, columns]) => [table, [...columns].reverse()])
  );
  assert.equal(businessDataChecksum(rows), businessDataChecksum(rows, reversed));
});

test("timestamps and nullable learning_site are excluded from business checksum", () => {
  const before = fixture();
  const after = clone(before);
  after.courses[0].created_at = "different";
  after.courses[0].updated_at = "different";
  after.courses[0].learning_site = null;
  assert.equal(businessDataChecksum(before), businessDataChecksum(after));
});

test("unexpected explicit learning_site fails the independent new-column invariant", () => {
  for (const value of ["yeunauan", "yeubep"]) {
    const rows = fixture();
    rows.courses[0].learning_site = value;
    const nonNull = rows.courses.filter((row) => row.learning_site !== null).length;
    assert.equal(nonNull, 1);
    assert.equal(businessDataChecksum(rows), businessDataChecksum(fixture()));
  }
});

test("raw_data key order is canonical while value mutation is detected", () => {
  const before = fixture();
  const reordered = clone(before);
  reordered.courses[0].raw_data = { a: 1, z: 2 };
  assert.equal(businessDataChecksum(before), businessDataChecksum(reordered));
  reordered.courses[0].raw_data.z = 3;
  assert.notEqual(businessDataChecksum(before), businessDataChecksum(reordered));
});

test("Production verification SQL forbids whole-row checksums and exposes split outputs", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "docs/multisite/sql/PRODUCTION_VERIFICATION_READ_ONLY.sql"),
    "utf8"
  );
  const executableSql = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(executableSql, /\bSELECT\s+\*/i);
  assert.doesNotMatch(executableSql, /row_to_json\s*\([^)]*\.\*/i);
  assert.doesNotMatch(executableSql, /to_jsonb\s*\([^)]*\.\*/i);
  for (const output of [
    "BUSINESS_DATA_CHECKSUM_AFTER", "SCHEMA_CHECKSUM_AFTER",
    "EXPECTED_SCHEMA_DELTA_MATCH", "LEARNING_SITE_NULL_COUNT",
    "LEARNING_SITE_NON_NULL_COUNT", "INVALID_LEARNING_SITE_COUNT"
  ]) assert.match(sql, new RegExp(output));
});

test("courses allowlist is exact pre-migration business schema and excludes volatile/new fields", () => {
  assert.deepEqual(BUSINESS_COLUMN_ALLOWLIST.courses, [
    "id", "slug", "title", "subtitle", "price", "image_url", "description",
    "teacher_name", "active", "sort_order", "raw_data", "sync_lms_status",
    "sync_portal_status", "sync_error", "is_published", "drive_folder_id",
    "drive_permission_mode", "expected_start_date", "sales_site",
    "learning_course_slug"
  ]);
  assert.equal(BUSINESS_COLUMN_ALLOWLIST.courses.includes("learning_site"), false);
  assert.equal(BUSINESS_COLUMN_ALLOWLIST.courses.includes("created_at"), false);
  assert.equal(BUSINESS_COLUMN_ALLOWLIST.courses.includes("updated_at"), false);
});
