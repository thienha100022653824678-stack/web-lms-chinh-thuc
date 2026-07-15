// api/v3/diagnostics.js
// V3 Phase 6 (⑪) — read-only diagnostics dashboard data endpoint.
//
// GET /api/v3/diagnostics -> current V3 operational metrics (outbox depth,
// delivery health, runtime posture). Service-role gated via the same worker
// secret door as the rest of api/v2/* (no new secret). Read-only — never writes.

import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { collectV3Metrics } from '../../utils/v3-metrics.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    assertV2WorkerAuthorized(req);
    const metrics = await collectV3Metrics();
    return res.status(200).json({ ok: metrics.ok, metrics });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'diagnostics failed',
    });
  }
}
