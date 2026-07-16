# V3 Stage 1 — RLS Readiness Report (B4)

> **NO APPLY.** This is a readiness report only. `migration_v3_rls_policies.sql` is **NOT** applied in Stage 1. Hard stop before RLS migration for separate owner approval (per Stage 1 plan §B4).
>
> Source of truth for prod state: `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` (VERIFIED 2026-07-15, catalog read-only). Migration audited: `migration_v3_rls_policies.sql` (HEAD 51b62e4).

---

## 1. Executive summary

- Production Supabase B has **RLS ENABLED on 100% of public tables (25)**, **0 policies**, `force_rls = false` on all. Today the system is safe **only** because every read/write goes through the service-role key (service_role bypasses RLS).
- `migration_v3_rls_policies.sql` is **additive-only** (no DROP/RENAME/ALTER TYPE), **idempotent** (guarded by `pg_policies` existence checks), wrapped in a single `BEGIN/COMMIT`.
- It creates **8 policies** (anon + authenticated least-privilege read/update) and **normalizes one RPC** (`handle_student_session_login`) to `SECURITY DEFINER` + pinned `search_path = public`.
- It does **not** create any policy for `service_role` — so V1/V2 (all service-role) keep working **byte-for-byte**. Only the v3 anon/authenticated browser tiers gain a real surface.
- **Verdict: LOW-to-MEDIUM risk, but requires a staging clone test before prod apply.** The one behavior-changing statement is the `ALTER FUNCTION ... SECURITY DEFINER` on the login RPC — must be validated on a clone.

---

## 2. Policy matrix (what the migration creates)

| # | Table | Policy name | Role | Cmd | USING predicate | WITH CHECK |
|---|-------|-------------|------|-----|-----------------|------------|
| 1 | `courses` | `v3_anon_read_active_courses` | anon | SELECT | `active IS TRUE` | — |
| 2 | `courses` | `v3_auth_read_active_courses` | authenticated | SELECT | `active IS TRUE` | — |
| 3 | `lessons` | `v3_anon_read_free_lessons` | anon | SELECT | `active IS TRUE AND is_free IS TRUE` | — |
| 4 | `lessons` | `v3_auth_read_enrolled_lessons` | authenticated | SELECT | `active IS TRUE AND EXISTS(active enrollment for auth.email() on lessons.course_slug)` | — |
| 5 | `student_enrollments` | `v3_auth_read_own_enrollments` | authenticated | SELECT | `lower(email) = lower(auth.email())` | — |
| 6 | `lesson_progress` | `v3_auth_read_own_progress` | authenticated | SELECT | `lower(email) = lower(auth.email())` | — |
| 7 | `lesson_progress` | `v3_auth_update_own_progress` | authenticated | UPDATE | `lower(email) = lower(auth.email())` | `lower(email) = lower(auth.email())` |
| 8 | `student_active_sessions` | `v3_auth_read_own_sessions` | authenticated | SELECT | `lower(email) = lower(auth.email())` | — |

Plus 1 RPC hardening (not a policy):
- `ALTER FUNCTION public.handle_student_session_login(text×9, integer) SECURITY DEFINER;`
- `ALTER FUNCTION ... SET search_path = public;`

**Tables that gain NO policy** (remain service-role-only, unchanged): all other 21 public tables incl. `orders`, `students`, `admin_audit_logs`, `lms_entry_tokens`, `lms_verified_sessions`, `student_session_controls`, `sync_*`, `posts`, etc. This is intentional — the browser never touches them in v3 read paths.

## 3. Role matrix

| Role | Before migration | After migration |
|------|------------------|-----------------|
| `service_role` | Full access (bypasses RLS) on all tables + all RPC EXECUTE | **Unchanged** — still bypasses RLS. V1/V2 identical. |
| `anon` | Blocked on every table (RLS on, 0 policy) | SELECT on active courses + free active lessons only. No RPC EXECUTE change (login RPC still denied to anon). |
| `authenticated` | Blocked on every table | SELECT own enrollments / progress / sessions + enrolled active lessons + active courses; UPDATE own `lesson_progress`. |
| `postgres` / `supabase_admin` | Owner + EXECUTE | Unchanged. |

> Note: `auth.email()` returns the JWT `email` claim. In v3 the browser presents a Supabase-authenticated JWT (anon/authenticated tier via `utils/v3-db.js`). Until `SUPABASE_ANON_KEY` is provisioned, the anon/authenticated tiers fail-closed — so these policies are latent (created, but no client can exercise them yet). **This is safe** but means the policies cannot be end-to-end validated in prod until the anon key exists.

## 4. Expected allow/deny cases (staging test plan)

Run on a **staging clone** (not prod) after applying the migration there:

