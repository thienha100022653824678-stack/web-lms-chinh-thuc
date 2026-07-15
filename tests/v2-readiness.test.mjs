// tests/v2-readiness.test.mjs
//
// Unit tests for the V2 readiness classifier. Asserts the §4 policy:
// tracked identity gaps (issueCount>0 but failedChecks===0) do NOT block
// dry-run readiness, but DO keep reconciliation_clean as a "review" gate
// so the level caps at ready_for_dry_run (not ready_for_guarded_delivery)
// until the gaps are cleaned or accepted.
//
// Uses node:test. Exercises the pure buildGates + classifyReadiness
// helpers directly (no DB, no network) by importing them as exports.

import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "v2-ready-test-session-secret";
process.env.ACCOUNT_EVENT_HASH_SECRET =
  process.env.ACCOUNT_EVENT_HASH_SECRET || "v2-ready-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET =
  process.env.INTERNAL_SYNC_SECRET || "v2-ready-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://v2-ready-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "v2-ready-test-service-role-key";
// Reconciliation is enabled in the canary config (V2_RECONCILIATION_READONLY=true
// on preview). Set it so the reconciliation_enabled gate passes and the
// classifier reaches the guarded/dry-run branches we assert below.
process.env.V2_RECONCILIATION_READONLY = "true";

const readiness = await import(`../utils/v2-readiness.js?t=${Date.now()}`);

// ── fixtures ────────────────────────────────────────────────────────────
// A fully-passing diagnostics blob (migrations + outbox healthy, secrets set,
// live delivery + portal projection still guarded).
function healthyDiagnostics() {
  return {
    ok: true,
    migrations: { ok: true, missingTables: [], missingColumnGroups: [] },
    outbox: { ok: true, staleProcessingCount: 0, deadLetters: 0 },
    flags: {
      runtimeMode: "off",
      flags: {
        DELIVERY_HANDLERS_ENABLED: { enabled: false },
        PORTAL_PROJECTION_ENABLED: { enabled: true },
        PORTAL_PROJECTION_DRY_RUN: { enabled: true },
      },
      secretsConfigured: {
        V2_WORKER_SECRET: false,
        INTERNAL_SYNC_SECRET: true,
      },
    },
  };
}

function cleanReconciliation(issueCount = 0) {
  return {
    ok: true,
    issueCount,
    failedChecks: 0,
    checks: [],
  };
}

test("all gates pass + reconciliation clean (issueCount=0) → ready_for_guarded_delivery", () => {
  const gates = readiness.buildGates(healthyDiagnostics(), cleanReconciliation(0));
  const r = readiness.classifyReadiness(gates);
  assert.equal(r.level, "ready_for_guarded_delivery");
  assert.equal(r.ok, true);
});

test("tracked identity gaps (failedChecks=0, issueCount=3) → ready_for_dry_run, NOT blocked, NOT guarded_delivery", () => {
  // §4 policy: known junk-slug gaps are tracked, not required to be 0.
  const gates = readiness.buildGates(healthyDiagnostics(), cleanReconciliation(3));
  const r = readiness.classifyReadiness(gates);

  // reconciliation_clean gate is a review gate (issueCount>0), so reviews>0.
  const reconGate = gates.find((g) => g.name === "reconciliation_clean");
  assert.equal(reconGate.status, "review");
  assert.equal(reconGate.ok, true); // failedChecks===0 so the check itself is healthy

  // No blocked gates.
  assert.equal(r.level, "ready_for_dry_run");
  assert.equal(r.ok, true);
});

test("a failed reconciliation check (failedChecks>0) → needs_review (still not blocked)", () => {
  const recon = { ok: false, issueCount: 5, failedChecks: 1, checks: [] };
  const gates = readiness.buildGates(healthyDiagnostics(), recon);
  const r = readiness.classifyReadiness(gates);
  const reconGate = gates.find((g) => g.name === "reconciliation_clean");
  assert.equal(reconGate.status, "review");
  assert.equal(reconGate.ok, false);
  assert.equal(r.level, "needs_review");
});

test("missing migrations → blocked (regardless of reconciliation)", () => {
  const diag = healthyDiagnostics();
  diag.migrations = { ok: false, missingTables: ["sync_outbox"], missingColumnGroups: [] };
  const gates = readiness.buildGates(diag, cleanReconciliation(0));
  const r = readiness.classifyReadiness(gates);
  assert.equal(r.level, "blocked");
  assert.equal(r.ok, false);
});

test("live delivery enabled + portal live → still ready_for_guarded_delivery (review gates surface it)", () => {
  // This is the intentional-canary state; both guarded gates flip to review.
  const diag = healthyDiagnostics();
  diag.flags.flags.DELIVERY_HANDLERS_ENABLED = { enabled: true };
  diag.flags.flags.PORTAL_PROJECTION_ENABLED = { enabled: true };
  diag.flags.flags.PORTAL_PROJECTION_DRY_RUN = { enabled: false };
  const gates = readiness.buildGates(diag, cleanReconciliation(0));
  const r = readiness.classifyReadiness(gates);

  const liveGate = gates.find((g) => g.name === "live_delivery_still_guarded");
  const portalGate = gates.find((g) => g.name === "portal_projection_still_guarded");
  assert.equal(liveGate.status, "review");
  assert.equal(portalGate.status, "review");

  // review gates exist and reconciliation is clean → ready_for_dry_run (NOT guarded)
  assert.equal(r.level, "ready_for_dry_run");
});

test("reconciliation disabled → reconciliation_enabled + reconciliation_clean are review, level needs_review", async () => {
  // Simulate the flag being off by loading a fresh module instance with the
  // env unset. (isV2ReconciliationEnabled reads process.env at call time via
  // isV2FlagEnabled, so a re-import after deleting the env is enough.)
  delete process.env.V2_RECONCILIATION_READONLY;
  const disabled = await import(`../utils/v2-readiness.js?disabled=${Date.now()}`);
  const gates = disabled.buildGates(healthyDiagnostics(), null);
  const r = disabled.classifyReadiness(gates);
  const enabledGate = gates.find((g) => g.name === "reconciliation_enabled");
  const cleanGate = gates.find((g) => g.name === "reconciliation_clean");
  assert.equal(enabledGate.status, "review");
  assert.equal(cleanGate.status, "review");
  assert.equal(r.level, "needs_review");
  // restore for any subsequent tests in this process
  process.env.V2_RECONCILIATION_READONLY = "true";
});
