# System Knowledge & Architecture Transfer — V1 → V2 → V3

> Tài liệu bàn giao kỹ thuật dành cho AI Agent tiếp theo (nhánh nghiên cứu V3).
> Mục tiêu: nắm bắt dự án **không cần scan lại codebase**, tập trung bản chất kỹ thuật.
> Ngày viết: 2026-07-15. Repo hiện tại: `web-lms-chinh-thuc`, branch `v2/rebuild-20260715`.
> Source of truth tuyệt đối: **mã nguồn V1 `f9220e8` (tag `v1-stable-20260713`)** + mã nguồn V2 trên branch hiện hành.
> Quy ước: số dòngfile có thể trôi theo thời gian — **dựa vào tên symbol/route/bảng**, không dựa vào số dòng.

---

## 0. Đọc nhanh (TL;DR cho V3)

- Hệ thống = **3 repo tách biệt** (Shop, Student Portal, LMS) + **2 Supabase** (B = runtime LMS/Checkout, A = legacy portal posts). **Repo này là LMS** (`www.daubepnho.store`).
- LMS = **static HTML + Vercel serverless ESM**, không framework FE, không build step. Router monolith `?endpoint=` dispatch tới các handler trong `utils/lms-handlers/*`.
- V1 có **12 invariant tuyệt đối không được phá** (xem §1.6) và một loạt **P0/P1 pitfalls** (xem §2.1).
- V2 (đang làm) khắc phục bằng: **outbox + identity mapping** (reliability), **lms-secrets.js fail-closed** (auth), **cors.js allowlist** (CORS), **V2_GLOBAL_ONE_DEVICE_ENABLED** (one-device toàn hệ), **server-side logout + admin revoke polish**, **feature flag + expand-only migration + canary/rollback drill**.
- Trạng thái V2: branch `v2/rebuild-20260715` đã merge 2 lineage (platform-rebuild + security RP); **S0–S2 xong** (base, logout, revoke polish); **S3 (sync verify) + S4 (canary readiness) chờ owner apply migration + drill**. **V1 production chưa đụng**.
- V3 nên đột phá ở: **(1) RLS + phân quyền key thay service-role toàn cục**, **(2) outbox làm xương sống integration (event sourcing/CQRS)**, **(3) migration tool thật + CI schema-drift gate**, **(4) gộp 2 lớp session thành 1**, **(5) device-id do server cấp**, **(6) tách router monolith + edge runtime**, **(7) worker nền thật**, **(8) FE modular/SPA + dashboard**, **(9) observability có cấu trúc**, **(10) TS + monorepo + shared event schema**. Chi tiết §3.

---

## 1. Tổng quan hệ thống hiện tại (V1)

### 1.1 Mô hình 3 khối + 2 Supabase

```
Shop (shop.yeunauan.live, repo ngoài "git-repo")
   tạo course/order, duyệt đơn, sync outbound
        │  POST /api/sync (X-Sync-Secret) ──▶ Supabase B
        ▼
Student Portal (www.yeunauan.live, repo "student-web", Next.js)
   Google login, /my-courses, /post/[id],
   tạo entry_token, one-device enforcement (RPC handle_student_session_login),
   logout server-side (markStudentSessionLoggedOut)
        │  redirect lms.html?entry_token= / #entry_token=
        ▼
LMS (www.daubepnho.store — REPO NÀY, web-lms-chinh-thuc)
   Static HTML (lms/lesson/index/photo/gdrive-player/admin/lms-admin)
   + Vercel serverless ESM: api/lms/portal.js, api/lms/admin.js, api/sync.js
   utils/lms.js, utils/lms-session-guard.js, utils/lms-media.js, utils/lms-handlers/*
        │            │              │              │
   Supabase B    Google Drive   Google Docs    Bunny Stream
   (service role) v3 (pool+SA)   v1 (recipe)    (HMAC token 600s)
```

- **Supabase B** = runtime của repo này (project ref `aqozjkfwzmyfunqvcyjv` — chỉ thấy trong handover/env, không hardcode trong code). **Supabase A** = portal cũ (`posts`/`post_views`) — ngoài repo, **chưa xác minh runtime**.
- **System1** = hệ ngoài nhận `syncRecipe` khi LMS admin đăng bài (`admin-lessons.js`, env `SYSTEM1_URL`).
- Portal dùng `lmsSupabaseAdmin` (service-role key LMS) để **ghi trực tiếp Supabase B** (tạo entry token, logout) — không qua API LMS.
- `package.json`: `@supabase/supabase-js`, `cloudinary` (**dead dependency, 0 import**), `google-auth-library`, `googleapis`. `"type":"module"`, không có `scripts`, không test framework.
- `vercel.json`: chỉ set `Cache-Control: no-cache` toàn site.

### 1.2 Cấu trúc thư mục + vai trò file cốt lõi

