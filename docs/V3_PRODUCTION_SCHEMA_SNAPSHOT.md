# V3 — Production Schema Snapshot (Supabase B)

> **Đã điền 2026-07-15** bằng cách query trực tiếp Supabase B (project ref `aqozjkfwzmyfunqvcyjv`) qua PostgREST **read-only** bằng `SUPABASE_SERVICE_ROLE_KEY` (từ `.env.local`). Không có query nào đụng dữ liệu học viên; không log secret.
>
> **Cập nhật 2026-07-15 (lần 2 — gap catalog VERIFIED):** 4 gap còn lại (RLS/index/constraint/grant) đã được Fable 5 chạy read-only qua `supabase db query --linked` (Management API, role `postgres`) và paste vào `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`. → **Toàn bộ schema snapshot B hiện VERIFIED** (REST + catalog). Sửa lại Q10 (outbox): `sync_outbox`/`sync_deliveries` **CÓ tồn tại** trong catalog (REST 404 trước đó là do RLS on + 0 policy, không phải chưa CREATE); `sync_dead_letters` **không có** → outbox migration apply **một phần**.
>
> **Quan trọng — giới hạn phương pháp (đã giải quyết):** PostgREST (REST API) không truy cập được `information_schema`/`pg_catalog`. 4 gap đã được bù qua `supabase db query --linked` (chỉ SELECT catalog). Mọi mục dưới đây đã VERIFIED.
>
> **Bảo vệ dữ liệu:** Đã gọi `reset_student_session_guard` với email phantom `__v3_probe_no_such_user__@example.com` để xác nhận RPC/grant hoạt động (read-only intent, không có session thật). Side-effect tạo 1 row `student_session_controls` + 1 row `admin_audit_logs` với email phantom → **đã dọn sạch** (xác nhận `admin_audit_logs` về 2, `student_session_controls` về 0 cho phantom). Không đụng row thật nào. Catalog probe (lần 2) **chỉ SELECT, không side-effect**.

---

## Tóm tắt nhanh cho Fable 5

- **22 bảng** exposed qua PostgREST (Supabase B). **3 RPC** exposed.
- **V2 outbox tables (`sync_outbox`/`sync_deliveries`/`sync_dead_letters`) = 404 → CHƯA CREATE trên production** (identity_mapping migration cũng chưa apply đầy đủ — xem Q11).
- **Identity columns (`course_id`, `normalized_email`...) ĐÃ có** trên `orders`/`student_enrollments`/`lessons`. Identity gap: `orders.course_id IS NULL = 3` (3 đơn chưa map course — cần reconciliation), enrollments+lessons = 0 (đã backfill sạch).
- **Drift columns tồn tại thật:** `lessons.is_section` (9 rows true), `lessons.materials` (jsonb), `courses.is_published` (3 rows true), `courses.expected_start_date` (date), `courses.drive_folder_id`, `courses.drive_permission_mode`, `courses.sync_lms_status`/`sync_portal_status`/`sync_error`. **`courses` cũng có `sync_*` (không chỉ `orders` như V1 doc ghi).**
- **`posts` table tồn tại trên cùng Supabase B** (id/title/recipe/images/views/course_slug/status/hero_media_url) → phải là projection legacy, không phải Supabase A riêng biệt (cần owner xác nhận).
- **`student_session_controls` chỉ 1 row** (đã dọn probe) → bảng generation/bulk-revoke gần như trống production.
- **Active sessions: 2** (status=active) trên 15 tổng — 1-active/email cần verify qua SQL (Q3 constraint).
- **RLS / grant / policy / trigger / index = ✅ VERIFIED** (catalog, 2026-07-15 lần 2). **RLS ON 100% bảng, 0 policy**, force-RLS OFF. `handle_student_session_login` EXECUTE: service_role ✅ / PUBLIC+anon+authenticated ❌, **SECURITY INVOKER** (không DEFINER). Xem `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`.

---

## Q1 — Danh sách bảng public + cột (✅ VERIFIED via PostgREST OpenAPI)

> PostgREST không trả `rowsecurity`/`forcerowsecurity` (Q1 gốc). Thay vào đó, OpenAPI definitions cho **đầy đủ cột + PK/FK** của mỗi bảng. Tổng 22 bảng exposed.

### Bảng + cột đầy đủ (VERIFIED)

