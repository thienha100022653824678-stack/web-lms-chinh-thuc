import crypto from "node:crypto";
import { supabase } from "../supabase.js";
import { getFixtureState } from "./fixtures.js";
import { apiError, applyFeedCursor, assertTransition, canonicalChecksum } from "./core.js";

export function fixtureMode() {
  return String(process.env.V5_FIXTURE_MODE || "") === "1";
}

export function assertV5RuntimeSafe() {
  if (String(process.env.V5_GLOBAL_KILL_SWITCH || "") === "1") throw apiError(503, "v5_disabled", "LMS V5 is disabled.");
}

export async function getEnabledChannel(courseSlug, identityKey = "") {
  assertV5RuntimeSafe();
  if (fixtureMode()) {
    const state = getFixtureState();
    const setting = state.settings.find((item) => item.course_slug === courseSlug && item.enabled && item.ui_version === "v5");
    if (!setting || !rolloutEligible(setting, identityKey)) throw apiError(404, "v5_not_enabled", "This course uses the B05 interface.");
    const channel = state.channels.find((item) => item.id === setting.channel_id && item.status === "active");
    if (!channel) throw apiError(404, "channel_not_found", "Channel not found.");
    return { ...channel, setting };
  }
  const { data: setting, error } = await supabase.from("lms_v5_channel_settings")
    .select("course_slug,channel_id,ui_version,enabled,rollout_percent,settings")
    .eq("course_slug", courseSlug).maybeSingle();
  if (error) throw apiError(503, "feature_flag_unavailable", "Feature flag service is unavailable.");
  if (!setting?.enabled || setting.ui_version !== "v5" || !setting.channel_id || !rolloutEligible(setting, identityKey)) throw apiError(404, "v5_not_enabled", "This course uses the B05 interface.");
  const { data: channel, error: channelError } = await supabase.from("lms_v5_channels").select("*").eq("id", setting.channel_id).eq("status", "active").maybeSingle();
  if (channelError) throw apiError(503, "channel_unavailable", "Channel service is unavailable.");
  if (!channel) throw apiError(404, "channel_not_found", "Channel not found.");
  return { ...channel, setting };
}

export async function listEnabledChannels(courseSlugs, identityKey = "") {
  if (fixtureMode()) {
    const state = getFixtureState();
    const eligible = state.settings.filter((setting) => setting.enabled && setting.ui_version === "v5" && rolloutEligible(setting, identityKey)).map((setting) => setting.course_slug);
    return state.channels.filter((channel) => courseSlugs.includes(channel.course_slug) && eligible.includes(channel.course_slug))
      .map((channel) => summarizeChannel(state, channel));
  }
  const { data: settings, error } = await supabase.from("lms_v5_channel_settings")
    .select("course_slug,channel_id,ui_version,enabled,rollout_percent,settings")
    .in("course_slug", courseSlugs).eq("enabled", true).eq("ui_version", "v5");
  if (error) throw apiError(503, "feature_flag_unavailable", "Feature flag service is unavailable.");
  if (!settings?.length) return [];
  const ids = settings.filter((item) => rolloutEligible(item, identityKey)).map((item) => item.channel_id);
  if (!ids.length) return [];
  const { data, error: channelsError } = await supabase.from("lms_v5_channels").select("*").in("id", ids).eq("status", "active");
  if (channelsError) throw apiError(503, "channel_unavailable", "Channel service is unavailable.");
  return data || [];
}

export function rolloutEligible(setting, identityKey = "") {
  const percent = Math.max(0, Math.min(100, Number(setting?.rollout_percent || 0)));
  if (percent >= 100) return true;
  if (percent <= 0 || !identityKey) return false;
  const digest = crypto.createHash("sha256").update(`${setting.course_slug}:${String(identityKey).trim().toLowerCase()}`).digest();
  return digest.readUInt32BE(0) % 100 < percent;
}

export async function listTopics(channelId) {
  if (fixtureMode()) return getFixtureState().topics.filter((item) => item.channel_id === channelId && item.status === "active").sort((a, b) => a.sort_order - b.sort_order);
  const { data, error } = await supabase.from("lms_v5_topics").select("*").eq("channel_id", channelId).eq("status", "active").order("sort_order");
  if (error) throw apiError(503, "topics_unavailable", "Topics are unavailable.");
  return data || [];
}

