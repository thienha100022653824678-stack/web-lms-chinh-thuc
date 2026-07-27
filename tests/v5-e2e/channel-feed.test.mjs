import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const root = join(process.cwd(), "dist-v5");
let server;
let browser;
let baseUrl;

before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const requested = pathname === "/" ? "/v5.html" : pathname;
    const target = normalize(join(root, requested));
    if (!target.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
    try {
      await stat(target);
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain" };
      res.setHeader("Content-Type", types[extname(target)] || "application/octet-stream");
      res.end(await readFile(target));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

test("student lists three fixture channels and opens a channel", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/v5.html`);
  assert.equal(await page.locator(".channel-row").count(), 3);
  await page.getByText("LMS • Lớp nền tảng", { exact: true }).click();
  await page.locator(".post-card").first().waitFor();
  assert.equal(await page.locator(".post-card").count(), 4);
  await page.close();
});

test("student album opens fullscreen and completion toggles", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${baseUrl}/v5.html`);
  await page.getByText("LMS • Lớp nền tảng", { exact: true }).click();
  await page.locator(".media-grid button").first().click();
  assert.equal(await page.locator(".lightbox").count(), 1);
  await page.locator(".lightbox > button").click();
  const complete = page.getByText("Đánh dấu hoàn thành").first();
  await complete.click();
  await page.getByText("Đã hoàn thành").first().waitFor();
  await page.close();
});

test("large channel renders only initial 24-post window", async () => {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/v5.html`);
  await page.getByText("LMS • Phòng thực hành", { exact: true }).click();
  assert.equal(await page.locator(".post-card").count(), 24);
  assert.equal(await page.locator("video").count(), 0);
  await page.close();
});

test("admin composer publishes and previews fixture post", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/v5-admin.html`);
  await page.getByLabel("Nội dung bài viết").fill("Bài E2E mới");
  await page.getByText("Xem trước", { exact: true }).click();
  await page.getByText("Xem trước giao diện học viên").waitFor();
  await page.getByText("Đóng xem trước").click();
  const beforeCount = await page.locator(".post-card").count();
  await page.getByText("Đăng ngay", { exact: true }).click();
  assert.equal(await page.locator(".post-card").count(), beforeCount + 1);
  await page.getByText("Đã đăng bài trong fixture Preview.").waitFor();
  await page.close();
});

test("admin composer remains visible at desktop viewport bottom", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/v5-admin.html`);
  const box = await page.locator(".composer").boundingBox();
  assert.ok(box);
  assert.ok(box.y + box.height <= 901);
  await page.close();
});
