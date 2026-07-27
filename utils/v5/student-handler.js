import { applyCors } from "../cors.js";
import { supabase } from "../supabase.js";
import { requireEnrollment, requireStudentIdentity } from "./auth.js";
import { apiError, normalizeCourseSlug, parseCursor, parseLimit, requireUuid, sendError } from "./core.js";
import {
  findPublishedPost,
  getEnabledChannel,
  listEnabledChannels,
  listPosts,
  listTopics,
  recordChannelRead,
  recordRead
} from "./repository.js";

export default async function studentV5Handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "portal",
    methods: "GET, POST, OPTIONS",
    allowedHeaders: "Content-Type, Authorization, X-LMS-Session-Id, X-LMS-Device-Id"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const path = normalizePath(req.query?.path || pathFromUrl(req.url, "/api/v5/"));
    if (req.method === "GET" && path.length === 1 && path[0] === "channels") {
      const identity = await requireStudentIdentity(req);
      const enrollments = globalThis.__V5_ENROLLMENTS_STUB__ || await supabase.from("student_enrollments").select("course_slug,status").eq("email", identity.email);
      if (enrollments.error) throw apiError(503, "enrollment_unavailable", "Enrollment verification is unavailable.");
      const slugs = (enrollments.data || []).filter((item) => ["active", "approved", "paid", "granted"].includes(String(item.status || "").toLowerCase())).map((item) => normalizeCourseSlug(item.course_slug)).filter(Boolean);
      return ok(res, await listEnabledChannels(slugs, identity.email));
    }

    if (path[0] === "channels" && path[1]) {
      const slug = normalizeCourseSlug(path[1]);
      if (!slug) throw apiError(422, "invalid_course_slug", "Invalid course slug.");
      const identity = await requireStudentIdentity(req, slug);
      await requireEnrollment(identity, slug);
      const channel = await getEnabledChannel(slug, identity.email);

      if (req.method === "GET" && path.length === 2) return ok(res, channel);
      if (req.method === "GET" && path[2] === "topics") return ok(res, await listTopics(channel.id));
      if (req.method === "GET" && (path[2] === "posts" || path[2] === "search")) {
        rejectOffset(req.query);
        parseCursor(req.query?.before_sequence); parseCursor(req.query?.after_sequence); parseLimit(req.query?.limit);
        const query = { ...req.query, ...(path[2] === "search" ? { search: req.query?.q || req.query?.search } : {}) };
        const page = await listPosts(channel.id, query);
        return ok(res, page.rows, page.meta);
      }
      if (req.method === "POST" && path[2] === "read-state") {
        const sequence = parseCursor(req.body?.last_read_sequence);
        if (sequence === null) throw apiError(422, "invalid_read_sequence", "last_read_sequence is required.");
        const postId = req.body?.last_read_post_id ? requireUuid(req.body.last_read_post_id, "post_id") : null;
        return ok(res, await recordChannelRead({ identity, channelId: channel.id, sequence, postId }));
      }
    }

    if (path[0] === "posts" && path[1]) {
      const postId = requireUuid(path[1], "post_id");
      const post = await findPublishedPost(postId);
      if (!post) throw apiError(404, "post_not_found", "Post not found.");
      const courseSlug = post.course_slug || (await courseSlugForChannel(post.channel_id));
      const identity = await requireStudentIdentity(req, courseSlug);
      await requireEnrollment(identity, courseSlug);
      await getEnabledChannel(courseSlug, identity.email);
      if (req.method === "GET" && path.length === 2) return ok(res, post);
      if (req.method === "POST" && path[2] === "seen") return ok(res, await recordRead({ identity, post }));
      if (req.method === "POST" && path[2] === "complete") {
        const source = String(req.body?.completion_source || "manual_complete");
        if (!["manual_complete", "media_complete"].includes(source)) throw apiError(422, "invalid_completion_source", "Invalid completion source.");
        return ok(res, await recordRead({ identity, post, completed: true, completionSource: source }));
      }
    }
    throw apiError(404, "route_not_found", "V5 route not found.");
  } catch (error) {
    return sendError(res, error);
  }
}

async function courseSlugForChannel(channelId) {
  if (String(process.env.V5_FIXTURE_MODE || "") === "1") {
    const { getFixtureState } = await import("./fixtures.js");
    return getFixtureState().channels.find((item) => item.id === channelId)?.course_slug || "";
  }
  const { data, error } = await supabase.from("lms_v5_channels").select("course_slug").eq("id", channelId).maybeSingle();
  if (error) throw apiError(503, "channel_unavailable", "Channel is unavailable.");
  if (!data) throw apiError(404, "post_not_found", "Post not found.");
  return data.course_slug;
}

function normalizePath(value) {
  return (Array.isArray(value) ? value : String(value || "").split("/")).map((item) => decodeURIComponent(item)).filter(Boolean);
}

function pathFromUrl(url, prefix) {
  const pathname = String(url || "").split("?")[0];
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

function rejectOffset(query = {}) {
  if (query.offset !== undefined) throw apiError(422, "offset_not_supported", "Use sequence cursors instead of offset.");
}

function ok(res, data, meta) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ ok: true, data, ...(meta ? { meta } : {}) });
}