export async function listPosts(channelId, query) {
  if (fixtureMode()) {
    const posts = getFixtureState().posts.filter((post) => post.channel_id === channelId);
    return applyFeedCursor(posts, query);
  }
  const limit = Math.min(Number(query.limit || 24), 50);
  let request = supabase.from("lms_v5_posts")
    .select("*,lms_v5_post_media(*)")
    .eq("channel_id", channelId).eq("status", "published")
    .order("sequence_no", { ascending: false }).limit(limit);
  if (query.before_sequence) request = request.lt("sequence_no", Number(query.before_sequence));
  if (query.after_sequence) request = request.gt("sequence_no", Number(query.after_sequence));
  if (query.topic_id) request = request.eq("topic_id", query.topic_id);
  if (String(query.pinned || "") === "true") request = request.not("pinned_at", "is", null);
  if (query.search) request = request.ilike("body_text", `%${String(query.search).slice(0, 200)}%`);
  const { data, error } = await request;
  if (error) throw apiError(503, "feed_unavailable", "Feed is unavailable.");
  const rows = (data || []).map((row) => ({ ...row, media: (row.lms_v5_post_media || []).sort((a, b) => a.position - b.position), lms_v5_post_media: undefined }));
  return { rows, meta: { limit, next_before_sequence: rows.length === limit ? rows.at(-1)?.sequence_no : null, next_after_sequence: null } };
}

export async function findPublishedPost(postId) {
  if (fixtureMode()) {
    const post = getFixtureState().posts.find((item) => item.id === postId && item.status === "published");
    return post || null;
  }
  const { data, error } = await supabase.from("lms_v5_posts").select("*,lms_v5_channels(course_slug),lms_v5_post_media(*)").eq("id", postId).eq("status", "published").maybeSingle();
  if (error) throw apiError(503, "post_unavailable", "Post is unavailable.");
  return data ? { ...data, course_slug: data.lms_v5_channels?.course_slug, media: data.lms_v5_post_media || [] } : null;
}

export async function recordRead({ identity, post, completed = false, completionSource = null }) {
  const now = new Date().toISOString();
  if (fixtureMode()) {
    const state = getFixtureState();
    let row = state.reads.find((item) => item.email === identity.email && item.post_id === post.id);
    if (!row) {
      row = { id: crypto.randomUUID(), email: identity.email, student_id: identity.studentId, post_id: post.id, first_seen_at: now, created_at: now };
      state.reads.push(row);
    }
    row.last_seen_at = now;
    if (completed) {
      row.completed_at ||= now;
      row.progress_percent = 100;
      row.completion_source ||= completionSource;
    }
    row.updated_at = now;
    return row;
  }
  const payload = {
    email: identity.email, student_id: identity.studentId, post_id: post.id,
    first_seen_at: now, last_seen_at: now, updated_at: now,
    ...(completed ? { completed_at: now, progress_percent: 100, completion_source: completionSource } : {})
  };
  const { data, error } = await supabase.from("lms_v5_post_reads").upsert(payload, { onConflict: "email,post_id" }).select().single();
  if (error) throw apiError(503, "progress_unavailable", "Progress could not be saved.");
  return data;
}

export async function recordChannelRead({ identity, channelId, sequence, postId }) {
  const now = new Date().toISOString();
  if (fixtureMode()) {
    const state = getFixtureState();
    let row = state.readStates.find((item) => item.email === identity.email && item.channel_id === channelId);
    if (!row) { row = { id: crypto.randomUUID(), email: identity.email, channel_id: channelId }; state.readStates.push(row); }
    row.last_read_sequence = Math.max(Number(row.last_read_sequence || 0), sequence);
    row.last_read_post_id = postId || row.last_read_post_id || null;
    row.last_seen_at = now; row.updated_at = now;
    return row;
  }
  const payload = { email: identity.email, student_id: identity.studentId, channel_id: channelId, last_read_sequence: sequence, last_read_post_id: postId, last_seen_at: now, updated_at: now };
  const { data, error } = await supabase.from("lms_v5_channel_read_states").upsert(payload, { onConflict: "email,channel_id" }).select().single();
  if (error) throw apiError(503, "read_state_unavailable", "Read state could not be saved.");
  return data;
}

export async function adminChannels() {
  if (fixtureMode()) return getFixtureState().channels.map((channel) => summarizeChannel(getFixtureState(), channel));
  const { data, error } = await supabase.from("lms_v5_channels").select("*,lms_v5_channel_settings(*)").order("created_at");
  if (error) throw apiError(503, "channels_unavailable", "Channels are unavailable.");
  return data || [];
}

