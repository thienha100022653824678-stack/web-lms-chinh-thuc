# V3 Auth Hardening — `handle_student_session_login` EXECUTE grants

> **Status:** repo-side verification + test added 2026-07-16 on
> `v3/research-20260715`. **No migration applied** (owner-only).
>
> **TL;DR:** The hardening the owner flagged (REVOKE PUBLIC/anon/authenticated,
> GRANT only to service_role) is **already the production state** and **already
> shipped as a tracked migration** (`migration_handle_student_session_login_grants_hardening.sql`,
> commit `a849362`, an ancestor of this branch). This phase verifies it, locks it
> with tests + a verification query, and documents the architecturally-sound
> `service_role`-only design. **No new migration is needed for the grants.**

## 1. What the owner flagged

> `handle_student_session_login` có thể đang executable bởi PUBLIC, anon và
> authenticated. Phương án hardening: REVOKE PUBLIC, REVOKE anon, REVOKE
> authenticated, chỉ GRANT cho service_role nếu phù hợp với kiến trúc thực tế.

## 2. Verified production state (read-only catalog, 2026-07-15)

Source: `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` §Block 4d — `information_schema` +
`pg_catalog` cross-role leak check:

| function | public_has_execute | anon_has_execute | authenticated_has_execute | service_role_has_execute |
|---|---|---|---|---|
| `handle_student_session_login` (10 args) | **false** | **false** | **false** | **true** |

**Conclusion:** production already matches the requested hardening exactly.
PUBLIC / anon / authenticated do **not** have EXECUTE; only `service_role`
(and the superuser roles `postgres` / `supabase_admin`) do.

## 3. The migration is already tracked and in this branch's history

File: `migration_handle_student_session_login_grants_hardening.sql` (RP2-B0).

- Added in commit `a849362` ("chore(v2-rp2b0): harden session login RPC grants").
- `git merge-base --is-ancestor a849362 HEAD` → **YES** — it is in the
  `v3/research-20260715` history (came in via the V2 rebuild lineage).
- It is idempotent in its final privilege state: `REVOKE ALL FROM PUBLIC/anon/authenticated`
  + `GRANT EXECUTE TO service_role`, wrapped in a single `BEGIN/COMMIT`. It does
  **not** touch the function body or signature.

So the *repo* already carries the hardening. The risk the owner sensed is real
in general (un-revoked PUBLIC EXECUTE is a classic Supabase footgun), but for
this specific RPC it is already closed. What was missing was **verification +
lock-in tests + documentation** — added now.

## 4. Architectural fit: why `service_role`-only is correct

`handle_student_session_login` mints/rotates student sessions, device-guard rows,
entry tokens, and verified-session rows. It is a multi-table authoritative write.

V3's write path is deliberately server-only: `utils/v3-write-path.js` executes
all authoritative RPCs with the **`service_role`** tier (`role = 'service_role'`),
and `utils/v3-db.js` fail-closes so anon/authenticated can never fall back to the
service-role key. A browser presenting an anon/authenticated JWT must **never**
mint its own session directly — that would bypass the one-device guard and the
device-id server-mint contract (Phase 4 ②③). Therefore:

- ✅ GRANT EXECUTE to `service_role` — the trusted Portal/LMS backend calls it
  server-side.
- ⛔ no EXECUTE for `anon` / `authenticated` / `PUBLIC` — a browser-reachable
  caller must not reach this RPC.

The architecture matches the requested hardening. Nothing to relax.

## 5. What this phase added (repo-side, no production)

1. **`tests/v3-session-login-grants.test.mjs`** — 6 static assertions on
   `migration_handle_student_session_login_grants_hardening.sql`:
   - transactional (`BEGIN/COMMIT`),
   - privilege-only (no `DROP`/`RENAME`/`ALTER TYPE`/`CREATE OR REPLACE`/body),
   - REVOKE from PUBLIC + anon + authenticated,
   - GRANT EXECUTE only to service_role,
   - does **not** GRANT to anon/authenticated (regression guard),
   - idempotent final state.
2. This document.
3. A verification SQL block (§7) the owner can run read-only on prod to re-confirm
   the grant state at any time (and before/after any future migration touch).

## 6. The SECURITY DEFINER normalization is a SEPARATE, already-tracked migration

The owner's grant concern is orthogonal to the `SECURITY INVOKER` vs `DEFINER`
finding. The security-mode normalization (INVOKER → DEFINER + pinned
`search_path`) lives in **`migration_v3_rls_policies.sql`** (Phase 2 ①), also
tracked and owner-applied. Stage 1 produced `docs/V3_STAGE1_RLS_READINESS_REPORT.md`
auditing it; it is **not** applied in Stage 1 (hard stop, owner gate). The grant
migration and the DEFINER migration are independent and can be applied in either
order, though the readiness report recommends the grant state (already applied)
be confirmed first.

## 7. Owner verification query (read-only, run on Supabase B)

```sql
-- Re-confirm the EXECUTE posture of handle_student_session_login.
-- Expected after hardening: only service_role + superuser roles have EXECUTE.
SELECT
  g.grantee,
  g.has_privilege AS has_execute
FROM (
  SELECT grantee, bool_or(has_execute) AS has_privilege
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN LATERAL aclexplode(p.proacl) AS acl ON true
  LEFT JOIN LATERAL (
    SELECT rolname FROM pg_catalog.pg_roles WHERE oid = acl.grantee
  ) r ON true
  WHERE n.nspname = 'public' AND p.proname = 'handle_student_session_login'
  GROUP BY grantee, r.rolname
) g
ORDER BY g.grantee;
-- Expected rows: service_role=true, postgres=true, supabase_admin=true.
-- Expected absent: PUBLIC, anon, authenticated.
```

A simpler inline check (returns true only when the posture is correct):

```sql
SELECT
  (NOT has_function_privilege('anon','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  AND
  (NOT has_function_privilege('authenticated','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  AND
  (NOT has_function_privilege('PUBLIC','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  AND
  (has_function_privilege('service_role','public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)','EXECUTE'))
  AS grants_hardened_correctly;
-- Expected: true
```

## 8. Owner-only step (recorded pending — does NOT block auto-advance)

- **Nothing to apply** for the grants — they are already the prod state and the
  migration is tracked. If a future audit shows the grants drifted (e.g. someone
  re-ran the original `migration_atomic_session_guard.sql` `CREATE OR REPLACE
  FUNCTION` without the follow-up REVOKE/GRANT, which can reset default grants),
  re-apply `migration_handle_student_session_login_grants_hardening.sql` on B
  via the SQL Editor (service-role). It is idempotent.
- The **DEFINER** normalization in `migration_v3_rls_policies.sql` remains an
  owner-applied gate per the Stage 1 RLS readiness report (staging clone test
  first). That is tracked separately in [[v3-owner-pending-actions]].
