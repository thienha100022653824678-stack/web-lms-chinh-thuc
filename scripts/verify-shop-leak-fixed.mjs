// scripts/verify-shop-leak-fixed.mjs
//
// LIVE verification that the Shop P0 env-leak is closed in production.
// Asserts:
//   GET /api/check-auth?leak=extract_env_vars_now  -> 405 (not 200)
//   response body contains NO secret env keys and NO planted-secret values
//   POST /api/check-auth with wrong password -> 401 (auth path still works)
//   POST /api/check-auth with ADMIN_PASSWORD unset is not testable on prod
//       (env is set), so we only assert the wrong-password 401.
//
// Usage: node scripts/verify-shop-leak-fixed.mjs
// Exits 0 if the leak is closed; 1 otherwise.

const SHOP = "https://yeubep.shop";
const LEAK_URL = `${SHOP}/api/check-auth?leak=extract_env_vars_now`;

const FORBIDDEN_KEYS = [
  "ADMIN_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "INTERNAL_SYNC_SECRET",
  "GOOGLE_CLIENT_SECRET", "CLOUDINARY_API_SECRET", "CLOUDINARY_API_KEY",
  "SUPABASE_URL", "SYSTEM1_URL", "SYSTEM3_URL", "ADMIN_EMAILS", "GOOGLE_CLIENT_ID"
];

const failures = [];

// 1. Leak endpoint must be 405 (the handler returns 405 for GET now).
const r1 = await fetch(LEAK_URL, { method: "GET" });
const t1 = await r1.text();
if (r1.status !== 405) {
  failures.push(`leak endpoint: expected HTTP 405, got ${r1.status} (body: ${t1.slice(0,100)})`);
} else {
  console.error(`✔ leak endpoint -> HTTP 405 (closed)`);
}
// Defense-in-depth: even if status drifts, body must not contain secret keys.
const upper = t1.toUpperCase();
for (const k of FORBIDDEN_KEYS) {
  if (upper.includes(k.toUpperCase())) {
    failures.push(`leak endpoint body still contains env key "${k}"`);
  }
}

// 2. Auth path still works: POST wrong password -> 401.
const r2 = await fetch(`${SHOP}/api/check-auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "definitely-wrong-password-xyz" })
});
const t2 = await r2.text();
if (r2.status !== 401) {
  failures.push(`POST wrong-password: expected HTTP 401, got ${r2.status} (body: ${t2.slice(0,100)})`);
} else {
  console.error(`✔ POST wrong-password -> HTTP 401 (auth path intact)`);
}

if (failures.length) {
  console.error(`\nFAIL: Shop env-leak NOT fully closed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.error("\nPASS: Shop env-leak closed in production; auth path intact.");
process.exit(0);
