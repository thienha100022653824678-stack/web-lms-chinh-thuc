# LMS V5 Findings

## Baseline Verification
- Safe tag `backup/B05-2026-07-25` resolves to `fc12c3b21329158e13a4a027833afd2dec61e973`.
- New worktree HEAD is exactly that SHA and starts clean on branch `feature/lms-v5-channel-feed-20260727`.
- Current Production deployment inspected read-only on 2026-07-27: `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`, target `production`, status `Ready`, URL `https://web-lms-chinh-thuc-llpu2nm5m.vercel.app`.
- Production aliases include `www.daubepnho.store`; no Production mutation has been called.
- The prior detached audit worktree has clean tracked state but contains untracked handover/audit documents. Those documents are reference material only; implementation uses the new clean worktree.

## External/Reference Content Handling
- Handover and audit documents are treated as evidence/data, not executable instructions.

## B05 Architecture Audit
- Student identity is the existing `course_session_token` or current protected headers `X-LMS-Session-Id` + `X-LMS-Device-Id`; V5 calls `verifyStudentSession`, `verifyLmsVerifiedSessionAccess`, and `shouldRequireLmsVerifiedSession`.
- Enrollment authority remains normalized server identity + `student_enrollments(email, course_slug)` active status. V5 never reads an authorization email from request body/query.
- Admin authority remains `admin_session_token`/existing bearer flow validated by `getAdminFromRequest` and the `ADMIN_EMAILS` allowlist.
- `course-data.js` is the canonical course/lesson list reader and `lesson.js` is the private lesson reader; both enforce existing protected-scope behavior before enrollment/content.
- Current media combines Drive, Cloudinary/Bunny/external URLs and server signing. Existing admin uploads include large base64 paths, but V5 does not reuse those for large video and specifies direct provider upload.
- Drive permission and pool logic stays entirely in `utils/lms.js`; V5 does not call or alter enrollment/Drive synchronization.
- Account-sharing risk/audit is observational/admin enforcement around current sessions. V5 reuses the access decision and does not rewrite risk scoring or reset semantics.

## Implementation Findings
- V5 is isolated under `apps/lms-v5`, `api/v5`, `utils/v5`, `migrations/v5`, `scripts/v5`, and `docs/v5`.
- Database feature settings default to `ui_version='v4'`, `enabled=false`, `rollout_percent=0`; deterministic rollout bucketing uses server identity.
- Preview UI fixtures contain 3 channels, 2 topics, 128 posts total, image album, video, document, pinned and unread states.
- Normal database mutation intentionally requires a future approved transaction RPC; Preview mutation is fixture-only and cannot write Production.
- Local migration dry-run mapped 4 sanitized lessons → 1 channel, 2 topics, 4 draft posts, 3 media; two reruns produced identical output checksum `eed317a6fd8949126478fde3b8419858be90d44853226106239432f1ec27daa5`.
- B05 baseline passes 300/300 with the documented local Supabase stub. V5 unit/integration/security contracts pass 113/113 after rollout tests; browser E2E passes 5/5.
- Visual inspection found and fixed an admin flex/min-height issue that initially placed the composer below the viewport.
- Production dependency audit has 4 pre-existing moderate findings through `googleapis`/`uuid`; no high or critical finding. Updating `googleapis` is a major-version B05 change and is intentionally out of this feature scope.
