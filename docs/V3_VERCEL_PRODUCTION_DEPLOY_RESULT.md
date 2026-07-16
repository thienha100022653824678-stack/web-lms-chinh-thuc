# V3 Vercel Production Deploy — Result

> **Ngày deploy:** 2026-07-16
> **Repo:** `web-lms-chinh-thuc` (LMS chính thức, `www.daubepnho.store`)
> **Mục tiêu:** Deploy code V3 lên production, **giữ `active_mode=v1`** — để owner chỉ cần mở trang admin và bấm chuyển V1/V2/V3.

## Tóm tắt (executive summary)

| Mục | Giá trị |
|---|---|
| Branch | `v3/research-20260715` |
| Commit SHA | `d75c080f4189c5d4c783f9f1a4e2bf52377607a3` (`d75c080`) |
| Vercel project | `web-lms-chinh-thuc` (team `thienha100022653824678-stacks-projects`) |
| Production domain | `https://www.daubepnho.store` |
| Preview deploy | **PASS** (smoke test read-only pass) |
| Production deploy | **PASS** (promote verified preview → production) |
| Smoke-test production | **PASS** (xem §5) |
| `active_mode` sau deploy | **`v1`** (không đổi) |
| `kill_switch` | `false` (không đổi) |
| V1 business path | Hoạt động bình thường (không ảnh hưởng) |
| V2/V3 authoritative | **Chưa bật** (shadow off, audit 0 flip) |
| Test suite | **289/289 PASS** (271 cũ + 18 mới cho runtime-admin UI) |
| Rollback deployment | Sẵn sàng — `dpl_EcoXHDs2oSjPxfu2R3iLU78sJqCR` (xem §7) |

**Việc duy nhất owner còn phải làm:** mở `https://www.daubepnho.store/runtime-admin.html`, nhập worker secret (`INTERNAL_SYNC_SECRET`/`V2_WORKER_SECRET`), bấm **Load state**, rồi bấm nút V1/V2/V3 (hoặc Rollback/Kill switch) có confirm bằng tay. Xem §8.

---

## 1. Branch, commit, project

- **Branch:** `v3/research-20260715` (đồng bộ `origin/v3/research-20260715`).
- **Commit mới deploy:** `d75c080` — `feat(v3): runtime switch admin UI (runtime-admin.html) + UI tests`.
  - Trên commit `290f383` (đã apply 4 Supabase B production migrations, postflight PASS).
  - Nội dung `d75c080`: thêm `runtime-admin.html` (trang switch V1/V2/V3) + `tests/v3-runtime-admin-ui.test.mjs` (18 test). **Không thay đổi source V1/V2/V3.**
- **Vercel project:** `web-lms-chinh-thuc`, org/team `thienha100022653824678-stacks-projects`, project ID `prj_TimQqrVhrOLW8y1KI464JBvajwlz`.
- **Account login:** `thienha100022653824678-stack` (Vercel CLI 54.18.2, Node 24.15.0).
- **Production domain:** `https://www.daubepnho.store` (apex `daubepnho.store` → 308 → `www`).
- **Framework/build:** static HTML + Vercel serverless ESM (`api/`). Không có build command (package.json chỉ khai báo dependencies; không `build` script). Output = các file tĩnh + `api/**` functions.
- **Env vars (chỉ tên, không giá trị):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_SYNC_SECRET`, `SESSION_SECRET`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`, `SYSTEM1_URL`, `DRIVE_ADMIN_{1,2,3}_{EMAIL,CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}`, `V2_OUTBOX_WORKER_ENABLED`, `V2_OUTBOX_WORKER_DRY_RUN`, `V2_OUTBOX_SHADOW_MODE`, `V2_DELIVERY_HANDLERS_ENABLED`, `V2_PORTAL_PROJECTION_ENABLED`, `V2_PORTAL_PROJECTION_DRY_RUN`, `V2_RECONCILIATION_READONLY`, `V2_DRIVE_WORKER_DRY_RUN`, `LMS_ENTRY_TOKEN_REQUIRED_COURSES`, `VERCEL_OIDC_TOKEN` (+ các `VERCEL_GIT_*` tự cấp). Tất cả giá trị Encrypted trên Vercel, áp dụng cho Production + Preview.

## 2. Deploy readiness (Phase 2)

