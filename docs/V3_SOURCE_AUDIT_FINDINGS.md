# V3 — Source Audit Findings: Supabase A/B Ownership (read-only)

> **Ngày audit:** 2026-07-15. Branch `v3/research-20260715` (worktree).
> **Phạm vi:** Repo LMS (`web-lms-chinh-thuc`) + Repo Portal (`yeubep-shop/student-web`, branch `v2/platform-rebuild`, HEAD `d2a903c`) — **chỉ đọc**, không sửa Portal.
> **Bảo mật:** Không log URL/secret/service-role. Chỉ báo **tên biến môi trường** + **project alias A/B** + **SAME/DIFFERENT** verdict. Project ref B `aqozjkfwzmyfunqvcyjv` đã công khai trong docs commit trước.
> **Git integrity verify (2026-07-15):** `git rev-parse f9220e8` = `f9220e8128e13e93d803e0c014c39be5819f557c`; tag `v1-stable-20260713` points-at `f9220e8`; `main` HEAD = `f9220e8`. V1 rollback target nguyên vẹn.

---

## 1. Khởi tạo Supabase client — tên biến môi trường

### 1.1 Repo LMS (`utils/supabase.js`)
- **Một client duy nhất**, export tên `supabase`.
- Biến môi trường:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Mode: service-role (`persistSession:false, autoRefreshToken:false`).
- Không có client thứ hai (`lmsSupabaseAdmin` / `LMS_SUPABASE_*` **không tồn tại** trong code LMS — grep 0 hit ngoài docs).
- Test stub: `LMS_RP2B1_SUPABASE_STUB=1` → in-memory stub (production không set).

### 1.2 Repo Portal (`src/lib/supabase.ts`) — **3 client**
| Export | Biến môi trường | Loại key | Dùng cho |
|---|---|---|---|
| `supabase` (anon) | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon (public) | Browser-side read, RPC `record_view` |
| `supabaseAdmin` | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | service-role | Ghi `posts`, `student_enrollments` (Supabase **A** candidate) |
| `lmsSupabaseAdmin` | `LMS_SUPABASE_URL` + `LMS_SUPABASE_SERVICE_ROLE_KEY` | service-role | Ghi session-guard vào Supabase **B** (RPC `handle_student_session_login`, entry token, logout) |

- `supabaseAdmin` fallback: nếu thiếu service-role key → dùng anon client (code line 15–22).
- `lmsSupabaseAdmin` fallback: nếu thiếu `LMS_SUPABASE_*` → `null` (caller check `if (!lmsSupabaseAdmin)`).

> **Lưu ý tên biến trùng:** cả hai repo đều dùng `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL`, nhưng **chỉ trong env của repo đó**. Portal thêm `NEXT_PUBLIC_*` (browser-exposed) + `LMS_SUPABASE_*` (cross-project sang B). Không nhầm lẫn vì deploy tách repo.

### 1.3 Verdict runtime (cảnh báo về env)
- **Env Portal trong worktree** (`.env.local`) **chỉ chứa `VERCEL_OIDC_TOKEN`** — `NEXT_PUBLIC_SUPABASE_URL` / `LMS_SUPABASE_URL` **vắng mặt ở local** (chỉ thấy tên biến trong code). → Runtime Portal thực tế phụ thuộc env production (Vercel), **chưa xác minh trong audit này**.
- **Env LMS** (`.env.production` / `.env.prod.local` / `.env.prod.raw`): `SUPABASE_URL=""` + `SUPABASE_SERVICE_ROLE_KEY` có giá trị nhưng **URL rỗng** trong file worktree → env production thật ở Vercel, không trong file này. **Không suy đoán ref từ env rỗng.**
- **Kết luận alias runtime (dựa code + docs commit, không phải env file):**
  - `SUPABASE_URL` (LMS) ≡ Supabase **B** (ref `aqozjkfwzmyfunqvcyjv` — đã công khai trong `V3_PRODUCTION_SCHEMA_SNAPSHOT.md` do owner query 2026-07-15).
  - `LMS_SUPABASE_URL` (Portal) ≡ Supabase **B** (Portal ghi session-guard vào cùng runtime LMS — xác nhận qua code `session-guard.ts` gọi `handle_student_session_login` RPC chỉ tồn tại trên B).
  - `NEXT_PUBLIC_SUPABASE_URL` (Portal) ≡ Supabase **A candidate** (`posts`/`post_views`/`record_view`) — **runtime chưa verify** (xem §3 về `posts`).