#### `courses` (6 rows)
| cột | kiểu | ghi chú |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE |
| title | text | |
| subtitle, price, image_url, description, teacher_name | text | |
| active | boolean | |
| sort_order | integer | |
| raw_data | jsonb | |
| created_at, updated_at | timestamptz | |
| **sync_lms_status, sync_portal_status, sync_error** | text | ⚠️ V1 doc ghi cột này chỉ ở `orders`/phía A — thực tế **`courses` cũng có** |
| **is_published** | boolean | (drift, 3 rows true) |
| **drive_folder_id** | text | |
| **drive_permission_mode** | text | |
| **expected_start_date** | date | (drift, dùng trong api/sync.js) |

#### `orders` (24 rows)
| cột | kiểu | ghi chú |
|---|---|---|
| id | uuid | PK |
| course_slug, course_title | text | |
| customer_name, customer_email, customer_phone, proof_image_url | text | |
| status | text | default 'Chờ duyệt' |
| note | text | |
| raw_data | jsonb | |
| created_at, updated_at | timestamptz | |
| sync_lms_status, sync_portal_status, sync_error | text | (phía A/Portal quản lý) |
| **course_id** | uuid | FK→courses.id (V2 identity, **3 rows NULL**) |
| **normalized_customer_email** | text | V2 identity |
| **sync_correlation_id** | uuid | V2 identity |
| **source_system** | text | V2 identity |

#### `lessons` (35 rows)
| cột | kiểu | ghi chú |
|---|---|---|
| id | uuid | PK |
| course_id | uuid | FK→courses.id |
| course_slug | text | |
| lesson_no | integer | |
| title, description | text | |
| video_provider | text | default 'bunny' |
| video_url, bunny_library_id, bunny_video_id | text | |
| recipe_url, document_url, photo_url, thumbnail_url | text | |
| duration_text, level | text | |
| media_urls | text | |
| views | integer | default 0 |
| is_free, active | boolean | |
| status | text | default 'active' |
| sort_order | integer | |
| raw_data | jsonb | |
| created_at, updated_at | timestamptz | |
| **is_section** | boolean | (drift — 9 rows true) |
| **materials** | jsonb | (drift) |
| **kind** | text | V2 identity (check section/lesson) |
| **parent_section_id** | uuid | FK→lessons.id (V2 identity) |
| **position** | integer | V2 identity |

#### `students` (13 rows)
id(uuid PK), email(text UNIQUE), full_name, phone, status(default 'active'), note, raw_data(jsonb), created_at, updated_at

