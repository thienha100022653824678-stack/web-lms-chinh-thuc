import { getAdminFromRequest, isAdminEmail, normalizeEmail } from "../lms.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const { accessToken } = req.body || {};

    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Chưa có Google Drive OAuth access token"
      });
    }

    // Verify token with Google tokeninfo
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    const tokenInfo = await tokenInfoRes.json();

    if (tokenInfo.error) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Access token không hợp lệ hoặc đã hết hạn",
        reason: tokenInfo.error_description || tokenInfo.error
      });
    }

    const tokenEmail = normalizeEmail(tokenInfo.email);
    if (!isAdminEmail(tokenEmail)) {
      return res.status(403).json({
        success: false,
        error: "Token Drive không thuộc tài khoản admin",
        extra: { tokenEmail, adminEmail: adminSession.email }
      });
    }

    const scope = String(tokenInfo.scope || "");
    const hasDriveFile =
      scope.includes("drive.file") ||
      scope.includes("https://www.googleapis.com/auth/drive.file");

    if (!hasDriveFile) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Token thiếu quyền drive.file"
      });
    }

    // Save token to site_config so background sync can use it
    try {
      const { supabase } = await import("../supabase.js");
      await supabase.from("site_config").upsert({
        key: "google_drive_access_token",
        value: { val: accessToken, expires_at: Date.now() + 3600 * 1000 },
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });
    } catch (saveErr) {
      console.error("[admin-drive-auth] Failed to save token to site_config:", saveErr.message);
    }

    return res.status(200).json({
      success: true,
      email: tokenEmail,
      scopes: { hasDriveFile }
    });
  } catch (err) {
    console.error("[admin-drive-auth] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server khi kiểm tra Drive OAuth",
      detail: err.message
    });
  }
}
