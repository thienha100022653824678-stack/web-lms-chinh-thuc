# V2 Implementation Status

## Baseline

- V1 stable tag: `v1-stable-20260713`
- V2 branch: `v2/platform-rebuild`
- Runtime source of truth: Supabase B / LMS & Checkout
- Supabase B project ref: `aqozjkfwzmyfunqvcyjv`

## Đã hoàn thành

### Shop

- `8e45899 chore: initialize V2 rollout baseline`
  - Thêm tài liệu rollout và feature flag V2.
- `dbba90c chore: add V2 outbox helpers`
  - Thêm helper enqueue outbox.
- `62880be chore: shadow-write shop sync events to V2 outbox`
  - Shadow-write course/enrollment sync event khi `V2_OUTBOX_SHADOW_MODE` bật.
  - Mặc định không đổi behavior V1.

### Portal

- `7134019 chore: initialize V2 rollout baseline`
  - Thêm tài liệu rollout và feature flag V2.
  - Lưu ý: repo Portal còn một file dirty có sẵn `src/lib/session-guard.ts`, không thuộc V2 baseline commit.

### LMS

- `0029f47 chore: initialize V2 rollout baseline`
  - Thêm tài liệu rollout và feature flag V2.
- `41808c6 chore: add V2 sync outbox migration`
  - Thêm migration `migration_v2_sync_outbox.sql`.
- `7f37cdc chore: add V2 outbox helpers`
  - Thêm helper enqueue outbox và flag shadow mode.

## Đang làm

- `migration_v2_identity_mapping.sql`
  - Thêm nền canonical identity/mapping.
  - Chưa apply database.
  - Chưa bật runtime.

## Chưa làm

- Worker xử lý `sync_outbox`.
- Reconciliation dry-run.
- Session lease V2 tách khỏi auth session.
- Token consume atomic trong RPC.
- Drive permission job queue.
- Admin dashboard V2.
- CI/test matrix đầy đủ.

## Blocker hiện tại

- Chưa có môi trường staging tách biệt để test migration và worker V2.
- Chưa apply các migration V2 mới lên database.
