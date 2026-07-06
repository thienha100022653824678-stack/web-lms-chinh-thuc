# Project Handover: NEXT_SESSION_PROMPT.md

Copy and paste the prompt below into the next Antigravity / AI assistant session to resume development immediately.

---

```markdown
You are an expert AI software engineer taking over a premium Learning Management System (LMS) codebase for a Culinary Academy (running on daubepnho.store).

Your goal is to continue development, maintenance, and features implementation without breaking existing setups.

### 1. Read Handover Documentation First
All documentation is located in the `handover/` folder at the project root:
- `handover/PROJECT_OVERVIEW.md`: General architecture, stack, folders, and flow.
- `handover/IMPLEMENTATION_STATUS.md`: Implemented vs pending feature list.
- `handover/BUG_STATUS.md`: Known bugs resolved and current observations.
- `handover/DECISIONS.md`: Design choices made (such as flat schema and server-calculated lesson numbers).
- `handover/TODO.md`: Next tasks to build.
- `handover/FILES_CHANGED.md`: Summary of backend and frontend edits.
- `handover/ARCHITECTURE.md`: Database structure, API endpoints, and authentication flow.
- `handover/TESTING_CHECKLIST.md`: Verification list for checking feature compliance.
- `handover/DO_NOT_BREAK.md`: Critical configurations and logical code paths.

### 2. Core Architecture Rules
- **Google OAuth / GSI**: Do not modify client-side Google SDK inclusions or change the signed cookie `course_session_token` validation. This keeps students logged in.
- **Lesson Numbering (displayLesson)**: Sibling lessons under each collapsible Chapter Section are labeled `Bài 1`, `Bài 2`, etc. This numbering index is calculated dynamically on the server-side API endpoints (`course-data.js` and `lesson.js`) so that it remains uniform across listing page, detail view, sidebar list, and admin dashboard.
- **Database Ordering (lesson_no)**: Sequential, unique integers track database records and ordering inside Supabase. Never save resets (starting from 1) directly into database `lesson_no` column to avoid unique constraint key collisions.
- **Two Supabase Operating Architecture**: Repo runtime currently shows one Supabase client via `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. The confirmed current runtime target is Supabase B - LMS & Checkout (`aqozjkfwzmyfunqvcyjv`, `thienha336501903-a11y's Org`). The broader system also has Supabase A, the old Student Portal/post database (`posts`, `post_views`, portal `student_enrollments`). Before database or sync changes, identify whether the change affects Supabase A, Supabase B, or the sync boundary.
- **Do Not Touch Without Explicit Request**: `/api/sync`, `orders`, `source_order_id`, `student_enrollments`, `course_slug` mapping, `sync_lms_status`, `sync_portal_status`, `sync_error`, `lessons.is_section`, and `lessons.materials`.

### 3. Final Codex/Coex to Antigravity Baseline
This handover is from Codex/Coex back to Antigravity.

Current verified baseline:
- Latest pushed commit: `7d5e92b3a5cf8022865cf1798500237078ab19e8`
- Commit message: `chore: add Drive refresh token helper script`
- Git state after push:
  - Branch: `main`
  - Local `main` is even with `origin/main`
  - Working tree is clean
  - No untracked files
- Production deploy was triggered by the push. Verify current deployment status before making new production changes.
- `.env.local` is ignored by Git and is not tracked.
- Never print or commit secret values.
- Current production/runtime Supabase has been confirmed as Supabase B:
  - Project ref: `aqozjkfwzmyfunqvcyjv`
  - Org: `thienha336501903-a11y's Org`
- Supabase A remains the old Portal/legacy database. Do not confuse Supabase A and Supabase B.

Recent Codex/Coex work:
- Student LMS link/chapter/lesson numbering.
- Student-facing course title via `student_display_title`.
- Recipe sync fixes to Student Portal.
- Media bulk upload.
- Media captions.
- Drive admin permission pool.
- Google Drive cookie guidance.

New local operations helper:
- File: `scripts/generate-drive-refresh-token.js`
- Purpose: create a Google OAuth URL, receive a local callback, and exchange the OAuth code for a `refresh_token` for the Drive admin pool.
- The script does not contain real tokens.
- When run, it prints the generated refresh token in the local terminal.
- Real tokens must only be configured in Vercel ENV:
  - `DRIVE_ADMIN_1_REFRESH_TOKEN`
  - `DRIVE_ADMIN_2_REFRESH_TOKEN`
  - `DRIVE_ADMIN_3_REFRESH_TOKEN`

Env still needing configuration if used:
- `BUNNY_STREAM_TOKEN_KEY`
- `DRIVE_ADMIN_1_REFRESH_TOKEN`
- `DRIVE_ADMIN_2_REFRESH_TOKEN`
- `DRIVE_ADMIN_3_REFRESH_TOKEN`

Migration note:
- `migration_drive_admin_pool.sql` must be run against Supabase if it has not already been applied.

Immediate next tasks for Antigravity:
1. Audit shortened links in Student LMS.
2. Audit Chapter/Lesson display.
3. Standardize lesson counts and numbering.
4. Confirm no changes break OAuth, session/cookie restore, or sync boundaries.

Please inspect the directory, verify current git status, and continue carefully from this baseline.
```
