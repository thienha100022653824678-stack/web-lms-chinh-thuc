import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  getOrLoadLmsRecipeText,
  resetLmsContentCacheForTests
} from "../utils/lms-content-cache.js";

test.beforeEach(() => {
  resetLmsContentCacheForTests();
});

test("recipe cache shares course-data content with a later lesson request", async () => {
  let courseLoads = 0;
  let lessonLoads = 0;
  const url = "https://docs.google.com/document/d/shared-recipe";

  const fromCourse = await getOrLoadLmsRecipeText(url, async () => {
    courseLoads++;
    return "Nội dung công thức";
  });
  const fromLesson = await getOrLoadLmsRecipeText(url, async () => {
    lessonLoads++;
    return "Không được gọi";
  });

  assert.equal(fromCourse, "Nội dung công thức");
  assert.equal(fromLesson, "Nội dung công thức");
  assert.equal(courseLoads, 1);
  assert.equal(lessonLoads, 0);
});

test("recipe cache deduplicates concurrent Google content loads", async () => {
  let loads = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const loader = async () => {
    loads++;
    await pending;
    return "shared";
  };

  const first = getOrLoadLmsRecipeText("recipe-a", loader);
  const second = getOrLoadLmsRecipeText("recipe-a", loader);
  release();

  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  assert.equal(loads, 1);
});

test("failed recipe loads are not cached", async () => {
  let loads = 0;
  const loader = async () => {
    loads++;
    if (loads === 1) throw new Error("temporary failure");
    return "recovered";
  };

  await assert.rejects(
    getOrLoadLmsRecipeText("recipe-b", loader),
    /temporary failure/
  );
  assert.equal(await getOrLoadLmsRecipeText("recipe-b", loader), "recovered");
  assert.equal(loads, 2);
});

test("empty recipe results are not cached", async () => {
  let loads = 0;
  const loader = async () => {
    loads++;
    return loads === 1 ? "" : "available later";
  };

  assert.equal(await getOrLoadLmsRecipeText("recipe-c", loader), "");
  assert.equal(await getOrLoadLmsRecipeText("recipe-c", loader), "available later");
  assert.equal(loads, 2);
});

test("expired recipe content is refreshed", async () => {
  let loads = 0;
  const loader = async () => `version-${++loads}`;
  const key = "recipe-expiring";

  assert.equal(await getOrLoadLmsRecipeText(key, loader), "version-1");
  assert.equal(
    await getOrLoadLmsRecipeText(key, loader, { now: Date.now() + 60_001 }),
    "version-2"
  );
  assert.equal(loads, 2);
});

test("course-data and lesson handlers both use the shared recipe cache", () => {
  const courseSource = fs.readFileSync(
    new URL("../utils/lms-handlers/course-data.js", import.meta.url),
    "utf8"
  );
  const lessonSource = fs.readFileSync(
    new URL("../utils/lms-handlers/lesson.js", import.meta.url),
    "utf8"
  );

  for (const source of [courseSource, lessonSource]) {
    assert.match(source, /import \{ getOrLoadLmsRecipeText \} from "\.\.\/lms-content-cache\.js";/);
    assert.match(source, /return getOrLoadLmsRecipeText\(trimmed, async \(\) => \{/);
  }
});