export async function adminPosts(courseSlug, query = {}) {
  const channel = await getChannelForAdmin(courseSlug);
  if (fixtureMode()) {
    const rows = getFixtureState().posts.filter((post) => post.channel_id === channel.id).sort((a, b) => b.sequence_no - a.sequence_no);
    return { channel, rows: rows.slice(0, Math.min(Number(query.limit || 50), 100)) };
  }
  const { data, error } = await supabase.from("lms_v5_posts").select("*,lms_v5_post_media(*)").eq("channel_id", channel.id).order("sequence_no", { ascending: false }).limit(100);
  if (error) throw apiError(503, "admin_feed_unavailable", "Admin feed is unavailable.");
  return { channel, rows: data || [] };
}

export async function createPost({ admin, input, idempotencyKey }) {
  if (fixtureMode()) return withFixtureIdempotency(`create`, idempotencyKey, input, () => {
    const state = getFixtureState();
    const channel = state.channels.find((item) => item.id === input.channel_id);
    if (!channel) throw apiError(404, "channel_not_found", "Channel not found.");
    const sequence = Math.max(0, ...state.posts.filter((item) => item.channel_id === channel.id).map((item) => item.sequence_no)) + 1;
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), channel_id: channel.id, topic_id: input.topic_id || null, post_type: input.post_type, body_text: input.body_text, body_json: {}, sequence_no: sequence, status: "draft", published_at: null, scheduled_at: input.scheduled_at || null, edited_at: null, pinned_at: null, author_admin_email: admin.email, reply_to_post_id: input.reply_to_post_id || null, created_at: now, updated_at: now, deleted_at: null, media: (input.media || []).map((item) => ({ ...item, id: crypto.randomUUID() })) };
    state.posts.push(row); auditFixture(state, "post.create", row.id, admin.email, { idempotencyKey }); return row;
  });
  throw apiError(501, "transaction_rpc_required", "Database post mutation requires the approved V5 transaction RPC.");
}

export async function mutatePost({ admin, postId, action, input = {}, idempotencyKey }) {
  if (!fixtureMode()) throw apiError(501, "transaction_rpc_required", "Database post mutation requires the approved V5 transaction RPC.");
  return withFixtureIdempotency(`${action}:${postId}`, idempotencyKey, input, () => {
    const state = getFixtureState();
    const post = state.posts.find((item) => item.id === postId);
    if (!post) throw apiError(404, "post_not_found", "Post not found.");
    const snapshot = structuredClone(post);
    if (["update", "publish", "schedule", "pin", "unpin", "archive", "restore", "delete", "hide"].includes(action)) {
      state.versions.push({ id: crypto.randomUUID(), post_id: post.id, version_no: state.versions.filter((item) => item.post_id === post.id).length + 1, body_snapshot: snapshot, media_snapshot: snapshot.media, changed_by: admin.email, changed_at: new Date().toISOString() });
    }
    if (action === "update") Object.assign(post, input, { edited_at: new Date().toISOString() });
    else if (action === "publish") transition(post, "published", { published_at: new Date().toISOString(), scheduled_at: null, deleted_at: null });
    else if (action === "schedule") transition(post, "scheduled", { scheduled_at: input.scheduled_at });
    else if (action === "pin") post.pinned_at = new Date().toISOString();
    else if (action === "unpin") post.pinned_at = null;
    else if (action === "archive") transition(post, "archived");
    else if (action === "hide") transition(post, "hidden");
    else if (action === "delete") transition(post, "deleted", { deleted_at: new Date().toISOString() });
    else if (action === "restore") transition(post, input.restore_status || "draft", { deleted_at: null, published_at: input.restore_status === "published" ? new Date().toISOString() : post.published_at });
    else if (action === "duplicate") {
      const duplicate = structuredClone(post); duplicate.id = crypto.randomUUID(); duplicate.sequence_no = Math.max(...state.posts.filter((item) => item.channel_id === post.channel_id).map((item) => item.sequence_no)) + 1; duplicate.status = "draft"; duplicate.published_at = null; duplicate.pinned_at = null; duplicate.deleted_at = null; duplicate.media = duplicate.media.map((item) => ({ ...item, id: crypto.randomUUID() })); state.posts.push(duplicate); auditFixture(state, "post.duplicate", duplicate.id, admin.email, { source: post.id }); return duplicate;
    } else throw apiError(404, "unknown_action", "Unknown post action.");
    post.updated_at = new Date().toISOString();
    auditFixture(state, `post.${action}`, post.id, admin.email, {});
    return post;
  });
}

