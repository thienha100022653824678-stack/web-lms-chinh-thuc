# V2 Canary-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the two V2 lineages into one integration branch and complete the remaining work (RP2-B2 logout, RP2-B3 revoke polish, sync verification, canary + rollback drill) to a canary-ready state, with V1 production untouched.

**Architecture:** Integration branch `v2/rebuild-20260715` is created from `v2/platform-rebuild`, then merges the security-RP lineage (`v2/rebuild-20260714` + `feat/v2-rp2b1-session-device-guard`). Each remaining slice is a feature branch that merges back into the integration branch. All V2 behavior stays behind feature flags; V1 production on `main` / `v1-stable-20260713` is never modified or deployed.

**Tech Stack:** Node.js (ESM, `"type":"module"`), Vercel serverless functions, Supabase B (ref `aqozjkfwzmyfunqvcyjv`) via `@supabase/supabase-js`, `googleapis` + `google-auth-library`, Node built-in `node:test` runner. No test framework dependency. No build step.

## Global Constraints

(From the approved spec `docs/superpowers/specs/2026-07-15-v2-canary-ready-design.md`. Every task's requirements implicitly include these.)

- Never merge V2 into `main`. Never deploy production. Never flip a V2 flag on the production environment.
- Migrations are additive-only; never drop/rename a V1 column. Apply migrations only via the runbook with a manual backup first.
- Never delete/rename V1 fields. Never mass-change slugs.
- Never log secret/token/private-key/service-role values. Test stubs mask emails and redact secret-like keys.
- Never commit `scratch/`, `review-dossier-*`, `.env*`, `node_modules/`, or `tests/.supabase-stub.json` (runtime test fixture, gitignored).
- Each slice: feature branch → tests pass → merge back into `v2/rebuild-20260715` → push. Commit messages end with the Co-Authored-By trailer.
- V1 baseline tag `v1-stable-20260713` (SHA `f9220e8`) is immutable. Supabase B ref `aqozjkfwzmyfunqvcyjv`.
- Cutover of real traffic is the owner's decision and is OUT of this plan.
- Required auth env (preview): `SESSION_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`, `INTERNAL_SYNC_SECRET`, `V2_WORKER_SECRET` (may equal `INTERNAL_SYNC_SECRET`). `ADMIN_EMAILS` CSV.
- Test invocation: `node --test tests/<file>.test.mjs` (no `npm test` script exists). Syntax check: `node --check <file>`.

---

## File Structure

### S0 — Integration base (merge-only, no new feature code)
- Modify (resolve 1 conflict): `utils/v2-flags.js` — union of platform-rebuild's sync-flag enum + RP2-B1's strict security-flag parser.
- No other file edits. Brings in (via merge): `api/v2/*`, `utils/v2-*.js`, `utils/cors.js`, `utils/lms-secrets.js`, `utils/lms-handlers/{course-data,lesson,verify-entry-token,exchange-code}.js` (B1 versions), `tests/{rp1-auth-hardening,rp2-cors,rp2b1-session-device}.test.mjs`, `tests/_supabase_stub_loader.mjs`, `migration_v2_*.sql`, `docs/v2/*`.

### S1 — RP2-B2 server-side logout
- Create: `utils/lms-handlers/logout.js` — portal logout handler (revoke + clear cookie, idempotent, fail-closed on flag-on).
- Create: `tests/rp2b2-logout.test.mjs` — node:test acceptance tests.
- Modify: `api/lms/portal.js` — dispatch `endpoint=logout` to the new handler.

### S2 — RP2-B3 admin revoke polish
- Modify: `utils/lms-handlers/admin-account-sharing-alerts.js` — `reset_session` branch: require+validate `reason`, idempotent `already_revoked`, `student_not_found`, `revoke_failed` contract, audit with real reason. Add `validateRevokeReason` + `lookupStudentExists` helpers.
- Create: `tests/rp2b3-revoke.test.mjs` — node:test acceptance tests.

### S3 — Sync verification (code = runbook docs; ops = owner-driven)
- Create: `docs/v2/V2_RECONCILIATION_RUNBOOK.md` — thresholds + expected results.
- Modify: `docs/v2/V2_IMPLEMENTATION_STATUS.md` — record S0/S1/S2 completion and S3 operator steps.
- Operator actions (documented, not code): run `scripts/v2/preflight-v2.sql`, apply `migration_v2_sync_outbox.sql` + `migration_v2_identity_mapping.sql`, run `scripts/v2/postflight-v2.sql`, flip preview env flags, verify via `/api/v2/readiness`, `/api/v2/outbox`, `/api/v2/portal-projection-preview`, `/api/v2/sync-worker`.

### S4 — Canary readiness (docs + drills)
- Modify: `docs/v2/V2_ROLLBACK_RUNBOOK.md` — add the 3-drill procedure + results template.
- Create: `docs/v2/V2_CUTOVER_RUNBOOK.md` — flag-flip order for owner cutover (documentation only).
- Modify: `docs/v2/V2_TEST_MATRIX.md` — add canary scenarios.
- Modify: `docs/v2/V2_IMPLEMENTATION_STATUS.md` — mark canary-ready.
- Operator actions (documented): run rollback drills on preview, record results.

---

## Task S0: Integration base — merge two V2 lineages

**Files:**
- Resolve conflict: `utils/v2-flags.js`
- Verify: `tests/rp1-auth-hardening.test.mjs`, `tests/rp2-cors.test.mjs`, `tests/rp2b1-session-device.test.mjs`

**Interfaces:**
- Consumes: branches `v2/platform-rebuild`, `v2/rebuild-20260714`, `feat/v2-rp2b1-session-device-guard` (all exist on origin).
- Produces: branch `v2/rebuild-20260715` = union of both lineages. Later slices branch from this. `utils/v2-flags.js` exports BOTH `V2_FLAGS`/`getV2Env`/`isV2FlagEnabled`/`getV2ListFlag`/`getV2RuntimeMode` (platform) AND `parseBooleanFlag`/`isV2CorsAllowlistEnabled`/`isV2GlobalOneDeviceEnabled`/`_internals` (RP2-B1).

**Verified conflict surface (run before starting):** `git merge-tree --write-tree --merge-base f9220e8 v2/platform-rebuild v2/rebuild-20260714` exits 0 (clean). `git merge-tree --write-tree --merge-base f9220e8 v2/platform-rebuild feat/v2-rp2b1-session-device-guard` reports exactly one conflict: `utils/v2-flags.js` (add/add). Both lineages created this file independently — platform for sync flags, RP2-B1 for security flags. Resolution = union (keep both groups).

- [ ] **Step 1: Confirm clean starting state**

Run from the main worktree (`C:/Users/gaomi/Downloads/Telegram Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc`):
```bash
git status --short
git rev-parse HEAD
git branch --show-current
```
Expected: only untracked `.claude/`, `review-dossier-*`, `scratch/` (per `.gitignore` they are not staged); HEAD is on `v2/platform-rebuild`. If working tree has staged/modified tracked files, stop and resolve before merging.

- [ ] **Step 2: Create the integration branch from platform-rebuild**

```bash
git checkout -b v2/rebuild-20260715 v2/platform-rebuild
```
Expected: new branch `v2/rebuild-20260715` at the same SHA as `v2/platform-rebuild`.

- [ ] **Step 3: Merge the security-RP lineage (expect clean)**

```bash
git merge v2/rebuild-20260714 --no-ff -m "merge(v2): integrate security RP lineage (RP-1, RP2-A, RP2-B0) into platform-rebuild base"
```
Expected: clean merge, no conflicts. This brings in `utils/lms-secrets.js`, `utils/cors.js`, the B1-touched `utils/lms-handlers/*`, `tests/rp1-auth-hardening.test.mjs`, `tests/rp2-cors.test.mjs`, and the RP-1 changes to `utils/lms.js` / `api/sync.js` / `api/lms/admin.js`.

- [ ] **Step 4: Merge RP2-B1 (expect 1 conflict: utils/v2-flags.js)**

```bash
git merge feat/v2-rp2b1-session-device-guard --no-ff -m "merge(v2): integrate RP2-B1 global one-device guard"
```
Expected: one conflict — `utils/v2-flags.js` (add/add). The merge stops for resolution.

- [ ] **Step 5: Resolve utils/v2-flags.js as the union**

Overwrite `utils/v2-flags.js` with this exact content (union of both lineages; the two flag groups are independent and do not conflict semantically):

```js
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);

export const V2_FLAGS = Object.freeze({
  PLATFORM_ENABLED: 'V2_PLATFORM_ENABLED',
  OUTBOX_SHADOW_MODE: 'V2_OUTBOX_SHADOW_MODE',
  OUTBOX_WORKER_ENABLED: 'V2_OUTBOX_WORKER_ENABLED',
  OUTBOX_WORKER_DRY_RUN: 'V2_OUTBOX_WORKER_DRY_RUN',
  DELIVERY_HANDLERS_ENABLED: 'V2_DELIVERY_HANDLERS_ENABLED',
  PORTAL_PROJECTION_ENABLED: 'V2_PORTAL_PROJECTION_ENABLED',
  PORTAL_PROJECTION_DRY_RUN: 'V2_PORTAL_PROJECTION_DRY_RUN',
  SESSION_LEASE_ENABLED: 'V2_SESSION_LEASE_ENABLED',
  ENTRY_TOKEN_REQUIRED: 'V2_ENTRY_TOKEN_REQUIRED',
  DRIVE_WORKER_DRY_RUN: 'V2_DRIVE_WORKER_DRY_RUN',
  RECONCILIATION_READONLY: 'V2_RECONCILIATION_READONLY',
  RISK_SCORING_ENABLED: 'V2_RISK_SCORING_ENABLED',
});

export function getV2Env(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim();
}

export function isV2FlagEnabled(name, fallback = false) {
  const value = getV2Env(name);
  if (!value) return fallback;
  return TRUE_VALUES.has(value.toLowerCase());
}

export function getV2ListFlag(name) {
  return getV2Env(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getV2RuntimeMode() {
  return getV2Env('V2_RUNTIME_MODE', isV2FlagEnabled(V2_FLAGS.PLATFORM_ENABLED) ? 'enabled' : 'off');
}

// ── RP2-A / RP2-B1 security flags (strict parser) ───────────────────────────
// Pure-function parser: only 1/true/yes/on (case-insensitive, trimmed) become
// true. Anything else (0/false/no/off/empty/undefined/non-string) is false.
// Never raises, never logs, never echoes the env value. Accepts an env-shaped
// object so tests can pass a snapshot without touching process.env.
export function parseBooleanFlag(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

// RP2-A CORS allowlist flag. Kept separate from the one-device flag so the two
// features can be enabled independently.
export function isV2CorsAllowlistEnabled(env = process.env) {
  return parseBooleanFlag(env?.V2_CORS_ALLOWLIST_ENABLED);
}

// RP2-B1 global one-device / LMS verified-session enforcement. When true,
// course-data/lesson treat every course as requiring a verified LMS session
// and the legacy LMS_ENTRY_TOKEN_REQUIRED_COURSES allowlist is ignored as a
// bypass gate. When false (default), V1 behavior is preserved exactly.
export function isV2GlobalOneDeviceEnabled(env = process.env) {
  return parseBooleanFlag(env?.V2_GLOBAL_ONE_DEVICE_ENABLED);
}

export const _internals = { parseBooleanFlag };
```

Then:
```bash
git add utils/v2-flags.js
git status --short
```
Expected: only `UU utils/v2-flags.js` resolved (now `M`); no other unresolved paths.

- [ ] **Step 6: Complete the merge commit**

```bash
git commit --no-edit
```
Expected: merge commit created for RP2-B1 integration.

- [ ] **Step 7: Verify syntax of the resolved file + all touched handlers**

```bash
node --check utils/v2-flags.js
node --check utils/lms.js
node --check utils/lms-session-guard.js
node --check utils/cors.js
node --check utils/lms-secrets.js
node --check api/sync.js
node --check api/lms/admin.js
node --check api/lms/portal.js
node --check utils/lms-handlers/course-data.js
node --check utils/lms-handlers/lesson.js
node --check utils/lms-handlers/verify-entry-token.js
node --check utils/lms-handlers/exchange-code.js
node --check utils/v2-sync-worker.js
node --check utils/v2-readiness.js
```
Expected: every command exits 0 with no output.

- [ ] **Step 8: Run the inherited test suites**

```bash
node --test tests/rp1-auth-hardening.test.mjs
node --test tests/rp2-cors.test.mjs
node --test tests/rp2b1-session-device.test.mjs
```
Expected: all three pass (RP-1: 48 pass; RP2-A: 29 pass; RP2-B1: its full count pass). Zero failures. If any test fails after the merge, DO NOT proceed — this is the S0 kill-switch: stop, report the failure, and fall back to the "finish-first" approach (build B2/B3 on the RP lineage before merging).

- [ ] **Step 9: Push the integration branch**

```bash
git push -u origin v2/rebuild-20260715
```
Expected: branch pushed to origin.

- [ ] **Step 10: Commit the spec/plan docs alignment (if not already on this branch)**

The design spec was committed on `v2/platform-rebuild` (commits `e1d1c20`, `d39a357`). Since `v2/rebuild-20260715` was branched from `v2/platform-rebuild` AFTER those commits, the spec is already present. Verify:
```bash
ls docs/superpowers/specs/2026-07-15-v2-canary-ready-design.md
```
Expected: file exists. (If somehow missing, the plan author must have branched before the spec commit — re-cherry-pick `e1d1c20` and `d39a357` onto this branch before continuing.)

---

## Task S1: RP2-B2 — Server-side student logout

**Files:**
- Create: `utils/lms-handlers/logout.js`
- Create: `tests/rp2b2-logout.test.mjs`
- Modify: `api/lms/portal.js` (add `endpoint=logout` dispatch)

**Interfaces:**
- Consumes (from `utils/lms-session-guard.js`): `verifyLmsVerifiedSessionAccess(supabase, { lmsSessionId, lmsDeviceId, courseSlug? })` → `{ ok, reason, email, courseSlug, session, studentSession, enrollment }`; `markStudentSessionLoggedOut(supabase, studentSessionId)` → row or null (idempotent: returns null when no active session matched); `mapLmsAccessReasonToError(reason)` → error code; `httpStatusForLmsAccessError(code, { flagOn })` → HTTP status.
- Consumes (from `utils/lms.js`): `cookieOptions(maxAgeMs)` (use `0` for deletion); `parseCookies(req)`.
- Consumes (from `utils/cors.js`): `applyCors(req, res, { mode, methods, allowedHeaders })` → `{ handled, status?, body? }`.
- Consumes (from `utils/v2-flags.js`): `isV2GlobalOneDeviceEnabled(env?)` → boolean.
- Produces: `export default async function handler(req, res)` mounted at `endpoint=logout`. Test seams: `globalThis.__RP2B2_LOGOUT_VERIFY_STUB__` (a pre-resolved access result object, or `undefined` to use the real function), `globalThis.__RP2B2_LOGOUT_FN_STUB__` (a function `(supabase, sid) => Promise<row|null>`, or `undefined` to use `markStudentSessionLoggedOut`).

**Behavior matrix (the contract this task enforces):**
- Flag ON + valid session → revoke + clear cookie → 200 `{ success:true, loggedOut:true, serverRevoked:true }`.
- Flag ON + missing/invalid session → fail-closed (401 `invalid_session`, or 503 `one_device_policy_unavailable` if the revoke itself throws) → NO cookie clear.
- Flag OFF + valid session → revoke + clear cookie → 200 `serverRevoked:true`.
- Flag OFF + no valid session → clear cookie only → 200 `serverRevoked:false` (V1 compat; honest, not faking a server revoke).
- Revoke throws + flag ON → 503 `one_device_policy_unavailable`, NO cookie clear.
- Revoke throws + flag OFF → 500 `logout_failed`, NO cookie clear.

- [ ] **Step 1: Write the failing test file**

Create `tests/rp2b2-logout.test.mjs` with this content:

```js
// tests/rp2b2-logout.test.mjs
// RP2-B2 — Server-side logout acceptance tests. node:test, no real DB.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rp2b2-test-session-secret-please-rotate";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "rp2b2-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "rp2b2-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "rp2b2-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://rp2b2-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "rp2b2-test-service-role-key";

const FLAG_KEYS = ["V2_GLOBAL_ONE_DEVICE_ENABLED", "V2_CORS_ALLOWLIST_ENABLED", "LMS_PORTAL_ORIGINS"];
function snapshotEnv() { const s = {}; for (const k of FLAG_KEYS) s[k] = process.env[k]; return s; }
function restoreEnv(s) { for (const k of FLAG_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } }
function clearFlagEnv() { for (const k of FLAG_KEYS) delete process.env[k]; }

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.json = (body) => { r.jsonBody = body; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
function mockReq({ method = "POST", headers = {}, body = {} } = {}) {
  return { method, headers, body, query: {} };
}

function validAccess() {
  return {
    ok: true, reason: "valid", email: "stu@example.com", courseSlug: "khoa-a",
    session: { student_session_id: "sess_123", lms_session_id: "lms_abc", lms_device_id: "dev_1" },
    studentSession: { student_session_id: "sess_123", email: "stu@example.com", status: "active" },
    enrollment: { id: "e1", status: "active" }
  };
}

test("logout: flag-on, valid session -> 200, serverRevoked true, cookie cleared", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  let revoked = false;
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { revoked = true; return { student_session_id: "sess_123" }; };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, true);
    assert.equal(res.jsonBody.loggedOut, true);
    assert.match(res.headers["Set-Cookie"] || "", /course_session_token=;/);
    assert.equal(revoked, true);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: idempotent — second call still 200 even though revoke matched nothing", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => null; // already logged_out -> 0 rows
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, true);
    assert.match(res.headers["Set-Cookie"] || "", /Max-Age=0/);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: flag-on, missing headers -> 401 invalid_session, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__;
  delete globalThis.__RP2B2_LOGOUT_FN_STUB__;
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody.error, "invalid_session");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); }
});

test("logout: flag-on, verify fails -> 401, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = { ok: false, reason: "device_mismatch", session: {} };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_other" } }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; }
});

test("logout: flag-on, revoke throws -> 503 one_device_policy_unavailable, no cookie clear", async () => {
  clearFlagEnv(); process.env.V2_GLOBAL_ONE_DEVICE_ENABLED = "1";
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { throw new Error("db down"); };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.jsonBody.error, "one_device_policy_unavailable");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: flag-off, no session -> 200 best-effort, serverRevoked false, cookie cleared", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__;
  delete globalThis.__RP2B2_LOGOUT_FN_STUB__;
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: {} }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, false);
    assert.match(res.headers["Set-Cookie"] || "", /course_session_token=;/);
  } finally { restoreEnv(snap); }
});

test("logout: flag-off, valid session -> 200 serverRevoked true", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  let revoked = false;
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { revoked = true; return { student_session_id: "sess_123" }; };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.serverRevoked, true);
    assert.equal(revoked, true);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: flag-off, revoke throws -> 500 logout_failed, no cookie clear", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ = validAccess();
  globalThis.__RP2B2_LOGOUT_FN_STUB__ = async () => { throw new Error("db down"); };
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ headers: { "x-lms-session-id": "lms_abc", "x-lms-device-id": "dev_1" } }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.error, "logout_failed");
    assert.equal(res.headers["Set-Cookie"], undefined);
  } finally { restoreEnv(snap); delete globalThis.__RP2B2_LOGOUT_VERIFY_STUB__; delete globalThis.__RP2B2_LOGOUT_FN_STUB__; }
});

test("logout: rejects GET with 405", async () => {
  clearFlagEnv();
  const snap = snapshotEnv();
  try {
    const { default: handler } = await import("../utils/lms-handlers/logout.js");
    const res = mockRes();
    await handler(mockReq({ method: "GET", headers: {} }), res);
    assert.equal(res.statusCode, 405);
  } finally { restoreEnv(snap); }
});
```

- [ ] **Step 2: Run the test to verify it fails (module not found)**

```bash
node --test tests/rp2b2-logout.test.mjs
```
Expected: FAIL — `Cannot find module '../utils/lms-handlers/logout.js'`.

- [ ] **Step 3: Implement the logout handler**

Create `utils/lms-handlers/logout.js` with this content:

```js
// utils/lms-handlers/logout.js
// RP2-B2 — Server-side student logout.
//
// Revokes the student active session server-side and clears the
// course_session_token cookie. Idempotent: a repeat call after a successful
// logout still returns 200. On server failure the handler does NOT clear the
// cookie or fake success — the client only clears local state after a 200.
//
// Identity comes from the LMS verified-session headers
// (X-LMS-Session-Id / X-LMS-Device-Id), never from course_session_token.
// When V2_GLOBAL_ONE_DEVICE_ENABLED is on, a missing/invalid session fails
// closed (401/503). When the flag is off, a missing/invalid session falls
// back to a best-effort client cookie clear (V1 compat).

import { supabase } from "../supabase.js";
import { cookieOptions } from "../lms.js";
import {
  verifyLmsVerifiedSessionAccess,
  markStudentSessionLoggedOut,
  mapLmsAccessReasonToError,
  httpStatusForLmsAccessError
} from "../lms-session-guard.js";
import { isV2GlobalOneDeviceEnabled } from "../v2-flags.js";
import { applyCors } from "../cors.js";

const SESSION_COOKIE = "course_session_token";

function getLmsSessionHeaders(req) {
  return {
    lmsSessionId: String(req.headers["x-lms-session-id"] || "").trim(),
    lmsDeviceId: String(req.headers["x-lms-device-id"] || "").trim()
  };
}

function respondWithAccessError(res, { reason, flagOn, fallbackStatus = 401 }) {
  const errorCode = mapLmsAccessReasonToError(reason);
  const status = httpStatusForLmsAccessError(errorCode, { flagOn }) || fallbackStatus;
  return res.status(status).json({
    success: false,
    allowed: false,
    error: errorCode,
    authError: errorCode,
    code: errorCode
  });
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${cookieOptions(0)}`);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "portal",
    methods: "POST, OPTIONS",
    allowedHeaders: "Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const flagOn = isV2GlobalOneDeviceEnabled();
  const lmsHeaders = getLmsSessionHeaders(req);
  const hasHeaders = Boolean(lmsHeaders.lmsSessionId && lmsHeaders.lmsDeviceId);

  let access = null;
  let failureReason = "";

  if (hasHeaders) {
    let result;
    if (globalThis.__RP2B2_LOGOUT_VERIFY_STUB__ !== undefined) {
      result = globalThis.__RP2B2_LOGOUT_VERIFY_STUB__;
    } else {
      result = await verifyLmsVerifiedSessionAccess(supabase, { ...lmsHeaders });
    }
    if (result && result.ok) {
      access = result;
    } else {
      failureReason = (result && result.reason) || "invalid_lms_session";
    }
  } else {
    failureReason = "missing_lms_session";
  }

  // Flag-on: a valid LMS verified session is mandatory. Fail closed; do not
  // touch the cookie.
  if (flagOn && !access) {
    return respondWithAccessError(res, {
      reason: failureReason || "missing_lms_session",
      flagOn: true
    });
  }

  // Flag-off, no valid session: best-effort client logout (V1 compat). We do
  // not fake a server revoke — serverRevoked is false.
  if (!access) {
    clearSessionCookie(res);
    return res.status(200).json({
      success: true,
      loggedOut: true,
      serverRevoked: false
    });
  }

  // Valid session: revoke server-side (idempotent — 0 rows is fine).
  const studentSessionId = access.studentSession?.student_session_id;
  try {
    const logoutFn = globalThis.__RP2B2_LOGOUT_FN_STUB__ ?? markStudentSessionLoggedOut;
    if (studentSessionId) {
      await logoutFn(supabase, studentSessionId);
    }
  } catch (err) {
    console.error("[logout] server revoke failed:", err.message);
    if (flagOn) {
      return res.status(503).json({
        success: false,
        error: "one_device_policy_unavailable",
        code: "one_device_policy_unavailable"
      });
    }
    return res.status(500).json({
      success: false,
      error: "logout_failed",
      code: "logout_failed"
    });
  }

  clearSessionCookie(res);
  return res.status(200).json({
    success: true,
    loggedOut: true,
    serverRevoked: true
  });
}
```

- [ ] **Step 4: Wire the endpoint into api/lms/portal.js**

In `api/lms/portal.js`, add the import after the existing handler imports (after the `verifyEntryTokenHandler` import line) and add the dispatch branch before the final 404 return. The file currently dispatches `course-data`, `lesson`, `public-config`, `public-lesson`, `verify-entry-token`.

Add import:
```js
import logoutHandler from "../../utils/lms-handlers/logout.js";
```
Add dispatch (before the `return res.status(404)...` line):
```js
  if (endpoint === "logout") {
    return logoutHandler(req, res);
  }
