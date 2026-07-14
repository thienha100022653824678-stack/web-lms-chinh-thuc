# RP-1 — Auth Hardening Result (V2 mới)

> Báo cáo triển khai gói RP-1 — Khóa cửa auth — trên V2 mới (`feat/v2-rp1-auth-hardening`).
> Source of truth: mã nguồn V2 mới tại worktree `C:/Users/gaomi/Downloads/Telegram Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/_worktrees/v2-rebuild-20260714`.
> Baseline V1 bất biến: `f9220e8128e13e93d803e0c014c39be5819f557c`.

---

## 1. Phạm vi RP-1

RP-1 đóng các lỗ hổng có thể bị khai thác ngay qua đường auth/session của V1:

- R-01 / SEC-01: bỏ fallback `"fallback-session-secret"` ký/verify admin JWT.
- R-04 / AG-33: bắt buộc `SESSION_SECRET`, `ACCOUNT_EVENT_HASH_SECRET` / `SESSION_GUARD_HASH_SECRET`; bỏ fallback SHA-256 trong `hashOptionalValue`.
- R-08 / SEC-05: cookie `Secure` mặc định bật, cộng thêm `HttpOnly`, có gate rõ `LMS_ALLOW_INSECURE_COOKIE=1`.
- R-09 / SEC-06: `exchange-code` xác minh chữ ký id_token qua `OAuth2Client.verifyIdToken` (Google-signed).
- SEC-07 (một phần): so sánh secret internal sync bằng `crypto.timingSafeEqual` thay vì `!==`.

> **Ghi chú R-11 / SEC-08 (bodyParser):** Bản nháp RP-1 từng hạ `bodyParser` admin từ `500mb` xuống `25mb`. Trong pre-commit review, việc này bị xác định là **REGRESSION** (chi tiết mục 26) và đã **rollback về `500mb`**. Siết body/upload limit được **hoãn sang RP-3** để thiết kế theo từng route. R-11 **không** còn nằm trong phạm vi RP-1.

Phạm vi **KHÔNG** gồm: đổi schema, đổi UI, đổi luồng order/Drive/Portal, đổi CORS, đổi one-device gate, refactor ngoài auth.

## 2. Baseline và branch

| Hạng mục | Giá trị |
|---|---|
| Baseline V1 | `f9220e8128e13e93d803e0c014c39be5819f557c` (tag `v1-stable-20260713`) |
| Branch V2 mới | `feat/v2-rp1-auth-hardening` |
| Worktree | `C:/Users/gaomi/Downloads/Telegram Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/_worktrees/v2-rebuild-20260714` |
| HEAD trước khi sửa | `f9220e8128e13e93d803e0c014c39be5819f557c` (working tree sạch) |
| Commit V2 cũ | không đụng (`archive/v2-old-rebuild-20260714`, tag `archive-v2-old-rebuild-20260714`) |
| Main / origin/main | không đụng (`f9220e8`) |

Xác minh: `git status --short`, `git rev-parse HEAD`, `git merge-base HEAD f9220e8`, `git worktree list` đều khớp.

## 3. Behavior trước

- `utils/lms.js:sessionSecrets()` trộn `process.env.SESSION_SECRET`, `GOOGLE_CLIENT_ID`, **và `"fallback-session-secret"`** — luôn có ít nhất một secret hợp lệ, không bao giờ fail-closed. `verifyStudentSession` / `verifyAdminSession` chấp nhận **bất kỳ** secret khớp (`some()`).
- `utils/lms-session-guard.js:hashOptionalValue` rơi về `crypto.createHash("sha256")` thuần khi thiếu `ACCOUNT_EVENT_HASH_SECRET` / `SESSION_GUARD_HASH_SECRET` — không phải HMAC, không verify được.
- `utils/lms.js:cookieOptions` chỉ thêm `Secure` khi `NODE_ENV === "production"`. Thiếu `HttpOnly`.
- `utils/lms-handlers/exchange-code.js` tự `decodeJwt` (split + base64url) rồi kiểm `aud === clientId`. **Không verify chữ ký Google.**
- `api/lms/admin.js:24` bodyParser `500mb`.
- `api/sync.js:22-26` so sánh `syncSecret !== systemSecret` (không hằng-thời-gian) và âm thầm cho qua nếu `systemSecret` rỗng.

## 4. Behavior sau