| # | Actor | Action | Expected |
|---|-------|--------|----------|
| A1 | anon | `SELECT * FROM courses WHERE active` | ✅ ALLOW (rows) |
| A2 | anon | `SELECT * FROM courses WHERE NOT active` | ✅ returns 0 rows (filtered, not error) |
| A3 | anon | `SELECT * FROM lessons WHERE is_free AND active` | ✅ ALLOW |
| A4 | anon | `SELECT * FROM lessons WHERE NOT is_free` | ⛔ 0 rows |
| A5 | anon | `SELECT * FROM student_enrollments` | ⛔ 0 rows (no anon policy) |
| A6 | anon | `SELECT * FROM orders / students / admin_audit_logs` | ⛔ 0 rows |
| B1 | authenticated (student X) | `SELECT own enrollments` | ✅ only X's rows |
| B2 | authenticated (student X) | `SELECT enrollments WHERE email = Y` | ⛔ 0 rows (scoped by auth.email()) |
| B3 | authenticated (student X, enrolled in C) | `SELECT lessons WHERE course_slug = C` | ✅ active lessons of C |
| B4 | authenticated (student X, NOT enrolled in D) | `SELECT lessons WHERE course_slug = D AND NOT is_free` | ⛔ 0 rows |
| B5 | authenticated (student X) | `UPDATE lesson_progress SET ... WHERE email = X` | ✅ ALLOW |
| B6 | authenticated (student X) | `UPDATE lesson_progress WHERE email = Y` | ⛔ 0 rows affected (WITH CHECK) |
| B7 | authenticated | `INSERT INTO lesson_progress` | ⛔ denied (no INSERT policy) |
| C1 | service_role | any read/write on any table | ✅ unchanged (bypass) |
| D1 | anon/authenticated | `SELECT handle_student_session_login(...)` (RPC) | ⛔ EXECUTE still denied (grant unchanged) |
| D2 | service_role | `handle_student_session_login(...)` | ✅ works, now as DEFINER |

## 5. Rollback SQL (additive-reverse — never edit the forward migration)

```sql
-- rollback_v3_rls_policies.sql  (owner-applied only if needed)
BEGIN;

DROP POLICY IF EXISTS v3_anon_read_active_courses      ON public.courses;
DROP POLICY IF EXISTS v3_auth_read_active_courses      ON public.courses;
DROP POLICY IF EXISTS v3_anon_read_free_lessons        ON public.lessons;
DROP POLICY IF EXISTS v3_auth_read_enrolled_lessons    ON public.lessons;
DROP POLICY IF EXISTS v3_auth_read_own_enrollments     ON public.student_enrollments;
DROP POLICY IF EXISTS v3_auth_read_own_progress        ON public.lesson_progress;
DROP POLICY IF EXISTS v3_auth_update_own_progress      ON public.lesson_progress;
DROP POLICY IF EXISTS v3_auth_read_own_sessions        ON public.student_active_sessions;

-- Revert the RPC to its prior posture (was SECURITY INVOKER, proconfig null).
ALTER FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) SECURITY INVOKER;
ALTER FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) RESET search_path;

COMMIT;
```

Dropping policies restores the "RLS on, 0 policy" baseline (anon/authenticated blocked again). Because service_role bypasses RLS, dropping policies **cannot break V1/V2**.

## 6. Lock risk

- `CREATE POLICY` takes a brief `ACCESS EXCLUSIVE`-class lock on the target table's catalog entry — **very short**, metadata-only, no table rewrite, no row scan. On tables this size (courses 6, lessons 35, student_enrollments 19, lesson_progress 0, student_active_sessions 15) the lock is sub-millisecond.
- `ALTER FUNCTION ... SECURITY DEFINER / SET search_path` locks the function row only — negligible.
- **No `VALIDATE CONSTRAINT`, no index build, no `ALTER TABLE` rewrite.** Whole migration is metadata DDL inside one transaction.
- Contention risk: only if a long-running txn holds a conflicting lock on `courses`/`lessons` at apply time. Mitigate with `SET lock_timeout = '3s'` before the migration and retry.

## 7. Maintenance window

- **Not strictly required** (metadata-only, sub-second). Recommended: apply during a low-traffic window anyway, with `statement_timeout`/`lock_timeout` set, so a stray lock can't stall it.
- **Order dependency:** apply AFTER `migration_v3_runtime_config.sql` (B1) and ideally alongside the anon-key provisioning, since the policies are inert without an anon/authenticated client. RLS policies do **not** depend on the outbox (B2) or drift (B3) migrations.
- **Reversibility:** full, via §5 rollback SQL.

## 8. Staging test plan (gate before prod apply)

1. Clone B schema to a staging project (`supabase db dump` → restore, or a branch DB). Requires Docker (owner) or a staging Supabase project.
2. Provision an `anon` key + an `authenticated` JWT for two test students (X enrolled in C, Y enrolled in D).
3. Apply `migration_v3_rls_policies.sql` on staging.
4. Run every case in §4 (A1–A6, B1–B7, C1, D1–D2). All must match "Expected".
5. Confirm V1/V2 service-role paths on staging are byte-identical (run the existing V1 smoke).
6. Validate the DEFINER flip: call `handle_student_session_login` via service_role on staging, confirm the returned JSON shape is unchanged vs prod behavior (no search_path regression).
7. Only after all green: schedule prod apply in a low-traffic window with `lock_timeout=3s`, then re-run A/B/C/D read-only checks against prod (they'll be inert until anon key ships — document that).

## 9. Blockers before RLS apply (owner)

- [ ] `SUPABASE_ANON_KEY` provisioned (else policies are latent / untestable end-to-end).
- [ ] Staging clone available (Docker or staging Supabase project).
- [ ] Two test students seeded on staging for scoped-read validation.
- [ ] Owner sign-off on the `handle_student_session_login` → `SECURITY DEFINER` normalization (the one behavior-affecting change).
- [ ] B1 (`migration_v3_runtime_config.sql`) applied first.

**Hard stop:** do not apply `migration_v3_rls_policies.sql` in Stage 1. This report is the deliverable; the apply is a separate owner-gated step.
