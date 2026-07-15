# V3 — Production Schema Gap SQL Results

> **Trạng thái:** ✅ **VERIFIED 2026-07-15** — Fable 5 chạy read-only qua `supabase db query --linked` (Management API, role `postgres`) trên project ref `aqozjkfwzmyfunqvcyjv` (Supabase B).
>
> **Phương pháp:** `npx supabase@2.109.1 db query --linked --output-format json` — **chỉ SELECT catalog**. Không CREATE/ALTER/DROP/GRANT/REVOKE/UPDATE/INSERT/DELETE.
>
> **Không paste secret/service-role/URL đầy đủ.** Project ref `aqozjkfwzmyfunqvcyjv` đã công khai trong docs.
>
> **Nguồn:** `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` (4 block). Raw JSON probes lưu trong `scratch/gap/` (gitignored).
>
> **Lưu ý quan trọng so với PostgREST snapshot:** catalog thấy **25 bảng** public base (PostgREST OpenAPI chỉ expose 22). 3 bảng thêm: `spatial_ref_sys` (PostGIS system), `sync_deliveries`, `sync_outbox`. **`sync_dead_letters` KHÔNG có.** → Outbox V2 apply **một phần** (outbox + deliveries), không full 3-table; REST 404 trước đó do RLS/bật-RLS-không-policy + service-role REST expose khác với catalog.

---

## BLOCK 1 — RLS enabled/forced + policies

### 1a. RLS flags trên các bảng public

| table_name | rls_enabled | rls_forced | relkind |
|---|---|---|---|
| admin_audit_logs | true | false | r |
| course_slug_mappings | true | false | r |
| courses | true | false | r |
| drive_admin_accounts | true | false | r |
| drive_permission_logs | true | false | r |
| drive_sync_queue | true | false | r |
| lesson_progress | true | false | r |
| lessons | true | false | r |
| lms_entry_tokens | true | false | r |
| lms_verified_sessions | true | false | r |
| orders | true | false | r |
| portal_post_course_mappings | true | false | r |
| posts | true | false | r |
| site_config | true | false | r |
| spatial_ref_sys | true | false | r |
| student_account_admin_notes | true | false | r |
| student_account_risk_reviews | true | false | r |
| student_account_risk_summaries | true | false | r |
| student_active_sessions | true | false | r |
| student_device_change_logs | true | false | r |
| student_enrollments | true | false | r |
| student_session_controls | true | false | r |
| students | true | false | r |
| sync_deliveries | true | false | r |
| sync_outbox | true | false | r |

**25 bảng public base; RLS bật trên 100%; `relforcerowsecurity = false` trên tất cả.**

### 1b. Policies trên public schema

| schemaname | tablename | policyname | permissive | roles | cmd | qual | with_check |
|---|---|---|---|---|---|---|---|
| _(empty — 0 rows)_ | | | | | | | |

### 1c. Bảng bật RLS nhưng 0 policy (footgun)

| table_name | rls_enabled | rls_forced | policy_count |
|---|---|---|---|
| admin_audit_logs | true | false | 0 |
| course_slug_mappings | true | false | 0 |
| courses | true | false | 0 |
| drive_admin_accounts | true | false | 0 |
| drive_permission_logs | true | false | 0 |
| drive_sync_queue | true | false | 0 |
| lesson_progress | true | false | 0 |
| lessons | true | false | 0 |
| lms_entry_tokens | true | false | 0 |
| lms_verified_sessions | true | false | 0 |
| orders | true | false | 0 |
| portal_post_course_mappings | true | false | 0 |
| posts | true | false | 0 |
| site_config | true | false | 0 |
| student_account_admin_notes | true | false | 0 |
| student_account_risk_reviews | true | false | 0 |
| student_account_risk_summaries | true | false | 0 |
| student_active_sessions | true | false | 0 |
| student_device_change_logs | true | false | 0 |
| student_enrollments | true | false | 0 |
| student_session_controls | true | false | 0 |
| students | true | false | 0 |
| *(+ spatial_ref_sys / sync_outbox / sync_deliveries — cùng pattern, RLS on + 0 policy)* | true | false | 0 |

