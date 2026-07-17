// tests/v2-verify-4repo-diagnostics.test.mjs
//
// Unit tests for the pure normalization + validation core exported from
// scripts/verify-4repo-diagnostics.mjs. These do NOT touch the network and do
// NOT read any secret; they assert the script reads BOTH response shapes
// correctly after the LMS-vs-Shop/Portal/Admin shape divergence fix:
//
//   - Shop / Portal / Admin: runtime state at the TOP level.
//   - LMS: runtime state nested under `runtime`, no top-level `component`.
//
// The contract under test (from the production endpoints):
//   normalizeDiagnosticsResponse(body) -> { valid, component, activeMode,
//     killSwitch, source, ok, _from }
//   validateNormalized(name, norm) -> string[] of failures (empty = pass)
//   computeAgreement(modes, expectedMode?) -> { ok, ... }

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDiagnosticsResponse,
  validateNormalized,
  computeAgreement,
} from "../scripts/verify-4repo-diagnostics.mjs";

// ── Real production shapes (recorded 2026-07-17, redacted of any secret) ────
// These mirror the actual JSON the four endpoints emit, so the test pins the
// normalization to the real contract rather than an invented one.

const SHOP_SHAPE = {
  ok: true,
  component: "shop",
  activeMode: "v1",
  killSwitch: false,
  source: "db",
  flags: {},
  secretsConfigured: {},
  generatedAt: "2026-07-17T00:00:00.000Z",
};

const PORTAL_SHAPE = {
  ok: true,
  component: "portal",
  activeMode: "v1",
  killSwitch: false,
  source: "db",
  flags: {},
};

const ADMIN_SHAPE = {
  ok: true,
  component: "admin",
  activeMode: "v1",
  killSwitch: false,
  source: "db",
  v2Active: false,
  flags: {},
};

const LMS_SHAPE = {
  ok: true,
  mode: "read_only",
  generatedAt: "2026-07-17T00:00:00.000Z",
  runtime: { activeMode: "v1", killSwitch: false, ok: true, source: "db" },
  flags: {},
  migrations: {},
  outbox: {},
  nextAction: "ok",
};

// ── normalizeDiagnosticsResponse ────────────────────────────────────────────

test("normalize: top-level shape (shop) reads every field from top", () => {
  const n = normalizeDiagnosticsResponse(SHOP_SHAPE);
  assert.equal(n.valid, true);
  assert.equal(n.component, "shop");
  assert.equal(n.activeMode, "v1");
  assert.equal(n.killSwitch, false);
  assert.equal(n.source, "db");
  assert.equal(n.ok, true);
  assert.deepEqual(n._from, {
    component: "top", activeMode: "top", killSwitch: "top", source: "top", ok: "top",
  });
});

test("normalize: top-level shape (portal) reads every field from top", () => {
  const n = normalizeDiagnosticsResponse(PORTAL_SHAPE);
  assert.equal(n.valid, true);
  assert.equal(n.component, "portal");
  assert.equal(n.activeMode, "v1");
  assert.equal(n.killSwitch, false);
  assert.equal(n.source, "db");
});

test("normalize: top-level shape (admin) reads every field from top", () => {
  const n = normalizeDiagnosticsResponse(ADMIN_SHAPE);
  assert.equal(n.valid, true);
  assert.equal(n.component, "admin");
  assert.equal(n.activeMode, "v1");
  assert.equal(n.killSwitch, false);
  assert.equal(n.source, "db");
});

test("normalize: LMS runtime-nested shape reads fields from runtime envelope, no top-level component", () => {
  const n = normalizeDiagnosticsResponse(LMS_SHAPE);
  assert.equal(n.valid, true);
  // LMS has no top-level component field at all.
  assert.equal(n.component, null);
  assert.equal(n._from.component, "missing");
  // Runtime fields come from the `runtime` envelope.
  assert.equal(n.activeMode, "v1");
  assert.equal(n._from.activeMode, "runtime");
  assert.equal(n.killSwitch, false);
  assert.equal(n._from.killSwitch, "runtime");
  assert.equal(n.source, "db");
  assert.equal(n._from.source, "runtime");
  // LMS does emit top-level ok=true, so that resolves from top.
  assert.equal(n.ok, true);
  assert.equal(n._from.ok, "top");
});

test("normalize: top-level field overrides runtime envelope when both present and valid", () => {
  // Simulate a hypothetical future endpoint that emits BOTH. Top wins.
  const body = {
    ok: true,
    component: "shop",
    activeMode: "v2",
    killSwitch: true,
    source: "db",
    runtime: { activeMode: "v1", killSwitch: false, source: "cache", ok: true },
  };
  const n = normalizeDiagnosticsResponse(body);
  assert.equal(n.activeMode, "v2");
  assert.equal(n._from.activeMode, "top");
  assert.equal(n.killSwitch, true);
  assert.equal(n._from.killSwitch, "top");
  assert.equal(n.source, "db");
  assert.equal(n._from.source, "top");
});

