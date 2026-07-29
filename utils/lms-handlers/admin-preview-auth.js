import { applyCors } from "../cors.js";
import { createAdminSession } from "../lms.js";
import { assertLmsPreviewRuntime, timingSafeSecret } from "../preview-runtime.js";

const PREVIEW_ADMIN = "admin.multisite.preview@example.test";

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    assertLmsPreviewRuntime();
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
    if (!timingSafeSecret(req.headers["x-lms-preview-harness-secret"], process.env.LMS_PREVIEW_HARNESS_SECRET)) {
      return res.status(401).json({ success: false, error: "PREVIEW_HARNESS_AUTH_REQUIRED" });
    }
    const previewSessionSecret = String(process.env.LMS_PREVIEW_SESSION_SECRET || "");
    if (previewSessionSecret.length < 32) {
      return res.status(503).json({ success: false, error: "PREVIEW_SESSION_MISCONFIGURED" });
    }
    process.env.SESSION_SECRET = previewSessionSecret;
    process.env.ADMIN_EMAILS = PREVIEW_ADMIN;
    const session = createAdminSession(PREVIEW_ADMIN);
    res.setHeader("Set-Cookie", `admin_session_token=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ success: true, admin: PREVIEW_ADMIN, previewOnly: true });
  } catch (error) {
    if (error.code === "PRODUCTION_DATABASE_FORBIDDEN") {
      return res.status(404).json({ success: false, error: "route_not_found" });
    }
    throw error;
  }
}