```

- [ ] **Step 5: Run syntax checks**

```bash
node --check utils/lms-handlers/logout.js
node --check api/lms/portal.js
```
Expected: exit 0, no output.

- [ ] **Step 6: Run the test to verify it passes**

```bash
node --test tests/rp2b2-logout.test.mjs
```
Expected: PASS — all 9 tests pass, 0 fail.

- [ ] **Step 7: Regression — ensure inherited suites still pass**

```bash
node --test tests/rp1-auth-hardening.test.mjs
node --test tests/rp2-cors.test.mjs
node --test tests/rp2b1-session-device.test.mjs
```
Expected: all pass (the new portal.js dispatch line and logout.js do not touch their surfaces).

- [ ] **Step 8: Commit on the slice branch**

```bash
git checkout -b feat/v2-rp2b2-logout
git add utils/lms-handlers/logout.js api/lms/portal.js tests/rp2b2-logout.test.mjs
git commit -m "$(cat <<'EOF'
feat(v2-rp2b2): add server-side student logout endpoint

Portal endpoint=logout revokes the student active session server-side
and clears course_session_token. Idempotent; fail-closed (503) on
server error when V2_GLOBAL_ONE_DEVICE_ENABLED is on; V1-compat
best-effort cookie clear when the flag is off. Identity comes from
X-LMS-Session-Id/X-LMS-Device-Id, never the cookie. 9 node:test
cases pass.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Merge back into the integration branch**

