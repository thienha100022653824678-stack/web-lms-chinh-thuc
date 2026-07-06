# Project Handover: FILES_CHANGED.md

This document tracks all files modified during the styling, numbering, and navigation refactoring.

---

## Final Codex/Coex to Antigravity Update - 2026-07-06
- Latest pushed commit: `7d5e92b3a5cf8022865cf1798500237078ab19e8`
- Commit message: `chore: add Drive refresh token helper script`
- Git status at handover: branch `main`, local even with `origin/main`, working tree clean, no untracked files.
- Recent Codex/Coex work covered:
  - Student LMS link/chapter/lesson numbering.
  - `student_display_title` and course title separation.
  - Recipe sync to Student Portal.
  - Media bulk upload.
  - Media captions.
  - Drive admin permission pool.
  - Google Drive cookie guidance.

### New Operations Script
- File: `scripts/generate-drive-refresh-token.js`
- Purpose: create a Google OAuth URL, receive the local callback, and exchange the OAuth code for a Drive admin `refresh_token`.
- The script does not contain a real token.
- When run, it prints the generated refresh token in the local terminal.
- Real tokens must only be configured in Vercel ENV:
  - `DRIVE_ADMIN_1_REFRESH_TOKEN`
  - `DRIVE_ADMIN_2_REFRESH_TOKEN`
  - `DRIVE_ADMIN_3_REFRESH_TOKEN`

### Migration Note
- File: `migration_drive_admin_pool.sql`
- Run this migration against Supabase if the Drive admin permission pool tables/status fields have not already been applied.

## 1. Backend API Handlers

### 📄 [`utils/lms-handlers/course-data.js`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/utils/lms-handlers/course-data.js)
- **Role**: Backend endpoint for course catalogs (`lms.html`).
- **Changes**:
  - Implemented `displayLesson` calculation algorithm: checks if the course has any section, loops through sibling lessons, resets index to 1 at each new section, and assigns relative display indexes.
- **Next Dev Note**: If you add filters to hidden lessons, remember to filter first, then compute the numbering to avoid indexing gaps.

### 📄 [`utils/lms-handlers/lesson.js`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/utils/lms-handlers/lesson.js)
- **Role**: Backend endpoint for single-lesson views (`lesson.html`).
- **Changes**:
  - Added query to sibling lessons of the same course slug, computed the exact section-relative `displayLesson` offset for the requested lesson, and returned it in the JSON response payload.
- **Next Dev Note**: Keep DB query optimized by retrieving only required fields (`id`, `is_section`) during offset computation.

### 📄 [`utils/lms-handlers/admin-lessons.js`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/utils/lms-handlers/admin-lessons.js)
- **Role**: Backend handler for the admin dashboard editor list (`lms-admin.html`).
- **Changes**:
  - Computes and returns the `displayLesson` for all lessons in the course during GET calls.
- **Next Dev Note**: Keep this synced if any changes are made to how sections are sorted.

---

## 2. Frontend Templates

### 2026-07-03 Codex Commit
- **Commit**: `c5f87d2a1f20302e8f37baaafa820fca810cd33c`
- **Message**: `feat: shorten displayed links and show lesson chapter header`
- **Pushed to**: `origin/main`
- **Production deploy**: Ready.
- **Files changed in this commit only**: `index.html`, `lms.html`, `lesson.html`.
- **No app code outside those files was changed in that commit.**

### 📄 [`lms.html`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/lms.html) (and synchronized [`index.html`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/index.html))
- **Role**: Student homepage course catalog.
- **Changes**:
  - Prioritizes the backend-calculated `displayLesson` value in dynamic badge rendering.
  - Modified text link conversion helper (`linkifyTextSafe`) to display the original URL text.
  - 2026-07-03: Linkify display text now shortens long URLs while preserving the original href. `index.html` was synced because it is the production `/` mirror for the student catalog.

### 📄 [`lesson.html`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/lesson.html)
- **Role**: Student detailed lesson page (contains player, recipe, and sidebar).
- **Changes**:
  - Displays the correct `displayLesson` index inside the banner title and sidebar directory listing.
  - Refactored `prevBtn` and `nextBtn` callbacks to filter out section headers and skip dead links.
  - Added wrapper IDs (`recipeSectionBox`, `lessonDescriptionBox`) to easily hide cards when empty.
  - Updated `linkifyTextSafe` to show raw URL content instead of replacing with "Mua nguyên liệu tại đây" buttons.
  - 2026-07-03: Linkify display text now shortens long URLs while preserving the original href.
  - 2026-07-03: Added current chapter header display for lessons that belong to a section. Mobile classes avoid overflow/wrapping issues with long chapter names.
  - Removed "In công thức" button.
- **Next Dev Note**: Add anti-copy listeners to this page.

### 📄 [`lms-admin.html`](file:///C:/Users/gaomi/Downloads/Telegram%20Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/lms-admin.html)
- **Role**: CMS Dashboard.
- **Changes**:
  - Updated the catalog listing function to display the backend-calculated `displayLesson` inside item badges.
