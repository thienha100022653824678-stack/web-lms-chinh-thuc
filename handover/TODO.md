# Project Handover: TODO.md

This is the task list for the incoming AI developer.

---

## 🟥 1. High Priority (Urgent Security & Polish)

### [x] Anti-copy Content Protection
- **Target Files**: `lms.html`, `lesson.html`
- **Objective**: Prevent students from selecting, copying, or printing text recipes and lesson descriptions.
- **Status**: Completed. Added CSS `.no-copy` selection lock and global JS blocker for copy/cut/right-click/shortcuts.

---

## 🟨 2. Medium Priority (Feature Re-integration)

### [ ] Complete Google Service Account and Bunny env setup
- **Target Files**: local `.env.local`, Vercel project environment variables, Google Cloud, Google Drive sharing settings, Bunny dashboard if used.
- **Objective**: Finish the remaining environment setup required for Google Docs/Drive recipe/media fetching and Bunny secured video playback.
- **Tasks**:
  - Create a Google Service Account JSON key.
  - Extract `client_email` and `private_key` from the JSON key.
  - Add `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` to `.env.local` and Vercel env if Google Drive/Docs fetching is required in production.
  - Share the Google Drive course folder/documents with the service account email.
  - Re-test Google Docs/Drive recipe and media loading through `vercel dev` and production.
  - Add `BUNNY_STREAM_TOKEN_KEY` if Bunny secured video URLs are used.
  - Re-test Bunny secured video playback after adding the token.
- **Security Note**: Never commit or document secret values.

### [ ] Re-implement Lesson Documents & Attachments
- **Target Files**: `lms-admin.html`, `lesson.html`, `utils/lms-handlers/admin-lessons.js`, `utils/lms-handlers/lesson.js`
- **Objective**: Allow admins to link documents (PDF, Docx, Excel, Slides, Drive URLs) to lessons, and allow students to view/download them.
- **Tasks**:
  - Check database structure (e.g. `media_urls` or a dedicated column to store document JSON arrays).
  - Add inputs in `lms-admin.html` to let admin load file links with clear display titles.
  - Render an attachments listing card in `lesson.html` (auto-hidden if no documents are attached).

---

## 🟩 3. Low Priority (Performance & UX)

### [ ] Google Drive Image Caching / Optimization
- **Target Files**: `utils/lms.js`
- **Objective**: Speed up the loading of course thumbnails that are hosted on Google Drive.
- **Tasks**:
  - Route thumbnail requests through a lightweight server proxy or cache header configurations to optimize page speed scores.

### [ ] Local draft auto-save in CMS
- **Target Files**: `lms-admin.html`
- **Objective**: Auto-save drafts to `localStorage` when creating/editing lessons in case of accidental reload.
