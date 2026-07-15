# V2 Production Canary Plan (OWNER GATE — not executed by any agent task)

> **Status:** proposal only. Nothing in this document is executed automatically.
> Turning on any production flag, deploying production, merging `main`, running
> SQL on Supabase, or granting Drive access is an **explicit owner decision**.
> The canary-ready work is on Preview only; V1 remains the live system.

Branch: `v2/rebuild-20260715` (HEAD `b67c8c4`). Target DB: Supabase B
`aqozjkfwzmyfunqvcyjv` (shared by Preview and Production — treat every write as
real). System1 Portal projection target: `https://admin.yeunauan.live`.

---

## 0. Golden rules (never violate)

- Never enable all users / all events at once. One event type, one owner-named
  target first.
- Never flip Drive to live: `V2_DRIVE_WORKER_DRY_RUN=true` stays true for the
  entire canary. Drive permission delivery is out of scope.
- Never run a schema rollback (DROP) on production. Rollback is **flags-first**;
  the additive schema stays in place.
- Never use a random real student. Use course projection for an
  owner-designated course, or an owner-controlled internal account.
- Never merge `main` or deploy production as part of preparing this plan.

---

## 1. Smallest proposed canary scope

**Phase A (first):** a single `course.publish_status_changed` event for **one
owner-designated course slug** → projected to System1 as `action=syncCourse`.
This is idempotent on System1 (`updated:true` on re-sync), touches no student,
and grants no Drive access. This is the exact path already proven on Preview
(see `V2_IMPLEMENTATION_STATUS.md` → "S3 step 6 live delivery results").

**Phase B (only if A passes + owner approves):** a single `enrollment.upserted`
event for **an owner-controlled internal account** (not a random real learner)
on the same course → projected as `action=syncEnrollment`. Drive stays dry-run,
so no folder permission is actually granted; only the Portal enrollment
projection is exercised.

No further event types, courses, or accounts without a fresh owner sign-off.

---

## 2. Entry conditions (all must be true before Phase A)

- Preview canary-ready and in guarded safe state (current state — see status doc).
- All three rollback drills passed on Preview (done, 2026-07-15).
- `/api/v2/readiness` on the production deployment (flags still guarded) returns
  `ok:true` and is not `blocked`.
- Production secrets present: `SESSION_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`,
  `INTERNAL_SYNC_SECRET`, `ADMIN_EMAILS`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, plus `SYSTEM1_URL` (projection target). Worker
  auth falls back to `INTERNAL_SYNC_SECRET` if `V2_WORKER_SECRET` unset.
- V1 rollback is hot: `v1-stable-20260713` / `main` deployable; all V2 flags can
  be turned off in one pass.
- Owner has named the exact course slug (Phase A) and internal account (Phase B).
- Owner has decided the 3 tracked junk-slug gaps (`donut`, `test-bake_1`) policy:
  accept as non-blocking or clean them first. Reconciliation surfaces them; they
  do not block dry-run but keep readiness below `ready_for_guarded_delivery`.

---

## 3. Production flag order (step by step, one flip per step)

Start: all V2 flags off on production. Flip in this order, redeploy after each
env change, and run the §5 checks + §4 observation window between every step.

| Step | Flag change | Effect | Observe (§4) |
|---|---|---|---|
| P0 | *(none)* baseline | V1 authoritative; V2 fully off | confirm readiness not `blocked` |
| P1 | `V2_RECONCILIATION_READONLY=true` | read-only recon available | `/api/v2/reconciliation` ok |
| P2 | `V2_OUTBOX_SHADOW_MODE=true` | shadow rows written on real writes; **no delivery** | `/api/v2/outbox` rows grow, deduped |
| P3 | `V2_PORTAL_PROJECTION_ENABLED=true` + `V2_PORTAL_PROJECTION_DRY_RUN=true` | projection built, **not sent** | `/api/v2/portal-projection-preview` matches V1 contract |
| P4 (owner gate) | `V2_DELIVERY_HANDLERS_ENABLED=true` + `V2_OUTBOX_WORKER_ENABLED=true` + `V2_OUTBOX_WORKER_DRY_RUN=true` | worker plans, **still no live send** | worker builds a plan, 0 `sync_deliveries` |
| P5 (owner gate) | `V2_OUTBOX_WORKER_DRY_RUN=false` + `V2_PORTAL_PROJECTION_DRY_RUN=false` | **live delivery of the one canary event only** | `sync_deliveries` success; System1 `updated:true` |

`V2_DRIVE_WORKER_DRY_RUN=true` and `V2_PLATFORM_ENABLED=false` throughout.
Never flip P4/P5 until the prior step's observation window is clean.

---

## 4. Observation window between steps

- P1–P3: **≥ 15 minutes** each (read-only / dry-run — short window to confirm no
  error and payload parity).
- P4 (worker dry-run): **≥ 30 minutes** — confirm the plan builds and creates
  **zero** `sync_deliveries` rows.
- P5 (first live event): **≥ 60 minutes** active watch, then **24 hours** passive
  before considering any scope expansion. Only the single canary event should be
  delivered in this window.

Abort the window early and go to §6 kill-switch on any failure signal.

---

## 5. Endpoints & metrics to check at every step

