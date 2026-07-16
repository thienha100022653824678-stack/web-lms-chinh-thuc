# Báo cáo tổng quan hệ thống — 4 thành phần web

> Tài liệu kỹ thuật dành cho bên thứ 3 nghiên cứu phương án nâng cấp khả thi.
> Mục tiêu: cho phép chuyển đổi an toàn giữa hệ thống hiện tại (V1) và hệ thống mới (V2) bằng một nút switch, áp dụng cho toàn bộ 4 thành phần.
>
> Ngày lập: 16/07/2026 · Người lập: Claude (đại diện đội phát triển) · Phiên bản tham chiếu: V2 trên LMS đã hoàn thành + đang chạy production.

---

## 0. Tóm tắt điều hành

Hệ thống học trực tuyến gồm **4 thành phần web độc lập**, mỗi thành phần là **một repo Git riêng + một project Vercel riêng + (phần lớn) một cơ sở dữ liệu Supabase riêng**. Chúng giao tiếp qua HTTP `/api/sync` (có shared secret) và qua redirect trình duyệt có kèm `entry_token`.

| # | Tên | Domain prod | Repo (GitHub) | Vercel project | Stack | DB Supabase | Có code V2 (switch)? |
|---|---|---|---|---|---|---|---|
| 1 | **LMS** | `www.daubepnho.store` | `web-lms-chinh-thuc` | `web-lms-chinh-thuc` | HTML tĩnh + Vercel Functions (Node 24, ESM) | B (`aqozjkfwzmyfunqvcyjv`) | ✅ **Có, đã deploy prod** |
| 2 | **Shop** | `shop.yeunauan.live` | `web-ban-hang-chinh-thuc` | `web-ban-hang-chinh-thuc` | HTML tĩnh + Vercel Functions | B (cùng LMS) | ❌ Chỉ có flag scaffolding + outbox shadow, **không có switch/one-device** |
| 3 | **Portal (student-web)** | `www.yeunauan.live` | `tao-web-tra-bai-hoc-vien` | `student-web` | Next.js 16 App Router + React 19 + TS | A (`crphwjizolsgghapyjjv`) + đọc LMS DB | ❌ Có `v2-flags.ts` **nhưng dead code**; one-device đã hard-code RPC `block` (không qua switch) |
| 4 | **System1 admin (admin-web)** | `admin.yeunauan.live` | (subdir của `tao-web-tra-bai-hoc-vien`) | `admin-web-tra-bai` | Next.js 16 + React 19 + TS | A (cùng Portal) | ❌ **Hoàn toàn không có** |

**Trạng thái V2 hiện nay:** chỉ LMS có switch V1/V2 hoạt động (DB-backed `site_config`, admin UI tab "Hệ Thống", master gate restrict-only, 201/201 test pass, đã lên prod `g3zpdnz10`→`hjrfs6z82`). 3 thành phần còn lại **chưa có switch** — việc "nâng cấp V2 toàn bộ" thực chất là **viết code V2 vào 3 repo kia**, không phải một lệnh deploy.

**⚠️ Lưu ý quan trọng cho bên thứ 3:**
- **2 cơ sở dữ liệu Supabase khác nhau** (A cho Portal+Admin, B cho LMS+Shop) — switch dùng `site_config` của LMS (DB B) sẽ **không** tự áp dụng cho Portal/Admin (DB A) nếu không đồng bộ.
- **Auth admin yếu** ở Shop (password plaintext lưu `sessionStorage`, gửi header `X-Admin-Password`) và System1 admin (password đơn `ADMIN_PASSWORD`, mặc định `admin123`). LMS và Portal dùng Google OAuth + HMAC session tốt hơn.
- **Shop có lỗ hổng `?leak=extract_env_vars_now`** trong `api/check-auth.js` (dump toàn bộ env var ra response, không auth) — cần xử lý trước khi làm gì với Shop.
- **One-device hiện dở:** chặn diễn ra ở 2 nơi tách biệt — Portal hard-code RPC `block` lúc login, LMS gate qua switch lúc truy cập nội dung. Chưa đồng bộ qua 1 switch chung.

