# V2 Sync Design

## Vấn đề V1

V1 gọi trực tiếp LMS và Portal từ request admin/checkout. Nếu một target lỗi, trạng thái dễ lệch hoặc request admin chậm.

## Mục tiêu V2

V2 chuyển side effect sang outbox:

1. Request chính cập nhật source of truth.
2. Request chính ghi event vào `sync_outbox`.
3. Worker xử lý delivery tới LMS/Portal/Drive.
4. Mỗi target có record riêng trong `sync_deliveries`.
5. Retry có backoff; quá số lần thì đưa vào `sync_dead_letters`.

## Event ban đầu

- `course.upserted`
- `course.published`
- `enrollment.upserted`
- `enrollment.revoked`
- `order.approved`
- `order.rejected`
- `drive.permission.requested`

## Shadow mode

`V2_OUTBOX_SHADOW_MODE=true` chỉ ghi thêm outbox event, không thay flow V1. Đây là bước đầu để kiểm tra payload, idempotency key và volume.

## Idempotency

Mỗi event cần `idempotency_key` ổn định theo:

- source system
- event type
- aggregate type/id
- updated_at hoặc version

Worker phải xử lý được việc nhận lại cùng event nhiều lần.
