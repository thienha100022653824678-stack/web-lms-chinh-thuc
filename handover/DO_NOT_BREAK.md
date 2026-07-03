# Project Handover: DO_NOT_BREAK.md

This document lists critical components, configurations, and logic paths that must remain untouched to prevent production failures.

---

## 🔒 1. Google OAuth & Session System
- **Google GSI SDK Script**: The client-side libraries loaded in `lms.html` and `lesson.html` headers must not be modified or replaced with older auth models.
- **Signed Session Cookie**: The token key name `course_session_token` and JWT generation keys on the server (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SESSION_SECRET`) must be preserved. Any alteration will log out all students and block new sign-ins.

## 🧮 2. Backend Numbering Algorithm (`displayLesson`)
- **Do Not Change Calculation Logic**: The algorithm calculating relative offsets (resetting to 1 after `is_section = true` matches) must be identical in:
  - `/api/lms/portal?endpoint=course-data`
  - `/api/lms/portal?endpoint=lesson`
  - `/api/lms/admin?endpoint=lessons`
- **Why**: Mismatches between these files will cause a lesson to show one number in the catalog and another in the detail view, violating UI specifications.

## 🧭 3. Detail Page Navigation Sibling Filter
- **Do Not Remove Sibling Filters**: The code `courseLessonsList.filter(l => !l.isSection)` in `lesson.html` prevents navigation buttons from linking to non-lesson Chapter Sections. Removing this filter will break the redirect system.

## 🎨 4. CSS Style Rules & Watermarks
- **Dynamic Watermark Overlays**: The script in `lesson.html` inserts overlay divs with student emails and timestamps over Bunny Stream containers. Changing the layout classes (`absolute`, `pointer-events-none`) or properties might allow piracy tools to hide watermarks.
- **CDN Scripts**: Tailwind CSS CDN and Google fonts are imported directly. Do not remove or block external stylesheets as it will break the look and feel.

## ⚙️ 5. Database Schema & Supabase Client
- **Flat Lesson Structure**: The system treats chapters as records in `lessons` where `is_section` is true. Do not separate sections into a new SQL table unless you rewrite all ordering, listing, and CRUD endpoints.
- **Supabase Pool Configuration**: `utils/supabase.js` pools connections. Do not instantiate client pools in loop closures inside serverless routes.

## 6. Two-Supabase Boundary
- **Runtime code note**: This repo currently shows one runtime Supabase client through `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- **Operating architecture note**: The broader system has two Supabase databases:
  - Supabase A: Student Portal / old portal content, `posts`, `post_views`, portal `student_enrollments`.
  - Supabase B: LMS & Checkout, `courses`, `orders`, `lessons`, `students`, LMS `student_enrollments`, `site_config`, `lesson_progress`.
- **Before any database-sensitive edit**, explicitly identify whether the change touches Supabase A, Supabase B, or the sync boundary between them.
- **Do not casually edit without an explicit request**:
  - `/api/sync`
  - `orders`
  - `source_order_id`
  - `student_enrollments`
  - `course_slug` mapping
  - `sync_lms_status`
  - `sync_portal_status`
  - `sync_error`
  - `lessons.is_section`
  - `lessons.materials`
- **Risks**:
  - Confusing the old Portal database with the LMS/Checkout database.
  - Confusing `student_enrollments` in Supabase A with `student_enrollments` in Supabase B.
  - Confusing `course_slug` across `posts`, `courses`, `lessons`, and `orders`.
  - Breaking sync can remove or fail to grant student access.
  - Breaking `is_section` can corrupt Chapter/Lesson display and navigation.
  - Breaking `materials` can hide or lose attached documents.
- **Secret handling**: Never paste Supabase keys, service role keys, anon keys, or pulled env values into handover docs, terminal summaries, commits, or chat.
