# Project Handover: BUG_STATUS.md

This document tracks known resolved bugs, current bugs, and potential issues for the next session.

---

## 1. Resolved Bugs

### 🐛 Bug 1: Supabase Unique Constraint Violation on `lesson_no`
- **Symptom**: When creating or drag-and-drop sorting lessons/sections in Admin, saving failed with server error: `duplicate key value violates unique constraint "lessons_course_slug_lesson_no_key"`.
- **Cause**: The database schema enforces a unique constraint on `(course_slug, lesson_no)`. The admin UI was trying to save visual chapter numbers into `lesson_no` (which reset to 1 at each section), causing collisions.
- **Resolution**:
  - The database `lesson_no` is kept as a strict, sequential, unique integer (e.g. 1, 2, 3, 4, 5...) that tracks the order.
  - The frontend display index (`Bài 1`, `Bài 2`...) is calculated dynamically on the server and returned as `displayLesson` using the section hierarchy.
  - Sibling count and auto-indexing logic on the backend resolves collisions automatically during creations.

### 🐛 Bug 2: Lesson Number Mismatch (Catalog vs. Detail Page)
- **Symptom**: A lesson (e.g. "Lý thuyết bánh mì") would show as **Bài 1** in the course list, but when clicked, the badge on `lesson.html` would display **Bài 2**.
- **Cause**: The course listing page (`lms.html`) calculated numbers dynamically, but the single lesson API (`utils/lms-handlers/lesson.js`) returned the raw database `lesson_no` without chapter offset adjustments.
- **Resolution**: Both `/api/lms/portal?endpoint=course-data` and `/api/lms/portal?endpoint=lesson` now query the course's sibling list and compute the dynamic section-relative `displayLesson` using the same matching logic.

### 🐛 Bug 3: Navigation Button "Bài Trước" Unresponsive
- **Symptom**: Pressing the "Bài Trước" (Previous) button on a lesson did not do anything if a Chapter/Section header lay immediately before it in the list.
- **Cause**: The script was redirecting to the database sibling immediately preceding the current item. Since the preceding item was a section container (`isSection: true`), it lacked a lesson ID, resulting in a dead link.
- **Resolution**: The navigation array on `lesson.html` is now filtered to exclude sections (`courseLessonsList.filter(l => !l.isSection)`), ensuring navigation only targets actual lesson IDs.

---

## 2. Currently Known & Suspected Issues

### Env Setup Gap: Google Service Account and Bunny Token
- **Status**: Known setup gap, not an app-code regression.
- **Current state**: `.env.local` is ignored by Git and local core env is present enough for `vercel dev`; `/api/lms/portal` no longer crashes from missing Supabase env.
- **Missing env names**:
  - `GOOGLE_CLIENT_EMAIL`
  - `GOOGLE_PRIVATE_KEY`
  - `BUNNY_STREAM_TOKEN_KEY`
- **Impact**:
  - Google Drive/Docs recipe/media fetching needs the Google Service Account email/private key.
  - Bunny secured video signing needs the Bunny stream token key if secured Bunny videos are used.
- **Next check**: After adding the missing env values, share the course Drive folder with the service account email and re-test Google Docs/Drive recipe/media plus Bunny secured playback.
- **Security note**: Do not write secret values into this handover.

### 🔍 Suspected Issue 1: External Media CORS / Iframe restrictions
- **Symptom**: If the user embeds external links in the lesson content, some browsers might restrict embedding or raise CORS issues.
- **Suggestion**: Keep utilizing the secure custom player (`gdrive-player.html`) for Google Drive files, and enforce `target="_blank"` on links to ensure external resources open in new tabs rather than failing in frames.

### 🔍 Suspected Issue 2: Empty Course Crash
- **Symptom**: If a course slug has zero lessons or all lessons are marked `status: "hidden"`, the page layout could break.
- **Suggestion**: Ensure proper fallback HTML is rendered if the list length is 0 (already implemented in `lms.html`).