```bash
git checkout v2/rebuild-20260715
git merge feat/v2-rp2b2-logout --no-ff -m "merge(v2): RP2-B2 server-side logout"
node --test tests/rp2b2-logout.test.mjs
```
Expected: clean merge; tests pass post-merge.

---

## Task S2: RP2-B3 — Admin revoke polish

**Files:**
- Modify: `utils/lms-handlers/admin-account-sharing-alerts.js` (the `reset_session` branch in `postAction`, ~line 702; add two helpers near the top of the file)
- Create: `tests/rp2b3-revoke.test.mjs`

**Interfaces:**
- Consumes (already imported in the file): `resetStudentSessionByEmail(supabase, email, { adminEmail, reason })` → `{ ok, studentSessions, entryTokens, lmsSessions, revokedBefore, usedRpc }`; `writeAdminAuditLog(supabase, { adminEmail, action, targetEmail, metadata, ip, userAgent })`; `getAdminFromRequest(req)` (from `lms.js`); the local `upsertReview({ email, adminEmail, status, monitoringUntil })`.
- Produces: exported `validateRevokeReason(body)` → `{ ok, reason } | { ok:false, code, status }`. Local `lookupStudentExists(supabase, email)` → `Promise<boolean>` (non-fatal: returns `true` on lookup error so a DB hiccup never blocks a revoke). Test seam: `globalThis.__RP2B3_RESET_DEPS__` = optional `{ resetStudentSessionByEmail?, lookupStudentExists?, writeAdminAuditLog?, upsertReview? }` to override the four external deps in the `reset_session` branch.