| Đường dẫn | Vai trò |
|---|---|
| `api/lms/portal.js` | Router student `?endpoint=`: `course-data`, `lesson`, `public-config`, `public-lesson`, `verify-entry-token`, (V2) `logout`. |
| `api/lms/admin.js` | Router admin (bodyParser **500mb**): `auth`, `drive-auth/status`, `courses`, `lessons`, `students`, `enrollments`, `upload-image/recipe/gdrive-video/material`, `bulk-enroll`, `sync-drive-permissions`, `repair-drive`, `drive-permission/health/retry`, `verify-media`, `student-trace`, `account-sharing-alerts`. |
| `api/sync.js` | Internal server-to-server, gate `X-Sync-Secret == INTERNAL_SYNC_SECRET`. 3 action: `syncCourse`, `syncEnrollment`, `revokeEnrollment`. |
| `api/v2/*` | (V2) `outbox`, `reconciliation`, `readiness`, `sync-worker`, `diagnostics`, `portal-projection-preview`. |
| `utils/lms.js` | **Core**: `normalizeEmail` (trim+lowercase), `createStudentSession`/`verifyStudentSession` (JWT cookie `course_session_token`), `createAdminSession`/`verifyAdminSession`/`getAdminFromRequest`, `verifyGoogleIdToken`, `cookieOptions`, `signBunnyEmbedUrl`/`signMediaUrls` (HMAC 600s), `syncEnrollment`/`autoEnroll`, Drive helpers (`getGoogleDriveClient`, `addDriveFolderPermission`, `getOrCreateFolder`, `resolveCourseFolderTree`), `syncGoogleDrivePermission`, `writeDriveLog`, `addToDriveSyncQueue`, Drive admin pool (`getDriveAdminEnvAccounts`). |
| `utils/lms-session-guard.js` | **Session/entry-token/risk**: status enums, `hashToken`/`hashOptionalValue` (HMAC, fallback SHA-256), `logStudentDeviceEvent` (idempotency key, hash ip/device, **raw user_agent**), `writeAdminAuditLog`, `createStudentActiveSession`, `markStudentSessionLoggedOut`, `resetStudentSessionByEmail` (→ RPC `reset_student_session_guard`), `createLmsEntryToken` (hash-only), `verifyLmsEntryToken`/`markLmsEntryTokenUsed`, `createLmsVerifiedSession`, `verifyLmsVerifiedSessionAccess` (device match + idle + enrollment), `isEntryTokenRequiredCourse` (ENV gate), `mapLmsAccessReasonToError`/`httpStatusForLmsAccessError`, risk points (`LOGIN_BLOCKED_OTHER_DEVICE=25`, `ENTRY_TOKEN_REJECTED=10`, `LMS_SESSION_REJECTED=10`, `LOGOUT=4`; ngưỡng ≥80 high / ≥45 suspicious / ≥20 watch). |
| `utils/lms-secrets.js` | **(V2 RP-1)** fail-closed secret, `AuthSecretError` (không lộ giá trị), `signSessionPayload`/`verifySessionToken` (HMAC-SHA256, `timingSafeEqual`), `timingSafeStringEqual`, `getInternalSyncSecret`, `assertAuthSecretsConfigured`, local bypass `LMS_RP1_ALLOW_INSECURE_LOCAL=1`. |
| `utils/cors.js` | **(V2 RP2-A)** `applyCors(req,res,{mode})` — mode `admin`/`portal`/`internal`/`public`, allowlist `LMS_ADMIN_ORIGINS`/`LMS_PORTAL_ORIGINS`, preview suffix, fail-closed, **không bao giờ** `credentials:true` + wildcard. |
| `utils/v2-flags.js` | **(V2)** enum `V2_FLAGS` + `getV2Env`/`isV2FlagEnabled`/`getV2ListFlag`/`getV2RuntimeMode` (platform) ∪ `parseBooleanFlag`/`isV2CorsAllowlistEnabled`/`isV2GlobalOneDeviceEnabled` (security, strict parser). |
| `utils/v2-outbox.js` | **(V2)** `enqueueSyncOutboxEvent` (upsert on `idempotency_key`), `buildOutboxIdempotencyKey` (sha256 của `source:event:aggregate:updated_at`), `enqueueCoursePublishEvent`, `enqueueEnrollmentAccessEvent`. |
| `utils/v2-sync-worker.js` | **(V2)** worker: `listPendingOutboxEvents`, `claimOutboxEvent` (optimistic lock `status=pending→processing`, `locked_by`), `ensurePendingDelivery`, `markDeliveryResult`, `markOutboxDelivered`, `moveOutboxToDeadLetter`, `scheduleOutboxRetry` (exponential backoff `2^attempt`, max 60 phút, `max_attempts=10`), `runV2SyncWorker` (dry-run mặc định). Auth `x-v2-worker-secret` = `V2_WORKER_SECRET` hoặc `INTERNAL_SYNC_SECRET`. |
| `utils/v2-delivery-handlers.js` | **(V2)** `deliverV2Target({target})` — target `portal_projection`/`drive_permission`. |
| `utils/v2-readiness.js`/`v2-reconciliation.js`/`v2-diagnostics.js`/`v2-portal-projection.js`/`v2-outbox-inspector.js` | **(V2)** các endpoint observe/read-only, mask email + redact secret. |
| `utils/supabase.js` | **1 client service-role duy nhất**, `persistSession:false`, **bypass RLS toàn bộ** (SEC-09). Có test stub qua `LMS_RP2B1_SUPABASE_STUB=1` + `tests/_supabase_stub_loader.mjs`. |
| `utils/lms-media.js` | Classify media (MIME/extension/fallback) — video/ảnh. |
| `utils/lms-handlers/*` | Per-endpoint: `course-data`, `lesson`, `public-config`, `public-lesson` (ghi views **không auth** — SEC-03), `verify-entry-token`, `exchange-code` (**orphan, không route map** — bypass path), `logout` (V2), `admin-*` (auth, courses, lessons, students, enrollments, bulk-enroll, drive-auth/health/permission/retry/repair/sync, upload-*, verify-media, student-trace, account-sharing-alerts), `banhmi4k-lessons` (**dead code, 0 import**). |
| `supabase_schema.sql` | **"Kịch bản khởi tạo"** (có seed data) — không phải migration tool thật: `courses`, `orders`, `lessons`, `students`, `student_enrollments` (UNIQUE `email,course_slug`), `site_config`, `lesson_progress` (**0 code JS dùng — dead/để dành**). |
| `migration_*.sql` | `drive_sync`, `drive_admin_pool` (pool + `drive_permission_logs` + `drive_sync_queue`), `student_session_guard` (base session tables), `atomic_session_guard` (unique partial index + RPC `handle_student_session_login`), `account_sharing_alerts`/`p0_hardening`/`p1` (risk tables + RPC `reset_student_session_guard`/`cleanup_student_account_risk_events` + `student_session_controls` RLS), `v2_sync_outbox`, `v2_identity_mapping`, `handle_student_session_login_grants_hardening`. |
| `scripts/v2/*.sql` | `preflight-v2.sql`, `postflight-v2.sql`, `rollback-v2.sql` (additive-safe, phần destructive được comment). |
| `tests/*.test.mjs` | **(V2)** `rp1-auth-hardening` (48), `rp2-cors` (29), `rp2b1-session-device`, `rp2b2-logout` (9), `rp2b3-revoke`. Dùng `node --test` (không framework). |
| `review-dossier-v1/`, `review-dossier-session-guard/`, `handover/`, `docs/v2/`, `docs/v2-new/`, `scratch/` | Audit docs + handover + runbooks. `scratch/` + `review-dossier-*` **không commit** (gitignore). |

### 1.3 Database schema — các bảng và vai trò

**Bán hàng / cấp quyền (Supabase B — canonical):**
- `courses` (slug UNIQUE, title, raw_data) — *cột `expected_start_date`/`is_published` dùng trong code nhưng KHÔNG có trong `.sql` repo (schema drift).*
- `orders` (course_slug, customer_email, status, source) — *cột `sync_lms_status`/`sync_portal_status`/`sync_error` do phía A/Portal quản lý, không có code JS ghi.*
- `students` (email UNIQUE, full_name, phone, status).
- `student_enrollments` (UNIQUE `email,course_slug`, `status`, `source_order_id` → orders, `expired_at`). **Idempotency cốt lõi.**
- `lessons` (course_slug, lesson_no, title, media_urls, photo_url, document_url, recipe_url, views). *`is_section`/`materials` dùng trong code nhưng KHÔNG có schema — có fallback retry bỏ `is_section`.*
- `site_config` (key/value JSONB) — vd `${slug}_studentDisplayTitle`.
- `lesson_progress` (schema có, **0 code JS**).

