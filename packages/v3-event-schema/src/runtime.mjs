// packages/v3-event-schema/src/runtime.mjs
// Runtime-version + schema-version constants shared across Shop/Portal/LMS.
// Pinned here so a breaking contract change becomes a compile/test error, not a
// cross-repo 401 at runtime (the V1/V2 sync-secret coupling pain ⑩ targets).

export const RUNTIME_VERSIONS = Object.freeze({
  V1: 'v1',
  V2: 'v2',
  V3: 'v3',
});

export const CURRENT_SCHEMA_VERSION = '2026-07-15';

// The valid runtime modes — mirrors utils/runtime-controller.js VALID_MODES.
// Importing from the controller would couple the shared package to the LMS
// repo; duplicating this frozen constant is intentional and tiny.
export const VALID_MODES = Object.freeze(new Set(['v1', 'v2', 'v3']));

export function isValidRuntimeVersion(v) {
  return VALID_MODES.has(v);
}

// Normalize a runtime version; unknown -> 'v1' (fail-closed, matches controller).
export function normalizeRuntimeVersion(v) {
  return isValidRuntimeVersion(v) ? v : RUNTIME_VERSIONS.V1;
}
