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

### 3. Immediate Next Tasks
Please implement the tasks listed in `handover/TODO.md`:

1. **Re-implement Lesson Documents & Attachments (High Priority)**:
   - Allow admins to attach multiple files (PDF, Word, Excel, Slide, GDocs, or links) to a lesson in `lms-admin.html`.
   - Update API handlers `admin-lessons.js` and `lesson.js` to save and load these document arrays.
   - Render document list cards in `lesson.html`, ensuring they are completely hidden if no documents are attached.

Please inspect the directory, verify current git status, and proceed with the tasks now!
```
