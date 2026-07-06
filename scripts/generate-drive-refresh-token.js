import http from "node:http";
import { execFile } from "node:child_process";
import { google } from "googleapis";

const PORT = Number(process.env.DRIVE_REFRESH_PORT || 8787);
const HOST = "127.0.0.1";
const REDIRECT_URI = process.env.DRIVE_REFRESH_REDIRECT_URI || `http://${HOST}:${PORT}/oauth2callback`;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || process.env.DRIVE_CLIENT_SECRET;
const EXPECTED_EMAIL = String(process.env.DRIVE_ADMIN_EMAIL || "").trim().toLowerCase();
const DRIVE_ADMIN_SLOT = String(process.env.DRIVE_ADMIN_SLOT || "").trim();
const PRINT_ONLY = process.env.DRIVE_REFRESH_PRINT_ONLY === "1" || process.argv.includes("--print-url");

const SCOPES = [
  "https://www.googleapis.com/auth/drive"
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
  console.error("Set them in the current shell, or load them from .env.local before running this script.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const generatedAuthUrl = oauth2Client.generateAuthUrl({
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
  include_granted_scopes: false
});

const authUrlObj = new URL(generatedAuthUrl);
authUrlObj.searchParams.set("client_id", CLIENT_ID);
authUrlObj.searchParams.set("redirect_uri", REDIRECT_URI);
authUrlObj.searchParams.set("response_type", "code");
authUrlObj.searchParams.set("scope", SCOPES.join(" "));
authUrlObj.searchParams.set("access_type", "offline");
authUrlObj.searchParams.set("prompt", "consent");
const authUrl = authUrlObj.toString();

function openBrowser(url) {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  execFile(command, args, { windowsHide: true }, () => {});
}

function html(body) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Drive Refresh Token</title></head>
  <body style="font-family: Arial, sans-serif; padding: 24px; line-height: 1.5;">
    ${body}
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", REDIRECT_URI);
    if (url.pathname !== "/oauth2callback") {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(html("<h1>Not found</h1>"));
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      throw new Error(`Google OAuth error: ${error}`);
    }

    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("Missing OAuth authorization code.");
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      throw new Error("Google did not return a refresh token. Revoke app access for this Gmail, then run again with prompt=consent.");
    }

    const expectedEmailLabel = EXPECTED_EMAIL || "(DRIVE_ADMIN_EMAIL not set)";
    const envName = DRIVE_ADMIN_SLOT ? `DRIVE_ADMIN_${DRIVE_ADMIN_SLOT}_REFRESH_TOKEN` : "DRIVE_ADMIN_X_REFRESH_TOKEN";

    console.log("");
    console.log("DRIVE_ADMIN_SLOT:");
    console.log(DRIVE_ADMIN_SLOT || "(not set)");
    console.log("");
    console.log("DRIVE_ADMIN_EMAIL you intended to authorize:");
    console.log(expectedEmailLabel);
    console.log("Make sure the Google consent screen used this Gmail account.");
    console.log("");
    console.log("OAuth scopes:");
    console.log((tokens.scope || SCOPES.join(" ")).split(/\s+/).join("\n"));
    console.log("");
    console.log(`Paste this value into Vercel ENV ${envName}:`);
    console.log(tokens.refresh_token);
    console.log("");
    console.log("Do not commit this token.");

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html(`
      <h1>&#272;&#227; l&#7845;y refresh token th&#224;nh c&#244;ng</h1>
      <p>Quay l&#7841;i terminal &#273;&#7875; copy token.</p>
      <p>Gmail admin d&#7921; ki&#7871;n: <strong>${escapeHtml(expectedEmailLabel)}</strong></p>
      <p>H&#227;y ch&#7855;c ch&#7855;n m&#224;n h&#236;nh Google v&#7915;a &#273;&#259;ng nh&#7853;p &#273;&#250;ng Gmail admin n&#224;y.</p>
      <p>Kh&#244;ng paste token v&#224;o chat v&#224; kh&#244;ng commit token l&#234;n Git.</p>
    `));
  } catch (err) {
    const message = String(err.message || err);
    console.error(message);
    if (/refresh token/i.test(message)) {
      console.error("If Google did not return a refresh_token:");
      console.error("1. Open https://myaccount.google.com/permissions");
      console.error("2. Remove this OAuth app from the Gmail admin account");
      console.error("3. Run this script again. It already uses prompt=consent and access_type=offline.");
    }
    res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    res.end(html(`<h1>Failed</h1><p>${escapeHtml(message)}</p>`));
  } finally {
    setTimeout(() => server.close(), 500);
  }
});

function printAuthUrlSummary() {
  const parsed = new URL(authUrl);
  const requiredParams = ["client_id", "redirect_uri", "response_type", "scope", "access_type", "prompt"];
  console.log("OAuth URL check:");
  requiredParams.forEach((name) => {
    console.log(`${name}: ${parsed.searchParams.get(name) ? "OK" : "MISSING"}`);
  });
  console.log("");
  console.log("Redirect URI:");
  console.log(REDIRECT_URI);
  console.log("");
  console.log("OAuth URL:");
  console.log(authUrl);
  console.log("");
}

if (PRINT_ONLY) {
  printAuthUrlSummary();
  process.exit(0);
}

server.listen(PORT, HOST, () => {
  console.log(`Local OAuth callback listening on ${REDIRECT_URI}`);
  console.log("");
  console.log("Opening Google OAuth. If the browser does not open, copy this URL:");
  printAuthUrlSummary();
  openBrowser(authUrl);
});
