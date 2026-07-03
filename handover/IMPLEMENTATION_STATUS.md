# Project Handover: IMPLEMENTATION_STATUS.md

This document summarizes the current status of all features in the LMS system as of the latest verified production commit `c5f87d2a1f20302e8f37baaafa820fca810cd33c`.

---

## 1. Feature Status Summary

| Feature Name | Status | Files Involved | Description & Notes |
| :--- | :---: | :--- | :--- |
| **Google OAuth & Session Verification** | ✅ | `lms.html`, `lesson.html`, `utils/lms.js`, `utils/lms-handlers/course-data.js` | Uses Google GSI with custom Vercel backend JWT verification. Cookie `course_session_token` keeps session alive for 30 days. Robust and secure. |
| **Collapsible Accordion Chapters** | ✅ | `lms.html`, `lesson.html`, `lms-admin.html` | Groups lessons under collapsible headings. Sidebar in `lesson.html` shows folders, Admin dashboard shows green banner separators. |
| **Dynamic Lesson Numbering** | ✅ | `utils/lms-handlers/course-data.js`, `utils/lms-handlers/lesson.js`, `utils/lms-handlers/admin-lessons.js`, `lms.html`, `lesson.html`, `lms-admin.html` | Calculates `displayLesson` in the backend so lessons restart from 1 under each Section. Fallback to sequential counting if no sections exist. 100% consistent across all views. |
| **Lesson Detail Prev/Next Nav** | ✅ | `lesson.html` | "Bài Trước" and "Bài Tiếp Theo" links navigate between real lessons only, completely skipping Chapter Sections. Disables "Bài Trước" at the first real lesson. |
| **Empty Content Auto-Hide** | ✅ | `lesson.html` | Automatically hides video players, recipe cards, description blocks, or media container grids if they are empty or null. |
| **Linkify URLs in Content** | ✅ | `lesson.html`, `lms.html` | Converts plain text URLs in recipes/descriptions into clickable links. Shows raw URL or entered text instead of replacing it with "Mua nguyên liệu tại đây" button. |
| **Print Button Removal** | ✅ | `lesson.html` | Removed the "In công thức" button and aligned the "CÔNG THỨC CHI TIẾT" title block cleanly. |
| **Lock copy text on student LMS** | ✅ | `lms.html`, `lesson.html` | Disabled selection, right-click context menu, touch hold selection on mobile, and key shortcuts (Ctrl+C, Ctrl+X, Ctrl+A, Ctrl+U, F12) globally across pages. |
| **Lesson Documents/Attachments** | 🔴 | `lms-admin.html`, `lesson.html`, `utils/lms-handlers/admin-lessons.js`, `utils/lms-handlers/lesson.js` | **NOT IMPLEMENTED / REVERTED**. Needs to allow admins to upload or link documents (PDF, Word, Excel, Docs) and display them to students under a dedicated container. |

---

## 2. Details of Key Statuses

### Codex Takeover Update - 2026-07-03
- **Pushed commit**: `c5f87d2a1f20302e8f37baaafa820fca810cd33c`
- **Commit message**: `feat: shorten displayed links and show lesson chapter header`
- **Git state after push**: clean working tree; local `main` is even with `origin/main`.
- **Production deploy**: Ready.
- **Production aliases verified**:
  - `https://web-lms-chinh-thuc.vercel.app`
  - `https://daubepnho.store`
  - `https://www.daubepnho.store`
- **Production routes verified**:
  - `/` returns 200
  - `/lms.html` returns 200
  - `/lesson.html` returns 200
  - `/api/lms/portal?endpoint=public-config` returns 200
- **Scope of pushed change**:
  - `index.html`, `lms.html`: synced linkify behavior so displayed URLs are shortened while the original `href` remains intact.
  - `lesson.html`: same linkify behavior plus a lesson chapter header that shows the current chapter when the lesson belongs to a section; mobile layout was adjusted to avoid overflow on long chapter names.

### Local Environment Status - 2026-07-03
- `.env.local` is ignored by Git and is not tracked.
- Core local env is present enough to run `vercel dev`.
- `/api/lms/portal` no longer crashes because of missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.
- If `vercel dev` does not automatically load `.env.local` into serverless function runtime, load env values into the current process first, then start `vercel dev`.
- Do not write secret values into handover docs or logs.

### Missing Local/Deployment Env Notes - 2026-07-03
- `GOOGLE_CLIENT_EMAIL` is still missing.
- `GOOGLE_PRIVATE_KEY` is still missing.
- `BUNNY_STREAM_TOKEN_KEY` is still missing.
- `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` are needed for Google Service Account based Google Drive/Docs recipe/media fetching.
- `BUNNY_STREAM_TOKEN_KEY` is needed only if Bunny secured video URL signing is used.

### ✅ Google OAuth & Session Verification
- **Status**: Stable. The session is restored automatically via cookies. Google One Tap or Google Sign-in button is displayed if the cookie is expired or missing. 100% functional.

### ✅ Dynamic Lesson Numbering
- **Status**: Stable and uniform. The backend calculation ensures that no matter where the data is retrieved (`course-data`, `lesson`, or `admin-lessons`), the dynamic display index is identical. This avoids mismatches between the listing catalog and detail views.

### 🔴 Reverted Features (Need Implementation)
- **Documents & Attachments**: This was removed during a rollback. Needs DB columns updates or JSON structure mapping, admin upload logic, and student-facing download buttons.