- `utils/lms-secrets.js` (mới) cung cấp `getSessionSecret()`, `getAccountEventHashSecret()`, `getInternalSyncSecret()`, `signSessionPayload()`, `verifySessionToken()`, `timingSafeStringEqual()`, `assertAuthSecretsConfigured()`, `AuthSecretError`. Thiếu secret bắt buộc → `throw AuthSecretError`. Lỗi chỉ chứa **tên biến**, không chứa giá trị.
- `utils/lms.js` dùng `getSessionSecret()` để ký/verify. **Bỏ hoàn toàn phần tử `"fallback-session-secret"`** và `sessionSecrets()`. `verifyStudentSession` / `verifyAdminSession` dùng `verifySessionToken` (đã `timingSafeEqual`).
- `utils/lms.js:cookieOptions` luôn thêm `Secure` + `HttpOnly` + `SameSite=Lax` + `Path=/`. Cờ `LMS_ALLOW_INSECURE_COOKIE=1` chỉ tắt `Secure` khi không ở production; nếu production thì cờ bị bỏ qua + cảnh báo log.
- `utils/lms-session-guard.js:hashOptionalValue` luôn HMAC-SHA256 với secret thật. `hash_secret_missing` được gắn vào `metadata` + `hash_version = "hmac_sha256_v2_unavailable"` nếu secret lỗi cấu hình (telemetry best-effort vẫn ghi nhận nhưng vẫn fail-closed cho hash). Telemetry không chặn request.
- `utils/lms-handlers/exchange-code.js` dùng `OAuth2Client.verifyIdToken({idToken, audience: GOOGLE_CLIENT_ID})`. Thất bại → 401, message chung `Invalid or unverified id_token`. Không lộ chi tiết Google error. Không log `tokenData` đầy đủ (chỉ log `error` field / `err.message`).
- `api/lms/admin.js` bodyParser **giữ `500mb`** (đúng behavior V1). Bản nháp `25mb` đã rollback trong pre-commit review (mục 26).
- `api/sync.js` dùng `getInternalSyncSecret()` + `timingSafeStringEqual()`. Thiếu secret → 503 với payload chỉ chứa tên biến.
- `crypto.timingSafeEqual` cho mọi so sánh chữ ký session / token qua `verifySessionToken` + `timingSafeStringEqual`.

## 5. File và hàm thay đổi

| File | Hàm / vùng thay đổi |
|---|---|
| `utils/lms-secrets.js` (mới) | Toàn bộ module: `AuthSecretError`, `getSessionSecret`, `getAccountEventHashSecret`, `getInternalSyncSecret`, `signSessionPayload`, `verifySessionToken`, `timingSafeStringEqual`, `assertAuthSecretsConfigured`, `listRequiredAuthSecrets`, `isLocalBypassAllowed`. |
| `utils/lms.js` | Import + dùng `lms-secrets`. Xóa `sessionSecrets()`, `sessionSecret()` và `"fallback-session-secret"`. Sửa `verifyStudentSession`, `verifyAdminSession`. Sửa `cookieOptions` (Secure + HttpOnly + gate). |
| `utils/lms-session-guard.js` | Import + dùng `getAccountEventHashSecret`. Xóa fallback SHA-256; nâng cấp `hashOptionalValue` fail-closed; thêm telemetry flag `hash_secret_missing` ở `logStudentDeviceEvent`, `writeAdminAuditLog`. |
| `utils/lms-handlers/exchange-code.js` | Import `OAuth2Client`; thay block "Decode id_token" bằng `OAuth2Client.verifyIdToken({idToken, audience: clientId})`. |
| `api/sync.js` | Import + dùng `lms-secrets`; thay `!==` bằng `timingSafeStringEqual`; fail-closed với 503 khi thiếu secret. |
| `api/lms/admin.js` | **KHÔNG đổi `sizeLimit`** (giữ `"500mb"` như V1). Chỉ thêm comment giải thích tại sao giữ + rằng việc siết dời sang RP-3. Xem mục 26. |
| `tests/rp1-auth-hardening.test.mjs` (mới) | 48 test bằng `node:test` đã pass (25 gốc + 23 bổ sung trong pre-commit review). |

## 6. Route bị ảnh hưởng

