import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertLmsPreviewRuntime,
  FORBIDDEN_PRODUCTION_REF,
  LMS_PREVIEW_REF,
  timingSafeSecret
} from "../utils/preview-runtime.js";

test("Preview runtime guard accepts only explicit non-Production Preview", () => {
  const before = { ...process.env };
  try {
    process.env.SUPABASE_URL = `https://${LMS_PREVIEW_REF}.supabase.co`;
    process.env.V5_INTEGRATION_PREVIEW = "1";
    process.env.VERCEL_ENV = "preview";
    assert.equal(assertLmsPreviewRuntime().ref, LMS_PREVIEW_REF);
    process.env.SUPABASE_URL = `https://${FORBIDDEN_PRODUCTION_REF}.supabase.co`;
    assert.throws(() => assertLmsPreviewRuntime(), /PRODUCTION_DATABASE_FORBIDDEN/);
    process.env.SUPABASE_URL = `https://${LMS_PREVIEW_REF}.supabase.co`;
    process.env.VERCEL_ENV = "production";
    assert.throws(() => assertLmsPreviewRuntime(), /PRODUCTION_DATABASE_FORBIDDEN/);
  } finally {
    process.env = before;
  }
});

test("Preview harness secret comparison is length-checked and timing-safe", () => {
  const secret = "p".repeat(40);
  assert.equal(timingSafeSecret(secret, secret), true);
  assert.equal(timingSafeSecret("wrong", secret), false);
  assert.equal(timingSafeSecret("short", "short"), false);
});

test("Preview substrate is guarded, service-role-only and outside Production chain", () => {
  const forward = fs.readFileSync(new URL("../migrations/preview/20260729_lms_b05_preview_substrate.sql", import.meta.url), "utf8");
  const rollback = fs.readFileSync(new URL("../migrations/preview/20260729_lms_b05_preview_substrate_rollback.sql", import.meta.url), "utf8");
  const seed = fs.readFileSync(new URL("../migrations/preview/20260729_lms_b05_preview_seed.sql", import.meta.url), "utf8");
  for (const sql of [forward, rollback, seed]) {
    assert.match(sql, /plgrmaktvudjetfkwmyg/);
    assert.match(sql, /PRODUCTION_DATABASE_FORBIDDEN/);
  }
  assert.match(forward, /REVOKE ALL[\s\S]+FROM anon, authenticated/);
  assert.doesNotMatch(forward, /CREATE TABLE[^;]+orders/i);
  assert.doesNotMatch(seed, /@(?!example\.test)/);
  assert.match(rollback, /lms_b05_preview_substrate_manifest/);
});

test("Every Preview Drive action uses one fail-closed dry-run adapter", () => {
  const helper = fs.readFileSync(new URL("../utils/preview-drive-adapter.js", import.meta.url), "utf8");
  for (const action of [
    "upload_image", "upload_recipe", "upload_material", "upload_video",
    "verify_media", "sync_permissions", "repair", "retry", "direct_permission"
  ]) assert.match(helper, new RegExp(`"${action}"`));
  assert.match(helper, /assertLmsPreviewRuntime/);
  assert.match(helper, /assertCourseInLearningSite/);
  assert.match(helper, /auditLearningSiteOperation/);
  assert.match(helper, /drive_permission_logs/);
});

test("Preview auth route is 404/fail-closed outside Preview and fixed identity only", () => {
  const handler = fs.readFileSync(new URL("../utils/lms-handlers/admin-preview-auth.js", import.meta.url), "utf8");
  const router = fs.readFileSync(new URL("../api/lms/admin.js", import.meta.url), "utf8");
  assert.match(handler, /admin\.multisite\.preview@example\.test/);
  assert.match(handler, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(handler, /route_not_found/);
  assert.match(router, /endpoint === "preview-auth"/);
});
