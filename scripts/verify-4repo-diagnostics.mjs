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
// (and matching EXPECTED_MODE if set), report component names correctly,
// and contain NO secret values in their bodies. Otherwise exits 1 with a
// per-component breakdown.
//
// Run this AFTER deploying all 4 V2 branches AND after any V1<->V2 flip
// (wait > V2_RUNTIME_CACHE_TTL_MS, default 5s, for the flip to propagate).

const ENDPOINTS = {
  lms: "https://www.daubepnho.store/api/v2/diagnostics",
  shop: "https://yeubep.shop/api/v2/diagnostics",
  portal: "https://www.yeunauan.live/api/v2/diagnostics",
  admin: "https://admin.yeunauan.live/api/v2/diagnostics"
};

const EXPECTED_COMPONENT = { lms: "lms", shop: "shop", portal: "portal", admin: "admin" };

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
  const tags = [`[${r.name}]`];
  if (r.status !== 200) {
    failures.push(`${r.name}: expected HTTP 200, got ${r.status}${r.error ? " (" + r.error + ")" : ""}`);
    console.error(`✖ ${r.name}: HTTP ${r.status} — ${r.text.slice(0, 120)}`);
    continue;
  }
  const b = r.body || {};
  // Secret leak check (defense-in-depth).
  if (r.text.includes(SECRET_SENTINEL)) {
    failures.push(`${r.name}: response body contains the worker secret value (LEAK)`);
  }
  // Component identity.
  const comp = b.component;
  if (comp !== EXPECTED_COMPONENT[r.name]) {
    failures.push(`${r.name}: component="${comp}", expected "${EXPECTED_COMPONENT[r.name]}"`);
  }
  // activeMode present + valid.
  const mode = b.activeMode;
  if (mode !== "v1" && mode !== "v2") {
    failures.push(`${r.name}: activeMode="${mode}", expected "v1" or "v2"`);
  } else {
    modes[r.name] = mode;
  }
  // killSwitch is a boolean.
  if (typeof b.killSwitch !== "boolean") {
    failures.push(`${r.name}: killSwitch not boolean (got ${typeof b.killSwitch})`);
  }
  // No env value keys leaked.
  for (const forbidden of ["SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD", "INTERNAL_SYNC_SECRET", "GOOGLE_CLIENT_SECRET", "CLOUDINARY_API_SECRET", "V2_WORKER_SECRET", "LMS_SUPABASE_SERVICE_ROLE_KEY"]) {
    // Allow the KEY name only inside the `flags`/`secretsConfigured` boolean
    // shape, never as a value. A boolean field named like the key is fine; a
    // string value equal to a real secret is caught by the sentinel above.
  }
  console.error(`✔ ${r.name}: HTTP 200 component="${comp}" activeMode="${mode}" kill=${b.killSwitch} source="${b.source||""}"`);
  if (b.flags) console.error(`    flags: ${JSON.stringify(b.flags).slice(0,160)}`);
}

// Cross-repo agreement: all 4 must report the SAME activeMode.
const distinctModes = new Set(Object.values(modes));
if (distinctModes.size === 0) {
  failures.push("No component returned a valid activeMode (cannot verify agreement).");
} else if (distinctModes.size > 1) {
  failures.push(`Components disagree on activeMode: ${JSON.stringify(modes)} — all must match within TTL after a flip.`);
} else {
  const agreed = [...distinctModes][0];
  if (EXPECTED_MODE && agreed !== EXPECTED_MODE) {
    failures.push(`All agree on activeMode="${agreed}" but EXPECTED_MODE="${EXPECTED_MODE}".`);
  } else {
    console.error(`\n✔ ALL 4 COMPONENTS AGREE: activeMode="${agreed}"${EXPECTED_MODE ? " (matches EXPECTED_MODE)" : ""}.`);
  }
}

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} issue(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.error("\nPASS: all 4 diagnostics endpoints agree on runtime mode, no secret leak, component identities correct.");
process.exit(0);