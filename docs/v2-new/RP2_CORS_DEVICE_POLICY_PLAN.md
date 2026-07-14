---

# PHỤ LỤC — RP2-A IMPLEMENTATION RESULT

> Chỉ ghi kết quả **RP2-A** (CORS policy tập trung). RP2-B/C/D **chưa** triển khai.
> Chưa commit, chưa push, chưa deploy, chưa migration.

## 1. Phạm vi đã triển khai

- Tạo helper CORS tập trung `utils/cors.js` với 4 mode: `admin`, `portal`, `internal`, `public`.
- Thay toàn bộ 26 điểm `Access-Control-Allow-Origin: *` hand-rolled: 19 handler admin + 4 handler portal + 1 internal (`api/sync.js`) chuyển sang allowlist theo mode; 2 handler public (`public-config`, `public-lesson`) giữ wildcard nhưng qua helper mode `public` (không credentials).
- Thêm feature flag `V2_CORS_ALLOWLIST_ENABLED` (chỉ bật với `1/true/yes/on`).
- Thêm test `tests/rp2-cors.test.mjs` (29 test, pass).
- **KHÔNG** đụng one-device/session enforcement (RP2-B), frontend (RP2-C), migration (RP2-D), hay auth-secret RP-1.

## 2. File sửa / thêm

Thêm mới:
- `utils/cors.js` — helper: `parseOriginList`, `isAllowedOrigin`, `isPreviewOriginAllowed`, `appendVaryHeader`, `applyCors`, `_internals`.
- `tests/rp2-cors.test.mjs` — 29 test.

Sửa (26 file, chỉ thay khối CORS + thêm import):
- `api/sync.js` (mode internal).
- 19 handler admin: `admin-auth`, `admin-bulk-enroll`, `admin-courses`, `admin-account-sharing-alerts`, `admin-enrollments`, `admin-lessons`, `admin-repair-drive`, `admin-drive-permission`, `admin-drive-retry`, `admin-drive-health`, `admin-drive-auth`, `admin-student-trace`, `admin-students`, `admin-sync-drive-permissions`, `admin-upload-image`, `admin-upload-material`, `admin-upload-gdrive-video`, `admin-upload-recipe`, `admin-verify-media`.
- 4 handler portal: `course-data`, `lesson`, `verify-entry-token`, `exchange-code`.
- 2 handler public: `public-config`, `public-lesson`.

## 3. Route / mode mapping cuối

| Mode | Route | Allowlist ENV | Credentials |
|---|---|---|---|
| admin | 19 handler `admin-*` | `LMS_ADMIN_ORIGINS` | Cho phép khi echo origin cụ thể (mặc định bật cho mode admin) |
| portal | `course-data`, `lesson`, `verify-entry-token`, `exchange-code` | `LMS_PORTAL_ORIGINS` | Không (mặc định tắt) |
| internal | `api/sync.js` | — (no-Origin cho qua; Origin lạ chặn khi flag bật) | Không |
| public | `public-config`, `public-lesson` | — (wildcard) | Không (từ chối nếu ai đó bật credentials) |

## 4. ENV mới

- `V2_CORS_ALLOWLIST_ENABLED` — bật allowlist (`1`/`true`/`yes`/`on`). Mặc định tắt.
- `LMS_PORTAL_ORIGINS` — CSV origin browser hợp lệ cho portal.
- `LMS_ADMIN_ORIGINS` — CSV origin admin console.
- `LMS_PREVIEW_ORIGIN_SUFFIX` — hậu tố preview (chỉ non-production; áp dụng cho admin/portal).

Không đọc secret. Không đổi tên ENV cũ.

## 5. Behavior khi flag bật (`V2_CORS_ALLOWLIST_ENABLED=1`)

