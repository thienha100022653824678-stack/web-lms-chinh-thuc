# V2 Rollback Runbook

## Rollback code

V1 ổn định đã có tag:

```powershell
git checkout v1-stable-20260713
```

Production hiện không tự chạy V2 branch. Nếu đã deploy V2 preview/canary, rollback bằng cách:

1. Tắt feature flags V2 trong Vercel.
2. Redeploy branch production V1.
3. Kiểm tra Shop, Portal, LMS smoke test.

## Rollback feature flag

Tắt các flag theo thứ tự:

1. `V2_PLATFORM_ENABLED=false`
2. `V2_OUTBOX_SHADOW_MODE=false`
3. `V2_SESSION_LEASE_ENABLED=false`
4. `V2_DRIVE_WORKER_DRY_RUN=true`
5. `V2_RECONCILIATION_READONLY=true`

## Rollback database

Các migration V2 hiện tại additive, nên rollback runtime thường không cần drop table/cột. Không drop dữ liệu V2 khi chưa có backup.

Nếu cần rollback schema để debug staging, chỉ làm ở môi trường không production:

- drop worker-only tables sau khi export.
- không drop cột bổ sung trên bảng V1 nếu code V1 bỏ qua chúng.

## Smoke test sau rollback

- Shop landing `/ ?course=...`
- Shop admin/orders.
- Portal `/my-courses`.
- Portal `/post/[id]`.
- LMS `lms.html?course=...`.
- LMS `lesson.html`.
- Admin LMS enrollment/Drive retry.