**Behavior contract for `reset_session`:**
- Missing `reason` → 400 `{ success:false, error:"reason_required", code:"reason_required" }`.
- `reason` > 500 chars → 400 `reason_too_long`.
- Student not found (lookup succeeds, returns false) → 404 `{ success:false, error:"student_not_found", code:"student_not_found" }` (no revoke, no audit of a revoke).
- Revoke succeeds, `studentSessions === 0` → 200 `{ success:true, alreadyRevoked:true, affectedSessions:0, reset }` (idempotent no-op; audit still records the attempt with the real reason).
- Revoke succeeds, `studentSessions > 0` → 200 `{ success:true, alreadyRevoked:false, affectedSessions, reset }` (audit with real reason; `upsertReview` monitoring).
- Revoke throws → 500 `{ success:false, error:"revoke_failed", code:"revoke_failed" }`.
- No email/IP/device/session-id/DB-error string in any response.

**Assumption documented for the reviewer:** `student_not_found` uses an equality lookup on `students.email` with the already-normalized (lowercased) email, consistent with the codebase's `normalizeEmail` convention. If a student row were stored non-normalized this could falsely 404; the lookup is non-fatal on its own errors (degrades to "exists") so a lookup failure never blocks a revoke.

- [ ] **Step 1: Write the failing test file**

Create `tests/rp2b3-revoke.test.mjs`:

```js
// tests/rp2b3-revoke.test.mjs
// RP2-B3 — Admin revoke polish acceptance tests. node:test, no real DB.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LMS_RP1_ALLOW_INSECURE_LOCAL = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.VERCEL_ENV = process.env.VERCEL_ENV || "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rp2b3-test-session-secret-please-rotate";
process.env.ACCOUNT_EVENT_HASH_SECRET = process.env.ACCOUNT_EVENT_HASH_SECRET || "rp2b3-test-account-event-hash-secret";
process.env.SESSION_GUARD_HASH_SECRET = process.env.SESSION_GUARD_HASH_SECRET || "rp2b3-test-account-event-hash-secret";
process.env.INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET || "rp2b3-test-internal-sync-secret";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "owner@example.com";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://rp2b3-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "rp2b3-test-service-role-key";

const FLAG_KEYS = ["V2_CORS_ALLOWLIST_ENABLED", "LMS_ADMIN_ORIGINS"];
function snapshotEnv() { const s = {}; for (const k of FLAG_KEYS) s[k] = process.env[k]; return s; }
function restoreEnv(s) { for (const k of FLAG_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } }
function clearFlagEnv() { for (const k of FLAG_KEYS) delete process.env[k]; }

function mockRes() {
  const r = { statusCode: null, headers: {}, jsonBody: null, ended: false };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.json = (body) => { r.jsonBody = body; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
function mockReq({ method = "POST", body = {}, headers = {} } = {}) {
  return { method, headers, body, query: { mode: "action" }, headers: headers, socket: {} };
}

async function adminReq(body) {
  const lms = await import("../utils/lms.js");
  const token = lms.createAdminSession("owner@example.com").token;
  return mockReq({ body, headers: { authorization: `Bearer ${token}`, "user-agent": "test" } });
}

// ---- pure helper ----
test("validateRevokeReason: empty -> reason_required", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({ reason: "   " });
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_required");
  assert.equal(r.status, 400);
});

test("validateRevokeReason: missing field -> reason_required", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({});
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_required");
});

test("validateRevokeReason: over 500 chars -> reason_too_long", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({ reason: "x".repeat(501) });
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_too_long");
  assert.equal(r.status, 400);
});

test("validateRevokeReason: valid -> trimmed reason", async () => {
  const { validateRevokeReason } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
  const r = validateRevokeReason({ reason: "  mat may  " });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "mat may");
});

// ---- handler reset_session branch ----
async function withDeps(deps, fn) {
  globalThis.__RP2B3_RESET_DEPS__ = deps;
  try { await fn(); } finally { delete globalThis.__RP2B3_RESET_DEPS__; }
}

test("reset_session: no reason -> 400 reason_required", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com" }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "reason_required");
  } finally { restoreEnv(snap); }
});

test("reset_session: reason too long -> 400 reason_too_long", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  try {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "y".repeat(501) }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, "reason_too_long");
  } finally { restoreEnv(snap); }
});

test("reset_session: student not found -> 404 student_not_found, no revoke", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  let revokeCalled = false;
  await withDeps({
    lookupStudentExists: async () => false,
    resetStudentSessionByEmail: async () => { revokeCalled = true; return { studentSessions: 0 }; },
    writeAdminAuditLog: async () => ({ ok: true }),
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "ghost@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.jsonBody.error, "student_not_found");
    assert.equal(revokeCalled, false);
  });
  restoreEnv(snap);
});

test("reset_session: nothing active -> 200 alreadyRevoked true, audit has reason", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  let auditArg = null;
  await withDeps({
    lookupStudentExists: async () => true,
    resetStudentSessionByEmail: async () => ({ ok: true, studentSessions: 0, entryTokens: 0, lmsSessions: 0, usedRpc: true }),
    writeAdminAuditLog: async (_s, a) => { auditArg = a; return { ok: true }; },
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.alreadyRevoked, true);
    assert.equal(res.jsonBody.affectedSessions, 0);
    assert.equal(auditArg.action, "account_sharing_reset_session");
    assert.equal(auditArg.metadata.reason, "mat may");
  });
  restoreEnv(snap);
});

test("reset_session: revoked active -> 200 alreadyRevoked false, affectedSessions>0", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  await withDeps({
    lookupStudentExists: async () => true,
    resetStudentSessionByEmail: async () => ({ ok: true, studentSessions: 1, entryTokens: 2, lmsSessions: 1, usedRpc: true }),
    writeAdminAuditLog: async () => ({ ok: true }),
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.alreadyRevoked, false);
    assert.equal(res.jsonBody.affectedSessions, 1);
  });
  restoreEnv(snap);
});

test("reset_session: revoke throws -> 500 revoke_failed", async () => {
  clearFlagEnv(); const snap = snapshotEnv();
  await withDeps({
    lookupStudentExists: async () => true,
    resetStudentSessionByEmail: async () => { throw new Error("rpc down"); },
    writeAdminAuditLog: async () => ({ ok: true }),
    upsertReview: async () => ({})
  }, async () => {
    const { default: handler } = await import("../utils/lms-handlers/admin-account-sharing-alerts.js");
    const res = mockRes();
    await handler(await adminReq({ action: "reset_session", email: "stu@example.com", reason: "mat may" }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.error, "revoke_failed");
    // No raw DB error string leaks:
    assert.equal(String(res.jsonBody.message || "").includes("rpc down"), false);
  });
  restoreEnv(snap);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/rp2b3-revoke.test.mjs
```
Expected: FAIL — `validateRevokeReason` is not exported (and the `reason_required` / `student_not_found` / `alreadyRevoked` behaviors do not exist yet).

