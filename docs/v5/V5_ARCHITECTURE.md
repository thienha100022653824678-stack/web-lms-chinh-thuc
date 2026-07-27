# LMS V5 Architecture

## Boundaries

- `apps/lms-v5`: isolated React/TypeScript/Vite student and admin entries.
- `api/v5/[...path].js`: versioned student API router.
- `api/v5/admin/[...path].js`: versioned admin API router.
- `utils/v5/*`: validation, cursors, auth adapters, repositories, fixtures, media, transitions, audit, and idempotency.
- `migrations/v5/*`: unapplied forward/rollback SQL.
- `scripts/v5/*`: fixture and lesson migration dry-run.

Existing B05 static pages, routers, session guard, enrollment tables, and course identity are dependencies, not rewrite targets.

## Request path

Student request → current server identity adapter → current protected-session policy → canonical session course check → active enrollment check → V5 server flag → repository → signed/private media serializer.

Admin mutation → existing admin cookie/allowlist → schema validation/sanitization → idempotency claim → transaction/RPC boundary → post/version/media/audit mutation.

## Runtime modes

- `V5_FIXTURE_MODE=1`: Preview/local fixture repository; no Supabase or provider mutation.
- Normal mode: service-side Supabase repository. The service-role remains server-only.
- `V5_GLOBAL_KILL_SWITCH=1`: V5 unavailable/fallback.

Realtime is enhancement-only. REST pagination, focus refetch, reconnect refetch, and light polling preserve functionality.

