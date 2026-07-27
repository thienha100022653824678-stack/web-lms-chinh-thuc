# LMS V5 Preview Implementation Report

Date: 2026-07-27  
Status: **Fixture Preview Ready; Production rollout not approved and not ready**

## 1. Exact baseline and source

| Item | Exact value |
|---|---|
| Repository | `web-lms-chinh-thuc` |
| Base tag | `backup/B05-2026-07-25` |
| Exact base SHA | `fc12c3b21329158e13a4a027833afd2dec61e973` |
| Tag/base verification | PASS; both resolve to the same commit |
| Branch | `feature/lms-v5-channel-feed-20260727` |
| Deployed implementation commit | `110435dd90e3712ec377447608952d74b8e2253e` |
| Worktree | `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_worktrees\lms-v5-channel-feed-20260727` |
| Reference Production deployment | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |
| Reference Production status after Preview | Ready; unchanged |

The branch was created directly from the exact SHA, not `origin/main`. It has not been merged.

## 2. Preview deployment

| Item | Value |
|---|---|
| Deployment ID | `dpl_9SpgJMDfW6nqZXwuLskDdYPPgLRZ` |
| Base URL | `https://web-lms-chinh-thuc-7e9vccgjt.vercel.app` |
| Student URL | `https://web-lms-chinh-thuc-7e9vccgjt.vercel.app/v5` |
| Admin URL | `https://web-lms-chinh-thuc-7e9vccgjt.vercel.app/v5-admin` |
| Target/status | Preview / Ready |
| Production aliases | None |
| Preview mode | `V5_FIXTURE_MODE=1`, client fixture build enabled |

Authenticated probe results:

- `/v5` → 200.
- `/v5-admin` → 200.
- `/lms.html` B05 fallback → 200.
- unauthenticated `/api/v5/channels` → 401 `student_auth_required`.

Vercel Deployment Protection remains enabled. No domain was attached or changed.

## 3. Files created or changed

Created:

- `apps/lms-v5/*`: isolated React/TypeScript/Vite student and admin entries.
- `api/v5/[...path].js`, `api/v5/admin/[...path].js`: versioned catch-all functions.
- `utils/v5/*`: auth adapters, validation, cursor logic, fixture/DB repository, lifecycle, read state, idempotency, upload lifecycle, handlers.
- `migrations/v5/*`: complete forward and rollback DDL, unapplied.
- `scripts/v5/*`: deterministic migration dry-run, Preview bundle preparation, rollback-batch template.
- `fixtures/v5/*`, `public/fixtures/lms-v5/*`: synthetic/sanitized data only.
- `tests/v5/*`, `tests/v5-e2e/*`: 113 contract tests and 5 browser E2E tests.
- the 12 Gate 0 documents plus this report under `docs/v5`.
- persistent task planning evidence: `task_plan.md`, `findings.md`, `progress.md`.

Changed:

- `package.json`, `package-lock.json`: isolated V5 build/test dependencies and scripts.
- `vercel.json`: Preview build output and only `/v5`/`/v5-admin` rewrites.
- `.gitignore`: ignores generated `dist-v5`.

Not changed from B05:

- `index.html`, `lms.html`, `lesson.html`, `lms-admin.html`;
- `api/lms/*`;
- `utils/lms.js`, `utils/lms-session-guard.js`, existing `utils/lms-handlers/*`;
- course/enrollment/order/Drive/commerce/Portal source.

The Preview bundle copies seven B05 static entry files byte-for-byte so fallback pages remain available beside V5.

## 4. Architecture and UI

V5 is a separate Vite build with two entry points. Student UI implements channel list, search, progress, channel feed, cursor-sized rendering, topics, pinned/unread states, date separator, images/album/lightbox, metadata-only video preload, documents, completion toggle, deep-link IDs, new-post banner, jump-to-bottom, scroll restore, responsive layout, keyboard focus, screen-reader labels, reduced motion, safe-area padding, and mobile/tablet/desktop rules.

Admin UI implements the three-column desktop layout, fixed composer, text/type/topic selection, multi-file picker, paste/drop-ready browser file handling, per-file caption/cancel, draft/schedule/preview/publish, edit selection, pin/unpin, duplicate, soft-delete, version/audit/preview affordances, and visible fixture-only state.

The color, wordmark, avatar treatment, and assets are LMS-specific. Telegram name/logo/proprietary icons/assets are not used. The admin header explicitly says it is not Telegram.

## 5. Data model and migrations

The forward SQL creates:

- channels, topics, posts, ordered media;
- post reads and channel read states;
- post versions and audit logs;
- server-side channel settings;
- idempotency keys and upload sessions;
- foreign keys, checks, partial unique identity indexes, feed/topic/pin/schedule/migration indexes, updated-at triggers, RLS, and V5-only privilege boundaries.

