// tests/v3-session.test.mjs
// V3 Phase 4 (②③) — unified opaque session + server device credential. node:test.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "v3sess-test-session-secret-please-rotate";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3sess-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3sess-test-service-role-key";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.v3-session.json");
process.env.LMS_SUPABASE_STUB_FILE = STUB_FILE;
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const rc = await import("../utils/runtime-controller.js");
const s = await import("../utils/v3-session.js");
const { hashToken } = await import("../utils/lms-session-guard.js");

function setMode(mode) {
  rc._test.reset();
  writeStub({
    platform_runtime_config: {
      active_mode: mode, v2_shadow_mode: false, v3_shadow_mode: false,
      kill_switch: false, updated_at: "2026-07-15T00:00:00Z",
    },
  });
}

test("issueSessionToken: opaque token whose hash matches, and tokens are unique", () => {
  const a = s.issueSessionToken();
  const b = s.issueSessionToken();
  assert.equal(hashToken(a.token), a.tokenHash);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.tokenHash, b.tokenHash);
  // Opaque: no dots/claims like a JWT.
  assert.equal(a.token.includes("."), false);
});

test("device credential round-trips true; tampering verifies false", () => {
  const { deviceId, credential } = s.mintDeviceCredential("sess_123");
  assert.equal(s.verifyDeviceCredential("sess_123", deviceId, credential), true);
  // Tampered credential.
  assert.equal(s.verifyDeviceCredential("sess_123", deviceId, credential + "x"), false);
  // Wrong device id.
  assert.equal(s.verifyDeviceCredential("sess_123", "dev_other", credential), false);
  // Wrong session.
  assert.equal(s.verifyDeviceCredential("sess_999", deviceId, credential), false);
});

test("mintDeviceCredential requires a session id", () => {
  assert.throws(() => s.mintDeviceCredential(""), /sessionId is required/i);
});

test("sessionCookie is httpOnly + SameSite=Lax + Secure, clears with Max-Age=0", () => {
  const cookie = s.sessionCookie("opaque-token", 60 * 60 * 1000);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=3600/);
  const cleared = s.sessionCookie("", 0);
  assert.match(cleared, /Max-Age=0/);
});

test("slidingExpiry: expired past the idle window, fresh refreshAt otherwise", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const stale = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(now - 1 * 60 * 60 * 1000).toISOString();
  assert.equal(s.slidingExpiry(stale, 24, now).expired, true);
  const r = s.slidingExpiry(fresh, 24, now);
  assert.equal(r.expired, false);
  assert.equal(r.refreshAt, new Date(now).toISOString());
  // Missing last_seen => expired (fail-closed).
  assert.equal(s.slidingExpiry(null, 24, now).expired, true);
});

test("beginV3Session refuses outside v3 mode", async () => {
  setMode("v1");
  await assert.rejects(() => s.beginV3Session("sess_123"), /v3 mode/i);
  clearStub();
});

test("beginV3Session mints a full bundle in v3 mode", async () => {
  setMode("v3");
  const bundle = await s.beginV3Session("sess_123");
  assert.equal(hashToken(bundle.token), bundle.tokenHash);
  assert.equal(s.verifyDeviceCredential("sess_123", bundle.deviceId, bundle.credential), true);
  clearStub();
});