**Phiên học / chống chia sẻ:**
- `student_active_sessions` (email, `student_session_id` UNIQUE, `portal_device_id`, status CHECK, login_at, last_seen_at, device_hash, device_label, ip_hash). **Unique partial index `idx_one_active_student_session_per_email` (lower(email)) WHERE status='active' → tối đa 1 active/email.**
- `lms_entry_tokens` (`token_hash` UNIQUE, email, student_session_id, portal_device_id, course_slug, post_id, status, expires_at). Hash-only, dùng 1 lần.
- `lms_verified_sessions` (`lms_session_id` UNIQUE, email, student_session_id, `lms_device_id`, course_slug, status). Per-course.
- `student_session_controls` (email, session_generation, sessions_revoked_before) — admin bulk revoke watermark. **Có RLS.**
- `student_device_change_logs` (event_idempotency_key UNIQUE partial, ip_hash, device_hash, **user_agent raw**).
- `student_account_risk_reviews`/`notes`/`summaries` (review states: new/monitoring/reviewed/suspected_sharing/false_positive/resolved; summary cache `stale_after = now()+15'`).
- `admin_audit_logs` (admin_email, action, target_email, metadata, ip_hash, user_agent).

**Drive:**
- `drive_admin_accounts` (email, status, daily_share_count, `quota_limited`), `drive_permission_logs`, `drive_sync_queue`.

**V2 (additive, chưa apply production):**
- `sync_outbox` (idempotency_key UNIQUE, source_system, aggregate_type/id, event_type, payload, status CHECK `pending/processing/delivered/failed/dead_letter/cancelled`, priority, attempt_count, max_attempts, available_at, locked_at/by, last_error).
- `sync_deliveries` (outbox_id, target_system, status CHECK, attempt_count, http_status, UNIQUE(outbox_id,target_system)).
- `sync_dead_letters` (outbox_id UNIQUE, reason, status `open/resolved/ignored`).
- `course_slug_mappings` (course_id, slug, normalized_slug, source_system, status) — canonical slug→UUID.
- `portal_post_course_mappings` (course_id, course_slug, post_id, portal_project_ref).
- Cột identity thêm vào `orders`/`student_enrollments`/`lessons`: `course_id`, `normalized_email`/`normalized_customer_email`, `sync_correlation_id`, `source_system`, `lessons.kind`/`parent_section_id`/`position`.

**RPC:**
- `handle_student_session_login(p_email, p_portal_device_id, p_new_student_session_id, p_device_hash, p_device_label, p_ip, p_ip_hash, p_user_agent, p_conflict_policy DEFAULT 'block', p_idle_hours DEFAULT 24)` — `pg_advisory_xact_lock(hashtext(email))`, policy `block`/`supersede`/`reused`/`expired`. **Caller nằm ở Portal, KHÔNG có caller trong repo LMS.**
- `reset_student_session_guard(p_email, p_admin_email, p_reason)` — SECURITY DEFINER, advisory lock, cascade revoke, `admin_audit_logs`. `GRANT service_role`.
- `cleanup_student_account_risk_events(p_older_than_days)` — SECURITY DEFINER, retention (default **180 ngày**, clamp ≥30, max 365).

### 1.4 Data Flow quan trọng nhất

**① Đơn hàng → cấp quyền học (inbound sync):**
```
Shop landing ?course=<slug> → khách gửi Gmail+bill → orders (Shop)
  → admin duyệt (Shop) → POST /api/sync {action:"syncEnrollment", email, courseSlug} (X-Sync-Secret)
  → LMS syncEnrollment(): normalizeEmail → get/create students → tra courses.id theo slug
    → UPSERT student_enrollments (onConflict email,course_slug, gắn source_order_id)
    → syncGoogleDrivePermission()  ← KHÔNG có transaction bao trùm (REL-01)
  → nếu Drive fail: enrollment vẫn active, lỗi đẩy vào drive_sync_queue để retry
```
Idempotency: UNIQUE(`email`,`course_slug`) → gọi lại an toàn. `ACTIVE_ENROLLMENT_STATUSES` = `active, approved, approved_ready, approved_waiting_content, completed, da duyet` (+normalize bỏ dấu).

**② Đăng nhập học viên (entry-token bridge):**
```
Portal Google login (Gmail A)
  → RPC handle_student_session_login(email, portal_device_id, new_session_id, policy='block')
      - advisory lock email
      - active khác device → {ok:false, action:'blocked', reason:'active_session_on_another_device'} (không đá A)
      - same device → reuse + touch last_seen
      - stale > 24h → expire cũ + create mới
      - không active → create active
  → createLmsEntryToken (raw token, chỉ lưu token_hash, TTL 30')
  → redirect lms.html?entry_token= / #entry_token= (frontend nhận hash HOẶC query, rồi xóa khỏi URL)

LMS POST verify-entry-token {entry_token, lms_device_id}
  → verifyLmsEntryToken (hash match, status active, không revoked)
  → load student_active_sessions (active, email match, stale 24h → expire + 401)
  → enrollment active
  → createLmsVerifiedSession (lms_session_id, lms_device_id, course_slug)
  → markLmsEntryTokenUsed (dùng 1 lần) + touch student session + telemetry
  → return {ok, lms_session_id}

LMS client lưu lms_session_id + lms_device_id (localStorage)
  → POST course-data / GET lesson với headers X-LMS-Session-Id / X-LMS-Device-Id
  → verifyLmsVerifiedSessionAccess (device match, idle, student active, enrollment, touch)
  → SONG SONG: cookie JWT course_session_token (30 ngày) vẫn được set/refresh (lớp session thứ 2)
```

**③ Drive permission + media:**
```
syncGoogleDrivePermission → Drive admin pool (3 Gmail round-robin, quota-aware)
  → addDriveFolderPermission (sendNotificationEmail:false — chủ ý, giảm spam)
  → lỗi → drive_sync_queue + drive_permission_status; admin retry/health/repair
Media: video Bunny (HMAC token TTL 600s + watermark email động), ảnh/Docs Drive, recipe Google Docs/text,
       tài liệu trong lessons.materials. Format media phụ: type|title|url|caption.
```

**④ Sync outbound LMS → System1:** admin POST lesson → `admin-lessons.js` gọi `POST ${SYSTEM1_URL}/api/sync` gửi `syncRecipe`.

