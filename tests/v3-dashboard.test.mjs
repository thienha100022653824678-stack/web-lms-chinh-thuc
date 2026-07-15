// tests/v3-dashboard.test.mjs
// V3 Phase 7 (⑨) — static assertions on the diagnostics dashboard HTML.
// No browser: assert the page wires to the right endpoint, sends the secret as
// a header only, and embeds no secret/PII.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, "..", "v3-diagnostics.html"), "utf8");

test("consumes GET /api/v3/diagnostics", () => {
  assert.match(HTML, /fetch\("\/api\/v3\/diagnostics"/);
  assert.match(HTML, /method:\s*"GET"/);
});

test("sends the worker secret as a header, not a query param", () => {
  assert.match(HTML, /"x-v2-worker-secret":\s*secret/);
  // Must not put the secret into the URL.
  assert.equal(/diagnostics\?[^"]*secret/.test(HTML), false);
});

test("does not persist the secret to storage", () => {
  assert.equal(/localStorage|sessionStorage|document\.cookie\s*=/.test(HTML), false);
});

test("embeds no hardcoded secret-looking strings", () => {
  for (const forbidden of [/eyJ[A-Za-z0-9_-]{40,}/, /sbp_[A-Za-z0-9]{20,}/, /service_role.*key.*=.*["'][A-Za-z0-9]/i]) {
    assert.equal(forbidden.test(HTML), false, `must not embed ${forbidden}`);
  }
});

test("is a self-contained module with no external script deps", () => {
  assert.match(HTML, /<script type="module">/);
  // No CDN script tags (dashboard must not pull remote code for an admin tool).
  assert.equal(/<script[^>]+src=["']https?:/.test(HTML), false);
});

test("handles the dead-letter table-absent sentinel (-1)", () => {
  assert.match(HTML, /deadLetters === -1/);
});
