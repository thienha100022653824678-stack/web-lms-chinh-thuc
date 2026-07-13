import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { previewPortalProjectionForOutbox } from '../../utils/v2-portal-projection-preview.js';

function pickInput(req) {
  return req.method === 'POST' ? (req.body || {}) : (req.query || {});
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    assertV2WorkerAuthorized(req);

    const input = pickInput(req);
    const result = await previewPortalProjectionForOutbox({
      outboxId: input.outboxId || input.outbox_id || input.id,
    });

    const status = result.ok ? 200 : 409;
    return res.status(status).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'V2 Portal projection preview failed',
      message: status === 401 ? 'Worker secret is invalid or missing.' : String(error.message || error),
    });
  }
}
