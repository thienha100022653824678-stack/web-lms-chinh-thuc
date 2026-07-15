// tests/admin-handlers-boot.test.mjs
//
// Smoke-boot every admin handler with a mock OPTIONS request.
// Catches the applyCors-import class of bug (ReferenceError: applyCors is not defined)
// which previously shipped on admin-lessons.js and admin-repair-drive.js.
//
// CORS flag OFF + no LMS_ADMIN_ORIGINS so applyCors returns {handled:false} in compat mode.
// Other throws (DB, missing query params, etc.) are pre-existing and tolerated —
// only the applyCors ReferenceError fails the suite.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const HANDLERS_DIR = join(ROOT, "utils", "lms-handlers");

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "admin-boot-test-session-secret-please-rotate";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "admin-boot-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "admin-boot-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "admin-boot-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://admin-boot-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "admin-boot-test-service-role-key";
// Keep CORS flag OFF and no LMS_ADMIN_ORIGINS so applyCors is in compat mode.
delete process.env.V2_CORS_ALLOWLIST_ENABLED;
delete process.env.LMS_ADMIN_ORIGINS;
delete process.env.LMS_PORTAL_ORIGINS;

function mockReq() {
  return { method: "OPTIONS", headers: {}, query: {}, body: {}, socket: {} };
}

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.json = (body) => { r.jsonBody = body; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  r.getHeader = (k) => r.headers[k];
  return r;
}

const adminFiles = readdirSync(HANDLERS_DIR)
  .filter((f) => f.startsWith("admin-") && f.endsWith(".js"))
  .sort();

assert.ok(adminFiles.length >= 10, `expected >=10 admin handlers, got ${adminFiles.length}`);

for (const file of adminFiles) {
  test(`boot: ${file} OPTIONS does not throw applyCors ReferenceError`, async () => {
    const mod = await import(`../utils/lms-handlers/${file}`);
    const handler = mod.default;
    assert.equal(typeof handler, "function", `${file} must default-export a handler`);

    const req = mockReq();
    const res = mockRes();
    let threw = null;
    try {
      await handler(req, res);
    } catch (err) {
      threw = err;
    }

    if (threw) {
      const msg = String(threw?.message || "");
      assert.equal(
        msg.includes("applyCors is not defined"),
        false,
        `handler ${file} threw applyCors ReferenceError`
      );
      // Other throws (DB, missing query, auth) are pre-existing — tolerate.
      // Note for the report: `${file} threw non-applyCors: ${msg}`
    } else {
      assert.ok(
        res.statusCode !== null || res.ended === true,
        `${file} returned without setting status or ending response`
      );
    }
  });
}
