// utils/v3-db.js
// V3 Phase 2 (①) — tiered Supabase client factory.
//
// V1/V2 use one service-role client (utils/supabase.js) that bypasses RLS
// entirely (SEC-09). V3 shrinks that blast radius to three key tiers:
//   anon           -> public read only (RLS-enforced)
//   authenticated  -> a student, scoped by RLS to their own rows
//   service_role   -> admin/worker, server-only, never in a browser bundle
//
// This module is serverless-only (same as utils/supabase.js) — it is never
// imported into a browser bundle, so the service-role key never ships to a
// client. It operates ONLY in v3 mode: every entrypoint guards on
// getEffectiveMode()==='v3', so V3 wiring can never be reached while the
// platform is running V1/V2 (their behavior stays byte-for-byte identical).
//
// Fail-closed: a missing anon key makes anon/authenticated requests error —
// they never silently fall back to the service-role key.

import { getEffectiveMode } from './runtime-controller.js';
import { assertV2WorkerAuthorized } from './v2-sync-worker.js';

const ROLES = new Set(['anon', 'authenticated', 'service_role']);

// Test stub: when the suite sets LMS_RP2B1_SUPABASE_STUB=1, all tiers resolve to
// the same in-memory stub (tests assert tiering logic, not real key isolation).
const isTestStubEnabled = process.env.LMS_RP2B1_SUPABASE_STUB === '1';

async function loadTestStub() {
  const stubUrl = new URL('../tests/_supabase_stub_loader.mjs', import.meta.url).href;
  const mod = await import(stubUrl);
  return mod.supabase;
}

async function createRealClient(role) {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error('v3-db: SUPABASE_URL is not set');
  }
  let key;
  if (role === 'service_role') {
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('v3-db: SUPABASE_SERVICE_ROLE_KEY is not set');
  } else {
    // anon + authenticated both start from the anon key; the caller attaches
    // the student's JWT for authenticated requests via setSession/headers.
    key = process.env.SUPABASE_ANON_KEY;
    if (!key) {
      throw new Error(`v3-db: SUPABASE_ANON_KEY is not set — refusing ${role} (no service-role fallback)`);
    }
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function assertV3Mode() {
  const mode = await getEffectiveMode();
  if (mode !== 'v3') {
    throw new Error(`v3-db: tiered client requires v3 mode, but effective mode is ${mode}`);
  }
}

// Return a Supabase client for the given key tier. Throws unless mode===v3 and
// the role is known. Fail-closed on a missing key (never service-role fallback).
export async function getClientForRole(role) {
  if (!ROLES.has(role)) {
    throw new Error(`v3-db: unknown role "${role}"`);
  }
  await assertV3Mode();
  // Validate key presence even in stub mode so fail-closed behavior is testable.
  if (role === 'service_role') {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('v3-db: SUPABASE_SERVICE_ROLE_KEY is not set');
    }
  } else if (!process.env.SUPABASE_ANON_KEY) {
    throw new Error(`v3-db: SUPABASE_ANON_KEY is not set — refusing ${role} (no service-role fallback)`);
  }
  if (isTestStubEnabled) return loadTestStub();
  return createRealClient(role);
}

// Guard for write paths: only the service_role tier may perform authoritative
// writes. anon/authenticated writes must go through a SECURITY DEFINER RPC
// (see utils/v3-write-path.js), not a direct table mutation.
export function assertServerOnly(role) {
  if (role !== 'service_role') {
    throw new Error(`v3-db: server-only operation attempted with "${role}" tier`);
  }
}

// Map an incoming request to the least-privileged tier that satisfies it.
//   - a valid worker/admin secret -> service_role
//   - a verified V3 student session marker -> authenticated
//   - otherwise -> anon
export function resolveTierForRequest(req) {
  try {
    assertV2WorkerAuthorized(req);
    return 'service_role';
  } catch {
    // not a worker request — fall through
  }
  if (req && req.v3VerifiedSession && req.v3VerifiedSession.email) {
    return 'authenticated';
  }
  return 'anon';
}

export const _internals = { ROLES: new Set(ROLES) };
