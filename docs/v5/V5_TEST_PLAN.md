# LMS V5 Test Plan

## Baseline

Run B05 with the documented local Supabase stub: 300/300 tests plus `npm run build:lms-css`. Compare tracked B05 files to exact base.

## V5

- Unit: validation, transition matrix, cursor, reads/completion, permission, flags, sanitization, media ordering, migration checksum/idempotency.
- Integration: current auth/enrollment/protected/legacy boundaries, draft isolation, admin audit/idempotency, upload completion, realtime dedupe, rollback.
- E2E: channel list/feed/older loading/unread/topic/search/album/video/file/completion/scroll restore and full admin composer lifecycle.
- Security: unauthenticated/non-enrolled/wrong-course/spoofed email/XSS/path/MIME/draft/private media/secret/IDOR/rate-limit.
- Performance: 1,000 posts, 100 video, 20-image album, long text, interrupted upload, reconnect/reload, mobile memory.
- Accessibility: keyboard/focus/labels/semantics/alt/reduced-motion/contrast/touch/safe-area/mobile keyboard/landscape/tablet/desktop.

Targets: initial 20–30 rows, virtualized window, lazy images, video `preload=metadata`, no duplicate request, stable scroll.

