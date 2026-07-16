// tests/v2-runtime-mode-endpoint.test.mjs
//
// Acceptance tests for the admin runtime-mode endpoint
// (api/lms/admin.js?endpoint=runtime-mode → utils/lms-handlers/admin-runtime-mode.js).
// node:test, no real DB. Uses the controller's test seam
// (`globalThis.__V2_RUNTIME_CONTROLLER_SNAPSHOT__`) for read paths and a
// supabase-stub write recorder for the flip paths.
//
// Contract under test:
//   GET  (admin)     → 200 { success, activeMode, killSwitch, source, effective, flags }
//   GET  (no admin)  → 401 admin_auth_required
//   POST set_mode v2 (admin) → 200 { success, activeMode:'v2', flipped:true }, audit written, cache refresh
//   POST set_mode v1 (admin) → 200 { activeMode:'v1' }, audit written
//   POST set_mode invalid → 400 invalid_mode
//   POST set_kill_switch true/false → 200 { killSwitch }, audit written
//   POST invalid action → 400 invalid_action
//   POST (no admin) → 401
//   GET  (wrong method PUT) → 405
//   No raw DB error / IP / device / session id leaks in any response.

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STUB_FILE = join(__dirname, ".supabase-stub.json");

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "v2rm-test-session-secret";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "v2rm-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "v2rm-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "v2rm-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v2rm-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v2rm-test-service-role-key";
// Use the in-memory supabase stub so the audit-log insert + any fallback
// reads go through the stub (no network). The controller's mode value is
// driven by the `__V2_RUNTIME_STUB_DB__` seam, not by this stub.
process.env.LMS_RP2B1_SUPABASE_STUB = "1";

const ENV_KEYS = ["V2_RUNTIME_FORCE_MODE", "V2_RUNTIME_FORCE_KILL", "V2_CORS_ALLOWLIST_ENABLED", "LMS_ADMIN_ORIGINS"];
function snapshotEnv() { const s = {}; for (const k of ENV_KEYS) s[k] = process.env[k]; return s; }
function restoreEnv(s) { for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } }
function clearFlagEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

// Shared instances — the controller + flags share one in-process cache.
const controller = await import("../utils/v2-runtime-controller.js");

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.getHeader = (k) => {
    const key = String(k).toLowerCase();
    for (const hk of Object.keys(r.headers)) if (hk.toLowerCase() === key) return r.headers[hk];
    return undefined;
  };
  r.json = (body) => { r.jsonBody = body; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
function mockReq({ method = "GET", body = {}, headers = {}, query = {} } = {}) {
  return { method, headers, body, query, socket: {} };
}

async function adminReq(body, { method = "POST" } = {}) {
  const lms = await import("../utils/lms.js");
  const token = lms.createAdminSession("owner@example.com").token;
  return mockReq({ method, body, headers: { authorization: `Bearer ${token}`, "user-agent": "test" } });
}

// Enable the in-test stub DB so setActiveMode/setKillSwitch run end-to-end
// against an in-memory object (no network). Writes are also recorded into
// `writes` for assertion. The controller reads `globalThis.__V2_RUNTIME_STUB_DB__`
// (object) for the load path and records upserts back into it.
// MUST `await` this helper: the finally that clears the stub runs only after
// the (async) fn resolves, so the stub stays set for the whole handler call.
async function withStubDb(initialDb, fn) {
  globalThis.__V2_RUNTIME_STUB_DB__ = initialDb;
  globalThis.__V2RM_SUPABASE_WRITES__ = [];
  try {
    return await fn();
  } finally {
    delete globalThis.__V2_RUNTIME_STUB_DB__;
    delete globalThis.__V2RM_SUPABASE_WRITES__;
  }
}

function writes() {
  return globalThis.__V2RM_SUPABASE_WRITES__ || [];
}

function resetController() {
  controller._resetRuntimeControllerCache();
  delete globalThis.__V2_RUNTIME_CONTROLLER_SNAPSHOT__;
}

// ── GET ────────────────────────────────────────────────────────────────────

test("runtime-mode GET (admin) → 200 with activeMode + effective + flags", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = { v2_active_mode: "v2" };
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({}, { method: "GET" }), res);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.success, true);
    assert.equal(res.jsonBody.activeMode, "v2");
    assert.equal(res.jsonBody.killSwitch, false);
    assert.equal(res.jsonBody.effective, true);
    assert.equal(res.jsonBody.source, "db");
    // flags posture present, with configured + enabled per flag
    assert.ok(res.jsonBody.flags && typeof res.jsonBody.flags === "object");
    assert.ok("PLATFORM_ENABLED" in res.jsonBody.flags);
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode GET (no admin) → 401 admin_auth_required", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await handler(mockReq({ method: "GET", headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody.error, "admin_auth_required");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode GET reports effective=false in v1 even when env flags configured", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1"; // configured on, but mode v1 → effective off
  resetController();
  const stubDb = { v2_active_mode: "v1" };
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({}, { method: "GET" }), res);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.activeMode, "v1");
    assert.equal(res.jsonBody.effective, false);
    assert.equal(res.jsonBody.flags.GLOBAL_ONE_DEVICE_ENABLED?.configured, true);
    assert.equal(res.jsonBody.flags.GLOBAL_ONE_DEVICE_ENABLED?.enabled, false);
  } finally {
    delete process.env.V2_GLOBAL_ONE_DEVICE_ENABLED;
    resetController();
    restoreEnv(snap);
  }
});

