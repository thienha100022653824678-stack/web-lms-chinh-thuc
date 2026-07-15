// tests/rp2-cors.test.mjs
//
// RP2-A — Centralized CORS policy tests.
//
// Uses Node's built-in test runner. No network, no production calls.
// Only public/example origins appear in fixtures.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Env harness ────────────────────────────────────────────────────────────
const ENV_KEYS = [
  "V2_CORS_ALLOWLIST_ENABLED",
  "LMS_PORTAL_ORIGINS",
  "LMS_ADMIN_ORIGINS",
  "LMS_PREVIEW_ORIGIN_SUFFIX",
  "NODE_ENV",
  "VERCEL_ENV"
];

function snapshotEnv() {
  const snap = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

function setEnv(overrides) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

// ── Minimal req/res doubles ─────────────────────────────────────────────────
function makeReq({ method = "GET", origin } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  return { method, headers };
}

function makeRes() {
  const headers = {};
  return {
    _headers: headers,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    }
  };
}

// Fresh import each time so module-level env reads are re-evaluated. The
// helper reads env at call time, so a single import is fine; but importing
// with a cache-busting query keeps tests independent if that changes.
async function loadCors() {
  return import("../utils/cors.js");
}

// ── 1. parse CSV origin ──────────────────────────────────────────────────────
test("parseOriginList parses valid CSV origins", async () => {
  const { parseOriginList } = await loadCors();
  const list = parseOriginList("https://www.yeunauan.live,https://admin.example.com");
  assert.deepEqual(list, ["https://www.yeunauan.live", "https://admin.example.com"]);
});

// ── 2. trim + drop empties ────────────────────────────────────────────────────
test("parseOriginList trims whitespace and drops empty entries", async () => {
  const { parseOriginList } = await loadCors();
  const list = parseOriginList("  https://a.example.com ,, , https://b.example.com  ");
  assert.deepEqual(list, ["https://a.example.com", "https://b.example.com"]);
});

// ── 3. reject ENV origin with path ────────────────────────────────────────────
test("parseOriginList rejects origins that contain a path/query/hash", async () => {
  const { parseOriginList } = await loadCors();
  const list = parseOriginList("https://a.example.com/admin,https://b.example.com?x=1,https://c.example.com#f");
  assert.deepEqual(list, []);
});

// ── 4. reject non-http(s) protocol ────────────────────────────────────────────
test("parseOriginList rejects non-http/https protocols", async () => {
  const { parseOriginList } = await loadCors();
  const list = parseOriginList("ftp://a.example.com,javascript:alert(1),file:///etc,https://ok.example.com");
  assert.deepEqual(list, ["https://ok.example.com"]);
});

// ── 5. portal origin echoed ───────────────────────────────────────────────────
test("portal mode echoes an allowed origin exactly", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST", origin: "https://www.yeunauan.live" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, false);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), "https://www.yeunauan.live");
  } finally {
    restoreEnv(snap);
  }
});

// ── 6. admin origin echoed ────────────────────────────────────────────────────
test("admin mode echoes an allowed origin exactly", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_ADMIN_ORIGINS: "https://admin.example.com"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST", origin: "https://admin.example.com" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "admin" });
    assert.equal(result.handled, false);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), "https://admin.example.com");
  } finally {
    restoreEnv(snap);
  }
});

// ── 7. Vary: Origin present ───────────────────────────────────────────────────
test("echoed origin sets Vary: Origin", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST", origin: "https://www.yeunauan.live" });
    const res = makeRes();
    applyCors(req, res, { mode: "portal" });
    assert.match(String(res.getHeader("Vary")), /Origin/);
  } finally {
    restoreEnv(snap);
  }
});

// ── 8. invalid origin has no ACAO ─────────────────────────────────────────────
test("forbidden origin does not receive Access-Control-Allow-Origin", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "GET", origin: "https://evil.example.com" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, true);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), undefined);
  } finally {
    restoreEnv(snap);
  }
});

