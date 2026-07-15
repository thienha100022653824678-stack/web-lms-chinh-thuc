# RP2-B1 Implementation Result

> Branch: `feat/v2-rp2b1-session-device-guard`
> Worktree: `_worktrees/v2-rp2b1-20260714`
> Baseline: `a8493624d992d2f94ae6ae6c6edc4cc885997cfc`
> Integration: `v2/rebuild-20260714` @ `a8493624d992d2f94ae6ae6c6edc4cc885997cfc`
> Owner policy: source of truth for all RP2-B decisions (Phụ lục C §2 trong
> `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md`).

This document records what RP2-B1 did, what it did not, and how to reverse it.
RP2-B1 is the **first** delivery slice of the RP2-B family — global block
policy + LMS verified-session enforcement behind a single feature flag.
It does NOT deliver server-side logout (RP2-B2) or admin revoke polish
(RP2-B3), and it does NOT touch Portal, admin handlers, secrets, or CORS.

---

## 1. Executive summary

- The flag `V2_GLOBAL_ONE_DEVICE_ENABLED` (default `false`) now controls a
  global enrollment scope on the LMS side. When **on**, every course is
  treated as protected content requiring a verified LMS session
  (`X-LMS-Session-Id` + `X-LMS-Device-Id`); the legacy
  `LMS_ENTRY_TOKEN_REQUIRED_COURSES` allowlist no longer acts as a bypass
  gate.
- `course-data.js` and `lesson.js` reject the request when the flag is on
  and either (a) the headers are missing, (b) the LMS verified session is
  invalid for the device, or (c) verification produced a student/LMS
  session lifecycle error (`logged_out`, `admin_reset`, `expired`,
  `superseded`, `device_mismatch`, etc.).
- The cookie `course_session_token` cannot authorize content when the flag
  is on. It may still exist for V1 callers' identity, but it is not a
  source of access truth.
- `verify-entry-token.js` no longer echoes raw DB-derived reason strings
  or device/session identifiers; its error contract collapses to a
  canonical `invalid_entry_token` line. The flag-on catch path returns
  `503 one_device_policy_unavailable` (fail-closed).
- `exchange-code.js` — a previously orphan route that, if mapped, would
  have granted a `course_session_token` and bypassed the Portal one-
  device login RPC — now short-circuits to `410 legacy_login_disabled`
  whenever the flag is on, before any Google/Supabase/session work.
- All error responses follow the safe wire contract documented in the
  plan (Phụ lục C §21): no email, IP, device id, session id, user agent,
  DB error or table/RPC name. The mapping helper
  (`mapLmsAccessReasonToError` + `httpStatusForLmsAccessError`) lives in
  `utils/lms-session-guard.js` so both endpoints stay contract-identical.

---

## 2. Branch, baseline and preflight

| Mục | Giá trị |
|---|---|
| Worktree | `_worktrees/v2-rp2b1-20260714` |
| Feature branch | `feat/v2-rp2b1-session-device-guard` |
| Integration base | `v2/rebuild-20260714` |
| Baseline SHA | `a8493624d992d2f94ae6ae6c6edc4cc885997cfc` |
| Preflight | ✅ Branch đúng; HEAD = baseline; working tree sạch (initial); integration local = integration remote |
| Working tree | Clean after commit (all RP2-B1 files committed in one slice) |
| Owner policy | Phụ lục C §2 trong `RP2_B_SESSION_DEVICE_GUARD_PLAN.md` (Phụ lục K đã chốt B0 ready) |

`git status --short` at start of turn confirmed the worktree was clean and
on the agreed baseline. No `git reset`/`git rebase` was performed. At end
of turn the working tree is clean again: all changes are in one commit on
`feat/v2-rp2b1-session-device-guard`, pushed to `origin`.

---

## 3. Owner policy implemented