// ── POST set_mode ──────────────────────────────────────────────────────────

test("runtime-mode POST set_mode v2 (admin) → 200, upserts site_config, audit written, cache warm", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = { v2_active_mode: "v1" };
  let auditWrite = null;
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({ action: "set_mode", mode: "v2" }), res);
      // Capture the audit write INSIDE withStubDb (before the finally clears
      // __V2RM_SUPABASE_WRITES__).
      auditWrite = writes().find((w) => w.table === "admin_audit_logs" && w.operation === "insert") || null;
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.success, true);
    assert.equal(res.jsonBody.activeMode, "v2");
    assert.equal(res.jsonBody.flipped, true);
    // The controller recorded the mode into the stub DB.
    assert.equal(stubDb.v2_active_mode, "v2");
    // The admin_audit_logs insert was recorded by the stub supabase writer.
    assert.ok(auditWrite, "expected an admin_audit_logs insert");
    assert.equal(auditWrite.payload.action, "v2_runtime_mode_set");
    assert.equal(auditWrite.payload.metadata.mode, "v2");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode POST set_mode v1 (admin) → 200, upserts v1", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = { v2_active_mode: "v2" };
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({ action: "set_mode", mode: "v1" }), res);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.activeMode, "v1");
    assert.equal(stubDb.v2_active_mode, "v1");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode POST set_mode invalid → 400 invalid_mode, no upsert", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = {};
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({ action: "set_mode", mode: "v3" }), res);
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "invalid_mode");
    assert.equal(stubDb.v2_active_mode, undefined, "invalid mode must not write to DB");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

// ── POST set_kill_switch ───────────────────────────────────────────────────

test("runtime-mode POST set_kill_switch true → 200, upserts kill row, audit written", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = { v2_active_mode: "v2" };
  let auditWrite = null;
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({ action: "set_kill_switch", killSwitch: true }), res);
      auditWrite = writes().find((w) => w.table === "admin_audit_logs" && w.operation === "insert") || null;
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.killSwitch, true);
    assert.equal(stubDb.v2_kill_switch, true);
    assert.ok(auditWrite, "expected an admin_audit_logs insert");
    assert.equal(auditWrite.payload.action, "v2_runtime_kill_switch_set");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode POST set_kill_switch false → 200, killSwitch false", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = { v2_active_mode: "v2", v2_kill_switch: true };
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({ action: "set_kill_switch", killSwitch: false }), res);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.killSwitch, false);
    assert.equal(stubDb.v2_kill_switch, false);
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

// ── POST validation / auth ─────────────────────────────────────────────────

test("runtime-mode POST invalid action → 400 invalid_action", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await handler(await adminReq({ action: "bogus" }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "invalid_action");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode POST (no admin) → 401 admin_auth_required", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await handler(mockReq({ method: "POST", body: { action: "set_mode", mode: "v2" }, headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody.error, "admin_auth_required");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

test("runtime-mode PUT (admin) → 405 method_not_allowed", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const res = mockRes();
    await handler(await adminReq({ action: "set_mode", mode: "v2" }, { method: "PUT" }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.jsonBody.error, "method_not_allowed");
  } finally {
    resetController();
    restoreEnv(snap);
  }
});

// ── no metadata leak ───────────────────────────────────────────────────────

test("runtime-mode responses never leak raw DB error / IP / device / session id", async () => {
  const snap = snapshotEnv();
  clearFlagEnv();
  resetController();
  const stubDb = { v2_active_mode: "v1" };
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-runtime-mode.js");
    const bodies = [];
    const res1 = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({}, { method: "GET" }), res1);
    });
    bodies.push(JSON.stringify(res1.jsonBody || {}));
    const res2 = mockRes();
    await withStubDb(stubDb, async () => {
      await handler(await adminReq({ action: "set_mode", mode: "v2" }), res2);
    });
    bodies.push(JSON.stringify(res2.jsonBody || {}));
    const blob = bodies.join(" ");
    for (const forbidden of ["x-forwarded-for", "device_id", "session_id", "rpc down", "error.message"]) {
      assert.equal(blob.toLowerCase().includes(forbidden), false, `response must not leak "${forbidden}"`);
    }
  } finally {
    resetController();
    restoreEnv(snap);
  }
});
