import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { runV2Diagnostics } from '../../utils/v2-diagnostics.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    assertV2WorkerAuthorized(req);

    const result = await runV2Diagnostics();
    const status = result.ok ? 200 : 409;
    return res.status(status).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'V2 diagnostics failed',
      message: status === 401 ? 'Worker secret is invalid or missing.' : String(error.message || error),
    });
  }
}
