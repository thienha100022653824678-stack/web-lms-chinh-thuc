# V3 Supabase Production Migration — RESULT

> **Project ref (public):** `aqozjkfwzmyfunqvcyjv`
> **Date (UTC):** 2026-07-16 04:34–04:42
> **Branch:** `v3/research-20260715`
> **HEAD (pre-apply):** `7ce89da4104e7f2054fbd3fcfa059b461913f782`
> **Supabase CLI:** `2.109.1`
> **Applied by:** `postgres` (DB owner) via Supabase Management API (`db query --linked`)

This report contains **no passwords, tokens, service-role keys, full DB URLs, or
personal learner data.** All metadata captured is schema structure + aggregate row counts.

---

## 1. Outcome — ALL PASS

| Stage | Result |
|---|---|
| Preflight (`scripts/v3/preflight-v3.sql`) | **PASS** (GO) |
| B1 `migration_v3_runtime_config.sql` | **PASS** |
| B2 `migration_v3_outbox_dead_letters.sql` | **PASS** |
| B3 `migration_v3_rls_policies.sql` | **PASS** |
| B4 `migration_v3_formalize_drift_columns.sql` | **PASS** |
| Postflight (`scripts/v3/postflight-v3.sql`) | **PASS** (7/7 requirements true) |
| Migration list sync | **PASS** (4/4 local == remote, applied; `db push --dry-run` = up to date) |
| Node test suite (`node --test tests/*.test.mjs`) | **PASS** (271/271, 0 fail) |
| Production read-only smoke | **PASS** (site live; V3 routes absent → migrations inert) |

**Overall: V3 Supabase B migration complete and verified. No safety constraint violated.**

---

## 2. Safety posture AFTER migration (all as required)

| Control | State | Note |
|---|---|---|
| `active_mode` | **`v1`** | Singleton row seeded to v1; unchanged. V1 authoritative. |
| Kill switch | **disabled** (`false`) | Not forcing; `active_mode='v1'` already safe. |
| `v2_shadow_mode` / `v3_shadow_mode` | **`false`** / **`false`** | No shadow writes. |
| V3 authoritative write | **OFF** | No runtime-controller code on production deployment (`/api/v2/runtime` → 404, `/api/v3/*` → 404). DB spine is inert until a V3 code deploy. |
| Live delivery | **OFF** | No delivery job triggered; outbox counts unchanged. |
| RLS | Enabled on the 2 new config tables + `sync_dead_letters`; the 8 least-privilege browser policies added. `service_role` bypass unchanged → V1/V2 (service-role) unaffected. | 25 RLS-on / 2 RLS-off / 27 total (the 2 off are pre-existing V2 `sync_outbox` + `sync_deliveries`, outside V3 scope). |
| `handle_student_session_login` | **SECURITY DEFINER**, `search_path=public`; EXECUTE = `service_role` only (anon/authenticated/PUBLIC = false). | Body + signature unchanged. |
| Business data | **Untouched** | All 4 migrations additive + idempotent. Row counts identical to preflight baseline. |

---

## 3. What was applied (additive, idempotent, order B1→B2→B3→B4)

- **B1 — runtime controller spine:** created `public.platform_runtime_config`
  (singleton, `active_mode` CHECK in `v1/v2/v3`, `kill_switch`) + append-only
  `public.platform_runtime_config_audit`; RLS enabled, no public policy; seeded
  singleton `(1, 'v1')`.
