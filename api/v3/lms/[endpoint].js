// api/v3/lms/[endpoint].js
// V3 Phase 5 (⑥) — per-route V3 entrypoint.
//
// Thin: delegates to utils/v3-handlers/router.js, which branches on
// getEffectiveMode(). In v1/v2 it calls the legacy api/lms/portal.js router
// (behavior identical). In v3 it runs the per-route V3 handler.
//
// Keeping this entrypoint minimal means each V3 route gets its own cold start
// surface once split into separate files (api/v3/lms/course-data.js etc.); for
// now the [endpoint] catch-all dispatches so we can migrate routes one at a
// time without churning vercel.json.

import { dispatch } from "../../../utils/v3-handlers/router.js";

export default async function handler(req, res) {
  return dispatch(req, res);
}