test("normalize: top-level present-but-invalid falls back to runtime envelope", () => {
  // activeMode="v3" at top is invalid → fall back to runtime.activeMode="v1".
  const body = {
    ok: true,
    component: "lms",
    activeMode: "v3",
    killSwitch: "maybe",
    source: 42,
    runtime: { activeMode: "v1", killSwitch: false, source: "db", ok: true },
  };
  const n = normalizeDiagnosticsResponse(body);
  assert.equal(n.activeMode, "v1");
  assert.equal(n._from.activeMode, "runtime");
  assert.equal(n.killSwitch, false);
  assert.equal(n._from.killSwitch, "runtime");
  assert.equal(n.source, "db");
  assert.equal(n._from.source, "runtime");
});

test("normalize: killSwitch=false is preserved, never erased by truthiness", () => {
  // The whole point of the fix: a real false must not be treated as missing.
  const nTop = normalizeDiagnosticsResponse({ ok: true, component: "shop", activeMode: "v1", killSwitch: false, source: "db" });
  assert.equal(nTop.killSwitch, false);
  assert.equal(nTop._from.killSwitch, "top");

  const nRt = normalizeDiagnosticsResponse({ ok: true, runtime: { activeMode: "v1", killSwitch: false, source: "db", ok: true } });
  assert.equal(nRt.killSwitch, false);
  assert.equal(nRt._from.killSwitch, "runtime");
});

test("normalize: missing field is distinct from false (component absent on LMS, killSwitch truly absent)", () => {
  const n = normalizeDiagnosticsResponse({ ok: true, runtime: { activeMode: "v1", source: "db", ok: true } });
  // killSwitch intentionally absent in the envelope.
  assert.equal(n.killSwitch, null);
  assert.equal(n._from.killSwitch, "missing");
  assert.equal(n.component, null);
  assert.equal(n._from.component, "missing");
});

test("normalize: non-object / null / array body is invalid", () => {
  assert.equal(normalizeDiagnosticsResponse(null).valid, false);
  assert.equal(normalizeDiagnosticsResponse(undefined).valid, false);
  assert.equal(normalizeDiagnosticsResponse("not-json").valid, false);
  assert.equal(normalizeDiagnosticsResponse([1, 2, 3]).valid, false);
  assert.equal(normalizeDiagnosticsResponse({}).valid, true); // empty object is valid (fields just missing)
});

// ── validateNormalized ──────────────────────────────────────────────────────

test("validate: shop top-level shape passes", () => {
  const n = normalizeDiagnosticsResponse(SHOP_SHAPE);
  assert.deepEqual(validateNormalized("shop", n), []);
});

test("validate: portal top-level shape passes", () => {
  const n = normalizeDiagnosticsResponse(PORTAL_SHAPE);
  assert.deepEqual(validateNormalized("portal", n), []);
});

test("validate: admin top-level shape passes", () => {
  const n = normalizeDiagnosticsResponse(ADMIN_SHAPE);
  assert.deepEqual(validateNormalized("admin", n), []);
});

test("validate: LMS runtime-nested shape passes (absent component accepted for lms)", () => {
  const n = normalizeDiagnosticsResponse(LMS_SHAPE);
  assert.deepEqual(validateNormalized("lms", n), []);
});

test("validate: LMS with a component value other than 'lms' is flagged", () => {
  const body = { ...LMS_SHAPE, component: "shop", runtime: { ...LMS_SHAPE.runtime } };
  const n = normalizeDiagnosticsResponse(body);
  const f = validateNormalized("lms", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /component="shop"/);
});

test("validate: shop missing component is flagged", () => {
  const body = { ok: true, activeMode: "v1", killSwitch: false, source: "db" };
  const n = normalizeDiagnosticsResponse(body);
  const f = validateNormalized("shop", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /component="null"/);
});

test("validate: invalid activeMode at top-level (no runtime fallback) is flagged as missing", () => {
  // activeMode="v3" is present-but-invalid at top, and there is no runtime
  // envelope to fall back to → normalize reports null (missing). The validator
  // flags it as a missing/invalid mode regardless of which path produced null.
  const body = { ok: true, component: "shop", activeMode: "v3", killSwitch: false, source: "db" };
  const n = normalizeDiagnosticsResponse(body);
  assert.equal(n.activeMode, null);
  assert.equal(n._from.activeMode, "missing");
  const f = validateNormalized("shop", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /activeMode="null"/);
});

