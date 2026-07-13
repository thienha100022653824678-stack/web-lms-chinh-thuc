import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { runV2ReadOnlyReconciliation } from '../../utils/v2-reconciliation.js';

function parseSampleLimit(value) {
  const parsed = Number.parseInt(String(value || '20'), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    assertV2WorkerAuthorized(req);

    const input = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const sampleLimit = parseSampleLimit(input.sampleLimit || input.limit);
    const result = await runV2ReadOnlyReconciliation({ sampleLimit });
    const status = result.ok ? 200 : 409;

    return res.status(status).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'V2 reconciliation failed',
      message: status === 401 ? 'Worker secret is invalid or missing.' : String(error.message || error),
    });
  }
}
