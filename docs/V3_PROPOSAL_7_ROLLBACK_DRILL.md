# V3 Rollback Drill — Proposal 7 (⑦) owner runbook

> **Status:** authored 2026-07-16 on `v3/research-20260715`. **Running the drill is
> owner-only.** This file was referenced in [[v3-owner-pending-actions]] as a
> pre-canary requirement but did not exist (Stage 1 finding); it is authored now.
>
> **Why a drill:** the whole V3 program is built around "instant rollback to V1,
> no redeploy." That promise is only real if it has been *exercised* on a staging
> clone before any production canary. This document is the procedure + the
> pass/fail criteria. It is additive documentation — it changes no code and
> touches no production.

---

## 0. Scope and guardrails

- The drill is performed on a **staging clone of Supabase B**, never on
  production, until the owner has rehearsed it end-to-end at least once on
  staging and signed off.
- It exercises two independent rollback surfaces:
  1. **Runtime rollback** — flip `active_mode` / `kill_switch` so V1 becomes the
     sole authoritative writer again, within the controller cache TTL (~3s),
     **no redeploy**. This is the primary, everyday escape hatch.
  2. **Schema rollback** — `DROP` / reverse the additive V3 migrations, for the
     case where V3 must be fully uninstalled (not just deactivated). This is the
     deeper, slower rollback and is only needed when the owner decides V3 is
     being abandoned rather than paused.
- **Hard rules (inherited from the V3 master plan):**
  - V1 immutable: `main` = tag `v1-stable-20260713` = `f9220e8`. The drill never
    touches V1 code or the V1 tag.
  - No self-cutover. The drill flips the **staging** runtime config, not prod.
  - Additive-only mindset on the forward path means schema rollback = a new
    reverse migration, never editing a forward migration.
  - No secret is logged at any step.

---

## 1. Preconditions (owner, before the drill)

- [ ] A staging clone of Supabase B exists (Docker `supabase db dump` → local
      restore, **or** a staging Supabase project). Requires Docker Desktop or a
      second project (owner provisioned).
- [ ] On the staging clone, the four additive V3 migrations are applied in order:
      1. `migration_v3_runtime_config.sql` (Phase 0)
      2. `migration_v3_outbox_dead_letters.sql` (Phase 3)
      3. `migration_v3_rls_policies.sql` (Phase 2) — **after** staging clone test
      4. `migration_v3_formalize_drift_columns.sql` (Phase 10)
- [ ] `SUPABASE_ANON_KEY` provisioned on staging so the anon/authenticated tiers
      are not fail-closed (otherwise the RLS policies are latent and the drill
      cannot exercise the authenticated read path).
- [ ] Two test students seeded on staging: X enrolled in course C, Y enrolled in
      D (per `docs/V3_STAGE1_RLS_READINESS_REPORT.md` §4).
- [ ] The staging deployment is running V3 code at a known commit on
      `v3/research-20260715` (a git-linked Preview is sufficient — Stage 1 used
      one read-only).
- [ ] `INTERNAL_SYNC_SECRET` available to call `POST /api/v2/runtime` on staging
      (same secret the V2 worker uses; no new secret).

---

## 2. Baseline capture (before any flip)

On the staging clone, record the "before" state so the drill can prove V1 was
restored exactly. Run all of these read-only and save the output.

```sql
-- 2a. Runtime config + audit tail.
SELECT * FROM public.platform_runtime_config WHERE id=1;
SELECT * FROM public.platform_runtime_config_audit ORDER BY changed_at DESC LIMIT 10;

-- 2b. Row counts of V3-touched tables (proves no data was lost across the flip).
SELECT 'student_active_sessions' AS t, count(*) FROM public.student_active_sessions
UNION ALL SELECT 'lms_verified_sessions', count(*) FROM public.lms_verified_sessions
UNION ALL SELECT 'lms_entry_tokens', count(*) FROM public.lms_entry_tokens
UNION ALL SELECT 'lesson_progress', count(*) FROM public.lesson_progress
UNION ALL SELECT 'student_enrollments', count(*) FROM public.student_enrollments
UNION ALL SELECT 'sync_outbox', count(*) FROM public.sync_outbox
UNION ALL SELECT 'sync_deliveries', count(*) FROM public.sync_deliveries
UNION ALL SELECT 'sync_dead_letters', count(*) FROM public.sync_dead_letters;

-- 2c. RLS policy inventory (so we can confirm a schema rollback removed them).
SELECT tablename, policyname, cmd, roles FROM pg_policies
WHERE schemaname='public' AND policyname LIKE 'v3_%' ORDER BY tablename, policyname;

-- 2d. The login RPC posture (grants + security mode).
SELECT p.prosecdef AS is_definer, p.proconfig
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='handle_student_session_login';
```

