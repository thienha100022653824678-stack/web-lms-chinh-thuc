import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "lesson.html"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} body is incomplete`);
}

test("main Google Drive video opens the dedicated player on the first Play tap", () => {
  const playMainVideo = functionSource("playMainVideo");
  const driveBranch = playMainVideo.indexOf('videoUrl.includes("drive.google.com")');
  const directOpen = playMainVideo.indexOf("openGoogleDrivePlayer(playerUrl, returnUrl)");
  const iframeFallback = playMainVideo.indexOf("videoWrapper.innerHTML = getIframePlayerHtml(videoUrl)");

  assert.ok(driveBranch >= 0, "main Play handler must identify Drive videos");
  assert.ok(directOpen > driveBranch, "Drive branch must open the dedicated player");
  assert.ok(
    iframeFallback > directOpen,
    "Drive navigation must happen before the iframe fallback can replace the thumbnail"
  );
  assert.match(
    playMainVideo.slice(directOpen, iframeFallback),
    /return;/,
    "Drive branch must stop before rendering a second Play placeholder"
  );
});

test("hard-load and SPA lesson renderers share the one-tap Play handler", () => {
  const callSites = source.match(
    /\.onclick = \(\) => playMainVideo\(videoWrapper, currentLesson, studentEmail\);/g
  ) || [];

  assert.equal(callSites.length, 2);
});

test("main media classification uses the Drive file name before its opaque URL", () => {
  const context = { URL };
  vm.runInNewContext(
    [
      functionSource("extractIframeSrc"),
      functionSource("inferMainMediaTypeFromText"),
      functionSource("getExplicitMainMediaType"),
      functionSource("getMainMediaType"),
      "this.getMainMediaType = getMainMediaType;"
    ].join("\n"),
    context
  );

  const driveUrl = "https://drive.google.com/uc?export=download&id=opaque-file-id";
  assert.equal(context.getMainMediaType({
    mainMediaType: "unknown",
    mainMediaName: "Cach dong goi hut chan khong.jpg",
    videoUrl: driveUrl
  }), "image");
  assert.equal(context.getMainMediaType({
    mainMediaType: "unknown",
    mainMediaName: "Huong dan dong goi.mp4",
    videoUrl: driveUrl
  }), "video");
  assert.equal(context.getMainMediaType({
    mainMediaType: "video",
    videoUrl: `${driveUrl}&lms_media_type=image&lms_media_name=photo.jpg`
  }), "image");
});

test("main upload persists explicit media type and original file name in its Drive URL", () => {
  const adminSource = readFileSync(join(ROOT, "lms-admin.html"), "utf8");
  assert.match(adminSource, /uploadMime\.startsWith\("image\/"\) \? "image" : "video"/);
  assert.match(adminSource, /&lms_media_type=\$\{uploadedMediaType\}/);
  assert.match(adminSource, /&lms_media_name=\$\{encodeURIComponent\(file\.name\)\}/);
});
