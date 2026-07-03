# Project Handover: TODO.md

This is the task list for the incoming AI developer.

---

## 🟥 1. High Priority (Urgent Security & Polish)

### [ ] Anti-copy Content Protection
- **Target Files**: `lms.html`, `lesson.html`
- **Objective**: Prevent students from selecting, copying, or printing text recipes and lesson descriptions.
- **Tasks**:
  - Add CSS `.select-none { user-select: none; -webkit-user-select: none; }` to recipe cards and text containers.
  - Disable right-click context menu on recipe/details area.
  - Disable copy shortcuts (e.g. `Ctrl+C`, `Ctrl+U`, `Ctrl+Shift+I`, `F12`) via keydown event listeners.
  - Disable touch-hold highlighting on iOS/Android devices via `-webkit-touch-callout: none`.

---

## 🟨 2. Medium Priority (Feature Re-integration)

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
