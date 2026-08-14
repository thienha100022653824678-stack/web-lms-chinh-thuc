import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";
import { applyCors } from "../cors.js";
import { writeAdminAuditLog } from "../lms-session-guard.js";
import { V2_FLAGS, isV2FlagConfigured, isV2FlagEnabled } from "../v2-flags.js";
import {
  getV3PresentationSnapshot,
  setUnifiedMode,
  setV3KillSwitch,
  setUnifiedGlobalKillSwitch,
  refreshV3PresentationConfig
} from "../v3-presentation-controller.js";

function getClientIp(req) {
  return String(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    ""
  ).split(",")[0].trim();
}

function parseBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function safeError(res, status, code) {
  return res.status(status).json({ success: false, error: code, code });
}

function buildFlagPosture() {
  return Object.fromEntries(
    Object.entries(V2_FLAGS).map(([key, envName]) => [
      key,
      {
        envName,
        configured: isV2FlagConfigured(envName),
        enabled: isV2FlagEnabled(envName)
      }
    ])
  );
}

async function buildResponse({ forceRefresh = false } = {}) {
  const state = forceRefresh
    ? await refreshV3PresentationConfig()
    : await getV3PresentationSnapshot();
  return {
    success: true,
    ...state,
    // Existing V2 feature posture remains visible in the same System tab.
    flags: buildFlagPosture()
  };
}

async function audit(req, adminSession, action, metadata) {
  try {
    await writeAdminAuditLog(supabase, {
      adminEmail: normalizeEmail(adminSession.email),
      action,
      metadata,
      ip: getClientIp(req),
      userAgent: req.headers?.["user-agent"] || ""
    });
  } catch (err) {
    console.error("[admin-v3-runtime-mode] audit failed:", err?.message);
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) return safeError(res, 401, "admin_auth_required");

    if (req.method === "GET") {
      return res.status(200).json(await buildResponse({ forceRefresh: true }));
    }

    if (req.method !== "POST") {
      return safeError(res, 405, "method_not_allowed");
    }

    const body = req.body || {};
    const action = String(body.action || "").trim();

    if (action === "set_mode") {
      const mode = String(body.mode || "").trim().toLowerCase();
      const result = await setUnifiedMode(mode);
      if (!result.ok) {
        return safeError(res, result.code === "invalid_mode" ? 400 : 503, result.code || "runtime_update_failed");
      }
      await audit(req, adminSession, "v3_runtime_mode_set", { mode });
      return res.status(200).json(await buildResponse({ forceRefresh: true }));
    }

    if (action === "set_v3_kill_switch") {
      const enabled = parseBool(body.killSwitch);
      const result = await setV3KillSwitch(enabled);
      if (!result.ok) return safeError(res, 503, result.code || "runtime_update_failed");
      await audit(req, adminSession, "v3_runtime_kill_switch_set", { killSwitch: enabled });
      return res.status(200).json(await buildResponse({ forceRefresh: true }));
    }

    if (action === "set_global_kill_switch") {
      const enabled = parseBool(body.killSwitch);
      const result = await setUnifiedGlobalKillSwitch(enabled);
      if (!result.ok) return safeError(res, 503, result.code || "runtime_update_failed");
      await audit(req, adminSession, "v3_runtime_global_kill_switch_set", { killSwitch: enabled });
      return res.status(200).json(await buildResponse({ forceRefresh: true }));
    }

    return safeError(res, 400, "invalid_action");
  } catch (err) {
    console.error("[admin-v3-runtime-mode] error:", err?.message);
    return safeError(res, 503, "runtime_mode_unavailable");
  }
}

export const _internals = { parseBool, buildFlagPosture, buildResponse };