- [ ] **Step 3: Add the two helpers near the top of admin-account-sharing-alerts.js**

In `utils/lms-handlers/admin-account-sharing-alerts.js`, after the existing imports and the `RISK_LEVELS` / constant block (around line 18, after `const TIMELINE_COLLAPSE_WINDOW_MS = ...`), add:

```js
// RP2-B3 — Revoke reason validation. Pure function so it can be unit-tested
// without a database. The admin must supply a non-empty reason (max 500 chars)
// for every reset_session; we never use a default reason.
export function validateRevokeReason(body) {
  const raw = String(body?.reason ?? "").trim();
  if (!raw) {
    return { ok: false, code: "reason_required", status: 400 };
  }
  if (raw.length > 500) {
    return { ok: false, code: "reason_too_long", status: 400 };
  }
  return { ok: true, reason: raw };
}

// RP2-B3 — Student existence lookup for student_not_found. Non-fatal: on any
// lookup error we return true so a DB hiccup never blocks a legitimate revoke.
// Email is already normalized (lowercased) by the caller, matching the
// codebase's normalizeEmail convention for the students table.
async function lookupStudentExists(supabase, email) {
  try {
    const { data, error } = await supabase
      .from("students")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (error) return true;
    return Boolean(data);
  } catch {
    return true;
  }
}
```

- [ ] **Step 4: Replace the reset_session branch with the polished version**

In `postAction` (around line 702), replace the existing `if (action === "reset_session") { ... }` block (which currently hardcodes `reason: "account_sharing_admin_reset"`) with:

```js
  if (action === "reset_session") {
    const reasonCheck = validateRevokeReason(body);
    if (!reasonCheck.ok) {
      return res.status(reasonCheck.status).json({
        success: false,
        error: reasonCheck.code,
        code: reasonCheck.code
      });
    }
    const reason = reasonCheck.reason;

    const deps = globalThis.__RP2B3_RESET_DEPS__ || {};
    const existsFn = deps.lookupStudentExists || lookupStudentExists;
    const resetFn = deps.resetStudentSessionByEmail || resetStudentSessionByEmail;
    const auditFn = deps.writeAdminAuditLog || writeAdminAuditLog;
    const reviewFn = deps.upsertReview || upsertReview;

    let exists;
    try {
      exists = await existsFn(supabase, email);
    } catch {
      exists = true; // non-fatal
    }
    if (!exists) {
      return res.status(404).json({
        success: false,
        error: "student_not_found",
        code: "student_not_found"
      });
    }

    let resetResult;
    try {
      resetResult = await resetFn(supabase, email, { adminEmail, reason });
    } catch (err) {
      console.error("[reset_session] revoke failed:", err.message);
      return res.status(500).json({
        success: false,
        error: "revoke_failed",
        code: "revoke_failed"
      });
    }

    const affectedSessions = Number(resetResult?.studentSessions || 0);
    await auditFn(supabase, {
      adminEmail,
      action: "account_sharing_reset_session",
      targetEmail: email,
      metadata: {
        reason,
        affectedStudentSessions: affectedSessions,
        affectedEntryTokens: Number(resetResult?.entryTokens || 0),
        affectedLmsSessions: Number(resetResult?.lmsSessions || 0),
        usedRpc: resetResult?.usedRpc
      },
      ip,
      userAgent
    });
    await reviewFn({ email, adminEmail, status: "monitoring" });

    return res.status(200).json({
      success: true,
      alreadyRevoked: affectedSessions === 0,
      affectedSessions,
      reset: resetResult
    });
  }
```

- [ ] **Step 5: Syntax check**

```bash
node --check utils/lms-handlers/admin-account-sharing-alerts.js
```
Expected: exit 0.

- [ ] **Step 6: Run the test to verify it passes**

```bash
node --test tests/rp2b3-revoke.test.mjs
```
Expected: PASS — all tests pass, 0 fail.

- [ ] **Step 7: Regression — inherited suites still pass**

```bash
node --test tests/rp1-auth-hardening.test.mjs
node --test tests/rp2-cors.test.mjs
node --test tests/rp2b1-session-device.test.mjs
node --test tests/rp2b2-logout.test.mjs
```
Expected: all pass. (The change is isolated to the `reset_session` branch and two added helpers; other actions in `postAction` are untouched.)

- [ ] **Step 8: Commit on the slice branch**

```bash
git checkout -b feat/v2-rp2b3-revoke-polish
git add utils/lms-handlers/admin-account-sharing-alerts.js tests/rp2b3-revoke.test.mjs
git commit -m "$(cat <<'EOF'
feat(v2-rp2b3): polish admin revoke (reason required, idempotent, safe contract)

reset_session now requires a non-empty reason (max 500), returns
student_not_found (404) when the student does not exist, already_revoked
(200) when nothing active was revoked, and revoke_failed (500) on error.
Audit logs the real reason. No email/IP/device/session id/DB error leaks
in responses. Non-fatal student lookup so a DB hiccup never blocks a
revoke. node:test cases pass.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Merge back into the integration branch**

```bash
git checkout v2/rebuild-20260715
git merge feat/v2-rp2b3-revoke-polish --no-ff -m "merge(v2): RP2-B3 admin revoke polish"
node --test tests/rp2b3-revoke.test.mjs
```
Expected: clean merge; tests pass post-merge.

---

## Task S3: Sync verification — identity migration, shadow, dry-run, live, readiness

This task is mostly **operator-driven** (owner applies migrations and flips preview flags per Q5 b-Y). The code deliverable is the reconciliation runbook + status doc update. Operator actions are gated verification steps that must be recorded before progressing.

**Files:**
- Create: `docs/v2/V2_RECONCILIATION_RUNBOOK.md`
- Modify: `docs/v2/V2_IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Consumes (existing, no changes): `/api/v2/readiness` (auth: `x-v2-worker-secret` header = `V2_WORKER_SECRET` or `INTERNAL_SYNC_SECRET`), `/api/v2/reconciliation`, `/api/v2/outbox`, `/api/v2/portal-projection-preview`, `/api/v2/sync-worker`; SQL `scripts/v2/preflight-v2.sql`, `scripts/v2/postflight-v2.sql`, `scripts/v2/rollback-v2.sql`; migrations `migration_v2_sync_outbox.sql`, `migration_v2_identity_mapping.sql`.
- Produces: a runbook with concrete thresholds; an updated status doc recording that S0/S1/S2 are merged and S3 operator steps are pending/complete.

