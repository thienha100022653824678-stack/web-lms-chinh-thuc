# V3 Phase 1 (⑦) — Migration Tooling + CI Schema-Drift Gate

> **Status:** Repo-side tooling DONE 2026-07-15 (Opus 4.8). Tests green (`node --test tests/schema-diff.test.mjs` — 13/13; full suite 172/172). Owner-only production steps recorded as **pending** below — they do NOT block auto-advance to Phase 2.
>
> **Goal of Phase 1:** put Supabase B schema under version control (Supabase CLI dir), give the repo a pure testable drift-diff engine + a drift allowlist seeded from the VERIFIED production catalog, and a CI gate — **without touching production data**. Baseline `db pull` + `migration repair` remain owner-only.

## What this phase added

| File | Role |
|---|---|
| `supabase/tools/schema-diff.mjs` | Pure diff engine. `diffCatalogs(expected, actual, allowlist)` → `{verdict, fails, warns, allowed}`. `loadAllowlist(json)`. Structural drift = FAIL, cosmetic (column order) = WARN, allowlisted = `allowed`. No DB, no fs. |
| `supabase/tools/run-drift-gate.mjs` | CLI wrapper: reads two catalog JSON snapshots + allowlist, prints a report, exits 0=PASS / 1=FAIL / 2=IO error. |
| `supabase/tools/catalog-query.sql` | READ-ONLY SELECT over `pg_catalog`/`information_schema` emitting one JSON row = a catalog snapshot (tables+columns+rls, indexes, constraints, policies, functions+grants). Run against EXPECTED and ACTUAL. |
| `supabase/drift_allowlist.json` | The current production-B schema "hiện trạng" baptized as accepted baseline — seeded from `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` (drift columns, partial-outbox `sync_dead_letters`, `posts`, RLS-on/0-policy, SECURITY INVOKER login RPC). Phase 10 (⑧) formalizes each entry into a migration and removes it. |
| `supabase/seeds/seed.sql` | Sample courses (`donut`/`banh-mi`) lifted from `supabase_schema.sql`. **Preview/local only, never production.** Not part of the drift comparison. |
| `supabase/.gitignore` | Ignores `.env`, `.temp/`, `.branches/`, `generated/`. |
| `.github/workflows/schema-drift-gate.yml` | CI: `unit-tests` (always, runs the engine tests) + `drift-gate` (ephemeral PG applies `supabase/migrations/*` → EXPECTED dump; ACTUAL dump from `SUPABASE_DB_URL_RO`; diff via `schema-diff.mjs`). Inert-but-valid until the owner provisions the secret + a baseline migration exists. |
| `tests/schema-diff.test.mjs` | 13 tests: identical→PASS, dropped/added table+column→FAIL, RLS toggle→FAIL, function security-mode→FAIL, missing `sync_dead_letters`→FAIL-unless-allowlisted, allowlisted drift column→PASS, column-reorder→WARN, type change→FAIL, dropped unique index/constraint→FAIL, real allowlist parses. |
| `supabase_schema.sql` + `migration_*.sql` | **Kept** as historical reference (README marked deprecated). Cleanup is Phase 10 (⑧). |

## How to run the gate locally

```bash
# 1. Snapshot EXPECTED (from an ephemeral PG with supabase/migrations/* applied):
psql "$EXPECTED_DB_URL" -tA -f supabase/tools/catalog-query.sql > expected.json

# 2. Snapshot ACTUAL (production B, read-only role — owner-provisioned):
psql "$SUPABASE_DB_URL_RO" -tA -f supabase/tools/catalog-query.sql > actual.json

# 3. Diff, applying the allowlist:
node supabase/tools/run-drift-gate.mjs expected.json actual.json supabase/drift_allowlist.json
# exit 0 = PASS, 1 = FAIL (structural drift), 2 = IO error.

# Engine unit tests (no DB):
node --test tests/schema-diff.test.mjs
```

## Owner action pending (does NOT block auto-advance)

These are the only steps that touch production; recorded here so Phase 2 can proceed on stubs meanwhile.

1. **Install Docker Desktop** → `npx supabase@2.109.1 db pull` to generate `supabase/migrations/00000000000000_baseline.sql` (real baseline snapshot of B). Do NOT hand-write it.
2. `npx supabase@2.109.1 migration repair --status applied 00000000000000_baseline` — writes **1 metadata row** into `supabase_migrations.schema_migrations`. The single production-touching op in ⑦. Rollback: `... --status reverted ...`.
3. **Create a read-only role** on B (SELECT catalog only, not service-role) → set GitHub secret `SUPABASE_DB_URL_RO`. Until set, the gate's `drift-gate` job is inert (passes with a notice); `unit-tests` still runs.
4. **Decide `posts` A/B ownership** (GO condition #3). `posts` is allowlisted for now; once decided, either move it into the B baseline or exclude it.
5. **Rollback drill** → record in `docs/V3_PROPOSAL_7_ROLLBACK_DRILL.md` before the gate runs on a real PR.

## Test bar met (Phase 1)

- `node --test tests/schema-diff.test.mjs` → 13/13. Full suite `tests/*.test.mjs` → 172/172, 0 fail.
- `npx supabase@2.109.1 --version` → `2.109.1` (config.toml parses; migrations dir empty is expected — baseline is owner-only).
- `.github/workflows/schema-drift-gate.yml` syntactically valid, no tabs, no inlined secret; ACTUAL step gated on `SUPABASE_DB_URL_RO`.
- No secret in any committed file. No runtime code (`api/`, `utils/`) edited → V1 path unchanged. `main` + `v1-stable-20260713` untouched.

## Why the allowlist "baptizes" current drift

The baseline = production truth as of 2026-07-15. Known divergences between the legacy `supabase_schema.sql`/`migration_*.sql` and live B (drift columns like `lessons.is_section`, the partially-applied outbox missing `sync_dead_letters`, RLS-on-with-0-policy, the SECURITY INVOKER login RPC) are recorded as accepted so the gate does not fail on day one. Each is a tracked debt Phase 10 (⑧) formalizes into an additive migration and removes from the allowlist. This is intentional (plan §3/§10), transparent, and auditable — not a silent pass.