- `api/lms/admin.js` (mọi endpoint admin) — **không đổi hành vi body limit** (giữ `500mb`); chỉ thêm comment.
- `api/sync.js` — secret compare + fail-closed.
- `api/lms/portal.js → course-data.js, lesson.js, verify-entry-token.js` — không thay đổi route, nhưng session JWT ký/verify giờ dùng secret thật; cookie set bởi các handler này dùng `cookieOptions` mới.
- `utils/lms-handlers/exchange-code.js` — verify id_token Google.
- Mọi nơi ghi `student_device_change_logs` / `admin_audit_logs` (qua `logStudentDeviceEvent`, `writeAdminAuditLog`) — HMAC hash mới + telemetry flag.

## 7. Tên biến môi trường bắt buộc

- `SESSION_SECRET` — bắt buộc để ký/verify admin JWT + student session token.
- `ACCOUNT_EVENT_HASH_SECRET` — bắt buộc để HMAC các giá trị telemetry (ip, device, lms_session). `SESSION_GUARD_HASH_SECRET` chỉ được giữ như **alias chuyển tiếp** (fallback đọc khi `ACCOUNT_EVENT_HASH_SECRET` rỗng) để không phá V1 ngay. **Kế hoạch loại bỏ:** sau khi Vercel đã set `ACCOUNT_EVENT_HASH_SECRET`, xoá đọc `SESSION_GUARD_HASH_SECRET` trong `getAccountEventHashSecret` / `assertAuthSecretsConfigured` ở RP-3 (hoặc mốc dọn ENV kế tiếp) và xoá khỏi `AUTH_SECRET_NAMES`.
- `INTERNAL_SYNC_SECRET` — bắt buộc cho `api/sync.js` (route Shop → LMS).

Tùy chọn (gate rõ ràng):

- `LMS_ALLOW_INSECURE_COOKIE=1` — chỉ tắt `Secure` khi KHÔNG ở production. KHÔNG dùng ở production.
- `LMS_RP1_ALLOW_INSECURE_LOCAL=1` — cho phép test/dev không có secret thật. **BỊ BỎ QUA** khi `NODE_ENV=production` hoặc `VERCEL_ENV=production`.

Không thêm ENV mới nào khác. Không đổi tên biến cũ.

## 8. Test đã tạo

`tests/rp1-auth-hardening.test.mjs` — dùng Node built-in `node:test` + `node:assert/strict`. **48 test** (25 gốc + 23 bổ sung trong pre-commit review), không cần framework ngoài. Không gọi production. Không cần secret thật (sử dụng `LMS_RP1_ALLOW_INSECURE_LOCAL=1` cho happy path; các test gating tắt cờ + set `NODE_ENV`/`VERCEL_ENV=production` để chứng minh kill-switch). Cấu hình `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` giả để `utils/supabase.js` khởi tạo được client ở import-time — các test `api/sync` chỉ chạm đường auth short-circuit (503/401/400) trả về trước mọi truy vấn DB thật.

## 9. Test đã chạy

- `node --check` cho `utils/lms-secrets.js`, `utils/lms.js`, `utils/lms-session-guard.js`, `utils/lms-handlers/exchange-code.js`, `api/sync.js`, `api/lms/admin.js`, `tests/rp1-auth-hardening.test.mjs`: **PASS**.
- `node --test tests/rp1-auth-hardening.test.mjs`: **PASS 48/48**.

## 10. Kết quả test

```
ℹ tests 48
ℹ pass 48
ℹ fail 0
```

Bao phủ:

- Config đầy đủ → module khởi tạo thành công.
- Thiếu `SESSION_SECRET` (strict mode) → `AuthSecretError` (var name only).
- Thiếu `ACCOUNT_EVENT_HASH_SECRET` + `SESSION_GUARD_HASH_SECRET` (strict mode) → `AuthSecretError`.
- `AuthSecretError.toClientJson()` không chứa giá trị.
- Token hợp lệ (admin + student) → round-trip pass.
- Token sai / không phải `a.b` / expired → reject.
- Token ký bằng `"fallback-session-secret"` (V1 cũ) → reject.
- Token admin có email không trong `ADMIN_EMAILS` → reject.
- Token ký bằng secret sai → reject.
- `verifyLmsVerifiedSessionAccess` valid → ok (mock supabase).
- `verifyLmsVerifiedSessionAccess` device mismatch → reject.
- `cookieOptions` mặc định có `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `cookieOptions` gate `LMS_ALLOW_INSECURE_COOKIE=1` chỉ tắt `Secure` ngoài production.
- `admin.js` bodyParser giữ `500mb` (source check: có `"500mb"`, không có `"25mb"`).
- `timingSafeStringEqual` hằng-thời-gian.
- `hashOptionalValue` HMAC-SHA256; fail-closed khi secret missing.

## 11. Static review

- `git grep "fallback-session-secret"` → chỉ còn ở **test file** (dùng để chứng minh token cũ bị reject). Không còn ở mã nguồn.
- `git grep "fallback-"` → không còn fallback nguy hiểm nào trong `utils/` hay `api/`.
- Không thấy `console.log` / `console.error` nào log secret, token, hay giá trị ENV trong `utils/` hoặc `api/`.
- Không thay đổi `migrations/`, schema, hoặc RPC.
- Không copy code từ `v2/platform-rebuild` cũ.
- Không thêm dependency mới (`package.json` không đổi).
- Không thêm file build, cache, dotenv, hay output test ngoài `tests/rp1-auth-hardening.test.mjs`.

## 12. Git diff review

```
api/lms/admin.js                    | 10 ++++
api/sync.js                         | 29 ++++++++++--
utils/lms-handlers/exchange-code.js | 30 +++++++++----
utils/lms-session-guard.js          | 92 +++++++++++++++++++++++-------------
utils/lms.js                        | 78 ++++++++++++-------------------
```

> `api/lms/admin.js` chỉ còn **thêm comment** (không đổi `sizeLimit`). Con số dòng chốt cuối xem mục 28.

Untracked:

- `tests/rp1-auth-hardening.test.mjs`
- `utils/lms-secrets.js`

`git diff --check` không báo lỗi whitespace.

`git diff --name-only` chỉ liệt kê 5 file trên (auth-only). Không có thay đổi ngoài phạm vi RP-1.

## 13. Các điểm chưa xác minh

- Hành vi runtime thật trên Vercel production (chưa deploy). Test pass trên local Node 24 với module mock supabase.
- Schema B thật (`Supabase` runtime) — không truy vấn trong phiên này.
- Tương thích cookie `Secure` với domain staging/preview của Vercel — chưa thử.
- Độ dài tối thiểu khuyến nghị cho `SESSION_SECRET` (≥32 byte) — chưa enforce; chỉ fail-closed khi missing. Khuyến nghị vận hành set biến dài.

## 14. Rủi ro tương thích

- **Session cũ bị vô hiệu**: token ký bằng secret cũ / fallback sẽ bị reject. Cần rotate `SESSION_SECRET` trên Vercel rồi redeploy; user bị buộc đăng nhập lại.
- **Hash telemetry cũ**: các hash SHA-256 thuần (không HMAC) trong DB sẽ không so được với hash HMAC mới. Có thể cần chấp nhận backfill hoặc marker `hash_secret_missing`.
- **`Secure` cookie + Vercel preview HTTP**: nếu env `VERCEL_ENV` không phải `production` và `LMS_ALLOW_INSECURE_COOKIE` không set, cookie sẽ vẫn có `Secure` (mặc định an toàn). Có thể cần gate local cho preview.
- **Upload lớn (>25mb)**: KHÔNG còn là rủi ro của RP-1. Bản nháp `25mb` đã rollback về `500mb`; behavior upload V1 (material 50MB, gdrive-video 500MB) giữ nguyên. Việc siết theo route dời sang RP-3 B1.
- **`exchange-code` thay đổi**: token Google tự dán sẽ bị reject (đã chứng minh qua test). Đường hợp lệ (qua OAuth `response_type=code`) vẫn hoạt động bình thường.

## 15. Ảnh hưởng tới V1 rollback

- V1 baseline `f9220e8` **không đụng**. `git diff --stat f9220e8 main` rỗng; `git tag --points-at f9220e8` vẫn có `v1-stable-20260713`.
- V2 mới chỉ tồn tại trên branch `feat/v2-rp1-auth-hardening`. V1 production alias vẫn trỏ `f9220e8`.
- Nếu rollback V2 → V1: chỉ cần đổi alias domain về V1; DB tương thích (RP-1 không sửa schema).
- Nếu muốn revert riêng RP-1: 1 revert commit duy nhất, revert lại 5 file sửa + xóa 2 file mới.

## 16. Rollback plan

1. `git revert <commit-rp1>` trên `feat/v2-rp1-auth-hardening` (chưa commit → chưa cần revert, chỉ `git restore` 5 file + `rm utils/lms-secrets.js tests/rp1-auth-hardening.test.mjs`).
2. Xác minh `node --check` toàn repo.
3. Xác minh `git status --short` rỗng (so với `f9220e8`).
4. Vercel: redeploy V2 từ HEAD không RP-1 (nếu đã push trước đó).
5. Giữ nguyên ENV Vercel; V1 production alias không đổi.

## 17. Definition of Done

- [x] Không còn fallback secret nguy hiểm.
- [x] Thiếu secret bắt buộc → fail-closed.
- [x] Lỗi không chứa giá trị secret.
- [x] Token hợp lệ vẫn hoạt động.
- [x] Token sai bị từ chối.
- [x] Token ký bằng fallback cũ bị từ chối.
- [x] Admin JWT hợp lệ hoạt động.
- [x] Admin JWT sai bị từ chối.
- [x] LMS verified session hợp lệ hoạt động.
- [x] LMS verified session sai bị từ chối.
- [x] Cookie auth có `Secure`, `HttpOnly`, `SameSite=Lax` theo môi trường.
- [x] Không log secret hoặc token.
- [x] Không sửa database.
- [x] Không sửa luồng ngoài auth.
- [x] Có test local tái hiện được (48/48 pass).
- [x] Có rollback plan rõ ràng.
- [x] Không thay đổi nào trên main / origin / V2 cũ / tag V1.
- [x] Không cần secret production thật để chạy test.

## 18. Commit message đề xuất

```
fix(v2-rp1): remove session-secret fallback, fail-closed auth config