- **Test suite:** `node --test tests/*.test.mjs` → **289/289 PASS** (15.4s). Bao gồm 18 test mới cho `runtime-admin.html`.
- **Syntax/build check:** `node --check` qua toàn bộ `api/` + `utils/` (64 file `.js`) + `packages/v3-event-schema/src/*.mjs` → OK.
- **Các API tồn tại trong build (đã verify 401-gated trên production):**
  - `GET/POST /api/v2/runtime` — runtime state + switch flip. ✅ 401 không secret.
  - `GET /api/v2/readiness` — V2 readiness gates. ✅ 401 không secret.
  - `GET /api/v3/diagnostics` — V3 readiness/posture. ✅ 401 không secret.
  - `GET /api/v2/diagnostics` — V2 diagnostics (cùng gate).
  - `POST /api/v2/switch` (runtime switch): chính là `POST /api/v2/runtime` với `active_mode`/`kill_switch`.
  - **Rollback V1:** `POST /api/v2/runtime { "active_mode":"v1" }` hoặc `{ "kill_switch": true }` (instant, không redeploy).
  - **Kill switch:** `POST /api/v2/runtime { "kill_switch": true|false }`.
- **Admin UI (`runtime-admin.html`)** có: trạng thái active/effective mode, nút V1/V2/V3, nút Rollback→V1, nút Kill switch ON/OFF, nút V2/V3 shadow ON/OFF, card V2 readiness, card V3 diagnostics, loading (spinner + disable), error banner, confirm modal (typed confirm word). Tất cả verify = 1 (present) trên production.
- **Admin API bảo vệ:** `/api/v2/runtime`, `/api/v2/readiness`, `/api/v3/diagnostics`, `/api/v2/diagnostics` đều `assertV2WorkerAuthorized` (header `x-v2-worker-secret` hoặc `x-sync-secret` == `V2_WORKER_SECRET`/`INTERNAL_SYNC_SECRET`). Các `/api/lms/admin?endpoint=*` đều `getAdminFromRequest` (admin session JWT). Không có admin endpoint nào mở.
- **Frontend không tự quyết `active_mode`:** `runtime-admin.html` không đọc/ghi `active_mode` từ localStorage; state chỉ hiển thị sau khi backend xác nhận (`renderRuntime` từ response). Verify bằng `tests/v3-runtime-admin-ui.test.mjs` (18/18). Các trang `lms.html`/`lesson.html`/`index.html` chỉ lưu *session token học viên* (không phải `active_mode`) trong localStorage — đó là cơ chế V1 hiện hữu, không liên quan runtime mode.

## 3. Deploy preview (Phase 3)

- **Preview deployment được smoke-test:** `https://web-lms-chinh-thuc-bkhsacm4y.vercel.app` (deploy ID `dpl_3bn5nVh1Baj5hcCdu44MuHaFtCg3`, git-built từ commit `d75c080`).
- **Build result:** ● Ready.
- **Smoke test read-only trên preview — PASS:**
  - Home `/` → 200, title thật “Học Nấu Ăn Online…”.
  - `/admin.html`, `/lms-admin.html`, `/runtime-admin.html` → 200.
  - `GET /api/v2/runtime` không secret → **401** (đúng); wrong secret → **401**.
  - `GET /api/v2/readiness` → **401** JSON `{ok:false,error:"Unauthorized",message:"Worker secret is invalid or missing."}`.
  - `GET /api/v3/diagnostics` → **401** JSON (không 500).
  - `POST /api/v2/runtime` không/wrong secret → **401** (không write).
  - V3 router `/api/v3/lms/public-config` → **200** (delegates to V1 legacy portal vì `active_mode=v1`).
  - V1 path `/api/lms/portal?endpoint=public-config` → 200.
  - `active_mode` DB vẫn `v1` sau smoke (read-only, không write).
  - Không secret trong response (scan JWT/`sbp_` pattern → rỗng).
  - Refresh home/admin không lỗi (200 ổn định).
- **Lưu ý quá trình deploy:** lần `vercel --yes` đầu tạo deployment `fe40xe6d3`/`agilgxtrk` bị kẹt ở trạng thái “Deployment is building” (instant-preview placeholder, status UNKNOWN — không build thật). Git integration của project đã tự build commit `d75c080` thành deployment **`bkhsacm4y` (● Ready)** có alias `git-50a406`. Deployment này có đầy đủ `runtime-admin.html` + các V3 API trả 401 đúng — được dùng làm preview smoke-test và sau đó promote lên production.

## 4. Production deploy (Phase 4)