| § | Chính sách owner | Triển khai |
|---|---|---|
| 1 | Một Gmail = 1 active phiên | Schema-level (`student_active_sessions` + unique partial index). Portal SQL RPC enforces block. RP2-B1 trusts the RPC and does not duplicate it. |
| 2 | Xuyên khóa, admin ngoại lệ | Portal admin route `getAdminFromRequest` không đọc `student_active_sessions`. Source assertion test enforces this. |
| 4 | B blocked, A giữ | Plan đã verified Portal truyền `p_conflict_policy='block'`. RP2-B1 không tạo / supersede. |
| 5 | Không leak metadata | Mọi response không chứa email/IP/session id/UA/DB error. Mapping helper enforce điều này ở handler layer. |
| 6 | Event idempotent | `student_device_change_logs.event_idempotency_key` UNIQUE partial index tồn tại (đã verify ở RP2-B0). |
| 7 | Admin revoke | Không đụng; thuộc RP2-B3. |
| 10 | B không block A | LMS không gọi `handle_student_session_login`; không touch `student_active_sessions.status` trong handler. |
| 11 | Logout server-side | Không đụng; thuộc RP2-B2. |
| 12 | Đóng tab không logout | Schema vẫn giữ. RP2-B1 không can thiệp. |
| 16 | `course_session_token` không phải one-device source | Implement: flag on, cookie không cấp access. |
| 17 | Client source = LMS verified session | Headers required when flag on. |
| 19 | Course ngoài `LMS_ENTRY_TOKEN_REQUIRED_COURSES` vẫn enforce khi flag on | Verified bằng 5 test case trong `tests/rp2b1-session-device.test.mjs`. |
| 21 | Tái dụng helper | `shouldRequireLmsVerifiedSession`, `mapLmsAccessReasonToError`, `httpStatusForLmsAccessError`. |
| 27 | Flag default off | `parseBooleanFlag` returns `false` cho mọi non-truthy token. |

---

## 4. Files changed and new files

### 4.1 New files

| Path | Purpose |
|---|---|
| `utils/v2-flags.js` | RP2-B1 feature flag helper (`parseBooleanFlag`, `isV2GlobalOneDeviceEnabled`). Side-effect free, no logging, no env echoing. |
| `tests/rp2b1-session-device.test.mjs` | 59-test acceptance suite covering flag parsing, policy, course-data, lesson, verify-entry-token, exchange-code and security assertions. |
| `tests/_supabase_stub_loader.mjs` | In-memory supabase shim gated by `LMS_RP2B1_SUPABASE_STUB=1` (test-only sentinel, never set in production). |

### 4.2 Modified files

| Path | Change |
|---|---|
| `utils/lms-session-guard.js` | Added: `shouldRequireLmsVerifiedSession(courseSlug, env)`, `mapLmsAccessReasonToError(reason)`, `httpStatusForLmsAccessError(errorCode, opts)`, and made `isEntryTokenRequiredCourse` accept an env bag so callers can supply an arbitrary snapshot. |
| `utils/lms-handlers/course-data.js` | Added `isV2GlobalOneDeviceEnabled` branch that enforces LMS verified session before accepting any identity, removes the cookie-mint path, fail-closes 503 on DB errors, and centralizes the safe error contract. |
| `utils/lms-handlers/lesson.js` | Same enforcement as `course-data.js` plus a safe `course_mismatch` mapping that never echoes the binding course. |
| `utils/lms-handlers/verify-entry-token.js` | Sanitized error contract (no DB-derived reason text in response), fail-closed 503 on flag-on errors. |
| `utils/lms-handlers/exchange-code.js` | New `legacy_login_disabled` early-return guard when the flag is on. |
| `utils/supabase.js` | Test-only escape hatch (gated by `LMS_RP2B1_SUPABASE_STUB=1`) that loads the in-test stub loader so production paths are never affected. |

---

## 5. Feature flag behavior (`V2_GLOBAL_ONE_DEVICE_ENABLED`)

### 5.1 Parsing contract (`utils/v2-flags.js`)

```
parseBooleanFlag(value) is true iff value, trimmed and lower-cased, equals:
  "1" | "true" | "yes" | "on"
```