All with header `x-v2-worker-secret: <V2_WORKER_SECRET|INTERNAL_SYNC_SECRET>`.

- `GET /api/v2/diagnostics` — `ok:true`; flags match the intended step; migrations
  all present; `outbox.counts`; `staleProcessingCount=0`.
- `GET /api/v2/readiness` — level trend; must never be `blocked` after P0; live
  flags legitimately show `review` gates at P5.
- `GET /api/v2/outbox?resource=outbox` — pending/processing/delivered/failed/
  dead_letter counts; no duplicate `idempotency_key`.
- `GET /api/v2/outbox?resource=deliveries` — `sync_deliveries` rows and status.
- `GET /api/v2/portal-projection-preview?outboxId=…` — payload parity vs V1
  `/api/sync` contract (email normalized+masked, courseSlug, action, status, no
  secret).
- `GET /api/v2/reconciliation` — `failedChecks=0`; only the accepted tracked gaps.
- V1 liveness: `GET /` 200, `GET /lms.html` 200, `GET /api/lms/portal?endpoint=public-config` 200, `POST /api/sync` enforces auth and returns the V1 result.

---

## 6. Pass / fail criteria

**Pass (per step):** intended flags active; `/api/v2/diagnostics` `ok:true`;
outbox has no `failed`/`dead_letter`/stale rows attributable to the canary;
readiness not `blocked`; V1 endpoints all 200 and `/api/sync` unchanged. At P5,
the one canary event reaches `sync_deliveries.status=success` and System1 returns
`{success:true, updated:true}`.

**Fail (any of):** `/api/v2/diagnostics` `ok:false`; a `failed` or `dead_letter`
row for the canary event; projection payload mismatch vs V1; a stale
`processing` row that does not clear; any V1 endpoint regresses; readiness drops
to `blocked` unexpectedly. → §6 kill-switch immediately.

---

## 7. Kill-switch & rollback order (flags-first, reverse of §3)

1. `V2_PORTAL_PROJECTION_DRY_RUN=true`
2. `V2_OUTBOX_WORKER_DRY_RUN=true`
3. `V2_OUTBOX_WORKER_ENABLED=false`
4. `V2_DELIVERY_HANDLERS_ENABLED=false`
5. `V2_PORTAL_PROJECTION_ENABLED=false`
6. `V2_OUTBOX_SHADOW_MODE=false`
7. `V2_RECONCILIATION_READONLY=false`

Redeploy production. If a code issue is suspected, redeploy from
`v1-stable-20260713` / `main`. **No schema rollback on production** — the
migration is additive; flag-off fully withdraws V2 runtime behavior. Schema DROP
(`scripts/v2/rollback-v2.sql`) is only for a disposable DB after export, never
production.

---

## 8. Confirming V1 is unaffected

- The shadow/producer path is fail-open (`utils/v2-outbox-shadow.js`): a V2
  enqueue error never throws into the V1 `/api/sync` or admin-enrollment
  response. Flag-off = pure no-op.
- Before and after each step, run the §5 V1 liveness checks. `POST /api/sync`
  must return the same V1 result shape it does today.
- Compare V1 row counts (courses/orders/student_enrollments/lessons) before P2
  and after P5 — they must be unchanged by the canary (V2 writes go only to
  `sync_*` and additive columns, not V1 tables).

---

## 9. Outbox row-state handling

- **pending:** normal pre-delivery state. Should transition to `delivered` once
  the worker runs live (P5). Persistent pending with worker live = investigate
  (auth, target URL, projection error) before continuing.
- **processing / stale:** a row locked but not completed. `staleProcessingCount`
  must be 0 at every check. A stale row → pause, inspect `lockedBy`/`lockedAt`,
  do not force-flip further flags.
- **failed:** delivery attempted and errored; the worker backs off and retries up
  to `maxAttempts`. A canary-attributable `failed` row is a §6 fail signal —
  read `lastError`, fix (e.g. a projection action mismatch), reset the row to
  `pending`, redeploy, re-run. (This is exactly the Preview flow that fixed the
  `syncCoursePublishStatus` → `syncCourse` bug.)
- **dead_letter:** exhausted retries. Alertable. Stop the canary, root-cause,
  never auto-retry blindly. Dead letters are surfaced by `/api/v2/outbox?resource=dead_letters`.

---

## 10. Portal projection mismatch handling

If `/api/v2/portal-projection-preview` (P3) or a live delivery (P5) shows a
payload that does not match the V1 / System1 contract:

- Do **not** flip to live (or immediately kill-switch to dry-run if already live).
- Fix the mapping in `utils/v2-portal-projection.js` (the source of the
  `action` / field shape), add/adjust a test, redeploy Preview, re-verify with
  the preview endpoint before returning to production.
- System1 accepts only `syncCourse` / `syncEnrollment` / `revokeEnrollment`.
  Course publish intent rides on `isPublished` in the `syncCourse` body — do not
  emit `syncCoursePublishStatus`.

---

## 11. Explicitly out of scope for this canary

- Drive permission live delivery (`V2_DRIVE_WORKER_DRY_RUN` stays true).
- Full-user / multi-event cutover.
- V1 endpoint removal.
- Session lease, risk V2 summaries, admin diagnostics UI.
- Any production schema change or DROP.
- Merging `main` or deploying production as part of authoring this plan.