- [ ] **Step 1: Write the reconciliation runbook**

Create `docs/v2/V2_RECONCILIATION_RUNBOOK.md`:

````markdown
# V2 Reconciliation Runbook

Read-only reconciliation for branch `v2/rebuild-20260715` on Supabase B (ref `aqozjkfwzmyfunqvcyjv`). V1 production is untouched. Run these checks on the **V2 preview** environment only.

## 1. Prerequisites

- `V2_RECONCILIATION_READONLY=true` on the preview env.
- `V2_WORKER_SECRET` (or `INTERNAL_SYNC_SECRET`) configured; pass it as the `x-v2-worker-secret` header.
- Identity migration applied (Section 3 below) and `postflight-v2.sql` clean.

## 2. Read reconciliation summary

```bash
curl -s -H "x-v2-worker-secret: $V2_WORKER_SECRET" \
  "$V2_PREVIEW_URL/api/v2/reconciliation" | jq
```

`/api/v2/readiness` also embeds a reconciliation summary in `diagnostics` + the `reconciliation_clean` gate.

## 3. Identity migration apply (owner action)

Order (after a manual Supabase B backup):

1. Open Supabase B SQL Editor for project `aqozjkfwzmyfunqvcyjv`.
2. Run `scripts/v2/preflight-v2.sql`. Save the output (snapshot).
3. Apply `migration_v2_sync_outbox.sql` in a transaction.
4. Apply `migration_v2_identity_mapping.sql` in a transaction.
5. Run `scripts/v2/postflight-v2.sql`. Every V2 table/column/index row must show `exists = true`; identity check rows must show `status = ok`.

If any postflight row is missing, run `scripts/v2/rollback-v2.sql` (non-production cleanup section, commented — uncomment only on a disposable DB) and stop. Do NOT proceed to Section 4.

## 4. Acceptance thresholds (canary-ready)

| Check | Source | Threshold |
|---|---|---|
| V2 tables visible | `postflight-v2.sql` §1 | `sync_outbox`, `sync_deliveries`, `sync_dead_letters`, `course_slug_mappings`, `portal_post_course_mappings` all `exists=true` |
| V2 columns visible | `postflight-v2.sql` §2 | all required rows `exists=true` |
| V2 indexes visible | `postflight-v2.sql` §3 | all required rows `exists=true` |
| `course_id is null` (orders/enrollments/lessons) | `postflight-v2.sql` §4 + `/api/v2/reconciliation` | tracked in report; **not required to be 0**, but every non-zero count must appear in the reconciliation report |
| Outbox shadow volume | `/api/v2/outbox` | rows increase with real sync events; no duplicate `idempotency_key` |
| Projection preview matches V1 | `/api/v2/portal-projection-preview` | sample course + enrollment payloads match the V1 `/api/sync` contract (owner compares sample-by-sample) |
| Worker dry-run plan | `/api/v2/sync-worker` with `dryRun=true` | delivery plan builds without delivering; no `sync_deliveries` rows created |
| Readiness level | `/api/v2/readiness` | `ready_for_dry_run` (shadow/dry-run) → then `ready_for_guarded_delivery` after owner approves live canary delivery |

## 5. Progression order (preview env flags)

1. `V2_OUTBOX_SHADOW_MODE=true` (all delivery flags off). Verify with `/api/v2/outbox`.
2. `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true`. Verify preview payloads.
3. Owner confirms sample payloads match V1.
4. `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`. **Keep `V2_DRIVE_WORKER_DRY_RUN=true`** (Drive job queue is out of scope for canary).
5. After each flip, re-check `/api/v2/readiness`; it must not regress to `blocked`.

## 6. Repair policy

- Reconciliation never auto-revokes. A serious mismatch moves the affected record to "needs admin review" (Data Ownership Contract §repair).
- Any repair that touches enrollment/order/Drive requires an `admin_audit_logs` entry.
- Do not auto-resolve `course_id is null` counts; surface them in the report for owner review.
````

- [ ] **Step 2: Update V2_IMPLEMENTATION_STATUS.md with S0/S1/S2 + S3 operator steps**

Append a new section under `## Completed` (or a new `## v2/rebuild-20260715 integration` section) recording: S0 base merged (both lineages, `utils/v2-flags.js` union), S1 RP2-B2 logout merged, S2 RP2-B3 revoke polish merged, with their test counts. Under `## In Progress / Next`, add the S3 operator checklist (apply migrations in §3 order, then flag progression in §5 order, gating on `/api/v2/readiness`). Keep the existing guardrails section intact.

Exact text to add under a new `## v2/rebuild-20260715 Integration` heading (place it above `## Not Applied Automatically`):

```markdown
## v2/rebuild-20260715 Integration

- S0 base: merged `v2/rebuild-20260714` (RP-1, RP2-A, RP2-B0) and `feat/v2-rp2b1-session-device-guard` (RP2-B1) into a branch cut from `v2/platform-rebuild`. Single conflict `utils/v2-flags.js` resolved as union. Inherited tests pass (RP-1 48, RP2-A 29, RP2-B1 full).
- S1 RP2-B2: server-side logout endpoint `api/lms/portal.js?endpoint=logout` (`utils/lms-handlers/logout.js`). Idempotent, fail-closed on flag-on, V1-compat on flag-off. 9 tests pass.
- S2 RP2-B3: admin `reset_session` now requires reason, returns `student_not_found` / `already_revoked` / `revoke_failed`, audits the real reason. Tests pass.

### S3 operator steps (owner-driven, gate on /api/v2/readiness)

1. Backup Supabase B, run `scripts/v2/preflight-v2.sql`.
2. Apply `migration_v2_sync_outbox.sql` then `migration_v2_identity_mapping.sql` (transactional).
3. Run `scripts/v2/postflight-v2.sql`; all V2 objects `exists=true`.
4. Preview env: `V2_OUTBOX_SHADOW_MODE=true` → verify `/api/v2/outbox`.
5. `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` → verify `/api/v2/portal-projection-preview` vs V1.
6. Owner approves → `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`, keep `V2_DRIVE_WORKER_DRY_RUN=true`.
7. `/api/v2/readiness` must reach `ready_for_guarded_delivery` for the canary scope.
```

- [ ] **Step 3: Syntax-check nothing (docs only) — verify the files are well-formed**

```bash
node -e "require('fs').readFileSync('docs/v2/V2_RECONCILIATION_RUNBOOK.md','utf8'); require('fs').readFileSync('docs/v2/V2_IMPLEMENTATION_STATUS.md','utf8'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 4: Commit the docs**

```bash
git checkout -b feat/v2-sync-verify
git add docs/v2/V2_RECONCILIATION_RUNBOOK.md docs/v2/V2_IMPLEMENTATION_STATUS.md
git commit -m "$(cat <<'EOF'
docs(v2): add reconciliation runbook and record S0-S2 integration

S0 base + RP2-B2 logout + RP2-B3 revoke polish are merged into
v2/rebuild-20260715. Adds V2_RECONCILIATION_RUNBOOK with thresholds
and the S3 operator progression (identity migration apply → shadow →
dry-run → guarded live, gated on /api/v2/readiness). V1 production
unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5 (OWNER GATE): Apply migrations and verify — record results here**