Defaults are `ui_version='v4'`, `enabled=false`, `rollout_percent=0`. Posts/media use restrictive foreign keys and soft lifecycle; there is no post/media cascade hard-delete. The rollback drops only V5 objects.

Neither migration file was applied to any database.

## 6. API and auth/session integration

Student routes implement the requested channel/post/topic/search/seen/complete/read-state contract. Feed pagination accepts only `before_sequence`/`after_sequence`, rejects offset, limits pages to 50, and excludes non-published posts server-side.

Admin routes implement requested channel/feed/create/update/delete/publish/schedule/pin/unpin/archive/restore/duplicate/versions/upload/migration-preview paths. Fixture mutations enforce validation, sanitization, lifecycle transitions, version snapshots, audit rows, and idempotency conflicts.

Authorization reuses:

- `course_session_token` and `verifyStudentSession`;
- protected `X-LMS-Session-Id`/`X-LMS-Device-Id`;
- `verifyLmsVerifiedSessionAccess` and `shouldRequireLmsVerifiedSession`;
- server-side normalized identity;
- active `student_enrollments(email, course_slug)`;
- `admin_session_token`, `getAdminFromRequest`, and `ADMIN_EMAILS`.

No client-provided email grants access. A protected session cannot cross course scope. No auth shortcut or new identity database was added.

## 7. Media flow

The database and API model supports provider asset IDs, metadata, ordering, captions, ownership, expiring upload sessions, completion/cancel, and orphan tracking. File-size gates are type-specific. Large video is designed for direct provider upload; no V5 Function accepts a large video body.

Preview uses browser object URLs and synthetic external fixtures. Real Cloudinary/Drive/Bunny signed upload authorization is deliberately not enabled because no approved Preview provider/database credential set was supplied. Existing B05 Drive permission behavior is untouched.

## 8. Migration dry-run

Sanitized input: 4 synthetic lessons.  
Result: 1 channel, 2 topics, 4 draft posts, 3 media.  
Duplicate report: 0.  
Missing-media report: 0.  
Output checksum on both reruns: `eed317a6fd8949126478fde3b8419858be90d44853226106239432f1ec27daa5`.

Artifacts:

- `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\lms-v5-migration-dry-run\mapped-a.json`
- `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\lms-v5-migration-dry-run\mapped-b.json`
- matching reports in the same directory.

No current lesson row was altered and no Production migration was run.

## 9. Test results

| Suite | Result |
|---|---:|
| B05 baseline | 300/300 pass |
| V5 unit/integration/security contracts | 113/113 pass |
| Chromium E2E | 5/5 pass |
| Total | 418/418 pass |
| B05 Tailwind CSS build | PASS |
| V5 production build | PASS |
| V5 fixture Preview build | PASS |
| B05 protected-file diff | PASS; no diff |

E2E covers channel list/open, album fullscreen, completion toggle, 120-post fixture limited to a 24-post initial window, admin preview/publish, and composer viewport anchoring. The security contract covers spoofed-email absence, enrollment checks, published-only feed, offset rejection, service-role exclusion from browser source, feature defaults, non-cascade media, metadata video preload, reduced motion, and scroll persistence.

## 10. Performance

- Fixture scale: 1,000 posts, including 100 posts marked with video metadata in the microbenchmark.
- Initial render/query window: 24 posts.
- 1,000 cursor operations: 17.46 ms total, 0.0175 ms average on the local audit machine.
- V5 JS: 206.16 kB / 65.04 kB gzip.
- V5 CSS: 9.75 kB / 2.88 kB gzip.
- Video uses `preload="metadata"` and images use lazy loading.
- Browser E2E verifies the 120-post fixture renders 24 post cards rather than the entire feed.

Full interrupted-network/provider upload and mobile low-memory lab tests remain pending because the Preview provider is fixture-only.

## 11. Security result

PASS:

- existing session/admin/enrollment boundaries are reused;
- client email is not an authority;
- course-scoped protected session check exists;
- drafts/hidden/deleted are excluded from the student repository;
- service-role is absent from browser code;
- XSS-oriented tag/script sanitization tests pass;
- insecure media URLs are rejected except explicit local fixture paths;
- idempotency conflict, file-size, ownership, wrong/unknown scope, and unauthenticated contracts pass;
- migration grants/revokes affect only V5 tables;
- no high/critical npm audit finding.

Known dependency finding: four moderate advisories are inherited through the B05 `googleapis` dependency chain. The offered fix is a major `googleapis` upgrade, intentionally not mixed into V5 Preview.

Rate limiting is specified in the API/security contract but a shared persistent rate-limit provider is not implemented in fixture mode. MIME completion verifies declared fixture metadata only; authoritative provider verification awaits provider integration.

## 12. Screenshots

- `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\lms-v5-screenshots\student-channel-list-desktop.png`
- `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\lms-v5-screenshots\student-channel-list-mobile.png`
- `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\lms-v5-screenshots\admin-composer-desktop.png`

