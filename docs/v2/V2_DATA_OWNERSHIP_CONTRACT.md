# V2 Data Ownership Contract

## Supabase B: canonical source of truth

Supabase B / LMS & Checkout là nguồn chính cho:

- `courses`
- `orders`
- `students`
- `student_enrollments`
- `lessons`
- `lesson_progress`
- `student_active_sessions`
- `lms_entry_tokens`
- `lms_verified_sessions`
- `drive_permission_logs`
- `drive_admin_accounts`
- `sync_outbox`
- `sync_deliveries`
- `sync_dead_letters`

Các hệ khác không được tự quyết định quyền học nếu dữ liệu mâu thuẫn với Supabase B.

## Supabase A: legacy Portal projection

Supabase A là hệ legacy/post projection:

- `posts`
- `post_views`
- portal-side `student_enrollments` cũ nếu còn dùng.

Supabase A có thể phục vụ giao diện Portal, nhưng V2 phải coi đây là projection. Khi lệch dữ liệu, reconciliation phải tạo report hoặc repair task thay vì coi A là nguồn cuối.

## Shop

Shop được phép ghi:

- course metadata bán hàng qua API Shop.
- order/checkout.
- sync event vào `sync_outbox` ở shadow hoặc V2 mode.

Shop không được tự chỉnh trực tiếp LMS session, Drive permission, hoặc Portal projection ngoài các API/worker đã chuẩn hóa.

## Portal

Portal được phép:

- đọc quyền học từ Supabase B server-side.
- tạo entry token thông qua bảng `lms_entry_tokens`.
- ghi event session/risk đã sanitize.

Portal không được ghi raw token, không quyết định course content, không sửa order.

## LMS

LMS được phép:

- quản lý course/lesson/enrollment runtime.
- verify token/session.
- vận hành Drive permission.
- xử lý outbox/reconciliation/repair khi V2 bật.

## Quy tắc repair

- Repair phải có dry-run.
- Repair tác động enrollment/order/Drive phải có audit log.
- Không auto-revoke học viên khi phát hiện mâu thuẫn nghiêm trọng; chuyển sang trạng thái cần admin kiểm tra.
