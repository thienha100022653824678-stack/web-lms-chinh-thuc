// tests/v3-outbox.test.mjs
// V3 Phase 3 (④) — canonical outbox backbone tests. node:test, stubbed Supabase.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3ob-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3ob-test-service-role-key";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "v3ob-test-anon-key";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.json");
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const rc = await import("../utils/runtime-controller.js");
const ob = await import("../utils/v3-outbox.js");

function setMode(mode, extra = {}) {
  rc._test.reset();
  writeStub({
    platform_runtime_config: {
      active_mode: mode,
      v2_shadow_mode: false,
      v3_shadow_mode: false,
      kill_switch: false,
      updated_at: "2026-07-15T00:00:00Z",
    },
    ...extra,
  });
}

test("enqueueV3Event refuses unless v3 mode", async () => {
  setMode("v2");
  await assert.rejects(
    () => ob.enqueueV3Event({ aggregateType: "enrollment", eventType: "enrollment.upserted" }),
    /v3 mode/i
  );
});

test("enqueueV3Event requires aggregateType + eventType", async () => {
  setMode("v3");
  await assert.rejects(() => ob.enqueueV3Event({ eventType: "x" }), /required/i);
});

test("enqueueV3Event stamps runtime_version:v3 into the upserted payload", async () => {
  // Stub returns whatever sync_outbox is set to for the .select().single() result.
  setMode("v3", { sync_outbox: { id: "ob1", status: "pending", idempotency_key: "k1" } });
  const captured = [];
  globalThis.__SUPABASE_STUB_UPSERT__ = (table, row) => captured.push({ table, row });
  try {
    const res = await ob.enqueueV3Event({
      aggregateType: "enrollment",
      aggregateId: "stu@example.com:khoa-a",
      eventType: "enrollment.upserted",
      payload: { email: "stu@example.com", course_slug: "khoa-a" },
    });
    assert.equal(res.id, "ob1");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].row.event_type, "enrollment.upserted");
    assert.equal(captured[0].row.payload.runtime_version, "v3");
    assert.equal(captured[0].row.payload.email, "stu@example.com");
  } finally {
    delete globalThis.__SUPABASE_STUB_UPSERT__;
    clearStub();
  }
});

test("buildOutboxIdempotencyKey via enqueue is deterministic for identical inputs", async () => {
  const { buildOutboxIdempotencyKey } = await import("../utils/v2-outbox.js");
  const a = buildOutboxIdempotencyKey(["enrollment.upserted", "enrollment", "stu:khoa-a", ""]);
  const b = buildOutboxIdempotencyKey(["enrollment.upserted", "enrollment", "stu:khoa-a", ""]);
  assert.equal(a, b);
  assert.equal(a.length, 64); // sha256 hex
});

test("projectEvent skips a non-v3 event (compatibility contract)", async () => {
  ob._test.resetProjector();
  let applied = 0;
  const res = await ob.projectEvent(
    { idempotency_key: "k-v1", payload: { runtime_version: "v1" } },
    () => { applied += 1; }
  );
  assert.equal(res.skipped, true);
  assert.equal(res.applied, false);
  assert.equal(applied, 0);
});

test("projectEvent applies a v3 event once, no-op on a second identical call", async () => {
  ob._test.resetProjector();
  let applied = 0;
  const event = { idempotency_key: "k-v3", payload: { runtime_version: "v3" } };
  const first = await ob.projectEvent(event, () => { applied += 1; });
  const second = await ob.projectEvent(event, () => { applied += 1; });
  assert.equal(first.applied, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.applied, false);
  assert.equal(applied, 1);
});
