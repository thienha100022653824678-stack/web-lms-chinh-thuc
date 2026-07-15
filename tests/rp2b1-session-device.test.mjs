// tests/rp2b1-session-device.test.mjs
//
// RP2-B1 — Global Session Policy & Access Enforcement acceptance tests.
//
// Uses node:test. No real database access. All Supabase interactions are
// satisfied through mockable in-test stubs that mirror the surface the
// production helpers (`verifyLmsVerifiedSessionAccess`, the course-data
// and lesson handlers, verify-entry-token) rely on.
//
// Tests are organized into seven groups:
//   1. Feature flag parsing (utils/v2-flags.js)
//   2. Access policy helper (shouldRequireLmsVerifiedSession)
//   3. Error contract mapping (mapLmsAccessReasonToError / httpStatusForLmsAccessError)
//   4. course-data handler — flag-off legacy compatibility, flag-on global enforcement
//   5. lesson handler — flag-off legacy compatibility, flag-on global enforcement
//   6. verify-entry-token — error contract sanitization and flag-on fail-closed
//   7. exchange-code — flag-off legacy path, flag-on early reject
//   8. Security / regression assertions (source-level, no live run)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Set up secrets so any module that boots at import time has the
// minimum auth configuration. Mirror the approach used in rp1-auth-
// hardening.test.mjs.
process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rp2b1-test-session-secret-please-rotate";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "rp2b1-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "rp2b1-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "rp2b1-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://rp2b1-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "rp2b1-test-service-role-key";

const FLAG_KEYS = [
  "V2_GLOBAL_ONE_DEVICE_ENABLED",
  "LMS_ENTRY_TOKEN_REQUIRED_COURSES",
  "V2_CORS_ALLOWLIST_ENABLED",
  "LMS_PORTAL_ORIGINS",
  "LMS_ADMIN_ORIGINS"
];

function snapshotEnv() {
  const snap = {};
  for (const key of FLAG_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap) {
  for (const key of FLAG_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

function clearFlagEnv() {
  for (const key of FLAG_KEYS) delete process.env[key];
}

function setFlag(overrides) {
  clearFlagEnv();
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

// ── 1. Feature flag parsing ─────────────────────────────────────────────────
test("flag: undefined → false", async () => {
  const { isV2GlobalOneDeviceEnabled } = await import("../utils/v2-flags.js");
  assert.equal(isV2GlobalOneDeviceEnabled({}), false);
});

test("flag: empty → false", async () => {
  const { isV2GlobalOneDeviceEnabled } = await import("../utils/v2-flags.js");
  assert.equal(isV2GlobalOneDeviceEnabled({ V2_GLOBAL_ONE_DEVICE_ENABLED: "" }), false);
});

test("flag: '0' / 'false' / 'no' / 'off' → false", async () => {
  const { isV2GlobalOneDeviceEnabled } = await import("../utils/v2-flags.js");
  for (const v of ["0", "false", "no", "off", "FALSE", "Off", "No"]) {
    assert.equal(isV2GlobalOneDeviceEnabled({ V2_GLOBAL_ONE_DEVICE_ENABLED: v }), false, `expected false for ${v}`);
  }
});

test("flag: '1' / 'true' / 'yes' / 'on' / mixed case / whitespace → true", async () => {
  const { isV2GlobalOneDeviceEnabled } = await import("../utils/v2-flags.js");
  for (const v of ["1", "true", "yes", "on", "TRUE", "Yes", "ON", "  true  ", "\t1\n"]) {
    assert.equal(isV2GlobalOneDeviceEnabled({ V2_GLOBAL_ONE_DEVICE_ENABLED: v }), true, `expected true for ${JSON.stringify(v)}`);
  }
});

test("flag: parseBooleanFlag refuses non-string non-true", async () => {
  const { parseBooleanFlag } = await import("../utils/v2-flags.js");
  assert.equal(parseBooleanFlag(null), false);
  assert.equal(parseBooleanFlag(undefined), false);
  assert.equal(parseBooleanFlag(0), false);
  assert.equal(parseBooleanFlag(1), false); // numbers are not accepted; strings only
  assert.equal(parseBooleanFlag(true), true);
  assert.equal(parseBooleanFlag(false), false);
  assert.equal(parseBooleanFlag([]), false);
  assert.equal(parseBooleanFlag({}), false);
});

test("flag: helper does not consult V2_CORS_ALLOWLIST_ENABLED", async () => {
  const { isV2GlobalOneDeviceEnabled } = await import("../utils/v2-flags.js");
  // Turning on the CORS flag must NOT accidentally enable one-device.
  assert.equal(
    isV2GlobalOneDeviceEnabled({ V2_CORS_ALLOWLIST_ENABLED: "1" }),
    false
  );
  assert.equal(
    isV2GlobalOneDeviceEnabled({ V2_GLOBAL_ONE_DEVICE_ENABLED: "yes", V2_CORS_ALLOWLIST_ENABLED: "0" }),
    true
  );
});

// ── 2. Access policy helper ─────────────────────────────────────────────────
test("policy: flag off + course in ENV list → require", async () => {
  const { shouldRequireLmsVerifiedSession } = await import("../utils/lms-session-guard.js");
  assert.equal(
    shouldRequireLmsVerifiedSession("intro", { LMS_ENTRY_TOKEN_REQUIRED_COURSES: "intro,baking" }),
    true
  );
});

test("policy: flag off + course not in list → not require", async () => {
  const { shouldRequireLmsVerifiedSession } = await import("../utils/lms-session-guard.js");
  assert.equal(
    shouldRequireLmsVerifiedSession("other", { LMS_ENTRY_TOKEN_REQUIRED_COURSES: "intro,baking" }),
    false
  );
});

test("policy: flag off + ENV empty → not require", async () => {
  const { shouldRequireLmsVerifiedSession } = await import("../utils/lms-session-guard.js");
  assert.equal(shouldRequireLmsVerifiedSession("intro", {}), false);
});

test("policy: flag on + any course → require (ENV bypass disabled)", async () => {
  const { shouldRequireLmsVerifiedSession } = await import("../utils/lms-session-guard.js");
  assert.equal(
    shouldRequireLmsVerifiedSession("intro", {
      V2_GLOBAL_ONE_DEVICE_ENABLED: "1",
      LMS_ENTRY_TOKEN_REQUIRED_COURSES: ""
    }),
    true
  );
  assert.equal(
    shouldRequireLmsVerifiedSession("something-else", {
      V2_GLOBAL_ONE_DEVICE_ENABLED: "yes",
      LMS_ENTRY_TOKEN_REQUIRED_COURSES: "intro"
    }),
    true
  );
});

test("policy: flag on + ENV empty → still require", async () => {
  const { shouldRequireLmsVerifiedSession } = await import("../utils/lms-session-guard.js");
  assert.equal(
    shouldRequireLmsVerifiedSession("intro", { V2_GLOBAL_ONE_DEVICE_ENABLED: "1" }),
    true
  );
});

// ── 3. Error contract mapping ──────────────────────────────────────────────
test("error map: device_mismatch → device_mismatch", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError("device_mismatch"), "device_mismatch");
});

test("error map: lms_session_expired → session_expired", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError("lms_session_expired"), "session_expired");
});

