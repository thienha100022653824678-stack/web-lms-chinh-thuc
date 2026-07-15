// tests/runtime-controller.test.mjs
// V3 Phase 0 — Runtime controller spine tests. node:test, no real DB.
// Covers: default v1, kill switch forces v1, fail-closed on read error,
// cache TTL semantics, shadow flags, event stamping, single-writer branching.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://rc-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "rc-test-service-role-key";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "rc-test-internal-sync-secret";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.runtime-controller.json");
process.env.LMS_SUPABASE_STUB_FILE = STUB_FILE;

function writeStub(table, value) {
  writeFileSync(STUB_FILE, JSON.stringify({ [table]: value }));
}
function clearStub() {
  writeFileSync(STUB_FILE, JSON.stringify({}));
}

const rc = await import("../utils/runtime-controller.js");

function reset() {
  rc._test.reset();
  clearStub();
}

test("getEffectiveMode defaults to v1 when config row absent (fail-closed)", async () => {
  reset();
  const mode = await rc.getEffectiveMode();
  assert.equal(mode, "v1");
});

test("getEffectiveMode returns active_mode when kill_switch is false", async () => {
  reset();
  writeStub("platform_runtime_config", {
    active_mode: "v2",
    v2_shadow_mode: false,
    v3_shadow_mode: false,
    kill_switch: false,
    updated_at: "2026-07-15T00:00:00Z",
  });
  // First read awaits; must reflect the row.
  const mode = await rc.getEffectiveMode();
  assert.equal(mode, "v2");
});

test("kill_switch=true forces v1 even if active_mode is v3 (instant rollback)", async () => {
  reset();
  writeStub("platform_runtime_config", {
    active_mode: "v3",
    v2_shadow_mode: true,
    v3_shadow_mode: true,
    kill_switch: true,
    updated_at: "2026-07-15T00:00:00Z",
  });
  const mode = await rc.getEffectiveMode();
  assert.equal(mode, "v1");
});

test("invalid active_mode value falls back to v1", async () => {
  reset();
  writeStub("platform_runtime_config", {
    active_mode: "v9-bogus",
    v2_shadow_mode: false,
    v3_shadow_mode: false,
    kill_switch: false,
    updated_at: "2026-07-15T00:00:00Z",
  });
  const cfg = await rc.getConfig();
  assert.equal(cfg.active_mode, "v1");
});

test("fail-closed on read error keeps v1 and never throws", async () => {
  reset();
  // Stub configured to throw on this table -> readConfigFromDb catches, returns null,
  // getConfig returns FAIL_CLOSED_CONFIG (kill_switch true => v1).
  writeFileSync(STUB_FILE, JSON.stringify({ throwOn: { platform_runtime_config: true } }));
  const mode = await rc.getEffectiveMode();
  assert.equal(mode, "v1");
});

test("shadow flags are read via async accessor", async () => {
  reset();
  writeStub("platform_runtime_config", {
    active_mode: "v1",
    v2_shadow_mode: true,
    v3_shadow_mode: false,
    kill_switch: false,
    updated_at: "2026-07-15T00:00:00Z",
  });
  const v2 = await rc.isShadowEnabledAsync("v2");
  const v3 = await rc.isShadowEnabledAsync("v3");
  assert.equal(v2, true);
  assert.equal(v3, false);
});

test("stampEvent adds runtime_version + schema_version without mutating input", () => {
  const event = { type: "enrollment.created", email: "stu@example.com" };
  const stamped = rc.stampEvent(event, "v3", "2026-07-15");
  assert.equal(stamped.runtime_version, "v3");
  assert.equal(stamped.schema_version, "2026-07-15");
  assert.equal(stamped.type, "enrollment.created");
  // Original untouched.
  assert.equal(event.runtime_version, undefined);
});

test("stampEvent defaults unknown runtime version to v1", () => {
  const stamped = rc.stampEvent({ a: 1 }, "v99", null);
  assert.equal(stamped.runtime_version, "v1");
});

test("stampEvent stamps each element of an array", () => {
  const stamped = rc.stampEvent([{ id: 1 }, { id: 2 }], "v2", "s1");
  assert.ok(Array.isArray(stamped));
  assert.equal(stamped.length, 2);
  assert.equal(stamped[0].runtime_version, "v2");
  assert.equal(stamped[1].runtime_version, "v2");
});

test("stampEvent preserves an existing runtime_version (does not overwrite)", () => {
  const event = { type: "x", runtime_version: "v1" };
  const stamped = rc.stampEvent(event, "v3", null);
  assert.equal(stamped.runtime_version, "v1");
});

test("single-writer branching: only the effective mode path is chosen", async () => {
  reset();
  writeStub("platform_runtime_config", {
    active_mode: "v2",
    v2_shadow_mode: false,
    v3_shadow_mode: false,
    kill_switch: false,
    updated_at: "2026-07-15T00:00:00Z",
  });
  const mode = await rc.getEffectiveMode();
  let whoWrote = null;
  if (mode === "v1") whoWrote = "v1";
  else if (mode === "v2") whoWrote = "v2";
  else if (mode === "v3") whoWrote = "v3";
  assert.equal(whoWrote, "v2");
  assert.equal(mode, "v2");
});

test("cache TTL: stale value returned immediately, refresh scheduled", async () => {
  reset();
  writeStub("platform_runtime_config", {
    active_mode: "v2",
    v2_shadow_mode: false,
    v3_shadow_mode: false,
    kill_switch: false,
    updated_at: "2026-07-15T00:00:00Z",
  });
  // Prime cache.
  await rc.getEffectiveMode();
  // Mutate stub to v3; within TTL the controller should still report v2 (stale),
  // because returning stale immediately is the contract (refresh is background).
  writeStub("platform_runtime_config", {
    active_mode: "v3",
    v2_shadow_mode: false,
    v3_shadow_mode: false,
    kill_switch: false,
    updated_at: "2026-07-15T00:00:00Z",
  });
  const stale = await rc.getEffectiveMode();
  assert.equal(stale, "v2");
  // After a refresh completes (background), a fresh getConfig reflects v3.
  await rc._internals.refreshConfig();
  const fresh = await rc.getEffectiveMode();
  assert.equal(fresh, "v3");
});

test("FAIL_CLOSED_CONFIG has kill_switch true (so v1 is the escape hatch)", () => {
  assert.equal(rc._test.FAIL_CLOSED_CONFIG.kill_switch, true);
  assert.equal(rc._test.FAIL_CLOSED_CONFIG.active_mode, "v1");
});

test("VALID_MODES contains exactly v1, v2, v3", () => {
  assert.ok(rc._test.VALID_MODES.has("v1"));
  assert.ok(rc._test.VALID_MODES.has("v2"));
  assert.ok(rc._test.VALID_MODES.has("v3"));
  assert.equal(rc._test.VALID_MODES.size, 3);
});