Also capture a **full schema + data dump** of the staging clone as the restore
target for §5 (the DB-level rollback rehearsal):

```bash
# Owner, on a machine with Docker + supabase CLI:
npx supabase@2.109.1 db dump --data-only   > /tmp/v3drill_before_data.sql
npx supabase@2.109.1 db dump --schema-only > /tmp/v3drill_before_schema.sql
# Or, against the staging DB URL directly:
pg_dump "$STAGING_DB_URL" --schema=public --no-owner --no-privileges > /tmp/v3drill_before_full.sql
```

---

## 3. Drill A — Runtime rollback (the primary escape hatch)

**Goal:** prove that flipping `kill_switch=true` (or `active_mode='v1'`) makes V1
the sole authoritative writer again within ~3s, with **no redeploy**, and that
V1 behavior is byte-identical to the V1 baseline.

### 3.1 Put staging into v3

```bash
# Via the admin endpoint (service-role/worker-secret gated):
curl -X POST "$STAGING_API/api/v2/runtime" \
  -H "x-sync-secret: $INTERNAL_SYNC_SECRET" -H "content-type: application/json" \
  -d '{"active_mode":"v3"}'
# Expect: {"ok":true,"config":{...,"active_mode":"v3"},"effective_mode":"v3"}
```

Confirm with a read:

```bash
curl "$STAGING_API/api/v2/runtime" -H "x-sync-secret: $INTERNAL_SYNC_SECRET"
# Expect effective_mode "v3"
```

### 3.2 Perform V3-side activity, then roll back

1. As student X (authenticated tier), drive one V3 write through the V3 path —
   e.g. update `lesson_progress` for an enrolled lesson, and mint a V3 session
   via `handle_student_session_login` called server-side (service_role).
2. Verify the write landed (§2b row counts increased; a V3-stamped outbox row
   exists with `runtime_version='v3'` if the action enqueues an event).
3. **Trigger the rollback** — two equivalent options:

   ```bash
   # Option 1 (preferred — most forceful): kill switch.
   curl -X POST "$STAGING_API/api/v2/runtime" \
     -H "x-sync-secret: $INTERNAL_SYNC_SECRET" -H "content-type: application/json" \
     -d '{"kill_switch":true}'
   # Option 2: active_mode back to v1.
   # -d '{"active_mode":"v1"}'
   ```

   Or directly via SQL Editor on the staging clone (service-role):

   ```sql
   UPDATE public.platform_runtime_config SET kill_switch=true, updated_by='rollback-drill' WHERE id=1;
   ```

4. Wait **≤ 3s** (the controller cache TTL in `utils/runtime-controller.js`).
   Optionally force an immediate cache invalidation by calling
   `GET /api/v2/runtime` (the endpoint calls `refreshConfig()`).

### 3.3 Verify V1 is authoritative again

- `GET /api/v2/runtime` → `effective_mode` must read **`v1`** (kill switch forces
  v1 regardless of `active_mode`).
- Every write path now branches to V1 (`getEffectiveMode()==='v1'`). Drive the
  same V1 flow the baseline used and confirm the response shape is the V1 shape
  (the Phase 2 compatibility contract test `a V3-written row reads back valid
  through the V1 view` covers this in the suite; re-run it on staging).
- Row counts (§2b) must be **≥** the pre-flip counts — a rollback never deletes
  business data; V3 wrote only to additive columns/tables that V1 ignores.
- No V3-stamped outbox rows are produced after the flip: any new event must carry
  `runtime_version='v1'`.

### 3.4 Pass criteria for Drill A

- [ ] `effective_mode` flips to `v1` within 3s, no redeploy.
- [ ] V1 writes succeed and match the V1 baseline behavior exactly.
- [ ] No business data lost (row counts ≥ baseline).
- [ ] No V3-stamped events are produced post-flip.
- [ ] The flip is recorded in `platform_runtime_config_audit`.

### 3.5 Re-arm (return staging to a clean state)

```bash
curl -X POST "$STAGING_API/api/v2/runtime" \
  -H "x-sync-secret: $INTERNAL_SYNC_SECRET" -H "content-type: application/json" \
  -d '{"kill_switch":false,"active_mode":"v1"}'
```

