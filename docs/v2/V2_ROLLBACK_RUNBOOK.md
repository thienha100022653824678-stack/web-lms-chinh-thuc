# V2 Rollback Runbook

For branch `v2/rebuild-20260715`. V1 production (`main`, tag `v1-stable-20260713`) is the rollback target. Practice these drills on the **V2 preview** deployment, never on production, before declaring canary-ready.

## Drill 1 — Rollback code

1. In Vercel, redeploy the preview alias from tag `v1-stable-20260713` (or `main`).
2. Smoke-test V1 endpoints on the preview alias:
   - `GET /` returns 200.
   - `GET /lms.html` returns 200.
   - `GET /lesson.html` returns 200.
   - `GET /api/lms/portal?endpoint=public-config` returns 200.
   - `POST /api/sync` (Shop→LMS) with a valid `INTERNAL_SYNC_SECRET` returns the V1 sync result.
3. Record: alias, redeploy time, smoke results. **Pass criterion:** all V1 endpoints 200 and V1 sync intact.

## Drill 2 — Rollback schema (non-production only)

1. On a disposable/staging Supabase B schema (or a prod-schema snapshot review — never run destructive SQL on production without owner approval + backup).
2. Review `scripts/v2/rollback-v2.sql`; the destructive section is commented by default. Uncomment only on the disposable schema after export.
3. Run it: drops only V2 tables (`sync_*`, `course_slug_mappings`, `portal_post_course_mappings`) and V2 columns on `orders`/`student_enrollments`/`lessons`. V1 columns are untouched.
4. Verify V1 still reads: `select count(*) from courses; select count(*) from orders where course_slug is not null; select count(*) from student_enrollments;` — all return normal counts.
5. Record: schema target, commands run, post-drop V1 read results. **Pass criterion:** V1 reads succeed after dropping V2 objects (proves the migration was additive).

## Drill 3 — Rollback flags

On the V2 preview env, turn flags off in reverse order and verify each step:

1. `V2_PORTAL_PROJECTION_DRY_RUN=true`
2. `V2_PORTAL_PROJECTION_ENABLED=false`
3. `V2_DELIVERY_HANDLERS_ENABLED=false`
4. `V2_OUTBOX_SHADOW_MODE=false`
5. `V2_GLOBAL_ONE_DEVICE_ENABLED=false`
6. `V2_CORS_ALLOWLIST_ENABLED=false`

After each flip, `GET /api/v2/readiness` (with `x-v2-worker-secret`) must trend toward `blocked`/`needs_review` (V2 retreating), and V1 flows (`/api/sync`, portal public-config, course-data with cookie) must remain intact.

Record: each flag value + readiness level after each step. **Pass criterion:** with all flags off, readiness is `blocked` (V2 fully withdrawn) and V1 behavior is unchanged.

## Kill-switch

If any drill fails, do not declare canary-ready. Keep V1 production on `main`. File the failure in `docs/v2/V2_IMPLEMENTATION_STATUS.md` and resolve before retrying.

## Production rollback (reference only — owner decision)

1. Set all V2 flags off on production env.
2. Redeploy production from `v1-stable-20260713` / `main`.
3. Smoke-test production (Shop, Portal, LMS) per the V2_TEST_MATRIX V1 regression list.
4. V2 schema is additive — no production schema rollback is needed for a runtime rollback.
