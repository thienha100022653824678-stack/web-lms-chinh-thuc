import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const pages = ["lms.html", "lesson.html"];
const css = readFileSync(join(ROOT, "vendor", "tailwind-static.css"), "utf8");

test("LMS pages load compiled Tailwind CSS without the JIT runtime", () => {
  for (const page of pages) {
    const html = readFileSync(join(ROOT, page), "utf8");
    assert.match(html, /<link rel="stylesheet" href="\/vendor\/tailwind-static\.css">/);
    assert.doesNotMatch(html, /vendor\/tailwind-jit\.js/);
    assert.doesNotMatch(html, /tailwind\.config\s*=/);
  }
});

test("compiled LMS CSS contains theme, responsive, state and dynamic-template utilities", () => {
  const requiredSelectors = [
    ".bg-brandGreen",
    ".text-brandBrown",
    ".font-serif",
    ".hidden",
    ".object-contain",
    ".scale-125",
    ".hover\\:bg-brandGreenLight:hover",
    ".disabled\\:opacity-40:disabled",
    ".sm\\:text-lg",
    ".lg\\:grid-cols-\\[300px_1fr\\]"
  ];
  for (const selector of requiredSelectors) {
    assert.ok(css.includes(selector), `missing compiled selector: ${selector}`);
  }
});

test("compiled LMS CSS stays materially smaller than the former JIT runtime", () => {
  const jitBytes = readFileSync(join(ROOT, "vendor", "tailwind-jit.js")).byteLength;
  const staticBytes = Buffer.byteLength(css);
  assert.ok(staticBytes < jitBytes / 5, `${staticBytes} CSS bytes is not at least 80% smaller than ${jitBytes} JIT bytes`);
});
