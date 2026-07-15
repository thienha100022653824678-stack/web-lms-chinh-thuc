// tests/v3-rls-migration.test.mjs
// V3 Phase 2 (①) — static assertions on migration_v3_rls_policies.sql.
// No DB: the migration is owner-applied. We assert it is additive-only and
// contains the expected policies + the RPC security-mode hardening.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "..", "migration_v3_rls_policies.sql"),
  "utf8"
);

// Executable SQL only — strip `--` line comments so prose in the header
// ("No DROP / RENAME") doesn't trip the destructive-DDL scan.
const EXEC_SQL = SQL.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("migration is additive-only (no DROP/RENAME/ALTER TYPE/TRUNCATE)", () => {
  // Forbid destructive DDL. ALTER FUNCTION ... SECURITY DEFINER is additive and allowed.
  for (const forbidden of [/\bDROP\b/i, /\bRENAME\b/i, /ALTER\s+TYPE/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i]) {
    assert.equal(forbidden.test(EXEC_SQL), false, `must not contain ${forbidden}`);
  }
});

test("wraps changes in a transaction", () => {
  assert.match(SQL, /^\s*BEGIN;/m);
  assert.match(SQL, /COMMIT;\s*$/m);
});

test("creates the anon public-read policies", () => {
  assert.match(SQL, /CREATE POLICY v3_anon_read_active_courses ON public\.courses/);
  assert.match(SQL, /CREATE POLICY v3_anon_read_free_lessons ON public\.lessons/);
  assert.match(SQL, /FOR SELECT TO anon/);
});

test("creates authenticated own-row policies scoped by auth.email()", () => {
  assert.match(SQL, /CREATE POLICY v3_auth_read_own_enrollments ON public\.student_enrollments/);
  assert.match(SQL, /CREATE POLICY v3_auth_update_own_progress ON public\.lesson_progress/);
  assert.match(SQL, /lower\(email\) = lower\(auth\.email\(\)\)/);
  assert.match(SQL, /WITH CHECK/);
});

test("policies are guarded idempotent (pg_policies existence check)", () => {
  assert.match(SQL, /IF NOT EXISTS \(SELECT 1 FROM pg_policies/);
});

test("normalizes handle_student_session_login to SECURITY DEFINER + pinned search_path", () => {
  assert.match(SQL, /ALTER FUNCTION public\.handle_student_session_login[\s\S]*SECURITY DEFINER/);
  assert.match(SQL, /SET search_path = public/);
});

test("does not add a policy for service_role (it bypasses RLS; V1/V2 unaffected)", () => {
  assert.equal(/TO service_role/.test(SQL), false);
});