- Add utils/lms-secrets.js central secret + config validator.
- Drop "fallback-session-secret" and GOOGLE_CLIENT_ID from the session
  signing secret set in utils/lms.js (no more session-secret fallback).
- Replace hashOptionalValue fallback SHA-256 with fail-closed HMAC;
  telemetry degrades to null hashes + hash_secret_missing marker instead
  of blocking the request.
- Always set Secure + HttpOnly + SameSite=Lax on session cookies; gate
  LMS_ALLOW_INSECURE_COOKIE only honored outside production.
- Verify Google id_token signature via OAuth2Client.verifyIdToken in
  utils/lms-handlers/exchange-code.js (no longer trusted decode); stop
  logging the full tokenData object.
- Use crypto.timingSafeEqual for sync secret in api/sync.js; fail-closed
  when INTERNAL_SYNC_SECRET missing (503).
- Add tests/rp1-auth-hardening.test.mjs (node:test, 48 cases, all pass).

No DB schema change. No migration. No V1 file touched.
No bodyParser change: api/lms/admin.js stays at 500mb (a 25mb draft was
found to be a regression in pre-commit review and rolled back; tightening
deferred to RP-3).
```

## 19. Lệnh review cuối (chưa chạy)

```bash
# Trong worktree V2 mới
git status --short
git diff --stat
git diff --check
node --check utils/lms-secrets.js utils/lms.js utils/lms-session-guard.js \
  utils/lms-handlers/exchange-code.js api/sync.js api/lms/admin.js \
  tests/rp1-auth-hardening.test.mjs