---

## 2. Bảng `posts` — route/file nào đọc/ghi

### 2.1 Repo LMS
- **KHÔNG có route/file JS nào** đọc/ghi bảng `posts` (grep `'posts'`/`from('posts')`/`record_view`/`post_views` trong `api/`, `utils/`, `*.html` = **0 hit**).
- File `supabase_sub_posts.sql` tồn tại = **script SQL thủ công** (CREATE TABLE posts + ADD COLUMN course_slug/status/hero_media_url + index) — định nghĩa schema `posts` để owner chạy trong SQL Editor, **không được code LMS gọi**.
- → **LMS runtime không bao giờ chạm `posts`.**

### 2.2 Repo Portal — `posts` đọc/ghi qua `supabaseAdmin` (Supabase A candidate)
| File | Hành động | Client |
|---|---|---|
| `src/app/api/sync/route.ts` | select / insert / update `posts` (syncCourse, syncCoursePublishStatus, syncRecipe) | `supabaseAdmin` |
| `src/app/api/lms-entry-token/route.ts:97` | select `posts` (validatePostCourse — kiểm post thuộc course) | `supabaseAdmin` |
| `src/app/api/posts/[id]/view/route.ts:59` | RPC `record_view` (views counter) | `supabase` (anon) |
| `src/app/post/[id]/page.tsx:237` | select `posts` (SSR post detail) | `supabase` (anon) |
| `src/lib/my-courses.ts:166` | select `posts` (join course_slug) | `supabaseAdmin` |

- **Ghi `posts`** chỉ qua `supabaseAdmin` (service-role A) — tại `sync/route.ts`.
- **Đọc `posts`** qua cả `supabase` (anon) và `supabaseAdmin`.

### 2.3 Tương quan với snapshot production
- `V3_PRODUCTION_SCHEMA_SNAPSHOT.md` Q1: **`posts` table tồn tại trên cùng Supabase B** (1 row, ref `aqozjkfwzmyfunqvcyjv`), cột `id/title/recipe/images/views/created_at/course_slug/status/hero_media_url`.
- **Mâu thuẫn cần owner chốt:** Code Portal dùng `supabaseAdmin` (NEXT_PUBLIC_SUPABASE_URL = A candidate) để ghi `posts`, nhưng snapshot thấy `posts` nằm trên **B**. Hai khả năng:
  1. **A = B** (cùng project): `NEXT_PUBLIC_SUPABASE_URL` và `SUPABASE_URL` (LMS) thực ra trỏ **cùng ref B**. Khi đó không có "Supabase A riêng" — `posts` chỉ là schema legacy trong B. → Khớp với ghi chú snapshot "phải là projection legacy, không phải Supabase A riêng biệt".
  2. **A ≠ B**: `posts` tồn tại ở **cả A và B** (schema trùng tên), Portal ghi A, snapshot query B thấy bản B. → Cần owner xác nhận hai project riêng.
