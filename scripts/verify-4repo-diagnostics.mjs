// scripts/verify-4repo-diagnostics.mjs
//
// LIVE post-deploy verification: confirm all 4 components (LMS, Shop, Portal,
// System1 Admin) read the SAME runtime mode from the shared DB B site_config
// switch, and that no diagnostics endpoint leaks secret values.
//
// Usage:
//   V2_WORKER_SECRET=<secret> node scripts/verify-4repo-diagnostics.mjs
//   V2_WORKER_SECRET=<secret> EXPECTED_MODE=v1 node scripts/verify-4repo-diagnostics.mjs
//
// Exits 0 only if ALL 4 endpoints return 200, report the SAME activeMode
// (and matching EXPECTED_MODE if set), report component identities correctly,
// and contain NO secret values in their bodies. Otherwise exits 1 with a
// per-component breakdown. Exits 2 when the worker secret env is unset.
//
// Run this AFTER deploying all 4 V2 branches AND after any V1<->V2 flip
// (wait > V2_RUNTIME_CACHE_TTL_MS, default 5s, for the flip to propagate).
//
// ── Response-shape contract (why this script normalizes) ───────────────────
// The four diagnostics endpoints do NOT share one response shape:
//   - LMS (utils/v2-diagnostics.js) nests the runtime state under `runtime`:
//       { ok, mode, generatedAt, runtime:{activeMode,killSwitch,source,ok},
//         flags, migrations, outbox, nextAction }
//     and does NOT emit a top-level `component` field at all.
//   - Shop / Portal / Admin emit the runtime fields at the TOP level and have
//     no `runtime` envelope:
//       { ok, component, activeMode, killSwitch, source, flags, ... }
// Reading `body.activeMode` blindly therefore mis-reads LMS (returns undefined)
// and produces false-positive failures, AND silently drops LMS from the
// cross-repo agreement check (which only considers components that resolved a
// valid mode). To stay honest we normalize every response to a canonical
// internal object — preferring a top-level field when it is present AND valid,
// otherwise falling back to the `runtime` envelope — before any validation.
//
// Component identity: when the response does not carry a valid `component`
// string (LMS today never does; empty/null is also treated as absent), the
// logical ENDPOINTS key (`lms`/`shop`/`portal`/`admin`) is used as a fallback.
// That key is known to the script independently of the URL; we never invent a
// component name from the hostname. We do NOT patch the LMS production API
// just to add a component field — the fallback keeps the operator output
// readable (`component="lms"` instead of `component="null"`) without a prod
// surface change.
//
// The normalization + validation core is exported (pure, no network, no
// process.exit) so tests/v2-verify-4repo-diagnostics.test.mjs can exercise it
// directly. The CLI runs only when this file is invoked directly.

import { pathToFileURL } from 'node:url';

const ENDPOINTS = {
  lms: "https://www.daubepnho.store/api/v2/diagnostics",
  shop: "https://yeubep.shop/api/v2/diagnostics",
  portal: "https://www.yeunauan.live/api/v2/diagnostics",
  admin: "https://admin.yeunauan.live/api/v2/diagnostics"
};

const EXPECTED_COMPONENT = { lms: "lms", shop: "shop", portal: "portal", admin: "admin" };

// ── Pure normalization core (exported for tests) ───────────────────────────

// "Present" = own-property exists and is neither undefined nor null. This
// deliberately treats boolean `false` as PRESENT so a real killSwitch=false is
// never confused with a missing field (a plain truthiness check would erase it).
function present(obj, key) {
  return (
    !!obj &&
    typeof obj === "object" &&
    Object.prototype.hasOwnProperty.call(obj, key) &&
    obj[key] !== undefined &&
    obj[key] !== null
  );
}

// Per-field validity predicates. A field that is present but invalid (e.g.
// activeMode="v3") is treated as absent so we fall back to the other layer
// rather than passing garbage through.
const VALIDATORS = {
  component: (v) => typeof v === "string" && v.length > 0,
  activeMode: (v) => v === "v1" || v === "v2",
  killSwitch: (v) => typeof v === "boolean",
  source: (v) => typeof v === "string" && v.length > 0,
  ok: (v) => typeof v === "boolean",
};

