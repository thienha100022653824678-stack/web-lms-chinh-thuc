const ALLOWED_METRICS = Object.freeze([
  "runtime",
  "auth",
  "auth_session_db",
  "auth_control_db",
  "auth_student_db",
  "auth_enrollment_db",
  "auth_touch_db",
  "lesson_lookup",
  "enrollment_check",
  "sibling_lookup",
  "drive",
  "media",
  "bunny",
  "recipe",
  "response_build",
  "handler_total"
]);

const MAX_HEADER_BYTES = 1024;
const PROCESS_STARTED_AT = monotonicNow();
const contexts = new WeakMap();
let requestOrdinal = 0;

function monotonicNow() {
  try {
    if (globalThis.performance && typeof globalThis.performance.now === "function") {
      return globalThis.performance.now();
    }
  } catch {}
  try {
    return Number(process.hrtime.bigint()) / 1e6;
  } catch {
    return 0;
  }
}

function isEnabled() {
  try {
    return process.env.LMS_SERVER_TIMING === "1";
  } catch {
    return false;
  }
}

function utf8ByteLength(value) {
  const text = String(value || "");
  try {
    if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
      return Buffer.byteLength(text, "utf8");
    }
  } catch {}
  try {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  } catch {}
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}|./gi, "x").length;
}

export function getOrCreateLmsServerTiming(req) {
  if (!isEnabled() || !req || (typeof req !== "object" && typeof req !== "function")) return null;
  try {
    const existing = contexts.get(req);
    if (existing) return existing;
    const metrics = Object.create(null);
    for (const name of ALLOWED_METRICS) metrics[name] = 0;
    const context = {
      metrics,
      startedAt: monotonicNow(),
      ordinal: ++requestOrdinal,
      finalized: false,
      hooksInstalled: false
    };
    contexts.set(req, context);
    return context;
  } catch {
    return null;
  }
}

export async function timeLmsAsync(context, name, operation) {
  if (!context || !ALLOWED_METRICS.includes(name)) return operation();
  const startedAt = monotonicNow();
  try {
    return await operation();
  } finally {
    try {
      const duration = monotonicNow() - startedAt;
      if (Number.isFinite(duration) && duration >= 0) {
        context.metrics[name] += duration;
      }
    } catch {}
  }
}

export function timeLmsSync(context, name, operation) {
  if (!context || !ALLOWED_METRICS.includes(name)) return operation();
  const startedAt = monotonicNow();
  try {
    return operation();
  } finally {
    try {
      const duration = monotonicNow() - startedAt;
      if (Number.isFinite(duration) && duration >= 0) {
        context.metrics[name] += duration;
      }
    } catch {}
  }
}

function finalizeHeaders(res, context) {
  if (!context || context.finalized) return;
  context.finalized = true;
  try {
    const total = monotonicNow() - context.startedAt;
    if (Number.isFinite(total) && total >= 0) context.metrics.handler_total = total;

    const header = ALLOWED_METRICS
      .map((name) => {
        const duration = context.metrics[name];
        if (!Number.isFinite(duration) || duration < 0) return "";
        return `${name};dur=${duration.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(", ");

    if (utf8ByteLength(header) <= MAX_HEADER_BYTES) {
      res.setHeader("Server-Timing", header);
    }
  } catch {}

  try {
    res.setHeader("X-LMS-Request-Ordinal", String(context.ordinal));
  } catch {}
  try {
    const age = Math.max(0, Math.round(monotonicNow() - PROCESS_STARTED_AT));
    if (Number.isFinite(age)) res.setHeader("X-LMS-Instance-Age-Ms", String(age));
  } catch {}
}

export function installLmsTimingResponseHooks(req, res) {
  const context = getOrCreateLmsServerTiming(req);
  if (!context || !res || context.hooksInstalled) return context;
  try {
    context.hooksInstalled = true;
    if (typeof res.json === "function") {
      const originalJson = res.json;
      res.json = function timingJson(...args) {
        finalizeHeaders(this, context);
        return originalJson.apply(this, args);
      };
    }
    if (typeof res.end === "function") {
      const originalEnd = res.end;
      res.end = function timingEnd(...args) {
        finalizeHeaders(this, context);
        return originalEnd.apply(this, args);
      };
    }
  } catch {
    return context;
  }
  return context;
}

export { ALLOWED_METRICS };
