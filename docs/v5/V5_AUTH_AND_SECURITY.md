# LMS V5 Authentication and Security

- Reuse `getAdminFromRequest`, `verifyStudentSession`, `verifyLmsVerifiedSessionAccess`, `shouldRequireLmsVerifiedSession`, and existing cookie/header contracts through a V5 adapter.
- Never accept email as authorization input.
- Protected sessions are course-bound; requested course must match the verified session course.
- Active `student_enrollments` remains the channel entitlement source.
- Admin mutations require the existing signed admin cookie and `ADMIN_EMAILS` allowlist.
- Service-role and provider credentials remain server-only.
- Text is stored/rendered as sanitized plain text for MVP; URLs and filenames are escaped.
- UUID/course/topic/cursor/MIME/file-size/status inputs are allowlisted.
- Drafts, hidden/deleted posts, and un-signed private media are filtered server-side.
- Cross-course IDs return 404 after authorization to limit enumeration.
- Rate-limit keys are identity + route + time bucket; idempotency keys prevent replayed mutations.
- Logs redact tokens, cookies, signed URLs, email values, device IDs, session IDs, provider authorization, and service-role material.

No auth shortcut or new identity store is introduced.