---

## 1. Kiến trúc tổng thể & dòng dữ liệu

```
        ┌──────────────┐   redirect trình duyệt (#entry_token)   ┌──────────────────┐
        │   PORTAL     │ ───────────────────────────────────────▶ │      LMS         │
        │ www.yeunauan │   + đọc thẳng LMS Supabase (B)           │ www.daubepnho    │
        │ student-web  │                                          │ web-lms-chinh-thuc│
        │ Next.js 16   │                                          │ HTML+Functions   │
        └──────┬───────┘                                          └────────▲─────────┘
               │ DB A (crphwjizolsgghapyjjv)                               │ DB B (aqozjkfwzmyfunqvcyjv)
               │ posts, post_views, student_enrollments                   │ courses, orders, lessons,
               │                                                           │ sync_outbox, session-guard tables
        ┌──────┴─────────────────────┐                          ┌──────────┴──────────┐
        │   SYSTEM1 ADMIN            │  POST /api/sync ◀──────  │        SHOP          │
        │ admin.yeunauan.live        │  (syncCourse/Enrollment) │  shop.yeunauan.live  │
        │ admin-web (Next.js 16)     │  ◀── từ Shop & LMS       │  web-ban-hang-chinh-thuc│
        │ quản trị posts/enrollments │                          │  HTML+Functions      │
        └────────────────────────────┘                          └──────────────────────┘
```

**Dòng chính:**
1. Học viên mua khóa ở **Shop** (`?course=banhmicamsicula`) → upload bill → Shop tạo `orders`.
2. Admin duyệt ở Shop → Shop gọi `POST /api/sync` tới **Portal (System1)** và **LMS (System3)** với header `X-Sync-Secret` (`INTERNAL_SYNC_SECRET`) → tạo `student_enrollments` + `posts`.
3. Học viên đăng nhập Google ở **Portal** → Portal kiểm enrollment ở cả DB A và DB B → tạo `entry_token` (gọi RPC `handle_student_session_login` policy `block`) → **redirect trình duyệt** sang `www.daubepnho.store/lms.html#entry_token=...`.
4. LMS verify entry token → tạo `lms_verified_sessions` → học viên xem bài giảng qua header `X-LMS-Session-Id`/`X-LMS-Device-Id`.

**Supabase:**
- **DB A** (`crphwjizolsgghapyjjv`): Portal + System1 admin. Tables: `posts`, `post_views`, `student_enrollments`, `gated_posts_access`, storage `post-images`.
- **DB B** (`aqozjkfwzmyfunqvcyjv`): LMS + Shop. Tables: `courses`, `orders`, `lessons`, `student_enrollments`, `site_config`, `sync_outbox`/`sync_deliveries`/`sync_dead_letters`, `course_slug_mappings`, `portal_post_course_mappings`, và toàn bộ session-guard (`student_active_sessions`, `lms_verified_sessions`, `lms_entry_tokens`, `student_session_controls`, `student_device_change_logs`, `admin_audit_logs`, `student_account_risk_reviews`, `student_account_admin_notes`).

---

## 2. Chi tiết từng thành phần

### 2.1. LMS — `www.daubepnho.store` (THÀNH PHẦN ĐÃ CÓ V2)

