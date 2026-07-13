import {
  assertV2WorkerAuthorized,
  parseV2Boolean,
  runV2SyncWorker,
} from '../../utils/v2-sync-worker.js';

function parseLimit(value) {
  const parsed = Number.parseInt(String(value || '10'), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 50);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    assertV2WorkerAuthorized(req);

    const body = req.body || {};
    const limit = parseLimit(body.limit);
    const dryRun = parseV2Boolean(body.dryRun, undefined);

    const result = await runV2SyncWorker({ limit, dryRun });
    const status = result.ok ? 200 : 409;
    return res.status(status).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'V2 sync worker failed',
      message: status === 401 ? 'Worker secret is invalid or missing.' : String(error.message || error),
    });
  }
}
