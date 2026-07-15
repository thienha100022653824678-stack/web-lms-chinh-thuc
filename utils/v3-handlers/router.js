// utils/v3-handlers/router.js
// V3 Phase 5 (⑥) — per-route dispatcher with v1/v2 delegation.
//
// Replaces the V1/V2 `?endpoint=` monolith (api/lms/portal.js) on the v3 path:
// one function per route, each with its own cold start and dependency surface.
// Read-only routes can declare `runtime = 'edge'` (see public-config).
//
// Coexistence contract: when getEffectiveMode() !== 'v3', dispatch() delegates
// to the LEGACY portal router (api/lms/portal.js) unchanged. v1/v2 behavior is
// byte-for-byte identical. Only in v3 do we resolve a V3 handler.

import { getEffectiveMode } from "../runtime-controller.js";

// Lazy import so edge-bound code paths don't pull the legacy router (which
// transitively imports googleapis) at module load. The legacy router only runs
// in v1/v2 (Node runtime) — never on the edge v3 path.
async function legacyPortalHandler() {
  const mod = await import("../../api/lms/portal.js");
  return mod.default;
}

// V3 route map. Add routes here as they are migrated; each handler is a small,
// focused module under utils/v3-handlers/.
const V3_ROUTES = new Map();

async function registerRoutes() {
  if (V3_ROUTES.size) return;
  const publicConfig = (await import("./public-config.js")).default;
  V3_ROUTES.set("public-config", publicConfig);
  // course-data / lesson / verify-entry-token / logout migrate here next,
  // once their hot path is cleared of Node-only deps (googleapis). Until then
  // they fall through to the 404 / legacy path.
}

export function resolveV3Route(endpoint) {
  return V3_ROUTES.get(String(endpoint || "").trim()) || null;
}

// Dispatch a request. v1/v2 -> legacy router; v3 -> V3 handler or 404.
export async function dispatch(req, res) {
  const mode = await getEffectiveMode();
  if (mode !== "v3") {
    const legacy = await legacyPortalHandler();
    return legacy(req, res);
  }

  await registerRoutes();
  const endpoint = req.query?.endpoint;
  const handler = resolveV3Route(endpoint);
  if (!handler) {
    return res.status(404).json({ success: false, error: "V3 LMS endpoint not found" });
  }
  return handler(req, res);
}

export const _internals = { V3_ROUTES, registerRoutes };
