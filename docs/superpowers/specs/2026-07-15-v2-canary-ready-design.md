# V2 Canary-Ready — Design Spec

> Ngày: 2026-07-15
> Branch tích hợp: `v2/rebuild-20260715` (mới, tạo từ `v2/platform-rebuild`)
> Mục tiêu: gộp 2 lineage V2 + làm nốt phần còn lại đến **canary-ready**.
> V1 production (`main`, tag `v1-stable-20260713`) bất biến. Cutover traffic thật là quyết định owner, **ngoài** spec này.

## 1. Bối cảnh

Có 2 dòng V2 song song, diverged từ V1 (`f9220e8` / tag `v1-stable-20260713`), chưa gộp:

| Dòng | Branch | Nội dung chính | Trạng thái |
|---|---|---|---|
| Platform rebuild | `v2/platform-rebuild` | Outbox, identity mapping, worker dry-run, portal projection, diagnostics, readiness, reconciliation | Code + docs xong; schema identity chưa apply; chưa bật live delivery |
| V2 mới / security RP | `v2/rebuild-20260714` + feature branches | RP-1 auth, RP2-A CORS, RP2-B0 grants, RP2-B1 one-device (chưa merge vào rebuild) | Còn RP2-B2 logout, RP2-B3 admin revoke polish, RP2-C frontend, RP2-D rollout |

Master plan còn: Session lease V2, Drive job queue, Risk V2, Admin UI, canary/cutover.

Hai dòng không share commit. "Hoàn thiện V2 new" = quyết định tích hợp + thứ tự.

## 2. Quyết định scope (chốt với owner)

- **Q1 phạm vi:** C — gộp 2 lineage + làm nốt phần còn lại theo master plan.
- **Q2 tích hợp:** B — branch tích hợp riêng `v2/rebuild-20260715`, giữ 2 lineage gốc làm tham chiếu/rollback.
- **Q3 mốc hoàn thiện:** A — canary-ready. V1 production giữ nguyên. Cutover do owner.
- **Q4 subsystem bắt buộc:** A — Core canary. Hoãn Drive job queue V2, Risk V2, Admin UI diagnostics page.
- **Q5 rào cản:** a-A (Vercel preview cho V2, production giữ V1), b-Y (owner tự apply migration theo runbook, tôi verify), c-P (Portal repo ngoài worktree; plan chỉ xử lý LMS, ghi dependency Portal).
- **Q6 session guard:** A — Full RP2-B2 (server-side logout) + RP2-B3 (admin revoke polish).
- **Tiếp cận:** Cách 1 — integration branch làm base mới, merge-first, slice còn lại tách branch.

## 3. Kiến trúc & dòng tích hợp

### Branch cấu trúc

```
v1-stable-20260713 (f9220e8)  ── V1 production, bất biến
   │
   ├─ v2/platform-rebuild          (sync/outbox/identity/observe)
   └─ v2/rebuild-20260714          (RP-1, RP2-A, RP2-B0)
          └─ feat/v2-rp2b1          (one-device, chưa merge)
                 ↓  merge-first vào base mới
   v2/rebuild-20260715  = base từ v2/platform-rebuild
          ↑ merge: v2/rebuild-20260714 + feat/v2-rp2b1
          ↑ slice feature branches (mỗi slice merge ngược):
             • feat/v2-rp2b2-logout
             • feat/v2-rp2b3-revoke-polish
             • feat/v2-sync-verify
             • feat/v2-canary-readiness
```

### Merge-first (giải conflict một lần)

1. `git checkout -b v2/rebuild-20260715 v2/platform-rebuild`
2. `git merge v2/rebuild-20260714` → giải conflict RP-1/A/B0.
3. `git merge feat/v2-rp2b1` → giải conflict one-device B1.
4. Verify build + test (RP-1 48 test + RP2-A 29 test + `node --check` toàn handler).
5. Push base + tạo worktree `.claude/worktrees/v2-rebuild-20260715`.

### Conflict surface (đã verify bằng `git merge-tree`)

