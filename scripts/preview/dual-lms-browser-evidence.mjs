import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";

const base = String(process.env.LMS_PREVIEW_URL || "").replace(/\/$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const harness = process.env.LMS_PREVIEW_HARNESS_SECRET;
if (!base || !bypass || !harness) throw new Error("BROWSER_EVIDENCE_ENV_REQUIRED");

const output = path.resolve("docs/dual-lms/evidence/screenshots");
fs.mkdirSync(output, { recursive: true });
const browsers = { chromium, firefox, webkit };
const viewports = {
  desktop: { width: 1440, height: 1000 },
  iphone: { width: 390, height: 844 },
  android: { width: 412, height: 915 },
  tablet: { width: 820, height: 1180 }
};
const results = [];

async function authenticate(context) {
  const response = await context.request.post(`${base}/api/lms/admin?endpoint=preview-auth`, {
    headers: { "x-lms-preview-harness-secret": harness }
  });
  if (!response.ok()) throw new Error(`PREVIEW_AUTH_${response.status()}`);
}

for (const [browserName, launcher] of Object.entries(browsers)) {
  const browser = await launcher.launch({ headless: true });
  try {
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({
        viewport,
        extraHTTPHeaders: {
          "x-vercel-protection-bypass": bypass,
          "x-vercel-set-bypass-cookie": "true"
        }
      });
      await authenticate(context);
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${base}/lms-admin.html?lms=yeunauan&course=preview-yeunauan-course-a`, {
        waitUntil: "domcontentloaded"
      });
      await page.waitForFunction(() => !document.getElementById("lmsTenantSelector")?.classList.contains("hidden"));
      await page.waitForFunction(() => document.getElementById("courseSelect")?.value === "preview-yeunauan-course-a");
      const labels = await page.locator("#lmsTenantSelector").innerText();
      if (!labels.includes("shop.yeunauan.live") || !labels.includes("yeubep.shop")) throw new Error("SELECTOR_LABELS");
      await page.locator("#lmsTenantBtn-yeubep").focus();
      if (await page.evaluate(() => document.activeElement?.id) !== "lmsTenantBtn-yeubep") throw new Error("FOCUS");
      await page.locator("#lmsTenantBtn-yeubep").click();
      await page.waitForFunction(() => typeof STATE !== "undefined" && STATE.courses.some((c) =>
        (typeof c === "string" ? c : c.slug) === "preview-yeubep-course-a"
      ));
      if (await page.locator("#courseSelect").inputValue()) throw new Error("STALE_COURSE");
      if (await page.evaluate(() => localStorage.getItem("lmsAdminTenant")) !== "yeubep") throw new Error("STORAGE");
      await page.screenshot({ path: path.join(output, `${browserName}-${viewportName}.png`), fullPage: true });
      const platformWarnings = pageErrors.filter((message) =>
        message.includes("navigator.storage.persisted")
      );
      const appErrors = pageErrors.filter((message) =>
        !message.includes("navigator.storage.persisted")
      );
      results.push({
        browser: browserName,
        viewport: viewportName,
        passed: true,
        appErrors,
        platformWarnings
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: viewports.desktop,
  extraHTTPHeaders: {
    "x-vercel-protection-bypass": bypass,
    "x-vercel-set-bypass-cookie": "true"
  }
});
await authenticate(context);
const page = await context.newPage();
await page.goto(`${base}/lms-admin.html?lms=yeunauan&course=preview-legacy-canonical`, {
  waitUntil: "domcontentloaded"
});
await page.waitForFunction(() => !document.getElementById("lmsTenantSelector")?.classList.contains("hidden"));
await page.screenshot({ path: path.join(output, "01-shop-yeunauan-live.png"), fullPage: true });
await page.locator("#legacySharedNotice").screenshot({ path: path.join(output, "06-legacy-shared-warning.png") });
await page.locator("#tabBtn-students").click();
await page.screenshot({ path: path.join(output, "07-global-tab-badge.png"), fullPage: true });
await page.locator("#lmsTenantBtn-yeubep").click();
await page.waitForFunction(() => typeof STATE !== "undefined" && STATE.lmsTenant === "yeubep");
await page.screenshot({ path: path.join(output, "02-yeubep-shop.png"), fullPage: true });
await page.goto(`${base}/lms-admin.html?lms=yeubep&course=preview-yeunauan-course-a`, {
  waitUntil: "domcontentloaded"
});
await page.waitForFunction(() => !document.getElementById("lmsTenantSelector")?.classList.contains("hidden"));
await page.screenshot({ path: path.join(output, "05-invalid-deep-link.png"), fullPage: true });
await context.close();
await browser.close();

fs.writeFileSync(
  path.join(output, "browser-matrix.json"),
  `${JSON.stringify({ deployment: base, cases: results }, null, 2)}\n`
);
if (results.length !== 12 || results.some((item) => !item.passed || item.appErrors.length)) {
  throw new Error("BROWSER_MATRIX_FAILED");
}
console.log(JSON.stringify({ ok: true, cases: results.length, output }));