export async function postVersions(postId) {
  if (fixtureMode()) return getFixtureState().versions.filter((item) => item.post_id === postId).sort((a, b) => b.version_no - a.version_no);
  const { data, error } = await supabase.from("lms_v5_post_versions").select("*").eq("post_id", postId).order("version_no", { ascending: false });
  if (error) throw apiError(503, "versions_unavailable", "Versions are unavailable.");
  return data || [];
}

export async function initUpload({ admin, input }) {
  const allowed = { image: 20 * 1024 * 1024, document: 50 * 1024 * 1024, video: 5 * 1024 * 1024 * 1024, audio: 250 * 1024 * 1024 };
  if (!allowed[input.media_type] || Number(input.file_size) < 1 || Number(input.file_size) > allowed[input.media_type]) throw apiError(422, "file_size_rejected", "File size is not allowed.");
  if (!fixtureMode()) throw apiError(503, "upload_provider_unconfigured", "Direct upload provider is not configured for this Preview.");
  const state = getFixtureState(); const now = new Date(); const row = { id: crypto.randomUUID(), admin_email: admin.email, provider: "fixture", declared_metadata: input, status: "initialized", created_at: now.toISOString(), updated_at: now.toISOString(), expires_at: new Date(now.valueOf() + 15 * 60_000).toISOString() };
  state.uploads.push(row);
  return { upload_id: row.id, provider: "fixture", direct_upload: true, upload_url: null, preview_only: true, expires_at: row.expires_at };
}

export async function finishUpload({ admin, uploadId, action, input }) {
  if (!fixtureMode()) throw apiError(503, "upload_provider_unconfigured", "Upload provider is not configured.");
  const row = getFixtureState().uploads.find((item) => item.id === uploadId && item.admin_email === admin.email);
  if (!row) throw apiError(404, "upload_not_found", "Upload session not found.");
  if (action === "cancel") { row.status = "cancelled"; return row; }
  if (row.status !== "initialized") throw apiError(409, "upload_state_conflict", "Upload is not completable.");
  row.status = "completed"; row.completed_at = new Date().toISOString(); row.verified_metadata = input; return row;
}

export function fixtureMigrationPreview() {
  const state = getFixtureState();
  return { dry_run: true, production_write: false, channels: state.channels.length, topics: state.topics.length, posts: state.posts.length, media: state.posts.reduce((sum, post) => sum + post.media.length, 0) };
}

async function getChannelForAdmin(courseSlug) {
  if (fixtureMode()) {
    const channel = getFixtureState().channels.find((item) => item.course_slug === courseSlug);
    if (!channel) throw apiError(404, "channel_not_found", "Channel not found.");
    return channel;
  }
  const { data, error } = await supabase.from("lms_v5_channels").select("*").eq("course_slug", courseSlug).maybeSingle();
  if (error) throw apiError(503, "channel_unavailable", "Channel is unavailable.");
  if (!data) throw apiError(404, "channel_not_found", "Channel not found.");
  return data;
}

function summarizeChannel(state, channel) {
  const latest = state.posts.filter((post) => post.channel_id === channel.id && post.status === "published").sort((a, b) => b.sequence_no - a.sequence_no)[0];
  return { ...channel, latest_post: latest ? { id: latest.id, body_text: latest.body_text, published_at: latest.published_at, pinned: Boolean(latest.pinned_at) } : null, unread_count: latest?.sequence_no || 0 };
}

function withFixtureIdempotency(scope, key, input, operation) {
  if (!key || String(key).length < 8) throw apiError(422, "idempotency_key_required", "A valid Idempotency-Key is required.");
  const state = getFixtureState(); const mapKey = `${scope}:${key}`; const hash = canonicalChecksum(input);
  const previous = state.idempotency.get(mapKey);
  if (previous && previous.hash !== hash) throw apiError(409, "idempotency_conflict", "Idempotency key was reused with a different request.");
  if (previous) return previous.result;
  const result = operation(); state.idempotency.set(mapKey, { hash, result }); return result;
}

function transition(post, target, patch = {}) {
  assertTransition(post.status, target); Object.assign(post, patch, { status: target });
}

function auditFixture(state, action, targetId, adminEmail, metadata) {
  state.audits.push({ id: crypto.randomUUID(), action, target_type: "post", target_id: targetId, admin_email: adminEmail, metadata, created_at: new Date().toISOString() });
}