These are owner actions on Supabase B + the V2 preview env. They block S4. Record the outcome by editing `docs/v2/V2_IMPLEMENTATION_STATUS.md` (append results under the S3 section) and committing:

```bash
git add docs/v2/V2_IMPLEMENTATION_STATUS.md
git commit -m "docs(v2): record S3 migration + readiness results"
```

Owner steps (from the runbook §3 and §5):
1. Backup Supabase B; run `scripts/v2/preflight-v2.sql`; save snapshot.
2. Apply `migration_v2_sync_outbox.sql` + `migration_v2_identity_mapping.sql` transactionally.
3. Run `scripts/v2/postflight-v2.sql`; confirm all `exists=true`.
4. On Vercel preview for `v2/rebuild-20260715`: set `V2_OUTBOX_SHADOW_MODE=true`; verify `GET /api/v2/outbox` (with `x-v2-worker-secret`) shows growing, deduped rows.
5. Set `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true`; verify `POST /api/v2/portal-projection-preview` for a sample course + enrollment event matches V1 `/api/sync`.
6. Owner approves live → set `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`, keep `V2_DRIVE_WORKER_DRY_RUN=true`.
7. `GET /api/v2/readiness` must report `ready_for_guarded_delivery` (or `ready_for_dry_run` until step 6). Must never be `blocked`.

If postflight fails or readiness is `blocked`, stop and run `scripts/v2/rollback-v2.sql` (non-production cleanup) — do not proceed to S4.

- [ ] **Step 6: Merge the slice back**

```bash
git checkout v2/rebuild-20260715
git merge feat/v2-sync-verify --no-ff -m "merge(v2): sync verification runbook + status"
git push origin v2/rebuild-20260715
```
Expected: clean merge; push succeeds.

---

## Task S4: Canary readiness — rollback drill, cutover runbook, test matrix

**Files:**
- Modify: `docs/v2/V2_ROLLBACK_RUNBOOK.md`
- Create: `docs/v2/V2_CUTOVER_RUNBOOK.md`
- Modify: `docs/v2/V2_TEST_MATRIX.md`
- Modify: `docs/v2/V2_IMPLEMENTATION_STATUS.md`

**Interfaces:** Consumes the existing flag set + `scripts/v2/rollback-v2.sql` + Vercel preview deploy of `v2/rebuild-20260715`. Produces a practiced rollback path and a documented (not executed) cutover sequence.

- [ ] **Step 1: Rewrite V2_ROLLBACK_RUNBOOK.md with the 3-drill procedure**

Replace the contents of `docs/v2/V2_ROLLBACK_RUNBOOK.md` with:

````markdown
# V2 Rollback Runbook

For branch `v2/rebuild-20260715`. V1 production (`main`, tag `v1-stable-20260713`) is the rollback target. Practice these drills on the **V2 preview** deployment, never on production, before declaring canary-ready.

## Drill 1 — Rollback code

1. In Vercel, redeploy the preview alias from tag `v1-stable-20260713` (or `main`).
2. Smoke-test V1 endpoints on the preview alias:
   - `GET /` returns 200.
   - `GET /lms.html` returns 200.
   - `GET /lesson.html` returns 200.
   - `GET /api/lms/portal?endpoint=public-config` returns 200.
   - `POST /api/sync` (Shop→LMS) with a valid `INTERNAL_SYNC_SECRET` returns the V1 sync result.
3. Record: alias, redeploy time, smoke results. **Pass criterion:** all V1 endpoints 200 and V1 sync intact.

## Drill 2 — Rollback schema (non-production only)

1. On a disposable/staging Supabase B schema (or a prod-schema snapshot review — never run destructive SQL on production without owner approval + backup).
2. Review `scripts/v2/rollback-v2.sql`; the destructive section is commented by default. Uncomment only on the disposable schema after export.
3. Run it: drops only V2 tables (`sync_*`, `course_slug_mappings`, `portal_post_course_mappings`) and V2 columns on `orders`/`student_enrollments`/`lessons`. V1 columns are untouched.
4. Verify V1 still reads: `select count(*) from courses; select count(*) from orders where course_slug is not null; select count(*) from student_enrollments;` — all return normal counts.
5. Record: schema target, commands run, post-drop V1 read results. **Pass criterion:** V1 reads succeed after dropping V2 objects (proves the migration was additive).

## Drill 3 — Rollback flags

On the V2 preview env, turn flags off in reverse order and verify each step:

1. `V2_PORTAL_PROJECTION_DRY_RUN=true`
2. `V2_PORTAL_PROJECTION_ENABLED=false`
3. `V2_DELIVERY_HANDLERS_ENABLED=false`
4. `V2_OUTBOX_SHADOW_MODE=false`
5. `V2_GLOBAL_ONE_DEVICE_ENABLED=false`
6. `V2_CORS_ALLOWLIST_ENABLED=false`

After each flip, `GET /api/v2/readiness` (with `x-v2-worker-secret`) must trend toward `blocked`/`needs_review` (V2 retreating), and V1 flows (`/api/sync`, portal public-config, course-data with cookie) must remain intact.

Record: each flag value + readiness level after each step. **Pass criterion:** with all flags off, readiness is `blocked` (V2 fully withdrawn) and V1 behavior is unchanged.

## Kill-switch

If any drill fails, do not declare canary-ready. Keep V1 production on `main`. File the failure in `docs/v2/V2_IMPLEMENTATION_STATUS.md` and resolve before retrying.

## Production rollback (reference only — owner decision)

1. Set all V2 flags off on production env.
2. Redeploy production from `v1-stable-20260713` / `main`.
3. Smoke-test production (Shop, Portal, LMS) per the V2_TEST_MATRIX V1 regression list.
4. V2 schema is additive — no production schema rollback is needed for a runtime rollback.
````

- [ ] **Step 2: Write V2_CUTOVER_RUNBOOK.md (documentation only — not executed in this plan)**

Create `docs/v2/V2_CUTOVER_RUNBOOK.md`:

````markdown
# V2 Cutover Runbook (owner decision — NOT executed by the canary-ready plan)

This runbook documents the flag order for switching production traffic to V2. It is executed only by the owner after canary readiness is signed off and a canary has passed on the preview deployment. The canary-ready plan does NOT perform cutover.

## Preconditions (must all be true)

- `/api/v2/readiness` reports `ready_for_guarded_delivery` on the canary scope.
- Reconciliation report reviewed; `course_id is null` counts acknowledged.
- All three rollback drills passed and recorded in `V2_ROLLBACK_RUNBOOK.md`.
- V1 rollback path is hot (tag `v1-stable-20260713` deployable; all V2 flags can be turned off).
- Auth secrets configured on production: `SESSION_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`, `INTERNAL_SYNC_SECRET`, `V2_WORKER_SECRET`, `ADMIN_EMAILS`.

## Cutover flag order (production env)

1. `V2_CORS_ALLOWLIST_ENABLED=true` (with `LMS_ADMIN_ORIGINS` + `LMS_PORTAL_ORIGINS` set).
2. `V2_GLOBAL_ONE_DEVICE_ENABLED=true` (one-device LMS guard; requires Portal V2 to also enforce login-block for full policy — see dependency note).
3. `V2_OUTBOX_SHADOW_MODE=true` (observe; V1 `/api/sync` still authoritative).
4. `V2_RECONCILIATION_READONLY=true`.
5. `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` (preview live).
6. Owner confirms projection payloads match V1 on production samples.
7. `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false` (live portal projection). Keep `V2_DRIVE_WORKER_DRY_RUN=true` until the Drive job queue phase.
8. Observe `/api/v2/readiness`, `/api/v2/outbox`, and V1 `/api/sync` for the observation window.

## Rollback during cutover

At any step, reverse the flags in the opposite order (see `V2_ROLLBACK_RUNBOOK.md` Drill 3) and redeploy `v1-stable-20260713` if needed. Additive schema means no destructive rollback is required for a runtime rollback.

## Out of scope for this runbook

