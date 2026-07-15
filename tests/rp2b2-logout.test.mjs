// tests/rp2b2-logout.test.mjs
// RP2-B2 — Server-side logout acceptance tests. node:test, no real DB.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rp2b2-test-session-secret-please-rotate";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "rp2b2-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "rp2b2-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "rp2b2-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://rp2b2-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "rp2b2-test-service-role-key";

const FLAG_KEYS = ["V2_GLOBAL_ONE_DEVICE_ENABLED", "V2_CORS_ALLOWLIST_ENABLED", "LMS_PORTAL_ORIGINS"];
function snapshotEnv() { const s = {}; for (const k of FLAG_KEYS) s[k] = process.env[k]; return s; }
function restoreEnv(s) { for (const k of FLAG_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } }
function clearFlagEnv() { for (const k of FLAG_KEYS) delete process.env[k]; }

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.json = (body) => { r.jsonBody = body; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
function mockReq({ method = "POST", headers = {}, body = {} } = {}) {
  return { method, headers, body, query: {} };
}

function validAccess() {
  return {
    ok: true, reason: "valid", email: "stu@example.com", courseSlug: "khoa-a",
    session: { student_session_id: "sess_123", lms_session_id: "lms_abc", lms_device_id: "dev_1" },
    studentSession: { student_session_id: "sess_123", email: "stu@example.com", status: "active" },
    enrollment: { id: "e1", status: "active" }
  };
}

test("logout: flag-on, valid session -> 200, serverRevoked true, cookie cleared", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  let revoked = false;
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { revoked = true; return { student_session_id: "sess_123" }; };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, true);
    assert.equal(res.jsonBody.loggedOut, true);
    assert.match(res.headers["Set-Cookie"] || "", /course_session_token=;/);
    assert.equal(revoked, true);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: idempotent — second call still 200 even though revoke matched nothing", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => null; // already logged_out -> 0 rows
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, true);
    assert.match(res.headers["Set-Cookie"] || "", /Max-Age=0/);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: flag-on, missing headers -> 401 invalid_session, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__;
  delete globalThis.__RP2B2_LOGOUT_FN_STUB__;
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody.error, "invalid_session");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); }
});

test("logout: flag-on, verify fails -> 401, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = { ok: false, reason: "device_mismatch", session: {} };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_other" } }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; }
});

test("logout: flag-on, revoke throws -> 503 one_device_policy_unavailable, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { throw new Error("db down"); };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.jsonBody.error, "one_device_policy_unavailable");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: flag-off, no session -> 200 best-effort, serverRevoked false, cookie cleared", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__;
  delete globalThis.__RP2B2_LOGOUT_FN_STUB__;
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: {} }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, false);
    assert.match(res.headers["Set-Cookie"] || "", /course_session_token=;/);
  } finally { restoreEnv(snap); }
});

test("logout: flag-off, valid session -> 200 serverRevoked true", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  let revoked = false;
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { revoked = true; return { student_session_id: "sess_123" }; };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, true);
    assert.equal(revoked, true);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: flag-off, revoke throws -> 500 logout_failed, no cookie clear", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { throw new Error("db down"); };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.error, "logout_failed");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: rejects GET with 405", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ method: "GET", headers: {} }), res);
    assert.equal(res.statusCode, 405);
  } finally { restoreEnv(snap); }
});

test("logout: flag-on, verify throws -> 401 invalid_session, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = async () => { throw new Error("db down"); };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody.error, "invalid_session");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; }
});

test("logout: flag-off, verify throws -> 200 serverRevoked false, cookie cleared", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = async () => { throw new Error("db down"); };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, false);
    assert.match(res.headers["Set-Cookie"] || "", /course_session_token=;/);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; }
});
