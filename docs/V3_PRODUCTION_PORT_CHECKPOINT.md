# V3 Production Port Checkpoint

- Baseline production source: `fc12c3b21329158e13a4a027833afd2dec61e973`.
- V3 branch is additive and Preview-only until explicit approval.
- Existing V1/V2 runtime controller remains untouched; V3 is a presentation layer on top of V2.
- `lms.html` markup/auth/player logic remains untouched.
- Runtime/Drive/lesson writes originating from V3 Preview are blocked server-side.
- V3 learner reuses Production entry-token, verified LMS session, LMS device and enrollment checks.
- V3 Admin uses existing Admin auth, course data and Drive auth; Preview content writes remain blocked.

## Student Portal handoff

`student-portal-yeunauan` currently mints the existing one-time LMS entry URL through `/api/lms-entry-token` and redirects the browser to that returned URL. Its current deployment source is not available in the connected GitHub repositories, so V3 deliberately does **not** require a Portal redeploy.

The Production-safe handoff is implemented on the LMS side:

1. Portal continues opening the existing `lms.html?...entry_token=...` URL unchanged.
2. Existing V2 `verify-entry-token` consumes the one-time token and creates/stores the verified LMS session bound to the LMS device.
3. A narrowly guarded hook (only `/lms.html`, only when the initial URL contained `entry_token`) waits until the token has been removed from the URL and the verified LMS session/device are present.
4. It then reads the V3 presentation snapshot. If effective mode is V3, the already-verified browser is handed to `/v3?course=<verified-course>`.
5. If V3 is disabled, V3 kill is on, global V1/V2 kill forces V1, config/API fails, the token is invalid, or no verified session exists, the hook does nothing and V2 continues normally.

The hook does not mint tokens, bypass one-device protection, or authorize content itself.

## Preview verification

- V3 learner presentation: PASS via Admin-authenticated read-only Preview (`admin_preview=1`).
- V3 Admin presentation/background composer: PASS visually; writes intentionally blocked on Preview.
- Verified-entry handoff logic: branch build PASS and deterministic client-side branch simulation PASS.
- A real Portal-issued token cannot be routed to the feature Preview without changing the Portal target or consuming that token on Production first. Therefore the final real-token handoff remains a controlled post-approval/canary verification item.

## Remaining before Production activation

- Minimal integration of V3 controls into the existing `⚙️ Hệ Thống` Admin tab.
- Final PR audit/checkpoint.
- Explicit owner approval before merge/deploy/canonical activation.
- Controlled real Portal token test after V3 code is present on the canonical LMS, with immediate V3 kill/global kill rollback available.
