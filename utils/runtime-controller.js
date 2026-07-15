// utils/runtime-controller.js
// V3 Phase 0 — Runtime controller spine.
//
// Reads the singleton row `platform_runtime_config` from Supabase B and exposes
// the single source of truth for which platform version is authoritative.
// Fails CLOSED to v1 on any read error / missing row / kill switch — so the
// immutable V1 rollback target is the default and the escape hatch.
//
// Contract (see docs/superpowers/specs/2026-07-15-v3-master-plan-design.md):
//   - Exactly one version performs authoritative writes at a time.
//   - Shadow modes (v2/v3) are read-only observe-and-log unless their version is active.
//   - kill_switch=true forces v1 regardless of active_mode (instant rollback, no redeploy).
//   - Every event/log/delivery is stamped with runtime_version via stampEvent().
//
// This module NEVER performs writes. Flipping the config is done via the admin
// endpoint (api/v2/runtime.js, service-role guarded) or SQL Editor by the owner.

const CACHE_TTL_MS = 3000; // ~3s: flip propagates in a few seconds without redeploy.

const VALID_MODES = new Set(['v1', 'v2', 'v3']);

// Effective config used when the DB row is absent or unreadable. Never raises.
const FAIL_CLOSED_CONFIG = Object.freeze({
  active_mode: 'v1',
  v2_shadow_mode: false,
  v3_shadow_mode: false,
  kill_switch: true, // fail-closed => treat as kill switch on => force v1.
  updated_at: null,
});

let cachedConfig = null;
let cachedAt = 0;
let pendingRefresh = null;

function getSupabase() {
  // Lazy import so test stubs (LMS_RP2B1_SUPABASE_STUB) and module-load order
  // don't force a real client at import time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return import('./supabase.js').then((m) => m.supabase);
}

function isCacheFresh(now) {
  return cachedConfig && now - cachedAt < CACHE_TTL_MS;
}

async function readConfigFromDb() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('platform_runtime_config')
    .select('active_mode,v2_shadow_mode,v3_shadow_mode,kill_switch,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return null;
  const active_mode = VALID_MODES.has(data.active_mode) ? data.active_mode : 'v1';
  return {
    active_mode,
    v2_shadow_mode: Boolean(data.v2_shadow_mode),
    v3_shadow_mode: Boolean(data.v3_shadow_mode),
    kill_switch: Boolean(data.kill_switch),
    updated_at: data.updated_at ?? null,
  };
}

// Internal: refresh from DB. Dedupes concurrent refreshes. On any failure,
// leaves the cache as-is (stale v1 config is safer than throwing).
export async function refreshConfig() {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    try {
      const cfg = await readConfigFromDb();
      if (cfg) {
        cachedConfig = cfg;
        cachedAt = Date.now();
      }
      // If cfg is null we keep the previous cache; caller sees fail-closed via getConfig.
    } catch {
      // Swallow: never raise from the controller. Callers must not crash on config read.
    } finally {
      pendingRefresh = null;
    }
  })();
  return pendingRefresh;
}

// Returns the raw resolved config (fail-closed to v1 if DB unreadable).
// Refreshes first if the cache is stale. Safe to await in hot paths; the
// stale value is returned immediately and a refresh is scheduled.
export async function getConfig() {
  const now = Date.now();
  if (isCacheFresh(now)) return cachedConfig;
  if (cachedConfig) {
    // Return stale immediately, refresh in background (non-blocking).
    refreshConfig();
    return cachedConfig;
  }
  // First read: must await so callers don't run before any config is known.
  await refreshConfig();
  return cachedConfig || FAIL_CLOSED_CONFIG;
}

// The single gate. Every write path branches on this.
// kill_switch OR invalid active_mode => 'v1'.
export async function getEffectiveMode() {
  const cfg = await getConfig();
  if (cfg.kill_switch) return 'v1';
  return cfg.active_mode;
}

export function isShadowEnabled(version) {
  // Synchronous best-effort from cache; callers should prefer the async form
  // via getConfig() when accuracy matters. Returns false if cache is empty.
  if (version === 'v2') return Boolean(cachedConfig && cachedConfig.v2_shadow_mode);
  if (version === 'v3') return Boolean(cachedConfig && cachedConfig.v3_shadow_mode);
  return false;
}

export async function isShadowEnabledAsync(version) {
  const cfg = await getConfig();
  if (version === 'v2') return cfg.v2_shadow_mode;
  if (version === 'v3') return cfg.v3_shadow_mode;
  return false;
}

export function isKillSwitchOn() {
  return Boolean(cachedConfig && cachedConfig.kill_switch);
}

// Stamp every event/log/delivery with its runtime version. Pure, never throws.
// `event` may be an object or array; a shallow copy is returned with the stamp.
export function stampEvent(event, runtimeVersion, schemaVersion) {
  const rv = VALID_MODES.has(runtimeVersion) ? runtimeVersion : 'v1';
  const schema = schemaVersion === undefined ? null : schemaVersion;
  if (event === null || typeof event !== 'object') {
    return { value: event, runtime_version: rv, schema_version: schema };
  }
  if (Array.isArray(event)) {
    return event.map((row) => stampEvent(row, rv, schema));
  }
  return {
    ...event,
    runtime_version: event.runtime_version || rv,
    schema_version: event.schema_version || schema,
  };
}

// Test hooks: inject a config directly (bypasses DB) and clear the cache.
// Used only by node:test; production never calls these.
export const _test = {
  setConfig(cfg) {
    cachedConfig = cfg ? { ...cfg } : null;
    cachedAt = cfg ? Date.now() : 0;
  },
  reset() {
    cachedConfig = null;
    cachedAt = 0;
    pendingRefresh = null;
  },
  getCache() {
    return cachedConfig ? { ...cachedConfig } : null;
  },
  CACHE_TTL_MS,
  FAIL_CLOSED_CONFIG,
  VALID_MODES: new Set(VALID_MODES),
};

export const _internals = { readConfigFromDb, refreshConfig };
