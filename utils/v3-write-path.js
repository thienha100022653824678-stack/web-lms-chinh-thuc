// utils/v3-write-path.js
// V3 Phase 2 (①) — the single sanctioned V3 write entrypoint.
//
// In V3, direct table mutations from anon/authenticated are forbidden by RLS
// (see migration_v3_rls_policies.sql — no INSERT/DELETE policies for them).
// Every multi-step / authoritative write goes through a SECURITY DEFINER RPC
// executed with the service_role tier (proven pattern:
// handle_student_session_login / reset_student_session_guard). This module is
// that funnel. It:
//   - refuses unless getEffectiveMode()==='v3' (V1/V2 use their own paths),
//   - runs the RPC through the service_role client (utils/v3-db.js),
//   - stamps runtime_version onto the params so every write is traceable
//     (compatibility contract: V1/V2 ignore the extra field).
//
// It NEVER performs a direct .insert()/.update()/.delete(). If a caller needs a
// write, it names an RPC.

import { getEffectiveMode, stampEvent } from './runtime-controller.js';
import { getClientForRole, assertServerOnly } from './v3-db.js';

const SCHEMA_VERSION = '2026-07-15';

// Execute a SECURITY DEFINER RPC as the sole V3 write path.
//   name   - the Postgres function name (must be a SECURITY DEFINER RPC).
//   params - object of RPC params; a runtime_version stamp is added.
// Returns { data, error }. Throws if not in v3 mode or name is invalid.
export async function writeViaRpc(name, params = {}) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('v3-write-path: RPC name is required');
  }
  const mode = await getEffectiveMode();
  if (mode !== 'v3') {
    throw new Error(`v3-write-path: writes require v3 mode, effective mode is ${mode}`);
  }

  // Server-only: authoritative writes never run on anon/authenticated tiers.
  const role = 'service_role';
  assertServerOnly(role);
  const client = await getClientForRole(role);

  // Stamp runtime_version (+ schema_version) so the write is traceable and
  // V1/V2 consumers can skip rows not stamped for them.
  const stamped = stampEvent({ ...params }, 'v3', SCHEMA_VERSION);

  return client.rpc(name, stamped);
}

// Compatibility-contract helper: project a V3-written row down to the columns
// the V1 code path knows, so a caller/test can assert V1 sees a valid V1-shaped
// view. Additive V3 fields (runtime_version, schema_version, and any new
// columns) are dropped — never overloaded onto a V1 column.
export function toV1View(row, v1Columns) {
  const view = {};
  for (const col of v1Columns) {
    if (col in row) view[col] = row[col];
  }
  return view;
}

export const _internals = { SCHEMA_VERSION };
