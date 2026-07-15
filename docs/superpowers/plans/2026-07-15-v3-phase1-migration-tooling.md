# V3 Phase 1 (⑦) — Migration Tooling + CI Schema-Drift Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Supabase B schema under version control with a Supabase CLI directory, a pure testable schema-drift diff engine, a drift allowlist seeded from the VERIFIED production catalog, and a CI gate — without touching production data (baseline `db pull` + `migration repair` remain owner-only).

**Architecture:** All work is repo-side tooling + tests + docs + CI config. The diff engine is a pure function over two catalog-snapshot JSON objects (EXPECTED from migrations, ACTUAL from live DB) that classifies each difference as FAIL / WARN / PASS after applying `drift_allowlist.json`. The CI workflow wires real dumps into that engine but is only green once the owner provisions `SUPABASE_DB_URL_RO`. No runtime code (`api/`, `utils/`) changes; no production writes.

**Tech Stack:** Node 24 (`node:test`, ES modules `.mjs`), Supabase CLI pinned `2.109.1` (via `npx`, no global install), GitHub Actions.

## Global Constraints

- Additive-only migrations until Phase 10. No `DROP` / `RENAME` / `ALTER TYPE`.
- No self-cutover: never set `active_mode=v2/v3` on production. Owner flips.
- No production writes (`db push`, `migration repair`, INSERT/UPDATE/DELETE) — owner-only, recorded as "pending", does NOT block auto-advance.
- No secret in any committed file. `config.toml` holds only public `project_id = "aqozjkfwzmyfunqvcyjv"`.
- Do not commit `.claude/`, `.env*`, `scratch/`, `tests/.supabase-stub.json`.
- Do not touch `main`, tag `v1-stable-20260713`, or the Portal repo.
- Phase bar: `node --test` green + secret scan clean + V1 path unchanged + commit + push.
- If a new committed file contains the literal `V2_GLOBAL_ONE_DEVICE_ENABLED`, it must be added to the allow-list set in `tests/rp2b1-session-device.test.mjs`. (Phase 1 files avoid that string, so no change expected.)

---

### Task 1: schema-diff engine + tests (testable core)

**Files:**
- Create: `supabase/tools/schema-diff.mjs`
- Create: `supabase/tools/fixtures/expected.sample.json`
- Create: `supabase/tools/fixtures/actual.sample.json`
- Test: `tests/schema-diff.test.mjs`

**Interfaces:**
- Produces:
  - `diffCatalogs(expected, actual, allowlist) -> { verdict: 'PASS'|'FAIL', fails: Finding[], warns: Finding[], allowed: Finding[] }`
  - `Finding = { kind, object, detail, severity }` where `kind ∈ {'table','column','index','constraint','rls','policy','function','grant'}`, `severity ∈ {'FAIL','WARN'}`.
  - A catalog snapshot shape: `{ tables: {name: {columns, rls_enabled, rls_forced}}, indexes: [{table,name,unique,partial,def}], constraints: [{table,name,type,def}], policies: [{table,name}], functions: [{name,security,grants}], grants: [...] }`.
  - `loadAllowlist(json) -> normalized allowlist` (tolerates missing keys).
- Consumes: nothing (pure, no DB, no fs beyond fixtures loaded by the test).

Rules the engine encodes:
- Missing/added table, column, index, constraint, RLS flag change, policy, function security-mode or grant change → **FAIL** (unless allowlisted).
- Column-order-only difference, comment-only, default-expression textual reformat → **WARN**.
- Any finding whose `{kind, object}` matches an allowlist entry → moved to `allowed`, never fails.
- `verdict` is `FAIL` iff `fails.length > 0`.

