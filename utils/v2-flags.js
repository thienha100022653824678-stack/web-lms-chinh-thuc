const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);

export const V2_FLAGS = Object.freeze({
  PLATFORM_ENABLED: 'V2_PLATFORM_ENABLED',
  OUTBOX_SHADOW_MODE: 'V2_OUTBOX_SHADOW_MODE',
  OUTBOX_WORKER_ENABLED: 'V2_OUTBOX_WORKER_ENABLED',
  OUTBOX_WORKER_DRY_RUN: 'V2_OUTBOX_WORKER_DRY_RUN',
  DELIVERY_HANDLERS_ENABLED: 'V2_DELIVERY_HANDLERS_ENABLED',
  PORTAL_PROJECTION_ENABLED: 'V2_PORTAL_PROJECTION_ENABLED',
  PORTAL_PROJECTION_DRY_RUN: 'V2_PORTAL_PROJECTION_DRY_RUN',
  SESSION_LEASE_ENABLED: 'V2_SESSION_LEASE_ENABLED',
  ENTRY_TOKEN_REQUIRED: 'V2_ENTRY_TOKEN_REQUIRED',
  DRIVE_WORKER_DRY_RUN: 'V2_DRIVE_WORKER_DRY_RUN',
  RECONCILIATION_READONLY: 'V2_RECONCILIATION_READONLY',
  RISK_SCORING_ENABLED: 'V2_RISK_SCORING_ENABLED',
});

export function getV2Env(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim();
}

export function isV2FlagEnabled(name, fallback = false) {
  const value = getV2Env(name);
  if (!value) return fallback;
  return TRUE_VALUES.has(value.toLowerCase());
}

export function getV2ListFlag(name) {
  return getV2Env(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getV2RuntimeMode() {
  return getV2Env('V2_RUNTIME_MODE', isV2FlagEnabled(V2_FLAGS.PLATFORM_ENABLED) ? 'enabled' : 'off');
}

// ── RP2-A / RP2-B1 security flags (strict parser) ───────────────────────────
// Pure-function parser: only 1/true/yes/on (case-insensitive, trimmed) become
// true. Anything else (0/false/no/off/empty/undefined/non-string) is false.
// Never raises, never logs, never echoes the env value. Accepts an env-shaped
// object so tests can pass a snapshot without touching process.env.
export function parseBooleanFlag(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

// RP2-A CORS allowlist flag. Kept separate from the one-device flag so the two
// features can be enabled independently.
export function isV2CorsAllowlistEnabled(env = process.env) {
  return parseBooleanFlag(env?.V2_CORS_ALLOWLIST_ENABLED);
}

// RP2-B1 global one-device / LMS verified-session enforcement. When true,
// course-data/lesson treat every course as requiring a verified LMS session
// and the legacy LMS_ENTRY_TOKEN_REQUIRED_COURSES allowlist is ignored as a
// bypass gate. When false (default), V1 behavior is preserved exactly.
export function isV2GlobalOneDeviceEnabled(env = process.env) {
  return parseBooleanFlag(env?.V2_GLOBAL_ONE_DEVICE_ENABLED);
}

export const _internals = { parseBooleanFlag };
