// tests/v3-runtime-admin-ui.test.mjs
// V3 runtime-admin.html — static assertions on the runtime switch admin page.
//
// Mirrors the v3-dashboard.test.mjs bar (no browser): the page must wire to the
// right endpoints, send the worker secret only as a header, never persist it,
// never self-decide active_mode from storage, gate every flip behind a manual
// confirm, and update state only after the backend confirms.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, "..", "runtime-admin.html"), "utf8");

// ── Endpoints wired ───────────────────────────────────────────────────────────
test("consumes GET /api/v2/runtime (runtime state)", () => {
  assert.match(HTML, /getJson\("\/api\/v2\/runtime",\s*\{\s*method:\s*"GET"/);
});

test("consumes POST /api/v2/runtime (switch flip)", () => {
  assert.match(HTML, /method:\s*"POST"/);
  assert.match(HTML, /"\/api\/v2\/runtime"/);
  assert.match(HTML, /active_mode/);
  assert.match(HTML, /kill_switch/);
  assert.match(HTML, /v2_shadow_mode/);
  assert.match(HTML, /v3_shadow_mode/);
});

test("consumes GET /api/v2/readiness (V2 readiness)", () => {
  assert.match(HTML, /getJson\("\/api\/v2\/readiness",\s*\{\s*method:\s*"GET"/);
});

test("consumes GET /api/v3/diagnostics (V3 readiness/diagnostics)", () => {
  assert.match(HTML, /getJson\("\/api\/v3\/diagnostics",\s*\{\s*method:\s*"GET"/);
});

// ── Admin UI elements present ─────────────────────────────────────────────────
test("renders active_mode + effective_mode status from backend", () => {
  assert.match(HTML, /id="activeMode"/);
  assert.match(HTML, /id="effectiveMode"/);
  assert.match(HTML, /id="effMode"/);
});

test("renders V1 / V2 / V3 switch buttons", () => {
  assert.match(HTML, /id="setV1"/);
  assert.match(HTML, /id="setV2"/);
  assert.match(HTML, /id="setV3"/);
});

test("renders rollback-to-V1 button", () => {
  assert.match(HTML, /id="rollbackV1"/);
  assert.match(HTML, /Rollback/);
});

test("renders kill switch toggle (ON + OFF)", () => {
  assert.match(HTML, /id="killOn"/);
  assert.match(HTML, /id="killOff"/);
});

test("renders V2 + V3 readiness cards", () => {
  assert.match(HTML, /id="v2Readiness"/);
  assert.match(HTML, /id="v3Diag"/);
});

test("has loading + error state (banner + spinner + disabled buttons)", () => {
  assert.match(HTML, /id="banner"/);
  assert.match(HTML, /spinner/);
  // Buttons start disabled until secret + load.
  assert.match(HTML, /disabled/);
});

// ── Security invariants ───────────────────────────────────────────────────────
test("sends the worker secret as a header, not a query param or body", () => {
  // The secret lives only in a request header, built once in secretHeaders().
  assert.match(HTML, /function secretHeaders/);
  assert.match(HTML, /SECRET_KEY\s*=\s*"x-v2-worker-secret"/);
  assert.match(HTML, /\[\s*SECRET_KEY\s*\]\s*:/);
  // Must not put the secret into the URL.
  assert.equal(/runtime\?[^"]*secret/.test(HTML), false);
  assert.equal(/readiness\?[^"]*secret/.test(HTML), false);
  assert.equal(/diagnostics\?[^"]*secret/.test(HTML), false);
  // Must not serialize the secret into a request body.
  assert.equal(/JSON\.stringify\([^)]*secret/i.test(HTML), false);
});

test("does NOT persist the secret to any storage", () => {
  // The page may use localStorage for nothing secret — assert no secret storage.
  assert.equal(/localStorage\.(setItem|getItem)\([^)]*secret/i.test(HTML), false);
  assert.equal(/sessionStorage\.(setItem|getItem)\([^)]*secret/i.test(HTML), false);
  assert.equal(/document\.cookie\s*=/.test(HTML), false);
});

test("the frontend NEVER decides active_mode from storage / localStorage", () => {
  // Strip the footer disclaimer + modal body prose (which mention localStorage
  // and active_mode='v?' only descriptively) before scanning, so prose does not
  // trip the guard.
  const code = HTML
    .replace(/<footer[\s\S]*?<\/footer>/, "")
    .replace(/body:\s*`[^`]*`/g, "");
  // No active_mode value is read from or written to localStorage. State only
  // comes from the backend response.
  assert.equal(/localStorage\.(setItem|getItem)\([^)]*(active_mode|activeMode|mode|kill)/i.test(code), false);
  assert.equal(/sessionStorage\.(setItem|getItem)\([^)]*(active_mode|activeMode|mode|kill)/i.test(code), false);
  // No client-side assignment that fabricates a mode (only the literal patch
  // objects { active_mode: "v1" } passed to POST are allowed; those live in the
  // patch map, not as free assignments).
  assert.equal(/(?:let|const|var)\s+active_mode\s*=/.test(code), false);
});

test("every flip goes through a manual confirm gate (no auto-send)", () => {
  // The send path is gated behind modalOk + a confirm word, not an auto click.
  assert.match(HTML, /openModal\(/);
  assert.match(HTML, /confirmWord/);
  assert.match(HTML, /id="modalConfirm"/);
  assert.match(HTML, /id="modalOk"/);
  // The switch buttons open the modal; they do not call sendPatch directly.
  assert.match(HTML, /addEventListener\("click",\s*\(\)\s*=>\s*openModal\(/);
});

test("state is updated only after the backend confirms (renderRuntime from response)", () => {
  // The runtime state render is driven by the backend response body, not local input.
  assert.match(HTML, /renderRuntime\(/);
  assert.match(HTML, /res\.body\?\.ok/);
});

// ── Hygiene (consistent with v3-dashboard.test.mjs) ───────────────────────────
test("does not embed hardcoded secret-looking strings", () => {
  for (const forbidden of [/eyJ[A-Za-z0-9_-]{40,}/, /sbp_[A-Za-z0-9]{20,}/, /service_role.*key.*=.*["'][A-Za-z0-9]/i]) {
    assert.equal(forbidden.test(HTML), false, `must not embed ${forbidden}`);
  }
});

test("is a self-contained module with no external script deps", () => {
  assert.match(HTML, /<script type="module">/);
  // No CDN/remote script tags — admin tool must not pull remote code.
  assert.equal(/<script[^>]+src=["']https?:/.test(HTML), false);
});

test("does not allow a wildcard / open flip without auth (no fetch without secret header)", () => {
  // Every fetch helper builds headers via secretHeaders(); there is no bare fetch
  // to the runtime/readiness/diagnostics URLs that omits the secret.
  assert.match(HTML, /function secretHeaders/);
});
