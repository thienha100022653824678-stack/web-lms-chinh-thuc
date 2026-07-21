import test from "node:test";
import assert from "node:assert/strict";

import lessonHandler from "../utils/lms-handlers/lesson.js";
import {
  ALLOWED_METRICS,
  installLmsTimingResponseHooks,
  timeLmsAsync
} from "../utils/lms-server-timing.js";

function makeReq() {
  return {
    method: "GET",
    query: { id: "lesson-private-id" },
    headers: {
      "x-lms-session-id": "session-private-value",
      "x-lms-device-id": "device-private-value"
    }
  };
}

function makeRes({ throwServerTiming = false } = {}) {
  const headers = Object.create(null);
  return {
    headers,
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      if (throwServerTiming && String(name).toLowerCase() === "server-timing") {
        throw new Error("header generation failed");
      }
      headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    }
  };
}

function setSuccessfulLessonStubs() {
  globalThis.__RP2B1_LMS_SESSION_STUB__ = {
    ok: true,
    email: "student-private@example.test",
    courseSlug: "private-course-slug",
    session: {},
    studentSession: {},
    enrollment: { id: "enrollment-private-id", status: "active" }
  };
  globalThis.__RP2B1_LESSONS_STUB__ = {
    data: {
      id: "lesson-private-id",
      course_slug: "private-course-slug",
      lesson_no: 1,
      title: "Private lesson title",
      video_url: "",
      recipe_url: "",
      media_urls: "",
      materials: [],
      is_section: false,
      status: "active"
    },
    error: null
  };
  globalThis.__RP2B1_ENROLLMENTS_STUB__ = {
    data: [{ id: "enrollment-private-id", status: "active" }],
    error: null
  };
  globalThis.__RP2B1_SIBLING_LESSONS_STUB__ = {
    data: [{ id: "lesson-private-id", is_section: false }],
    error: null
  };
}

function clearStubs() {
  delete globalThis.__RP2B1_LMS_SESSION_STUB__;
  delete globalThis.__RP2B1_LESSONS_STUB__;
  delete globalThis.__RP2B1_ENROLLMENTS_STUB__;
  delete globalThis.__RP2B1_SIBLING_LESSONS_STUB__;
}

async function withTimingEnv(value, operation) {
  const previous = process.env.LMS_SERVER_TIMING;
  if (value === undefined) delete process.env.LMS_SERVER_TIMING;
  else process.env.LMS_SERVER_TIMING = value;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.LMS_SERVER_TIMING;
    else process.env.LMS_SERVER_TIMING = previous;
    clearStubs();
  }
}

function parseServerTiming(header) {
  return String(header || "").split(",").map((entry) => {
    const match = entry.trim().match(/^([a-z_]+);dur=(\d+(?:\.\d)?)$/);
    assert.ok(match, `invalid metric entry: ${entry}`);
    return { name: match[1], duration: Number(match[2]) };
  });
}

test("env off preserves lesson status/body and emits no timing headers", async () => {
  await withTimingEnv(undefined, async () => {
    setSuccessfulLessonStubs();
    const req = makeReq();
    const res = makeRes();
    await lessonHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.lesson.id, "lesson-private-id");
    assert.equal(res.headers["server-timing"], undefined);
    assert.equal(res.headers["x-lms-request-ordinal"], undefined);
    assert.equal(res.headers["x-lms-instance-age-ms"], undefined);
  });
});

test("env on emits only fixed finite non-negative metrics under 1 KB without PII", async () => {
  await withTimingEnv("1", async () => {
    setSuccessfulLessonStubs();
    const req = makeReq();
    const res = makeRes();
    await lessonHandler(req, res);

    const header = res.headers["server-timing"];
    assert.ok(header);
    assert.ok(Buffer.byteLength(header, "utf8") < 1024);
    const metrics = parseServerTiming(header);
    assert.deepEqual(metrics.map((metric) => metric.name), [...ALLOWED_METRICS]);
    for (const metric of metrics) {
      assert.ok(Number.isFinite(metric.duration));
      assert.ok(metric.duration >= 0);
    }
    for (const secret of [
      "student-private@example.test",
      "session-private-value",
      "device-private-value",
      "lesson-private-id",
      "private-course-slug",
      "Private lesson title"
    ]) {
      assert.equal(header.includes(secret), false);
    }
    assert.match(res.headers["x-lms-request-ordinal"], /^\d+$/);
    assert.match(res.headers["x-lms-instance-age-ms"], /^\d+$/);
  });
});

test("header generation works when the Node Buffer global is unavailable", async () => {
  await withTimingEnv("1", async () => {
    const originalBuffer = globalThis.Buffer;
    try {
      globalThis.Buffer = undefined;
      const req = {};
      const res = makeRes();
      installLmsTimingResponseHooks(req, res);
      res.json({ ok: true });
      assert.ok(res.headers["server-timing"]);
      assert.ok(res.headers["server-timing"].length < 1024);
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });
});

test("operation throw preserves the existing lesson error response", async () => {
  await withTimingEnv("1", async () => {
    setSuccessfulLessonStubs();
    globalThis.__RP2B1_LESSONS_STUB__ = { data: null, error: { message: "stubbed failure" } };
    const req = makeReq();
    const res = makeRes();
    await lessonHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, "Lỗi hệ thống khi tải bài học");
    assert.equal(res.body.detail, "stubbed failure");
    assert.ok(res.headers["server-timing"]);
  });
});

test("Server-Timing header failure does not replace status or body", async () => {
  await withTimingEnv("1", async () => {
    setSuccessfulLessonStubs();
    const req = makeReq();
    const res = makeRes({ throwServerTiming: true });
    await lessonHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.headers["server-timing"], undefined);
  });
});

test("request ordinal increases and instance age remains non-negative", async () => {
  await withTimingEnv("1", async () => {
    const firstReq = {};
    const firstRes = makeRes();
    installLmsTimingResponseHooks(firstReq, firstRes);
    firstRes.json({ ok: true });

    const secondReq = {};
    const secondRes = makeRes();
    installLmsTimingResponseHooks(secondReq, secondRes);
    secondRes.json({ ok: true });

    assert.equal(
      Number(secondRes.headers["x-lms-request-ordinal"]),
      Number(firstRes.headers["x-lms-request-ordinal"]) + 1
    );
    assert.ok(Number(firstRes.headers["x-lms-instance-age-ms"]) >= 0);
    assert.ok(Number(secondRes.headers["x-lms-instance-age-ms"]) >= 0);
  });
});

test("timed async rethrows the original operation error", async () => {
  await withTimingEnv("1", async () => {
    const req = {};
    const res = makeRes();
    const context = installLmsTimingResponseHooks(req, res);
    const original = new Error("original operation failure");
    await assert.rejects(
      timeLmsAsync(context, "lesson_lookup", async () => { throw original; }),
      (error) => error === original
    );
  });
});
