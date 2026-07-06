# Project Handover: PROJECT_OVERVIEW.md

## 1. Project Goal
The project is a premium online Learning Management System (LMS) platform for **Culinary Academy** (running on [daubepnho.store](https://www.daubepnho.store)). It allows verified students to log in using Google OAuth (GSI) with their registered Gmail, access authorized courses, view dynamically structured chapters/sections and sub-lessons, view secure video lectures, read recipes synced from Google Docs, and view/download attached course documents.

## 2. Overall Architecture
- **Frontend**: Single Page / multi-page Vanilla HTML5 and JavaScript web applications styled using Tailwind CSS (CDN-based) and custom premium CSS.
- **Backend / API**: Vercel Serverless Functions acting as proxy and business logic layers. API endpoints under `/api/lms/` route requests to specific handler scripts located in `utils/lms-handlers/`.
- **Database**: Supabase PostgreSQL stores course metadata, detailed lessons, student enrollments, and configuration. Current repo runtime code shows one Supabase client via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the confirmed current runtime target is Supabase B - LMS & Checkout (`aqozjkfwzmyfunqvcyjv`, `thienha336501903-a11y's Org`). The broader operating architecture still has two Supabase/database systems: Supabase A for the old Student Portal/post-based content and Supabase B for LMS & Checkout.
- **Authentication**: Google Identity Services (GSI) Client-side library + server-side JWT verification against student email whitelist stored in Supabase.
- **Storage**: Video lectures and supplementary media files are securely stored on Google Drive (managed by a service account) or Bunny Stream.

## 3. Technology Stack
- **Core Languages**: HTML5, CSS3, JavaScript (ES6+).
- **CSS Framework**: Tailwind CSS (loaded via CDN) + custom premium dark/light mode themes and animations.
- **Backend Runtime**: Node.js running on Vercel Serverless environment.
- **Database**: Supabase Database (PostgreSQL) & Supabase Client SDK.
- **APIs & Integrations**: Google APIs (Google Drive API v3, Google Docs API v1) via `googleapis` NPM package.
- **Deployment**: Vercel.

## 4. Directory Structure
```
web-lms-chinh-thuc/
├── api/
│   └── lms/
│       ├── admin.js                 # Admin API endpoint router
│       └── portal.js                # Student Portal API endpoint router
├── utils/
│   ├── lms-handlers/
│   │   ├── admin-lessons.js         # Lesson CRUD & order handler for Admin
│   │   ├── course-data.js           # Student portal data loader & dynamic numbering
│   │   ├── lesson.js                # Student lesson details & docs fetching
│   │   ├── public-config.js         # Public course details handler
│   │   └── public-lesson.js         # Public access lesson handler
│   ├── lms.js                       # Session management, Google Drive & GSI helpers
│   └── supabase.js                  # Supabase Client connection pool
├── handover/                        # [NEW] Project Handover Package Folder
├── index.html                       # Symlink/copy of lms.html (home catalog page)
├── lms.html                         # Student Portal Course Catalog
├── lesson.html                      # Student Lesson Detail View (Video Player & Recipe)
├── lms-admin.html                   # Admin Dashboard / CMS Portal
├── gdrive-player.html               # Custom Secure Google Drive Video player
└── vercel.json                      # Vercel routing & environment configurations
```

## 5. Main Modules
1. **Google OAuth & Session Restoration**: Authenticates students via Google One Tap / Sign-in button. Restores sessions dynamically using signed cookies/tokens.
2. **Dynamic Lesson Numbering (Chapter Sections)**: Organizes course contents into collapsible chapters. Automatically restarts lesson index numbering (`Bài 1`, `Bài 2`...) under each section while preserving sequential Database primary key constraints.
3. **Secure Video Streaming (Google Drive / Bunny Stream)**: Obtains temporary secure streams/embed URLs and applies dynamic student email watermarks overlay to prevent screen recording and leakages.
4. **Document Attachment Management**: Admin can link PDF, Word, Excel, GDocs, or external URLs to any lesson. Students can download or view these documents directly in a clean interface.
5. **Auto-Hiding Empty Content**: The student view automatically collapses and hides any empty sections (empty video player, empty description box, empty recipe card, empty document attachment container) to maintain a premium UI feel.

## 6. Supabase Operating Warning
- Do not describe this project as "only one Supabase" in the operating sense.
- Correct wording: "Repo runtime currently shows one Supabase client, but the operating system has two Supabase/database systems according to the project owner."
- Supabase A is for the Student Portal / old post-based portal (`posts`, `post_views`, portal enrollments).
- Supabase B is for LMS & Checkout (`courses`, `orders`, `lessons`, `students`, LMS enrollments).
- Current `web-lms-chinh-thuc` runtime uses Supabase B through `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Supabase B org: `thienha336501903-a11y's Org`.
- Supabase B project ref: `aqozjkfwzmyfunqvcyjv`.
- Before changing database code, sync code, or schema, confirm which Supabase is affected.

## 7. Final Codex/Coex to Antigravity Handover - 2026-07-06
- This is the final handover from Codex/Coex back to Antigravity for continued development.
- Latest pushed commit: `7d5e92b3a5cf8022865cf1798500237078ab19e8`
- Latest commit message: `chore: add Drive refresh token helper script`
- Git status at handover:
  - Branch: `main`
  - Local is even with `origin/main`
  - Working tree is clean
  - No untracked files
- Recent Codex/Coex work includes:
  - Student LMS link display, chapter metadata, and lesson numbering polish.
  - Separate student-facing course title via `student_display_title` while preserving sales/admin title.
  - Recipe sync fixes from LMS to Student Portal.
  - Lesson media bulk upload.
  - Per-media captions.
  - Drive admin permission pool.
  - Google Drive cookie guidance for students.
- New operations helper:
  - `scripts/generate-drive-refresh-token.js`
  - Purpose: create a Google OAuth URL, receive a local callback, and exchange the OAuth code for a `refresh_token` for the Drive admin pool.
  - The script does not contain real tokens.
  - When run, it prints the generated refresh token in the local terminal.
  - Real tokens must only be configured in Vercel ENV as `DRIVE_ADMIN_1_REFRESH_TOKEN`, `DRIVE_ADMIN_2_REFRESH_TOKEN`, and `DRIVE_ADMIN_3_REFRESH_TOKEN`.
- Supabase status:
  - Runtime uses Supabase B.
  - Supabase B project ref: `aqozjkfwzmyfunqvcyjv`.
  - Supabase B org: `thienha336501903-a11y's Org`.
  - Supabase A is the old Portal/legacy database.
- Env still needing attention:
  - `BUNNY_STREAM_TOKEN_KEY` if Bunny secured playback is used.
  - `DRIVE_ADMIN_1_REFRESH_TOKEN`, `DRIVE_ADMIN_2_REFRESH_TOKEN`, and `DRIVE_ADMIN_3_REFRESH_TOKEN` if the Drive admin permission pool is used.
- Migration note:
  - `migration_drive_admin_pool.sql` must be run against Supabase if it has not already been applied.
- Next Antigravity tasks:
  - Audit shortened links in Student LMS.
  - Audit Chapter/Lesson display.
  - Standardize lesson counts and numbering.
  - Do not break OAuth, session/cookie restore, or sync boundaries.