- **Quyết định tạm (chưa chốt):** **KHÔNG kết luận B canonical / A projection cho `posts` cho tới khi owner verify runtime A** (xem điều kiện GO #3 trong `V3_PROPOSAL_7_MIGRATION_TOOL_PLAN.md`). Audit chỉ xác nhận: *code Portal ghi `posts` qua biến `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; bảng `posts` có mặt trên B; chưa đủ bằng chứng nói A≠B hay A=B.*

---

## 3. Bảng `student_enrollments` — route/file nào đọc/ghi

### 3.1 Repo LMS — đọc/ghi qua `supabase` (service-role B)
| File / khu vực | Hành động |
|---|---|
| `utils/lms.js` (`syncEnrollment`) | upsert / update / delete enrollment (gọi từ `api/sync.js`) |
| `utils/lms-handlers/admin-enrollments.js` | admin list/repair enrollments |
| `utils/lms-handlers/admin-bulk-enroll.js` | bulk enroll |
| `utils/lms-handlers/exchange-code.js`, `verify-entry-token.js`, `lesson.js`, `course-data.js` | đọc enrollment để check quyền |
| `utils/lms-session-guard.js` | đọc enrollment trong session flow |
| `utils/v2-reconciliation.js`, `v2-diagnostics.js` | reconciliation / diagnostics |
| `api/sync.js` (action syncEnrollment / revokeEnrollment) | delegate `syncEnrollment` |
| `check_db.js`, `check_email.js` | script kiểm tra (không runtime) |

- **Constraint kỳ vọng:** `UNIQUE(email, course_slug)` (từ `supabase_schema.sql:138`, Portal upsert dùng `onConflict: 'email,course_slug'`). **Chưa verify production** — nằm trong Block 3 của `V3_SCHEMA_GAP_SQL_VERIFICATION.sql`.

### 3.2 Repo Portal — đọc/ghi `student_enrollments` qua **cả** `supabaseAdmin` (A) **và** `lmsSupabaseAdmin` (B)
| File | Client | Hành động |
|---|---|---|
| `src/app/api/sync/route.ts` | `supabaseAdmin` | upsert (syncEnrollment, syncPendingOrder), update status, delete (revokeEnrollment), select (triggerCourseReadyEmails) — **onConflict `email,course_slug`** |
| `src/app/api/lms-entry-token/route.ts:69-77` | `supabaseAdmin` + `lmsSupabaseAdmin` | select enrollment (isEnrollmentAuthorized — **đọc cả 2 source** rồi OR) |
| `src/app/post/[id]/page.tsx:348-354` | `supabaseAdmin` + `lmsSupabaseAdmin` | select enrollment (gating — đọc cả 2) |
| `src/lib/my-courses.ts:117,137` | `supabaseAdmin` + `lmsSupabaseAdmin` | select enrollment (getMyCourses — merge cả 2) |

- **Quan trọng — dual-read pattern:** Portal **đọc enrollment từ cả A (`supabaseAdmin`) lẫn B (`lmsSupabaseAdmin`)** rồi gộp (`Promise.all` + spread + `some(...)`/merge). → Enrollment data có thể tồn tại ở **cả hai Supabase**, Portal treat cả hai là nguồn quyền.
- **Ghi enrollment** qua `supabaseAdmin` (A) trong `sync/route.ts` (upsert/update/delete) — **không** ghi enrollment qua `lmsSupabaseAdmin` ở Portal (lmsSupabaseAdmin chỉ ghi session-guard tables).
- → **Enrollment write path** = Portal ghi vào A (qua sync từ LMS), LMS ghi vào B (qua `api/sync.js` nhận từ Shop). Hai write path song song → **reconciliation quan trọng** (V2 đã có `v2-reconciliation.js`).

---

## 4. Kết luận rõ — Supabase A và B đang sở hữu gì (theo code hiện tại)

| Hệ / bảng | Supabase **B** (LMS runtime, ref công khai `aqozjkfwzmyfunqvcyjv`) | Supabase **A** (Portal, runtime CHƯA verify) |
|---|---|---|
| `courses` | ✅ LMS ghi (`api/sync.js` syncCourse qua `supabase`); Portal đọc qua `lmsSupabaseAdmin` | ❌ không thấy code Portal ghi courses qua `supabaseAdmin` |
| `orders` | ✅ LMS sở hữu; Portal đọc qua `lmsSupabaseAdmin` (`my-courses.ts`) | ❌ |
| `lessons` | ✅ LMS sở hữu; Portal đọc qua `lmsSupabaseAdmin` (`post/[id]/page.tsx`) | ❌ |
| `students` | ✅ LMS sở hữu | ❌ |
| `student_enrollments` | ✅ LMS ghi (`utils/lms.js`); Portal **đọc** qua `lmsSupabaseAdmin` | ⚠️ Portal **đọc + ghi** qua `supabaseAdmin` (`sync/route.ts`) → A có bản sao enrollment? |
| `posts` | ⚠️ Bảng **tồn tại trên B** (snapshot 1 row) nhưng **code LMS không chạm** | ✅ Portal **đọc + ghi** qua `supabaseAdmin`; RPC `record_view` qua anon |
| `post_views` | ❓ không thấy trong snapshot B (PostgREST không list) | ⚠️ Portal `record_view` RPC ghi — предполож A |
| session-guard tables (`student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`, `student_device_change_logs`, `student_session_controls`) | ✅ Portal ghi qua `lmsSupabaseAdmin`; RPC `handle_student_session_login` trên B | ❌ |
| V2 identity/mapping (`course_slug_mappings`, `portal_post_course_mappings`) | ✅ LMS (`v2-reconciliation.js`) | ❌ |
| V2 outbox (`sync_outbox`...) | ⚠️ Migration committed nhưng **chưa apply** (snapshot 404) | ❌ |

**Tóm tắt một câu:**
- **Supabase B** = canonical cho `courses/orders/lessons/students/enrollments(B-side)/session-guard/risk/drive/identity`. LMS repo ghi B qua `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; Portal ghi session-guard vào B qua `LMS_SUPABASE_URL`/`LMS_SUPABASE_SERVICE_ROLE_KEY`.
- **Supabase A** = Portal-side projection cho `posts` (+ có thể `post_views`/`record_view`) và **có thể** có bản sao `student_enrollments` (dual-read/ghi trong `sync/route.ts`). **Runtime A chưa verify** — chỉ thấy tên biến trong Portal code, env worktree trống.
- **Câu hỏi mở chặn ⑦:** `posts` trên B (snapshot) vs Portal ghi `posts` qua A — **A=B hay A≠B?** Không chốt cho đến khi owner verify.

---

## 5. Danh sách file Portal đã đọc (chỉ đọc, không sửa)

- `src/lib/supabase.ts` (3 client init)
- `src/lib/session-guard.ts` (lmsSupabaseAdmin: device logs, active sessions, RPC handle_student_session_login)
- `src/lib/my-courses.ts` (dual-read enrollments + posts + courses)
- `src/app/api/sync/route.ts` (supabaseAdmin: posts + student_enrollments ghi)
- `src/app/api/lms-entry-token/route.ts` (supabaseAdmin posts validate + lmsSupabaseAdmin enrollment read + createLmsEntryToken)
- `src/app/api/posts/[id]/view/route.ts` (anon supabase: RPC record_view)
- `src/app/api/auth/logout/route.ts` (markStudentSessionLoggedOut qua lmsSupabaseAdmin gián tiếp)
- `src/app/post/[id]/page.tsx` (SSR: posts anon + courses/enrollments dual-read)
- `.env.local` (chỉ thấy `VERCEL_OIDC_TOKEN` — không có SUPABASE vars ở local)

---

## 6. Liên kết tài liệu liên quan

- `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` — file SQL read-only owner chạy để verify 4 gap.
- `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` — nơi owner paste kết quả.
- `docs/V3_PROPOSAL_7_MIGRATION_TOOL_PLAN.md` — plan chi tiết ⑦ (điều kiện GO #3 = chốt `posts` ownership).
- `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` — snapshot B (đã verify qua REST 2026-07-15).
- `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` — transfer doc (§H data ownership contract).