- **Repo:** `C:/Users/gaomi/.../web-lms-chinh-thuc`, GitHub `thienha100022653824678-stack/web-lms-chinh-thuc`, branch `v2/rebuild-20260715` @ `0ef81b8`. Vercel project `prj_TimQqrVhrOLW8y1KI464JBvajwlz`. Prod alias hiện `hjrfs6z82` (deploy 16/07 18:38).
- **Stack:** HTML tĩnh (`lms.html`, `lesson.html`, `admin.html`, `lms-admin.html`, `photo.html`, `index.html`) + Vercel Serverless Functions (`api/lms/*`, `api/v2/*`, `api/sync.js`). ESM, Node 24. Deps: `@supabase/supabase-js`, `cloudinary`, `google-auth-library`, `googleapis`. Không build step.
- **DB:** Supabase B. Service role client (`utils/supabase.js`).
- **Auth:** Google OAuth cho admin (`createAdminSession` HMAC, cookie `admin_session_token`, `ADMIN_EMAILS`); cookie JWT `course_session_token` cho học viên (V1, 30 ngày).
- **V2 đã có (commit `7f0c0b2` + `ccea09e` + `f10c1f7`):**
  - `utils/v2-runtime-controller.js` + `utils/v2-runtime-cache.js`: master gate restrict-only, đọc `site_config` (keys `v2_active_mode`/`v2_kill_switch`), fail-closed v1, env override `V2_RUNTIME_FORCE_MODE/KILL`.
  - `utils/v2-flags.js`: mọi flag V2 (`isV2FlagEnabled`, `isV2GlobalOneDeviceEnabled`, `isV2CorsAllowlistEnabled`) qua gate `isV2ActiveCached()`. `isV2FlagConfigured()` = read raw cho diagnostics.
  - `utils/lms-handlers/admin-runtime-mode.js` + `api/lms/admin.js?endpoint=runtime-mode`: GET trạng thái, POST `set_mode`/`set_kill_switch` + audit log.
  - `admin.html` tab "⚙️ Hệ Thống": switch V1/V2, kill switch, flag grid.
  - Routers (`api/lms/portal.js`, `admin.js`, `sync.js`) `await warmRuntimeConfig()`.
  - Tính năng V2: one-device (RP2-B1), server logout (RP2-B2), admin revoke polish (RP2-B3), outbox shadow + projection + worker + reconciliation + diagnostics + readiness.
  - Test: 201/201 (RP-1 48, RP2-A 29, RP2-B1 59, RP2-B2 11, RP2-B3 11, v2-readiness 6, v2-outbox-shadow 7, v2-runtime-controller 18, v2-runtime-mode-endpoint 12).
  - Tài liệu: `docs/v2/V2_USER_GUIDE_SWITCH.{md,html}`, `docs/v2/V2_BAO_CAO_CAI_TIEN.{md,html}`, `docs/v2/V2_PRODUCTION_CANARY_PLAN.md`, `V2_CUTOVER_RUNBOOK.md`, `V2_ROLLBACK_RUNBOOK.md`.
- **Migrate strategy đã áp dụng (pattern nên áp dụng cho 3 repo còn lại):** branch tích hợp `v2/rebuild-20260715` (gộp 2 lineage V2), slice feature branch merge ngược, flag-off = V1 nguyên vẹn, switch restrict-only (chỉ hạn chế V2, không tự bật), fail-closed, không migration destructive.

### 2.2. Shop — `shop.yeunauan.live` (CHƯA CÓ V2 THẬT)