Dry-run `git merge-tree` với merge-base `f9220e8` cho kết quả thực tế:

- **Merge `v2/rebuild-20260714` vào `v2/platform-rebuild`:** không conflict (tree write sạch, exit 0). Hai lineage thay **file hoàn toàn không giao** (xác nhận bằng `comm` intersection = rỗng).
- **Merge `feat/v2-rp2b1` vào `v2/platform-rebuild`:** đúng **1 conflict**, `utils/v2-flags.js` (add/add). Hai lineage cùng tạo file này với mục đích khác nhau:
  - platform-rebuild: enum `V2_FLAGS` + `getV2Env`/`isV2FlagEnabled`/`getV2ListFlag`/`getV2RuntimeMode` (sync flags).
  - rp2b1: `parseBooleanFlag` + `isV2CorsAllowlistEnabled` + `isV2GlobalOneDeviceEnabled` (security flags, pure-function style).
  - **Resolution = union** cả hai mục đích: giữ nguyên enum + helpers sync của platform-rebuild, thêm `parseBooleanFlag` + `isV2CorsAllowlistEnabled` + `isV2GlobalOneDeviceEnabled` của rp2b1. Không xóa bên nào. Hai nhóm flag độc lập nên không xung đột ngữ nghĩa.
- `utils/supabase.js` (B1 sửa) và `utils/lms-session-guard.js`/`exchange-code.js`/`course-data.js`/`lesson.js`/`verify-entry-token.js` (B1 sửa; RP-1 cũng sửa trong rebuild-20260714) merge sạch vì platform-rebuild không đụng các file này.

Vậy conflict surface thực tế = **1 file add/add**, resolution cơ học. Kill-switch S0 ít khả năng kích hoạt.

### Kill-switch S0

Nếu sau giải conflict build/test vát → không commit base → giữ 2 lineage riêng → chuyển sang Cách 3 (finish-first: làm B2/B3 trên lineage RP trước, merge cuối).

### Data ownership (không đổi)

Supabase B giữ source of truth; Supabase A là projection (không ghi ngược). Outbox/schema/diagnostic chạy trên B. Master plan, Data Ownership Contract, Rollout baseline giữ nguyên.

## 4. RP2-B2 — Server-side logout

**Vấn đề (P0-3):** Helper `markStudentSessionLoggedOut` + event `LOGOUT` tồn tại, nhưng không có route nào gọi. Logout hiện gần như client-only → policy #11 lỗ.

**Endpoint mới (additive):**
- Route: `api/lms/portal.js` → `endpoint=logout` (cùng pattern `course-data`/`lesson`/`verify-entry-token`/`exchange-code`).
- Luồng:
  1. Xác thực LMS verified session (`X-LMS-Session-Id` + `X-LMS-Device-Id`) qua `verifyLmsVerifiedSessionAccess` — không tin `course_session_token`.
  2. Gọi `markStudentSessionLoggedOut` → RPC `student_active_sessions` status `logged_out`.
  3. Clear cookie `course_session_token` (Set-Cookie `Max-Age=0`).
  4. Idempotent: gọi logout 2 lần → lần 2 vẫn 200 (session đã `logged_out` thì no-op).
  5. Fail-server → không giả vờ OK: trả status lỗi rõ, client không clear local cho tới khi server 200.
- CORS: `applyCors(... { mode: 'portal' })` từ RP2-A.
- Error contract: collapse về `logout_failed` / `invalid_session`; không lộ email/device/session id (Phụ lục C §21).
- Feature flag: tôn trọng `V2_GLOBAL_ONE_DEVICE_ENABLED`. Flag off → vẫn logout (V1 compat), không enforce one-device. Flag on + DB/RPC lỗi → fail-closed (503 `one_device_policy_unavailable`).

**Test:** `tests/rp2-b2-logout.test.mjs` — logout thành công, idempotent, fail-server không clear, session sai bị chặn, flag off compat, flag on fail-closed. Mock supabase như RP-1.