**⑤ Anti-sharing (chỉ giám sát, không tự khóa):** mỗi event (login_blocked, entry_token_rejected, lms_session_rejected, logout, admin_reset...) → `logStudentDeviceEvent` (idempotency key chống trùng, hash HMAC ip/device, **user_agent raw**) → risk score → summary cache 15'. Admin xem qua `account-sharing-alerts`, reset qua RPC.

### 1.5 Auth — 2 đường

- **Admin:** `admin-auth.js` → `verifyGoogleIdToken` (server-side verify chữ ký Google) → `isAdminEmail` (env `ADMIN_EMAILS`, **không password**) → `createAdminSession` (JWT `role:admin`, cookie `admin_session_token`). `getAdminFromRequest` đọc từ body/query/`Authorization: Bearer`/cookie.
- **Student:** GSI id_token → `verifyGoogleIdToken`, HOẶC `exchange-code.js` (đổi auth code, **tự decode id_token, chỉ check `aud===clientId`, KHÔNG verify chữ ký** — orphan handler, không route map).

### 1.6 V1 invariants — 12 điều KHÔNG ĐƯỢC PHÁ (V3 phải giữ)

1. **Idempotency enrollment**: UNIQUE(`email`,`course_slug`) — sync lại không trùng, không mất quyền.
2. **`normalizeEmail = trim().toLowerCase()`** áp dụng nhất quán enrollment/session/drive/log.
3. **`ACTIVE_ENROLLMENT_STATUSES`** (6 giá trị + normalize bỏ dấu) là điều kiện phát nội dung — dùng cùng tập mọi nơi.
4. **Entry token hash-only, dùng 1 lần, TTL 30'** — không lưu raw, `markLmsEntryTokenUsed`.
5. **1 session active/email** ở tầng DB (unique partial index).
6. **Không tự khóa / không tự thu quyền / không tự đá thiết bị active** — anti-sharing chỉ giám sát.
7. **Không ghi đè `courses.title` gốc** bằng slug/tên hiển thị (display title lưu riêng trong `site_config`).
8. **A/B boundary**: `student_enrollments` tồn tại ở cả A và B — sync theo `course_slug`, không nhầm.
9. **`source_order_id`** liên kết enrollment↔order — giữ để truy vết.
10. **`sync_lms_status`/`sync_portal_status`/`sync_error`** (phía A/Portal) là hợp đồng hiển thị admin.
11. **Bunny token 600s + watermark email động** — bảo vệ nội dung.
12. **`is_section`/`materials` semantics** — section không tính bài, không có tài liệu.

### 1.7 Hành vi V1 bắt buộc giữ (keep)

- 12 invariant trên. Gate sync `X-Sync-Secret` (giữ, nâng cấp chống replay ở V2/V3). Drive admin pool round-robin + quota + queue/retry + log. `sendNotificationEmail:false` khi share Drive. Reset session qua RPC `reset_student_session_guard`. Verify token flow đầy đủ. Admin auth Google + `ADMIN_EMAILS`. Watermark + Bunny signing.

---

## 2. Bối cảnh & bài học từ V2

### 2.1 Pitfalls / "hố sâu" của V1 (đã phát hiện khi thiết kế V2)

| Mã | Mức | Vấn đề | Dẫn chứng |
|---|---|---|---|
| **SEC-01** | **P0** | `sessionSecrets()` có phần tử fallback công khai `"fallback-session-secret"` → `some()` chấp nhận secret công khai → ký cả admin JWT → chiếm admin | `utils/lms.js` (V1) |
| **SEC-02** | **P0/P1** | CORS `Access-Control-Allow-Origin: *` trên **mọi** handler kể cả admin/sync (26 file) | `lms-handlers/*`, `api/sync.js` |
| **SEC-04** | **P0 (policy)** | One-device chỉ ép cho course ∈ `LMS_ENTRY_TOKEN_REQUIRED_COURSES`; **ENV rỗng ⇒ không course nào được bảo vệ**; course ngoài list chỉ cần cookie JWT 30 ngày → chia sẻ được | `course-data.js`, `lesson.js`, `lms-session-guard.js` |
| **SEC-03** | P1 | `public-lesson` không auth nhưng ghi `lessons.views+1` | `public-lesson.js` |
| **REL-01** | P1 | **Không transaction enrollment+Drive** → partial success hợp lệ (enrollment active nhưng Drive fail) | `syncEnrollment`/`syncGoogleDrivePermission` |
| **TEST-01** | P1 | **0% test tự động** (package.json không `scripts`, không framework) | `package.json` |
| SEC-05 | P2 | Cookie `Secure` chỉ khi `NODE_ENV==='production'` | `utils/lms.js` |
| SEC-06 | P2 | `exchange-code` tự decode id_token, chỉ check `aud`, không verify chữ ký (orphan nhưng bypass path) | `exchange-code.js` |
| SEC-07 | P2 | Sync secret so sánh chuỗi thường, không hằng-thời-gian, không nonce/timestamp → replay nếu lộ | `api/sync.js` (V1) |
| SEC-08 | P2 | `bodyParser 500mb` admin | `api/lms/admin.js` |
| **SEC-09** | P2 | **Service-role key bypass RLS toàn bộ** — 1 key toàn hệ | `utils/supabase.js` |
| SEC-10 | P2 | `user_agent` lưu **raw** trong khi ip/device được hash | `lms-session-guard.js` |
| SEC-11 | P2/P3 | **device-id do client tự khai** (localStorage `generateClientId("lmsdev")`) → giả mạo được | `lms.html` |
| REL-02 | P2 | Telemetry best-effort **nuốt lỗi** ("silent fail") → mất dấu vết | `admin-bulk-enroll.js`, `logDeviceEventSafe` |
| REL-03 | P2 | **Schema drift** + fallback retry bỏ `is_section` ẩn lỗi | `admin-lessons.js` |
| REL-04 | P2 | Idle expiry **lazy** (chỉ cập nhật khi có request), không job nền | `verify-entry-token.js` |
| REL-05 | P3 | Drive pool thiếu bảng → chỉ `console.warn` rồi tiếp | `utils/lms.js` |