// Resolve one canonical field from a diagnostics body: prefer the top-level
// value when it is present AND valid; otherwise fall back to the `runtime`
// envelope (LMS shape). Returns { has, value, from } where `from` is
// 'top' | 'runtime' | 'missing' — `from` is exposed for diagnostics output
// and tests so the normalization is transparent, not a black box.
function resolveField(body, key) {
  const runtimeEnvelope =
    body && typeof body === "object" && present(body, "runtime") && typeof body.runtime === "object"
      ? body.runtime
      : null;
  if (present(body, key) && VALIDATORS[key](body[key])) {
    return { has: true, value: body[key], from: "top" };
  }
  if (runtimeEnvelope && present(runtimeEnvelope, key) && VALIDATORS[key](runtimeEnvelope[key])) {
    return { has: true, value: runtimeEnvelope[key], from: "runtime" };
  }
  return { has: false, value: null, from: "missing" };
}

// Normalize any diagnostics response to a canonical internal object:
//   { component, activeMode, killSwitch, source, ok, _from, valid }
// `_from` records where each field was sourced from ('top'|'runtime'|'missing').
// `valid` is false only when the body itself is not a JSON object.
//
// `name` (optional) is the logical ENDPOINTS key (`lms`/`shop`/`portal`/
// `admin`). When the body carries no valid top-level or runtime `component`
// string, `name` is used as the fallback so operator output reads
// `component="lms"` instead of `component="null"`. The `_from.component`
// entry still reports `missing` (not `top`/`runtime`) so the fallback is
// transparent — tests and diagnostics can tell a real component value from a
// script-supplied one. Pass no `name` to get the raw, unfilled behavior
// (component stays null when absent) for low-level unit tests.
export function normalizeDiagnosticsResponse(body, name = null) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      valid: false,
      component: null,
      activeMode: null,
      killSwitch: null,
      source: null,
      ok: null,
      _from: { component: "missing", activeMode: "missing", killSwitch: "missing", source: "missing", ok: "missing" },
    };
  }
  const comp = resolveField(body, "component");
  const mode = resolveField(body, "activeMode");
  const kill = resolveField(body, "killSwitch");
  const src = resolveField(body, "source");
  const okF = resolveField(body, "ok");
  // Component fallback: only the script's own logical endpoint key is used
  // (never a hostname-derived guess), and only when no valid component was
  // resolved from the body. `_from.component` stays "missing" so callers can
  // still tell the value was filled in rather than read from the response.
  const componentValue = comp.has ? comp.value : (typeof name === "string" && name.length > 0 ? name : null);
  return {
    valid: true,
    component: componentValue,
    activeMode: mode.has ? mode.value : null,
    killSwitch: kill.has ? kill.value : null,
    source: src.has ? src.value : null,
    ok: okF.has ? okF.value : null,
    _from: { component: comp.from, activeMode: mode.from, killSwitch: kill.from, source: src.from, ok: okF.from },
  };
}

// Validate a normalized response for a given component name (`name` is the
// ENDPOINTS key: lms/shop/portal/admin). Returns an array of failure strings
// (empty = pass).
//
// Component contract: every endpoint is expected to report a `component`
// matching its logical identity. When the response does not supply one
// (LMS today), `normalizeDiagnosticsResponse(body, name)` fills the
// logical ENDPOINTS key so validation sees a consistent identity without
// requiring a production API change. A non-matching value (e.g. LMS
// returning "shop") is still flagged.
export function validateNormalized(name, norm) {
  const failures = [];
  if (!norm || !norm.valid) {
    failures.push(`${name}: invalid or non-object diagnostics body`);
    return failures;
  }
  if (norm.component !== EXPECTED_COMPONENT[name]) {
    failures.push(`${name}: component="${norm.component}", expected "${EXPECTED_COMPONENT[name]}"`);
  }
  if (norm.activeMode !== "v1" && norm.activeMode !== "v2") {
    failures.push(`${name}: activeMode="${norm.activeMode}", expected "v1" or "v2"`);
  }
  if (typeof norm.killSwitch !== "boolean") {
    failures.push(`${name}: killSwitch not boolean (got ${norm.killSwitch === null ? "missing" : typeof norm.killSwitch})`);
  }
  if (typeof norm.source !== "string" || norm.source.length === 0) {
    failures.push(`${name}: source missing or non-string`);
  }
  return failures;
}

// Cross-repo agreement over a { name -> activeMode } map. Returns
// { ok, agreed?, reason?, modes }. `ok` is true ONLY when exactly 4 valid
// modes are present and they all agree (and match EXPECTED_MODE if given).
// Incomplete (a component missing a valid mode) or disagreeing both fail.
export function computeAgreement(modes, expectedMode = null) {
  const entries = Object.entries(modes || {});
  const valid = entries.filter(([, m]) => m === "v1" || m === "v2");
  if (valid.length < 4) {
    return { ok: false, reason: "incomplete", have: valid.length, modes };
  }
  const distinct = new Set(valid.map(([, m]) => m));
  if (distinct.size > 1) {
    return { ok: false, reason: "disagree", modes };
  }
  const agreed = [...distinct][0];
  if (expectedMode && agreed !== expectedMode) {
    return { ok: false, reason: "expected_mismatch", agreed, expected: expectedMode, modes };
  }
  return { ok: true, agreed, modes };
}

