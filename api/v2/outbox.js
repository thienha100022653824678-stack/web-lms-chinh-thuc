import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { inspectV2Outbox } from '../../utils/v2-outbox-inspector.js';

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
    const result = await inspectV2Outbox({
      resource: input.resource || input.view,
      limit: input.limit,
      status: input.status,
      cursor: input.cursor,
      sourceSystem: input.sourceSystem || input.source_system,
      aggregateType: input.aggregateType || input.aggregate_type,
      eventType: input.eventType || input.event_type,
      targetSystem: input.targetSystem || input.target_system || input.target,
      outboxId: input.outboxId || input.outbox_id,
    });

    const status = result.ok ? 200 : 409;
    return res.status(status).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : 'V2 outbox inspection failed',
      message: status === 401 ? 'Worker secret is invalid or missing.' : String(error.message || error),
    });
  }
}