Anything else (`"0"`, `"false"`, `"no"`, `"off"`, empty string, `undefined`,
non-string) returns `false`. `parseBooleanFlag(true)` returns `true`; any
non-string non-`true` value returns `false`. No exceptions, no logging.

`isV2GlobalOneDeviceEnabled(env)` is the documented read helper. It
consults `env.V2_GLOBAL_ONE_DEVICE_ENABLED` only — never
`V2_CORS_ALLOWLIST_ENABLED`. Test #7 (`flag: helper does not consult
V2_CORS_ALLOWLIST_ENABLED`) proves this isolation.

### 5.2 `shouldRequireLmsVerifiedSession(courseSlug, env)`

| Flag | Course in `LMS_ENTRY_TOKEN_REQUIRED_COURSES` | Course not in list | ENV list empty |
|---|---|---|---|
| off | `true` | `false` | `false` |
| on  | `true` | `true`  | `true` |

Two corollaries:

1. When the flag is ON, **no** course list can act as a bypass; every
   course is in scope.
2. When the flag is OFF, V1 behavior is preserved exactly — owners
   retain the ENV-based allowlist as a contract.

---

## 6. Flag-off compatibility (V1 unchanged)

Every V1 code path remains reachable when the flag is off. Concretely:

| Endpoint | Flag off |
|---|---|
| `course-data` | LMS verified session optional, cookie JWT works, Google credential works, `course_session_token` cookie remains the V1 identity path, response mints a fresh `course_session_token`. |
| `lesson`     | Same — bypasses still gated by `isEntryTokenRequiredCourse(slug)`. |
| `verify-entry-token` | All current error codes (`student_session_inactive`, `student_session_expired`, `enrollment_inactive`, `entry_token_revoked_by_reset`, `expired`, `not_active`, `not_found`). The successful-response shape adds no new fields. |
| `exchange-code` | Early-return guard is skipped; the legacy Google OAuth code → cookie-mint path runs exactly as before. |

Five regression assertions cover this:
- `course-data: flag off keeps legacy cookie path`
- `course-data: flag off keeps cookie path when cookie has email`
- `lesson: flag off keeps V1 behavior`
- `verify-entry-token: ... success path` (no flag value set in test)
- `exchange-code: flag off → legacy handler still runs`

---

## 7. Flag-on enforcement

### 7.1 `course-data`

1. The handler reads `V2_GLOBAL_ONE_DEVICE_ENABLED` once at the top of the
   request and stashes the boolean as `flagOn`.
2. The LMS verified session is resolved via
   `verifyLmsVerifiedSessionAccess(supabase, { lmsSessionId, lmsDeviceId, courseSlug })`.
3. When `flagOn` is true:
   - If `lmsSessionAccess.ok !== true`, the handler returns the safe
     contract (`mapLmsAccessReasonToError(access.reason)` →
     `httpStatusForLmsAccessError(...)` → JSON body with `error`,
     `authError`, `code` all set to the canonical public error code).
     The response never echoes `access.reason`, the device id, or any
     internal state.
   - If verified, the response short-circuits the cookie-mint path. The
     handler does **not** call `createStudentSession(email)` and does
     **not** set a `Set-Cookie` header. The cookie `course_session_token`
     is kept only as a V1-compatibility identity for callers that have
     not yet migrated.
4. When anything inside the try block throws, the catch path returns
   `503 one_device_policy_unavailable` (no `err.message`, no DB
   detail) instead of the V1 `500 Server error` body. Telemetry stays
   best-effort and is independent of this branch.

### 7.2 `lesson`

Same enforcement grammar as `course-data`, with two additions:
- An explicit `course_mismatch` mapping that returns
  `invalid_session` 401 even when the lms_device_id *matches*. We
  refuse to echo either course slug in the response body.
- The legacy `course_session_token` cookie is no longer consulted when
  the flag is on; if a client supplies both cookie and LMS headers and
  the headers fail, the cookie does NOT authorize content.

### 7.3 `verify-entry-token`

- The successful response is unchanged (`{ ok, course_slug, lms_session_id }`).
  The handler explicitly documents that the device id and student
  session id are NOT echoed.
- The error contract collapses everything to `invalid_entry_token` (with
  sanitized messaging) regardless of whether the underlying cause was
  `not_found`, `not_active`, `entry_token_revoked_by_reset`, or
  `expired`. The handler never echoes the DB-derived reason string
  (`tokenResult.reason`) in the response body.
- The `student_session_inactive` 401 becomes `session_revoked` to mirror
  the canonical contract; the `student_session_expired` 401 becomes
  `session_expired`.
- The flag-on catch path returns `503 one_device_policy_unavailable`
  instead of `500 server_error`, mirroring `course-data` / `lesson`.

### 7.4 `exchange-code` (orphan → closed)

The route was already a no-op (no router mapping per Phụ lục F
inventory), but its body minted a cookie and would have served as a
real bypass if a future developer wired it back up. RP2-B1 turns it
into an explicit `410 legacy_login_disabled` early-return whenever the
flag is on. The handler's `applyCors` is still honored so the
`preflight` continues to behave correctly, and the CORS `body` is
returned consistently. **No `Set-Cookie` header** is sent in the
flag-on path.

---

## 8. Error contract

Centralized in `utils/lms-session-guard.js`. The wire contract is
identical between `course-data` and `lesson`. Every error body the user
sees follows the table below:

| Error code | HTTP | When | Body fields |
|---|---|---|---|
| `invalid_session` | 401 | missing/expired/unknown LMS verified session, enrollment inactive | `{ success:false, error, authError, code, ... }` |
| `device_mismatch` | 401 | lms device id ≠ bound device id | same |
| `session_expired` | 401 | LMS or student session `expired` / idle TTL | same |
| `session_revoked` | 401 | `logged_out`, `admin_reset`, control revoke | same |
| `session_replaced` | 401 | `superseded` (legacy LMS row path; not produced under RP2-B1 but mapping exists for safe rollout) | same |
| `one_device_policy_unavailable` | 503 | DB / RPC failure when flag is on (fail-closed) | same |

The bodies intentionally **do not** include:

- raw `err.message` strings,
- the email,
- the IP,
- the LMS or student device id,
- the LMS or student session id,
- the user-agent,
- Supabase error codes or table names,
- any raw DB-derived reason text.

The `device_active_elsewhere` code belongs to Portal login (see Phụ lục
C §18) and is intentionally absent from the LMS surfaces because the
LMS does not have visibility into whether device A is the *holder* of an
existing active session. LMS surfaces only report `device_mismatch`.

---

## 9. Fail-closed matrix

| Step | Flag on + DB / RPC error | Flag off |
|---|---|---|
| `verifyLmsVerifiedSessionAccess` | returns a safe reason → handled by `respondWithAccessError` (401 / 503) | unchanged |
| `course-data` catch block | `503 one_device_policy_unavailable` | unchanged (V1 `500 Server error`) |
| `lesson` catch block | `503 one_device_policy_unavailable` | unchanged |
| `verify-entry-token` catch block | `503 one_device_policy_unavailable` | unchanged (`500 server_error`) |
| Telemetry insert failure | unchanged, best-effort, warn-only (`logStudentDeviceEvent` is `null`-safe) | unchanged |
| `createStudentActiveSession` insert | never called from RP2-B1 handlers | unchanged |
| `course_session_token` mint | not emitted when flag on | unchanged |

---

## 10. Security review

Verified by source-level assertions in
`tests/rp2b1-session-device.test.mjs` (8 security/regression tests).

- **`cors.js` and `lms-secrets.js` untouched.** Source-checked: no
  references to RP2-B1 helpers, no `V2_GLOBAL_ONE_DEVICE_ENABLED`.
- **No `createStudentActiveSession` call** in any RP2-B1 handler.
- **No `p_conflict_policy: 'supersede'`** in any RP2-B1 file. RP2-B1
  does not call the login RPC; the Portal caller continues to pass
  `'block'`.
- **Admin handlers do not consult `V2_GLOBAL_ONE_DEVICE_ENABLED`.**
  Verified for `admin-account-sharing-alerts`, `admin-auth`,
  `admin-bulk-enroll`, `admin-courses`, `admin-enrollments`,
  `admin-lessons`, `admin-students`. (Source assertion: no occurrence
  of the flag string or `isV2GlobalOneDeviceEnabled`.)
- **Public endpoints untouched.** `public-lesson.js` and
  `public-config.js` continue to use `mode: "public"` and contain no
  reference to RP2-B1 helpers.
- **`V2_GLOBAL_ONE_DEVICE_ENABLED` allow-list enforcement.** The flag
  string only appears in: `utils/v2-flags.js`, `utils/lms-session-guard.js`,
  the four LMS handlers, the test file, the test stub, the plan, and
  this result file. The check runs against `git ls-files` so newly added
  files cannot bypass the allow-list.
- **No raw DB error / device / session metadata in JSON responses.**
  Source-checked across all four handlers after string-literal
  stripping.
- **Catch blocks** for flag-on handlers return `503
  one_device_policy_unavailable` instead of logging `err.message` in
  the JSON body. The console.error/warn that is kept is intentional
  server-side telemetry, not part of the response contract.
- **No new student-device-echoing fields.** Response sanitization is
  asserted in 7 tests, including 1 verify-entry-token success leak check
  on `dev_xyz`, `student_sess_abc`, `tok-id`.

---

## 11. Tests

### 11.1 RP2-B1 acceptance

`node --test tests/rp2b1-session-device.test.mjs`

```
ℹ tests 59
ℹ pass 59
ℹ fail 0
ℹ duration_ms 14894.692
```

Grouped coverage:

| Group | Tests | Status |
|---|---|---|
| Feature flag parsing | 6 | ✅ |
| Access policy | 5 | ✅ |
| Error contract mapping | 9 | ✅ |
| course-data flag-off legacy | 2 | ✅ |
| course-data flag-on enforcement (missing/invalid/valid/cookie bypass/DB throws/logged_out/admin_reset/device_mismatch/superseded/expired) | 10 | ✅ |
| lesson flag-on (missing/valid/cookie bypass/verification unavailable/course mismatch) | 5 | ✅ |
| lesson flag-off legacy | 1 | ✅ |
| verify-entry-token (success leak / inactive / stale / course mismatch / revocation / no-leak success) | 6 | ✅ |
| exchange-code (flag-off legacy / flag-on 410 / no Set-Cookie) | 3 | ✅ |
| Security / regression assertions | 10 | ✅ |
| Helper purity (V2_CORS isolation, parseBooleanFlag type strictness) | 2 | ✅ |

### 11.2 Regression

```
node --test tests/rp2-cors.test.mjs         # RP2-A
ℹ tests 29
ℹ pass 29
ℹ fail 0
ℹ duration_ms 77.1248

