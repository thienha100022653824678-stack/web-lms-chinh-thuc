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

test("explicit upload marker is authoritative when Drive metadata is unavailable", async () => {
  const result = await resolveMainMediaInfo(
    "https://drive.google.com/uc?export=download&id=image-file-id&lms_media_type=image&lms_media_name=photo.jpg",
    async () => {
      throw new Error("Drive metadata permission denied");
    }
  );

  assert.equal(result.mainMediaType, "image");
});

test("uploaded file name can classify media even without an explicit type marker", () => {
  assert.equal(classifyMediaType({
    url: "https://drive.google.com/uc?export=download&id=file-id&lms_media_name=photo.HEIC"
  }), "image");
});