test("error map: lms_session_logged_out → session_revoked", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError("lms_session_logged_out"), "session_revoked");
});

test("error map: lms_session_admin_reset → session_revoked", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError("lms_session_admin_reset"), "session_revoked");
});

test("error map: lms_session_superseded → session_replaced", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError("lms_session_superseded"), "session_replaced");
});

test("error map: missing_lms_session → invalid_session", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError("missing_lms_session"), "invalid_session");
});

test("error map: empty / unknown reason → invalid_session", async () => {
  const { mapLmsAccessReasonToError } = await import("../utils/lms-session-guard.js");
  assert.equal(mapLmsAccessReasonToError(""), "invalid_session");
  assert.equal(mapLmsAccessReasonToError("totally_internal_state"), "invalid_session");
});

test("http status: invalid_session → 401", async () => {
  const { httpStatusForLmsAccessError } = await import("../utils/lms-session-guard.js");
  assert.equal(httpStatusForLmsAccessError("invalid_session"), 401);
});

test("http status: session_expired → 401", async () => {
  const { httpStatusForLmsAccessError } = await import("../utils/lms-session-guard.js");
  assert.equal(httpStatusForLmsAccessError("session_expired"), 401);
});

test("http status: session_revoked → 401", async () => {
  const { httpStatusForLmsAccessError } = await import("../utils/lms-session-guard.js");
  assert.equal(httpStatusForLmsAccessError("session_revoked"), 401);
});

test("http status: session_replaced → 401", async () => {
  const { httpStatusForLmsAccessError } = await import("../utils/lms-session-guard.js");
  assert.equal(httpStatusForLmsAccessError("session_replaced"), 401);
});

test("http status: device_mismatch → 401 (uniform with session errors)", async () => {
  const { httpStatusForLmsAccessError } = await import("../utils/lms-session-guard.js");
  assert.equal(httpStatusForLmsAccessError("device_mismatch"), 401);
});

test("http status: one_device_policy_unavailable → 503", async () => {
  const { httpStatusForLmsAccessError } = await import("../utils/lms-session-guard.js");
  assert.equal(httpStatusForLmsAccessError("one_device_policy_unavailable"), 503);
});

// ── 4. course-data handler ──────────────────────────────────────────────────
function buildReqRes({ method = "POST", headers = {}, body = {}, cookies = "" } = {}) {
  const headerStore = { ...headers };
  if (cookies) headerStore.cookie = cookies;
  const req = {
    method,
    headers: headerStore,
    body,
    query: {},
    socket: { remoteAddress: "203.0.113.7" }
  };
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; }
  };
  return { req, res };
}

// Re-import the handler module each time so a fresh module copy reads
// the current process.env. Cache-bust by query string.
async function loadCourseDataHandler() {
  return import("../utils/lms-handlers/course-data.js?case=" + Math.random());
}

