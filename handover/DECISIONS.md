# Project Handover: DECISIONS.md

This document outlines key technical and architectural decisions made during development.

---

## 1. Separation of DB Ordering (`lesson_no`) and Visual Numbering (`displayLesson`)
- **Context**: The database enforces a unique constraint on `(course_slug, lesson_no)`. Initially, resetting lesson numbers back to 1 for each new chapter caused index collisions in PostgreSQL.
- **Decision**: Keep `lesson_no` as a monotonic, sequential, unique ordering index (e.g. 1, 2, 3, 4, 5...) in Supabase. The backend API handles the dynamic conversion into `displayLesson` at runtime based on the presence of section rows.
- **Why**: Avoids database constraints errors during reordering/deletions, keeps drag-and-drop logic simple, and guarantees that numbers are calculated consistently in all views.

## 2. Server-side Calculation of Dynamic Indexes
- **Context**: A student might land on `lesson.html?id=<uuid>` directly (from a bookmark or link) without loading the course catalog (`lms.html`).
- **Decision**: All lesson indexing is calculated on the server side (`utils/lms-handlers/course-data.js` and `utils/lms-handlers/lesson.js`).
- **Why**: Frontend-only calculation would fail to determine the correct lesson number when a single lesson details page is loaded standalone.

## 3. Flat Database Schema for Course Sections
- **Context**: Representing course chapters and sub-lessons.
- **Decision**: Keep a flat schema in the `lessons` table with an `is_section` boolean flag instead of creating a separate `sections` table with nested foreign keys.
- **Why**: Keeps database migrations simple. Drag-and-drop reordering is executed via a single column update (`lesson_no`). Collapsing chapters is easily resolved in JavaScript by iterating over the ordered array.

## 4. Google OAuth Cookie Sessions
- **Context**: Session persistence across page redirects.
- **Decision**: Save a signed JWT inside `course_session_token` cookie when Google One Tap completes. The cookie is verified on every backend API request.
- **Why**: Restores session instantly across different HTML pages (`index.html`, `lms.html`, `lesson.html`) without depending on localStorage or forcing students to re-login repeatedly.
