# V3 — Production Schema Snapshot (read-only)

> **Mục đích:** Cung cấp cho Fable 5 (nhánh V3) bức tranh **schema Supabase B thật** — vì repo `.sql` chỉ là "kịch bản khởi tạo" có seed, có schema drift, và nhiều mục trong tài liệu transfer ghi `NOT VERIFIED`.
>
> **Ai điền:** OWNER (chỉ owner có credential production). **AI KHÔNG tự chạy** — không có credential, không gọi production.
>
> **Cách điền:** Mở **Supabase B SQL Editor** (project ref `aqozjkfwzmyfunqvcyjv`) → chạy từng query bên dưới (tất cả đều `SELECT` trên `information_schema`/`pg_catalog`/`pg_stat` — **read-only, không mutate**) → paste kết quả (CSV hoặc JSON) vào section tương ứng dưới mỗi query.
>
> **Sau khi điền đủ:** commit + push lên `v3/research-20260715`, rồi báo cho Fable 5 đọc file này TRƯỚC khi architect.
>
> **An toàn:** Không có query nào trong file này ghi/xóa/đổi dữ liệu. Không query giá trị cột nhạy cảm (email/token/secret) — chỉ metadata cấu trúc. `n_live_tup` (Q12) là thống kê ước lượng autovacuum, không phải đếm thật → đủ để ước size.

---

## Query 1 — Tất cả bảng public + trạng thái RLS

> **Quan trọng cho đề xuất V3 ① (RLS + phân quyền key).** Cột `rowsecurity`/`forcerowsecurity` cho biết bảng nào đã bật RLS.

```sql
SELECT tablename, rowsecurity, forcerowsecurity, tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

### Kết quả Q1

<!-- PASTE RESULTS HERE -->

---

## Query 2 — Tất cả cột của tất cả bảng (full picture)

> Cho Fable 3 biết chính xác mỗi bảng có cột gì, kiểu gì, nullable/default ra sao — thay vì đoán từ `.sql` repo (có drift: `is_section`, `materials`, `expected_start_date`, `is_published`).

```sql
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

### Kết quả Q2

<!-- PASTE RESULTS HERE -->

---

## Query 3 — Tất cả index

```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### Kết quả Q3

<!-- PASTE RESULTS HERE -->

---

## Query 4 — Tất cả constraint (PK / unique / FK / check)

> `contype`: `p`=primary key, `u`=unique, `f`=foreign key, `c`=check, `x`=exclude.
> Quan trọng: xác minh `UNIQUE(email, course_slug)` trên enrollments (invariant #1) và unique partial index 1-active-session/email (invariant #5) có thật trên production.

```sql
SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, contype, conname;
```

### Kết quả Q4

<!-- PASTE RESULTS HERE -->

---

## Query 5 — Tất cả RLS policy

> **Quan trọng nhất cho đề xuất V3 ①.** Hiện tại V1/V2 dùng service-role bypass RLS toàn bộ (SEC-09). Query này cho biết bảng nào đã có policy (vd `student_session_controls` được ghi nhận có RLS) để V3 biết điểm xuất phát.

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### Kết quả Q5

<!-- PASTE RESULTS HERE -->

---

## Query 6 — Tất cả function/RPC trong public

> Xác minh RPC `handle_student_session_login`, `reset_student_session_guard`, `cleanup_student_account_risk_events` có thật + `prosecdef` (SECURITY DEFINER?) + signature.

```sql
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS is_security_definer,
       p.proconfig,
       l.lanname AS language
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;
```

### Kết quả Q6

<!-- PASTE RESULTS HERE -->

---

## Query 7 — Grant trên function (ai được EXECUTE)

> **Blocker đã ghi trong Phụ lục F.10:** `handle_student_session_login` migration KHÔNG có `GRANT/REVOKE` → có thể đang `PUBLIC EXECUTE` (mặc định Postgres). Nếu thiếu grant `service_role`, Portal sẽ 42501 khi bật flag V2. V3 phải biết trạng thái thật.

```sql
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
ORDER BY routine_name, grantee;
```

### Kết quả Q7

<!-- PASTE RESULTS HERE -->

---

## Query 8 — Grant trên table (ai được select/insert/update/delete)

> **Quan trọng cho đề xuất V3 ①.** Cho biết role nào có quyền gì trên bảng nào — V3 sẽ thiết kế phân quyền `anon`/`authenticated`/`service_role` dựa trên điểm xuất phát này.

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
ORDER BY table_name, grantee, privilege_type;
```