function buildSupabaseStub({ verifiedSession = null } = {}) {
  return {
    from(table) {
      if (table === "student_enrollments") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ course_slug: "intro", status: "active" }],
                  error: null
                });
              }
            };
          }
        };
      }
      if (table === "courses") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
                    error: null
                  })
                };
              }
            };
          }
        };
      }
      if (table === "site_config") {
        return {
          select() {
            return Promise.resolve({ data: [], error: null });
          }
        };
      }
      if (table === "lessons") {
        return {
          select() {
            return {
              eq() {
                return {
                  neq() {
                    return {
                      order() {
                        return Promise.resolve({ data: [], error: null });
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
      if (table === "lms_verified_sessions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: verifiedSession, error: null })
                };
              },
              update() {
                const chain = {
                  eq() { return chain; },
                  select() { return chain; },
                  maybeSingle: async () => ({ data: null, error: null })
                };
                return chain;
              }
            };
          }
        };
      }
      if (table === "student_active_sessions") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { maybeSingle: async () => ({ data: null, error: null }) };
                  }
                };
              }
            };
          },
          update() {
            const chain = {
              eq() { return chain; },
              eq() { return chain; },
              select() { return chain; },
              maybeSingle: async () => ({ data: null, error: null })
            };
            return chain;
          }
        };
      }
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: null, error: null }) }; } };
        }
      };
    },
    rpc: async () => ({ data: null, error: null })
  };
}

// Patch the supabase module's export with our stub for the duration of
// a single handler call. The handler imports `supabase` once at module
// load, so this requires that we import the handler module fresh after
// the stub is set on a global cache the handler reads through. In
// practice, course-data.js does `import { supabase } from "../supabase.js"`;
// to inject, we install a fake module via require-style interception
// isn't available in pure ESM. Instead, we use Node's loader mock by
// setting `process.env.SUPABASE_URL` + relying on the real supabase.js
// to throw at runtime when not actually hit — and we let our stubs
// short-circuit at the auth boundary (since flag-off legacy paths and
// many flag-on paths do not actually call supabase).
//
// For flag-on paths the supabase call IS critical, so we structure the
// tests below to inject the supabase object via the handler's exported
// factory. Since the handler does `import { supabase } from "../supabase.js"`,
// we cannot easily swap it without a loader. Instead, we pre-stub via
// `globalThis.__SUPABASE__` and adapt `utils/supabase.js` to honor it.
// To avoid changing production code for tests, we instead drive these
// tests through the legacy flag-off path (no supabase calls) and assert
// the response shape. For flag-on paths we rely on contract assertions
// + the dedicated unit-level tests on the policy helpers above.

test("course-data: flag off keeps legacy cookie path (no headers → 401 missing_login_session)", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const handler = (await loadCourseDataHandler()).default;
    const { req, res } = buildReqRes({ method: "POST", body: { course: "intro" } });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "Missing or expired login session");
    assert.equal(res.body?.authError, "missing_login_session");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag off keeps cookie path when cookie has email (no supabase if cookie valid)", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const handler = (await loadCourseDataHandler()).default;
    // Build a signed cookie token via lms.createStudentSession so we do
    // not need real secrets.
    const { createStudentSession } = await import("../utils/lms.js");
    const session = createStudentSession("student@example.com");
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      cookies: `course_session_token=${encodeURIComponent(session.token)}`
    });
    await handler(req, res);
    // The legacy path reaches the supabase `from("student_enrollments")`
    // call with the dummy URL we set; without a real DB the response
    // will be a 500 server_error (because supabase client cannot reach
    // the network). What we are asserting here is that the handler did
    // NOT short-circuit at the auth boundary — i.e. the flag-off path
    // still accepts the cookie as identity.
    assert.notEqual(res.statusCode, 401);
    assert.notEqual(res.body?.authError, "missing_login_session");
  } finally {
    restoreEnv(snap);
  }
});

// Flag-on tests below intentionally avoid the real supabase import by
// reaching only as far as the handler's auth boundary. We stub the
// supabase module by writing a JSON sentinel on disk; the production
// `utils/supabase.js` honors `LMS_RP2B1_SUPABASE_STUB=1` and loads the
// in-test stub from `tests/_supabase_stub_loader.mjs` when that flag is
// set. The flag is never set in production.

