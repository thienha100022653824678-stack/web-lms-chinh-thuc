// tests/v3-db.test.mjs
// V3 Phase 2 (①) — tiered DB-client factory tests. node:test, no real DB.
//
// The factory enforces least-privilege key tiering and only operates in v3 mode.
// In v1/v2 mode it throws — a guard so V3 wiring can never be reached while the
// platform is running V1/V2 (the single service-role client in utils/supabase.js
// is what those modes use, untouched).
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3db-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3db-test-service-role-key";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "v3db-test-anon-key";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "v3db-test-internal-sync-secret";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.v3-db.json");
process.env.LMS_SUPABASE_STUB_FILE = STUB_FILE;
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const rc = await import("../utils/runtime-controller.js");
const db = await import("../utils/v3-db.js");

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

test("getClientForRole throws when effective mode is not v3", async () => {
  setMode("v1");
  await assert.rejects(() => db.getClientForRole("anon"), /v3/i);
});

test("getClientForRole returns a client for each tier in v3 mode", async () => {
  setMode("v3");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const client = await db.getClientForRole(role);
    assert.ok(client, `expected a client for ${role}`);
    assert.equal(typeof client.from, "function");
  }
});

test("getClientForRole rejects an unknown role", async () => {
  setMode("v3");
  await assert.rejects(() => db.getClientForRole("superuser"), /role/i);
});

test("assertServerOnly throws for anon/authenticated, passes for service_role", () => {
  assert.throws(() => db.assertServerOnly("anon"), /server/i);
  assert.throws(() => db.assertServerOnly("authenticated"), /server/i);
  assert.doesNotThrow(() => db.assertServerOnly("service_role"));
});

test("resolveTierForRequest: worker secret => service_role", () => {
  const req = { headers: { "x-v2-worker-secret": process.env.INTERNAL_SYNC_SECRET } };
  assert.equal(db.resolveTierForRequest(req), "service_role");
});

test("resolveTierForRequest: verified session marker => authenticated", () => {
  const req = { headers: {}, v3VerifiedSession: { email: "stu@example.com" } };
  assert.equal(db.resolveTierForRequest(req), "authenticated");
});

test("resolveTierForRequest: nothing => anon (least privilege)", () => {
  assert.equal(db.resolveTierForRequest({ headers: {} }), "anon");
});

test("missing SUPABASE_ANON_KEY fails closed for anon (never service-role fallback)", async () => {
  setMode("v3");
  const saved = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  try {
    await assert.rejects(() => db.getClientForRole("anon"), /anon_key/i);
  } finally {
    process.env.SUPABASE_ANON_KEY = saved;
    clearStub();
  }
});
