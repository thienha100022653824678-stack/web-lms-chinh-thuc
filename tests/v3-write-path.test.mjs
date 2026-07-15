// tests/v3-write-path.test.mjs
// V3 Phase 2 (①) — write-path funnel + V1 compatibility contract. node:test, no DB.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3wp-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3wp-test-service-role-key";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "v3wp-test-anon-key";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.json");
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const rc = await import("../utils/runtime-controller.js");
const wp = await import("../utils/v3-write-path.js");

function setMode(mode) {
  rc._test.reset();
  writeStub({
    platform_runtime_config: {
      active_mode: mode,
      v2_shadow_mode: false,
      v3_shadow_mode: false,
      kill_switch: false,
      updated_at: "2026-07-15T00:00:00Z",
    },
  });
}

test("writeViaRpc refuses when effective mode is not v3", async () => {
  setMode("v1");
  await assert.rejects(() => wp.writeViaRpc("some_rpc", { a: 1 }), /v3 mode/i);
});

test("writeViaRpc requires an RPC name", async () => {
  setMode("v3");
  await assert.rejects(() => wp.writeViaRpc("", { a: 1 }), /name is required/i);
});

test("writeViaRpc calls the RPC with a runtime_version stamp in v3 mode", async () => {
  setMode("v3");
  globalThis.__SUPABASE_STUB_RPC_CALLS__ = [];
  try {
    await wp.writeViaRpc("record_enrollment_v3", { email: "stu@example.com", course_slug: "khoa-a" });
    const calls = globalThis.__SUPABASE_STUB_RPC_CALLS__;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "record_enrollment_v3");
    assert.equal(calls[0].params.runtime_version, "v3");
    assert.equal(calls[0].params.schema_version, wp._internals.SCHEMA_VERSION);
    assert.equal(calls[0].params.email, "stu@example.com");
  } finally {
    delete globalThis.__SUPABASE_STUB_RPC_CALLS__;
    clearStub();
  }
});

test("compatibility contract: a V3-written row reads back valid through the V1 view", () => {
  // A row as V3 writes it: V1 columns + additive V3 fields.
  const v3Row = {
    id: "e1",
    email: "stu@example.com",
    course_slug: "khoa-a",
    status: "active",
    // additive V3/V2 fields V1 does not know:
    runtime_version: "v3",
    schema_version: "2026-07-15",
    normalized_email: "stu@example.com",
    sync_correlation_id: "corr-1",
  };
  // The V1 enrollment shape (what the V1 code path selects).
  const V1_COLUMNS = ["id", "email", "course_slug", "status"];
  const v1View = wp.toV1View(v3Row, V1_COLUMNS);
  // V1 sees a valid, complete V1-shaped row...
  assert.deepEqual(v1View, {
    id: "e1",
    email: "stu@example.com",
    course_slug: "khoa-a",
    status: "active",
  });
  // ...and the additive fields never leak into a V1 column (no overload).
  assert.equal("runtime_version" in v1View, false);
  assert.equal("normalized_email" in v1View, false);
});