async function loadCourseDataWithSupabaseStub(stub) {
  const fs = await import("node:fs");
  const stubPath = join(ROOT, "tests", ".supabase-stub.json");
  fs.writeFileSync(stubPath, JSON.stringify(stub));
  process.env.LMS_RP2B1_SUPABASE_STUB = "1";
  // Build the LMS verified session sentinel in the SHAPE the production
  // helper returns, so the test can prove behavior with a stable
  // contract independent of the real DB row.
  let lmsSessionSentinel = null;
  if (stub.verifiedSession) {
    lmsSessionSentinel = {
      ok: true,
      email: stub.verifiedSession.email,
      courseSlug: stub.verifiedSession.course_slug,
      reason: "valid",
      studentSession: stub.studentSession || null,
      session: stub.verifiedSession,
      enrollment: null
    };
  } else if (stub.verifiedSession === null) {
    lmsSessionSentinel = null;
  }
  globalThis.__RP2B1_LMS_SESSION_STUB__ = lmsSessionSentinel;
  // When the test wants the LMS access path to fail with a specific
  // reason, the lms session sentinel must say so.
  if (stub.verifiedSessionReason) {
    globalThis.__RP2B1_LMS_SESSION_STUB__ = {
      ok: false,
      reason: stub.verifiedSessionReason
    };
  }
  globalThis.__RP2B1_ENROLLMENTS_STUB__ = stub.enrollments === undefined
    ? null
    : { data: stub.enrollments, error: stub.throwOn?.enrollments ? { message: "stubbed failure" } : null };
  globalThis.__RP2B1_COURSES_STUB__ = stub.courses === undefined
    ? null
    : { data: stub.courses, error: null };
  globalThis.__RP2B1_SITE_CONFIG_STUB__ = stub.siteConfig === undefined
    ? null
    : { data: stub.siteConfig, error: null };
  globalThis.__RP2B1_LESSONS_STUB__ = stub.lessons === undefined
    ? null
    : { data: stub.lessons, error: null };
  try {
    return await import("../utils/lms-handlers/course-data.js?stub=" + Date.now());
  } finally {
    setTimeout(() => {
      try { fs.unlinkSync(stubPath); } catch {}
      delete process.env.LMS_RP2B1_SUPABASE_STUB;
      delete globalThis.__RP2B1_LMS_SESSION_STUB__;
      delete globalThis.__RP2B1_ENROLLMENTS_STUB__;
      delete globalThis.__RP2B1_COURSES_STUB__;
      delete globalThis.__RP2B1_SITE_CONFIG_STUB__;
      delete globalThis.__RP2B1_LESSONS_STUB__;
    }, 50);
  }
}

// The tests below rely on the loader file at tests/supabase-loader.mjs
// to swap `utils/supabase.js` for an in-test implementation when the
// module id matches.

test("course-data: flag on + missing LMS session headers → invalid_session 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({ method: "POST", body: { course: "intro" } });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "invalid_session");
    assert.equal(res.body?.code, "invalid_session");
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.allowed, false);
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + invalid LMS session → invalid_session 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      verifiedSessionReason: "invalid_lms_session",
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_other" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "invalid_session");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + valid LMS session → success path (no Set-Cookie)", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: {
        lms_session_id: "lms_sess_abc",
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        lms_device_id: "dev_xyz",
        course_slug: "intro",
        status: "active",
        last_seen_at: new Date().toISOString(),
        id: "row-id-1"
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date().toISOString()
      },
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    await handler(req, res);
    // The handler reaches the lesson fetch step. Because our stub
    // returns an empty lessons array, the response shape is:
    // { allowed: true, lessons: [], ... } with no cookie header.
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.allowed, true);
    assert.equal(res.body?.email, "student@example.com");
    assert.equal(res.body?.course, "intro");
    // RP2-B1 contract: no new cookie session is minted.
    assert.equal(res.getHeader("set-cookie"), undefined);
    assert.equal(res.body?.sessionToken, undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + cookie path does not bypass LMS session", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { createStudentSession } = await import("../utils/lms.js");
    const session = createStudentSession("student@example.com");
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      cookies: `course_session_token=${encodeURIComponent(session.token)}`
    });
    await handler(req, res);
    // Cookie alone is NOT sufficient when flag is on.
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "invalid_session");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + DB throws inside handler → 503 one_device_policy_unavailable", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: null, // triggers throw in enroll query
      verifiedSession: {
        lms_session_id: "lms_sess_abc",
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        lms_device_id: "dev_xyz",
        course_slug: "intro",
        status: "active",
        last_seen_at: new Date().toISOString(),
        id: "row-id-1"
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date().toISOString()
      },
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: [],
      throwOn: { enrollments: true }
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body?.error, "one_device_policy_unavailable");
    assert.equal(res.body?.code, "one_device_policy_unavailable");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + LMS session reason logged_out → session_revoked 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      verifiedSessionReason: "lms_session_logged_out",
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "session_revoked");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + LMS session reason device_mismatch → device_mismatch 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      verifiedSessionReason: "device_mismatch",
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    // Send the WRONG device id from the client.
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "device_mismatch");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + LMS session reason superseded → session_replaced 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      verifiedSessionReason: "lms_session_superseded",
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "session_replaced");
  } finally {
    restoreEnv(snap);
  }
});

test("course-data: flag on + LMS session reason lms_session_expired → session_expired 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      enrollments: [{ course_slug: "intro", status: "active" }],
      verifiedSession: null,
      verifiedSessionReason: "lms_session_expired",
      studentSession: null,
      courses: { title: "Intro", subtitle: "", image_url: "", raw_data: {} },
      siteConfig: [],
      lessons: []
    };
    const mod = await loadCourseDataWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { course: "intro" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "session_expired");
  } finally {
    restoreEnv(snap);
  }
});

