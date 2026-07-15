// tests/v3-event-schema.test.mjs
// V3 Phase 8 (⑩) — shared event-schema package contract tests.
// Asserts the cross-repo contract is stable, expand-only, and self-consistent.
import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_VERSIONS,
  CURRENT_SCHEMA_VERSION,
  VALID_MODES,
  isValidRuntimeVersion,
  normalizeRuntimeVersion,
  EVENT_TYPES,
  AGGREGATE_TYPES,
  makeEventEnvelope,
  enrollmentDto,
  courseDto,
  sessionEventDto,
  ERROR_CODES,
  reasonToErrorCode,
  normalizeEmail,
  buildIdempotencyKey,
  maskEmail,
  hashIdentifier,
} from "../packages/v3-event-schema/src/index.mjs";

// ── Runtime constants ────────────────────────────────────────────────────────
test("runtime versions are exactly v1/v2/v3", () => {
  assert.deepEqual(Object.values(RUNTIME_VERSIONS).sort(), ["v1", "v2", "v3"]);
  assert.ok(VALID_MODES.has("v1"));
  assert.ok(VALID_MODES.has("v2"));
  assert.ok(VALID_MODES.has("v3"));
  assert.equal(VALID_MODES.size, 3);
});

test("normalizeRuntimeVersion fail-closes unknown to v1", () => {
  assert.equal(normalizeRuntimeVersion("v3"), "v3");
  assert.equal(normalizeRuntimeVersion("v9"), "v1");
  assert.equal(normalizeRuntimeVersion(undefined), "v1");
});

// ── Events ───────────────────────────────────────────────────────────────────
test("EVENT_TYPES are frozen string constants (stable contract)", () => {
  assert.equal(EVENT_TYPES.COURSE_PUBLISH_STATUS_CHANGED, "course.publish_status_changed");
  assert.equal(EVENT_TYPES.ENROLLMENT_UPSERTED, "enrollment.upserted");
  assert.equal(EVENT_TYPES.LOGIN_BLOCKED_OTHER_DEVICE, "login_blocked_other_device");
  assert.ok(Object.isFrozen(EVENT_TYPES));
});

test("makeEventEnvelope stamps runtime_version + schema_version", () => {
  const e = makeEventEnvelope({
    eventType: EVENT_TYPES.ENROLLMENT_UPSERTED,
    aggregateType: AGGREGATE_TYPES.ENROLLMENT,
    aggregateId: "stu@example.com:khoa-a",
    payload: { email: "stu@example.com" },
    runtimeVersion: "v3",
  });
  assert.equal(e.runtime_version, "v3");
  assert.equal(e.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(e.event_type, "enrollment.upserted");
  assert.ok(Object.isFrozen(e));
});

test("makeEventEnvelope requires eventType + aggregateType; unknown runtime -> v1", () => {
  assert.throws(() => makeEventEnvelope({ aggregateType: "x" }), /required/i);
  const e = makeEventEnvelope({ eventType: "x", aggregateType: "y", runtimeVersion: "v9" });
  assert.equal(e.runtime_version, "v1");
});

// ── DTOs ─────────────────────────────────────────────────────────────────────
test("enrollmentDto requires email + course_slug, lowercases email", () => {
  const d = enrollmentDto({ email: "STU@Gmail.com", course_slug: "Khoa-A", runtime_version: "v3" });
  assert.equal(d.email, "stu@gmail.com");
  assert.equal(d.course_slug, "Khoa-A");
  assert.equal(d.runtime_version, "v3");
  assert.throws(() => enrollmentDto({ course_slug: "x" }), /requires/);
});

test("courseDto requires slug", () => {
  const c = courseDto({ slug: "donut", is_published: true });
  assert.equal(c.slug, "donut");
  assert.equal(c.is_published, true);
  assert.equal(c.runtime_version, "v1");
  assert.throws(() => courseDto({}), /requires slug/);
});

test("sessionEventDto requires email", () => {
  const s = sessionEventDto({ email: "a@b.com", event_type: "logout" });
  assert.equal(s.email, "a@b.com");
  assert.throws(() => sessionEventDto({ event_type: "x" }), /requires email/);
});

// ── Errors ───────────────────────────────────────────────────────────────────
test("ERROR_CODES are frozen + reason mapping is stable", () => {
  assert.ok(Object.isFrozen(ERROR_CODES));
  assert.equal(reasonToErrorCode("device_mismatch"), ERROR_CODES.DEVICE_MISMATCH);
  assert.equal(reasonToErrorCode("session_revoked"), ERROR_CODES.SESSION_REVOKED);
  assert.equal(reasonToErrorCode("valid"), null);
  assert.equal(reasonToErrorCode("something_unknown"), ERROR_CODES.SERVER_ERROR);
});

// ── Helpers ──────────────────────────────────────────────────────────────────
test("normalizeEmail + maskEmail + hashIdentifier behave as the LMS versions", () => {
  assert.equal(normalizeEmail("  STU@Gmail.com  "), "stu@gmail.com");
  assert.equal(maskEmail("student@gmail.com"), "st***@gmail.com");
  assert.equal(maskEmail(""), "");
  const h = hashIdentifier("203.0.113.5");
  assert.equal(h, hashIdentifier("203.0.113.5"));
  assert.equal(h.length, 16);
  assert.equal(hashIdentifier(""), null);
});

test("buildIdempotencyKey is deterministic (exactly-once enqueue)", () => {
  const a = buildIdempotencyKey(["enrollment.upserted", "stu:khoa-a", ""]);
  const b = buildIdempotencyKey(["enrollment.upserted", "stu:khoa-a", ""]);
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

// ── Expand-only invariant ────────────────────────────────────────────────────
test("event envelope is expand-only: V1-known fields still present", () => {
  // A V1 consumer reading an event envelope produced by V3 must still find the
  // fields it knows; additive fields are extra, not replacements.
  const e = makeEventEnvelope({
    eventType: "enrollment.upserted",
    aggregateType: "enrollment",
    aggregateId: "x:y",
    payload: { email: "x@y.com", course_slug: "y", status: "active" },
    runtimeVersion: "v3",
  });
  assert.equal(e.event_type, "enrollment.upserted");
  assert.equal(e.payload.email, "x@y.com");
  assert.equal(e.payload.course_slug, "y");
  // additive V3 fields:
  assert.equal(e.runtime_version, "v3");
});