- **Repo:** `C:/Users/gaomi/.../git-repo`, GitHub `thienha100022653824678-stack/web-ban-hang-chinh-thuc`, branch `v2/platform-rebuild` @ `62880be`, working tree clean. Vercel project `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`. Prod alias `lmrc8k4wc` (deploy 11/07).
- **Stack:** HTML tĩnh (`index.html`, `admin.html`, `orders.html`) + Vercel Functions (`api/config.js`, `register.js`, `courses.js`, `orders.js`, `approve-all.js`, `upload.js`, `check-auth.js`). ESM Node 24, không build. Deps: `@supabase/supabase-js`, `cloudinary`.
- **DB:** Supabase B (cùng LMS). Tables: `courses`, `orders`, `sync_outbox` (shadow).
- **Auth:** **YẾU** — password đơn `ADMIN_PASSWORD`, lưu plaintext trong `sessionStorage`, gửi header `X-Admin-Password` mỗi request. Không JWT/cookie httpOnly. Env `GOOGLE_CLIENT_ID/SECRET` có nhưng **chưa wire** OAuth.
- **V2 hiện có (scaffolding only):** `utils/v2-flags.js` (flag helpers `V2_PLATFORM_ENABLED`, `V2_OUTBOX_SHADOW_MODE`, `V2_DRIVE_WORKER_DRY_RUN`, `V2_RECONCILIATION_READONLY`, `V2_RUNTIME_MODE`), `utils/v2-outbox.js` (shadow write `sync_outbox` khi flag on, fail-open). `docs/V2_ROLLOUT.md`. **Không có:** runtime-controller, switch, admin endpoint runtime-mode, one-device.
- **Coupling:** Shop = **source** sync. Gọi `POST /api/sync` tới `SYSTEM1_URL` (Portal) + `SYSTEM3_URL` (LMS) với `X-Sync-Secret`. Redirect học viên về `yeunauan.live/my-courses` sau checkout.
- **⚠️ Lỗ hổng bảo mật (ưu tiên xử lý):** `api/check-auth.js` có nhánh `GET ?leak=extract_env_vars_now` dump **toàn bộ env var** (gồm `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `INTERNAL_SYNC_SECRET`) ra response **không auth**. Đang nằm trên branch V2.

### 2.3. Portal — `www.yeunauan.live` (THÀNH PHẦN QUAN TRỌNG NHẤT CÒN THIẾU V2)

- **Repo:** `C:/Users/gaomi/.../yeubep-shop/student-web`, GitHub `thienha100022653824678-stack/tao-web-tra-bai-hoc-vien`, branch `v2/platform-rebuild` @ `d2a903c`, clean. Vercel project `prj_paRRXhaTAqF6NnqbZBK6HsZP4zm3`. Prod alias `og3r0oq3v` (13/07).
- **Stack:** Next.js **16.2.9** App Router + React 19.2.4 + TypeScript (strict) + Tailwind v4. `next build`. ⚠️ Next 16 là phiên bản breaking-changes (AGENTS.md cảnh báo).
- **Routes:** `/` (login Google), `/my-courses` (dashboard), `/post/[id]` (nội dung bài). API: `auth/login`, `auth/logout`, `lms-entry-token`, `sync` (inbound), `my-courses`, `posts/[id]/view`.
- **DB:** Supabase A (anon + service role) **+ đọc/ghi trực tiếp Supabase B (LMS)** qua `lmsSupabaseAdmin` (`LMS_SUPABASE_URL`/`LMS_SUPABASE_SERVICE_ROLE_KEY`). RPC `handle_student_session_login` (policy `block`), `record_view`.
- **Auth:** Google OAuth ID-token → HMAC session token (`src/lib/session.ts`, cookie httpOnly `course_session_token` 30 ngày, secret `SESSION_SECRET`). Admin bypass qua `admin-session` cookie (sha256 `ADMIN_PASSWORD`) + `ADMIN_EMAILS`.
- **One-device ĐÃ CÓ nhưng KHÔNG QUA SWITCH:** `src/lib/session-guard.ts` gọi RPC `handle_student_session_login` với `p_conflict_policy: 'block'` → HTTP 409 khi 2 thiết bị. **Hard-code, không flag, không switch.** `ensureStudentSessionCompat` (reuse) tồn tại nhưng không dùng.
- **V2 scaffolding dead code:** `src/lib/v2-flags.ts` (`V2_PLATFORM_ENABLED`, `V2_SESSION_LEASE_ENABLED`, `V2_ENTRY_TOKEN_REQUIRED`, `V2_RISK_SCORING_ENABLED`, `V2_RUNTIME_MODE`) — **không import ở đâu**.
- **Coupling:** redirect học viên sang `https://www.daubepnho.store/lms.html#entry_token=...` (hard-code `LMS_ENTRY_BASE_URL`). Đọc `course-data`/`public-lesson` từ LMS web. Nhận `/api/sync` từ Shop/LMS.
- **⚠️ Đây là mảnh V2 quan trọng nhất còn dở:** chính sách one-device hiện chặn ở Portal (login) hard-code, còn LMS chặn qua switch (truy cập). Để có **một switch chung**, cần port `runtime-controller` sang Portal và gate hành vi one-device của Portal qua switch đó.

### 2.4. System1 admin — `admin.yeunauan.live` (KHÔNG LIÊN QUAN V2)

- **Repo:** `C:/Users/gaomi/.../yeubep-shop/admin-web` — **không phải git repo riêng**, là subdir của repo `tao-web-tra-bai-hoc-vien` (cùng Portal), branch `v2/platform-rebuild` @ `d2a903c`. Vercel project `admin-web-tra-bai`. Prod alias `kgn32sn1k` (13/07).
- **Stack:** Next.js 16.2.9 + React 19 + TS + Tailwind v4 + `xlsx` (import Excel). `next build`.
- **Routes:** `/login` (password), `/` (dashboard posts), `/new`, `/edit/[id]`, `/import`. API: `auth/login`, `auth/logout`, `posts`, `posts/[id]`, `posts/import`, `upload`, `sync` (inbound).
- **DB:** Supabase A (cùng Portal). Tables: `posts`, `post_views`, `student_enrollments`, storage `post-images`.
- **Auth:** **YẾU** — password đơn `ADMIN_PASSWORD` (mặc định `'admin123'`), cookie `admin-session` = sha256(password), `src/middleware.ts` gate tất cả route. Không OAuth, không `ADMIN_EMAILS`.
- **V2:** **Hoàn toàn không có** — grep 0 hit cho mọi token V2.
- **Coupling:** nhận `POST /api/sync` từ Shop/LMS (`x-sync-secret`), exempt middleware. Sinh link học viên `${NEXT_PUBLIC_STUDENT_APP_URL}/post/[id]` (fallback hard-code `www.yeunauan.live`).
- **Ý nghĩa "V2" cho admin này:** gần như không rõ — nó chỉ quản trị nội dung bài viết + duyệt enrollment. One-device/sync không áp dụng. Switch V1/V2 tại đây sẽ **trống rỗng** (không có hành vi V2 nào để bật/tắt) trừ khi định nghĩa V2 = "giao diện admin mới" hoặc "auth mạnh hơn".

---

## 3. Ma trận tính năng V2 theo thành phần

| Tính năng V2 | LMS | Shop | Portal | System1 admin |
|---|---|---|---|---|
| Runtime switch V1/V2 (DB-backed) | ✅ có | ❌ | ❌ | ❌ |
| Master gate restrict-only | ✅ có | ❌ | ❌ | ❌ |
| One-device (1 Gmail 1 phiên) | ✅ qua switch (RP2-B1) | ❌ | ✅ hard-code RPC `block` (không switch) | N/A |
| Server-side logout | ✅ (RP2-B2) | ❌ | ✅ (`auth/logout` gọi markStudentSessionLoggedOut) | N/A |
| Admin revoke polish | ✅ (RP2-B3) | ❌ | N/A | N/A |
| Outbox shadow + worker + delivery | ✅ | ✅ shadow only (scaffolding) | ❌ | ❌ |
| Reconciliation + diagnostics + readiness | ✅ | ❌ | ❌ | ❌ |
| CORS allowlist | ✅ (RP2-A) | ❌ | ❌ | ❌ |
| Auth mạnh (Google OAuth + HMAC) | ✅ | ❌ (password plaintext) | ✅ | ❌ (password đơn) |
| Test suite | ✅ 201/201 | ❌ (0 test) | ❌ (0 test) | ❌ (0 test) |

---

## 4. Khoảng cách cần lấp đầy để "nâng cấp V2 toàn bộ 4 repo + 1 switch chung"

### 4.1. Yêu cầu cốt lõi từ chủ hệ thống
> "Một nút switch chuyển V1 ↔ V2 cho toàn bộ 4 web, an toàn, rollback ngay, không mất dữ liệu."

### 4.2. Thách thức kiến trúc

1. **2 cơ sở dữ liệu khác nhau.** Switch LMS đọc `site_config` ở DB B. Portal/System1 admin dùng DB A. Một switch "toàn hệ thống" cần:
   - **Phương án A (đơn giản):** switch ở DB B (LMS) là nguồn sự thật; Portal/Admin đọc cùng `site_config` qua service-role client đã có (`lmsSupabaseAdmin`). Vì Portal **đã** kết nối DB B → khả thi, chỉ cần thêm controller đọc `site_config`.
   - **Phương án B (trung lập):** tạo bảng `platform_runtime_config` chung (như V3 đã thiết kế) hoặc dùng GitHub env/Vercel env làm nguồn sự thật. Phức tạp hơn.
   - **Khuyến nghị:** Phương án A — tái dụng `site_config` DB B, controller tương tự LMS, mỗi repo có cache riêng.

2. **"V2" có nghĩa khác nhau giữa các thành phần.**
   - LMS: one-device + sync V2 + logout + revoke.
   - Portal: one-device (đã hard-code, cần đưa qua switch) + (tuỳ chọn) sync nhận V2.
   - Shop: outbox shadow (đã có scaffolding) + (tuỳ chọn) auth mạnh.
   - System1 admin: gần như không có "V2" rõ ràng. Có thể định nghĩa = "chỉ nhận sync khi V2 on" hoặc giữ nguyên (V1 = V2).
   - **Khuyến nghị:** định nghĩa rõ scope V2 từng repo trước khi code; với admin, có thể V2 = không đổi (switch vẫn hiện nhưng không bật tắt gì).

3. **Restrict-only gate fail-open trên cold cache** phải giữ nguyên pattern để V1 + test không đổi — đã chứng minh ở LMS.

4. **Auth yếu ở Shop/System1 admin** là rủi ro vận hành, nên đưa vào scope "nâng cấp" (ít nhất sửa leak endpoint, nâng password).

5. **Test:** Shop/Portal/Admin hiện **0 test**. Nâng cấp mà không có test = rủi ro cao. Cần dựng test infra tối thiểu cho mỗi repo (theo pattern `node --test` của LMS, hoặc vitest cho Next.js).

6. **Next.js 16 breaking changes** ở Portal/Admin — bên thứ 3 cần đọc docs Next 16 trước khi code.

### 4.3. Phương án kỹ thuật đề xuất (theo từng repo, tuần tự)

**Bước chuẩn bị chung:**
- Chốt nguồn sự thật switch = `site_config` DB B (key `v2_active_mode`, `v2_kill_switch`) — đã có data từ LMS.
- Mỗi repo nhận bản port của `v2-runtime-controller` + `v2-runtime-cache` (adjust theo stack: TS cho Portal/Admin, JS cho Shop).

**Repo 1 — Portal (`student-web`) [ưu tiên cao nhất]:**
- Port `runtime-controller` sang TS, đọc `site_config` DB B qua `lmsSupabaseAdmin`.
- Gate `ensureStudentSessionAtomic` (one-device RPC `block`) qua switch → khi switch=v1, Portal **không chặn** (V1 behavior = reuse/compat). Khi switch=v2 + flag → chặn.
- Thêm admin endpoint `runtime-mode` + UI switch (Portal hiện không có admin UI chung → có thể tái dụng trang admin LMS hoặc tạo nhỏ).
- Test (vitest) cho gate + endpoint.
- Dry-run: switch=v2 nhưng flag one-device off → Portal chạy V1 behavior; flag on → chặn.

**Repo 2 — Shop (`git-repo`):**
- **Trước tiên sửa `?leak=extract_env_vars_now`** (xóa nhánh leak).
- Port `runtime-controller` JS (gần như copy từ LMS vì cùng stack HTML+Functions).
- Gate outbox shadow + sync outbound qua switch (V1 = sync trực tiếp như cũ; V2 = sync qua outbox/projection khi flag on).
- (Tuỳ chọn) nâng auth admin lên Google OAuth + HMAC như LMS.
- Test theo pattern LMS.

**Repo 3 — System1 admin (`admin-web`):**
- Định nghĩa V2: tối thiểu = "chỉ nhận `/api/sync` action mới khi V2 on" hoặc giữ nguyên.
- Port switch (TS) nếu muốn UI switch nhất quán; nếu V2 không đổi gì thì **bỏ qua repo này** để giảm rủi ro.
- Sửa `ADMIN_PASSWORD` default `admin123` + mạnh hóa auth.

**Repo 4 — LMS:** đã xong, chỉ cần đảm bảo switch đọc/ghi DB B (đã có) là nguồn sự thật chung.

**Switch chung:** tất cả repo đều đọc cùng `site_config` DB B → flip 1 lần trên LMS admin → các repo khác pick up trong TTL cache (5s). Có thể giảm TTL hoặc thêm webhook refresh nếu cần tức thì.

### 4.4. Rủi ro & khuyến nghị an toàn
- **Không deploy đồng loạt 4 production.** Làm tuần tự, mỗi repo: branch → test → preview → verify → prod. Giữ V1 rollback nóng.
- **Portal là rủi ro cao nhất** vì nó là cửa login của học viên + Next 16 + 0 test. Cần đầu tư test kỹ.
- **Shop leak endpoint** phải sửa trước bất kỳ deploy nào.
- **Migration:** ưu tiên zero-migration (dùng `site_config` đã có). Nếu cần bảng riêng, additive-only, không drop V1.
- **Quan sát:** sau khi có switch chung, thêm endpoint `/api/v2/diagnostics` ở mỗi repo báo mode + flag posture (LMS đã có template).
- **Rollback:** switch=v1 là rollback tức thì toàn hệ thống (nếu tất cả repo gate qua switch). Đó là lợi ích lớn nhất của phương án này.

### 4.5. Ước lượng phạm vi (để bên thứ 3 định giá)
- Portal: **lớn** (port controller TS + gate one-device + admin UI + test + Next 16). Ước vài ngày làm việc.
- Shop: **vừa** (sửa leak + port controller JS + gate sync + test). ~1-2 ngày.
- System1 admin: **nhỏ hoặc bỏ qua** (tuỳ định nghĩa V2). <1 ngày nếu làm, 0 nếu bỏ.
- LMS: **đã xong**, chỉ tinh chỉnh nguồn sự thật chung.
- Test infra cho 3 repo chưa có: cộng thêm thời gian dựng.

---

## 5. Tài liệu tham chiếu (có sẵn trong repo LMS `docs/`)
- `docs/v2/V2_USER_GUIDE_SWITCH.md/html` — hướng dẫn dùng switch cho người cơ bản.
- `docs/v2/V2_BAO_CAO_CAI_TIEN.md/html` — báo cáo cải tiến V2 cho đối tác.
- `docs/v2/V2_PRODUCTION_CANARY_PLAN.md` — kế hoạch canary production.
- `docs/v2/V2_CUTOVER_RUNBOOK.md` — thứ tự flip flag khi owner duyệt.
- `docs/v2/V2_ROLLBACK_RUNBOOK.md` — 3 drill rollback.
- `docs/v2/V2_IMPLEMENTATION_STATUS.md` — trạng thái triển khai chi tiết.
- `docs/superpowers/specs/2026-07-15-v2-canary-ready-design.md` + `plans/2026-07-15-v2-canary-ready.md` — spec + plan V2 canary-ready.
- Repo Portal: `docs/V2_ROLLOUT.md` + `AGENTS.md` (lưu ý Next 16).
- Repo Shop: `docs/V2_ROLLOUT.md`.

---

## 6. Câu hỏi mở cho bên thứ 3 + chủ hệ thống chốt trước khi nâng cấp
1. Nguồn sự thật switch: tái dụng `site_config` DB B (A) hay tách bảng/v env trung lập (B)?
2. "V2" của System1 admin nghĩa là gì? Có bỏ qua repo này không?
3. Có nâng auth Shop/System1 admin lên Google OAuth trong đợt này không, hay tách phase riêng?
4. TTL cache switch chung: 5s (như LMS) có đủ, hay cần refresh tức thì qua webhook?
5. Thứ tự triển khai: Portal trước (lợi ích one-device cao nhất) hay Shop trước (rủi ro leak cần sửa gấp)?
6. Có cần một trang admin trung tâm điều khiển switch cho cả 4 repo (thay vì 4 switch rời) không?

---

*Tài liệu này không chứa giá trị secret/token/API key nào — chỉ tên biến env, project ref Supabase (không nhạy cảm), SHA commit, branch. An toàn chia sẻ cho bên thứ 3.*