---

## 4. Drill B — Fail-closed rollback (DB unreachable)

**Goal:** prove that if the config table is unreadable (migration not applied, DB
outage, network split), the controller **fails closed to v1** with no extra
action. This is the property that makes "kill switch" a true safety net: even a
broken read cannot land on v3.

1. On the staging clone, drop the config row (simulates "row missing"):

   ```sql
   DELETE FROM public.platform_runtime_config WHERE id=1;
   ```

2. Call `GET /api/v2/runtime` and read `getEffectiveMode()` from the running
   staging app. Expected: the controller returns the `FAIL_CLOSED_CONFIG`
   (`kill_switch=true`, `active_mode='v1'`) → `effective_mode='v1'`. The endpoint
   reports the "row not found — apply migration" note.

3. Restore the row:

   ```sql
   INSERT INTO public.platform_runtime_config (id, active_mode) VALUES (1, 'v1')
   ON CONFLICT (id) DO NOTHING;
   ```

4. Simulate a hard DB read error by temporarily pointing `SUPABASE_URL` at an
   invalid host on the staging deployment (or revoke the service-role key
   temporarily). Confirm the controller still resolves to `v1` and the app keeps
   serving V1 traffic (stale cache, then fail-closed). Restore the env afterward.

### 4.1 Pass criteria for Drill B

- [ ] Missing config row → `effective_mode='v1'` (fail-closed), no crash.
- [ ] DB read error → `effective_mode='v1'` (fail-closed), V1 traffic continues.
- [ ] After restore, a fresh read returns the real config.

---

## 5. Drill C — Schema rollback (full V3 uninstall, deeper/slower)

**Goal:** prove the four additive V3 migrations can be reversed cleanly, leaving
the schema as it was before V3, with no business data lost. This is only run when
the owner is **abandoning** V3, not pausing it. **Run on the staging clone only.**

The reverse is a **new** set of `DROP` migrations — never edit the forward files.
Below is the reverse SQL. Each reverse step is the exact inverse of its forward
migration, taken from the "Rollback" notes already written into each forward file.

```sql
-- rollback_v3_schema.sql  (owner-applied on a staging clone only, in this order)
BEGIN;
SET lock_timeout = '3s';

-- Reverse Phase 10 (drift columns): the forward migration was ADD COLUMN IF NOT
-- EXISTS only. These columns are V2 identity columns / drift that V1 reads with
-- fallbacks. DROP COLUMN is destructive to any data in them, so ONLY run this if
-- the owner is certain V1 does not depend on the values. Default: DO NOT drop
-- these in a rollback-for-pause; they are harmless to V1. Included here only for
-- the full-uninstall case and gated behind an explicit owner decision.
-- ALTER TABLE public.lessons DROP COLUMN IF EXISTS is_section, DROP COLUMN IF EXISTS materials;
-- ALTER TABLE public.courses DROP COLUMN IF EXISTS is_published, DROP COLUMN IF EXISTS expected_start_date, DROP COLUMN IF EXISTS drive_folder_id, DROP COLUMN IF EXISTS drive_permission_mode, DROP COLUMN IF EXISTS sync_lms_status, DROP COLUMN IF EXISTS sync_portal_status, DROP COLUMN IF EXISTS sync_error;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS course_id, DROP COLUMN IF EXISTS normalized_customer_email, DROP COLUMN IF EXISTS sync_correlation_id, DROP COLUMN IF EXISTS source_system;
-- ALTER TABLE public.student_enrollments DROP COLUMN IF EXISTS course_id, DROP COLUMN IF EXISTS normalized_email, DROP COLUMN IF EXISTS sync_correlation_id, DROP COLUMN IF EXISTS source_system;
-- ALTER TABLE public.lessons DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS parent_section_id, DROP COLUMN IF EXISTS position;

-- Reverse Phase 2 (RLS policies + RPC DEFINER normalization).
-- Drop the 8 V3 policies and revert the login RPC to SECURITY INVOKER + reset path.
DROP POLICY IF EXISTS v3_anon_read_active_courses      ON public.courses;
DROP POLICY IF EXISTS v3_auth_read_active_courses      ON public.courses;
DROP POLICY IF EXISTS v3_anon_read_free_lessons        ON public.lessons;
DROP POLICY IF EXISTS v3_auth_read_enrolled_lessons    ON public.lessons;
DROP POLICY IF EXISTS v3_auth_read_own_enrollments     ON public.student_enrollments;
DROP POLICY IF EXISTS v3_auth_read_own_progress        ON public.lesson_progress;
DROP POLICY IF EXISTS v3_auth_update_own_progress      ON public.lesson_progress;
DROP POLICY IF EXISTS v3_auth_read_own_sessions        ON public.student_active_sessions;

ALTER FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) SECURITY INVOKER;
ALTER FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) RESET search_path;

-- Reverse Phase 3 (dead letters). sync_dead_letters is a DLQ table; dropping it
-- loses any unresolved dead-letter rows. Confirm the table is empty first:
--   SELECT count(*) FROM public.sync_dead_letters WHERE status='open';
-- Only DROP if that is 0 (or the owner accepts losing open DLQ rows).
DROP TABLE IF EXISTS public.sync_dead_letters;

-- Reverse Phase 0 (runtime config). No business data. This also makes the
-- controller fail-closed to v1 by construction (no row to read).
DROP TABLE IF EXISTS public.platform_runtime_config_audit;
DROP TABLE IF EXISTS public.platform_runtime_config;

COMMIT;
```

