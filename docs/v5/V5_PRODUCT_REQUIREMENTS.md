# LMS V5 Product Requirements

## Objective

LMS V5 presents each enrolled course as an LMS-branded channel with a chronological, cursor-paginated post feed. Its interaction model follows familiar channel reading and publishing patterns without copying Telegram names, logos, proprietary assets, or brand colors.

## Scope

- Student channel list, feed, topics, pinned post, first-unread marker, search, media, documents, progress, deep links, and scroll restoration.
- Admin three-column workspace, composer, draft/preview/publish/schedule/edit/pin/archive/soft-delete/restore/duplicate, versions, and audit.
- Server-side course feature flag, existing authentication/session/enrollment boundary, optional Realtime with REST fallback, and direct provider uploads.
- Local/dry-run migration from existing lessons with fixture Preview data.

## Compatibility invariants

- V5 runs beside B05 and is disabled by default.
- B05 `lms.html`, `lesson.html`, `lms-admin.html`, and `index.html` remain the fallback and are not replaced.
- The 39 current lessons remain unchanged.
- Course ID, canonical `course_slug`, `learning_course_slug`, enrollment, order, sales course, and Drive permissions remain unchanged.
- V5 reuses the current session guard and admin allowlist; it does not create a new authentication system.
- Feature flags cannot be overridden by client query parameters.
- Migration is one-way per batch with an explicit rollback; there is no indefinite dual-write.

## Acceptance

Initial feed loads 20–30 posts, uses sequence cursors, does not render all 1,000 fixture posts, does not preload entire videos, restores scroll, preserves the reader’s position when new posts arrive, and exposes no draft/private media to unauthorized users.

