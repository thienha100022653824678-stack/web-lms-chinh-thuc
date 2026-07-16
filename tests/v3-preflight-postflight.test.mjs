// tests/v3-preflight-postflight.test.mjs
// Static assertions that scripts/v3/preflight-v3.sql and scripts/v3/postflight-v3.sql
// are READ-ONLY and therefore safe to run against production at any time.
//
// These SQL files are the owner's pre-apply / post-apply verification harness for
// the four V3 migrations (B1-B4). They must never contain a write. We scan the
// executable SQL (line comments stripped) for any DDL or DML that mutates state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "scripts", "v3");

function loadExecutableSql(file) {
  const sql = readFileSync(join(dir, file), "utf8");
  // Strip `--` line comments so prose ("No DROP / RENAME / ...") in the header
  // does not trip the write-scan. Block comments are not used in these files.
  const exec = sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return { sql, exec };
}

// Statements that mutate database state. None may appear as executable SQL.
// `truncate` is matched on the word boundary so it does not false-positive on
// prose (already stripped) — kept for structural safety.
const WRITE_PATTERNS = [
  /\binsert\s+into\b/i,
  /\bupdate\s+\w+\s+set\b/i, // UPDATE table SET ... (avoid matching "row_count" etc.)
  /\bdelete\s+from\b/i,
  /\bcreate\s+(table|index|unique|policy|function|or\s+replace|view|materialized|schema|role|trigger|constraint)/i,
  /\balter\s+(table|function|index|view|schema|role|sequence)/i,
  /\bdrop\s+/i,
  /\btruncate\s+/i,
  /\bgrant\s+/i,
  /\brevoke\s+/i,
  /\bdo\s+\$\$/i, // a DO block could hide writes — none allowed here
];

for (const file of ["preflight-v3.sql", "postflight-v3.sql"]) {
  const { sql, exec } = loadExecutableSql(file);

  test(`${file} is read-only (no DDL/DML writes)`, () => {
    const hits = [];
    for (const re of WRITE_PATTERNS) {
      const m = exec.match(re);
      if (m) hits.push(m[0]);
    }
    assert.deepEqual(hits, [], `${file} must not contain write statements; found: ${hits.join(", ")}`);
  });

  test(`${file} contains SELECT / catalog reads (it actually checks something)`, () => {
    assert.match(exec, /\bselect\b/i, `${file} should contain SELECT queries`);
  });

  test(`${file} does not reference a DROP/REVOKE/GRANT as a checked value (no embedded writes)`, () => {
    // The postflight describes expected states ("policy_count=0") but must not
    // actually issue GRANT/REVOKE/DROP. The write-scan above already enforces
    // this; this test is a second anchor confirming no privilege DDL leaked in.
    for (const re of [/\bgrant\s+execute\b/i, /\brevoke\b/i, /\bdrop\s+policy\b/i, /\bdrop\s+table\b/i]) {
      assert.equal(re.test(exec), false, `${file} must not contain ${re}`);
    }
  });
}

test("preflight checks the pre-apply state (V3 config tables absent, RLS baseline, login RPC grants)", () => {
  const { sql } = loadExecutableSql("preflight-v3.sql");
  // Pre-apply: the V3 config tables are expected NOT to exist yet.
  assert.match(sql, /platform_runtime_config/);
  assert.match(sql, /sync_dead_letters/);
  assert.match(sql, /handle_student_session_login/);
  assert.match(sql, /relrowsecurity/i, "preflight should check the RLS baseline");
});

test("postflight checks the post-apply state (config table + singleton v1, 8 policies, DEFINER, grants)", () => {
  const { sql } = loadExecutableSql("postflight-v3.sql");
  assert.match(sql, /platform_runtime_config/);
  assert.match(sql, /active_mode='v1'/, "postflight should confirm the singleton defaults to v1");
  assert.match(sql, /v3_%/, "postflight should count the v3_* policies");
  assert.match(sql, /prosecdef/, "postflight should confirm the RPC is DEFINER");
  assert.match(sql, /has_function_privilege/, "postflight should re-check the grants");
  assert.match(sql, /sync_dead_letters/);
});

test("postflight has a GO/NO-GO summary block", () => {
  const { sql } = loadExecutableSql("postflight-v3.sql");
  assert.match(sql, /GO\/NO-GO/i, "postflight should end with a pass/fail summary");
  assert.match(sql, /login_grants_hardened/, "summary should include the grants check");
});

test("both files are in scripts/v3 and follow the V2 naming convention", () => {
  // Structural anchor: the harness expects scripts/v3/{preflight,postflight}-v3.sql,
  // mirroring scripts/v2/. If these move, the owner runbook in
  // docs/V3_PROPOSAL_7_ROLLBACK_DRILL.md and docs/V3_STAGE1_FINAL_REPORT.md must
  // be updated to match.
  const { sql: pre } = loadExecutableSql("preflight-v3.sql");
  const { sql: post } = loadExecutableSql("postflight-v3.sql");
  assert.match(pre, /V3 preflight/i);
  assert.match(post, /V3 postflight/i);
});