- Removing V1 endpoints (belongs to a later cutover-completion phase).
- Drive permission job queue (separate phase after outbox delivery is proven).
- Risk V2 incremental summaries.
- Admin UI diagnostics page.
- Portal repo (`student-web`) one-device login-block enforcement — must be enabled on the Portal side in lockstep with step 2 for the full one-device policy.
````

- [ ] **Step 3: Add canary scenarios to V2_TEST_MATRIX.md**

Append to `docs/v2/V2_TEST_MATRIX.md` a new section at the end:

````markdown

## V2 canary scenarios (v2/rebuild-20260715)

### Session guard (RP2-B1 + B2 + B3)
- Flag on: course-data/lesson require `X-LMS-Session-Id` + `X-LMS-Device-Id`; missing/invalid → 401 `invalid_session`.
- Flag on: `exchange-code` returns 410 `legacy_login_disabled`.
- Logout (`endpoint=logout`): valid session → 200 `serverRevoked:true`; repeat call → 200 (idempotent); flag-on revoke failure → 503 `one_device_policy_unavailable`; flag-off no session → 200 `serverRevoked:false` (cookie cleared).
- Admin `reset_session`: no reason → 400 `reason_required`; reason >500 → 400 `reason_too_long`; missing student → 404 `student_not_found`; nothing active → 200 `alreadyRevoked:true`; revoke error → 500 `revoke_failed`; audit contains the real reason; no email/IP/device/session id in any response.

### Sync (outbox / projection / readiness)
- Shadow mode on: V1 `/api/sync` unchanged; `sync_outbox` grows; no duplicate `idempotency_key`.
- Worker dry-run: `POST /api/v2/sync-worker {dryRun:true}` builds a plan, creates no `sync_deliveries`.
- Projection preview: `POST /api/v2/portal-projection-preview` payload matches V1 `/api/sync` for sample course + enrollment events.
- Guarded live (canary scope only): `sync_deliveries` rows created; retries back off; `sync_dead_letters` alertable; `V2_DRIVE_WORKER_DRY_RUN` stays true.
- `/api/v2/readiness` reaches `ready_for_guarded_delivery` for the canary scope; never `blocked` after flags on.

### Canary + rollback
- V1 regression matrix passes on both production and preview-with-flags-off.
- Rollback drill 1 (code): V1 redeploy on preview → all V1 endpoints 200.
- Rollback drill 2 (schema, non-prod): drop V2 objects → V1 reads succeed.
- Rollback drill 3 (flags): all flags off → readiness `blocked`, V1 behavior unchanged.
````

- [ ] **Step 4: Mark canary-ready in V2_IMPLEMENTATION_STATUS.md**

In `docs/v2/V2_IMPLEMENTATION_STATUS.md`, update the `## Still Not Done` section to reflect that the canary-ready milestone is complete (S0–S4 done; cutover pending owner). Add under the integration section:

```markdown
### S4 canary-ready (complete pending owner canary sign-off)

- `V2_ROLLBACK_RUNBOOK.md` updated with the 3-drill procedure (code, schema, flags).
- `V2_CUTOVER_RUNBOOK.md` added (documentation only; owner executes).
- `V2_TEST_MATRIX.md` extended with canary scenarios.
- Canary-ready state: all V2 flags off on production; V2 preview canary gated on `/api/v2/readiness`; rollback path practiced. Cutover traffic remains the owner's decision.
```

And update `## Still Not Done` so the list reads: no V2 production cutover, no V2 production flag flip, no V1 endpoint removal — all pending owner cutover approval.

- [ ] **Step 5: Commit the slice**

```bash
git checkout -b feat/v2-canary-readiness
git add docs/v2/V2_ROLLBACK_RUNBOOK.md docs/v2/V2_CUTOVER_RUNBOOK.md docs/v2/V2_TEST_MATRIX.md docs/v2/V2_IMPLEMENTATION_STATUS.md
git commit -m "$(cat <<'EOF'
docs(v2): canary readiness — rollback drill, cutover runbook, test matrix

Adds the 3-drill rollback procedure (code/schema/flags) practiced on
preview, a cutover runbook documenting the production flag-flip order
(owner decision, not executed here), canary scenarios in the test
matrix, and marks the canary-ready milestone. V1 production unchanged;
cutover remains the owner's decision.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6 (OWNER GATE): Run the rollback drills on preview and record results**

Owner runs Drills 1–3 from `V2_ROLLBACK_RUNBOOK.md` on the V2 preview deployment. Record results by editing `docs/v2/V2_IMPLEMENTATION_STATUS.md` (append a `### S4 drill results` subsection with pass/fail per drill) and commit:

```bash
git add docs/v2/V2_IMPLEMENTATION_STATUS.md
git commit -m "docs(v2): record S4 rollback drill results"
```

If any drill fails → kill-switch: do not declare canary-ready; resolve and re-run.

- [ ] **Step 7: Merge back and push**

```bash
git checkout v2/rebuild-20260715
git merge feat/v2-canary-readiness --no-ff -m "merge(v2): canary readiness docs + drill results"
git push origin v2/rebuild-20260715
```
Expected: clean merge; push succeeds. The integration branch is now canary-ready.

- [ ] **Step 8: Final verification — full test sweep on the integration branch**

```bash
git checkout v2/rebuild-20260715
node --test tests/rp1-auth-hardening.test.mjs tests/rp2-cors.test.mjs tests/rp2b1-session-device.test.mjs tests/rp2b2-logout.test.mjs tests/rp2b3-revoke.test.mjs
```
Expected: all suites pass, 0 failures. This is the final gate before declaring the canary-ready milestone complete.

---

## Self-Review (run after writing, fix inline — recorded here for the implementer)

**Spec coverage:**
- Spec §3 (architecture + merge-first + kill-switch) → Task S0. ✓
- Spec §4 (RP2-B2 logout, behavior matrix, test) → Task S1. ✓
- Spec §5 (RP2-B3 reason/idempotency/contract/audit, test) → Task S2. ✓ (Note: `student_not_found` implemented via a non-fatal normalized-email lookup; the spec listed it and this honors it without a risky casing change. Documented in the task.)
- Spec §6 (identity apply → shadow → dry-run → live → readiness, thresholds, out-of-scope Drive/Risk/Admin-UI) → Task S3. ✓
- Spec §7 (canary setup, 3-drill rollback, cutover runbook, test matrix) → Task S4. ✓
- Spec §8 (slice order + task map) → S0→S1→S2→S3→S4 with the documented dependencies. ✓
- Spec §9 invariants → Global Constraints header. ✓
- Spec §10 owner-during-execution decisions → S3 Step 5 + S3 Step 5 sub-step 6 + S4 Step 6 owner gates. ✓
- Spec §11 out-of-scope → S3/S4 runbooks explicitly defer Drive/Risk/Admin-UI/Portal-repo/V1-removal. ✓

**Placeholder scan:** No TBD/TODO/"implement later"/"add error handling" without code. Every code step shows the full code. Doc steps show the full doc content. ✓

**Type/name consistency:** `validateRevokeReason` (S2 helper + test) — same name both places. `lookupStudentExists` — same. `__RP2B2_LOGOUT_VERIFY_STUB__` / `__RP2B2_LOGOUT_FN_STUB__` (S1 handler + test) — same. `__RP2B3_RESET_DEPS__` with keys `resetStudentSessionByEmail`/`lookupStudentExists`/`writeAdminAuditLog`/`upsertReview` (S2 handler + test) — same. `serverRevoked`/`alreadyRevoked`/`affectedSessions` field names — same in handler and assertions. `markStudentSessionLoggedOut`/`verifyLmsVerifiedSessionAccess`/`mapLmsAccessReasonToError`/`httpStatusForLmsAccessError` signatures match the source verified at `utils/lms-session-guard.js:486/771/986/1000`. ✓

**Scope check:** Five sequential slices on one integration branch with hard dependencies (S0 base before any slice; S3/S4 owner-gated). Each slice produces testable output (S0: inherited tests green; S1/S2: new test suites; S3: runbook + readiness level; S4: drills + docs). Appropriate as one plan. ✓
