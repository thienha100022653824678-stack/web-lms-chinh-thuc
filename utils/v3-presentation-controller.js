// utils/v3-presentation-controller.js
// V3 is a presentation layer on top of the existing V2 platform runtime.
// IMPORTANT: do not add V3 to v2-runtime-controller ACTIVE_MODES. Existing
// V2 hot paths use isV2ActiveCached(); V3 must keep the platform in V2.

import { supabase } from "./supabase.js";
import {
  ACTIVE_MODES,
  getRuntimeSnapshot,
  setActiveMode,
  setKillSwitch as setGlobalKillSwitch,
  refreshRuntimeConfig
} from "./v2-runtime-controller.js";

const CONFIG_KEY_V3_ENABLED = "v3_presentation_enabled";
const CONFIG_KEY_V3_KILL = "v3_kill_switch";
const CONFIG_KEY_V2_MODE = "v2_active_mode";
const CACHE_TTL_MS = 5_000;

let cachedV3 = null;
let cachedAt = 0;
let inflight = null;

function parseBool(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "val")) return parseBool(value.val);
    if (Object.prototype.hasOwnProperty.call(value, "value")) return parseBool(value.value);
  }
  const s = String(value).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on" || s === "v3";
}

function parseMode(value) {
  let raw = value;
  if (raw && typeof raw === "object") {
    raw = raw.val ?? raw.value ?? "";
  }
  const s = String(raw || "").trim().toLowerCase();
  if (s === "1" || s === "v1") return ACTIVE_MODES.V1;
  if (s === "2" || s === "v2") return ACTIVE_MODES.V2;
  return null;
}

function clearV3Cache() {
  cachedV3 = null;
  cachedAt = 0;
}

async function loadV3Config({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedV3 && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { ...cachedV3 };
  }
  if (!forceRefresh && inflight) return { ...(await inflight) };

  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("site_config")
        .select("key, value")
        .in("key", [CONFIG_KEY_V3_ENABLED, CONFIG_KEY_V3_KILL, CONFIG_KEY_V2_MODE]);
      if (error) {
        return {
          enabled: false,
          killSwitch: true,
          configuredV2Mode: ACTIVE_MODES.V1,
          ok: false,
          source: "db_error"
        };
      }

      let enabled = false;
      let killSwitch = false;
      let configuredV2Mode = null;
      for (const row of data || []) {
        if (row.key === CONFIG_KEY_V3_ENABLED) enabled = parseBool(row.value);
        if (row.key === CONFIG_KEY_V3_KILL) killSwitch = parseBool(row.value);
        if (row.key === CONFIG_KEY_V2_MODE) configuredV2Mode = parseMode(row.value);
      }

      return {
        enabled,
        killSwitch,
        configuredV2Mode: configuredV2Mode || ACTIVE_MODES.V1,
        ok: true,
        source: "db"
      };
    } catch {
      return {
        enabled: false,
        killSwitch: true,
        configuredV2Mode: ACTIVE_MODES.V1,
        ok: false,
        source: "db_exception"
      };
    }
  })();

  try {
    const result = await inflight;
    cachedV3 = { ...result };
    cachedAt = Date.now();
    return { ...result };
  } finally {
    inflight = null;
  }
}

export async function getV3PresentationSnapshot({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    clearV3Cache();
    await refreshRuntimeConfig();
  }

  const [v2, v3] = await Promise.all([
    getRuntimeSnapshot(),
    loadV3Config({ forceRefresh })
  ]);

  // Configured mode is what the owner selected, independent of emergency
  // switches. V3 may only be considered configured when the base selection
  // is V2, because V3 runs on top of V2.
  const configuredMode =
    v3.enabled && v3.configuredV2Mode === ACTIVE_MODES.V2
      ? "v3"
      : v3.configuredV2Mode;

  // Existing V2 controller remains authoritative for global V1/V2 safety.
  // Its kill switch/env override can force activeMode V1. V3 never bypasses it.
  let effectiveMode = "v1";
  if (v2.activeMode === ACTIVE_MODES.V2 && !v2.killSwitch) {
    effectiveMode = v3.enabled && !v3.killSwitch && v3.ok ? "v3" : "v2";
  }

  return {
    configuredMode,
    effectiveMode,
    v2ActiveMode: v2.activeMode,
    globalKillSwitch: Boolean(v2.killSwitch),
    v3Enabled: Boolean(v3.enabled),
    v3KillSwitch: Boolean(v3.killSwitch),
    ok: Boolean(v2.ok) && Boolean(v3.ok),
    source: `${v2.source || "v2"}+${v3.source || "v3"}`
  };
}

async function upsertV3Key(key, value) {
  try {
    const { error } = await supabase
      .from("site_config")
      .upsert({ key, value }, { onConflict: "key" });
    if (error) return { ok: false, code: "db_error" };
    clearV3Cache();
    return { ok: true };
  } catch {
    return { ok: false, code: "db_exception" };
  }
}

export async function setV3PresentationEnabled(enabled) {
  const value = Boolean(enabled);
  const result = await upsertV3Key(CONFIG_KEY_V3_ENABLED, value);
  if (!result.ok) return result;
  return { ok: true, enabled: value };
}

export async function setV3KillSwitch(enabled) {
  const value = Boolean(enabled);
  const result = await upsertV3Key(CONFIG_KEY_V3_KILL, value);
  if (!result.ok) return result;
  return { ok: true, killSwitch: value };
}

export async function setUnifiedMode(mode) {
  const target = String(mode || "").trim().toLowerCase();
  if (!new Set(["v1", "v2", "v3"]).has(target)) {
    return { ok: false, code: "invalid_mode" };
  }

  if (target === "v3") {
    // Safe order: establish V2 first. If V3 enable fails, system remains V2.
    const base = await setActiveMode(ACTIVE_MODES.V2);
    if (!base.ok) return base;
    const enable = await setV3PresentationEnabled(true);
    if (!enable.ok) return enable;
    return { ok: true, mode: "v3" };
  }

  // Safe order when leaving V3: remove V3 presentation first, then flip base.
  const disable = await setV3PresentationEnabled(false);
  if (!disable.ok) return disable;
  const base = await setActiveMode(target);
  if (!base.ok) return base;
  return { ok: true, mode: target };
}

export async function setUnifiedGlobalKillSwitch(enabled) {
  return setGlobalKillSwitch(Boolean(enabled));
}

export async function refreshV3PresentationConfig() {
  clearV3Cache();
  await refreshRuntimeConfig();
  return getV3PresentationSnapshot({ forceRefresh: true });
}

export const _internals = {
  CONFIG_KEY_V3_ENABLED,
  CONFIG_KEY_V3_KILL,
  CONFIG_KEY_V2_MODE,
  parseBool,
  parseMode,
  loadV3Config,
  clearV3Cache
};
