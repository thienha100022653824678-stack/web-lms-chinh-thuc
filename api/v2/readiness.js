import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { runV2Readiness } from '../../utils/v2-readiness.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    assertV2WorkerAuthorized(req);

    const result = await runV2Readiness();
    const status = result.ok ? 200 : 409;
    return res.status(status).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'V2 readiness check failed',
      message: status === 401 ? 'Worker secret is invalid or missing.' : String(error.message || error),
    });
  }
}
