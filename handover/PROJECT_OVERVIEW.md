# Project Handover: PROJECT_OVERVIEW.md

## 1. Project Goal
The project is a premium online Learning Management System (LMS) platform for **Culinary Academy** (running on [daubepnho.store](https://www.daubepnho.store)). It allows verified students to log in using Google OAuth (GSI) with their registered Gmail, access authorized courses, view dynamically structured chapters/sections and sub-lessons, view secure video lectures, read recipes synced from Google Docs, and view/download attached course documents.

## 2. Overall Architecture
- **Frontend**: Single Page / multi-page Vanilla HTML5 and JavaScript web applications styled using Tailwind CSS (CDN-based) and custom premium CSS.
- **Backend / API**: Vercel Serverless Functions acting as proxy and business logic layers. API endpoints under `/api/lms/` route requests to specific handler scripts located in `utils/lms-handlers/`.
- **Database**: Supabase PostgreSQL database storing course metadata, detailed lessons, student enrollments, and configuration.
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
