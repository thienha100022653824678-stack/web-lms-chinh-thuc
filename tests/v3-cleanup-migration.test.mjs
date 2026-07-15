// tests/v3-cleanup-migration.test.mjs
// V3 Phase 10 (⑧) — static assertions on migration_v3_formalize_drift_columns.sql.
// Owner-applied; no DB. Assert additive-only + every VERIFIED drift column is
// declared (so the schema becomes an honest source of truth).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "..", "migration_v3_formalize_drift_columns.sql"),
  "utf8"
);
const EXEC_SQL = SQL.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("migration is additive-only (no DROP/RENAME/ALTER TYPE/TRUNCATE/DELETE/ALTER COLUMN ... DROP)", () => {
  for (const forbidden of [/\bDROP\b/i, /\bRENAME\b/i, /ALTER\s+TYPE/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /DROP\s+COLUMN/i]) {
    assert.equal(forbidden.test(EXEC_SQL), false, `must not contain ${forbidden}`);
  }
});

test("wraps in a transaction + uses ADD COLUMN IF NOT EXISTS", () => {
  assert.match(SQL, /^\s*BEGIN;/m);
  assert.match(SQL, /COMMIT;\s*$/m);
  assert.match(EXEC_SQL, /ADD COLUMN IF NOT EXISTS/);
});

test("declares the VERIFIED lessons drift columns", () => {
  assert.match(SQL, /ALTER TABLE public\.lessons ADD COLUMN IF NOT EXISTS is_section/i);
  assert.match(SQL, /ALTER TABLE public\.lessons ADD COLUMN IF NOT EXISTS materials/i);
  assert.match(SQL, /ALTER TABLE public\.lessons ADD COLUMN IF NOT EXISTS kind/i);
  assert.match(SQL, /ALTER TABLE public\.lessons ADD COLUMN IF NOT EXISTS parent_section_id/i);
  assert.match(SQL, /ALTER TABLE public\.lessons ADD COLUMN IF NOT EXISTS position/i);
});

test("declares the VERIFIED courses drift columns (incl sync_*)", () => {
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS is_published/i);
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS expected_start_date/i);
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS drive_folder_id/i);
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS drive_permission_mode/i);
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS sync_lms_status/i);
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS sync_portal_status/i);
  assert.match(SQL, /ALTER TABLE public\.courses ADD COLUMN IF NOT EXISTS sync_error/i);
});

test("declares the VERIFIED orders + student_enrollments identity columns", () => {
  assert.match(SQL, /ALTER TABLE public\.orders ADD COLUMN IF NOT EXISTS course_id/i);
  assert.match(SQL, /ALTER TABLE public\.orders ADD COLUMN IF NOT EXISTS normalized_customer_email/i);
  assert.match(SQL, /ALTER TABLE public\.orders ADD COLUMN IF NOT EXISTS sync_correlation_id/i);
  assert.match(SQL, /ALTER TABLE public\.orders ADD COLUMN IF NOT EXISTS source_system/i);
  assert.match(SQL, /ALTER TABLE public\.student_enrollments ADD COLUMN IF NOT EXISTS normalized_email/i);
  assert.match(SQL, /ALTER TABLE public\.student_enrollments ADD COLUMN IF NOT EXISTS sync_correlation_id/i);
  assert.match(SQL, /ALTER TABLE public\.student_enrollments ADD COLUMN IF NOT EXISTS source_system/i);
});
