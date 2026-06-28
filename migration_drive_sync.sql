-- Chạy đoạn script này trên Supabase B (Cơ sở dữ liệu của LMS daubepnho.store)

-- 1. Tạo bảng drive_permission_logs để ghi log phân quyền Drive
CREATE TABLE IF NOT EXISTS drive_permission_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time TIMESTAMPTZ DEFAULT now(),
  course_slug TEXT NOT NULL,
  folder_id TEXT,
  email TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create' hoặc 'revoke'
  status TEXT NOT NULL, -- 'SUCCESS' hoặc 'FAILED'
  message TEXT,
  request_id TEXT
);

-- 2. Tạo bảng drive_sync_queue để lưu các yêu cầu phân quyền bị lỗi cần retry sau
CREATE TABLE IF NOT EXISTS drive_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create' hoặc 'revoke'
  attempts INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