## 5. RP2-B3 — Admin revoke polish

**Vấn đề (P0-4):** Admin revoke đã có (`admin-account-sharing-alerts` action `reset_session` → `resetStudentSessionByEmail` → RPC `reset_student_session_guard`, status `admin_reset`). Thiếu: reason bắt buộc + error contract + idempotency UX.

**Sửa (scope hẹp):**
- `admin-account-sharing-alerts` handler: `reset_session` bắt buộc `reason` (text, max 500, không rỗng). Thiếu reason → 400 `reason_required` (không xài default).
- Error contract: collapse về `revoke_failed` / `already_revoked` (idempotent) / `student_not_found`. Không lộ email/IP/device/session id.
- Idempotency: revoke session đã `admin_reset`/`logged_out` → 200 `already_revoked` (no-op), không throw.
- Audit: `writeAdminAuditLog` ghi actor + reason (lý do rõ, không phải default).
- CORS: mode `admin` từ RP2-A.

**Test:** `tests/rp2-b3-revoke.test.mjs` — revoke thành công + audit có reason, thiếu reason → 400, revoke lại → `already_revoked`, student không tồn tại → `student_not_found`, không lộ metadata.

**Chung B2+B3:** không thêm status enum mới (dùng `logged_out` / `admin_reset` đã có). Không migration (tái dụng schema/RPC P1-4). Out of scope: admin approve device B / pending flow / heartbeat.

## 6. Sync verification (identity → shadow → dry-run → live → readiness)

### 6a — Identity mapping migration apply (owner áp dụng, tôi verify)

`migration_v2_identity_mapping.sql` committed nhưng chưa apply. Schema drift: `orders`/`student_enrollments`/`lessons` thiếu cột identity; `course_slug_mappings`/`portal_post_course_mappings` chưa có.

Workflow (b-Y):
1. Runbook `scripts/v2/preflight-v2.sql` → owner chạy trong Supabase B SQL Editor, snapshot.
2. Owner apply `migration_v2_identity_mapping.sql` trong transaction.
3. Owner chạy `scripts/v2/postflight-v2.sql` → tôi đọc kết quả.
4. Tôi verify qua `/api/v2/readiness` + `/api/v2/reconciliation` (read-only) cho tới khi: `course_id is null` count đưa vào reconciliation report; `sync_outbox` / `course_slug_mappings` / `portal_post_course_mappings` tồn tại.
5. Postflight fail → rollback `scripts/v2/rollback-v2.sql` → không tiến hành 6b.

Flag posture trong 6a: tất cả V2 delivery flags off. Chỉ đọc.

### 6b — Outbox shadow mode

Bật `V2_OUTBOX_SHADOW_MODE=true` trên V2 preview env (a-A). Shop/LMS sync event ghi thêm vào `sync_outbox` song song V1 `/api/sync`. V1 flow không đổi. Verify qua `/api/v2/outbox`: `idempotency_key` ổn định (source + event + aggregate + updated_at), payload đúng, không secret. Ngưỡng: không V1 regression; outbox row tăng đúng volume; không duplicate key.

### 6c — Worker dry-run + portal projection dry-run

`/api/v2/sync-worker` (dry-run mặc định): tính delivery plan, không deliver. `/api/v2/portal-projection-preview`: build payload Portal `/api/sync` cho 1 event, không gửi. Bật `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true`. Ngưỡng exit dry-run: preview payload khớp V1 `/api/sync` trên sample course/enrollment event (owner so từng mẫu).

### 6d — Guarded live delivery (canary scope)

Chỉ khi 6c sample khớp + owner xác nhận. `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`, `V2_DRIVE_WORKER_DRY_RUN` giữ true (Drive job queue hoãn Q4-A). Live chỉ portal projection + outbox delivery; Drive delivery vẫn dry-run. Scope: tài khoản/khóa canary (owner chỉ định). Mỗi target có record `sync_deliveries`; retry backoff; quá số lần → `sync_dead_letters`.

