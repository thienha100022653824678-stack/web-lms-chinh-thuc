# V3 Phase 4 (②③) — Session Unify + Server Device Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In V3, replace the dual session layers (30-day JWT cookie + 24h DB session guard) with one opaque, httpOnly, Secure, SameSite session token backed by the existing `student_active_sessions`/`lms_verified_sessions` rows and refreshed on a sliding `last_seen`; and mint the device credential server-side (signed, session-bound) instead of trusting a client-declared localStorage device-id. All V3-gated; V1/V2 unchanged.

**Architecture:** New V3-only `utils/v3-session.js`. It issues an opaque random token (not a JWT) whose only authority is a lookup into the session row — so revocation is a row update, not waiting for a JWT to expire. The device credential is an HMAC over `(session_id, device_nonce)` signed with the existing `SESSION_SECRET` (no new secret, no new dependency), returned to the client and re-presented via header; the server verifies the signature rather than trusting a declared id. Everything guards on `getEffectiveMode()==='v3'`. Portal must move in lockstep — that's an owner-merged PR proposal, not a change we apply to the Portal repo.

**Tech Stack:** Node 24 (`node:test`, ESM), `crypto` (HMAC — already used in `utils/lms-secrets.js`), Phase 0 controller, Phase 2 tiered client.

## Global Constraints

- Additive-only. V3-only code gated on `getEffectiveMode()`. v1/v2 identical to today (30-day JWT path in `utils/lms.js`/`exchange-code.js` untouched).
- No new secret: device credential uses `SESSION_SECRET` via `utils/lms-secrets.js` `signSessionPayload`/`verifySessionToken`.
- Opaque token: the session token carries no claims; authority is the DB row. Revocation = set row status. No 30-day access lifetime in v3.
- Cookies: `httpOnly; Secure; SameSite=Lax; Path=/` (reuse `cookieOptions` shape); short-lived + sliding refresh on `last_seen`.
- Portal lockstep: any session/one-device change is proposed as a `student-web` PR; owner merges. No direct Portal edit. This is the one real owner blocker for the Portal side — repo (LMS) work proceeds regardless.
- No production write; no secret in commits; don't touch main, tag, Portal repo.
- Phase bar: `node --test` green + secret scan + V1 path unchanged + commit + push.
- New committed file with `V2_GLOBAL_ONE_DEVICE_ENABLED` → add to allow-list in `tests/rp2b1-session-device.test.mjs`. (Phase 4 files avoid it.)

---

### Task 1: `utils/v3-session.js` — opaque session + server device credential

**Files:**
- Create: `utils/v3-session.js`
- Test: `tests/v3-session.test.mjs`

**Interfaces:**
- Produces:
  - `issueSessionToken() -> { token, tokenHash }` — opaque random token + its sha256 hash (only the hash is stored, like `lms_entry_tokens.token_hash`).
  - `mintDeviceCredential(sessionId) -> { deviceId, credential }` — server-minted `deviceId` (random) + HMAC credential over `${sessionId}.${deviceId}` via `signSessionPayload`.
  - `verifyDeviceCredential(sessionId, deviceId, credential) -> boolean` — constant-time verify (reuses `verifySessionToken` semantics).
  - `sessionCookie(token, maxAgeMs) -> string` — `httpOnly; Secure; SameSite=Lax; Path=/` cookie string; `maxAgeMs=0` clears it.
  - `slidingExpiry(lastSeenIso, idleHours) -> { expired: boolean, refreshAt: string }`.
  - All async entrypoints that touch config guard on v3 mode via `getEffectiveMode()`.
- Consumes: `signSessionPayload`, `verifySessionToken`, `timingSafeStringEqual` (`utils/lms-secrets.js`); `generateSecureToken`, `hashToken` (`utils/lms-session-guard.js`); `getEffectiveMode` (`utils/runtime-controller.js`).

- [ ] **Step 1:** Write `tests/v3-session.test.mjs`: `issueSessionToken` returns a token whose `hashToken(token)===tokenHash` and tokens are unique; `mintDeviceCredential`+`verifyDeviceCredential` round-trip true, and a tampered credential/deviceId verifies false; `sessionCookie` contains `HttpOnly`, `Secure`, `SameSite=Lax`, and `Max-Age=0` when cleared; `slidingExpiry` reports expired past idle window and a fresh `refreshAt` otherwise; a v3-gated entrypoint refuses in v1 mode.
- [ ] **Step 2:** Run → FAIL (module absent).
- [ ] **Step 3:** Implement `utils/v3-session.js`.
- [ ] **Step 4:** Run → PASS. Full suite → pass.
- [ ] **Step 5:** Commit.

### Task 2: docs + Portal PR proposal + push

**Files:**
- Create: `docs/V3_PHASE_4_SESSION_UNIFY.md`
- Create: `docs/V3_PORTAL_PR_PROPOSAL_SESSION.md` (the lockstep change the owner applies to `student-web`)
- Modify: `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` (status line)

- [ ] **Step 1:** Write `docs/V3_PHASE_4_SESSION_UNIFY.md`: the unified model, why opaque beats JWT for revocation, the server-minted device credential flow, and the compatibility window (v3 dual-reads the old cookie during canary; V1/V2 unchanged).
- [ ] **Step 2:** Write `docs/V3_PORTAL_PR_PROPOSAL_SESSION.md`: the exact Portal (`student-web`, branch `v2/platform-rebuild`) changes required to emit/accept the opaque session + server device credential, framed as a PR for the owner to review and merge. No code is pushed to Portal.
- [ ] **Step 3:** Update transfer-doc status line. Secret scan, reset stub to `{}`, commit + push. Verify V1 tag unchanged.

---

## Self-Review

- **Spec coverage:** ② (single opaque server-side session, drop 30-day JWT as access, sliding refresh) → Task 1 `issueSessionToken`/`sessionCookie`/`slidingExpiry`. ③ (server-minted device credential) → Task 1 `mintDeviceCredential`/`verifyDeviceCredential`. Portal lockstep → Task 2 PR proposal (owner-merged). WebAuthn (③ high-value opt-in) is deferred/out-of-scope this phase — noted in the doc.
- **Placeholder scan:** none.
- **Type consistency:** helper names match `utils/lms-secrets.js` / `utils/lms-session-guard.js` exports reused verbatim.
- **No new secret / dependency:** device credential uses `SESSION_SECRET` + `crypto`.
