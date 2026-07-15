// tests/v3-media.test.mjs
// V3 Phase 9 (⑫) — session-bound signed URL + DRM opt-in. node:test, no keys.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP2B1_SUPABASE_STUB = "1";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v3media-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "v3media-test-service-role-key";
process.env.BUNNY_STREAM_TOKEN_KEY = "v3media-test-bunny-token-key";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_FILE = join(__dirname, ".supabase-stub.v3-media.json");
process.env.LMS_SUPABASE_STUB_FILE = STUB_FILE;
function writeStub(obj) { writeFileSync(STUB_FILE, JSON.stringify(obj)); }
function clearStub() { writeFileSync(STUB_FILE, JSON.stringify({})); }

const media = await import("../utils/v3-media.js");
const rc = await import("../utils/runtime-controller.js");
const crypto = await import("node:crypto");

function setMode(mode) {
  rc._test.reset();
  writeStub({
    platform_runtime_config: {
      active_mode: mode, v2_shadow_mode: false, v3_shadow_mode: false,
      kill_switch: false, updated_at: "2026-07-15T00:00:00Z",
    },
  });
}

const VIDEO = "https://player.mediadelivery.net/embed/lib123/vid456";
const KEY = "v3media-test-bunny-token-key";

test("parseBunnyEmbed extracts libraryId + videoId, rejects non-bunny", () => {
  assert.deepEqual(media.parseBunnyEmbed(VIDEO), { libraryId: "lib123", videoId: "vid456" });
  assert.equal(media.parseBunnyEmbed("https://example.com/x"), null);
  assert.equal(media.parseBunnyEmbed(""), null);
});

test("signSessionBoundMediaUrl binds token to the session (different session -> different token)", () => {
  const a = media.signSessionBoundMediaUrl({ videoUrl: VIDEO, sessionId: "sess_A", tokenKey: KEY });
  const b = media.signSessionBoundMediaUrl({ videoUrl: VIDEO, sessionId: "sess_B", tokenKey: KEY });
  assert.equal(a.videoAuthStatus, "signed");
  assert.equal(a.boundSessionId, "sess_A");
  assert.notEqual(a.secureVideoUrl, b.secureVideoUrl); // session is in the HMAC
});

test("signSessionBoundMediaUrl fail-closed on missing key / session / non-bunny", () => {
  assert.equal(media.signSessionBoundMediaUrl({ videoUrl: VIDEO, sessionId: "s", tokenKey: "" }).videoAuthStatus, "missing_bunny_stream_token_key");
  assert.equal(media.signSessionBoundMediaUrl({ videoUrl: VIDEO, sessionId: "", tokenKey: KEY }).videoAuthStatus, "missing_session");
  assert.equal(media.signSessionBoundMediaUrl({ videoUrl: "https://x", sessionId: "s", tokenKey: KEY }).videoAuthStatus, "not_bunny_embed");
});

test("verifySessionBoundMediaToken: round-trip ok; wrong session -> invalid; expired -> expired", () => {
  const signed = media.signSessionBoundMediaUrl({ videoUrl: VIDEO, sessionId: "sess_A", tokenKey: KEY });
  const params = { videoUrl: VIDEO, sessionId: "sess_A", expires: signed.secureVideoExpiresAt, token: signed.secureVideoUrl.match(/token=([0-9a-f]+)/)[1], tokenKey: KEY };
  assert.equal(media.verifySessionBoundMediaToken(params).ok, true);
  // Wrong session.
  assert.equal(media.verifySessionBoundMediaToken({ ...params, sessionId: "sess_B" }).ok, false);
  // Expired (past).
  assert.equal(media.verifySessionBoundMediaToken({ ...params, expires: 1 }).reason, "expired");
  // Tampered token.
  const tampered = params.token.slice(0, -2) + "00";
  assert.equal(media.verifySessionBoundMediaToken({ ...params, token: tampered }).ok, false);
});

test("TTL is short (<= 10 min) by default", () => {
  const signed = media.signSessionBoundMediaUrl({ videoUrl: VIDEO, sessionId: "s", tokenKey: KEY });
  const ttl = signed.secureVideoExpiresAt - Math.floor(Date.now() / 1000);
  assert.ok(ttl > 0 && ttl <= 600, `ttl ${ttl} should be <= 600s`);
  assert.equal(media._internals.DEFAULT_MEDIA_TTL_SECONDS, 120);
});

// ── DRM opt-in ───────────────────────────────────────────────────────────────
test("resolveDrmPolicy defaults to DRM OFF (opt-in only)", () => {
  assert.equal(media.resolveDrmPolicy("donut", {}).drmRequired, false);
  assert.equal(media.resolveDrmPolicy("donut", { donut: { drmRequired: false } }).drmRequired, false);
  assert.equal(media.resolveDrmPolicy("").drmRequired, false);
});

test("resolveDrmPolicy turns on per-course with a scheme + license server", () => {
  const p = media.resolveDrmPolicy("premium-course", {
    "premium-course": { drmRequired: true, scheme: "widevine", licenseServerUrl: "https://lic.example.com/wv" },
  });
  assert.equal(p.drmRequired, true);
  assert.equal(p.scheme, "widevine");
  assert.equal(p.licenseServerUrl, "https://lic.example.com/wv");
});

test("signMediaForV3Session refuses outside v3 mode", async () => {
  setMode("v1");
  await assert.rejects(() => media.signMediaForV3Session({ videoUrl: VIDEO, sessionId: "s", tokenKey: KEY }), /v3 mode/i);
  clearStub();
});

test("signMediaForV3Session signs in v3 mode", async () => {
  setMode("v3");
  const signed = await media.signMediaForV3Session({ videoUrl: VIDEO, sessionId: "sess_A", tokenKey: KEY });
  assert.equal(signed.videoAuthStatus, "signed");
  assert.equal(signed.boundSessionId, "sess_A");
  clearStub();
});