**Đúc kết Block 1:** RLS bật **toàn bộ** bảng public (`relrowsecurity=true`), nhưng **0 policy** trên mọi bảng. Đây là footgun kinh điển: client `anon`/`authenticated` bị chặn mặc định, còn service-role **bypass RLS** → hệ thống hiện tại **chỉ an toàn khi mọi write/read đi qua service-role**. Input bắt buộc cho đề xuất V3 ① (RLS + phân quyền key): phải viết policy thật trước khi thu hẹp service-role.

---

## BLOCK 2 — Unique + partial indexes

### 2a. Tất cả index trên public schema (tóm tắt theo bảng; full `indexdef` trong `scratch/gap/block2a_indexes.json`)

| tablename | indexname | unique? | partial? | indexdef (rút gọn) |
|---|---|---|---|---|
| courses | courses_pkey | Y | | UNIQUE btree (id) |
| courses | courses_slug_key | Y | | UNIQUE btree (slug) |
| courses | idx_courses_slug | N | | btree (slug) |
| lessons | lessons_pkey | Y | | UNIQUE btree (id) |
| lessons | lessons_course_slug_lesson_no_key | Y | | UNIQUE btree (course_slug, lesson_no) |
| lessons | idx_lessons_course_slug / sort / kind_parent_position | N | | btree |
| lms_entry_tokens | lms_entry_tokens_pkey | Y | | UNIQUE btree (id) |
| lms_entry_tokens | lms_entry_tokens_token_hash_key | Y | | UNIQUE btree (token_hash) |
| lms_entry_tokens | idx_lms_entry_tokens_* | N | | email/course/status, student_session/status, token_hash |
| lms_verified_sessions | lms_verified_sessions_pkey | Y | | UNIQUE btree (id) |
| lms_verified_sessions | lms_verified_sessions_lms_session_id_key | Y | | UNIQUE btree (lms_session_id) |
| lms_verified_sessions | idx_lms_verified_sessions_* | N | | email/course/status, lms_session_id, student_session/status |
| orders | orders_pkey | Y | | UNIQUE btree (id) |
| orders | idx_orders_* | N | | course_id, course_slug, normalized_customer_email, status, sync_correlation |
| posts | posts_pkey | Y | | UNIQUE btree (id) |
| posts | idx_posts_course_slug | N | | btree (course_slug) |
| student_active_sessions | student_active_sessions_pkey | Y | | UNIQUE btree (id) |
| student_active_sessions | student_active_sessions_student_session_id_key | Y | | UNIQUE btree (student_session_id) |
| **student_active_sessions** | **idx_one_active_student_session_per_email** | **Y** | **status='active'** | **UNIQUE btree (lower(email)) WHERE (status = 'active'::text)** |
| student_active_sessions | idx_student_active_sessions_email_status / student_session_id | N | | btree |
| student_device_change_logs | student_device_change_logs_pkey | Y | | UNIQUE btree (id) |
| student_device_change_logs | **idx_student_device_logs_event_idempotency** | **Y** | **event_idempotency_key IS NOT NULL** | UNIQUE btree (event_idempotency_key) WHERE (event_idempotency_key IS NOT NULL) |
| student_device_change_logs | nhiều idx telemetry (email, course, correlation, reason, retention…) | N | partial một số | btree |
| student_enrollments | student_enrollments_pkey | Y | | UNIQUE btree (id) |
| **student_enrollments** | **student_enrollments_email_course_slug_key** | **Y** | | **UNIQUE btree (email, course_slug)** |
| student_enrollments | idx_student_enrollments_* | N | | course_id/status, course_slug, drive_status, email, normalized_email, sync_correlation |
| students | students_pkey | Y | | UNIQUE btree (id) |
| students | students_email_key | Y | | UNIQUE btree (email) |
| students | idx_students_email | N | | btree (email) |

