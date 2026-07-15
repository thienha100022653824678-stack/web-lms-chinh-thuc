# V3 Phase 5 (⑥) — Router Split + Edge Runtime for Read-Only

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-router` 4; full suite 213/213). Code-only phase — no owner production step. V1/V2 legacy router untouched.
>
> **Goal:** break the V1/V2 `?endpoint=` monolith router into per-route V3 functions (independent cold starts + dependency surfaces) and run genuinely read-only learner paths on the Vercel Edge Runtime for low latency — while V1/V2 keep the legacy router byte-for-byte.

## What this phase added

| File | Role |
|---|---|
| `utils/v3-handlers/router.js` | `dispatch(req, res)` branches on `getEffectiveMode()`: **v1/v2 → delegates to the legacy `api/lms/portal.js` router** (unchanged); **v3 → resolves a per-route V3 handler or 404**. `resolveV3Route(endpoint)`. Route map is additive — routes migrate in one at a time. |
| `utils/v3-handlers/public-config.js` | First edge-ready V3 read route. `export const runtime = 'edge'`. No Node-only imports in the hot path (no `googleapis`/`cloudinary`/`fs`). Returns the V1-shaped `{ googleClientId }`. |
| `api/v3/lms/[endpoint].js` | Thin V3 entrypoint — delegates to `dispatch`. Lets routes migrate without churning routing config. |
| `tests/v3-router.test.mjs` (4) | v1 delegates to legacy (asserts the v3 404 body is NOT produced); v3 `public-config` returns the V1 shape; v3 unknown endpoint → 404; `resolveV3Route` returns null for unmigrated routes. |

## Why edge for read-only

The learner read paths (`public-config`, `public-lesson`, and eventually `course-data`/`lesson` reads) are latency-sensitive and dependency-light. Running them on the Edge Runtime puts them close to the user and cuts cold-start vs. the Node monolith that imports `googleapis` top-level. Admin/Drive routes (upload, bodyParser, Drive SDK) stay on Node — those deps are edge-incompatible.

## Delegation / coexistence contract

`dispatch` reads the runtime mode once. In `v1`/`v2` it calls the **existing** `api/lms/portal.js` handler — so behavior is identical to today and the legacy router is not edited. Only in `v3` does the per-route V3 map engage. This means flipping `active_mode` to `v3` is what switches routing; flipping back to `v1` restores the legacy router with no redeploy of the legacy code.

## Routes: edge-ready now vs. deferred

| Route | Status |
|---|---|
| `public-config` | ✅ V3 edge-ready (shipped) |
| `public-lesson` | Next — edge-ready once its hot path is audited Node-dep-free |
| `course-data` / `lesson` | Deferred — currently import `googleapis` top-level; migrating needs a lazy-import refactor or a read-only projection that doesn't need the Drive SDK |
| `verify-entry-token` / `logout` | Deferred — write/session paths, stay Node (not read-only) |
| Admin/Drive | Stays Node runtime (edge-incompatible deps) |

Each future migration is the same pattern: add a `utils/v3-handlers/<route>.js`, register it in the route map, mark `runtime = 'edge'` only if the hot path is clean.

## Owner action pending

None — code-only phase. The v3 routes engage only when the owner flips `active_mode='v3'` (after the Phase 2/3/4 migrations are applied + canary). No production write this phase.

## Test bar met (Phase 5)

- `node --test tests/*.test.mjs` → 213/213, deterministic.
- Only new V3-only files; `api/lms/*` and `utils/lms-handlers/*` untouched → V1/V2 router unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched.
