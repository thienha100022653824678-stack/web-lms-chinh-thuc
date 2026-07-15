// tests/schema-diff.test.mjs
// V3 Phase 1 (⑦) — schema-drift diff engine tests. node:test, pure, no DB.
//
// The engine compares two catalog snapshots (EXPECTED, from migrations, vs
// ACTUAL, from the live DB dump) and classifies each difference as FAIL / WARN,
// after moving anything matching drift_allowlist.json into `allowed`.
//
// Fixtures below carry the VERIFIED production shape from
// docs/V3_SCHEMA_GAP_SQL_RESULTS.md (RLS on / 0 policy, partial-outbox,
// drift columns, SECURITY INVOKER login RPC).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const { diffCatalogs, loadAllowlist } = await import(
  "../supabase/tools/schema-diff.mjs"
);

// Minimal but representative catalog snapshot (subset of production B).
function baseCatalog() {
  return {
    tables: {
      courses: {
        columns: {
          id: "uuid",
          slug: "text",
          title: "text",
          is_published: "boolean",
        },
        rls_enabled: true,
        rls_forced: false,
      },
      lessons: {
        columns: { id: "uuid", course_slug: "text", is_section: "boolean" },
        rls_enabled: true,
        rls_forced: false,
      },
      sync_outbox: {
        columns: { id: "uuid" },
        rls_enabled: true,
        rls_forced: false,
      },
    },
    indexes: [
      {
        table: "student_active_sessions",
        name: "idx_one_active_student_session_per_email",
        unique: true,
        partial: "(status = 'active'::text)",
        def: "CREATE UNIQUE INDEX ...",
      },
    ],
    constraints: [
      {
        table: "student_enrollments",
        name: "student_enrollments_email_course_slug_key",
        type: "u",
        def: "UNIQUE (email, course_slug)",
      },
    ],
    policies: [],
    functions: [
      {
        name: "handle_student_session_login",
        security: "INVOKER",
        grants: ["service_role"],
      },
    ],
  };
}

const EMPTY_ALLOWLIST = loadAllowlist({});

test("identical catalogs => PASS, no findings", () => {
  const res = diffCatalogs(baseCatalog(), baseCatalog(), EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "PASS");
  assert.equal(res.fails.length, 0);
});

test("dropped column => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  delete actual.tables.courses.columns.title;
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(
    res.fails.some((f) => f.kind === "column" && f.object === "courses.title")
  );
});

test("added table => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  actual.tables.brand_new = {
    columns: { id: "uuid" },
    rls_enabled: true,
    rls_forced: false,
  };
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(res.fails.some((f) => f.kind === "table" && f.object === "brand_new"));
});

test("RLS toggled off => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  actual.tables.courses.rls_enabled = false;
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(res.fails.some((f) => f.kind === "rls" && f.object === "courses"));
});

test("function security-mode change => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  actual.functions[0].security = "DEFINER";
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(
    res.fails.some(
      (f) => f.kind === "function" && f.object === "handle_student_session_login"
    )
  );
});

test("missing sync_dead_letters (in EXPECTED, not ACTUAL) => FAIL unless allowlisted", () => {
  const expected = baseCatalog();
  expected.tables.sync_dead_letters = {
    columns: { id: "uuid" },
    rls_enabled: true,
    rls_forced: false,
  };
  const actual = baseCatalog(); // no sync_dead_letters
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(
    res.fails.some((f) => f.kind === "table" && f.object === "sync_dead_letters")
  );

  // Allowlisted => moves to allowed, PASS.
  const allow = loadAllowlist({
    tables: [{ object: "sync_dead_letters", reason: "partial outbox apply" }],
  });
  const res2 = diffCatalogs(expected, actual, allow);
  assert.equal(res2.verdict, "PASS");
  assert.ok(res2.allowed.some((f) => f.object === "sync_dead_letters"));
});

test("allowlisted drift column (lessons.is_section) => allowed, PASS", () => {
  const expected = baseCatalog();
  delete expected.tables.lessons.columns.is_section; // migrations don't declare it yet
  const actual = baseCatalog(); // live DB has it (drift)
  // Without allowlist: FAIL (unexpected added column).
  const bare = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(bare.verdict, "FAIL");
  // With allowlist: allowed.
  const allow = loadAllowlist({
    columns: [{ object: "lessons.is_section", reason: "known drift" }],
  });
  const res = diffCatalogs(expected, actual, allow);
  assert.equal(res.verdict, "PASS");
  assert.ok(res.allowed.some((f) => f.object === "lessons.is_section"));
});

test("column-order-only difference => WARN not FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  // Reorder courses columns; same set, different insertion order.
  actual.tables.courses.columns = {
    slug: "text",
    id: "uuid",
    is_published: "boolean",
    title: "text",
  };
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "PASS"); // WARN does not fail
  assert.ok(res.warns.some((f) => f.kind === "column" && f.object === "courses"));
});

test("column type change => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  actual.tables.courses.columns.is_published = "text"; // was boolean
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(
    res.fails.some(
      (f) => f.kind === "column" && f.object === "courses.is_published"
    )
  );
});

test("dropped unique index => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  actual.indexes = []; // lost idx_one_active_student_session_per_email
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(
    res.fails.some(
      (f) =>
        f.kind === "index" &&
        f.object === "idx_one_active_student_session_per_email"
    )
  );
});

test("dropped constraint => FAIL", () => {
  const expected = baseCatalog();
  const actual = baseCatalog();
  actual.constraints = [];
  const res = diffCatalogs(expected, actual, EMPTY_ALLOWLIST);
  assert.equal(res.verdict, "FAIL");
  assert.ok(
    res.fails.some(
      (f) =>
        f.kind === "constraint" &&
        f.object === "student_enrollments_email_course_slug_key"
    )
  );
});

test("real supabase/drift_allowlist.json parses and allows a known drift column", () => {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "supabase/drift_allowlist.json"), "utf8")
  );
  const allow = loadAllowlist(raw);
  // Build a diff where lessons.is_section is a live-only drift column.
  const expected = baseCatalog();
  delete expected.tables.lessons.columns.is_section;
  const actual = baseCatalog();
  const res = diffCatalogs(expected, actual, allow);
  assert.ok(
    res.allowed.some((f) => f.object === "lessons.is_section"),
    "is_section should be allowlisted by the real drift_allowlist.json"
  );
  assert.equal(res.verdict, "PASS");
});

test("loadAllowlist tolerates missing keys", () => {
  const allow = loadAllowlist({});
  assert.ok(allow);
  // No entry matches anything.
  assert.equal(allow.has("column", "anything.at.all"), false);
});
