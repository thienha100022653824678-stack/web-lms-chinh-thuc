# V3 Phase 7 (⑨) — FE Modular + Diagnostics Dashboard

> **Status:** Repo-side DONE 2026-07-15 (Opus 4.8). Tests green (`v3-dashboard` 6; full suite 229/229). Code-only — no owner production step.
>
> **Goal:** deliver the diagnostics dashboard UI (the concrete, high-value slice of ⑨) that renders the Phase 6 metrics, and establish the modular-FE pattern (self-contained ES module, no build step, no remote script deps) for future admin split.

## What this phase added

| File | Role |
|---|---|
| `v3-diagnostics.html` | Read-only admin dashboard. Consumes `GET /api/v3/diagnostics`; the worker secret is entered by the admin and sent **only** as the `x-v2-worker-secret` header — never persisted to storage, never in the URL. Renders runtime posture (mode/kill-switch/RLS/shadows), outbox depth + success rate, delivery health. Self-contained `<script type="module">`, no CDN/remote code. |
| `tests/v3-dashboard.test.mjs` (6) | Static assertions: correct endpoint + GET, secret-as-header-not-query, no storage persistence, no embedded secrets, self-contained module (no remote script src), handles the dead-letter `-1` sentinel. |

## Scope honesty (⑨ is large; this is the useful slice)

The full ⑨ proposal is "modularize `lms-admin.html` (260KB/5261 lines) / `lms.html` / `admin.html` into ES modules or a Next/Vite SPA + a diagnostics dashboard." Rewriting three large hand-rolled admin pages is a multi-week refactor with high regression risk on live admin flows — not something to do speculatively before the owner flips to v3. This phase ships the **dashboard** (net-new, zero regression risk, immediately useful for watching a canary) and sets the modular pattern (self-contained ES module, no build step — matching how the repo already ships static HTML). The big admin-page rewrite is documented as follow-up, to be done page-by-page behind the same v3 gating once the owner commits to the v3 cutover.

## Security notes

- The dashboard is an admin tool: it holds no secret at rest, pulls no remote script (an admin page loading CDN code is a supply-chain surface), and shows only already-masked/hashed data (Phase 6 guarantees no raw PII leaves the server).
- The endpoint stays service-role gated; the page is just a client for it.

## Owner action pending

None — code-only. The dashboard is useful the moment the owner has the worker secret; it reflects live metrics once the Phase 3 outbox migration is applied (before that, dead-letters shows "table absent").

## Follow-up (documented, not done)

- Split `lms-admin.html` into ES modules page-section by page-section (courses, lessons, students, enrollments, drive) behind v3 gating.
- Optionally migrate admin to a Vite SPA or a Next app (Portal is already Next) — larger, deferred.

## Test bar met (Phase 7)

- `node --test tests/*.test.mjs` → 229/229.
- Net-new file only; no existing HTML/handler edited → V1/V2 unchanged.
- No secret committed. `main` + `v1-stable-20260713` untouched. No production write.