**Technical debt tổng quát:**
- **Hai lớp session song song** (cookie JWT 30 ngày + session guard DB 24h) với ranh giới enforcement phụ thuộc ENV → khó suy luận, dễ lộ đường cookie JWT.
- **Enforcement one-device sống ở repo Portal** (RPC + caller) → repo LMS không tự đảm bảo được invariant quan trọng nhất.
- **Router monolith `?endpoint=`** import top-level toàn bộ handler → cold start nặng, không tách quyền/tài nguyên theo endpoint.
- **Schema drift**: `is_section`, `materials`, `orders.sync_*`, `courses.expected_start_date`, `is_published` dùng trong code/UI nhưng không có trong `.sql` repo → nguồn sự thật schema không rõ (repo `.sql` là "kịch bản khởi tạo" có seed, không phải migration tool).
- **Telemetry best-effort nuốt lỗi khắp nơi** → mất dấu điều tra chia sẻ tài khoản.
- **Trùng lặp UI/dead code**: `admin.html` (146KB) vs `lms-admin.html` (260KB, 5261 dòng), `banhmi4k-lessons.js`, `cloudinary`, `lesson_progress`.
- **Fallback secrets** (session + hash) che cấu hình sai thay vì fail-fast.

### 2.2 Giải pháp kiến trúc V2 (đã đề xuất/đang triển khai)

**A. Reliability — Outbox pattern (RP-3):**
- Vấn đề V1: side effect (Drive, Portal) gọi trực tiếp trong request admin/checkout → nếu target lỗi, trạng thái lệch, request chậm (REL-01).
- V2: request chính chỉ cập nhật source of truth + ghi event vào `sync_outbox`; **worker** xử lý delivery; mỗi target có record riêng trong `sync_deliveries`; retry exponential backoff; quá `max_attempts` → `sync_dead_letters`.
- **Idempotency**: `idempotency_key = sha256(source_system : event_type : aggregate_type/id : updated_at|version)` — worker xử lý được cùng event nhiều lần. Bảng `sync_outbox.idempotency_key` UNIQUE.
- **Progression an toàn**: `shadow mode` (chỉ ghi thêm, V1 không đổi) → `dry-run` (tính plan, không deliver) → `guarded live` (chỉ scope canary) → `readiness gate`.
- Event ban đầu: `course.upserted/published`, `enrollment.upserted/revoked`, `order.approved/rejected`, `drive.permission.requested`.

**B. Identity mapping (RP-3):**
- V1 đồng bộ theo `course_slug` (text). V2 thêm cột UUID `course_id` + `normalized_email` lên `orders`/`student_enrollments`/`lessons`, bảng `course_slug_mappings` (canonical slug→UUID) + `portal_post_course_mappings` (post_id→course). Giữ slug-flow V1 nguyên vẹn, chuẩn bị lookup UUID-backed. Backfill trong migration (idempotent, `IF NOT EXISTS`).

**C. Auth hardening (RP-1) — `utils/lms-secrets.js`:**
- Bỏ fallback secret, **fail-closed** khi thiếu `SESSION_SECRET`/`ACCOUNT_EVENT_HASH_SECRET` (chỉ local bypass qua `LMS_RP1_ALLOW_INSECURE_LOCAL=1` và không phải production). HMAC-SHA256 + `timingSafeEqual`. `AuthSecretError` chỉ lộ **tên biến**, không lộ giá trị. `assertAuthSecretsConfigured` cho boot self-check.

**D. CORS allowlist (RP2-A) — `utils/cors.js`:**
- 1 helper thay 26 block `*` hand-rolled. Mode `admin`/`portal`/`internal`/`public`. Allowlist ENV (`LMS_ADMIN_ORIGINS`/`LMS_PORTAL_ORIGINS`) + preview suffix (chặn piggy-back DNS). **Không bao giờ** `credentials:true` + wildcard. Fail-closed khi flag on + allowlist thiếu. `internal` cho phép server-to-server không Origin (secret header vẫn là auth chính).

**E. One-device toàn hệ (RP2-B1) — flag `V2_GLOBAL_ONE_DEVICE_ENABLED`:**
- Bỏ gate `LMS_ENTRY_TOKEN_REQUIRED_COURSES`: flag on → **mọi course** yêu cầu LMS verified session (`X-LMS-Session-Id`+`X-LMS-Device-Id`), không fallback cookie-only. Fail-closed (503 `one_device_policy_unavailable`) khi DB/RPC lỗi. Flag off = behavior V1 nguyên vẹn. `exchange-code` → 410 `legacy_login_disabled` khi flag on (chặn bypass). Lưu ý: RPC login-block nằm ở **Portal** — V2 chỉ enforce **LMS-side** (course-data/lesson); chính sách one-device hoàn chỉnh cần Portal V2 cùng bật.

**F. Server-side logout (RP2-B2) — `utils/lms-handlers/logout.js`:**
- V1: helper `markStudentSessionLoggedOut` + event `LOGOUT` tồn tại nhưng **không route gọi** → logout gần như client-only.
- V2: `endpoint=logout` → verify LMS session (headers, không tin cookie) → `markStudentSessionLoggedOut` → clear cookie `course_session_token` (`Max-Age=0`). **Idempotent** (gọi 2 lần vẫn 200). **Fail-closed**: flag on + revoke throw → 503, **không clear cookie, không giả vờ OK**. Flag off + no session → best-effort clear cookie, `serverRevoked:false`.

**G. Admin revoke polish (RP2-B3):**
- V1: `reset_session` hardcode reason `account_sharing_admin_reset`.
- V2: `reason` bắt buộc (trim, max 500), `student_not_found` (404, lookup non-fatal), `already_revoked` (200 idempotent khi 0 rows), `revoke_failed` (500), audit ghi **reason thật**. Không lộ email/IP/device/session id/DB-error trong response.

**H. Data ownership contract:**
- Supabase B = canonical (courses/orders/students/enrollments/lessons/session/risk/drive/outbox). Supabase A = **projection** (không ghi ngược). Khi lệch → reconciliation tạo report/repair task, **không auto-revoke**, repair cần audit log + dry-run.

**I. Expand-and-contract migration:**
- additive-only: `ADD COLUMN nullable`, `CREATE TABLE/RPC/INDEX` mới, default an toàn với V1. **Không** `DROP`/`RENAME`/`ALTER TYPE`. Phase 1 expand → Phase 2 backfill/dual-write → Phase 3 contract (chỉ khi V1 không còn dùng, ≥N ngày). Preflight/postflight SQL gate.

**J. Feature flag + coexistence + canary/rollback:**
- `V2_FLAGS` enum + strict parser `parseBooleanFlag`. Kill-switch `V2_ENABLED` (tắt → traffic về V1 < 30s). Coexistence: code `api/v2/*` song song, DB additive, auth cookie V1 chung. Canary 5%→25%→50%→100% gated trên `/api/v2/readiness`. **Rollback = flag off + alias DNS về V1**, KHÔNG dựa migration đảo (D7).
- Test: `node --test` (không framework), supabase stub (`LMS_RP2B1_SUPABASE_STUB=1`).

**Thứ tự V2:** RP-1 (auth) → RP2-A (CORS) → RP2-B0 (grants) → RP2-B1 (one-device) → RP2-B2 (logout) → RP2-B3 (revoke) → RP-3 (outbox/identity) → RP-4/5/6 (privacy/schema/tests).