- [ ] **Step 1: Write the failing test** (`tests/schema-diff.test.mjs`) — cases: identical catalogs → PASS; dropped column → FAIL; added table → FAIL; RLS toggled off → FAIL; allowlisted drift column (`lessons.is_section`) → allowed/PASS; column-reorder-only → WARN not FAIL; missing `sync_dead_letters` table present in EXPECTED but not ACTUAL → FAIL unless allowlisted.
- [ ] **Step 2: Run test to verify it fails** — `node --test tests/schema-diff.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement `supabase/tools/schema-diff.mjs`** as a pure module with the interface above.
- [ ] **Step 4: Run test to verify it passes** — `node --test tests/schema-diff.test.mjs` → PASS.
- [ ] **Step 5: Run full suite** — `node --test tests/*.test.mjs` → 159 + new tests, 0 fail.

### Task 2: Supabase CLI scaffold + seed split

**Files:**
- Create: `supabase/.gitignore`
- Create: `supabase/seeds/seed.sql`
- Keep: `supabase/config.toml` (already present, public `project_id`).

- [ ] **Step 1:** Write `supabase/.gitignore` ignoring `.env`, `.temp/`, `.branches/`, `generated/`.
- [ ] **Step 2:** Write `supabase/seeds/seed.sql` — the two `INSERT INTO courses` (`donut`, `banh-mi`) lifted verbatim from `supabase_schema.sql`, with a header comment: preview/local only, never production.
- [ ] **Step 3:** Verify CLI parses config — `npx supabase@2.109.1 --version` → `2.109.1` (baseline/migrations dir empty is fine; `db pull` is owner-only).

### Task 3: drift_allowlist.json baseline

**Files:**
- Create: `supabase/drift_allowlist.json`

- [ ] **Step 1:** Author `supabase/drift_allowlist.json` seeded from VERIFIED production state (`docs/V3_SCHEMA_GAP_SQL_RESULTS.md`): drift columns (`lessons.is_section`, `lessons.materials`, `courses.is_published`, `courses.expected_start_date`, `courses.drive_folder_id`, `courses.drive_permission_mode`, `courses.sync_lms_status/sync_portal_status/sync_error`, identity columns), RLS-on-0-policy pattern on all 25 tables, `handle_student_session_login` SECURITY INVOKER, and the partial-outbox note (`sync_outbox`/`sync_deliveries` exist, `sync_dead_letters` absent). Each entry: `{kind, object, reason, verified_source}`.
- [ ] **Step 2:** Assert the allowlist parses and is consumed — add a test case in `tests/schema-diff.test.mjs` loading the real `supabase/drift_allowlist.json` via `loadAllowlist` and asserting a known drift column is allowed.
- [ ] **Step 3:** Run `node --test tests/schema-diff.test.mjs` → PASS.

### Task 4: CI schema-drift-gate workflow

**Files:**
- Create: `.github/workflows/schema-drift-gate.yml`

- [ ] **Step 1:** Write the workflow: trigger on PR to `v3/research-20260715` + nightly cron; job installs Node 24, runs `npx supabase@2.109.1`, spins ephemeral PG, applies `supabase/migrations/*` → dump EXPECTED, dumps ACTUAL from `${{ secrets.SUPABASE_DB_URL_RO }}` (read-only), converts both to catalog JSON, runs `node supabase/tools/schema-diff.mjs` with `drift_allowlist.json`, fails on `verdict=FAIL`. Guard: skip ACTUAL dump + pass-with-warning if `SUPABASE_DB_URL_RO` is unset (so the workflow is valid before the owner provisions the secret).
- [ ] **Step 2:** Lint YAML syntax — `node -e "const y=require('fs').readFileSync('.github/workflows/schema-drift-gate.yml','utf8'); if(!/jobs:/.test(y)) throw new Error('bad')"` (or a YAML parse if available). Confirm no secret is inlined.

### Task 5: docs + commit/push

**Files:**
- Create: `docs/V3_PHASE_1_MIGRATION_TOOLING.md`
- Modify: `README.md` (mark `supabase_schema.sql` + `migration_*.sql` as historical reference)

- [ ] **Step 1:** Write `docs/V3_PHASE_1_MIGRATION_TOOLING.md`: what was built, how to run the gate locally, the owner-only steps (Docker + `db pull` baseline, `migration repair --status applied`, create read-only role + `SUPABASE_DB_URL_RO`, decide `posts` A/B ownership, rollback drill), all recorded as "pending".
- [ ] **Step 2:** Add a note to `README.md` pointing `supabase_schema.sql` / `migration_*.sql` readers to `supabase/migrations/` as the future source of truth (deprecated-reference).
- [ ] **Step 3:** Secret scan staged diff (service-role JWT, `sbp_`, DB URL w/ password, `-----BEGIN`). Expect PASS.
- [ ] **Step 4:** Reset `tests/.supabase-stub.json` to `{}`. Confirm `git status` shows no `.claude/` / `.env*` / `scratch/` staged.
- [ ] **Step 5:** Commit on `v3/research-20260715` and push. Verify `main` + `v1-stable-20260713` unchanged.

---

## Self-Review

- **Spec coverage:** §3 handoff items 1–5 map to Tasks 1 (diff engine), 2 (scaffold+seed), 3 (allowlist), 4 (CI), 5 (docs). Owner-only items (baseline pull, repair, RO role, `posts` ownership, rollback drill) are documented as pending in Task 5, not blockers.
- **Placeholder scan:** none — engine interface and allowlist sources are concrete.
- **Type consistency:** `diffCatalogs`/`loadAllowlist`/`Finding` names used consistently across Tasks 1, 3, 4.
