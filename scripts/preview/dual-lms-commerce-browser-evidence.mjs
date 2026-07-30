import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const password = process.env.COMMERCE_PREVIEW_ADMIN_PASSWORD;
const deployments = [
  {
    label: "shop.yeunauan.live",
    tenant: "yeunauan",
    url: process.env.COMMERCE_MAIN_PREVIEW_URL,
    bypass: process.env.COMMERCE_MAIN_BYPASS,
    screenshot: "08-commerce-target-dropdown-shop-yeunauan-live.png",
    crossTarget: "yeubep-demo"
  },
  {
    label: "yeubep.shop",
    tenant: "yeubep",
    url: process.env.COMMERCE_SECOND_PREVIEW_URL,
    bypass: process.env.COMMERCE_SECOND_BYPASS,
    screenshot: "09-commerce-target-dropdown-yeubep-shop.png",
    crossTarget: "legacy-demo"
  }
];
if (!password || deployments.some((item) => !item.url || !item.bypass)) {
  throw new Error("COMMERCE_BROWSER_EVIDENCE_ENV_REQUIRED");
}

const output = path.resolve("docs/dual-lms/evidence/screenshots");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
let rejection = null;
try {
  for (const deployment of deployments) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: {
        "x-vercel-protection-bypass": deployment.bypass,
        "x-vercel-set-bypass-cookie": "true"
      }
    });
    await context.addInitScript((value) => sessionStorage.setItem("admin_password", value), password);
    const page = await context.newPage();
    await page.goto(`${deployment.url}/admin.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.getElementById("dashboardContent")?.classList.contains("hidden"));
    await page.waitForFunction((tenant) => {
      const opposite = document.querySelector(`input[name="salesSite"]:not([value="${tenant}"])`);
      return opposite?.disabled === true;
    }, deployment.tenant);
    await page.getByRole("button", { name: /Thêm Khóa Học Mới/i }).click();
    await page.waitForFunction(() => !document.getElementById("courseModal")?.classList.contains("hidden"));
    const selected = await page.locator('input[name="salesSite"]:checked').inputValue();
    const oppositeDisabled = await page.locator(`input[name="salesSite"]:not([value="${deployment.tenant}"])`).isDisabled();
    const options = await page.locator("#learningCourseSlugInput option").evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, text: node.textContent }))
    );
    if (selected !== deployment.tenant || !oppositeDisabled) {
      throw new Error(`STOREFRONT_BINDING_${deployment.tenant}_${selected}_${oppositeDisabled}`);
    }
    await page.locator("#learningCourseSlugInput").focus();
    await page.screenshot({ path: path.join(output, deployment.screenshot), fullPage: true });

    const forged = await context.request.post(`${deployment.url}/api/courses`, {
      headers: {
        "x-admin-password": password,
        "content-type": "application/json"
      },
      data: {
        slug: `screenshot-forged-${deployment.tenant}-${Date.now()}`,
        title: "Sanitized forged target probe",
        sales_site: deployment.tenant,
        learning_course_slug: deployment.crossTarget
      }
    });
    const payload = await forged.json();
    if (forged.status() !== 409 || payload.code !== "CROSS_LMS_TARGET_FORBIDDEN") {
      throw new Error(`FORGED_TARGET_${deployment.tenant}`);
    }
    rejection ||= { storefront: deployment.label, status: forged.status(), code: payload.code };
    results.push({ storefront: deployment.label, tenant: deployment.tenant, selected, oppositeDisabled, options });
    await context.close();
  }
} finally {
  await browser.close();
}

const evidenceBrowser = await chromium.launch({ headless: true });
const evidencePage = await evidenceBrowser.newPage({ viewport: { width: 1000, height: 600 } });
await evidencePage.setContent(`<!doctype html><html><body style="font-family:system-ui;background:#f8fafc;padding:48px">
  <main style="max-width:760px;margin:auto;background:white;border:1px solid #cbd5e1;border-radius:20px;padding:32px">
    <p style="font-weight:800;color:#64748b">PROTECTED PREVIEW — SANITIZED NEGATIVE PROBE</p>
    <h1>Forged cross-LMS target rejected</h1>
    <dl><dt>Status</dt><dd>${rejection.status}</dd><dt>Error contract</dt><dd><code>${rejection.code}</code></dd></dl>
    <p>No Production database, order, enrollment, customer identity or Google Drive credential was used.</p>
  </main></body></html>`);
await evidencePage.screenshot({ path: path.join(output, "10-forged-cross-lms-rejection.png"), fullPage: true });
await evidenceBrowser.close();

fs.writeFileSync(
  path.join(output, "commerce-browser-evidence.json"),
  `${JSON.stringify({ cases: results, rejection }, null, 2)}\n`
);
console.log(JSON.stringify({ ok: true, storefronts: results.length, output }));
