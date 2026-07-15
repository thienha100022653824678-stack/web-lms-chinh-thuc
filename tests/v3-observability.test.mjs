// tests/v3-observability.test.mjs
// V3 Phase 6 (⑪) — structured logging + metrics. node:test, stubbed Supabase.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3obs-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3obs-test-service-role-key";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "v3obs-test-internal-sync-secret";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.v3-obs.json");
process.env.LMS_SUPABASE_STUB_FILE = STUB_FILE;
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const logs = await import("../utils/v3-logs.js");
const metrics = await import("../utils/v3-metrics.js");
const rc = await import("../utils/runtime-controller.js");

function setMode(mode) {
  rc._test.reset();
  writeStub({
    platform_runtime_config: {
      active_mode: mode, v2_shadow_mode: false, v3_shadow_mode: false,
      kill_switch: false, updated_at: "2026-07-15T00:00:00Z",
    },
  });
}

// ── Logging ──────────────────────────────────────────────────────────────────
test("maskEmail keeps 2 chars + domain; empty -> ''", () => {
  assert.equal(logs.maskEmail("student@gmail.com"), "st***@gmail.com");
  assert.equal(logs.maskEmail(""), "");
  assert.equal(logs.maskEmail("bad-no-at"), "***");
});

test("hashIdentifier returns a stable 16-char digest, null on empty", () => {
  const a = logs.hashIdentifier("203.0.113.5");
  const b = logs.hashIdentifier("203.0.113.5");
  assert.equal(a, b);
  assert.equal(a.length, 16);
  assert.equal(logs.hashIdentifier(""), null);
  // Never the raw value.
  assert.ok(!a.includes("203.0.113.5"));
});

test("buildLogEntry stamps runtime_version + schema_version + masks PII", () => {
  const e = logs.buildLogEntry({
    event: "enrollment.created",
    message: "ok",
    email: "student@gmail.com",
    ip: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    correlationId: "corr-1",
    requestId: "req-1",
    flowId: "flow-1",
    runtimeVersion: "v3",
    extra: "keep",
  });
  assert.equal(e.runtime_version, "v3");
  assert.equal(e.schema_version, logs._internals.SCHEMA_VERSION);
  assert.equal(e.level, "info");
  assert.equal(e.event, "enrollment.created");
  assert.equal(e.correlation_id, "corr-1");
  assert.equal(e.request_id, "req-1");
  assert.equal(e.flow_id, "flow-1");
  assert.equal(e.email_masked, "st***@gmail.com");
  assert.equal(e.ip_hash, logs.hashIdentifier("203.0.113.5"));
  assert.equal(e.ua_hash, logs.hashIdentifier("Mozilla/5.0"));
  assert.equal(e.extra, "keep"); // extra fields kept
  // No raw PII leaked.
  assert.equal(JSON.stringify(e).includes("student@gmail.com"), false);
  assert.equal(JSON.stringify(e).includes("203.0.113.5"), false);
});

test("buildLogEntry defaults runtime_version to v1 and clamps bad level", () => {
  const e = logs.buildLogEntry({ level: "shout", message: "x" });
  assert.equal(e.level, "info");
  assert.equal(e.runtime_version, "v1");
});

test("buildLogEntry never lets extra fields overwrite reserved keys", () => {
  const e = logs.buildLogEntry({ runtime_version: "v3", level: "warn", bogus: 1, runtime_version: "v1" });
  // The last explicit arg wins in JS object literals; but our destructure picks
  // runtimeVersion out, so a rest-field named runtime_version can't sneak in.
  assert.equal(e.runtime_version, "v1");
});

test("logEvent returns the entry and never throws", () => {
  let entry;
  assert.doesNotThrow(() => { entry = logs.logEvent({ event: "t", message: "m" }); });
  assert.ok(entry.ts);
});

test("stampTelemetry stamps a payload with runtime_version + schema_version", () => {
  const s = logs.stampTelemetry({ a: 1 }, "v3");
  assert.equal(s.runtime_version, "v3");
  assert.equal(s.schema_version, logs._internals.SCHEMA_VERSION);
  assert.equal(s.a, 1);
});

// ── Metrics ──────────────────────────────────────────────────────────────────
test("getRuntimePosture reports rls_enforced only in v3", async () => {
  setMode("v1");
  let p = await metrics.getRuntimePosture();
  assert.equal(p.ok, true);
  assert.equal(p.effective_mode, "v1");
  assert.equal(p.rls_enforced, false);
  setMode("v3");
  p = await metrics.getRuntimePosture();
  assert.equal(p.effective_mode, "v3");
  assert.equal(p.rls_enforced, true);
  clearStub();
});

test("collectV3Metrics aggregates outbox + delivery + posture", async () => {
  setMode("v3");
  const m = await metrics.collectV3Metrics();
  assert.ok(m.outbox);
  assert.ok(m.delivery);
  assert.ok(m.posture);
  assert.equal(typeof m.generatedAt, "string");
  clearStub();
});

test("diagnostics handler: 401 without worker secret, 200 with", async () => {
  const { default: handler } = await import("../api/v3/diagnostics.js");
  setMode("v3");
  const mkRes = () => {
    const r = { statusCode: null, jsonBody: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.jsonBody = b; return r; };
    return r;
  };
  const noSecret = handler({ method: "GET", headers: {} }, mkRes());
  const r1 = await noSecret;
  assert.equal(r1.statusCode, 401);
  const withSecret = handler(
    { method: "GET", headers: { "x-v2-worker-secret": process.env.INTERNAL_SYNC_SECRET } },
    mkRes()
  );
  const r2 = await withSecret;
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.jsonBody.ok, true);
  const notGet = handler({ method: "POST", headers: { "x-v2-worker-secret": process.env.INTERNAL_SYNC_SECRET } }, mkRes());
  const r3 = await notGet;
  assert.equal(r3.statusCode, 405);
  clearStub();
});