test("validate: invalid activeMode at top-level falls back to a valid runtime value (not flagged)", () => {
  // When a runtime envelope DOES carry a valid mode, an invalid top-level
  // activeMode is ignored in favor of the envelope — so validation passes.
  const body = {
    ok: true,
    component: "shop",
    activeMode: "v3",
    killSwitch: false,
    source: "db",
    runtime: { activeMode: "v1", killSwitch: false, source: "db", ok: true },
  };
  const n = normalizeDiagnosticsResponse(body);
  assert.equal(n.activeMode, "v1");
  assert.equal(n._from.activeMode, "runtime");
  assert.deepEqual(validateNormalized("shop", n), []);
});

test("validate: missing activeMode (no top-level AND no runtime) is flagged", () => {
  const body = { ok: true, component: "shop", killSwitch: false, source: "db" };
  const n = normalizeDiagnosticsResponse(body);
  const f = validateNormalized("shop", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /activeMode="null"/);
});

test("validate: missing killSwitch is flagged (not silently treated as false)", () => {
  const body = { ok: true, component: "shop", activeMode: "v1", source: "db" };
  const n = normalizeDiagnosticsResponse(body);
  const f = validateNormalized("shop", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /killSwitch not boolean \(got missing\)/);
});

test("validate: killSwitch=false passes (false is a valid boolean, not missing)", () => {
  const body = { ok: true, component: "shop", activeMode: "v1", killSwitch: false, source: "db" };
  const n = normalizeDiagnosticsResponse(body);
  assert.deepEqual(validateNormalized("shop", n), []);
});

test("validate: missing source is flagged", () => {
  const body = { ok: true, component: "shop", activeMode: "v1", killSwitch: false };
  const n = normalizeDiagnosticsResponse(body);
  const f = validateNormalized("shop", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /source missing or non-string/);
});

test("validate: invalid body returns a single failure and short-circuits", () => {
  const n = normalizeDiagnosticsResponse(null);
  const f = validateNormalized("shop", n);
  assert.equal(f.length, 1);
  assert.match(f[0], /invalid or non-object/);
});

// ── computeAgreement ───────────────────────────────────────────────────────

test("agreement: all 4 agree v1, no expected → ok", () => {
  const a = computeAgreement({ lms: "v1", shop: "v1", portal: "v1", admin: "v1" });
  assert.equal(a.ok, true);
  assert.equal(a.agreed, "v1");
});

test("agreement: all 4 agree v1, expected v1 → ok", () => {
  const a = computeAgreement({ lms: "v1", shop: "v1", portal: "v1", admin: "v1" }, "v1");
  assert.equal(a.ok, true);
  assert.equal(a.agreed, "v1");
});

test("agreement: all 4 agree but expected differs → fail (expected_mismatch)", () => {
  const a = computeAgreement({ lms: "v1", shop: "v1", portal: "v1", admin: "v1" }, "v2");
  assert.equal(a.ok, false);
  assert.equal(a.reason, "expected_mismatch");
});

test("agreement: components disagree → fail (disagree)", () => {
  const a = computeAgreement({ lms: "v1", shop: "v2", portal: "v1", admin: "v1" });
  assert.equal(a.ok, false);
  assert.equal(a.reason, "disagree");
});

test("agreement: fewer than 4 valid modes → fail (incomplete), the pre-fix LMS bug", () => {
  // This is exactly the pre-fix condition: LMS mode was undefined (mis-read),
  // so only 3/4 valid modes were counted and agreement silently "passed" on
  // the remaining three. The fix requires all 4.
  const a = computeAgreement({ shop: "v1", portal: "v1", admin: "v1" });
  assert.equal(a.ok, false);
  assert.equal(a.reason, "incomplete");
  assert.equal(a.have, 3);
});

test("agreement: a component with an invalid mode (v3) does not count toward the 4", () => {
  const a = computeAgreement({ lms: "v3", shop: "v1", portal: "v1", admin: "v1" });
  assert.equal(a.ok, false);
  assert.equal(a.reason, "incomplete");
});

// ── End-to-end over the real production shapes: simulate the CLI's logic ────

test("e2e: all 4 real production shapes normalize + validate clean and agree on v1", () => {
  const bodies = { lms: LMS_SHAPE, shop: SHOP_SHAPE, portal: PORTAL_SHAPE, admin: ADMIN_SHAPE };
  const modes = {};
  let totalFailures = 0;
  for (const [name, body] of Object.entries(bodies)) {
    const norm = normalizeDiagnosticsResponse(body);
    const f = validateNormalized(name, norm);
    totalFailures += f.length;
    if (norm.activeMode === "v1" || norm.activeMode === "v2") modes[name] = norm.activeMode;
  }
  assert.equal(totalFailures, 0, "no field-level failures across the 4 real shapes");
  const a = computeAgreement(modes, "v1");
  assert.equal(a.ok, true);
  assert.equal(a.agreed, "v1");
  assert.equal(Object.keys(modes).length, 4, "all 4 counted including LMS");
});