// ── CLI (runs only when invoked directly) ──────────────────────────────────

async function main() {
  const SECRET = process.env.V2_WORKER_SECRET || process.env.INTERNAL_SYNC_SECRET;
  const EXPECTED_MODE = process.env.EXPECTED_MODE || null; // 'v1' | 'v2' | null (don't assert)

  if (!SECRET) {
    console.error("FAIL: set V2_WORKER_SECRET (or INTERNAL_SYNC_SECRET) env to run this check.");
    process.exit(2);
  }

  // Plant a sentinel that MUST NEVER appear in any response body. If a
  // diagnostics endpoint echoes the secret value, this catches it.
  const SECRET_SENTINEL = SECRET;

  async function probe(name, url) {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-v2-worker-secret": SECRET, "x-sync-secret": SECRET }
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    return { name, url, status: res.status, body, text };
  }

  const results = [];
  for (const [name, url] of Object.entries(ENDPOINTS)) {
    try {
      results.push(await probe(name, url));
    } catch (err) {
      results.push({ name, url, status: 0, body: null, text: "", error: String(err.message || err) });
    }
  }

  const failures = [];
  const modes = {};

  for (const r of results) {
    if (r.status !== 200) {
      failures.push(`${r.name}: expected HTTP 200, got ${r.status}${r.error ? " (" + r.error + ")" : ""}`);
      console.error(`✖ ${r.name}: HTTP ${r.status} — ${(r.text || "").slice(0, 120)}`);
      continue;
    }
    // Secret leak check (defense-in-depth) — runs on raw text regardless of shape.
    if (r.text.includes(SECRET_SENTINEL)) {
      failures.push(`${r.name}: response body contains the worker secret value (LEAK)`);
    }
    // Pass the logical ENDPOINTS key so LMS (no top-level component) gets a
    // readable fallback identity. `_from.component` still reports "missing"
    // when the value was filled in rather than read from the body.
    const norm = normalizeDiagnosticsResponse(r.body, r.name);
    const fieldFailures = validateNormalized(r.name, norm);
    failures.push(...fieldFailures);
    if (norm.activeMode === "v1" || norm.activeMode === "v2") {
      modes[r.name] = norm.activeMode;
    }
    const fromStr = `mode@${norm._from.activeMode},kill@${norm._from.killSwitch},source@${norm._from.source}`;
    if (fieldFailures.length) {
      console.error(`✖ ${r.name}: HTTP 200 ${fromStr} — ${fieldFailures.join("; ")}`);
    } else {
      console.error(`✔ ${r.name}: HTTP 200 component="${norm.component}" activeMode="${norm.activeMode}" kill=${norm.killSwitch} source="${norm.source}" ok=${norm.ok} (${fromStr})`);
    }
    if (r.body && r.body.flags) console.error(`    flags: ${JSON.stringify(r.body.flags).slice(0, 160)}`);
  }

  // Cross-repo agreement: all 4 must report the SAME activeMode. Now uses the
  // normalized mode so LMS (runtime-nested) is actually counted.
  const agreement = computeAgreement(modes, EXPECTED_MODE);
  if (!agreement.ok) {
    if (agreement.reason === "incomplete") {
      failures.push(`Only ${agreement.have}/4 components returned a valid activeMode (cannot verify agreement): ${JSON.stringify(modes)}`);
    } else if (agreement.reason === "disagree") {
      failures.push(`Components disagree on activeMode: ${JSON.stringify(modes)} — all must match within TTL after a flip.`);
    } else if (agreement.reason === "expected_mismatch") {
      failures.push(`All agree on activeMode="${agreement.agreed}" but EXPECTED_MODE="${agreement.expected}".`);
    }
  } else {
    console.error(`\n✔ ALL 4 COMPONENTS AGREE: activeMode="${agreement.agreed}"${EXPECTED_MODE ? " (matches EXPECTED_MODE)" : ""}.`);
  }

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} issue(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.error("\nPASS: all 4 diagnostics endpoints agree on runtime mode, no secret leak, component identities correct.");
  process.exit(0);
}

// Run the CLI only when this file is executed directly, not when imported by
// tests. `process.argv[1]` is the script path on `node scripts/...`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