### 6e — Reconciliation thresholds + readiness gate

`/api/v2/reconciliation` (read-only) report identity/outbox mapping gaps. Ngưỡng canary-ready:
- `course_id is null` (orders/enrollments/lessons) → track trong report, không yêu cầu = 0.
- Outbox: `sync_deliveries` success rate ≥ ngưỡng (chốt cụ thể trong plan), `sync_dead_letters` có alert.
- Reconciliation: không auto-revoke; lệch nghiêm trọng → trạng thái "cần admin kiểm tra" (Data Ownership Contract §repair).

`/api/v2/readiness` là gate top-level. Canary-ready = readiness trả "go" cho scope canary. Runbook reconciliation: kết quả kỳ vọng + threshold ghi vào `docs/v2/V2_RECONCILIATION_RUNBOOK.md` (mới).

**Out of scope (Q4-A):** Drive permission job queue V2, Risk V2 incremental, Admin UI diagnostics page.

## 7. Canary + rollback drill + cutover runbook

### 7a — Canary setup (a-A: Vercel preview cho V2, production giữ V1)

- V2 deploy trên Vercel preview deployment của `v2/rebuild-20260715`.
- Production (daubepnho.store alias) giữ V1 trên `main` / `v1-stable-20260713`. Không touch.
- Supabase B chung (V1+V2 cùng DB, additive migration an toàn).
- Canary scope: owner chỉ định tài khoản/khóa test. Không bật flag toàn hệ thống.
- Env preview: `V2_GLOBAL_ONE_DEVICE_ENABLED=true`, outbox progression theo Phần 6, `V2_DELIVERY_HANDLERS_ENABLED=true` (sau 6d), `V2_DRIVE_WORKER_DRY_RUN=true`, `V2_CORS_ALLOWLIST_ENABLED=true`, auth secrets thật.
- Env production: tất cả V2 flag off. V1 behavior nguyên vẹn.

### 7b — Rollback drill (thực hành, không chờ sự cố)

- Drill 1 — Rollback code: Vercel redeploy `v1-stable-20260713` lên preview alias → verify V1 endpoints. Không drill trên production.
- Drill 2 — Rollback schema: `scripts/v2/rollback-v2.sql` (additive-safe: drop chỉ table/cột V2 mới). Chạy trên Supabase B dev trước (nếu có), hoặc dry-run + review SQL trên prod-schema snapshot. Verify post-rollback V1 vẫn đọc được.
- Drill 3 — Rollback flag: tắt từng flag V2 theo thứ tự ngược → verify readiness trả "no-go", V1 flow khôi phục.
- Ghi kết quả drill vào `docs/v2/V2_ROLLBACK_RUNBOOK.md` (cập nhật file hiện có).
- Tiêu chí pass: rollback code + flag + schema đều có đường rõ, không cần migration đảo destructive.

### 7c — Cutover runbook (tài liệu, không thực thi)

`docs/v2/V2_CUTOVER_RUNBOOK.md` (mới): thứ tự flip flag khi owner xác nhận canary sạch:
1. Reconciliation xanh trên scope canary.
2. Bật flag V2 trên production env theo thứ tự (session → sync → projection).
3. Monitor readiness + outbox + `/api/sync` V1 trong cửa sổ quan sát.
4. Giữ V1 rollback path nóng.
5. Không xóa V1 endpoint trong gói này (Q4-A: admin UI/Drive/Risk hoãn; xóa V1 thuộc phase cutover thật).

Cutover thật = quyết định owner, ngoài spec này. Spec chỉ đến "sẵn sàng canary".

### 7d — Test matrix cập nhật

Cập nhật `docs/v2/V2_TEST_MATRIX.md`: thêm canary scenarios (logout server-side, admin revoke reason, outbox shadow volume, projection preview match, readiness gate, rollback drill). Regression V1 (matrix hiện có) phải pass trên cả production và preview V2 flag-off.

**Kill-switch tổng:** bất kỳ drill fail hoặc readiness không xanh → không tiến hành canary, giữ V1.

