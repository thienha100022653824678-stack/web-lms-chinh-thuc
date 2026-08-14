# V3 Production Preview — Safety & Test Scope

Baseline: `fc12c3b21329158e13a4a027833afd2dec61e973`
Branch: `feature/lms-v3-telegram-channel-20260814`

## Architecture

V3 is a **presentation layer on top of V2**.

- Existing `utils/v2-runtime-controller.js` is intentionally unchanged.
- Existing global V1/V2 kill-switch semantics are unchanged.
- V3 has separate presentation flags (`v3_presentation_enabled`, `v3_kill_switch`).
- Effective mode is V1 if existing V2 controller/global kill says V1; otherwise V3 may overlay V2.

## Preview is read-only for Production writes

Vercel Preview uses Production environment data/credentials, so V3 Preview writes are blocked:

- `admin-v3-runtime-mode.js`: all POST runtime mutations return `preview_runtime_write_blocked` unless `VERCEL_ENV=production`.
- `admin-v3-drive-folder.js`: Drive folder/write setup returns `preview_v3_write_blocked` unless Production.
- `api/lms/admin.js`: POST `lessons` requests originating from `/v3-admin` are blocked on Preview.
- `v3-system-preview.html`: V2/V3 test mode and V3 kill switch are browser-local (`localStorage`) only.

Therefore Preview testing may validate UI, auth, read-only course data, routing and media rendering without mutating live mode, lessons or Drive.

## Auth safety

- V3 consumes existing Production `verify-entry-token` to create the same `lms_verified_session` used by V2.
- V3 sends existing `X-LMS-Session-Id` + `X-LMS-Device-Id` headers to `course-data`.
- `v3-bootstrap` uses `verifyLmsVerifiedSessionAccess` as authority.
- When `V2_GLOBAL_ONE_DEVICE_ENABLED` is on, Google/cookie identity alone cannot authorize protected content.

## Preview test order

1. Login Admin at `/admin.html`.
2. Open `/v3-system-preview.html`.
3. Select V2 / V3 locally and verify `/learning` routing.
4. Open V3 learner via an existing valid Portal entry-token / verified session.
5. Check Telegram feed, appendix, search, media viewer and long scrolling.
6. Open `/v3-admin?course=<slug>` and inspect course lock, file counter, Drive status and UI only.
7. Do **not** expect upload/publish to work on Preview; server intentionally blocks it.

## Not yet final

- Existing Production `admin.html` System tab has not yet been modified. V3 controls are currently isolated in `/v3-system-preview.html` to minimize risk during Preview.
- After learner/Admin V3 Preview passes, integrate V3 controls into the existing System tab with a minimal diff.
- No merge or Production deploy until owner approval.