// ── 9. preflight forbidden origin → 403 ───────────────────────────────────────
test("preflight from forbidden origin returns 403 with cors_origin_forbidden", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "OPTIONS", origin: "https://evil.example.com" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, true);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "cors_origin_forbidden");
    // Must not leak the full allowlist.
    assert.ok(!JSON.stringify(result.body).includes("yeunauan"));
  } finally {
    restoreEnv(snap);
  }
});

// ── 10. preflight allowed origin → success ────────────────────────────────────
test("preflight from allowed origin is not short-circuited (caller returns 200)", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "OPTIONS", origin: "https://www.yeunauan.live" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, false);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), "https://www.yeunauan.live");
  } finally {
    restoreEnv(snap);
  }
});

// ── 11. methods correct per route ─────────────────────────────────────────────
test("methods header reflects the caller-provided methods", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "GET", origin: "https://www.yeunauan.live" });
    const res = makeRes();
    applyCors(req, res, { mode: "portal", methods: "GET, OPTIONS" });
    assert.equal(res.getHeader("Access-Control-Allow-Methods"), "GET, OPTIONS");
  } finally {
    restoreEnv(snap);
  }
});

// ── 12. allowed headers correct per route ─────────────────────────────────────
test("allowed headers reflect the caller-provided headers", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live"
    });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST", origin: "https://www.yeunauan.live" });
    const res = makeRes();
    applyCors(req, res, {
      mode: "portal",
      allowedHeaders: "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"
    });
    assert.equal(
      res.getHeader("Access-Control-Allow-Headers"),
      "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"
    );
  } finally {
    restoreEnv(snap);
  }
});

// ── 13. never wildcard + credentials ──────────────────────────────────────────
test("admin mode never emits wildcard together with credentials", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_ADMIN_ORIGINS: "https://admin.example.com"
    });
    const { applyCors } = await loadCors();
    // Allowed origin + credentials → exact echo + credentials.
    {
      const req = makeReq({ method: "POST", origin: "https://admin.example.com" });
      const res = makeRes();
      applyCors(req, res, { mode: "admin", allowCredentials: true });
      const acao = res.getHeader("Access-Control-Allow-Origin");
      const acac = res.getHeader("Access-Control-Allow-Credentials");
      assert.notEqual(acao, "*");
      if (acac === "true") assert.notEqual(acao, "*");
    }
  } finally {
    restoreEnv(snap);
  }
});

test("flag-off compatibility never emits wildcard together with credentials", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({}); // flag off
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST", origin: "https://whoever.example.com" });
    const res = makeRes();
    applyCors(req, res, { mode: "admin", allowCredentials: true });
    const acao = res.getHeader("Access-Control-Allow-Origin");
    const acac = res.getHeader("Access-Control-Allow-Credentials");
    if (acac === "true") assert.notEqual(acao, "*");
  } finally {
    restoreEnv(snap);
  }
});

// ── 14. internal no-Origin passes through ─────────────────────────────────────
test("internal mode passes through requests with no Origin header", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({ V2_CORS_ALLOWLIST_ENABLED: "1" });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST" }); // no origin
    const res = makeRes();
    const result = applyCors(req, res, { mode: "internal" });
    assert.equal(result.handled, false);
    // No ACAO echoed for an origin-less server-to-server call.
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), undefined);
  } finally {
    restoreEnv(snap);
  }
});

// ── 15. internal cross-origin blocked when flag on ────────────────────────────
test("internal mode blocks a cross-origin browser request when flag on", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({ V2_CORS_ALLOWLIST_ENABLED: "1" });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "OPTIONS", origin: "https://evil.example.com" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "internal" });
    assert.equal(result.handled, true);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "cors_origin_forbidden");
  } finally {
    restoreEnv(snap);
  }
});

// ── 16. public wildcard, no credentials ───────────────────────────────────────
test("public mode emits wildcard without credentials", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({ V2_CORS_ALLOWLIST_ENABLED: "1" });
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "GET", origin: "https://anyone.example.com" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "public", methods: "GET, OPTIONS" });
    assert.equal(result.handled, false);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), "*");
    assert.equal(res.getHeader("Access-Control-Allow-Credentials"), undefined);
  } finally {
    restoreEnv(snap);
  }
});

