// packages/v3-event-schema/src/index.mjs
// Barrel — one import surface for the shared V3 contract.

export {
  RUNTIME_VERSIONS,
  CURRENT_SCHEMA_VERSION,
  VALID_MODES,
  isValidRuntimeVersion,
  normalizeRuntimeVersion,
} from './runtime.mjs';

export {
  EVENT_TYPES,
  AGGREGATE_TYPES,
  makeEventEnvelope,
} from './events.mjs';

export {
  enrollmentDto,
  courseDto,
  sessionEventDto,
} from './dto.mjs';

export {
  ERROR_CODES,
  reasonToErrorCode,
} from './errors.mjs';

export {
  normalizeEmail,
  buildIdempotencyKey,
  maskEmail,
  hashIdentifier,
} from './helpers.mjs';