- **B2 — outbox dead-letters:** `sync_dead_letters` already existed on prod in the
  exact intended shape (the migration header's assumption that it was absent was
  benign — `CREATE ... IF NOT EXISTS` no-op'd). The **one real change**: enabled
  RLS on `sync_dead_letters` (was disabled). No data touched.
- **B3 — RLS policies + RPC hardening:** added 8 least-privilege policies
  (`v3_anon_read_active_courses`, `v3_auth_read_active_courses`,
  `v3_anon_read_free_lessons`, `v3_auth_read_enrolled_lessons`,
  `v3_auth_read_own_enrollments`, `v3_auth_read_own_progress`,
  `v3_auth_update_own_progress`, `v3_auth_read_own_sessions`); normalized
  `handle_student_session_login` to `SECURITY DEFINER` + `search_path=public`
  (no body/signature change).
- **B4 — formalize drift columns:** declared 20 verified-but-undocumented columns
  on `courses`/`lessons`/`orders`/`student_enrollments`. `ADD COLUMN IF NOT EXISTS`
  was a no-op where the column already existed (all 20 did) — **no data moved**.
  (NB: pre-existing columns retain their real prod defaults, e.g.
  `courses.sync_lms_status DEFAULT 'PENDING'`, `orders.source_system DEFAULT 'shop'`,
  `student_enrollments.source_system DEFAULT 'lms'`, `lessons.materials DEFAULT '[]'`;
  the migration's `IF NOT EXISTS` clause intentionally does not overwrite them.)

---

## 4. Postflight GO/NO-GO summary (§13 of `postflight-v3.sql`) — all `ok=true`

```
runtime_config_table .......... ok=true
runtime_config_singleton_v1 ... ok=true
sync_dead_letters_table ....... ok=true
v3_policy_count_is_8 .......... ok=true
login_rpc_is_definer .......... ok=true
login_rpc_search_path_pinned .. ok=true   (search_path=public)
login_grants_hardened ......... ok=true   (anon/auth/PUBLIC=false, service_role=true)
```

Invariants inherited from V1/V2 confirmed intact:
`idx_one_active_student_session_per_email` (partial unique) and
`student_enrollments_email_course_slug_key` (UNIQUE(email, course_slug)).

---

## 5. Production read-only smoke (no auth, no data-creating endpoints)

Target: `https://web-lms-chinh-thuc.vercel.app` (pre-existing production deploy; **not** a V3 promotion).

| Endpoint | Result | Interpretation |
|---|---|---|
| `GET /` | HTTP 200 text/html | Site live |
| `GET /api/v2/readiness` | HTTP 401 `{"ok":false,"error":"Unauthorized","message":"Worker secret is invalid or missing."}` | V2 path live, secret-gated, healthy fail-closed |
| `GET /api/v2/diagnostics` | HTTP 401 | Worker-secret gated (as designed) |
| `GET /api/v2/runtime` | HTTP 404 | Runtime controller not on prod → `active_mode` cannot be flipped via API |
| `GET /api/v3/diagnostics` | HTTP 404 NOT_FOUND | V3 routes absent on production deployment → DB migrations are inert until a V3 code deploy |
| `GET /api/v3/readiness` | HTTP 404 | Confirms no V3 route surface |

Conclusion: production is **unaffected** by the migration.

---

## 6. Migration history reconciliation

The 4 migrations were applied per-file via the Management API (running as `postgres`,
the intended owner context) rather than `db push` (which batches all 4 with no
per-step verify gate and prompts for the DB password). After all 4 were applied and
postflight-verified, the history was reconciled **honestly** to the real applied state
via `supabase migration repair --linked --status applied <4 versions>` — not a
faked-green: the SQL was actually executed and verified.

```
migration list --linked:
  20260716000001  local==remote  applied
  20260716000002  local==remote  applied
  20260716000003  local==remote  applied
  20260716000004  local==remote  applied
db push --linked --dry-run: "Remote database is up to date."
```

---

## 7. Repository changes committed

- `.gitignore`: added `.local-backups/` (local-only backups).
- `supabase/migrations/`: new directory with the 4 V3 migrations as timestamped
  wrappers, **byte-identical** to the reviewed root files
  (`migration_v3_*.sql`), ordered B1→B2→B3→B4:
  - `20260716000001_v3_runtime_config.sql`
  - `20260716000002_v3_outbox_dead_letters.sql`
  - `20260716000003_v3_rls_policies.sql`
  - `20260716000004_v3_formalize_drift_columns.sql`

No other repo files changed. Local backups/scratch are gitignored and **not** committed.

Secret scan of the commit set: **CLEAN** (no passwords / tokens / service-role keys / full DB URLs).

---

## 8. Warnings / notes

1. **Preflight vs. reality — `sync_dead_letters` already existed.** The B2 header
   documented it as "never created on production"; verified actual state had it
   present in the exact intended shape. B2's `CREATE TABLE/INDEX IF NOT EXISTS`
   were no-ops; its only real effect was enabling RLS on that table. Benign.
2. **Postflight §4 RLS count wording.** The postflight comment expected "RLS enabled
   on both V3 config tables"; also true. `sync_dead_letters` moved RLS-off → RLS-on
   via B2, bringing the public-table RLS tally to 25 on / 2 off / 27 total.
3. **`handle_student_session_login` is now `SECURITY DEFINER`.** This is the designed
   hardening (matches `reset_student_session_guard` / `cleanup_*`). It runs with the
   function owner's privileges; `search_path=public` is pinned to prevent
   search-path hijacking. EXECUTE is service-role-only, so only the server-side
   write path can invoke it — anon/authenticated/PUBLIC cannot.
4. **Migration applied via Management API, not `db push`.** Done deliberately to
   (a) gate each migration on a verify step and stop-on-fail, and (b) avoid the
   interactive DB-password prompt. History was then reconciled with
   `migration repair`. Future `db push` runs will correctly see "up to date".

## 9. Rollback readiness

Each migration is additive and reversible by a future migration (never by editing
these files):

- **B1:** `DROP TABLE public.platform_runtime_config_audit, public.platform_runtime_config;`
  (only when V3 fully rolled back — no business data is lost).
- **B2:** `ALTER TABLE public.sync_dead_letters DISABLE ROW LEVEL SECURITY;`
  (or `DROP TABLE` if V3 fully rolled back — table has 0 rows).
- **B3:** drop the 8 `v3_*` policies; revert `handle_student_session_login` to
  `SECURITY INVOKER` / clear `search_path` (additive-reverse).
- **B4:** no rollback needed (additive `ADD COLUMN IF NOT EXISTS`, no data moved);
  if ever required, a new migration drops the declared columns.

The runtime fail-safe (B1 singleton defaults to `v1`; kill_switch forces `v1`
regardless of `active_mode`) is in place but **not yet exercisable on prod** because
the controller code is not deployed there. A V3 code deploy + canary is a separate,
owner-gated step that this migration does **not** enable or trigger.

---

**Completion criteria — all satisfied:** project verified · backups created ·
preflight pass · B1/B2/B3/B4 pass · postflight pass · migration list synced ·
`active_mode=v1` · V3 authoritative write off · test suite pass · report committed.