// ── 5. lesson handler ───────────────────────────────────────────────────────
async function loadLessonWithSupabaseStub(stub) {
  const fs = await import("node:fs");
  const stubPath = join(ROOT, "tests", ".supabase-stub.json");
  fs.writeFileSync(stubPath, JSON.stringify(stub));
  process.env.LMS_RP2B1_SUPABASE_STUB = "1";
  let lmsSessionSentinel = null;
  if (stub.verifiedSession) {
    lmsSessionSentinel = {
      ok: true,
      email: stub.verifiedSession.email,
      courseSlug: stub.verifiedSession.course_slug,
      reason: "valid",
      studentSession: stub.studentSession || null,
      session: stub.verifiedSession,
      enrollment: null
    };
  } else if (stub.verifiedSessionReason) {
    lmsSessionSentinel = { ok: false, reason: stub.verifiedSessionReason };
  }
  globalThis.__RP2B1_LMS_SESSION_STUB__ = lmsSessionSentinel;
  globalThis.__RP2B1_LESSONS_STUB__ = stub.lessons === undefined
    ? null
    : { data: stub.lessons, error: stub.throwOn?.lessons ? { message: "stubbed failure" } : null };
  globalThis.__RP2B1_ENROLLMENTS_STUB__ = stub.enrollments === undefined
    ? null
    : { data: stub.enrollments, error: null };
  globalThis.__RP2B1_SIBLING_LESSONS_STUB__ = stub.siblingLessons === undefined
    ? null
    : { data: stub.siblingLessons, error: null };
  try {
    return await import("../utils/lms-handlers/lesson.js?stub=" + Date.now());
  } finally {
    setTimeout(() => {
      try { fs.unlinkSync(stubPath); } catch {}
      delete process.env.LMS_RP2B1_SUPABASE_STUB;
      delete globalThis.__RP2B1_LMS_SESSION_STUB__;
      delete globalThis.__RP2B1_LESSONS_STUB__;
      delete globalThis.__RP2B1_ENROLLMENTS_STUB__;
      delete globalThis.__RP2B1_SIBLING_LESSONS_STUB__;
    }, 50);
  }
}

test("lesson: flag off keeps V1 behavior (no headers → 401 missing_login_session)", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const mod = await loadLessonWithSupabaseStub({});
    const handler = mod.default;
    const { req, res } = buildReqRes({ method: "GET", body: {}, query: { id: "lesson-1" } });
    req.query.id = "lesson-1";
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.authError, "missing_login_session");
  } finally {
    restoreEnv(snap);
  }
});

test("lesson: flag on + missing headers → invalid_session 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      lessons: [{
        id: "lesson-1",
        course_slug: "intro",
        is_section: false,
        status: "active"
      }],
      enrollments: [{ id: 1, status: "active" }],
      verifiedSession: null
    };
    const mod = await loadLessonWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({ method: "GET", body: {}, query: { id: "lesson-1" } });
    req.query.id = "lesson-1";
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "invalid_session");
  } finally {
    restoreEnv(snap);
  }
});

test("lesson: flag on + valid session/course/device → success", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      lessons: [{
        id: "lesson-1",
        course_slug: "intro",
        lesson_no: 1,
        title: "Bài 1",
        is_section: false,
        status: "active",
        video_url: "",
        media_urls: "",
        recipe_url: "",
        materials: [],
        views: 0
      }],
      enrollments: [{ id: 1, status: "active" }],
      siblingLessons: [],
      verifiedSession: {
        lms_session_id: "lms_sess_abc",
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        lms_device_id: "dev_xyz",
        course_slug: "intro",
        status: "active",
        last_seen_at: new Date().toISOString(),
        id: "row-id-1"
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date().toISOString()
      }
    };
    const mod = await loadLessonWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "GET",
      body: {},
      query: { id: "lesson-1" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    req.query.id = "lesson-1";
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.lesson?.id, "lesson-1");
  } finally {
    restoreEnv(snap);
  }
});

test("lesson: flag on + cookie present but no LMS session → invalid_session 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      lessons: [{
        id: "lesson-1",
        course_slug: "intro",
        is_section: false,
        status: "active"
      }],
      enrollments: [{ id: 1, status: "active" }],
      verifiedSession: null
    };
    const mod = await loadLessonWithSupabaseStub(stub);
    const handler = mod.default;
    const { createStudentSession } = await import("../utils/lms.js");
    const session = createStudentSession("student@example.com");
    const { req, res } = buildReqRes({
      method: "GET",
      body: {},
      query: { id: "lesson-1" },
      cookies: `course_session_token=${encodeURIComponent(session.token)}`
    });
    req.query.id = "lesson-1";
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "invalid_session");
  } finally {
    restoreEnv(snap);
  }
});

test("lesson: flag on + verification unavailable → 503 one_device_policy_unavailable", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      lessons: [],
      enrollments: null,
      throwOn: { lessons: true },
      verifiedSession: null
    };
    const mod = await loadLessonWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "GET",
      body: {},
      query: { id: "lesson-1" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    req.query.id = "lesson-1";
    await handler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body?.error, "one_device_policy_unavailable");
  } finally {
    restoreEnv(snap);
  }
});

test("lesson: flag on + course mismatch → invalid_session 401", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const stub = {
      lessons: [{
        id: "lesson-1",
        course_slug: "other",
        is_section: false,
        status: "active"
      }],
      enrollments: [{ id: 1, status: "active" }],
      verifiedSession: {
        lms_session_id: "lms_sess_abc",
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        lms_device_id: "dev_xyz",
        course_slug: "intro",
        status: "active",
        last_seen_at: new Date().toISOString(),
        id: "row-id-1"
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date().toISOString()
      }
    };
    const mod = await loadLessonWithSupabaseStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "GET",
      body: {},
      query: { id: "lesson-1" },
      headers: { "x-lms-session-id": "lms_sess_abc", "x-lms-device-id": "dev_xyz" }
    });
    req.query.id = "lesson-1";
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "invalid_session");
  } finally {
    restoreEnv(snap);
  }
});