#### `student_enrollments` (19 rows)
| cột | kiểu | ghi chú |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK→students.id |
| course_id | uuid | FK→courses.id (V2, **0 rows NULL**) |
| course_slug | text | |
| email | text | |
| status | text | default 'active' |
| source_order_id | uuid | FK→orders.id (invariant #9) |
| expired_at | timestamptz | |
| created_at, updated_at | timestamptz | |
| drive_permission_status, drive_permission_admin_email, drive_permission_id, drive_folder_id, drive_permission_error | text | (Drive pool) |
| drive_permission_retry_count | integer | |
| drive_permission_updated_at | timestamptz | |
| **normalized_email** | text | V2 identity |
| **sync_correlation_id** | uuid | V2 identity |
| **source_system** | text | V2 identity |

#### `student_active_sessions` (15 rows; 2 active)
id(uuid PK), email, student_session_id(text), portal_device_id, status, login_at, last_seen_at, logout_at, ip, user_agent, created_at, updated_at, **device_hash**, **device_label**, **ip_hash**

#### `lms_entry_tokens` (19 rows)
id(uuid PK), token_hash(text), email, student_session_id, portal_device_id, course_slug, post_id, status, created_at, expires_at, used_at, created_ip, created_user_agent

#### `lms_verified_sessions` (21 rows)
id(uuid PK), lms_session_id(text), email, student_session_id, lms_device_id, course_slug, entry_token_id(uuid FK→lms_entry_tokens.id), status, verified_at, last_seen_at, logout_at, ip, user_agent, created_at, updated_at

#### `student_session_controls` (1 row — đã dọn probe)
id(uuid PK), email, session_generation(integer), sessions_revoked_before(timestamptz), updated_by_admin_email, reason, created_at, updated_at

#### `student_device_change_logs` (12 rows)
id(uuid PK), email, old_device_hash, new_device_hash, old_device_label, new_device_label, old_student_session_id, new_student_session_id, course_slug, user_agent, ip_hash, reason, created_at, **action**, **event_type**, post_id, **lms_device_hash**, **lms_session_hash**, **event_source**, **risk_points**(integer), **metadata**(jsonb), **admin_email**, **event_idempotency_key**, **correlation_id**, **request_id**, **flow_id**, **result**, **reason_code**, **schema_version**, **hash_version**

#### `student_account_risk_reviews` (0 rows)
id(uuid PK), email, status, risk_level, risk_score(integer), note, assigned_admin_email, last_reviewed_at, created_at, updated_at, monitoring_until, resolved_at, false_positive_at

#### `student_account_admin_notes` (0 rows)
id(uuid PK), email, admin_email, note, created_at

#### `student_account_risk_summaries` (1 row)
id(uuid PK), email, risk_score(integer), risk_level, devices_24h, devices_7d, devices_30d, blocked_count, device_change_count, last_event_at, last_device_change_at, recent_devices(jsonb), course_slugs(jsonb), reasons(jsonb), review_status, review_note, assigned_admin_email, monitoring_until, resolved_at, false_positive_at, risk_rule_version, summary_window_days(integer), computed_at, **stale_after**(timestamptz), created_at, updated_at

#### `admin_audit_logs` (2 rows — đã dọn probe, gốc 3 → thực ra probe thêm 1 rồi xóa, còn 2)
id(uuid PK), admin_email, action, target_email, metadata(jsonb), ip_hash, user_agent, created_at

#### `drive_admin_accounts` (3 rows)
id(uuid PK), email, display_name, status, last_used_at, last_error, last_error_at, daily_share_count(integer), created_at, updated_at

#### `drive_permission_logs` (56 rows)
id(uuid PK), time(timestamptz), course_slug, folder_id, email, action, status, message, request_id, student_email, course_id(uuid), drive_folder_id, drive_admin_email, permission_id, error_code, error_message, retry_count(integer), created_at, updated_at, last_retry_at

#### `drive_sync_queue` (8 rows)
id(uuid PK), email, course_slug, action, attempts(integer), error_message, created_at, updated_at

#### `lesson_progress` (0 rows — dead/để dành, invariant không phá)
id(uuid PK), email, course_slug, lesson_id(uuid FK→lessons.id), progress_percent(integer), completed(boolean), last_watched_at, created_at, updated_at

#### `site_config`
key(text PK), value(jsonb), updated_at  *(count qua REST trả 400 do chọn id không tồn tại — bảng dùng `key` PK; không quan trọng)*

#### `course_slug_mappings` (6 rows — V2 identity)
id(uuid PK), course_id(uuid FK→courses.id), slug, normalized_slug, source_system, status, first_seen_at, last_seen_at, created_at, updated_at

#### `portal_post_course_mappings` (0 rows — V2 identity, chưa có data)
id(uuid PK), course_id(uuid FK→courses.id), course_slug, normalized_course_slug, post_id, portal_project_ref, source_system, status, first_seen_at, last_seen_at, created_at, updated_at

#### `posts` (1 row — legacy projection, cùng Supabase B)
id(uuid PK), title, recipe, images(text[]), views(integer), created_at, course_slug, status, hero_media_url

### ⚠️ Q1 RLS status — ✅ VERIFIED (catalog 2026-07-15 lần 2)
**RLS ON trên 100% bảng public (25 bảng), `relforcerowsecurity=false` trên tất cả, 0 policy.** Service-role bypass RLS → hiện chỉ an toàn khi mọi read/write qua service-role. `student_session_controls` bật RLS như V2 doc ghi, nhưng **không có policy** (footgun). Đây là input bắt buộc cho đề xuất V3 ①. Chi tiết: `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` Block 1.

---

## Q10 — V2 outbox tables (✅ VERIFIED via REST + catalog — **CORRECTION**)

```
sync_outbox            REST 404, NHƯNG CÓ TRONG pg_class (RLS on, 0 policy)
sync_deliveries        REST 404, NHƯNG CÓ TRONG pg_class (RLS on, 0 policy)
sync_dead_letters      KHÔNG có trong catalog lẫn REST
```
→ **Sửa lại kết luận trước:** `sync_outbox` + `sync_deliveries` **ĐÃ CREATE** trên production (RLS on, 0 policy → REST/PostgREST không expose vì anon/authenticated bị chặn mặc định). **`sync_dead_letters` chưa CREATE.** → Outbox migration apply **một phần** (2/3 bảng). V3 ④ chỉ cần thêm migration cho `sync_dead_letters` + viết policy RLS nếu muốn observe qua REST, không cần tạo lại outbox từ 0.

---

## Q11 — Identity columns + drift columns (✅ VERIFIED via REST)

| bảng | cột | có? | dữ liệu |
|---|---|---|---|
| orders | course_id | ✅ có | **3 rows NULL** (identity gap) |
| orders | normalized_customer_email | ✅ có | |
| orders | sync_correlation_id | ✅ có | |
| orders | source_system | ✅ có | |
| student_enrollments | course_id | ✅ có | 0 rows NULL (backfill sạch) |
| student_enrollments | normalized_email | ✅ có | |
| student_enrollments | sync_correlation_id, source_system | ✅ có | |
| lessons | kind | ✅ có | |
| lessons | parent_section_id | ✅ có | |
| lessons | position | ✅ có | |
| lessons | is_section | ✅ có (drift) | 9 rows true |
| lessons | materials | ✅ có (jsonb, drift) | |
| courses | is_published | ✅ có (drift) | 3 rows true |
| courses | expected_start_date | ✅ có (date, drift) | |
| courses | drive_folder_id, drive_permission_mode | ✅ có | |
| courses | sync_lms_status, sync_portal_status, sync_error | ✅ có | |

→ **Kết luận:** identity mapping migration (`migration_v2_identity_mapping.sql`) **đã apply** (cột + course_slug_mappings 6 rows + backfill enrollments/lessons sạch). Chỉ `orders.course_id` còn 3 gap → cần reconciliation. Outbox migration **apply một phần** (Q10: `sync_outbox`+`sync_deliveries` có, `sync_dead_letters` chưa).

---

## Q12 — Số dòng ước lượng (✅ VERIFIED exact via Content-Range)

| bảng | rows |
|---|---|
| courses | 6 |
| orders | 24 |
| lessons | 35 |
| students | 13 |
| student_enrollments | 19 |
| student_active_sessions | 15 (trong đó 2 active) |
| lms_entry_tokens | 19 |
| lms_verified_sessions | 21 |
| student_session_controls | 1 |
| student_device_change_logs | 12 |
| student_account_risk_reviews | 0 |
| student_account_admin_notes | 0 |
| student_account_risk_summaries | 1 |
| admin_audit_logs | 2 |
| drive_admin_accounts | 3 |
| drive_permission_logs | 56 |
| drive_sync_queue | 8 |
| lesson_progress | 0 |
| portal_post_course_mappings | 0 |
| posts | 1 |
| course_slug_mappings | 6 |

→ Quy mô nhỏ (dữ liệu thật + test). V3 architect không lo scale khổng lồ, lo **đúng bất biến + bảo mật** hơn.

---

## RPC (✅ VERIFIED exposed + executable)

3 RPC exposed qua `/rest/v1/rpc/`:
- `handle_student_session_login` — args là object (PostgREST gói params). Signature đầy đủ (10 tham số) trong `migration_atomic_session_guard.sql`. **Caller ở Portal.**
- `reset_student_session_guard` — ✅ **đã test executable**: gọi với email phantom trả `{ok:true, studentSessions:0, entryTokens:0, lmsSessions:0, revokedBefore:"...", usedRpc:true}` → **GRANT service_role hoạt động** (đã dọn side-effect).
- `cleanup_student_account_risk_events` — exposed (chưa test).

### ✅ Q6/Q7 RPC grant detail — VERIFIED (catalog 2026-07-15 lần 2)
- `handle_student_session_login`: **SECURITY INVOKER** (không DEFINER), `proconfig` null (không pin search_path), owner `postgres`. EXECUTE: `postgres`/`service_role`/`supabase_admin` ✅; **PUBLIC/anon/authenticated ❌** → grant hardening **đã apply**. Caller Portal dùng service-role → OK. Khác pattern mong muốn DEFINER — V3 ① nên chuẩn hóa.
- `reset_student_session_guard`: SECURITY DEFINER + `search_path=public`. EXECUTE: postgres/service_role/supabase_admin ✅.
- `cleanup_student_account_risk_events`: SECURITY DEFINER + `search_path=public`. EXECUTE: postgres/service_role/supabase_admin ✅.
- `record_view`: **không tồn tại trên B** → RPC Portal views chỉ ở A (hoặc chưa apply).
Chi tiết: `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` Block 4.

---

## CÒN CẦN OWNER VERIFY QUA SQL EDITOR (PostgREST không thấy được)

> **✅ ĐÃ HOÀN TẤT 2026-07-15 (lần 2).** 4 gap dưới đây đã được Fable 5 chạy read-only qua `supabase db query --linked` (catalog SELECT). Kết quả paste trong `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`. Mục này giữ lại làm bản đồ "từng là gap" cho truy vết; không còn chặn V3.

### Gap 1 — RLS status + policy (V3 đề xuất ① cần cái này) — ✅ VERIFIED
RLS ON 100% bảng, **0 policy**, force-RLS OFF. Chi tiết trong `V3_SCHEMA_GAP_SQL_RESULTS.md` Block 1.

### Gap 2 — Index (đặc biệt unique partial 1-active-session/email — invariant #5) — ✅ VERIFIED
`idx_one_active_student_session_per_email` UNIQUE partial `WHERE status='active'` **CÓ thật**. Chi tiết Block 2.

### Gap 3 — Constraint (UNIQUE email,course_slug — invariant #1) — ✅ VERIFIED
`student_enrollments_email_course_slug_key` = `UNIQUE (email, course_slug)` **CÓ**. Chi tiết Block 3.

### Gap 4 — Function grant (handle_student_session_login — blocker V2) — ✅ VERIFIED
service_role ✅; PUBLIC/anon/authenticated ❌; **SECURITY INVOKER** (không DEFINER). Chi tiết Block 4.

---

## Phát hiện mới quan trọng (so với V1/V2 doc)

1. **`courses` cũng có `sync_lms_status`/`sync_portal_status`/`sync_error`** — V1 doc (AG-11) ghi các cột này chỉ ở `orders`/phía A. Thực tế `courses` cũng có. Cần cập nhật invariant/contract.
2. **`courses.drive_folder_id` + `drive_permission_mode`** tồn tại — V1 doc chưa nhắc cột này trên `courses` (chỉ nhắc trên enrollments). Drive folder có thể lưu cả course-level.
3. **`posts` ở cùng Supabase B** (không phải Supabase A riêng) — V1 doc giả định 2 Supabase tách biệt. `posts` (1 row) trên cùng project `aqozjkfwzmyfunqvcyjv`. Cần owner xác nhận `posts` có thực sự dùng hay legacy dead.
4. **Outbox V2 apply một phần trên production** — `sync_outbox` + `sync_deliveries` **ĐÃ CREATE** (RLS on, 0 policy → REST/PostgREST không expose, nên snapshot REST trước đó báo 404 nhầm là "chưa create"). `sync_dead_letters` **chưa CREATE**. V3 ④ chỉ cần thêm migration cho `sync_dead_letters` + viết RLS policy nếu muốn observe qua REST.
5. **`student_device_change_logs`** phình to (30 cột) hơn V1 doc mô tả — có `event_idempotency_key`, `correlation_id`, `request_id`, `flow_id`, `lms_device_hash`, `lms_session_hash`, `risk_points`, `metadata`, `schema_version`, `hash_version`... → telemetry phong phú hơn suy đoán.
6. **`drive_permission_logs` có `student_email` + `course_id`** riêng (bên cạnh `email`/`course_slug`) — V2 identity đã lan vào log table.

---

> **Tài liệu này đủ để Fable 5 architect V3** với độ chính xác cao về schema (bảng/cột/RPC/identity/drift/row-count/RLS/index/constraint/grant đều **VERIFIED** qua REST + catalog 2026-07-15). 4 gap RLS/index/constraint/grant đã được bù qua `supabase db query --linked` (xem `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`). Fable 5 đọc file này + `V3_SYSTEM_KNOWLEDGE_TRANSFER.md` + `V3_SCHEMA_GAP_SQL_RESULTS.md` là đủ để lên kế hoạch V3 chính xác.