*(Các bảng khác: admin_audit_logs, drive_*, risk_*, session_controls, site_config, course_slug_mappings, portal_post_course_mappings, sync_outbox, sync_deliveries — đều có pkey + index phụ. Full list trong scratch.)*

### 2b. Unique/partial/exclusion flags (pg_index)

Đã xác nhận qua catalog:
- **Partial unique one-active-session:** `idx_one_active_student_session_per_email` — `is_unique=true`, `partial_predicate=(status = 'active'::text)`.
- **Partial unique event idempotency:** `idx_student_device_logs_event_idempotency` — `is_unique=true`, `partial_predicate=(event_idempotency_key IS NOT NULL)`.
- Không thấy exclusion constraint (`is_exclusion=false` trên mọi index kiểm tra).

### 2c. Index ứng viên cho one-active-session + enrollment uniqueness

| table_name | index_name | is_unique | partial_predicate | index_def |
|---|---|---|---|---|
| student_active_sessions | idx_one_active_student_session_per_email | true | (status = 'active'::text) | CREATE UNIQUE INDEX … ON public.student_active_sessions USING btree (lower(email)) WHERE (status = 'active'::text) |
| student_enrollments | student_enrollments_email_course_slug_key | true | null | CREATE UNIQUE INDEX … ON public.student_enrollments USING btree (email, course_slug) |
| student_device_change_logs | idx_student_device_logs_event_idempotency | true | (event_idempotency_key IS NOT NULL) | CREATE UNIQUE INDEX … WHERE (event_idempotency_key IS NOT NULL) |
| lms_entry_tokens | lms_entry_tokens_token_hash_key | true | null | UNIQUE (token_hash) |
| lms_verified_sessions | lms_verified_sessions_lms_session_id_key | true | null | UNIQUE (lms_session_id) |
| courses | courses_slug_key | true | null | UNIQUE (slug) |
| students | students_email_key | true | null | UNIQUE (email) |
| lessons | lessons_course_slug_lesson_no_key | true | null | UNIQUE (course_slug, lesson_no) |

**Đúc kết Block 2:**
- ✅ **Invariant #5 CÓ thật:** `idx_one_active_student_session_per_email` UNIQUE partial `WHERE status='active'` trên `lower(email)`.
- ✅ **Invariant #1 CÓ thật:** unique index/constraint `student_enrollments_email_course_slug_key` trên `(email, course_slug)`.
- ✅ Telemetry idempotency partial unique CÓ (`event_idempotency_key`).
- ✅ Entry token hash unique + LMS session id unique CÓ.

---

## BLOCK 3 — Constraints (UNIQUE email,course_slug hoặc tương đương)

### 3a. Tất cả constraint trong public schema

> Full 3a (~100+ constraint) trong `scratch/gap/block3a_constraints.json`. Dưới đây là các constraint quan trọng cho invariant/V3.

### 3b. Constraint trên student_enrollments + posts + mapping tables (focus)

| table_name | constraint_name | constraint_type | constraint_def |
|---|---|---|---|
| student_enrollments | student_enrollments_pkey | p | PRIMARY KEY (id) |
| student_enrollments | **student_enrollments_email_course_slug_key** | **u** | **UNIQUE (email, course_slug)** |
| student_enrollments | student_enrollments_student_id_fkey | f | FOREIGN KEY (student_id) REFERENCES students(id) … |
| student_enrollments | student_enrollments_course_id_fkey | f | FOREIGN KEY (course_id) REFERENCES courses(id) … |
| student_enrollments | student_enrollments_source_order_id_fkey | f | FOREIGN KEY (source_order_id) REFERENCES orders(id) … |
| posts | posts_pkey | p | PRIMARY KEY (id) |
| students | students_pkey | p | PRIMARY KEY (id) |
| students | students_email_key | u | UNIQUE (email) |
| courses | courses_pkey | p | PRIMARY KEY (id) |
| courses | courses_slug_key | u | UNIQUE (slug) |
| orders | orders_pkey | p | PRIMARY KEY (id) |
| lessons | lessons_pkey | p | PRIMARY KEY (id) |
| lessons | lessons_course_slug_lesson_no_key | u | UNIQUE (course_slug, lesson_no) |
| course_slug_mappings | (pkey + FK course_id) | p/f | … |
| portal_post_course_mappings | (pkey + FK course_id) | p/f | … |