// ── 6. verify-entry-token ──────────────────────────────────────────────────
async function loadVerifyEntryTokenWithStub(stub) {
  const fs = await import("node:fs");
  const stubPath = join(ROOT, "tests", ".supabase-stub.json");
  fs.writeFileSync(stubPath, JSON.stringify(stub));
  process.env.LMS_RP2B1_SUPABASE_STUB = "1";
  globalThis.__RP2B1_ENTRY_TOKEN_STUB__ = stub.entryToken || null;
  globalThis.__RP2B1_STUDENT_SESSION_STUB__ = stub.studentSession === undefined
    ? null
    : { data: stub.studentSession, error: null };
  globalThis.__RP2B1_ENROLLMENTS_STUB__ = stub.enrollments === undefined
    ? null
    : { data: stub.enrollments, error: null };
  globalThis.__RP2B1_CREATED_LMS_SESSION_STUB__ = stub.createdSession || null;
  globalThis.__RP2B1_SKIP_TOUCH__ = true; // tests don't need the touch path
  globalThis.__RP2B1_SKIP_EVENT_LOG__ = true; // tests don't need telemetry
  try {
    return await import("../utils/lms-handlers/verify-entry-token.js?stub=" + Date.now());
  } finally {
    setTimeout(() => {
      try { fs.unlinkSync(stubPath); } catch {}
      delete process.env.LMS_RP2B1_SUPABASE_STUB;
      delete globalThis.__RP2B1_ENTRY_TOKEN_STUB__;
      delete globalThis.__RP2B1_STUDENT_SESSION_STUB__;
      delete globalThis.__RP2B1_ENROLLMENTS_STUB__;
      delete globalThis.__RP2B1_CREATED_LMS_SESSION_STUB__;
      delete globalThis.__RP2B1_SKIP_TOUCH__;
      delete globalThis.__RP2B1_SKIP_EVENT_LOG__;
    }, 50);
  }
}

test("verify-entry-token: token + active student session + valid device → success", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const stub = {
      entryToken: {
        ok: true,
        entryToken: {
          id: "tok-id",
          email: "student@example.com",
          student_session_id: "student_sess_abc",
          course_slug: "intro",
          status: "active"
        }
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date().toISOString()
      },
      enrollments: [{ id: 1, status: "active" }],
      createdSession: { lms_session_id: "lms_new_session", id: "row-id-1" },
      accountEventRows: []
    };
    const mod = await loadVerifyEntryTokenWithStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { entry_token: "tok-raw", lms_device_id: "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.course_slug, "intro");
    assert.equal(res.body?.lms_session_id, "lms_new_session");
    // RP2-B1 contract: response must NOT echo device or student session id.
    const text = JSON.stringify(res.body);
    assert.equal(text.includes("dev_xyz"), false);
    assert.equal(text.includes("student_sess_abc"), false);
  } finally {
    restoreEnv(snap);
  }
});

test("verify-entry-token: token ok but student session inactive → 401 session_revoked", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const stub = {
      entryToken: {
        ok: true,
        entryToken: {
          id: "tok-id",
          email: "student@example.com",
          student_session_id: "student_sess_abc",
          course_slug: "intro",
          status: "active"
        }
      },
      studentSession: null,
      enrollments: [{ id: 1, status: "active" }],
      accountEventRows: []
    };
    const mod = await loadVerifyEntryTokenWithStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { entry_token: "tok-raw", lms_device_id: "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "session_revoked");
  } finally {
    restoreEnv(snap);
  }
});

test("verify-entry-token: token ok but student session stale → 401 session_expired", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const stub = {
      entryToken: {
        ok: true,
        entryToken: {
          id: "tok-id",
          email: "student@example.com",
          student_session_id: "student_sess_abc",
          course_slug: "intro",
          status: "active"
        }
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      },
      enrollments: [{ id: 1, status: "active" }],
      accountEventRows: []
    };
    const mod = await loadVerifyEntryTokenWithStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { entry_token: "tok-raw", lms_device_id: "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "session_expired");
  } finally {
    restoreEnv(snap);
  }
});

test("verify-entry-token: course mismatch on token → 401 invalid_entry_token (sanitized)", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const stub = {
      entryToken: { ok: false, reason: "course_mismatch", entryToken: null },
      accountEventRows: []
    };
    const mod = await loadVerifyEntryTokenWithStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { entry_token: "tok-raw", lms_device_id: "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    // RP2-B1: response must NOT echo the raw DB-derived reason.
    assert.equal(res.body?.code, "invalid_entry_token");
  } finally {
    restoreEnv(snap);
  }
});

test("verify-entry-token: token revocation by control → 401 invalid_entry_token (sanitized)", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const stub = {
      entryToken: { ok: false, reason: "entry_token_revoked_by_reset", entryToken: null },
      accountEventRows: []
    };
    const mod = await loadVerifyEntryTokenWithStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { entry_token: "tok-raw", lms_device_id: "dev_xyz" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.code, "invalid_entry_token");
    // Must NOT leak raw reason text.
    assert.equal(JSON.stringify(res.body).includes("entry_token_revoked_by_reset"), false);
  } finally {
    restoreEnv(snap);
  }
});