The admin screenshot was recaptured after fixing the composer’s viewport anchoring.

## 13. Known limitations and unresolved blockers

These are explicit Preview limitations, not hidden completion claims:

- Preview UI runs synthetic client fixtures and does not create real student/admin sessions.
- Migration is unapplied; no approved Preview Supabase database was supplied.
- Normal-database multi-table admin mutation returns `transaction_rpc_required` until an approved transaction RPC is reviewed/deployed.
- Direct provider upload authorization, provider-side MIME/ownership verification, orphan cleanup worker, and real private signed document URLs are not connected.
- Supabase Realtime is not connected; the Preview demonstrates non-forcing new-post banner behavior and browser reconnect/focus-ready UX only.
- Scheduling stores the lifecycle in fixture mode; no scheduler/worker publishes scheduled database rows.
- Student UI fixture progress is local interaction state; authenticated API read/completion endpoints are implemented but not wired to a real Preview enrollment.
- Rich text MVP is sanitized plain text. Audio is modeled/renderable by the API model but no audio fixture/player was added.
- Swipe physics for album is not a dedicated gesture implementation; mobile uses responsive album/grid and fullscreen image.
- No real slow-provider/interrupted-upload/mobile low-memory lab was available.
- The failed first Preview builds/deploy probes are recorded in `task_plan.md`; the final deployment above is Ready.

Because of these items, this report does **not** claim “100% giống Telegram” and does **not** claim Production readiness.

## 14. Rollback

Immediate Preview rollback:

1. Do not promote the Preview.
2. Use B05 pages already bundled (`/lms.html`, `/lesson.html`) or set V5 global kill switch.
3. Remove/ignore the Preview deployment; it has no Production alias.

Future data rollback, only after an approved non-Production migration:

1. Identify the exact `migration_batch_id`.
2. Run the parameterized soft-archive rollback template.
3. Verify counts/checksums.
4. Leave legacy lessons, enrollments, course identity, orders, and Drive permissions unchanged.

Production reference rollback remains `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`; this work never promoted or replaced it.

## 15. Proof of no Production write or boundary change

- All migration operations were local JSON dry-runs; no SQL client was invoked.
- Preview environment explicitly uses fixture mode.
- Unauthenticated Preview API returns 401; it does not expose fixture records through an auth bypass.
- No order/enrollment/email/Drive/lesson mutation endpoint was called.
- Exact Production deployment inspected before and after remains `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.
- Final Preview deployment target is `preview` and has no Production alias.
- `git diff` confirms B05 pages, current LMS APIs/handlers/session guard, commerce, Portal, domain, and tenant code are unchanged.
- Canonical course slug and `learning_course_slug` were not changed.

## 16. Owner approvals required before any Production work

1. Approve a dedicated Preview Supabase project/schema and provider credentials with no Production data.
2. Review/approve transaction RPCs, RLS/service boundary, rate limiting, scheduling worker, and cleanup worker.
3. Complete real auth/enrollment/IDOR/private-media integration tests.
4. Complete provider upload interruption/MIME spoof/orphan cleanup tests.
5. Complete Realtime plus REST fallback and real scroll/unread state integration.
6. Run full accessibility/slow-network/mobile-memory lab.
7. Review migration preview against a sanitized export of all 39 lessons.
8. Approve a one-course canary and explicit rollback evidence.
9. Separately approve any Production migration, environment change, deployment, or rollout.

No item above is implicitly approved by this Preview.

## 17. Những gì đã hoạt động hoàn chỉnh

- Isolated LMS-branded React/Vite student/admin fixture application.
- Channel/feed/topic/search/album/video/document/pinned/unread/progress interactions in Preview fixture mode.
- Admin fixture composer and lifecycle interactions, preview, version/audit/idempotency model.
- Versioned API validation/auth/enrollment boundary and published-only/cursor contracts.
- Forward/rollback schema artifacts, deterministic migration dry-run, B05 fallback bundle.
- 418 passing local automated tests and a Ready protected Preview deployment.

## 18. Những gì mới là Preview hoặc fixture

- All displayed channels/posts/media and composer mutations.
- Migration input/output and migration preview.
- Upload completion, audit/version persistence, schedule/publish lifecycle.
- New-post banner/reconnect behavior and student progress UI.
- Performance/security results that do not require a real provider/database.

## 19. Những việc tuyệt đối chưa được đưa lên Production

- V5 schema/migration/RLS/RPC.
- V5 feature settings or course enablement.
- Real upload/provider/Realtime/scheduler/cleanup workers.
- Any mutation of lessons, enrollment, order, Drive permission, course identity, commerce, Portal, tenant, domain, secret, or Production database.
- Preview deployment promotion, Production alias, merge, or Production rollout.
