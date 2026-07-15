# V3 Phase 10 (⑧) — Dead Code / Schema Cleanup (final, owner-approved)

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8) for the **safe (additive + dead-code) subset**. Tests green (full suite 255/255). The **destructive** subset (DROP tables/columns, merging admin pages, removing legacy files) is an **owner-approval gate** — checklist below; it is NOT done, by design (Phase 10 is the one phase the handoff rules say needs owner sign-off before any destructive action).
>
> **Goal:** (a) formalize the VERIFIED undocumented drift columns into real additive migrations so the schema is an honest source of truth; (b) remove provably-dead code; (c) present the owner with a concrete destructive-cleanup checklist to approve + execute.

## What this phase shipped (safe subset)

| File | Role |
|---|---|
| `migration_v3_formalize_drift_columns.sql` | Additive, idempotent, owner-applied. `ADD COLUMN IF NOT EXISTS` for every VERIFIED drift column: `lessons.is_section/materials/kind/parent_section_id/position`, `courses.is_published/expected_start_date/drive_folder_id/drive_permission_mode/sync_lms_status/sync_portal_status/sync_error`, `orders.course_id/normalized_customer_email/sync_correlation_id/source_system`, `student_enrollments.course_id/normalized_email/sync_correlation_id/source_system`. On prod where they already exist, this is a no-op; on a fresh DB it declares them. **No data moved, no type changed, no drop.** |
| `tests/v3-cleanup-migration.test.mjs` (5) | additive-only, transactional, ADD COLUMN IF NOT EXISTS, and every drift column declared. |
| `utils/lms-handlers/banhmi4k-lessons.js` | **Deleted** — 0 importers (verified: no `.js`/`.mjs`/`.html` references it outside docs), pure dead data. Safe to remove. |

## Why formalize drift now (and why it's safe)

The drift columns were real on production but undeclared (V1 code reads them with hidden fallbacks). Formalizing them additively means:
- the schema becomes the honest source of truth — no more "is this column real?" (the exact pain ⑦'s drift gate exists to surface),
- once the owner applies this migration, those columns leave `supabase/drift_allowlist.json` (declared, no longer "accepted drift"),
- the Phase 8 shared-schema DTOs can name them without guessing.

It is additive-only: on production every `ADD COLUMN IF NOT EXISTS` is a no-op (the columns already exist with their real types/data); on a fresh migration-built DB it creates them with sensible defaults. Zero risk to live data.

## Owner-approval gate (destructive subset — NOT done)

Per the handoff rules, Phase 10 destructive actions need explicit owner sign-off. Checklist for the owner:

- [ ] **Apply `migration_v3_formalize_drift_columns.sql`** on B (additive, safe). Then remove the now-declared columns from `supabase/drift_allowlist.json`.
- [ ] **`lesson_progress` table** — VERIFIED 0 rows, dead. Owner decides: `DROP TABLE public.lesson_progress` (new migration) once confirmed no code path writes it. *Repo side: confirm no V3 code references it (none does).*
- [ ] **`posts` A/B ownership** (GO condition #3, still open) — decide whether `posts` stays on B or moves; if it's truly legacy dead, a drop migration after confirmation.
- [ ] **Admin page merge** — `admin.html` (146KB) vs `lms-admin.html` (260KB) overlap; merging is a large FE refactor → do behind the v3 gate after cutover, not speculatively.
- [ ] **Legacy schema files** — `supabase_schema.sql` + `migration_*.sql` remain as historical reference; final removal (delete files) only after the Supabase CLI baseline fully replaces them and the owner confirms no one references them.
- [ ] **`exchange-code.js`** orphan handler — already fail-closed behind the V2 flag; full removal once the Portal no longer references the route.
- [ ] **30-day JWT emitter** in `utils/lms.js` — remove only after the v3 opaque session (Phase 4) is the sole path post-cutover.

Each destructive item ships as its **own** migration/commit with a rollback drill, applied only after owner approval.

## Test bar met (Phase 10 safe subset)

- `node --test tests/*.test.mjs` → 255/255.
- Migration additive-only (asserted); dead-code file removal verified no importers; no V1/V2 runtime behavior changed (banhmi4k was never imported).
- No secret committed. `main` + `v1-stable-20260713` untouched. No production write (migration owner-applied; destructive items not done).

## V3 program — repo status

All 11 phases (0→10) have a repo-side deliverable. Critical path 0→1→2→3→4 complete; 5–10 shipped their safe slices. The remaining work is **owner-only**: apply the 4 additive migrations on B after canary, provision `SUPABASE_DB_URL_RO` + baseline pull, decide `posts` ownership, merge the Portal session PR (Phase 4), provision DRM (Phase 9), and approve + execute the destructive Phase 10 checklist. No self-cutover — the owner flips `active_mode` when ready.
