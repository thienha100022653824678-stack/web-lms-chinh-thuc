# V2 Migration Plan

## Nguyên tắc

- Chỉ additive trong giai đoạn nền.
- Migration phải chạy lại được nếu có thể.
- Không drop/rename field V1.
- Không apply production khi chưa có preflight.

## Migration hiện có trên branch V2

### `migration_v2_sync_outbox.sql`

Tạo:

- `sync_outbox`
- `sync_deliveries`
- `sync_dead_letters`

Trạng thái: chưa apply trong V2 branch context.

### `migration_v2_identity_mapping.sql`

Tạo/bổ sung:

- `orders.course_id`
- `orders.normalized_customer_email`
- `orders.sync_correlation_id`
- `student_enrollments.normalized_email`
- `student_enrollments.sync_correlation_id`
- `lessons.kind`
- `lessons.parent_section_id`
- `lessons.position`
- `course_slug_mappings`
- `portal_post_course_mappings`

Backfill an toàn dựa trên `course_slug` case-insensitive.

Trạng thái: chưa apply.

## Preflight bắt buộc

1. Xác nhận Supabase project ref `aqozjkfwzmyfunqvcyjv`.
2. Snapshot schema bảng liên quan.
3. Chạy migration trong transaction nếu SQL editor hỗ trợ.
4. Kiểm tra không có lỗi reference/constraint.
5. Query count mapping sau apply.

## Postflight

```sql
select count(*) from sync_outbox;
select count(*) from course_slug_mappings;
select count(*) from portal_post_course_mappings;
select count(*) from orders where course_slug is not null and course_id is null;
select count(*) from student_enrollments where course_slug is not null and course_id is null;
select count(*) from lessons where course_slug is not null and course_id is null;
```

Các count `course_id is null` không nhất thiết phải bằng 0 nếu có slug rác, nhưng phải được đưa vào reconciliation report.