// ── 17. preview suffix works in non-production ────────────────────────────────
test("preview suffix allows a matching origin outside production", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live",
      LMS_PREVIEW_ORIGIN_SUFFIX: ".vercel.app",
      VERCEL_ENV: "preview"
    });
    const { applyCors, isPreviewOriginAllowed } = await loadCors();
    assert.equal(isPreviewOriginAllowed("https://my-app-git-branch.vercel.app", ".vercel.app"), true);
    const req = makeReq({ method: "POST", origin: "https://my-app-git-branch.vercel.app" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, false);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), "https://my-app-git-branch.vercel.app");
  } finally {
    restoreEnv(snap);
  }
});

// ── 18. preview suffix disabled in NODE_ENV=production ────────────────────────
test("preview suffix is disabled when NODE_ENV=production", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live",
      LMS_PREVIEW_ORIGIN_SUFFIX: ".vercel.app",
      NODE_ENV: "production"
    });
    const { applyCors, isPreviewOriginAllowed } = await loadCors();
    assert.equal(isPreviewOriginAllowed("https://my-app.vercel.app", ".vercel.app"), false);
    const req = makeReq({ method: "OPTIONS", origin: "https://my-app.vercel.app" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, true);
    assert.equal(result.status, 403);
  } finally {
    restoreEnv(snap);
  }
});

// ── 19. preview suffix disabled in VERCEL_ENV=production ──────────────────────
test("preview suffix is disabled when VERCEL_ENV=production", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "https://www.yeunauan.live",
      LMS_PREVIEW_ORIGIN_SUFFIX: ".vercel.app",
      VERCEL_ENV: "production"
    });
    const { applyCors, isPreviewOriginAllowed } = await loadCors();
    assert.equal(isPreviewOriginAllowed("https://my-app.vercel.app", ".vercel.app"), false);
    const req = makeReq({ method: "OPTIONS", origin: "https://my-app.vercel.app" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, true);
    assert.equal(result.status, 403);
  } finally {
    restoreEnv(snap);
  }
});

// ── 20. suffix matching rejects spoofed hostnames ─────────────────────────────
test("preview suffix does not match a spoofed hostname", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({ VERCEL_ENV: "preview" });
    const { isPreviewOriginAllowed } = await loadCors();
    // Attacker-controlled domain that merely contains the suffix mid-string.
    assert.equal(
      isPreviewOriginAllowed("https://evil-example.vercel.app.attacker.com", ".vercel.app"),
      false
    );
    assert.equal(
      isPreviewOriginAllowed("https://vercel.app.attacker.com", ".vercel.app"),
      false
    );
    // A bare label prefixed onto the suffix without a boundary must fail.
    assert.equal(
      isPreviewOriginAllowed("https://notvercel.app", ".vercel.app"),
      false
    );
  } finally {
    restoreEnv(snap);
  }
});

// ── 21. malformed ENV fails closed when flag on ───────────────────────────────
test("malformed allowlist fails closed for cross-origin when flag on", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({
      V2_CORS_ALLOWLIST_ENABLED: "1",
      LMS_PORTAL_ORIGINS: "not-a-url, http://,ftp://x, /admin"
    });
    const { applyCors, parseOriginList } = await loadCors();
    assert.deepEqual(parseOriginList(process.env.LMS_PORTAL_ORIGINS), []);
    const req = makeReq({ method: "OPTIONS", origin: "https://www.yeunauan.live" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, true);
    assert.equal(result.status, 403);
  } finally {
    restoreEnv(snap);
  }
});

// ── 22. flag off keeps compatibility behavior ─────────────────────────────────
test("flag off keeps wildcard compatibility for non-credential modes", async () => {
  const snap = snapshotEnv();
  try {
    setEnv({}); // flag off
    const { applyCors } = await loadCors();
    const req = makeReq({ method: "POST", origin: "https://whoever.example.com" });
    const res = makeRes();
    const result = applyCors(req, res, { mode: "portal" });
    assert.equal(result.handled, false);
    assert.equal(res.getHeader("Access-Control-Allow-Origin"), "*");
    assert.equal(res.getHeader("Access-Control-Allow-Credentials"), undefined);
  } finally {
    restoreEnv(snap);
  }
});