### 2.3 Trạng thái V2 hiện tại (2026-07-15)

- Branch tích hợp: `v2/rebuild-20260715` = base từ `v2/platform-rebuild` (sync/outbox/identity/observe) **merge** `v2/rebuild-20260714` (RP-1, RP2-A, RP2-B0) **merge** `feat/v2-rp2b1` (one-device). Conflict duy nhất: `utils/v2-flags.js` (add/add) → resolve = union.
- **S0 (base)** ✅, **S1 (RP2-B2 logout)** ✅ (9 test), **S2 (RP2-B3 revoke polish)** ✅.
- **S3 (sync verify)** ⏳: code = runbook doc; ops = owner apply `migration_v2_sync_outbox.sql` + `migration_v2_identity_mapping.sql` (transactional, sau backup) → postflight → flag progression (shadow→dry-run→guarded live) gated trên `/api/v2/readiness`.
- **S4 (canary readiness)** ⏳: rollback drill 3 (code/schema/flags) + cutover runbook + test matrix.
- **V1 production (`main`/`v1-stable-20260713`) bất biến, chưa đụng.** Cutover traffic thật = quyết định owner, ngoài scope V2.
- **Out of scope V2** (gác sang sau): Drive permission job queue V2, Risk V2 incremental, Admin UI diagnostics page, RP2-C frontend Portal/LMS, Portal repo `student-web`, xóa V1 endpoint.

### 2.4 Lưu ý quan trọng cho V3 — những thứ "chưa xác minh" đừng tin mù

- **Production schema chưa verify đầy đủ** (V2 plan ghi rõ `NOT VERIFIED` cho nhiều table/index/RPC/grant). V3 **phải dump schema B thật** trước khi đổi bất cứ thứ gì dựa vào schema.
- **Portal là repo ngoài** (`yeubep-shop/student-web`, Next.js, branch `v2/platform-rebuild`). One-device login-block + logout server-side đang chạy ở Portal. V3 đổi chính sách session phải **đồng bộ cả Portal**.
- `exchange-code.js` là **orphan** (không route map, không caller) — nhưng vẫn là bypass path tiềm năng.
- `ADMIN_PASSWORD` **không tồn tại** (báo cáo Antigravity sai) — auth chỉ Google + `ADMIN_EMAILS`.
- `orders.html`/`utils/sync-helpers.js`/`syncPendingOrder` **không thuộc repo LMS** (thuộc Shop).

---

## 3. Đề xuất & hướng đi tiềm năng cho V3

> V3 = nhánh nghiên cứu với năng lực xử lý mạnh hơn. Dưới đây là cải tiến **đột phá** về kiến trúc/hiệu năng/công nghệ, dựa trên hiểu biết sâu về pitfalls V1 + giới hạn V2. Mỗi mục: vấn đề gốc → đề xuất → lý do → rủi ro/điều kiện.

### 3.1 Kiến trúc — bảo mật & phân quyền

**① [P0 nhất] Thay service-role toàn cục bằng RLS + key phân quyền + RPC SECURITY DEFINER là con đường ghi duy nhất.**
- Vấn đề: V1/V2 dùng 1 service-role key bypass RLS toàn bộ (SEC-09) → mọi leak key = toàn hệ. V2 chưa giải quyết (chỉ harden secret).
- Đề xuất: 3 role/key — `anon` (public read, RLS), `authenticated` (student, RLS scope tới row của mình), `service_role` (admin/worker, **không bao giờ trong browser**). Browser chỉ giữ anon/authenticated. Mọi ghi đa bước (enrollment+Drive, reset session, logout) vào **SECURITY DEFINER RPC** có advisory lock (pattern `handle_student_session_login`/`reset_student_session_guard` đã chứng minh). JS direct insert/delete chỉ cho read.
- Lý do: thu nhỏ blast radius, ép enforcement ở tầng DB (không thể bypass bằng app bug), đúng hướng Supabase.
- Rủi ro: RLS policy viết sai khóa chặn học viên → cần contract test (V1 client vẫn đọc được) + staging canary kỹ.

**② Gộp 2 lớp session thành 1 mô hình server-side duy nhất.**
- Vấn đề: V1 có cookie JWT 30 ngày + session guard DB 24h với ranh giới enforcement phụ thuộc ENV (SEC-04/SEC-11). V2 vẫn giữ cookie JWT song song.
- Đề xuất: 1 session token **opaque, httpOnly, Secure, SameSite=Lax/Strict**, sống ngắn, backed bởi `student_active_sessions`/`lms_verified_sessions`, refresh trượt (sliding) theo `last_seen`. **Bỏ cookie JWT 30 ngày làm cơ chế access** (chỉ còn identity tối thiểu nếu cần). Device-id **do server cấp** (xem ③).
- Lý do: loại bỏ hẳn class bypass "course ngoài list → cookie đủ"; 1 nguồn sự thật → dễ suy luận, dễ test, dễ revoke.
- Rủi ro: breaking change FE (cần RP2-C frontend); phải giữ compat window (dual-read) trong canary.

**③ Device identity do server cấp / WebAuthn cho course giá trị cao.**
- Vấn đề: V1 device-id do client tự khai localStorage (SEC-11, giả mạo được) → one-device có thể bị spoof.
- Đề xuất: server mint **signed device credential** (JWT ngắn hạn bound session) khi verify-entry-token; client gửi lại qua header. Cho course giá trị cao: **WebAuthn passkey** (device-bound, không giả mạo, không cần lưu device-id).
- Lý do: one-device thực sự trên identity không giả mạo; passkey còn thay thế/ bổ sung Google OAuth giảm friction.
- Rủi ro: WebAuthn cần HTTPS + UI onboarding; nên opt-in per-course trước.

### 3.2 Kiến trúc — integration & reliability

**④ Outbox làm xương sống integration (event sourcing / CQRS) — không còn "shadow".**
- Vấn đề: V2 có outbox nhưng canonical write vẫn là direct table mutation trong `syncEnrollment`; outbox còn shadow/gated. REL-01 (no transaction enrollment+Drive) chưa giải quyết triệt để.
- Đề xuất: **outbox là con đường integration duy nhất**. Shop/Portal ghi event → outbox (atomic cùng business write trong 1 transaction DB) → **projector** build read model (Portal projection, Drive permission, risk summary) → consumer idempotent. Enrollment + Drive thành 2 delivery target của 1 event → partial success không tồn tại (Drive fail = retry target riêng, enrollment đã ack). Reconciliation = so projection vs source.
- Lý do: dissolve REL-01 tự nhiên; trace end-to-end; dễ replay; đúng hướng distributed system.
- Rủi ro: cần transaction DB (Supabase/PostgREST RPC hoặc `pg-batch`); projector phải idempotent + exactly-once delivery (idempotency key + delivery record).