### 3c. Unique constraint/index đề cập đến cả email VÀ course_slug

| kind | table_name | name | def |
|---|---|---|---|
| constraint | student_enrollments | student_enrollments_email_course_slug_key | UNIQUE (email, course_slug) |
| unique_index | student_enrollments | student_enrollments_email_course_slug_key | CREATE UNIQUE INDEX student_enrollments_email_course_slug_key ON public.student_enrollments USING btree (email, course_slug) |

**Đúc kết Block 3:** `student_enrollments` **CÓ** UNIQUE constraint `student_enrollments_email_course_slug_key` = `UNIQUE (email, course_slug)` (và unique index cùng tên). Portal `onConflict: 'email,course_slug'` **khớp production**. `posts` chỉ có PK, không unique trên course_slug.

---

## BLOCK 4 — handle_student_session_login owner / security mode / GRANT

### 4a. Function identity + owner + security mode

| schema_name | function_name | identity_args | result_type | security_mode | owner | config_settings | volatility | leakproof | is_security_definer |
|---|---|---|---|---|---|---|---|---|---|
| public | cleanup_student_account_risk_events | p_retention_days integer | jsonb | SECURITY DEFINER | postgres | ["search_path=public"] | v | false | true |
| public | handle_student_session_login | p_email text, p_portal_device_id text, p_new_student_session_id text, p_device_hash text, p_device_label text, p_ip text, p_ip_hash text, p_user_agent text, p_conflict_policy text, p_idle_hours integer | jsonb | **SECURITY INVOKER** | postgres | null | v | false | **false** |
| public | reset_student_session_guard | p_email text, p_admin_email text, p_reason text | jsonb | SECURITY DEFINER | postgres | ["search_path=public"] | v | false | true |

> `record_view` **không tồn tại** trên B (0 row) — khớp giả định A-only RPC.

### 4b. EXECUTE privileges (information_schema)

| routine_schema | routine_name | grantee | privilege_type | is_grantable |
|---|---|---|---|---|
| public | cleanup_student_account_risk_events | postgres | EXECUTE | YES |
| public | cleanup_student_account_risk_events | service_role | EXECUTE | NO |
| public | handle_student_session_login | postgres | EXECUTE | YES |
| public | handle_student_session_login | service_role | EXECUTE | NO |
| public | reset_student_session_guard | postgres | EXECUTE | YES |
| public | reset_student_session_guard | service_role | EXECUTE | NO |

### 4c. EXECUTE privileges (pg_catalog cross roles — chỉ role có EXECUTE=true)

| schema_name | function_name | identity_args (rút) | grantee_role | has_execute |
|---|---|---|---|---|
| public | cleanup_student_account_risk_events | p_retention_days integer | postgres | true |
| public | cleanup_student_account_risk_events | p_retention_days integer | service_role | true |
| public | cleanup_student_account_risk_events | p_retention_days integer | supabase_admin | true |
| public | handle_student_session_login | (10 args) | postgres | true |
| public | handle_student_session_login | (10 args) | service_role | true |
| public | handle_student_session_login | (10 args) | supabase_admin | true |
| public | reset_student_session_guard | p_email, p_admin_email, p_reason | postgres | true |
| public | reset_student_session_guard | p_email, p_admin_email, p_reason | service_role | true |
| public | reset_student_session_guard | p_email, p_admin_email, p_reason | supabase_admin | true |

*(Không thấy PUBLIC / anon / authenticated trong tập has_execute=true.)*

### 4d. PUBLIC/anon/authenticated/service_role EXECUTE leak check cho handle_student_session_login

| function_name | identity_args | public_has_execute | anon_has_execute | authenticated_has_execute | service_role_has_execute |
|---|---|---|---|---|---|
| handle_student_session_login | (10 args full) | **false** | **false** | **false** | **true** |