- **Phương thức:** `vercel promote dpl_3bn5nVh1Baj5hcCdu44MuHaFtCg3 --yes` — promote **chính xác** preview deployment đã smoke-test PASS lên production (code-only; không tạo build mới).
- **Production deployment mới:** `dpl_6wRz6HA2RCwTAE7UhppPcLMAQ7aP` → `https://web-lms-chinh-thuc-hswpq4ilq.vercel.app`, status ● Ready, target Production, alias `www.daubepnho.store`.
- **Không gọi API switch. Không bật V2/V3. Không bật worker/live delivery ngoài cấu hình hiện tại.** `active_mode` DB giữ nguyên `v1`.

### Xác minh production (sau promote, `www.daubepnho.store`)

| Kiểm tra | Kết quả |
|---|---|
| Production chạy đúng commit V3 | ✅ `runtime-admin.html` có đầy đủ `setV1/setV2/setV3/rollbackV1/killOn/killOff/v2shadowOn/v3shadowOn` (marker `d75c080`) |
| Trang chính `/` | 200, title “Học Nấu Ăn Online…” (size ~96KB) |
| `/admin.html`, `/lms-admin.html` | 200 |
| `/runtime-admin.html`, `/v3-diagnostics.html` | 200 |
| `GET /api/v2/runtime` (no/wrong secret) | **401** |
| `GET /api/v2/readiness` | **401** JSON |
| `GET /api/v3/diagnostics` | **401** JSON (không 500) |
| `POST /api/v2/runtime` (no/wrong secret) | **401** (không write) |
| Runtime state đọc từ backend | ✅ UI fetch `/api/v2/runtime` → `platform_runtime_config` |
| `active_mode` | **v1** (DB unchanged, `updated_at` 2026-07-16 04:34 UTC) |
| V1 business path | `/api/lms/portal?endpoint=public-config` → 200; `/api/v3/lms/public-config` → 200 (delegates V1) |
| V2/V3 authoritative | **chưa bật** (v2_shadow=v3_shadow=false; audit 0 row) |
| Kill switch state | `false` (unchanged) |
| API 500 | không có (toàn bộ 200/401/400/404/405) |
| Secret leak trong response | không (scan JWT/`sbp_` → rỗng) |
| Deployment cũ rollbackable | ✅ `dpl_EcoXHDs2oSjPxfu2R3iLU78sJqCR` (xem §7) |

### DB confirmation (read-only, sau production deploy)

```
active_mode      = v1
kill_switch      = false
v2_shadow_mode   = false
v3_shadow_mode   = false
updated_by       = null
updated_at       = 2026-07-16 04:34:19 UTC   (unchanged — no flip occurred)
platform_runtime_config_audit rows = 0       (no flip audit; nothing switched)
```

## 5. Smoke-test result (production) — chi tiết

Thực hiện toàn bộ read-only trên `https://www.daubepnho.store`:

```
/                                        -> 200
/admin.html                              -> 200
/lms-admin.html                          -> 200
/runtime-admin.html                      -> 200
/v3-diagnostics.html                     -> 200
GET  /api/v2/runtime      (no secret)    -> 401
GET  /api/v2/runtime      (wrong secret) -> 401
GET  /api/v2/readiness    (no secret)    -> 401  {"ok":false,"error":"Unauthorized",...}
GET  /api/v3/diagnostics  (no secret)    -> 401  {"ok":false,"error":"Unauthorized"}
POST /api/v2/runtime      (no secret)    -> 401  (no write)
POST /api/v2/runtime      (wrong secret) -> 401  (no write)
GET  /api/lms/portal?endpoint=public-config -> 200   (V1 path intact)
GET  /api/v3/lms/public-config            -> 200   (V3 router delegates to V1)
```

- Không có 500 nào.
- Không secret trong bất kỳ response body nào.
- Không tạo dữ liệu học viên/đơn hàng thật (chỉ GET + POST-auth-gate thử).
- `active_mode` DB unchanged sau toàn bộ smoke.

## 6. `active_mode` & kill-switch state (sau deploy)

- `active_mode` = **`v1`** — V1 authoritative write path; V2/V3 write off.
- `kill_switch` = **`false`** — không ép; `active_mode=v1` đã an toàn.
- `v2_shadow_mode` = `v3_shadow_mode` = `false` — không shadow writes.
- Live delivery = off (outbox worker/delivery handlers theo env flag hiện tại; không trigger).
- `platform_runtime_config_audit`: 0 row — không có flip nào diễn ra trong phiên này.

## 7. Rollback deployment

