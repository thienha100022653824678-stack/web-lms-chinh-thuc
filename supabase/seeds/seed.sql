-- supabase/seeds/seed.sql
-- V3 Phase 1 (⑦) — sample seed data, LOCAL / PREVIEW ONLY.
--
-- NEVER run this against production Supabase B. Seed is applied only by
-- `supabase db seed` on an ephemeral/local/preview database. The CI drift gate
-- checks migrations (DDL) only; this seed is not part of the drift comparison.
--
-- Lifted verbatim from supabase_schema.sql (the two sample courses) so that the
-- schema file can become pure DDL history and business data stays out of any
-- migration applied to production.

INSERT INTO courses (slug, title, price, image_url, active, sort_order, raw_data)
VALUES (
  'donut',
  'Pinterest Food Studio — Bánh Donut',
  '199.000đ',
  'https://images.unsplash.com/photo-1530601761230-c71509743e42?auto=format&fit=crop&q=80&w=800',
  true,
  1,
  '{
    "bankName": "MB Bank (Ngân hàng Quân đội)",
    "bankAccount": "0999999999",
    "bankOwner": "NGUYEN VAN A",
    "transferNote": "DONUT GMAIL_CUA_BAN",
    "qrImageUrl": "https://img.vietqr.io/image/MB-0999999999-compact.png?amount=199000&addInfo=DONUT"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO courses (slug, title, price, image_url, active, sort_order, raw_data)
VALUES (
  'banh-mi',
  'Khóa Học Bánh Mì Việt Nam Chuẩn Vị',
  '299.000đ',
  'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80&w=800',
  true,
  2,
  '{
    "bankName": "Techcombank",
    "bankAccount": "1903456789012",
    "bankOwner": "NGUYEN VAN A",
    "transferNote": "BANHMI GMAIL_CUA_BAN",
    "qrImageUrl": "https://img.vietqr.io/image/TCB-1903456789012-compact.png?amount=299000&addInfo=BANHMI"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
