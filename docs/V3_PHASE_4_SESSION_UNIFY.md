# V3 Phase 4 (②③) — Session Unify + Server Device Credential

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-session` 7; full suite 209/209, deterministic). Portal lockstep is an **owner-merged PR proposal** (`docs/V3_PORTAL_PR_PROPOSAL_SESSION.md`) — the one real owner blocker on the Portal side; LMS repo work is complete without it.
>
> **Goal:** collapse V1/V2's two session layers (30-day JWT-ish cookie + 24h DB guard, client-declared device-id) into one opaque server-side session with a server-minted, signed device credential — gated on v3 mode so V1/V2 stay unchanged.

## What this phase added

| File | Role |
|---|---|
| `utils/v3-session.js` | `issueSessionToken()` — opaque random token (no claims; authority = DB row lookup → revocation is a row update, not a JWT wait); only sha256 hash stored. `mintDeviceCredential(sessionId)` / `verifyDeviceCredential(...)` — server-minted `deviceId` + HMAC credential over `${sessionId}.${deviceId}` via the existing `SESSION_SECRET` (no new secret/dep); server verifies signature, never trusts a declared id (fixes SEC-11). `sessionCookie(...)` — httpOnly+Secure+SameSite=Lax. `slidingExpiry(...)`. `beginV3Session(sessionId)` — v3-gated full bundle. |
| `tests/v3-session.test.mjs` (7) | token/hash uniqueness + opacity, credential round-trip + tamper-false, cookie flags + clear, sliding expiry fail-closed, v3-gating. |
| `tests/_supabase_stub_loader.mjs` + 5 config-mutating tests | Isolated per-file stub path (`LMS_SUPABASE_STUB_FILE`) so `node --test tests/*.test.mjs` parallel runs no longer race the single shared stub → suite is deterministic across repeats. |

## Why opaque beats JWT for this system

The V1 cookie (`utils/lms.js` `createStudentSession`) is a signed payload with `exp` ~30 days — once issued it's valid until expiry regardless of server state, so revocation means waiting out the clock. The V3 opaque token carries **no claims**: presenting it only succeeds if the matching `student_active_sessions`/`lms_verified_sessions` row is `active` and not stale. Logout/kill-switch/admin-reset = a row status update, effective on next request. This is what makes "instant rollback to V1" and one-device enforcement actually enforceable rather than advisory.

## Server-minted device credential (③)

V1 device-id is client-declared in localStorage — spoofable (SEC-11), so one-device could be bypassed by clearing storage. V3 mints the `deviceId` server-side and returns an HMAC credential the client cannot forge without `SESSION_SECRET`. The client re-presents both via headers; the server verifies the HMAC in constant time (`timingSafeStringEqual`). WebAuthn passkeys for high-value courses (③ full form) is deferred — opt-in per-course, needs HTTPS + onboarding UI; recorded as future work.

## Compatibility window

During a v3 canary the LMS dual-reads: it accepts the new opaque token AND, for a window, the legacy cookie so existing learners aren't logged out. The legacy path is untouched in v1/v2. After canary, Phase 10 cleanup removes the 30-day JWT emitter.

## Owner action pending (Portal lockstep — the one real blocker)

1. **Portal PR (`student-web`, branch `v2/platform-rebuild`)** — emit the opaque session + present the server device credential. Detailed in `docs/V3_PORTAL_PR_PROPOSAL_SESSION.md`. **Owner merges; we do not push to the Portal repo.** Until merged, v3 session works LMS-side but the Portal flow must keep using the existing handshake during the canary.
2. **No production write this phase** — `utils/v3-session.js` is pure + stub-tested; the session tables already exist. Applying any schema change (none needed this phase) would be owner-applied.

## Test bar met (Phase 4)

- `node --test tests/*.test.mjs` → 209/209, deterministic across repeated runs (parallel-stub race fixed).
- Only new V3-only file (`utils/v3-session.js`) + test-infra hardening; V1/V2 session code (`utils/lms.js`, `exchange-code.js`, `lms-session-guard.js`) untouched → V1 path unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched.
