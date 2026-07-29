import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";

const baseURL = process.env.LMS_PREVIEW_URL;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const harness = process.env.LMS_PREVIEW_HARNESS_SECRET;
if (!baseURL || !bypass || !harness) throw new Error("BROWSER_EVIDENCE_ENV_REQUIRED");

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "_local_artifacts", "lms-admin-multisite-preview", "screenshots");
fs.mkdirSync(output, { recursive: true });

const browsers = { chromium, firefox, webkit };
const viewports = {
  desktop: { width: 1440, height: 1000 },
  iphone: { width: 390, height: 844 },
  android: { width: 412, height: 915 },
  tablet: { width: 820, height: 1180 }
};
const results = [];

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
      const auth = await context.request.post(`${baseURL}/api/lms/admin?endpoint=preview-auth`, {
        headers: { "x-lms-preview-harness-secret": harness }
      });
      if (!auth.ok()) throw new Error(`${browserName}/${viewportName}:preview-auth:${auth.status()}`);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseURL}/lms-admin.html?site=yeunauan&course=preview-yeunauan-course-a`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => !document.getElementById("learningSiteSelector")?.classList.contains("hidden"));
      await page.waitForFunction(() => document.body.innerText.includes("preview-yeunauan-course-a"));
      const selectorText = await page.locator("#learningSiteSelector").innerText();
      if (!selectorText.includes("shop.yeunauan.live") || !selectorText.includes("yeubep.shop")) {
        throw new Error(`${browserName}/${viewportName}:selector-labels`);
      }
      const legacyVisible = await page.locator("#legacySharedNotice").isVisible();
      if (!legacyVisible) throw new Error(`${browserName}/${viewportName}:legacy-warning-hidden`);
      const selectedBefore = await page.locator("#courseSelect").inputValue();
      if (selectedBefore !== "preview-yeunauan-course-a") throw new Error(`${browserName}/${viewportName}:deep-link`);
      await page.locator("#learningSiteBtn-yeubep").focus();
      if (await page.evaluate(() => document.activeElement?.id) !== "learningSiteBtn-yeubep") {
        throw new Error(`${browserName}/${viewportName}:keyboard-focus`);
      }
      await page.locator("#learningSiteBtn-yeubep").click();
      await page.waitForFunction(() => document.body.innerText.includes("preview-yeubep-course-a"));
      if (await page.locator("#courseSelect").inputValue()) throw new Error(`${browserName}/${viewportName}:course-not-cleared`);
      if (await page.evaluate(() => localStorage.getItem("lmsAdminLearningSite")) !== "yeubep") {
        throw new Error(`${browserName}/${viewportName}:storage`);
      }
      await page.screenshot({
        path: path.join(output, `${browserName}-${viewportName}-shop-yeunauan-live.png`),
        fullPage: true
      });
      results.push({
        browser: browserName, viewport: viewportName, selector: true, deepLink: true,
        siteSwitch: true, storage: true, focus: true, legacyWarning: true, pageErrors: errors
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// Required named screenshots from the real protected Chromium deployment.
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: viewports.desktop,
  extraHTTPHeaders: {
    "x-vercel-protection-bypass": bypass,
    "x-vercel-set-bypass-cookie": "true"
  }
});
await context.request.post(`${baseURL}/api/lms/admin?endpoint=preview-auth`, {
  headers: { "x-lms-preview-harness-secret": harness }
});
const page = await context.newPage();
await page.goto(`${baseURL}/lms-admin.html?site=yeunauan&course=preview-legacy-canonical`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !document.getElementById("learningSiteSelector")?.classList.contains("hidden"));
await page.screenshot({ path: path.join(output, "01-yeubep-shop.png"), fullPage: true });
await page.locator("#legacySharedNotice").screenshot({ path: path.join(output, "03-legacy-shared-warning.png") });
await page.locator("#tabBtn-students").click();
await page.screenshot({ path: path.join(output, "05-global-tab-badge.png"), fullPage: true });
await page.locator("#learningSiteBtn-yeubep").click();
await page.waitForFunction(() => document.body.innerText.includes("preview-yeubep-course-a"));
await page.screenshot({ path: path.join(output, "02-shop-yeunauan-live.png"), fullPage: true });

// UI-only empty-state rendering; API scope evidence remains covered separately by hosted HTTP tests.
await page.route("**/api/lms/admin?endpoint=courses", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, courses: [], config: {}, multiSiteEnabled: true, legacySharedMappings: [] })
  });
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(output, "04-empty-state-ui-only.png"), fullPage: true });
await context.close();
await browser.close();

fs.writeFileSync(path.join(output, "browser-matrix.json"), `${JSON.stringify(results, null, 2)}\n`, { flag: "w" });
console.log(JSON.stringify({ ok: true, cases: results.length, browsers: Object.keys(browsers), viewports: Object.keys(viewports), screenshotDir: output }));