// ── 23. admin routes use mode admin (source assertion) ────────────────────────
const ADMIN_HANDLERS = [
  "admin-auth.js",
  "admin-bulk-enroll.js",
  "admin-courses.js",
  "admin-account-sharing-alerts.js",
  "admin-enrollments.js",
  "admin-lessons.js",
  "admin-repair-drive.js",
  "admin-drive-permission.js",
  "admin-drive-retry.js",
  "admin-drive-health.js",
  "admin-drive-auth.js",
  "admin-student-trace.js",
  "admin-students.js",
  "admin-sync-drive-permissions.js",
  "admin-upload-image.js",
  "admin-upload-material.js",
  "admin-upload-gdrive-video.js",
  "admin-upload-recipe.js",
  "admin-verify-media.js"
];

test("all admin handlers call applyCors with mode admin", () => {
  for (const file of ADMIN_HANDLERS) {
    const src = readFileSync(join(ROOT, "utils/lms-handlers", file), "utf8");
    assert.match(src, /applyCors\(req, res, \{ mode: "admin" \}\)/, `${file} should use admin mode`);
    assert.doesNotMatch(src, /Access-Control-Allow-Origin/, `${file} should not set ACAO directly`);
  }
});

// ── 24. portal routes use mode portal (source assertion) ──────────────────────
const PORTAL_HANDLERS = ["course-data.js", "lesson.js", "verify-entry-token.js", "exchange-code.js"];

test("all portal handlers call applyCors with mode portal", () => {
  for (const file of PORTAL_HANDLERS) {
    const src = readFileSync(join(ROOT, "utils/lms-handlers", file), "utf8");
    assert.match(src, /mode: "portal"/, `${file} should use portal mode`);
    assert.doesNotMatch(src, /Access-Control-Allow-Origin/, `${file} should not set ACAO directly`);
  }
});

// ── 25. api/sync uses mode internal (source assertion) ────────────────────────
test("api/sync uses applyCors with mode internal", () => {
  const src = readFileSync(join(ROOT, "api/sync.js"), "utf8");
  assert.match(src, /mode: "internal"/, "api/sync should use internal mode");
  assert.doesNotMatch(src, /Access-Control-Allow-Origin/, "api/sync should not set ACAO directly");
});

// ── 26. no wildcard in admin/portal/internal source ───────────────────────────
test("no admin/portal/internal handler contains a literal wildcard ACAO", () => {
  const files = [
    ...ADMIN_HANDLERS.map((f) => join(ROOT, "utils/lms-handlers", f)),
    ...PORTAL_HANDLERS.map((f) => join(ROOT, "utils/lms-handlers", f)),
    join(ROOT, "api/sync.js")
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /Access-Control-Allow-Origin"\s*,\s*"\*"/, `${file} must not hardcode wildcard`);
  }
});

// ── 27. public wildcard only in the allowlisted files ─────────────────────────
test("public wildcard only remains in the explicitly allowlisted public files", async () => {
  const { _internals } = await loadCors();
  const allowed = _internals.PUBLIC_WILDCARD_ALLOWED_FILES;
  assert.ok(allowed.has("utils/lms-handlers/public-config.js"));
  assert.ok(allowed.has("utils/lms-handlers/public-lesson.js"));
  // Confirm those two files still use public mode.
  for (const rel of allowed) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.match(src, /mode: "public"/, `${rel} should use public mode`);
  }
});

// ── 28. RP-1 auth/session code untouched (source assertion) ───────────────────
test("RP-1 auth secret contract remains intact", () => {
  const secrets = readFileSync(join(ROOT, "utils/lms-secrets.js"), "utf8");
  assert.match(secrets, /getSessionSecret/);
  assert.match(secrets, /getInternalSyncSecret/);
  assert.match(secrets, /timingSafeStringEqual/);
  // api/sync still enforces the secret after CORS.
  const sync = readFileSync(join(ROOT, "api/sync.js"), "utf8");
  assert.match(sync, /getInternalSyncSecret/);
  assert.match(sync, /timingSafeStringEqual/);
});