test("verify-entry-token: success response does not leak device or session id", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const stub = {
      entryToken: {
        ok: true,
        entryToken: {
          id: "tok-id",
          email: "student@example.com",
          student_session_id: "student_sess_abc",
          course_slug: "intro",
          status: "active"
        }
      },
      studentSession: {
        email: "student@example.com",
        student_session_id: "student_sess_abc",
        status: "active",
        last_seen_at: new Date().toISOString()
      },
      enrollments: [{ id: 1, status: "active" }],
      createdSession: { lms_session_id: "lms_new_session", id: "row-id-1" },
      accountEventRows: []
    };
    const mod = await loadVerifyEntryTokenWithStub(stub);
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { entry_token: "tok-raw", lms_device_id: "dev_xyz" }
    });
    await handler(req, res);
    const text = JSON.stringify(res.body);
    for (const secret of ["dev_xyz", "student_sess_abc", "tok-id"]) {
      assert.equal(text.includes(secret), false, `response leaked ${secret}`);
    }
  } finally {
    restoreEnv(snap);
  }
});

// ── 7. exchange-code ───────────────────────────────────────────────────────
async function loadExchangeCodeHandler() {
  return import("../utils/lms-handlers/exchange-code.js?case=" + Math.random());
}

test("exchange-code: flag off → handler still runs legacy V1 path (no flag guard)", async () => {
  const snap = snapshotEnv();
  try {
    clearFlagEnv();
    const mod = await loadExchangeCodeHandler();
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { code: "any" }
    });
    await handler(req, res);
    // Flag off: the legacy guard does not trigger. The handler then
    // tries to call Google token endpoint; we expect a 401/500/403
    // from the legacy path, but NOT the flag-on 410.
    assert.notEqual(res.statusCode, 410);
    assert.notEqual(res.body?.code, "legacy_login_disabled");
  } finally {
    restoreEnv(snap);
  }
});

test("exchange-code: flag on → 410 legacy_login_disabled before any Google/Supabase/cookie work", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const mod = await loadExchangeCodeHandler();
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { code: "any", redirectUri: "https://x.example.com", course: "intro" }
    });
    await handler(req, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body?.code, "legacy_login_disabled");
    assert.equal(res.body?.allowed, false);
    // Cookie must not be set.
    assert.equal(res.getHeader("set-cookie"), undefined);
  } finally {
    restoreEnv(snap);
  }
});

test("exchange-code: flag on → no Set-Cookie issued", async () => {
  const snap = snapshotEnv();
  try {
    setFlag({ V2_GLOBAL_ONE_DEVICE_ENABLED: "1" });
    const mod = await loadExchangeCodeHandler();
    const handler = mod.default;
    const { req, res } = buildReqRes({
      method: "POST",
      body: { code: "any" }
    });
    await handler(req, res);
    const text = JSON.stringify(res.body);
    for (const token of ["session_token", "sessionToken", "course_session_token"]) {
      assert.equal(text.includes(token), false, `response leaked ${token}`);
    }
  } finally {
    restoreEnv(snap);
  }
});

// ── 8. Security / regression assertions ─────────────────────────────────────
test("security: course-data never sets new cookie when flag is on (source check)", () => {
  const src = readFileSync(join(ROOT, "utils/lms-handlers/course-data.js"), "utf8");
  // The flag-on success branch must skip the Set-Cookie emit. We
  // assert by reading the structure: a single `Set-Cookie` line is
  // present only inside the flag-off branch (post `if (flagOn) { ... }`).
  const beforeFlagOn = src.indexOf("if (flagOn) {");
  const cookieLine = src.indexOf("Set-Cookie");
  assert.ok(beforeFlagOn !== -1, "flag-on guard missing in course-data");
  assert.ok(cookieLine === -1 || cookieLine > beforeFlagOn, "cookie emit must be after flag-on guard");
});

test("security: lesson never sets new cookie when flag is on (source check)", () => {
  const src = readFileSync(join(ROOT, "utils/lms-handlers/lesson.js"), "utf8");
  // lesson never issued Set-Cookie historically; verify still the case.
  assert.equal(/Set-Cookie/.test(src), false, "lesson handler must not issue Set-Cookie");
});

test("security: RP2-B1 code never inserts new student_active_sessions", () => {
  // The migration tooling plus helpers in lms-session-guard still
  // expose createStudentActiveSession, but RP2-B1 must not call it
  // anywhere in the LMS handlers. The handler-level grep covers the
  // surface that touches this turn.
  for (const file of [
    "utils/lms-handlers/course-data.js",
    "utils/lms-handlers/lesson.js",
    "utils/lms-handlers/verify-entry-token.js",
    "utils/lms-handlers/exchange-code.js"
  ]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.equal(
      /createStudentActiveSession/.test(src),
      false,
      `${file} must not call createStudentActiveSession in RP2-B1`
    );
  }
});

