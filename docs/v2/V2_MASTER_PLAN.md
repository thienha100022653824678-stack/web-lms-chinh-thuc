# V2 Master Plan

## Mục tiêu

V2 được xây trên branch riêng `v2/platform-rebuild` để V1 production tiếp tục chạy bình thường. V1 đã được đánh dấu bằng tag `v1-stable-20260713` ở cả Shop, Portal và LMS.

V2 không cutover bằng big-bang. Mọi thay đổi phải theo thứ tự:

1. Migration additive.
2. Code ghi shadow/dual-write sau feature flag.
3. Worker hoặc job chạy dry-run.
4. Reconciliation so sánh V1/V2.
5. Canary với tài khoản/khóa test.
6. Cutover bằng feature flag khi chủ dự án xác nhận.
7. Giữ đường rollback về V1.

## Phạm vi hệ thống

- Shop: bán hàng, checkout, orders, course admin, sync outbound.
- Portal: Google login, my-courses, post, entry token, session guard.
- LMS: source of truth Supabase B, lesson/admin, Drive, session, risk, sync worker.

## Ưu tiên triển khai

1. Foundation: V2 flags, outbox schema, shadow outbox writes, identity mapping.
2. Session V2: active-device lease tách khỏi auth session, token consume atomic, session generation.
3. Sync V2: worker xử lý outbox, delivery state, dead-letter, retry.
4. Reconciliation: dry-run và report sai lệch giữa Shop, LMS, Portal.
5. Drive V2: job queue, account health, folder/file ancestry check.
6. Risk V2: risk summaries incremental, retention, false positive lifecycle.
7. Admin UI: dashboard outbox/reconciliation/drive/risk.
8. Cutover runbook và rollback drill.

## Quy tắc bất biến

- Không xóa hoặc rename field V1.
- Không đổi slug hàng loạt.
- Không log secret, token, service role key, private key.
- Không commit thư mục local như `scratch/` hoặc `review-dossier-session-guard/`.
- Không bật V2 production toàn hệ thống khi chưa có xác nhận cuối.
