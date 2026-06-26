-- =========================================================================
-- DATABASE MIGRATION SCRIPT FOR SUB COURSE (YEUBEP.SHOP) INTEGRATION
-- Copy and run this script in your Supabase SQL Editor (Dashboard > SQL Editor)
-- =========================================================================

-- 1. Create posts table if it does not exist yet (matching yeubep.shop schema)
CREATE TABLE IF NOT EXISTS posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  recipe TEXT NOT NULL, -- Stores formula/details (HTML or Markdown)
  images TEXT[] DEFAULT ARRAY[]::TEXT[], -- Stores list of public image/video URLs
  views INTEGER DEFAULT 0 NOT NULL, -- Stores aggregate unique view counts
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add sub-course integration columns if they do not exist
ALTER TABLE posts ADD COLUMN IF NOT EXISTS course_slug TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hero_media_url TEXT; -- Primary video or image URL

-- 3. Create index for performance
CREATE INDEX IF NOT EXISTS idx_posts_course_slug ON posts(course_slug);
