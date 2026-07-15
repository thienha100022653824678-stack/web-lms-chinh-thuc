// utils/cors.js
//
// RP2-A — Centralized CORS policy helper.
//
// Goals:
//   * Replace 26 hand-rolled `Access-Control-Allow-Origin: *` blocks across
//     admin/portal/internal handlers with a single, testable helper.
//   * Never emit `Access-Control-Allow-Credentials: true` together with
//     `Access-Control-Allow-Origin: *`. Echoing an exact allowed origin is
//     the only safe way to expose credentials cross-origin.
//   * Fail-closed when the feature flag is on but the allowlist is missing
//     or malformed; preflight from a non-allowed origin returns 403.
//   * Server-to-server requests with no `Origin` header are passed through
//     for the `internal` mode (Shop → LMS sync). CORS does NOT replace the
//     existing INTERNAL_SYNC_SECRET check in api/sync.js.
//   * Public read-only endpoints (public-config, public-lesson) keep the
//     historical `*` allowance but never with credentials.
//
// Mode matrix:
//   admin   — allowlist LMS_ADMIN_ORIGINS; credentials OK.
//   portal  — allowlist LMS_PORTAL_ORIGINS; no credentials by default.
//   internal— allow server-to-server with no Origin; block cross-origin
//             browser requests when flag is on.
//   public  — wildcard with no credentials. Used only for read-only public
//             endpoints that the RP-2 plan explicitly listed.

const CORS_MODES = Object.freeze(["admin", "portal", "internal", "public"]);

const DEFAULT_ALLOWED_HEADERS = {
  admin: "Content-Type, Authorization",
  portal: "Content-Type",
  internal: "Content-Type, X-Sync-Secret",
  public: "Content-Type"
};

const DEFAULT_ALLOWED_METHODS = {
  admin: "GET, POST, PUT, DELETE, OPTIONS",
  portal: "GET, POST, OPTIONS",
  internal: "POST, OPTIONS",
  public: "GET, POST, OPTIONS"
};

const DEFAULT_ALLOW_CREDENTIALS = Object.freeze({
  admin: true,
  portal: false,
  internal: false,
  public: false
});

const PUBLIC_WILDCARD_ALLOWED_FILES = new Set([
  "utils/lms-handlers/public-config.js",
  "utils/lms-handlers/public-lesson.js"
]);

function readEnv(name) {
  const raw = process.env[name];
  return typeof raw === "string" ? raw : "";
}

function isProductionEnv() {
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  return nodeEnv === "production" || vercelEnv === "production";
}

