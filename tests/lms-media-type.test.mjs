import test from "node:test";
import assert from "node:assert/strict";
import { classifyMediaType, resolveMainMediaInfo } from "../utils/lms-media.js";

test("classifies common phone and web image formats from the Drive file name", () => {
  for (const name of ["photo.HEIC", "photo.heif", "photo.avif", "photo.jfif", "scan.tiff"]) {
    assert.equal(classifyMediaType({ name }), "image", name);
  }
});

test("Drive metadata file name resolves an opaque Drive URL as an image", async () => {
  const result = await resolveMainMediaInfo(
    "https://drive.google.com/uc?export=download&id=image-file-id",
    async () => ({
      name: "Cach dong goi hut chan khong.jpg",
      mimeType: "application/octet-stream"
    })
  );

  assert.equal(result.mainMediaType, "image");
  assert.equal(result.mainMediaName, "Cach dong goi hut chan khong.jpg");
});