**Đúc kết Block 4:**
- ✅ **Grant hardening ĐÃ apply** cho `handle_student_session_login`: PUBLIC/anon/authenticated **KHÔNG** có EXECUTE; service_role **CÓ**. Portal gọi qua service-role vẫn OK.
- ⚠️ **`handle_student_session_login` = SECURITY INVOKER** (không DEFINER) + `proconfig` null (không pin `search_path`). Khác `reset_student_session_guard` / `cleanup_*` (cả hai DEFINER + `search_path=public`). Caller service-role vẫn bypass RLS nên hiện tại chạy được, nhưng đây là **lệch so với pattern V1 doc** (doc ghi SECURITY DEFINER). V3 ① nên chuẩn hóa DEFINER + pin search_path nếu muốn anon/authenticated gọi qua RPC an toàn.
- `record_view` **không có trên B** → RPC Portal views sống ở A (hoặc chưa apply).

---

## Verdict tổng

- [x] Block 1 (RLS) đã paste — **VERIFIED**
- [x] Block 2 (Index) đã paste — **VERIFIED**
- [x] Block 3 (Constraint) đã paste — **VERIFIED**
- [x] Block 4 (Function grant) đã paste — **VERIFIED**

### 4 gap VERIFIED summary (input seed cho `drift_allowlist.json` + baseline ⑦)

| Gap | Kết luận production B |
|---|---|
| 1. RLS | RLS **ON** mọi bảng public; **0 policy**; force-RLS **OFF**. Service-role là đường duy nhất thực sự đọc/ghi. |
| 2. Index | `idx_one_active_student_session_per_email` UNIQUE partial `WHERE status='active'` **CÓ** (invariant #5). Event idempotency partial unique **CÓ**. |
| 3. Constraint | `student_enrollments_email_course_slug_key` = `UNIQUE (email, course_slug)` **CÓ** (invariant #1). |
| 4. Function grant | `handle_student_session_login` EXECUTE: service_role ✅ / PUBLIC+anon+authenticated ❌. **SECURITY INVOKER** (không DEFINER). `record_view` absent on B. |

### Phát hiện mới (so với REST snapshot trước)

1. **`sync_outbox` + `sync_deliveries` TỒN TẠI trong catalog** (RLS on, 0 policy) — REST 404 trước đó **không** có nghĩa "chưa CREATE". `sync_dead_letters` **vẫn không có**. → Outbox migration apply **một phần**.
2. Catalog = **25** bảng public base (PostgREST OpenAPI expose 22).
3. `handle_student_session_login` là **SECURITY INVOKER**, không DEFINER như transfer doc mô tả pattern mong muốn.

### GO/NO-GO cho Đề xuất ⑦ (Migration tool + CI schema-drift gate)

| # | Điều kiện | Status |
|---|---|---|
| 1 | Owner chạy gap SQL + paste results | ✅ **DONE** (Fable 5 chạy thay, 2026-07-15) |
| 2 | 4 gap VERIFIED | ✅ **DONE** |
| 3 | Owner chốt `posts` A/B ownership | ⏳ **CHƯA** — vẫn cần owner |
| 4 | Owner tạo role read-only cho CI (`SUPABASE_DB_URL_RO`) | ⏳ **CHƯA** |
| 5 | Owner duyệt plan ⑦ | ⏳ **CHƯA** |
| 6 | Drill rollback PASS | ⏳ **CHƯA** (cần Docker Desktop cho `db dump`/`db pull` baseline) |
| 7 | V1 baseline nguyên vẹn | ✅ (đã verify 2026-07-15: `f9220e8` + tag `v1-stable-20260713`) |

**Verdict hiện tại:** Gap SQL **PASS** → #1+#2 không còn chặn. **NO-GO tổng** vẫn giữ vì thiếu #3/#4/#5/#6. Không sửa tooling ⑦ cho tới khi owner chốt ownership `posts` + duyệt plan + cài Docker (cho baseline pull).