- admin/portal: Origin hợp lệ (allowlist hoặc preview non-prod) → echo `Access-Control-Allow-Origin: <origin>` + `Vary: Origin`. Origin lạ → không ACAO; OPTIONS/preflight và request thường trả 403 `cors_origin_forbidden`. Request không có Origin (same-origin/non-browser) → cho qua, không echo ACAO.
- internal: không Origin → cho qua; Origin lạ → 403.
- credentials chỉ set khi đã echo origin cụ thể (không bao giờ cùng `*`).

## 6. Behavior khi flag tắt (compatibility)

- admin/portal/internal (không credentials): giữ `Access-Control-Allow-Origin: *` như V1.
- Nếu caller bật credentials: helper **từ chối** `*`, echo origin cụ thể (hoặc `null` khi không có Origin) + `Vary: Origin`. → không bao giờ tạo `*` + credentials, kể cả khi flag tắt.

## 7. Behavior production

- `LMS_PREVIEW_ORIGIN_SUFFIX` bị **vô hiệu hoàn toàn** khi `NODE_ENV=production` hoặc `VERCEL_ENV=production`.
- Chỉ allowlist tường minh mới được echo.

## 8. Behavior preview

- Non-production: origin khớp `LMS_PREVIEW_ORIGIN_SUFFIX` được echo. Khớp theo biên nhãn DNS thật (regex `^[a-z0-9-]+(\.[a-z0-9-]+)*$` cho phần đầu), **không** substring. Chặn `evil-example.vercel.app.attacker.com`, `vercel.app.attacker.com`, `notvercel.app`.

## 9. Behavior server-to-server

- `api/sync.js`: request không Origin (Shop→LMS) đi qua CORS; `INTERNAL_SYNC_SECRET` (RP-1) vẫn là lớp auth bắt buộc phía sau, `timingSafeStringEqual` không đổi.
- Origin lạ + flag bật → 403 trước khi tới auth.

## 10. Public endpoints còn wildcard

- `utils/lms-handlers/public-config.js` (mode public).
- `utils/lms-handlers/public-lesson.js` (mode public).
- Cả hai: wildcard không credentials. Được ghi trong `_internals.PUBLIC_WILDCARD_ALLOWED_FILES` và test 27 assert đúng 2 file này.

## 11. Test đã tạo

`tests/rp2-cors.test.mjs` — 29 test `node:test`, không mạng, không production. Fixture chỉ dùng origin công khai (`https://www.yeunauan.live`) và origin ví dụ (`*.example.com`, `*.vercel.app`).

## 12. Test đã chạy

- `node --check` cho `utils/cors.js`, `api/sync.js`, toàn bộ 25 handler sửa, `tests/rp2-cors.test.mjs`: PASS.
- `node --test tests/rp2-cors.test.mjs`: PASS.
- `node --test tests/rp1-auth-hardening.test.mjs`: PASS (regression check).

## 13. Kết quả test

```
tests/rp2-cors.test.mjs:           tests 29  pass 29  fail 0
tests/rp1-auth-hardening.test.mjs: tests 48  pass 48  fail 0
```

## 14. Static review

- `grep 'Access-Control-Allow-Origin'` trong `api/` + `utils/lms-handlers/`: không còn ở source handler (chỉ còn trong `utils/cors.js` và test). Không handler nào set ACAO trực tiếp.
- Wildcard literal `"*"` cho ACAO chỉ còn trong `utils/cors.js` (mode public + compatibility no-credential path).
- Không đụng `utils/lms-secrets.js`, `utils/lms.js`, `utils/lms-session-guard.js`, migration, schema, frontend.
- `git diff --check`: sạch (không whitespace error).

## 15. Các điểm chưa xác minh

- Giá trị thật `LMS_PORTAL_ORIGINS` / `LMS_ADMIN_ORIGINS` / `LMS_PREVIEW_ORIGIN_SUFFIX` trên Vercel (chưa set; phải owner cấu hình trước khi bật flag ở production).
- Danh sách origin production/preview đầy đủ (mới chắc `www.yeunauan.live`; domain admin cần owner xác nhận).
- Hành vi runtime thật trên Vercel (chưa deploy).
- Preflight thực tế từ trình duyệt (test dùng req/res double).