### 5.1 Verify the schema rollback

```sql
-- Tables gone.
SELECT to_regclass('public.platform_runtime_config') AS cfg,   -- expect NULL
       to_regclass('public.platform_runtime_config_audit') AS audit, -- expect NULL
       to_regclass('public.sync_dead_letters') AS dlq;          -- expect NULL

-- No v3_* policies remain.
SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'v3_%';
-- expect 0

-- Login RPC back to INVOKER, proconfig null.
SELECT p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='handle_student_session_login';
-- expect prosecdef=false (INVOKER), proconfig=null
```

### 5.2 Pass criteria for Drill C

- [ ] All three V3 tables report `to_regclass = NULL`.
- [ ] `count(v3_* policies) = 0`.
- [ ] Login RPC is `SECURITY INVOKER` with `proconfig = null`.
- [ ] Business-table row counts (§2b, excluding the 3 dropped V3 tables) are
      **unchanged** from baseline — no V1/V2 business data was touched.
- [ ] The staging app, with the config table gone, serves V1 traffic (fail-closed,
      per Drill B).

### 5.3 DB-level restore rehearsal (the brute-force path)

Separately from the schema reverse above, rehearse restoring the **whole staging
DB** from the §2 dump, as the ultimate fallback if a migration applies wrongly:

```bash
# Drop + recreate the staging schema, then restore from the §2 dump.
psql "$STAGING_DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$STAGING_DB_URL" -f /tmp/v3drill_before_full.sql
# Verify row counts match §2b exactly.
```

This is the "I cannot trust the schema state, restore everything" path. It is
slow and disruptive, so it is the last resort; the runtime kill switch (Drill A)
is always preferred for a fast escape.

---

## 6. Owner decision criteria (when to use which rollback)

| Situation | Use |
|---|---|
| V3 misbehaving, want V1 back **now** | **Drill A** — `kill_switch=true` (≤3s, no redeploy). |
| V3 config/DB unreadable, unclear state | **Drill B** applies automatically (fail-closed to v1); optionally set `kill_switch=true` explicitly. |
| V3 is being **abandoned**, remove its schema | **Drill C** — reverse migrations on a clone, verify, then on prod. |
| A migration applied wrongly, schema untrusted | **§5.3** full DB restore from dump, then Drill A. |

**Key invariant:** a rollback (any kind) never deletes V1/V2 business data. V3
wrote only to additive columns/tables; V1 ignores them. Row counts of V1/V2
business tables must be ≥ baseline after every rollback.

---

## 7. Post-drill sign-off (owner)

Before any production canary, the owner records:

- [ ] Drill A passed on staging (runtime rollback ≤3s, V1 byte-identical, no data loss).
- [ ] Drill B passed on staging (fail-closed to v1 on missing row + DB error).
- [ ] Drill C passed on staging clone (schema reverse clean, business data intact).
- [ ] §5.3 DB restore rehearsed on staging clone (restore from dump matches baseline).
- [ ] A captured staging dump is stored as the production pre-canary restore target.
- [ ] Owner knows the exact one-liner to kill production V3:
      `UPDATE public.platform_runtime_config SET kill_switch=true WHERE id=1;`
      (or `POST /api/v2/runtime {"kill_switch":true}` with the worker secret).

This document + a passing drill close the pre-canary gap flagged in Stage 1.