**⑤ Worker nền thật (không request-bound).**
- Vấn đề: V1/V2 worker outbox trigger bằng request/cron thủ công → delivery phụ thuộc traffic.
- Đề xuất: **pg_cron** (Supabase) poll outbox + worker function Vercel có claim/lease (V2 đã có `claimOutboxEvent`/`locked_by` — productize), hoặc queue service (Inngest/Trigger.dev/QStash) cho retry/DLQ observability sẵn.
- Lý do: delivery tin cậy, độc lập traffic, có visibility.
- Rủi ro: chi phí; pg_cron cần GRANT cẩn thận.

**⑥ Tách router monolith `?endpoint=` + edge runtime cho read-only.**
- Vấn đề: V1 import top-level toàn handler → cold start nặng, không tách resource. V2 thêm `api/v2/*` riêng nhưng portal/admin vẫn monolith.
- Đề xuất: **1 function per route** (pattern `api/v2/*`), lazy-load dep nặng (`googleapis`) chỉ trong function cần. Read-only portal (`course-data`/`lesson`/`public-config`) → **Vercel Edge Runtime** (latency thấp, CDN gần user). Admin (Drive upload, bodyParser) giữ Node runtime.
- Lý do: cold start giảm,隔離 quyền/tài nguyên, p95 latency tốt hơn cho learner.
- Rủi ro: Edge không có một số Node API (Drive SDK có thể cần Node) — chỉ áp dụng cho read path thuần.

### 3.3 Schema & migration

**⑦ Migration tool thật + CI schema-drift gate + ERD từ live DB.**
- Vấn đề: V1 `.sql` là "kịch bản khởi tạo" có seed, không phải migration; schema drift ẩn (`is_section`/`materials`/`expected_start_date`); không biết production có gì thật.
- Đề xuất: **Supabase CLI migrations** (hoặc sqitch/drizzle-kit) với up/down, version control. **CI gate**: sinh schema từ migration → so vs live DB dump → fail nếu drift. Tự sinh ERD. Bỏ seed data ra file riêng.
- Lý do: kết thúc "cột này có thật không"; rollback có ý nghĩa; V3 đổi schema an toàn.
- Rủi ro: migration init từ schema hiện hữu cần snapshot production cẩn thận.
- **PLAN READY (2026-07-15):** Kế hoạch chi tiết đã soạn tại `docs/V3_PROPOSAL_7_MIGRATION_TOOL_PLAN.md` (cấu trúc thư mục Supabase CLI, baseline không replay migration lịch sử, tách seed, CI gate so catalog, xử lý A/B, rollback, danh sách file, 7 điều kiện GO). Chưa sửa tooling — chờ owner (1) chạy `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` + paste kết quả `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`, (2) chốt `posts` A/B ownership (xem `docs/V3_SOURCE_AUDIT_FINDINGS.md`), (3) duyệt plan, (4) drill rollback PASS.

**⑧ Chính thức hóa `is_section`/`materials`/`expected_start_date`/`is_published` + dọn dead schema.**
- Vấn đề: V1 dùng cột không có schema (drift), có fallback ẩn lỗi.
- Đề xuất: migration additive chính thức thêm cột + backfill + bỏ fallback retry ẩn. Xóa/dánh dấu `lesson_progress` (dead), `banhmi4k-lessons.js`, `cloudinary`, gộp `admin.html`/`lms-admin.html`.
- Lý do: giảm technical debt, nguồn sự thật rõ.

### 3.4 Frontend & DX

**⑨ Modular hóa/SPA cho admin + dashboard diagnostics.**
- Vấn đề: `lms-admin.html` 260KB/5261 dòng, `lms.html` 108KB, `admin.html` 146KB — trùng lặp, khó maintain, không CSP/CSRF token đúng.
- Đề xuất: tối thiểu tách ES module + build step; lý tưởng chuyển admin sang **Next app** (Portal đã Next) hoặc SPA nhẹ (Vite + framework). Thêm **dashboard diagnostics** (outbox depth, delivery rate, RLS deny, readiness, risk) — V2 đã có endpoint `/api/v2/*`, chỉ cần UI.
- Lý do: maintainability, security header đúng, observability bằng mắt.
- Rủi ro: công sức lớn; nên làm sau khi backend V3 ổn.

**⑩ TypeScript end-to-end + monorepo + shared event schema.**
- Vấn đề: LMS plain JS, 0% test (V2 thêm node:test nhưng không type); 3 repo tách + sync-secret coupling gây "trộn repo"; breaking sync contract = production 401.
- Đề xuất: **TS cho LMS serverless** + **pnpm workspace monorepo** (hoặc tối thiểu shared npm package) cho Shop/Portal/LMS share **event schema + DTO + error code + normalizeEmail**. Breaking contract → compile error, không production 401. Contract test vs live schema (expand-only invariant) tự động.
- Lý do: an toàn refactor, chia sẻ hợp đồng, giảm confusion ranh giới repo.
- Rủi ro: migration JS→TS công sức; cần giữ compat trong canary.

### 3.5 Observability & bảo vệ nội dung

**⑪ Structured logs + metrics + tracing.**
- Vấn đề: V1 telemetry best-effort nuốt lỗi (REL-02); khó điều tra.
- Đề xuất: JSON log có `correlation_id`/`request_id`/`flow_id` (V2 đã có trong session guard — **mở rộng mọi handler**). Metrics: outbox depth, delivery success rate, RLS deny, cold-start p95, sync handshake fail. Tracing xuyên suốt Shop→Portal→LMS→Drive. Dashboard từ `/api/v2/readiness`+`diagnostics` (V2 seed) → productize.
- Lý do: mất dấu = mất khả năng điều tra chia sẻ tài khoản; observability là điều kiện cutover.
- Rủi ro: privacy — log không chứa email raw/IP (V2 đã mask — giữ).

**⑫ Signed-URL CDN per-session + DRM cho course cao cấp.**
- Vấn đề: V1 chỉ Bunny HMAC 600s + watermark email; URL leak dùng được 600s.
- Đề xuất: **signed media URL bound `lms_session_id`** (TTL ngắn, chết theo session) cho Bunny/Drive. Course cao cấp: **Widevine/FairPlay DRM**.
- Lý do: URL leak chết cùng session; DRM chống screen record 专业 hơn.
- Rủi ro: DRM chi phí + UX; nên opt-in per-course.