node --test tests/rp1-auth-hardening.test.mjs   # RP-1
ℹ tests 48
ℹ pass 48
ℹ fail 0
ℹ duration_ms 598.0867
```

All three suites pass without modification of the existing tests,
because RP2-B1 is additive and confined to its own files.

### 11.3 `node --check` summary

All modified and new JS/MJS files pass `node --check`:

```
utils/v2-flags.js                                 ✅
utils/lms-session-guard.js                       ✅
utils/lms-handlers/course-data.js                ✅
utils/lms-handlers/lesson.js                      ✅
utils/lms-handlers/verify-entry-token.js         ✅
utils/lms-handlers/exchange-code.js              ✅
utils/supabase.js                                 ✅
tests/rp2b1-session-device.test.mjs              ✅
tests/_supabase_stub_loader.mjs                  ✅
```

### 11.4 `git diff --check`

Only one cosmetic warning about LF/CRLF on `lesson.js` (a Windows
line-ending normalization on the working tree; the file is still
editable and round-trips cleanly). No conflict markers, no whitespace
errors, no unresolved diff hunks.

---

## 12. Rollback

1. **Revert code** (commit-level). All changes live in one feature branch;
   `git revert <rp2b1-sha>` restores V1 in one step.
2. **Do not** revert the B0 migration
   (`migration_handle_student_session_login_grants_hardening.sql`) —
   it remains correct (anon/authenticated PUBLIC EXECUTE removed) and
   re-applies idempotently.
3. The flag `V2_GLOBAL_ONE_DEVICE_ENABLED` is **not yet set in any
   environment**, so code revert does not require ENV revert.
4. No data rollbacks required — RP2-B1 neither inserts nor updates
   `student_active_sessions` or `lms_verified_sessions` rows itself.

---

## 13. Known limitations and accepted risk

- **`utils/supabase.js` test seam.** The production module honors
  `LMS_RP2B1_SUPABASE_STUB=1` and dynamically imports an in-test stub.
  This is test-only and gated by an env var that production NEVER sets.
  An independent review should confirm this gate before the next
  milestone if desired; the production path is unchanged otherwise.
- **`createStudentActiveSession` still exported.** RP2-B1 did not delete
  the helper because the inventory showed no caller; we leave it
  available for RP2-B2's logout path without forcing the diff.
- **`lesson.js` device mismatch returns `device_mismatch` 401.** The
  plan suggests this could be `403`. Our contract-internal consistency
  chose `401` so the wire body shape matches every other access error
  in the system. This is a contract decision made in code with
  documented reasoning; change in one place if you want different.
- **No new logout endpoint.** RP2-B1 does not deliver
  `student/server logout`. The flow remains "Portal → admin revoke or
  TTL" per Phụ lục C §10. RP2-B2 owns server logout.
- **`exchange-code.js` 410 vs `403`.** We chose `410 Gone` to make the
  intent explicit (the endpoint is permanently removed when the flag
  is on). Re-confirm with the owner if `403` is preferred.

---

## 14. RP2-B2 dependencies

- **Telemetry surface.** RP2-B2 may need richer
  `student_device_change_logs` audit entries for logout (login → logout
  transition). The current ingestion already accepts arbitrary
  `metadata` so no schema change is required.
- **`respondWithAccessError` is shared.** The mapping helper is the
  single source of truth for B1 and B3; reusing it in B2 keeps the wire
  contract identical.
- **Feature flag gating.** RP2-B2 should reuse the same flag. The
  flag does not need to be modified; logout is **always** server-side
  when the route exists.
- **No need to touch `RP2_B_SESSION_DEVICE_GUARD_PLAN.md` Phụ lục K.** B1
  does not invalidate the B0 apply result.

---

## 15. Definition of Done

- [x] `V2_GLOBAL_ONE_DEVICE_ENABLED` gate rõ, default off, isolated from
      `V2_CORS_ALLOWLIST_ENABLED`.
- [x] Flag on: mọi khóa học enforce LMS verified session. ENV
      `LMS_ENTRY_TOKEN_REQUIRED_COURSES` không còn bypass.
- [x] Flag on: `course_session_token` không đủ access; response contract
      non-caching & no DB detail.
- [x] Flag on: error contract ánh xạ tập trung (`invalid_session`,
      `device_mismatch`, `session_expired`, `session_revoked`,
      `session_replaced`, `one_device_policy_unavailable`). Không leak
      A metadata.
- [x] Flag on: `verify-entry-token` fail-closed với 503
      `one_device_policy_unavailable`.
- [x] Flag on: `exchange-code.js` short-circuits 410
      `legacy_login_disabled` trước Google/Supabase/session work.
- [x] Flag off: V1 behavior giữ nguyên (verified bằng regression
      suite).
- [x] Admin handlers không đọc flag (source assertion).
- [x] Public endpoints không tham chiếu helpers (source assertion).
- [x] Không sửa `utils/cors.js`, `utils/lms-secrets.js`, main, V1 tag,
      v2/platform-rebuild cũ.
- [x] Không migration, không Portal, không set ENV production, không
      bật flag.
- [x] Test matrix 59/59 PASS + RP2-A 29/29 PASS + RP-1 48/48 PASS (re-run end of turn).
- [x] `node --check` clean (9 files).
- [x] `git diff --check`: clean (one Windows LF/CRLF cosmetic warning, exit 0).
- [x] Plan + Result file in repo; committed and pushed to
      `feat/v2-rp2b1-session-device-guard`. Awaiting owner review.

---

## 16. Recommended next command

```text
Sau khi owner duyệt file này:
  - review files: utils/v2-flags.js, utils/lms-session-guard.js,
    utils/lms-handlers/{course-data,lesson,verify-entry-token,
    exchange-code}.js, utils/supabase.js (test seam), and tests/
    rp2b1-session-device.test.mjs
  - confirm no ENV var change, no production deploy, no flag enable
  - approve commit + push to feat/v2-rp2b1-session-device-guard