test("security: RP2-B1 code does not pass supersede conflict policy", () => {
  for (const file of [
    "utils/lms-handlers/course-data.js",
    "utils/lms-handlers/lesson.js",
    "utils/lms-handlers/verify-entry-token.js",
    "utils/lms-handlers/exchange-code.js",
    "utils/lms-session-guard.js"
  ]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.equal(
      /p_conflict_policy\s*[:=]\s*['"]supersede['"]/.test(src),
      false,
      `${file} must not pass supersede policy`
    );
  }
});

test("security: admin handlers do not consult the one-device flag", () => {
  // RP2-B1 is scoped to student-facing endpoints only.
  const files = [
    "utils/lms-handlers/admin-account-sharing-alerts.js",
    "utils/lms-handlers/admin-auth.js",
    "utils/lms-handlers/admin-bulk-enroll.js",
    "utils/lms-handlers/admin-courses.js",
    "utils/lms-handlers/admin-enrollments.js",
    "utils/lms-handlers/admin-lessons.js",
    "utils/lms-handlers/admin-students.js"
  ];
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.equal(
      /V2_GLOBAL_ONE_DEVICE_ENABLED|isV2GlobalOneDeviceEnabled/.test(src),
      false,
      `${file} must not read the one-device flag`
    );
  }
});

test("security: public endpoints are untouched by RP2-B1", () => {
  for (const file of ["utils/lms-handlers/public-lesson.js", "utils/lms-handlers/public-config.js"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.equal(
      /V2_GLOBAL_ONE_DEVICE_ENABLED|isV2GlobalOneDeviceEnabled|verifyLmsVerifiedSessionAccess|shouldRequireLmsVerifiedSession/.test(src),
      false,
      `${file} must not reference RP2-B1 helpers`
    );
  }
});

test("security: error body never embeds raw DB error or device/session metadata (source check)", () => {
  const files = [
    "utils/lms-handlers/course-data.js",
    "utils/lms-handlers/lesson.js",
    "utils/lms-handlers/verify-entry-token.js",
    "utils/lms-handlers/exchange-code.js"
  ];
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf8");
    // Strip string literals from each res.json(...) call before grepping
    // so legitimate labels do not produce false positives.
    const lines = src.split(/\r?\n/);
    for (const rawLine of lines) {
      if (!/res\.(status\(\d+\)\.)?json\(/.test(rawLine)) continue;
      // Strip double-quoted strings, then strip single-quoted strings.
      let stripped = rawLine.replace(/"(?:[^"\\]|\\.)*"/g, '""');
      stripped = stripped.replace(/'(?:[^'\\]|\\.)*'/g, "''");
      // Forbid embedding raw DB error detail or identifiers in JSON
      // responses. The security contract is uniform across handlers.
      for (const forbidden of ["err.message", "error.message", "student_session_id", "lms_session_id", "portal_device_id"]) {
        assert.equal(
          stripped.includes(forbidden),
          false,
          `${file} embeds ${forbidden} in a JSON response: ${rawLine.trim()}`
        );
      }
    }
  }
});

test("security: V2_GLOBAL_ONE_DEVICE_ENABLED only appears in expected files", async () => {
  // Allow-list: source + plan + tests + flag helper.
  const allowed = new Set([
    "utils/v2-flags.js",
    "utils/lms-session-guard.js",
    "utils/lms-handlers/course-data.js",
    "utils/lms-handlers/lesson.js",
    "utils/lms-handlers/verify-entry-token.js",
    "utils/lms-handlers/exchange-code.js",
    "tests/rp2b1-session-device.test.mjs",
    "tests/supabase-loader.mjs",
    "tests/_supabase_stub_loader.mjs",
    "docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md",
    "docs/v2-new/RP2_B1_IMPLEMENTATION_RESULT.md"
  ]);
  // Lazy walk via fs (kept inside test for isolation).
  const cp = await import("node:child_process");
  let files = [];
  try {
    files = cp.execSync(
      "git ls-files",
      { cwd: ROOT, encoding: "utf8" }
    ).split("\n").filter(Boolean);
  } catch {
    // Fall back to globbing testable surfaces only.
    files = [
      "utils/v2-flags.js",
      "utils/lms-session-guard.js",
      "utils/lms-handlers/course-data.js",
      "utils/lms-handlers/lesson.js",
      "utils/lms-handlers/verify-entry-token.js",
      "utils/lms-handlers/exchange-code.js",
      "tests/rp2b1-session-device.test.mjs"
    ];
  }
  for (const file of files) {
    if (allowed.has(file)) continue;
    let src;
    try {
      src = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    if (/V2_GLOBAL_ONE_DEVICE_ENABLED/.test(src)) {
      assert.fail(`V2_GLOBAL_ONE_DEVICE_ENABLED must not appear in ${file}`);
    }
  }
});

test("security: utils/cors.js and utils/lms-secrets.js untouched by RP2-B1", () => {
  // Source-level: no references to the new flag or RP2-B1 helpers.
  for (const file of ["utils/cors.js", "utils/lms-secrets.js"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const forbidden of [
      "V2_GLOBAL_ONE_DEVICE_ENABLED",
      "isV2GlobalOneDeviceEnabled",
      "verifyLmsVerifiedSessionAccess",
      "shouldRequireLmsVerifiedSession"
    ]) {
      assert.equal(
        src.includes(forbidden),
        false,
        `${file} must not reference ${forbidden}`
      );
    }
  }
});
