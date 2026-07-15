# V3 Phase 5 (⑥) — Router Split + Edge Runtime for Read-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split the V1/V2 monolith `?endpoint=` router (`api/lms/portal.js`, `api/lms/admin.js`) into per-route V3 functions so each route has its own cold start and dependency surface, and run the genuinely read-only learner paths (`public-config`, `public-lesson`, and a v3 `course-data`/`lesson` read surface) on the Vercel Edge Runtime for low latency. V1/V2 keep the legacy router byte-for-byte.

**Architecture:** New `api/v3/lms/[endpoint].js` thin dispatcher + `utils/v3-handlers/*.js` per-route handlers. The dispatcher branches on `getEffectiveMode()`: in `v1`/`v2` it delegates to the **existing** legacy router (so behavior is identical); in `v3` it runs the V3 handler for the route. Read-only V3 handlers carry `export const runtime = 'edge'`-compatible code (no Node-only deps in their hot path). Admin (Drive upload, bodyParser) stays on Node runtime. The legacy `api/lms/portal.js` is untouched.

**Tech Stack:** Node 24 (`node:test`, ESM), Vercel Functions (per-route), Edge Runtime for read-only routes, Phase 0 controller.

## Global Constraints

- Additive-only. New files only; `api/lms/*`, `utils/lms-handlers/*` untouched → V1/V2 router identical.
- V3 dispatcher delegates to the legacy router when mode≠v3 (no behavior drift in v1/v2).
- Edge-runtime handlers must not import Node-only modules (`googleapis`, `cloudinary`, `fs`) in their hot path; lazy-import any Node-only helper behind a v3 admin path that stays on Node.
- Coexistence: the V3 read path returns the same public shape V1 does (contract).
- No production write; no secret in commits; don't touch main, tag, Portal repo.
- Phase bar: `node --test` green + secret scan + V1 path unchanged + commit + push.
- New committed file with `V2_GLOBAL_ONE_DEVICE_ENABLED` → add to allow-list in `tests/rp2b1-session-device.test.mjs` if needed. (Phase 5 files avoid it — they delegate to legacy.)

---

### Task 1: V3 per-route dispatcher + read-only handlers

**Files:**
- Create: `api/v3/lms/[endpoint].js`
- Create: `utils/v3-handlers/public-config.js`
- Create: `utils/v3-handlers/router.js` (the v3 route map + v1/v2 delegate)
- Test: `tests/v3-router.test.mjs`

**Interfaces:**
- Produces:
  - `utils/v3-handlers/router.js` exports `resolveV3Route(endpoint) -> handler | null` and `dispatch(req, res)` which: reads `getEffectiveMode()`; if not `v3`, delegates to the legacy `api/lms/portal.js` handler (imported); if `v3`, resolves the endpoint to a V3 handler or 404.
  - `utils/v3-handlers/public-config.js` — edge-safe read-only handler (returns `googleClientId`; same shape as V1 `public-config`).
- Consumes: `getEffectiveMode` (`utils/runtime-controller.js`); `applyCors` (`utils/cors.js`); the legacy portal router for delegation.

- [ ] **Step 1:** Write `tests/v3-router.test.mjs` (stub Supabase + a fake res/req): in v1 mode `dispatch` delegates to the legacy router (assert the legacy handler is called for a known endpoint); in v3 mode it calls the V3 `public-config` handler and returns the V1-shaped body; unknown endpoint in v3 → 404.
- [ ] **Step 2:** Run → FAIL (module absent).
- [ ] **Step 3:** Implement `utils/v3-handlers/router.js`, `utils/v3-handlers/public-config.js`, `api/v3/lms/[endpoint].js`.
- [ ] **Step 4:** Run → PASS. Full suite → pass.
- [ ] **Step 5:** Commit.

### Task 2: docs + push

**Files:**
- Create: `docs/V3_PHASE_5_ROUTER_EDGE.md`
- Modify: `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` (status line)

- [ ] **Step 1:** Write `docs/V3_PHASE_5_ROUTER_EDGE.md`: the split, why edge for read-only (latency/cold-start), the delegation contract (v1/v2 → legacy router unchanged), and the note that admin/Drive routes stay on Node runtime (edge-incompatible deps). Mark which routes are edge-ready now vs deferred.
- [ ] **Step 2:** Update transfer-doc status line → Phase 5 done (repo). Secret scan, reset stub, commit + push. Verify V1 tag unchanged.

---

## Self-Review

- **Spec coverage:** ⑥ per-route split (dispatcher + route map) + edge for read-only (`public-config` shipped edge-ready; `public-lesson`/read `course-data`/`lesson` noted as next to migrate once their hot path is Node-dep-free). Admin stays Node. v1/v2 delegate to legacy → unchanged.
- **Placeholder scan:** none.
- **Type consistency:** `resolveV3Route`/`dispatch` used consistently; delegation reuses the legacy portal router export.
- **Scope honesty:** migrating the full `course-data`/`lesson` hot path to edge (they currently import `googleapis`) is a larger refactor; this phase ships the dispatcher + one edge-ready route and documents the rest as follow-up under the same pattern. That is additive and testable now.
