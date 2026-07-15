# V3 Phase 4 — Portal PR Proposal (session unify + server device credential)

> **This is a proposal for the owner to apply to the Portal repo.** We do **not** push to `student-web`. The owner reviews, adapts to the Portal's current code, and merges on their own branch (`v2/platform-rebuild`).
>
> **Target repo:** `…/yeubep-shop/student-web`, branch `v2/platform-rebuild`.
> **Companion (LMS side, DONE):** `utils/v3-session.js` in this repo + `docs/V3_PHASE_4_SESSION_UNIFY.md`.
> **Why lockstep:** the Portal is where the learner logs in and where the device credential is first presented. A v3 canary needs both sides moving together; otherwise the old handshake must stay during the canary.

## What the Portal must change

1. **Stop minting the 30-day JWT cookie as the access credential on the v3 path.** On the v3 runtime path, after Google auth + the existing `handle_student_session_login` RPC succeeds, call a new LMS endpoint that runs `beginV3Session(studentSessionId)` and returns `{ token, deviceId, credential }` (or keep the RPC surface and have the LMS mint internally). Store only the **opaque token** in the `course_session_token` httpOnly cookie (same name; different value shape — opaque, not `payload.signature`).

2. **Present the server device credential on every protected request.** Send `X-LMS-Device-Id: <deviceId>` and `X-LMS-Device-Credential: <credential>` (header names to match the LMS verify path). The LMS verifies the HMAC server-side (`verifyDeviceCredential`) instead of trusting a localStorage-declared id. **Do not** let the client invent or rewrite `deviceId`.

3. **Sliding refresh.** On each verified request the LMS touches `last_seen_at`; the Portal does nothing extra. If the LMS responds `401 session_expired`/`session_revoked`, the Portal re-runs the login handshake (no silent local re-mint).

4. **Keep the legacy path alive during canary.** While `active_mode` is `v1`/`v2`, the Portal continues exactly as today. Gate the new behavior on a runtime-mode read (the LMS `GET /api/v2/runtime` `effective_mode`) OR an env flag the owner flips in lockstep with the LMS flip. Do not hardcode v3-only behavior unconditionally.

## Suggested Portal diff shape (pseudo, adapt to real files)

```js
// after Google auth + handle_student_session_login succeeds, on the v3 path:
const mode = await fetchLmsEffectiveMode(); // GET /api/v2/runtime
if (mode === 'v3') {
  const bundle = await beginV3SessionViaLms({ studentSessionId }); // returns {token, deviceId, credential}
  setHttpOnlyCookie(res, 'course_session_token', bundle.token, { httpOnly:true, secure:true, sameSite:'lax', maxAgeMs: 8*60*60*1000 });
  // hold deviceId+credential in memory for this tab; present on each fetch via headers
} else {
  // legacy V1/V2 cookie mint — unchanged
}
```

## Acceptance criteria for the PR

- [ ] On `effective_mode==='v3'`, the Portal sets an **opaque** `course_session_token` (no `.`-separated signed payload) and presents the server device credential headers.
- [ ] On `effective_mode!=='v3'`, behavior is byte-identical to today (legacy cookie + declared device-id).
- [ ] A revoked/expired session (`401 session_revoked`/`session_expired`) forces a re-handshake, not a local re-mint.
- [ ] No service-role key or `SESSION_SECRET` in the Portal bundle — the LMS mints and verifies; the Portal only carries the opaque token + credential it was handed.

## Owner merge checklist

- Run the Portal test suite green.
- Canary: flip LMS `active_mode='v3'` on staging, confirm a learner can log in, watch one video, and is forced to re-auth after an admin `reset_student_session_guard`.
- Rollback: flip LMS `active_mode='v1'` (or `kill_switch=true`); Portal falls back to legacy automatically.