- **Production hiện tại (V3 code, active_mode=v1):** `dpl_6wRz6HA2RCwTAE7UhppPcLMAQ7aP` (`https://web-lms-chinh-thuc-hswpq4ilq.vercel.app`) — alias `www.daubepnho.store`.
- **Production trước đó (rollback target):** `dpl_EcoXHDs2oSjPxfu2R3iLU78sJqCR` (`https://web-lms-chinh-thuc-c38luljrx.vercel.app`, ● Ready).
- **Cách rollback deployment (Vercel):**
  ```bash
  # Promote lại deployment cũ về production (code-only):
  vercel promote dpl_EcoXHDs2oSjPxfu2R3iLU78sJqCR --yes
  # hoặc qua Dashboard: deployments → chọn c38luljrx → "Promote to Production".
  ```
- **Lưu ý:** vì `active_mode` nằm trong DB (không trong code), rollback **deployment** không cần thiết để về V1 — chỉ cần flip `active_mode='v1'` (hoặc `kill_switch=true`) qua `runtime-admin.html`/`POST /api/v2/runtime`/SQL Editor, hiệu lực trong ~3s (cache TTL), **không redeploy**. Rollback deployment chỉ dùng khi cần quay lại code cũ (ví dụ code V3 có regression).

## 8. Vị trí trang admin + nút switch

- **Trang admin nghiệp vụ (V1, có sẵn):** `https://www.daubepnho.store/admin.html` (login Google + `ADMIN_EMAILS`).
- **Trang switch runtime V1/V2/V3 (MỚI):** `https://www.daubepnho.store/runtime-admin.html`
  - Nhập **worker secret** (`INTERNAL_SYNC_SECRET` / `V2_WORKER_SECRET`) → bấm **Load state**.
  - Thấy runtime state (active_mode, effective_mode, kill_switch, v2/v3 shadow, updated_at) + V2 readiness + V3 diagnostics.
  - **Nút switch:** `Set V1 active` / `Set V2 active` / `Set V3 active`, `Rollback → V1`, `Kill switch ON/OFF`, `V2 shadow ON/OFF`, `V3 shadow ON/OFF`.
  - Mỗi nút mở **confirm modal** — phải gõ mã xác nhận (vd `v2`, `v3`, `KILL`, `OFF`, `v3-on`…) mới gửi `POST /api/v2/runtime`.
  - UI chỉ cập nhật state **sau khi backend xác nhận**; secret chỉ đi trong header, không lưu storage, không log; không remote script.
- **Trang diagnostics V3 (chi tiết):** `https://www.daubepnho.store/v3-diagnostics.html` (cùng worker secret, read-only).

## 9. Việc duy nhất owner còn phải làm

Mở `https://www.daubepnho.store/runtime-admin.html`, nhập worker secret, bấm **Load state**, rồi dùng nút V1/V2/V3 (có confirm) để chuyển version khi sẵn sàng. **Không cần deploy lại** — flip có hiệu lực trong ~3s qua `platform_runtime_config`, mỗi flip được audit.

> Cảnh báo an toàn: chỉ flip khi đã đọc V2/V3 readiness trên cùng trang và đã có kế hoạch rollback (nút Rollback→V1 / Kill switch ON có sẵn ngay trên trang).

## 10. Repo changes đã commit + push

- Commit `d75c080` (branch `v3/research-20260715`), đã push `origin/v3/research-20260715`.
- Files: `runtime-admin.html` (mới), `tests/v3-runtime-admin-ui.test.mjs` (mới, 18 test).
- **Secret scan:** không có secret trong diff (scan JWT `eyJ…`/`sbp_…`/`SUPABASE_SERVICE_ROLE_KEY=`/`-----BEGIN` → sạch).
- **`git diff --check`:** không conflict/whitespace error (chỉ warning LF→CRLF do Windows).
- Không merge `main`. Không thay đổi secret. Không xóa deployment cũ.

## 11. Invariants giữ nguyên

- `active_mode` = `v1` (không đổi).
- Không bật V2/V3 authoritative write.
- Không bật live delivery ngoài cấu hình hiện tại.
- Không tắt kill switch (kill_switch vẫn false như trước).
- Không merge main.
- Không xóa production deployment cũ (còn `dpl_EcoXHDs2oSjPxfu2R3iLU78sJqCR` để rollback).
- Không in/cat secret.
- Smoke test không tạo dữ liệu học viên/đơn hàng thật.
- Không thao tác nhầm Vercel project (chỉ `web-lms-chinh-thuc`).
