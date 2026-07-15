// utils/v2-flags.js
//
// RP2-B1 — Centralized V2 feature flag helpers.
//
// Goals:
//   * Single source of truth for boolean-style V2 feature flags.
//   * Pure functions (no side effects, no log lines, no process.env reads
//     inside the parser). Callers pass an env-shaped object so the helpers
//     stay trivially testable.
//   * Strict parsing: only `1 / true / yes / on` (case-insensitive, trimmed)
//     become `true`. Anything else (including `0`, `false`, `no`, `off`,
//     empty string, `undefined`) is `false`.
//   * Never raises. Never logs. Never echoes the env value back.
//
// This module intentionally does NOT mutate `process.env`. It accepts an
// env-like bag as its only argument so tests can pass a snapshot.
// Tests should still pre-set `process.env` if a downstream code path reads
// `process.env.*` directly; that part is outside this module's scope.

export function parseBooleanFlag(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "1" ||
         normalized === "true" ||
         normalized === "yes" ||
         normalized === "on";
}

/**
 * RP2-A CORS allowlist flag. Kept on its own (NOT grouped with the
 * RP2-B1 flag) so the two features can be enabled independently.
 */
export function isV2CorsAllowlistEnabled(env = process.env) {
  return parseBooleanFlag(env?.V2_CORS_ALLOWLIST_ENABLED);
}

/**
 * RP2-B1 — V2 global one-device / LMS verified session enforcement.
 *
 * When `true`, `utils/lms-handlers/{course-data,lesson}.js` treat every
 * student-facing course as requiring a verified LMS session. The legacy
 * `LMS_ENTRY_TOKEN_REQUIRED_COURSES` allowlist is ignored as a bypass
 * gate, the cookie `course_session_token` cannot authorize access on
 * its own, and verification errors fail-closed with HTTP 503.
 *
 * When `false` (default), the V1 behavior is preserved exactly so the
 * migration to B1 is reversible by setting the env to anything but the
 * four accepted truthy tokens.
 */
export function isV2GlobalOneDeviceEnabled(env = process.env) {
  return parseBooleanFlag(env?.V2_GLOBAL_ONE_DEVICE_ENABLED);
}

export const _internals = { parseBooleanFlag };
