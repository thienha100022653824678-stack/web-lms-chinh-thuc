// utils/lms-secrets.js
// Centralized auth secret + config validation for RP-1.
// Goals:
//  - Fail-closed when required auth secrets are missing in production runtime.
//  - Never echo secret values in error messages; only the variable NAMES.
//  - Provide timing-safe HMAC compare helper.
//  - Allow tests/local-only mode where missing-secret is allowed but flagged.
//
// Single source of truth for SESSION_SECRET and hash-event secret.
// Existing V1 paths continue to work; this module is the only place that
// knows how to read those variables safely.

import crypto from "crypto";

const SESSION_SECRET_ENV = "SESSION_SECRET";
const ACCOUNT_EVENT_HASH_SECRET_ENV = "ACCOUNT_EVENT_HASH_SECRET";
const SESSION_GUARD_HASH_SECRET_ENV = "SESSION_GUARD_HASH_SECRET";
const INTERNAL_SYNC_SECRET_ENV = "INTERNAL_SYNC_SECRET";

// Modules that intentionally bypass fail-closed (e.g. tests). Set
// LMS_RP1_ALLOW_INSECURE_LOCAL=1 to allow missing required secrets during
// development. In production the env var must be unset OR explicitly set to "1"
// AND NODE_ENV must not be "production".
export function isLocalBypassAllowed() {
  const flag = String(process.env.LMS_RP1_ALLOW_INSECURE_LOCAL || "").trim();
  if (flag !== "1") return false;
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") return false;
  if (String(process.env.VERCEL_ENV || "").toLowerCase() === "production") return false;
  return true;
}

function readSecret(name) {
  const value = process.env[name];
  if (typeof value !== "string") return "";
  return value.trim();
}

// AuthSecretError intentionally does NOT include the secret value.
// It exposes only the variable name(s) so operators know what to configure.
export class AuthSecretError extends Error {
  constructor(message, missingNames = []) {
    super(message);
    this.name = "AuthSecretError";
    this.missingEnvVars = Array.isArray(missingNames) ? missingNames.slice() : [];
    this.exposesValues = false;
  }

  toClientJson() {
    return {
      ok: false,
      code: this.code || "auth_misconfigured",
      error: "Authentication is temporarily unavailable. Please retry later.",
      missingEnvVars: this.missingEnvVars
    };
  }
}

AuthSecretError.prototype.code = "auth_misconfigured";

function ensureSecret(name) {
  const value = readSecret(name);
  if (value) return value;
  if (isLocalBypassAllowed()) {
    // Local-only bypass: return a clearly-marked synthetic value so any
    // signature generated here is recognizable. NEVER use this in production.
    return `__local_bypass__${name}__not_for_production__`;
  }
  throw new AuthSecretError(
    `Missing required auth configuration: ${name}`,
    [name]
  );
}

// Get the primary session signing secret. Throws AuthSecretError on missing.
export function getSessionSecret() {
  return ensureSecret(SESSION_SECRET_ENV);
}

// Get the secret used for hashing account-event/session-guard values (ip,
// device, lms_session, etc.). Throws AuthSecretError on missing.
export function getAccountEventHashSecret() {
  // Prefer ACCOUNT_EVENT_HASH_SECRET; fall back to SESSION_GUARD_HASH_SECRET.
  const primary = readSecret(ACCOUNT_EVENT_HASH_SECRET_ENV);
  if (primary) return primary;
  const fallback = readSecret(SESSION_GUARD_HASH_SECRET_ENV);
  if (fallback) return fallback;
  if (isLocalBypassAllowed()) {
    return `__local_bypass__hash_secret__not_for_production__`;
  }
  throw new AuthSecretError(
    `Missing required auth configuration: ${ACCOUNT_EVENT_HASH_SECRET_ENV} or ${SESSION_GUARD_HASH_SECRET_ENV}`,
    [ACCOUNT_EVENT_HASH_SECRET_ENV, SESSION_GUARD_HASH_SECRET_ENV]
  );
}

// Returns the set of env names that must be configured for the auth subsystem
// to operate in production. Use this for boot-time self-check; do NOT log
// values.
export function listRequiredAuthSecrets() {
  return [SESSION_SECRET_ENV, ACCOUNT_EVENT_HASH_SECRET_ENV];
}

// Validate every required auth secret is present. Throws AuthSecretError
// describing only the variable names if any are missing. Safe to call from
// boot paths.
export function assertAuthSecretsConfigured() {
  const missing = [];
  if (!readSecret(SESSION_SECRET_ENV)) missing.push(SESSION_SECRET_ENV);
  if (
    !readSecret(ACCOUNT_EVENT_HASH_SECRET_ENV) &&
    !readSecret(SESSION_GUARD_HASH_SECRET_ENV)
  ) {
    missing.push(ACCOUNT_EVENT_HASH_SECRET_ENV);
  }
  if (!missing.length) return;
  if (isLocalBypassAllowed()) return;
  throw new AuthSecretError(
    `Missing required auth configuration: ${missing.join(", ")}`,
    missing
  );
}

// Sign a payload string with HMAC-SHA256 using the session secret.
export function signSessionPayload(payloadString) {
  const secret = getSessionSecret();
  return crypto.createHmac("sha256", secret).update(payloadString).digest("base64url");
}

// Verify a token of the form "<payloadBase64url>.<signatureBase64url>"
// in constant time. Returns the decoded payload string on success, or null.
// Accepts an optional secret override for testing.
export function verifySessionToken(token, secretOverride = null) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = secretOverride
    ? crypto.createHmac("sha256", secretOverride).update(payloadBase64).digest("base64url")
    : signSessionPayload(payloadBase64);

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return payloadBase64;
}

// Constant-time comparison for two strings (e.g. internal sync secrets).
// Returns false if either input is missing or lengths differ (we still
// perform a fixed-cost compare against the actual input to reduce leak on
// length differences).
export function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Force a constant-cost compare to keep timing consistent.
    const pad = Buffer.alloc(Math.max(aBuf.length, bBuf.length, 1));
    aBuf.copy(pad);
    crypto.timingSafeEqual(pad, Buffer.alloc(pad.length));
    return false;
  }
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

// Read and validate the internal sync secret. Throws on missing.
export function getInternalSyncSecret() {
  return ensureSecret(INTERNAL_SYNC_SECRET_ENV);
}

export const AUTH_SECRET_NAMES = Object.freeze({
  SESSION_SECRET: SESSION_SECRET_ENV,
  ACCOUNT_EVENT_HASH_SECRET: ACCOUNT_EVENT_HASH_SECRET_ENV,
  SESSION_GUARD_HASH_SECRET: SESSION_GUARD_HASH_SECRET_ENV,
  INTERNAL_SYNC_SECRET: INTERNAL_SYNC_SECRET_ENV
});