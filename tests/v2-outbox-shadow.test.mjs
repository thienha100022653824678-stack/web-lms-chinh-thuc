// tests/v2-outbox-shadow.test.mjs
//
// Unit tests for the fail-open V2 outbox shadow helper.
// Uses node:test. Does NOT hit a real DB — injects fakes via the helper's
// injectables so we can assert (a) flag-off is a no-op, (b) flag-on enqueues
// the right event, (c) enqueue failure never throws.

import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "v2-shadow-test-session-secret";
process.env.ACCOUNT_EVENT_HASH_SECRET =
  process.env.ACCOUNT_EVENT_HASH_SECRET || "v2-shadow-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET =
  process.env.INTERNAL_SYNC_SECRET || "v2-shadow-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v2-shadow-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "v2-shadow-test-service-role-key";

// Isolate the flag for each case via a cache-busting dynamic import.
async function loadHelper(flagValue) {
  if (flagValue === undefined) {
    delete process.env.V2_OUTBOX_SHADOW_MODE;
  } else {
    process.env.V2_OUTBOX_SHADOW_MODE = flagValue;
  }
  return import(`../utils/v2-outbox-shadow.js?t=${Date.now()}-${Math.random()}`);
}

test("flag off → maybeShadowCoursePublish is a no-op (does not call enqueue)", async () => {
  const mod = await loadHelper("false");
  let called = 0;
  const result = await mod.maybeShadowCoursePublish(
    { slug: "banhmi", title: "Bánh mì", is_published: true },
    {
      isShadowMode: () => false,
      enqueueCourse: async () => {
        called += 1;
        return { id: "should-not-run" };
      },
      log: () => {},
    }
  );
  assert.equal(called, 0);
  assert.deepEqual(result, { skipped: true, reason: "shadow_mode_off" });
});

test("flag on → maybeShadowCoursePublish enqueues once and returns the row", async () => {
  const mod = await loadHelper("true");
  let called = 0;
  let seen = null;
  const result = await mod.maybeShadowCoursePublish(
    { slug: "banhmi", title: "Bánh mì", is_published: true, updated_at: "2026-07-15T00:00:00Z" },
    {
      isShadowMode: () => true,
      enqueueCourse: async (course) => {
        called += 1;
        seen = course;
        return { id: "outbox-1", status: "pending" };
      },
      log: () => {},
    }
  );
  assert.equal(called, 1);
  assert.equal(seen.slug, "banhmi");
  assert.equal(result.ok, true);
  assert.equal(result.outboxId, "outbox-1");
});

test("flag on + enqueue throws → maybeShadowCoursePublish returns fail-open, never throws", async () => {
  const mod = await loadHelper("true");
  let logged = null;
  const result = await mod.maybeShadowCoursePublish(
    { slug: "banhmi", title: "Bánh mì" },
    {
      isShadowMode: () => true,
      enqueueCourse: async () => {
        throw new Error("supabase down");
      },
      log: (msg, err) => {
        logged = { msg, err: String(err?.message || err) };
      },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedOpen, true);
  assert.match(result.error, /supabase down/);
  assert.ok(logged, "error must be logged");
  assert.match(logged.err, /supabase down/);
});

test("flag off → maybeShadowEnrollmentAccess is a no-op", async () => {
  const mod = await loadHelper(undefined);
  let called = 0;
  const result = await mod.maybeShadowEnrollmentAccess(
    { email: "a@example.com", course_slug: "banhmi" },
    "upserted",
    {
      isShadowMode: () => false,
      enqueueEnrollment: async () => {
        called += 1;
      },
      log: () => {},
    }
  );
  assert.equal(called, 0);
  assert.deepEqual(result, { skipped: true, reason: "shadow_mode_off" });
});

test("flag on → maybeShadowEnrollmentAccess enqueues with action=revoked for revoke", async () => {
  const mod = await loadHelper("true");
  let seen = null;
  const result = await mod.maybeShadowEnrollmentAccess(
    { email: "a@example.com", course_slug: "banhmi", status: "active" },
    "revoked",
    {
      isShadowMode: () => true,
      enqueueEnrollment: async (enrollment, action) => {
        seen = { enrollment, action };
        return { id: "outbox-e1", status: "pending" };
      },
      log: () => {},
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.outboxId, "outbox-e1");
  assert.equal(seen.action, "revoked");
  assert.equal(seen.enrollment.email, "a@example.com");
});

test("flag on + enqueue throws → maybeShadowEnrollmentAccess fail-open", async () => {
  const mod = await loadHelper("true");
  const result = await mod.maybeShadowEnrollmentAccess(
    { email: "a@example.com", courseSlug: "banhmi" },
    "upserted",
    {
      isShadowMode: () => true,
      enqueueEnrollment: async () => {
        throw new Error("boom");
      },
      log: () => {},
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedOpen, true);
  assert.match(result.error, /boom/);
});

test("missing course slug → fail-open (does not throw to caller)", async () => {
  const mod = await loadHelper("true");
  const result = await mod.maybeShadowCoursePublish(
    { title: "no slug" },
    {
      isShadowMode: () => true,
      // Real enqueueCoursePublishEvent throws on missing slug; simulate that.
      enqueueCourse: async () => {
        throw new Error("Missing course slug for outbox event");
      },
      log: () => {},
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedOpen, true);
});