function isFeatureEnabled() {
  const raw = String(process.env.V2_CORS_ALLOWLIST_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isValidOriginString(origin) {
  if (typeof origin !== "string" || !origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.pathname && url.pathname !== "/") return false;
  if (url.search || url.hash) return false;
  if (!url.hostname) return false;
  return true;
}

export function parseOriginList(rawValue) {
  if (typeof rawValue !== "string") return [];
  const result = [];
  const seen = new Set();
  for (const piece of rawValue.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (!isValidOriginString(trimmed)) {
      // Skip silently — caller decides fail-closed policy.
      continue;
    }
    const normalized = `${new URL(trimmed).protocol}//${new URL(trimmed).host}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function isAllowedOrigin(origin, allowlist) {
  if (!isValidOriginString(origin)) return false;
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  const normalized = `${new URL(origin).protocol}//${new URL(origin).host}`;
  return allowlist.includes(normalized);
}

export function isPreviewOriginAllowed(origin, suffix) {
  if (!isValidOriginString(origin)) return false;
  if (isProductionEnv()) return false;
  if (typeof suffix !== "string") return false;
  const trimmedSuffix = suffix.trim().toLowerCase();
  if (!trimmedSuffix) return false;
  const url = new URL(origin);
  const host = url.hostname.toLowerCase();
  // The normalized suffix always starts with a `.`. Compare against the
  // registrable label so attackers cannot piggy-back on the suffix via
  // labels like `evil-example.vercel.app.attacker.com` or `notvercel.app`.
  const normalizedSuffix = trimmedSuffix.startsWith(".") ? trimmedSuffix : `.${trimmedSuffix}`;
  const bareSuffix = normalizedSuffix.slice(1);
  if (host === bareSuffix) return true;
  if (!host.endsWith(normalizedSuffix)) return false;
  // Split off the suffix and require the remaining host to consist only of
  // one or more DNS labels (no empty labels, no leading/trailing dots).
  const head = host.slice(0, host.length - normalizedSuffix.length);
  if (!head || head.startsWith(".") || head.endsWith(".")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(head);
}

export function appendVaryHeader(res, value) {
  if (!value) return;
  const existing = res.getHeader("Vary");
  if (!existing) {
    res.setHeader("Vary", value);
    return;
  }
  const parts = String(existing)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === value.toLowerCase())) {
    parts.push(value);
    res.setHeader("Vary", parts.join(", "));
  }
}

function resolveAllowlistForMode(mode) {
  if (mode === "admin") return parseOriginList(readEnv("LMS_ADMIN_ORIGINS"));
  if (mode === "portal") return parseOriginList(readEnv("LMS_PORTAL_ORIGINS"));
  return [];
}

function resolvePreviewSuffix() {
  return readEnv("LMS_PREVIEW_ORIGIN_SUFFIX");
}

/**
 * Apply CORS headers and (when applicable) short-circuit a preflight.
 *
 * Returns `{ handled: boolean, status?: number, body?: object }`. When
 * `handled` is true the caller MUST stop processing (typically a 403 for
 * preflight from a non-allowed origin).
 *
 * When `handled` is false, the caller MUST still call its own OPTIONS
 * handler (which will normally return 200 for allowed requests) or
 * continue with the regular business logic for non-OPTIONS requests.
 */
export function applyCors(req, res, options) {
  const opts = options || {};
  const mode = CORS_MODES.includes(opts.mode) ? opts.mode : "public";
  const methods = opts.methods || DEFAULT_ALLOWED_METHODS[mode];
  const headers = opts.allowedHeaders || DEFAULT_ALLOWED_HEADERS[mode];
  const allowCredentials =
    typeof opts.allowCredentials === "boolean"
      ? opts.allowCredentials
      : DEFAULT_ALLOW_CREDENTIALS[mode];

  const isPublicWildcard = mode === "public";
  const flagEnabled = isFeatureEnabled();

  // Public read-only endpoints keep wildcard without credentials. We do
  // not route them through the feature flag — they were already public.
  if (isPublicWildcard) {
    if (allowCredentials) {
      // Defensive: if any caller tries to enable credentials in public mode
      // we refuse and behave like an internal mode with empty allowlist.
      return { handled: false, publicCredentialsRejected: true };
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader("Access-Control-Allow-Headers", headers);
    return { handled: false };
  }

  const originHeader = req?.headers?.origin;
  const origin = typeof originHeader === "string" ? originHeader.trim() : "";

  // Allowlist mode: validate origin (when present) against the mode
  // allowlist and the optional preview suffix.
  if (flagEnabled) {
    const allowlist = resolveAllowlistForMode(mode);
    const previewSuffix = mode === "admin" || mode === "portal" ? resolvePreviewSuffix() : "";

    const isEmptyOrigin = !origin;
    const isListed = !!origin && isAllowedOrigin(origin, allowlist);
    const isPreview = !!origin && previewSuffix && isPreviewOriginAllowed(origin, previewSuffix);

    // For internal mode, server-to-server requests without Origin are
    // allowed to proceed (secret headers still required by the handler).
    const internalNoOriginOk = mode === "internal" && isEmptyOrigin;
    // For admin/portal, an empty Origin is a same-origin or non-browser
    // request. We pass it through so that server-rendered forms and
    // curl tests still work; credentials exposure is impossible without
    // an Origin header.
    const emptyOriginOk = isEmptyOrigin;

    const allowed = isListed || isPreview || internalNoOriginOk || emptyOriginOk;

    if (!allowed) {
      // Preflight from a forbidden origin MUST be rejected with 403 and no
      // Access-Control-Allow-Origin header. Non-preflight forbidden
      // requests also receive 403 to keep parity for browser callers.
      const status = req?.method === "OPTIONS" ? 403 : 403;
      if (status === 403) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      return {
        handled: true,
        status,
        body: { ok: false, code: "cors_origin_forbidden", error: "Origin not allowed." }
      };
    }

    if (origin && (isListed || isPreview)) {
      const normalized = `${new URL(origin).protocol}//${new URL(origin).host}`;
      res.setHeader("Access-Control-Allow-Origin", normalized);
      appendVaryHeader(res, "Origin");
    } else if (origin) {
      // Empty-origin allowed path: no ACAO echoed, no Vary.
    }

    if (allowCredentials) {
      // Never combine credentials with wildcard. `origin` may be empty
      // here only if the request had no Origin header at all.
      if (!origin) {
        // Don't advertise credentials to anonymous callers.
      } else {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }

    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader("Access-Control-Allow-Headers", headers);
    return { handled: false };
  }

  // Flag disabled → compatibility mode. Emit the historical headers but
  // guard against credentials + wildcard at the helper layer. If a caller
  // tries to opt into credentials while the flag is off, we still refuse
  // to combine credentials with wildcard.
  if (allowCredentials) {
    // Echo the request's origin when present, never wildcard.
    if (origin) {
      const normalized = `${new URL(origin).protocol}//${new URL(origin).host}`;
      res.setHeader("Access-Control-Allow-Origin", normalized);
      appendVaryHeader(res, "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "null");
      appendVaryHeader(res, "Origin");
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", headers);
  return { handled: false };
}

export const _internals = {
  CORS_MODES,
  DEFAULT_ALLOWED_HEADERS,
  DEFAULT_ALLOWED_METHODS,
  DEFAULT_ALLOW_CREDENTIALS,
  PUBLIC_WILDCARD_ALLOWED_FILES,
  isProductionEnv,
  isFeatureEnabled
};