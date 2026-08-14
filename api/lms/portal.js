import courseDataHandler from "../../utils/lms-handlers/course-data.js";
import lessonHandler from "../../utils/lms-handlers/lesson.js";
import publicConfigHandler from "../../utils/lms-handlers/public-config.js";
import publicLessonHandler from "../../utils/lms-handlers/public-lesson.js";
import verifyEntryTokenHandler from "../../utils/lms-handlers/verify-entry-token.js";
import logoutHandler from "../../utils/lms-handlers/logout.js";
import v3BootstrapHandler from "../../utils/lms-handlers/v3-bootstrap.js";
import v3AdminPreviewLearnerHandler from "../../utils/lms-handlers/v3-admin-preview-learner.js";
import { warmRuntimeConfig } from "../../utils/v2-runtime-controller.js";
import {
  getOrCreateLmsServerTiming,
  timeLmsAsync
} from "../../utils/lms-server-timing.js";

function isAdminV3PreviewRequest(req) {
  if (String(process.env.VERCEL_ENV || "").toLowerCase() === "production") return false;
  const referer = String(req.headers?.referer || req.headers?.referrer || "");
  return /[?&]admin_preview=1(?:&|#|$)/i.test(referer);
}

export default async function handler(req, res) {
  const { endpoint } = req.query || {};
  const timing = endpoint === "lesson" ? getOrCreateLmsServerTiming(req) : null;
  // Warm the V1/V2 runtime master switch once per request so the
  // synchronous behavioral gate (isV2ActiveCached) is populated for every
  // downstream handler in this invocation. Fail-open on cold cache; the
  // warm is best-effort and never throws. See utils/v2-runtime-controller.js.
  await timeLmsAsync(timing, "runtime", () => warmRuntimeConfig());

  // Preview-only learner visual test. The browser must already have a valid
  // Admin session on the same Preview origin, and the page URL must contain
  // admin_preview=1. Production never enters this branch.
  if (isAdminV3PreviewRequest(req) && endpoint === "v3-bootstrap") {
    return v3AdminPreviewLearnerHandler(req, res, { kind: "bootstrap" });
  }
  if (isAdminV3PreviewRequest(req) && endpoint === "course-data") {
    return v3AdminPreviewLearnerHandler(req, res, { kind: "course" });
  }

  if (endpoint === "course-data") {
    return courseDataHandler(req, res);
  }
  if (endpoint === "lesson") {
    return lessonHandler(req, res);
  }
  if (endpoint === "public-config") {
    return publicConfigHandler(req, res);
  }
  if (endpoint === "public-lesson") {
    return publicLessonHandler(req, res);
  }
  if (endpoint === "verify-entry-token") {
    return verifyEntryTokenHandler(req, res);
  }
  if (endpoint === "logout") {
    return logoutHandler(req, res);
  }
  if (endpoint === "v3-bootstrap") {
    return v3BootstrapHandler(req, res);
  }

  return res.status(404).json({ success: false, error: "LMS Portal Endpoint not found" });
}

export const _internals = { isAdminV3PreviewRequest };