### 3.6 Thứ tự ưu tiên đề xuất cho V3

1. **⑦ migration tool + CI schema gate** + dump production schema (foundation, phải làm đầu tiên).
2. **① RLS + phân quyền key + RPC write path** (P0 security).
3. **④ outbox làm xương sống + ⑤ worker nền** (reliability, dissolve REL-01).
4. **② gộp session + ③ server device-id** (loại bypass class).
5. **⑥ tách router + edge runtime** (perf).
6. **⑪ observability** (điều kiện cutover).
7. **⑨ FE modular + dashboard** / **⑩ TS + monorepo** (DX, làm song song sau).
8. **⑫ signed-URL/DRM** (opt-in per-course).
9. **⑧ dọn dead code/schema** (housekeeping).

### 3.7 Nguyên tắc V3 phải kế thừa từ V2

- **V1 bất biến** (`main`/`v1-stable-20260713`) là rollback target — không đụng tới khi chưa canary sạch.
- **Expand-and-contract**: migration additive-only, không drop/rename/type change cho tới Phase 3 + owner duyệt.
- **Feature flag + canary + rollback drill**: mọi hành vi mới sau flag, rollback = flag off + alias (không migration đảo).
- **Không log secret/token/private key/service-role**. Mask email, hash ip/device, **hash user_agent** (sửa SEC-10).
- **Data ownership**: B canonical, A projection, repair cần audit + dry-run, không auto-revoke.
- **12 invariant V1** (§1.6) + hành vi keep (§1.7) phải giữ xuyên suốt.
- **Đồng bộ Portal**: mọi đổi chính sách session/one-device phải lockstep với repo `student-web`.
- **Test trước**: `node --test` (hoặc Vitest nếu V3 lên TS), contract test vs schema, supabase stub — không merge không test.

### 3.8 Master plan + runtime controller (2026-07-15)

- **Master plan V3 (①-⑫):** `docs/superpowers/specs/2026-07-15-v3-master-plan-design.md` — 11 phase (0→10), đồ thị phụ thuộc, mỗi phase map tới 1 đề xuất. Owner chọn phạm vi = toàn bộ ①-⑫; triển khai tuần tự, auto-advance khi test đạt; dừng chỉ ở blocker thật sự của owner.
- **Runtime controller (Phase 0 — IMPLEMENTED):** `PLATFORM_RUNTIME_MODE` DB-backed (`platform_runtime_config` singleton trên B, RLS-on, service-role/SQL Editor only). `utils/runtime-controller.js` — `getEffectiveMode()` là gate duy nhất (v1/v2/v3), fail-closed về v1, kill switch + rollback V1 tức thời (update 1 row, không redeploy), cache ~3s, `stampEvent()` gán `runtime_version` cho mọi event/log/delivery. Admin endpoint `api/v2/runtime.js` (service-role gate = `INTERNAL_SYNC_SECRET`, cùng door V2 worker, không secret mới). Single-writer invariant: chỉ 1 version ghi authoritative tại 1 thời điểm; shadow mode read-only. Chi tiết: `docs/V3_PHASE_0_RUNTIME_CONTROLLER.md`. Owner action pending: apply `migration_v3_runtime_config.sql` trên B (additive, không business data). Cho tới khi apply, controller fail-closed về v1 = hệ thống giống hệt hôm nay.
- **Thứ tự hiện thực hóa:** Phase 0 ✅ → Phase 1 ✅ (⑦ migration tooling + CI schema-drift gate — repo tooling DONE 2026-07-15, `docs/V3_PHASE_1_MIGRATION_TOOLING.md`; baseline B `db pull` owner-only pending) → Phase 2 ✅ (① RLS + key tiering + RPC write path — repo DONE 2026-07-15, `docs/V3_PHASE_2_RLS_KEY_TIERING.md`; apply `migration_v3_rls_policies.sql` on B after canary = owner-pending) → Phase 3 ✅ (④ outbox backbone canonical + ⑤ worker reuse — repo DONE 2026-07-15, `docs/V3_PHASE_3_OUTBOX_BACKBONE.md`; apply `migration_v3_outbox_dead_letters.sql` on B = owner-pending) → Phase 4 (② session + ③ device-id) → Phase 5 (⑥ router/edge) → Phase 6 (⑪ observability) → Phase 7 (⑨ FE) → Phase 8 (⑩ TS/monorepo) → Phase 9 (⑫ signed-URL/DRM) → Phase 10 (⑧ cleanup, cuối cùng, owner duyệt).

---

## 4. Bản đồ đọc nhanh cho AI mới

| Muốn hiểu | Đọc |
|---|---|
| Bức tranh V1 + mọi P0/P1 + invariant | `review-dossier-v1/V1_FINAL_VERIFIED_SYSTEM_REPORT.md` (671 dòng) |
| Kế hoạch rebuild/cutover V2 đầy đủ | `review-dossier-v1/V2_REBUILD_AND_CUTOVER_PLAN.md` (585 dòng) |
| Spec V2 canary-ready hiện hành | `docs/superpowers/specs/2026-07-15-v2-canary-ready-design.md` |
| Plan V2 task-by-task (có code mẫu) | `docs/superpowers/plans/2026-07-15-v2-canary-ready.md` |
| Session guard policy + inventory + dependency verify | `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md` (2132 dòng, có Phụ lục F–K verify Portal production) |
| Data ownership / master plan / status | `docs/v2/V2_DATA_OWNERSHIP_CONTRACT.md`, `docs/v2/V2_MASTER_PLAN.md`, `docs/v2/V2_IMPLEMENTATION_STATUS.md` |
| Schema thật | `supabase_schema.sql` + `migration_*.sql` (⚠️ **phải dump production để xác minh**) |
| Code core | `utils/lms.js`, `utils/lms-session-guard.js`, `utils/supabase.js`, `api/sync.js`, `api/lms/portal.js`, `api/lms/admin.js` |
| Code V2 | `utils/v2-*.js`, `api/v2/*.js`, `utils/cors.js`, `utils/lms-secrets.js`, `utils/v2-flags.js` |
| Test pattern | `tests/*.test.mjs` + `tests/_supabase_stub_loader.mjs` |

---

> **Lưu ý cuối cho Fable 5:** Tài liệu này là bản đúc đặc — nó thay việc scan codebase nhưng **không thay việc verify production**. Trước khi đề xuất/architect bất kỳ thay đổi schema/session/sync nào, hãy (1) đọc code hiện tại tại symbol được nhắc, (2) dump schema Supabase B thật, (3) đọc repo Portal `student-web` cho phần session. Đừng tin mù các mục `NOT VERIFIED`. Giữ 12 invariant V1 — phá chúng = mất quyền học viên.
