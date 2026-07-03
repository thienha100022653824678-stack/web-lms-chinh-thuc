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
