// utils/lms-handlers/admin-runtime-mode.js
//
// Admin endpoint that exposes + flips the V1/V2 runtime master switch.
// Mounted at `api/lms/admin.js?endpoint=runtime-mode`.
//
//   GET  → { success, activeMode, killSwitch, source, effective, flags }
//          Reports the resolved mode, the resolution source, and the
//          per-feature flag posture (configured vs effective) so the admin
//          UI can render the switch + status. No secrets, no PII.
//
//   POST → body { action: "set_mode" | "set_kill_switch", mode?, killSwitch? }
//          - set_mode: validates mode ∈ {v1, v2}; upserts site_config
//            v2_active_mode; writes admin_audit_logs; refreshes the
//            in-process cache so the flip is immediate on this instance.
//          - set_kill_switch: validates a boolean; upserts v2_kill_switch.
//          Returns the new snapshot. Fail-closed on DB error.
//
// Auth: admin-only via getAdminFromRequest (admin_session_token /
// Authorization: Bearer). One-device policy does NOT apply to admin routes.
//
// Audit: every successful POST writes admin_audit_logs with the admin email,
// action, and the new mode/kill value. Telemetry best-effort; a failed audit
// insert does NOT roll back the flip (the flip is the source of truth).
//
// No metadata leak: responses never include IPs, device ids, session ids, or
// raw DB error strings. The error contract collapses to canonical codes.

import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";
import { applyCors } from "../cors.js";
import { writeAdminAuditLog } from "../lms-session-guard.js";
import {
  ACTIVE_MODES,
  getRuntimeSnapshot,
  setActiveMode,
  setKillSwitch,
  refreshRuntimeConfig
} from "../v2-runtime-controller.js";
import { V2_FLAGS, isV2FlagConfigured, isV2FlagEnabled } from "../v2-flags.js";

function getClientIp(req) {
  return String(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    ""
  ).split(",")[0].trim();
}

function safeJsonError(res, status, code) {
  return res.status(status).json({ success: false, error: code, code });
}

// Build the flag posture snapshot for GET. `configured` = raw env value
// (what the operator set, reported even in v1 so the admin sees posture);
// `enabled` = effective behavioral state after the runtime gate.
function buildFlagPosture() {
  return Object.fromEntries(
    Object.entries(V2_FLAGS).map(([key, envName]) => [
      key,
      {
        envName,
        configured: isV2FlagConfigured(envName),
        enabled: isV2FlagEnabled(envName),
      },
    ])
  );
}

async function buildStateResponse() {
  const snapshot = await getRuntimeSnapshot();
  const effective = snapshot.activeMode === ACTIVE_MODES.V2 && !snapshot.killSwitch;
  return {
    success: true,
    activeMode: snapshot.activeMode,
    killSwitch: Boolean(snapshot.killSwitch),
    source: snapshot.source,
    ok: Boolean(snapshot.ok),
    effective, // true when V2 behavioral features are permitted
    flags: buildFlagPosture(),
  };
}

async function handleGet(req, res) {
  return res.status(200).json(await buildStateResponse());
}

async function handlePost(req, res, adminSession) {
  const body = req.body || {};
  const action = String(body.action || "").trim();
  const adminEmail = normalizeEmail(adminSession.email);
  const ip = getClientIp(req);
  const userAgent = req.headers?.["user-agent"] || "";

  if (action === "set_mode") {
    const mode = String(body.mode || "").trim().toLowerCase();
    const result = await setActiveMode(mode);
    if (!result.ok) {
      // invalid_mode | db_error | db_exception
      const status = result.code === "invalid_mode" ? 400 : 503;
      return safeJsonError(res, status, result.code);
    }

    // Best-effort audit. A failed audit insert does NOT revert the flip —
    // the DB row is the source of truth. Non-throwing.
    try {
      await writeAdminAuditLog(supabase, {
        adminEmail,
        action: "v2_runtime_mode_set",
        metadata: { mode: result.activeMode },
        ip,
        userAgent,
      });
    } catch (err) {
      console.error("[admin-runtime-mode] audit insert failed:", err?.message);
    }

    return res.status(200).json({
      success: true,
      activeMode: result.activeMode,
      flipped: true,
    });
  }

  if (action === "set_kill_switch") {
    const enabled = parseBool(body.killSwitch);
    const result = await setKillSwitch(enabled);
    if (!result.ok) {
      return safeJsonError(res, 503, result.code);
    }

    try {
      await writeAdminAuditLog(supabase, {
        adminEmail,
        action: "v2_runtime_kill_switch_set",
        metadata: { killSwitch: result.killSwitch },
        ip,
        userAgent,
      });
    } catch (err) {
      console.error("[admin-runtime-mode] audit insert failed:", err?.message);
    }

    return res.status(200).json({
      success: true,
      killSwitch: result.killSwitch,
      flipped: true,
    });
  }

  return safeJsonError(res, 400, "invalid_action");
}

function parseBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return safeJsonError(res, 401, "admin_auth_required");
    }

    if (req.method === "GET") {
      // Refresh the cache so the GET reports the freshest DB state (the
      // admin may have flipped it from another session / instance).
      await refreshRuntimeConfig();
      return handleGet(req, res);
    }
    if (req.method === "POST") {
      return handlePost(req, res, adminSession);
    }
    return safeJsonError(res, 405, "method_not_allowed");
  } catch (error) {
    console.error("[admin-runtime-mode] error:", error?.message);
    return safeJsonError(res, 503, "runtime_mode_unavailable");
  }
}

// Test seam: allow tests to inject deps without touching module globals.
// (Not currently needed — the controller has its own stub seam — but kept
// for symmetry with the other admin handlers.)
export const _internals = { buildFlagPosture, buildStateResponse, parseBool };
