import { applyCors } from "../cors.js";
import { requireV5Admin } from "./auth.js";
import { apiError, normalizeCourseSlug, requireUuid, sendError, validatePostInput } from "./core.js";
import {
  adminChannels,
  adminPosts,
  createPost,
  finishUpload,
  fixtureMigrationPreview,
  initUpload,
  mutatePost,
  postVersions
} from "./repository.js";

export default async function adminV5Handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "admin",
    methods: "GET, POST, PATCH, DELETE, OPTIONS",
    allowedHeaders: "Content-Type, Authorization, Idempotency-Key"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const admin = requireV5Admin(req);
    const path = normalizePath(req.query?.path);

    if (req.method === "GET" && path.length === 1 && path[0] === "channels") return ok(res, await adminChannels());
    if (req.method === "GET" && path[0] === "channels" && path[1] && path[2] === "posts") {
      const slug = normalizeCourseSlug(path[1]);
      if (!slug) throw apiError(422, "invalid_course_slug", "Invalid course slug.");
      return ok(res, await adminPosts(slug, req.query));
    }
    if (req.method === "POST" && path.length === 1 && path[0] === "posts") {
      const input = validatePostInput(req.body);
      input.channel_id = requireUuid(req.body?.channel_id, "channel_id");
      return created(res, await createPost({ admin, input, idempotencyKey: idempotency(req) }));
    }
    if (path[0] === "posts" && path[1]) {
      const postId = requireUuid(path[1], "post_id");
      if (req.method === "GET" && path[2] === "versions") return ok(res, await postVersions(postId));
      if (req.method === "PATCH" && path.length === 2) {
        return ok(res, await mutatePost({ admin, postId, action: "update", input: validatePostInput(req.body, { partial: true }), idempotencyKey: idempotency(req) }));
      }
      if (req.method === "DELETE" && path.length === 2) {
        return ok(res, await mutatePost({ admin, postId, action: "delete", idempotencyKey: idempotency(req) }));
      }
      if (req.method === "POST" && path[2]) {
        const action = path[2];
        const allowed = ["publish", "schedule", "pin", "unpin", "archive", "restore", "duplicate", "hide"];
        if (!allowed.includes(action)) throw apiError(404, "route_not_found", "V5 admin route not found.");
        const input = action === "schedule"
          ? validatePostInput({ scheduled_at: req.body?.scheduled_at }, { partial: true })
          : action === "restore" ? { restore_status: req.body?.restore_status === "published" ? "published" : "draft" } : {};
        return ok(res, await mutatePost({ admin, postId, action, input, idempotencyKey: idempotency(req) }));
      }
    }
    if (req.method === "POST" && path[0] === "uploads" && path[1] === "init") {
      return created(res, await initUpload({ admin, input: req.body || {} }));
    }
    if (req.method === "POST" && path[0] === "uploads" && ["complete", "cancel"].includes(path[1])) {
      const uploadId = requireUuid(req.body?.upload_id, "upload_id");
      return ok(res, await finishUpload({ admin, uploadId, action: path[1], input: req.body || {} }));
    }
    if (req.method === "GET" && path[0] === "migration" && path[1] === "preview") return ok(res, fixtureMigrationPreview());
    throw apiError(404, "route_not_found", "V5 admin route not found.");
  } catch (error) {
    return sendError(res, error);
  }
}

function idempotency(req) {
  const value = String(req.headers?.["idempotency-key"] || "");
  if (value.length < 8 || value.length > 200) throw apiError(422, "idempotency_key_required", "Idempotency-Key must contain 8–200 characters.");
  return value;
}

function normalizePath(value) {
  return (Array.isArray(value) ? value : String(value || "").split("/")).map((item) => decodeURIComponent(item)).filter(Boolean);
}

function ok(res, data) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ ok: true, data });
}

function created(res, data) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(201).json({ ok: true, data });
}

