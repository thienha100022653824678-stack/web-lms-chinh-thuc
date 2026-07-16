// tests/v3-session-login-grants.test.mjs
// Static assertions on migration_handle_student_session_login_grants.sql.
//
// This migration is the EXECUTE-privilege layer for handle_student_session_login:
//   REVOKE ALL FROM PUBLIC / anon / authenticated
//   GRANT EXECUTE TO service_role
// It does NOT touch the function body or signature, and it does NOT change the
// security mode (SECURITY DEFINER normalization lives in migration_v3_rls_policies.sql,
// a separate owner-applied migration). No DB: the migration is owner-applied; we
// assert it is privilege-only, idempotent, transactional, and architecturally sound.
//
// Context (VERIFIED 2026-07-15, docs/V3_SCHEMA_GAP_SQL_RESULTS.md Block 4d):
// production already shows public/anon/authenticated EXECUTE=false, service_role=true
// — i.e. this hardening is already applied on prod. These tests guard the file so a
// future edit cannot silently widen the grants or touch the function body.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "..", "migration_handle_student_session_login_grants_hardening.sql"),
  "utf8"
);

// Executable SQL only — strip `--` line comments so header prose (which mentions
// "GRANT"/"EXECUTE" in explanation) doesn't skew the structural assertions.
const EXEC_SQL = SQL.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("wraps changes in a transaction", () => {
  assert.match(SQL, /^\s*BEGIN;/m);
  assert.match(SQL, /COMMIT;\s*$/m);
});

test("is privilege-only — no destructive DDL and no body/signature change", () => {
  // The migration must not rewrite the function or change schema structure.
  for (const forbidden of [
    /\bDROP\b/i,
    /\bRENAME\b/i,
    /ALTER\s+TYPE/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION/i,
    /ALTER\s+FUNCTION/i,
    /\$\$/, // a function body would appear between $$ ... $$ — none here
  ]) {
    assert.equal(forbidden.test(EXEC_SQL), false, `must not contain ${forbidden}`);
  }
});

test("revokes EXECUTE from PUBLIC, anon, and authenticated", () => {
  // Match REVOKE ... ON FUNCTION public.handle_student_session_login(...) FROM <role>
  // across the multi-line argument list.
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    const re = new RegExp(
      `REVOKE\\s+\\w+\\s+ON\\s+FUNCTION\\s+public\\.handle_student_session_login[\\s\\S]*?FROM\\s+${role}\\s*;`,
      "i"
    );
    assert.match(EXEC_SQL, re, `must REVOKE from ${role}`);
  }
});

test("grants EXECUTE only to service_role (matches server-only write path)", () => {
  // The login RPC is called server-side via the service_role tier only
  // (utils/v3-write-path.js: role = 'service_role'). anon/authenticated must NOT
  // receive EXECUTE — a browser must never mint a session directly.
  assert.match(
    EXEC_SQL,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.handle_student_session_login[\s\S]*?TO\s+service_role\s*;/i,
    "must GRANT EXECUTE TO service_role"
  );
});

test("does not GRANT EXECUTE to anon or authenticated", () => {
  // Guard against a future edit that widens access to browser-reachable roles.
  const grantAnon = /GRANT\s+EXECUTE[\s\S]*?TO\s+anon\b/i.test(EXEC_SQL);
  const grantAuth = /GRANT\s+EXECUTE[\s\S]*?TO\s+authenticated\b/i.test(EXEC_SQL);
  assert.equal(grantAnon, false, "must not GRANT EXECUTE to anon");
  assert.equal(grantAuth, false, "must not GRANT EXECUTE to authenticated");
});

test("is idempotent in its final privilege state", () => {
  // REVOKE/GRANT are no-ops when the privileges are already in the target state,
  // so re-applying this migration is safe. We assert the file targets a single,
  // stable end-state (service_role-only EXECUTE) with no conditional branching
  // that could leave an intermediate state.
  assert.equal(/DO \$\$/i.test(EXEC_SQL), false, "uses plain REVOKE/GRANT, not conditional DO blocks");
  assert.equal(/IF NOT EXISTS/i.test(EXEC_SQL), false, "privilege statements are inherently idempotent");
});
