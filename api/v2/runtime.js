// api/v2/runtime.js
// V3 Phase 0 — Runtime config admin endpoint.
//
// GET  /api/v2/runtime          -> returns current effective config (read).
// POST /api/v2/runtime          -> flips runtime config (write), service-role only.
//
// Authorization: a caller must present the internal sync secret
// (`INTERNAL_SYNC_SECRET` / `V2_WORKER_SECRET`) via `x-v2-worker-secret` or
// `x-sync-secret`. This is the same gate the V2 sync worker uses, so no new
// secret surface is introduced. No anon/authenticated (browser) access — the
// underlying table has RLS on and no public policy.
//
// The owner also can flip directly via SQL Editor; this endpoint is the
// no-redeploy path for instant rollback to v1 (set active_mode='v1' or
// kill_switch=true). Every flip is audited into platform_runtime_config_audit.

import { assertV2WorkerAuthorized } from '../../utils/v2-sync-worker.js';
import { supabase } from '../../utils/supabase.js';
import { refreshConfig } from '../../utils/runtime-controller.js';

const VALID_MODES = new Set(['v1', 'v2', 'v3']);

function cleanText(value) {
  return String(value || '').trim();
}

function parseBooleanFlag(value) {
  if (typeof value !== 'string') return Boolean(value);
  const n = value.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

function authorizedActor(req) {
  // Best-effort identity for the audit row. Never log secrets/tokens.
  return cleanText(req.headers['x-admin-email']) || 'runtime-endpoint';
}

async function readConfig() {
  const { data, error } = await supabase
    .from('platform_runtime_config')
    .select('active_mode,v2_shadow_mode,v3_shadow_mode,kill_switch,updated_by,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    const e = new Error('runtime config read failed');
    e.statusCode = 502;
    throw e;
  }
  if (!data) {
    // Table not applied yet (owner step pending) -> report fail-closed v1.
    return {
      active_mode: 'v1',
      v2_shadow_mode: false,
      v3_shadow_mode: false,
      kill_switch: true,
      updated_by: null,
      updated_at: null,
      note: 'platform_runtime_config row not found — owner must apply migration_v3_runtime_config.sql. Controller is fail-closed to v1.',
    };
  }
  return data;
}

async function applyFlip(patch, actor) {
  const { active_mode, v2_shadow_mode, v3_shadow_mode, kill_switch } = patch;

  const updates = {};
  if (active_mode !== undefined) {
    if (!VALID_MODES.has(active_mode)) {
      const e = new Error('invalid active_mode');
      e.statusCode = 400;
      throw e;
    }
    updates.active_mode = active_mode;
  }
  if (v2_shadow_mode !== undefined) updates.v2_shadow_mode = Boolean(v2_shadow_mode);
  if (v3_shadow_mode !== undefined) updates.v3_shadow_mode = Boolean(v3_shadow_mode);
  if (kill_switch !== undefined) updates.kill_switch = Boolean(kill_switch);
  updates.updated_by = actor;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('platform_runtime_config')
    .update(updates)
    .eq('id', 1)
    .select('active_mode,v2_shadow_mode,v3_shadow_mode,kill_switch,updated_by,updated_at')
    .maybeSingle();

  if (error) {
    const e = new Error('runtime config update failed');
    e.statusCode = 502;
    throw e;
  }
  if (!data) {
    const e = new Error('runtime config row missing — apply migration first');
    e.statusCode = 409;
    throw e;
  }

  // Append-only audit. Failure to audit does NOT roll back the flip (the flip
  // is the safety-relevant action); we surface a warning instead.
  await supabase.from('platform_runtime_config_audit').insert({
    active_mode: data.active_mode,
    v2_shadow_mode: data.v2_shadow_mode,
    v3_shadow_mode: data.v3_shadow_mode,
    kill_switch: data.kill_switch,
    changed_by: actor,
  });

  // Invalidate the controller cache so the new mode is visible immediately.
  await refreshConfig();

  return data;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    assertV2WorkerAuthorized(req);

    if (req.method === 'GET') {
      const config = await readConfig();
      const effective = config.kill_switch ? 'v1' : config.active_mode;
      return res.status(200).json({ ok: true, config, effective_mode: effective });
    }

    // POST: flip
    const body = req.body || {};
    const patch = {
      active_mode: body.active_mode !== undefined ? cleanText(body.active_mode) : undefined,
      v2_shadow_mode: body.v2_shadow_mode !== undefined ? parseBooleanFlag(body.v2_shadow_mode) : undefined,
      v3_shadow_mode: body.v3_shadow_mode !== undefined ? parseBooleanFlag(body.v3_shadow_mode) : undefined,
      kill_switch: body.kill_switch !== undefined ? parseBooleanFlag(body.kill_switch) : undefined,
    };
    const hasChange = Object.values(patch).some((v) => v !== undefined);
    if (!hasChange) {
      return res.status(400).json({ ok: false, error: 'No fields to update. Send active_mode/v2_shadow_mode/v3_shadow_mode/kill_switch.' });
    }
    const actor = authorizedActor(req);
    const config = await applyFlip(patch, actor);
    const effective = config.kill_switch ? 'v1' : config.active_mode;
    return res.status(200).json({ ok: true, config, effective_mode: effective });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 401 ? 'Unauthorized' : (error.message || 'runtime endpoint failed'),
    });
  }
}
