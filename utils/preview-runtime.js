import crypto from "node:crypto";

export const LMS_PREVIEW_REF = "plgrmaktvudjetfkwmyg";
export const FORBIDDEN_PRODUCTION_REF = "aqozjkfwzmyfunqvcyjv";

export function supabaseRef(value = process.env.SUPABASE_URL) {
  try {
    return new URL(String(value || "")).hostname.split(".")[0].toLowerCase();
  } catch {
    return "";
  }
}

export function assertLmsPreviewRuntime() {
  const ref = supabaseRef();
  if (
    ref !== LMS_PREVIEW_REF ||
    ref === FORBIDDEN_PRODUCTION_REF ||
    String(process.env.VERCEL_ENV || "").toLowerCase() === "production" ||
    process.env.V5_INTEGRATION_PREVIEW !== "1"
  ) {
    const error = new Error("PRODUCTION_DATABASE_FORBIDDEN");
    error.code = "PRODUCTION_DATABASE_FORBIDDEN";
    error.status = 404;
    throw error;
  }
  return { ref, preview: true };
}

export function timingSafeSecret(supplied, expected) {
  const left = Buffer.from(String(supplied || ""));
  const right = Buffer.from(String(expected || ""));
  return right.length >= 32 && left.length === right.length && crypto.timingSafeEqual(left, right);
}
