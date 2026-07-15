// tests/rp2b3-revoke.test.mjs
// RP2-B3 — Admin revoke polish acceptance tests. node:test, no real DB.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rp2b3-test-session-secret-please-rotate";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "rp2b3-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "rp2b3-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "rp2b3-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://rp2b3-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "rp2b3-test-service-role-key";

const FLAG_KEYS = ["V2_CORS_ALLOWLIST_ENABLED", "LMS_ADMIN_ORIGINS"];
function snapshotEnv() { const s = {}; for (const k of FLAG_KEYS) s[k] = process.env[k]; return s; }
function restoreEnv(s) { for (const k of FLAG_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } }
function clearFlagEnv() { for (const k of FLAG_KEYS) delete process.env[k]; }

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.getHeader = (k) => {
    const key = String(k).toLowerCase();
    for (const hk of Object.keys(r.headers)) {
      if (hk.toLowerCase() === key) return r.headers[hk];
    }
    return undefined;
  };
  r.json = (body) => { r.jsonBody = body; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
function mockReq({ method = "POST", body = {}, headers = {} } = {}) {
  return { method, headers, body, query: { mode: "action" }, headers: headers, socket: {} };
}

async function adminReq(body) {
  const lms = await import("../utils/lms.js");
  const token = lms.createAdminSession("owner@example.com").token;
  return mockReq({ body, headers: { authorization: `Bearer ${token}`, "user-agent": "test" } });
}

// ---- pure helper ----
test("validateRevokeReason: empty -> reason_required", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({ reason: "   " });
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_required");
  assert.equal(r.status, 400);
});

test("validateRevokeReason: missing field -> reason_required", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({});
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_required");
});

test("validateRevokeReason: over 500 chars -> reason_too_long", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({ reason: "x".repeat(501) });
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_too_long");
  assert.equal(r.status, 400);
});

test("validateRevokeReason: valid -> trimmed reason", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({ reason: "  mat may  " });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "mat may");
});

// ---- handler reset_session branch ----
async function withDeps(deps, fn) {
  globalThis.__RP2B3_RESET_DEPS__ = deps;
  try { await fn(); } finally { delete globalThis.__RP2B3_RESET_DEPS__; }
}

test("reset_session: no reason -> 400 reason_required", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com" }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "reason_required");
  } finally { restoreEnv(snap); }
});

test("reset_session: reason too long -> 400 reason_too_long", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "y".repeat(501) }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "reason_too_long");
  } finally { restoreEnv(snap); }
});

test("reset_session: student not found -> 404 student_not_found, no revoke", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  let revokeCalled = false;
  await withDeps({
    lookupStudentExists: async () => false,
    resetStudentSessionByEmail: async () => { revokeCalled = true; return { studentSessions: 0 }; },
    writeAdminAuditLog: async () => ({ ok: true }),
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "ghost@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.jsonBody.error, "student_not_found");
    assert.equal(revokeCalled, false);
  });
  restoreEnv(snap);
});

test("reset_session: nothing active -> 200 alreadyRevoked true, audit has reason", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  let auditArg = null;
  await withDeps({
    lookupStudentExists: async () => true,
    resetStudentSessionByEmail: async () => ({ ok: true, studentSessions: 0, entryTokens: 0, lmsSessions: 0, usedRpc: true }),
    writeAdminAuditLog: async (_s, a) => { auditArg = a; return { ok: true }; },
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.alreadyRevoked, true);
    assert.equal(res.jsonBody.affectedSessions, 0);
    assert.equal(auditArg.action, "account_sharing_reset_session");
    assert.equal(auditArg.metadata.reason, "mat may");
  });
  restoreEnv(snap);
});

test("reset_session: revoked active -> 200 alreadyRevoked false, affectedSessions>0", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  await withDeps({
    lookupStudentExists: async () => true,
    resetStudentSessionByEmail: async () => ({ ok: true, studentSessions: 1, entryTokens: 2, lmsSessions: 1, usedRpc: true }),
    writeAdminAuditLog: async () => ({ ok: true }),
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.alreadyRevoked, false);
    assert.equal(res.jsonBody.affectedSessions, 1);
  });
  restoreEnv(snap);
});

test("reset_session: revoke throws -> 500 revoke_failed", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  await withDeps({
    lookupStudentExists: async () => true,
    resetStudentSessionByEmail: async () => { throw new Error("rpc down"); },
    writeAdminAuditLog: async () => ({ ok: true }),
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.error, "revoke_failed");
    // No raw DB error string leaks:
    assert.equal(String(res.jsonBody.message || "").includes("rpc down"), false);
  });
  restoreEnv(snap);
});
