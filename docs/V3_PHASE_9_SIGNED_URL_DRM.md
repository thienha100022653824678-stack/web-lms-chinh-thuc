# V3 Phase 9 (⑫) — Session-Bound Signed-URL CDN + DRM Opt-In

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-media` 9; full suite 250/250). Owner-only DRM provider config recorded **pending** — does not block the repo work.
>
> **Goal:** kill the V1 weakness where a signed Bunny URL is usable for 600s by anyone who leaks it. V3 binds the signature to the (revocable) session so a leaked URL dies the moment the session is revoked/expired, and adds opt-in per-course DRM for high-value content.

## What this phase added

| File | Role |
|---|---|
| `utils/v3-media.js` | `signSessionBoundMediaUrl({...})` — HMAC over `tokenKey+videoId+expires+sessionId`; short TTL (120s default, ≤600s). A URL minted for session A won't validate under session B; revoking A invalidates its URLs at once. `verifySessionBoundMediaToken({...})` — constant-time server check (expired / wrong-session / tampered). `resolveDrmPolicy(courseSlug, table)` — opt-in per-course DRM (default OFF; `widevine`/`fairplay`/`playready` + license server). `signMediaForV3Session({...})` — v3-gated. Reuses `BUNNY_STREAM_TOKEN_KEY` (no new secret). |
| `tests/v3-media.test.mjs` (9) | parse, session-binding (different session → different token), fail-closed on missing key/session/non-bunny, verify round-trip + wrong-session + expired + tampered, short TTL, DRM default-off + opt-on, v3-gating. |

## Why session-bound beats V1's 600s TTL

V1's `signBunnyEmbedUrl` (utils/lms.js) signs `sha256(tokenKey+videoId+expires)` — the session isn't in the hash, so the URL is a bearer token for 600s. V3 mixes the **server-minted `lms_session_id`** (Phase 4) into the HMAC. Now:
- A URL minted for learner A's session is invalid under anyone else's session.
- Admin `reset_student_session_guard` / logout / kill-switch revokes the session row → its signed URLs stop validating on the next verify, not 600s later.
- The TTL is short (120s) and the player re-signs frequently, so the window for a leaked URL is tiny even before revocation.

## DRM opt-in (per course)

DRM is off by default (most courses don't need it; UX + cost). A high-value course opts in via a policy table entry: `{ drmRequired: true, scheme: 'widevine', licenseServerUrl }`. The module resolves the policy and returns a descriptor the player uses to acquire a license. **The actual license-server / DRM provider wiring is owner infra** (Bunny DRM or an external provider) — recorded pending, not blocking. The repo side (policy resolver + descriptor shape + opt-in gate) is complete and testable now.

## Owner action pending (does NOT block auto-advance)

1. **DRM provider config** — provision a Widevine/FairPlay license server (or enable Bunny DRM) and populate the per-course policy table (`licenseServerUrl`, scheme). Until then, DRM stays off — content is still protected by the session-bound signed URL, just not by hardware DRM.
2. **No production write this phase** — `utils/v3-media.js` is pure + stub-tested; it reuses the existing `BUNNY_STREAM_TOKEN_KEY`. Engages only when `active_mode='v3'`.

## Test bar met (Phase 9)

- `node --test tests/*.test.mjs` → 250/250.
- New V3-only file; V1 signer (`utils/lms.js` `signBunnyEmbedUrl`) untouched → V1 path unchanged.
- No secret committed (tests use placeholder key). `main` + `v1-stable-20260713` untouched. No production write.
