import { getAdminFromRequest, isAdminEmail, normalizeEmail } from "../lms.js";
import { google } from "googleapis";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const { supabase } = await import("../supabase.js");

    // ── GET: Check connection status ─────────────────────────────────────────
    if (req.method === "GET") {
      const { getGoogleDriveClient } = await import("../lms.js");
      try {
        const clientInfo = await getGoogleDriveClient(supabase);
        if (clientInfo && clientInfo.drive) {
          const type = clientInfo.isServiceAccount ? "service_account" : "oauth";
          return res.status(200).json({
            success: true,
            connected: true,
            type,
            accessToken: clientInfo.accessToken
          });
        }
      } catch (err) {
        console.error("Failed to check Google Drive client info:", err);
      }

      return res.status(200).json({ success: true, connected: false });
    }

    // ── POST: Exchange Authorization Code for Refresh/Access Tokens ──────────
    if (req.method === "POST") {
      const { code } = req.body || {};

      if (!code || typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ success: false, error: "Thiếu Authorization Code" });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "postmessage"
      );

      const { tokens } = await oauth2Client.getToken(code);
      const { access_token, refresh_token, expiry_date } = tokens;

      if (!access_token) {
        return res.status(400).json({ success: false, error: "Không nhận được Access Token từ Google" });
      }

      // Verify email via access_token info
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`
      );
      const tokenInfo = await tokenInfoRes.json();

      if (tokenInfo.error) {
        return res.status(400).json({ success: false, error: "Token vừa nhận được không hợp lệ hoặc đã hết hạn" });
      }

      const tokenEmail = normalizeEmail(tokenInfo.email);
      if (!isAdminEmail(tokenEmail)) {
        return res.status(403).json({
          success: false,
          error: `Tài khoản Google (${tokenEmail}) vừa chọn không khớp với danh sách quản trị viên`
        });
      }

      // Save access_token to site_config
      await supabase.from("site_config").upsert({
        key: "google_drive_access_token",
        value: { val: access_token, expires_at: expiry_date || (Date.now() + 3600 * 1000) },
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });

      // Save refresh_token to site_config if present
      if (refresh_token) {
        await supabase.from("site_config").upsert({
          key: "google_drive_refresh_token",
          value: { val: refresh_token },
          updated_at: new Date().toISOString()
        }, { onConflict: "key" });
      }

      return res.status(200).json({
        success: true,
        email: tokenEmail,
        message: "Kết nối Google Drive thành công!"
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-drive-auth] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi server khi kết nối Google Drive",
      detail: err.message
    });
  }
}