node --test tests/rp1-auth-hardening.test.mjs
```

Kết quả mong đợi:
- `git status --short` chỉ liệt kê 5 file ` M` + các file `??` (`utils/lms-secrets.js`, `tests/`, `docs/`).
- `git diff --check` không báo lỗi.
- `node --check` PASS cho 7 file.
- `node --test` PASS 48/48.

## 20. Xác nhận trạng thái

- ⛔ **CHƯA COMMIT.**
- ⛔ **CHƯA PUSH.**
- ⛔ **CHƯA DEPLOY.**
- ⛔ **CHƯA MIGRATION** (không có migration nào trong RP-1).
- ⛔ Không chạm `main`, `origin/main`, `v2/platform-rebuild`, archive branch, tag V1.
- ⛔ Không gọi production endpoint / DB / API có side effect.
- ⛔ Không đọc / hiển thị / hardcode secret thật.
- ⛔ Không sửa `.env*`.

---

## 21. Independent pre-commit review

Phiên review độc lập chạy trên chính worktree `_worktrees/v2-rebuild-20260714`, branch `feat/v2-rp1-auth-hardening`, **không** review lại toàn repo, **không** commit/push/deploy. Mục tiêu: xác minh diff RP-1 trước khi cho phép commit, tìm regression và lỗ hổng còn sót.

Phương pháp:

1. Khôi phục trạng thái từ ổ đĩa (`git status/diff/diff --check/diff --name-only`) + đọc 9 file trọng tâm.
2. Đọc source thực tế (không tin comment): `lms-secrets.js`, `lms.js`, `lms-session-guard.js`, `exchange-code.js`, `api/sync.js`, `admin.js`, `admin-upload-material.js`.
3. Bổ sung test cho các đường chưa phủ.
4. Chạy `node --check` + `node --test` + grep audit.

## 22. Các vấn đề tìm thấy

| # | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| V-1 | **Cao (regression)** | `api/lms/admin.js` hạ `bodyParser` xuống `25mb`. Upload material V1 cho phép 50MB → base64 JSON ~66.7MB; gdrive-video tới 500MB. `25mb` chặn request **trước** handler. Vượt phạm vi RP-1 Auth. | ✅ Rollback về `500mb` |
| V-2 | Trung bình | `exchange-code.js` khi token-exchange lỗi log **toàn bộ** `tokenData` (`console.error("... failed:", tokenData)`), có thể chứa `id_token`/`access_token`. | ✅ Sanitize: chỉ log `tokenData.error` |
| V-3 | Thấp | Thiếu test chứng minh kill-switch `LMS_RP1_ALLOW_INSECURE_LOCAL` bị vô hiệu ở `NODE_ENV`/`VERCEL_ENV=production`, telemetry degrade, alias secret, sync 503/401/200, cookie preview/production. | ✅ Thêm 23 test |

Không tìm thấy vấn đề mới trong: fail-closed secret, cookie Secure/HttpOnly, verifyIdToken, timing-safe compare, telemetry non-blocking.

## 23. Các sửa đổi sau review

1. `api/lms/admin.js`: rollback `sizeLimit` `25mb` → `500mb`; thêm comment giải thích regression + hoãn siết sang RP-3.
2. `utils/lms-handlers/exchange-code.js`: dòng log token-exchange lỗi chỉ log `tokenData?.error` thay vì cả object.
3. `tests/rp1-auth-hardening.test.mjs`: thêm 23 test (mục 24–27), sửa test bodyParser thành assert `500mb` (không `25mb`), thêm cấu hình `SUPABASE_*` giả để import `api/sync.js`.
4. `docs/v2-new/RP1_AUTH_HARDENING_RESULT.md`: cập nhật mọi mục nói `25mb`; xoá R-11 khỏi phạm vi RP-1; cập nhật commit message.

## 24. Kiểm chứng local bypass

`isLocalBypassAllowed()` (utils/lms-secrets.js:24) chỉ trả `true` khi `LMS_RP1_ALLOW_INSECURE_LOCAL=1` **và** `NODE_ENV !== production` **và** `VERCEL_ENV !== production`.

**Quyết định: GIỮ bypass** (không loại bỏ). Lý do: cần cho dev/test chạy không có secret thật, nhưng đã được chứng minh vô hại ở production bằng test. Bypass chỉ trả synthetic secret dạng `__local_bypass__<NAME>__not_for_production__` (không thể trùng secret thật).

Test chứng minh:
- `lms-secrets: local bypass honored when flag set + not production` — hoạt động ở local.
- `lms-secrets: local bypass disabled when NODE_ENV=production` — throw `AuthSecretError`.
- `lms-secrets: local bypass disabled when VERCEL_ENV=production` — throw `AuthSecretError`.
- `lms-secrets: isLocalBypassAllowed returns false when flag unset`.
- `lms: SESSION_SECRET does not fall back to GOOGLE_CLIENT_ID` — production-strict path throw thay vì mượn `GOOGLE_CLIENT_ID`.

→ Không thể tạo session production bằng synthetic secret: ở production, getter throw trước khi ký được token.

## 25. Kiểm chứng telemetry behavior

Khi thiếu hash secret (fail-closed ở `hashOptionalValue`):
- **Không** ghi raw IP/device/session: các cột `new_device_hash`, `lms_device_hash`, `lms_session_hash`, `ip_hash` = `null` (không phải SHA-256 thuần, không phải giá trị thô).
- Marker `metadata.hash_secret_missing = true`.
- `hash_version = "hmac_sha256_v2_unavailable"`.
- **Không** làm request chính thất bại: `logStudentDeviceEvent` / `writeAdminAuditLog` nuốt `AuthSecretError`, vẫn insert.

Test:
- `sessionGuard: logStudentDeviceEvent degrades telemetry when hash secret missing`.
- `sessionGuard: writeAdminAuditLog degrades telemetry when hash secret missing`.
- `sessionGuard: hashOptionalValue fail-closed when secret missing` (throw ở đường trực tiếp).

## 26. Kiểm chứng body parser regression

- V1 baseline `admin.js`: `sizeLimit: "500mb"`.
- Bản nháp RP-1: `"25mb"` → **regression** (material 50MB → ~66.7MB base64 > 25MB → bị chặn ở parser).
- Sau rollback: `"500mb"` (khớp V1). `admin-upload-material.js:5` `MAX_MATERIAL_BYTES = 50 * 1024 * 1024` giữ nguyên → handler vẫn tự cap 50MB.
- Kết luận: siết body/upload là việc của **RP-3** (thiết kế per-route / multipart), không thuộc RP-1.

Test:
- `admin route: bodyParser limit stays at 500mb (pre-commit review rollback)` — assert có `"500mb"`, không có `"25mb"`, có comment rationale.
- `admin route: 50MB base64 upload fits under the 500mb bodyParser ceiling (math)`.

Grep: `git grep 'sizeLimit: "25mb"'` chỉ còn trong **test** (dùng để assert vắng mặt trong source); `sizeLimit: "500mb"` có ở `admin.js`.

## 27. Kiểm chứng Google token flow

- `exchange-code.js` dùng `new OAuth2Client(clientId)` + `verifyIdToken({idToken, audience: clientId})`; lấy `email` từ `ticket.getPayload()`. Đường decode thô (`Buffer.from(parts[1], "base64url")`) đã bị xoá.
- Verify thất bại → 401 `Invalid or unverified id_token` (chung chung). Không lộ chi tiết Google error, không stack trace ra client.
- Không log `id_token`/`tokenData`/`sessionToken` (đã sanitize V-2).

Test:
- `exchange-code: uses OAuth2Client.verifyIdToken with audience, not raw decode (source check)`.
- `exchange-code: verifyIdToken contract behaves as the handler expects (mock)`.
- `exchange-code: id_token verification failure maps to 401 with generic error (source check)`.
- `exchange-code: does not log id_token, session token, or any secret value`.

`api/sync` (INTERNAL_SYNC_SECRET):
- Thiếu secret → 503 `sync_misconfigured`, payload chỉ chứa tên biến, không echo giá trị.
- Secret sai → 401 chung chung.
- Secret đúng → không 401/503 (handler chạy tiếp).
Test: `api/sync: missing INTERNAL_SYNC_SECRET returns 503`, `wrong sync secret returns 401 generic`, `correct sync secret is accepted`, `error path does not leak secret values`.

## 28. Test cuối cùng

```
node --check: PASS (7 file)
node --test tests/rp1-auth-hardening.test.mjs:
ℹ tests 48
ℹ pass 48
ℹ fail 0
```

`git diff --stat` (chốt cuối):

```
 api/lms/admin.js                    | 10 +++++++
 api/sync.js                         | 29 +++++++++++++++++---
 utils/lms-handlers/exchange-code.js | 30 +++++++++++++-------
 utils/lms-session-guard.js          | 92 +++++++++++++++++++++++++++++++++++++++++--------------
 utils/lms.js                        | 78 +++++++++++++++++++++----------------------
```

Untracked: `utils/lms-secrets.js`, `tests/rp1-auth-hardening.test.mjs`, `docs/v2-new/RP1_AUTH_HARDENING_RESULT.md`.

`git diff --check`: PASS. Grep audit: `fallback-session-secret` không còn trong source (chỉ test), không còn `sizeLimit: "25mb"` trong `api/`, `GOOGLE_CLIENT_ID` chỉ còn ở đường Google OAuth hợp lệ (Drive refresh + verifyGoogleIdToken), không nằm trong đường ký session.

## 29. Quyết định READY / NOT READY TO COMMIT

**READY TO COMMIT.**

- Regression bodyParser đã rollback.
- Log token đã sanitize.
- Fail-closed + kill-switch + telemetry + cookie + verifyIdToken + timing-safe đều có test xác minh (48/48 pass).
- Không đụng schema/migration/main/V1/tag.
- Alias `SESSION_GUARD_HASH_SECRET` giữ có chủ đích + có kế hoạch loại bỏ (mục 7).

Chờ owner duyệt trước khi thực hiện commit.

---

*Dừng tại đây, chờ owner duyệt trước khi commit và push.*
