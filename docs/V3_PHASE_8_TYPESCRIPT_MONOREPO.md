# V3 Phase 8 (⑩) — TypeScript + Monorepo + Shared Event Schema

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8) — the **shared-schema slice** of ⑩. Tests green (`v3-event-schema` 12; full suite 241/241). Code-only. The full JS→TS migration + pnpm workspace wiring is documented below as larger follow-up, deferred until the owner commits to the v3 cutover (it touches every file; high churn to do speculatively).
>
> **Goal (slice shipped):** give Shop/Portal/LMS a single source of truth for the cross-repo contract — event types, DTO shapes, error codes, helpers, runtime constants — so a breaking contract change is a compile/test error in every repo, not a silent production 401 (the V1/V2 sync-secret coupling pain ⑩ targets).

## What this phase added

| Path | Role |
|---|---|
| `packages/v3-event-schema/` | New shared package. `package.json` with subpath exports (`./events`, `./dto`, `./errors`, `./helpers`, `./runtime`). Importable by all three repos. |
| `src/runtime.mjs` | `RUNTIME_VERSIONS`, `CURRENT_SCHEMA_VERSION='2026-07-15'`, `VALID_MODES` (mirrors the controller), `normalizeRuntimeVersion` (fail-closed to v1). |
| `src/events.mjs` | `EVENT_TYPES` (frozen, expand-only), `AGGREGATE_TYPES`, `makeEventEnvelope(...)` — stamps `runtime_version`+`schema_version`. |
| `src/dto.mjs` | `enrollmentDto` / `courseDto` / `sessionEventDto` — assert required fields at the boundary. |
| `src/errors.mjs` | `ERROR_CODES` (frozen) + `reasonToErrorCode` (stable mapping; `valid`→null). |
| `src/helpers.mjs` | `normalizeEmail`, `buildIdempotencyKey` (deterministic sha256 — mirrors `utils/v2-outbox.js`), `maskEmail`, `hashIdentifier`. |
| `tests/v3-event-schema.test.mjs` (12) | runtime constants, frozen/stable event types, envelope stamping, DTO validation, error mapping, helpers, and the expand-only invariant (a V1 consumer still finds its known fields on a V3-produced envelope). |

## Why this slice now (and not the full TS migration)

The real value of ⑩ is killing the "trộn repo" / sync-secret coupling where a breaking contract surfaces as a production 401. That value is captured by the **shared schema package** — independent of whether the LMS serverless code is JS or TS. Converting ~40 `.js` files to `.ts` + setting up a pnpm workspace + build step is large, churns every file, and only pays off once the owner is committed to v3 (until then V1/V2 must keep running on the current JS). Shipping the shared schema now lets the contract crystallize; the TS pass can adopt it wholesale later.

## Expand-only invariant (asserted)

The package is a contract: existing `EVENT_TYPES` strings are frozen; a new event is additive, a rename/remove is a **major version bump**. The test suite asserts a V1 consumer reading a V3-produced envelope still finds every field it knows — additive fields are extra, never replacements. This is the same compatibility contract the runtime enforces at the data layer (Phase 0/2).

## How the three repos consume it

- Today: import via relative path / local workspace link. The LMS repo can `import { EVENT_TYPES } from '../packages/v3-event-schema/src/index.mjs'` immediately (tests already do).
- When published: `pnpm add @v3-lms/event-schema` (private registry or git dep). The `exports` map is already defined.
- Shop/Portal adopt by pointing at the same package — one definition, not three divergent ones.

## Owner action pending

None for the slice. Publishing to a registry / wiring pnpm workspaces is owner infra, recorded as follow-up; the package is usable in-tree now.

## Follow-up (documented, not done)

- Convert LMS serverless JS → TS (type the new V3 modules first — they're small and isolated; leave V1/V2 JS during the canary).
- `pnpm-workspace.yaml` + hoist the shared package across Shop/Portal/LMS.
- Contract tests vs live schema (expand-only) generated from `packages/v3-event-schema`.

## Test bar met (Phase 8)

- `node --test tests/*.test.mjs` → 241/241.
- New package only; no existing runtime file edited → V1/V2 unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched. No production write.