## 8. Thứ tự thực thi slice + task map

```
S0  Base tích hợp            ← merge-first, giải conflict, verify build+test
        ↓ (base phải sạch)
S1  RP2-B2 logout            ← cần base + B1 context
S2  RP2-B3 revoke polish     ← cần base; độc lập S1
        ↓ (session guard hoàn)
S3  Sync verify              ← cần base; identity apply (owner) + shadow→dry-run→live
        ↓ (readiness phải xanh)
S4  Canary readiness         ← cần S1+S2+S3; rollback drill + cutover runbook + test matrix
```

S1 ∥ S2 có thể song song (độc lập, vùng khác nhau: B2 portal route mới, B3 admin handler đã có). S3 phụ thuộc owner apply migration (b-Y): code S3 làm được ngay, phần vận hành chờ owner.

| ID | Slice | Branch | Phụ thuộc | Verify exit |
|---|---|---|---|---|
| S0 | Base tích hợp `v2/rebuild-20260715` | merge-only | — | build + test (RP1 48 + RP2-A 29) pass; `node --check` toàn handler; working tree sạch |
| S1 | RP2-B2 server-side logout | `feat/v2-rp2b2-logout` | S0 | `tests/rp2-b2-logout` pass; logout idempotent + fail không giả vờ OK + flag off/on |
| S2 | RP2-B3 admin revoke polish | `feat/v2-rp2b3-revoke-polish` | S0 | `tests/rp2-b3-revoke` pass; reason bắt buộc + idempotent + audit + no metadata leak |
| S3 | Sync verify (identity→shadow→dry-run→live→readiness) | `feat/v2-sync-verify` | S0 + owner apply migration | postflight sạch; outbox shadow volume đúng; projection preview khớp V1; readiness "go" scope canary |
| S4 | Canary readiness (drill + runbook + test matrix) | `feat/v2-canary-readiness` | S1+S2+S3 | rollback drill pass (code+flag+schema); cutover runbook viết; test matrix cập nhật; V1 regression pass trên preview flag-off |

## 9. Quy tắc invariant (giữ qua mọi slice)

- Không merge vào `main`. Không deploy production. Không flip flag production.
- Migration additive-only; apply qua runbook, không auto.
- Không xóa/rename field V1; không đổi slug hàng loạt.
- Không log secret/token/private key.
- Không commit `scratch/`, `review-dossier-*`, `.env*`, `node_modules`.
- Mỗi slice: branch riêng → test pass → merge ngược vào `v2/rebuild-20260715` → push.
- Fail build/test sau merge S0 → kill-switch → chuyển Cách 3.
- Cutover traffic thật = quyết định owner, ngoài spec.

## 10. Quyết định cần owner DURING thực thi (không phải spec)

- S3: chạy preflight + apply `migration_v2_identity_mapping.sql` + postflight trên Supabase B.
- S3 6c→6d: xác nhận projection preview sample khớp V1 → cho phép live delivery canary.
- S4: chỉ định tài khoản/khóa canary; duyệt readiness "go".

## 11. Out of scope (gác sang phase sau)

- Drive permission job queue V2 (sau khi outbox delivery proven).
- Risk V2 incremental summaries / retention / false positive lifecycle.
- Admin UI diagnostics page (outbox / readiness / reconciliation dashboard).
- RP2-C frontend Portal/LMS UI cho session guard.
- Portal repo `student-web` ngoài worktree (dependency ghi rõ). Lưu ý P0-1: RPC `handle_student_session_login` (login decision "block B khi A active") có caller ở **Portal**, không trong LMS. RP2-B1 chỉ enforce **LMS-side** (course-data/lesson chặn khi thiếu verified session) — phần này chạy độc lập trên LMS. Phần **login-block** tại Portal cần Portal V2 cùng bật mới hoàn chỉnh chính sách one-device; canary LMS-side guard vẫn chạy được trước đó.
- Cutover traffic thật / xóa V1 endpoint.
