// tests/v3-router.test.mjs
// V3 Phase 5 (⑥) — per-route dispatcher + v1/v2 delegation. node:test, stubbed.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3rt-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3rt-test-service-role-key";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.v3-router.json");
process.env.LMS_SUPABASE_STUB_FILE = STUB_FILE;
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const rc = await import("../utils/runtime-controller.js");
const router = await import("../utils/v3-handlers/router.js");

function setMode(mode) {
  rc._test.reset();
  writeStub({
    platform_runtime_config: {
      active_mode: mode, v2_shadow_mode: false, v3_shadow_mode: false,
      kill_switch: false, updated_at: "2026-07-15T00:00:00Z",
    },
  });
}

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.json = (b) => { r.jsonBody = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
function mockReq({ endpoint, method = "GET", headers = {} } = {}) {
  return { method, headers, query: { endpoint }, body: {} };
}

test("v1 mode delegates to the legacy portal router", async () => {
  setMode("v1");
  // The legacy router returns 404 for an unknown endpoint; assert we went
  // through it (not the v3 404 body) by checking the legacy 404 shape.
  const res = mockRes();
  await router.dispatch(mockReq({ endpoint: "course-data" }), res);
  // Legacy handler runs course-data (it will error on stub, but the key point:
  // we did NOT hit the v3 "V3 LMS endpoint not found" body). Assert the v3
  // 404 body was NOT produced.
  assert.notEqual(res.jsonBody?.error, "V3 LMS endpoint not found");
  clearStub();
});

test("v3 mode runs the V3 public-config handler (V1-shaped body)", async () => {
  setMode("v3");
  process.env.GOOGLE_CLIENT_ID = "v3test-client-id";
  const res = mockRes();
  await router.dispatch(mockReq({ endpoint: "public-config" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { googleClientId: "v3test-client-id" });
  clearStub();
});

test("v3 mode 404s on an unknown endpoint", async () => {
  setMode("v3");
  const res = mockRes();
  await router.dispatch(mockReq({ endpoint: "no-such-route" }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.jsonBody.error, "V3 LMS endpoint not found");
  clearStub();
});

test("resolveV3Route returns null for unmigrated routes", () => {
  // course-data is not yet registered in the v3 map.
  assert.equal(router.resolveV3Route("course-data"), null);
});