### Kết quả Q8

<!-- PASTE RESULTS HERE -->

---

## Query 9 — Tất cả trigger

```sql
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

### Kết quả Q9

<!-- PASTE RESULTS HERE -->

---

## Query 10 — V2 outbox + identity tables có thật chưa?

> **Quan trọng cho đề xuất V3 ④ (outbox làm xương sống).** V2 commit migration `sync_outbox`/`identity_mapping` nhưng **chưa xác minh đã apply production**. Nếu chưa có → V3 phải apply trước hoặc thiết kế outbox từ đầu.

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'sync_outbox','sync_deliveries','sync_dead_letters',
    'course_slug_mappings','portal_post_course_mappings'
  )
ORDER BY tablename;
```

### Kết quả Q10

<!-- PASTE RESULTS HERE -->

---

## Query 11 — Cột identity V2 + cột drift V1 có thật chưa?

> Xác minh đồng thời: (a) cột identity V2 (`course_id`, `normalized_email`, `sync_correlation_id`, `kind`...) đã apply chưa; (b) cột drift V1 (`is_section`, `materials`, `expected_start_date`, `is_published`) có thật trên production không (code dùng nhưng `.sql` repo không có).

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('orders','student_enrollments','lessons','courses')
  AND column_name IN (
    'course_id','normalized_email','normalized_customer_email',
    'sync_correlation_id','source_system',
    'kind','parent_section_id','position',
    'is_section','materials',
    'expected_start_date','is_published'
  )
ORDER BY table_name, column_name;
```

### Kết quả Q11

<!-- PASTE RESULTS HERE -->

---

## Query 12 — Số dòng ước lượng các bảng (size, không đếm thật)

> `n_live_tup` = thống kê autovacuum (ước lượng, không full scan) → đủ để Fable 5 ước quy mô, không cần đếm chính xác. Nếu cần chính xác, owner chạy `SELECT count(*) FROM <table>` riêng (cân nhắc chi phí).

```sql
SELECT relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
```

### Kết quả Q12

<!-- PASTE RESULTS HERE -->

---

## Query 13 (tùy chọn) — Extensions đã cài

> V3 có thể cần `pgcrypto` (đã có), `pg_cron` (cho worker nền — đề xuất ⑤), `pg_net` (HTTP từ RPC). Cho biết điểm xuất phát.

```sql
SELECT extname, extversion
FROM pg_extension
ORDER BY extname;
```

### Kết quả Q13

<!-- PASTE RESULTS HERE -->

---

## Checklist sau khi điền

- [ ] Q1–Q12 đã paste kết quả (Q13 tùy chọn).
- [ ] Đã ghi chú rõ bất kỳ bảng/index/RPC/grant nào **thiếu** so với kỳ vọng trong `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` (đặc biệt: unique partial index `idx_one_active_student_session_per_email`, grant `service_role` cho `handle_student_session_login`, V2 outbox tables).
- [ ] Commit + push lên `v3/research-20260715` với message: `docs(v3): fill production schema snapshot`.
- [ ] Báo cho Fable 5 đọc file này + `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` trước khi architect.

> **Ghi chú quyền riêng tư:** Không paste giá trị cột dữ liệu thật (email/token/IP học viên). Chỉ paste metadata cấu trúc (tên bảng/cột/index/RPC/grant) và số dòng ước lượng. Query trong file này không trả dữ liệu hàng.