## 16. Rủi ro rollout

- Bật flag mà allowlist thiếu/sai → chặn nhầm origin hợp lệ (fail-closed). Giảm thiểu: xác nhận allowlist + bật ở preview/canary trước.
- admin mode mặc định cho phép credentials: chỉ set khi echo origin cụ thể; vẫn cần allowlist đúng domain admin.
- Public endpoint vẫn mở (đúng thiết kế RP2-A); hardening ghi views thuộc RP-4.

## 17. Rollback plan

1. Tắt `V2_CORS_ALLOWLIST_ENABLED` → toàn bộ route quay `*` (compatibility), helper vẫn chặn `*`+credentials.
2. Nếu cần gỡ code: revert 1 commit RP2-A (26 file sửa + xóa `utils/cors.js`, `tests/rp2-cors.test.mjs`).
3. Không migration → không cần rollback DB.

## 18. Definition of Done RP2-A

- [x] `utils/cors.js` tập trung, 4 mode.
- [x] 26 điểm `*` thay bằng `applyCors` (admin/portal/internal/public).
- [x] Không còn ACAO trực tiếp trong handler admin/portal/internal.
- [x] Không `*` + credentials ở bất kỳ đường nào (kể cả flag tắt).
- [x] Origin lạ fail-closed + preflight 403 `cors_origin_forbidden`, không lộ allowlist.
- [x] Server-to-server no-Origin đi qua; secret RP-1 vẫn bắt buộc.
- [x] Public wildcard chỉ ở 2 file allowlisted.
- [x] Preview suffix chỉ non-production, chặn spoof, bỏ qua ở production.
- [x] Feature flag rõ ràng, compatibility khi tắt.
- [x] Test RP2-A pass (29/29); RP-1 không regression (48/48).
- [x] Không đụng one-device/session, frontend, migration, auth-secret RP-1.
- [x] Không commit/push/deploy.

## 19. Commit message đề xuất

```
feat(v2-rp2a): centralize CORS policy with origin allowlist

- Add utils/cors.js: applyCors(req,res,{mode}) with admin/portal/internal/
  public modes, origin allowlist parsing, preview-suffix matching (label-
  boundary safe, non-production only), and Vary: Origin handling.
- Never emit Access-Control-Allow-Origin: * together with
  Access-Control-Allow-Credentials: true, even when the flag is off.
- Replace 26 hand-rolled wildcard CORS blocks: 19 admin handlers + 4 portal
  handlers + api/sync (internal) now use the allowlist; public-config and
  public-lesson keep wildcard (no credentials) via public mode.
- Gate the allowlist behind V2_CORS_ALLOWLIST_ENABLED; fail-closed for
  cross-origin browser requests when the flag is on and the origin is not
  allowed (403 cors_origin_forbidden, no allowlist leak).
- api/sync keeps INTERNAL_SYNC_SECRET (RP-1) as the authoritative auth
  layer; CORS does not replace it. No session/device behavior changed.
- Add tests/rp2-cors.test.mjs (node:test, 29 cases, all pass).

New env (public origins only; no secrets): V2_CORS_ALLOWLIST_ENABLED,
LMS_PORTAL_ORIGINS, LMS_ADMIN_ORIGINS, LMS_PREVIEW_ORIGIN_SUFFIX.

No DB schema change. No migration. No frontend change. RP-1 auth contract
untouched. RP2-B/C/D not started.
```

## 20. READY / NOT READY TO COMMIT

**READY TO COMMIT** (chờ owner duyệt).

- Chỉ file CORS helper + 26 handler + test + plan.
- Không migration, không session/device change, không frontend, không secret, không file cache/build.
- RP2-A test 29/29 pass; RP-1 48/48 pass.