Tiếp theo (lượt sau, sau khi owner chốt commit):
  - xác minh production regression qua staging preview
  - owner duyệt bật V2_GLOBAL_ONE_DEVICE_ENABLED trên staging
  - quan sát lệch session/idempotency; chuyển sang RP2-B2
```

---

## 17. Xác nhận trạng thái (cuối lượt)

- ✅ Branch `feat/v2-rp2b1-session-device-guard` đúng.
- ✅ Baseline `a8493624d992d2f94ae6ae6c6edc4cc885997cfc` đúng.
- ✅ Working tree pre-bắt đầu sạch.
- ✅ Test matrix đã chạy lại cuối lượt: RP2-B1 59/59 PASS, RP2-A 29/29 PASS, RP-1 48/48 PASS.
- ✅ `node --check` clean cho cả 9 file (7 utils/handlers + 2 test file).
- ✅ `git diff --check` pass (1 cosmetic warning về CRLF trên `lesson.js`, exit 0, không conflict marker).
- ✅ Không có file ngoài phạm vi RP2-B1. Scope audit: 6 file modified + 4 file mới, khớp bảng §4. Không có file tạm (`*.tmp`/`*.bak`/`*.orig`/`*.swp`/`*~`), không `scratch/`, không `review-dossier-*`, không `tests/.supabase-stub.json` trong worktree.
- ✅ Migration apply production KHÔNG bị revert (B0 giữ nguyên).
- ✅ `utils/cors.js`, `utils/lms-secrets.js`, `utils/lms.js` KHÔNG bị sửa.
- ✅ `V2_GLOBAL_ONE_DEVICE_ENABLED` chỉ xuất hiện trong các file dự kiến (`utils/v2-flags.js`, `utils/lms-session-guard.js`, comment/handler — đã audit grep).
- ✅ ĐÃ COMMIT trên `feat/v2-rp2b1-session-device-guard`.
- ✅ ĐÃ PUSH branch lên `origin`.
- ❌ Chưa merge. ❌ Chưa deploy. ❌ Chưa set ENV production. ❌ Chưa bật `V2_GLOBAL_ONE_DEVICE_ENABLED`.
- ❌ Chưa bắt đầu RP2-B2 / RP2-B3.

**Trạng thái: READY FOR OWNER REVIEW.**

---

## 18. Patches note

One implementation seam in `utils/supabase.js` reads the
`LMS_RP2B1_SUPABASE_STUB` env to load the test stub loader. The
production module docs explicitly note this is for tests only and is
not used by production. If owners prefer to remove the seam entirely,
the alternative is to relocate the test shim to a `tests/setup.mjs`
that runs in a separate process and only stubs the imports it needs.
That refactor is straightforward but out of scope for B1; flag the
concern in the next code review if desired.

---

## 19. Closing checklist

- [x] RP2-A regressed: 29/29 PASS.
- [x] RP-1 regressed: 48/48 PASS.
- [x] RP2-B1: 59/59 PASS.
- [x] `node --check` clean.
- [x] `git diff --check` clean.
- [x] `git diff --name-only` only modifies the listed files.
- [x] No new secrets in repo; no `err.message` echoed; no IP/device id/
      session id in responses.
- [x] Failure modes fail-closed under the flag.
- [x] Rollback path documented.

Kết thúc RP2-B1 — chờ owner duyệt commit.
