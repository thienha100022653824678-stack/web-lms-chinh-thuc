import crypto from "node:crypto";

export const POST_STATUSES = Object.freeze(["draft", "scheduled", "published", "hidden", "archived", "deleted"]);
export const POST_TYPES = Object.freeze(["text", "image", "image_album", "video", "audio", "document", "lesson", "announcement", "topic_header"]);
export const TRANSITIONS = Object.freeze({
  draft: ["scheduled", "published", "deleted"],
  scheduled: ["draft", "published", "archived", "deleted"],
  published: ["hidden", "archived", "deleted"],
  hidden: ["published", "archived", "deleted"],
  archived: ["draft", "published", "deleted"],
  deleted: ["draft", "published"]
});

export function normalizeCourseSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]+(?:[a-z0-9_-]{0,158}[a-z0-9])?$/.test(slug) ? slug : "";
}

export function parseUuid(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text) ? text : "";
}

export function parseCursor(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw apiError(422, "invalid_cursor", "Cursor must be a positive sequence number.");
  const result = Number(text);
  if (!Number.isSafeInteger(result)) throw apiError(422, "invalid_cursor", "Cursor is outside the safe range.");
  return result;
}

export function parseLimit(value, fallback = 24) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 50) {
    throw apiError(422, "invalid_limit", "Limit must be an integer from 1 to 50.");
  }
  return result;
}

export function sanitizeText(value, max = 20000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

export function validatePostInput(input = {}, { partial = false } = {}) {
  const output = {};
  if (!partial || input.post_type !== undefined) {
    if (!POST_TYPES.includes(input.post_type)) throw apiError(422, "invalid_post_type", "Unsupported post type.");
    output.post_type = input.post_type;
  }
  if (!partial || input.body_text !== undefined) output.body_text = sanitizeText(input.body_text);
  if (input.topic_id !== undefined) output.topic_id = input.topic_id === null ? null : requireUuid(input.topic_id, "topic_id");
  if (input.reply_to_post_id !== undefined) output.reply_to_post_id = input.reply_to_post_id === null ? null : requireUuid(input.reply_to_post_id, "reply_to_post_id");
  if (input.scheduled_at !== undefined) {
    const date = input.scheduled_at ? new Date(input.scheduled_at) : null;
    if (date && Number.isNaN(date.valueOf())) throw apiError(422, "invalid_schedule", "Invalid scheduled_at.");
    output.scheduled_at = date?.toISOString() || null;
  }
  if (input.media !== undefined) {
    if (!Array.isArray(input.media) || input.media.length > 20) throw apiError(422, "invalid_media", "Media must contain at most 20 items.");
    output.media = input.media.map((item, position) => validateMedia(item, position));
  }
  return output;
}

export function validateMedia(item = {}, position = 0) {
  const allowedTypes = ["image", "video", "audio", "document", "thumbnail"];
  if (!allowedTypes.includes(item.media_type)) throw apiError(422, "invalid_media_type", "Unsupported media type.");
  const url = String(item.url || "").trim();
  if (url && !/^https:\/\/[^\s]+$/i.test(url) && !url.startsWith("/fixtures/")) {
    throw apiError(422, "invalid_media_url", "Media URL must be HTTPS.");
  }
  return {
    id: parseUuid(item.id) || undefined,
    position,
    media_type: item.media_type,
    provider: String(item.provider || "fixture").toLowerCase(),
    provider_asset_id: sanitizeText(item.provider_asset_id, 500) || null,
    url,
    thumbnail_url: String(item.thumbnail_url || "").trim() || null,
    mime_type: String(item.mime_type || "").toLowerCase().slice(0, 200) || null,
    file_name: sanitizeText(item.file_name, 500) || null,
    file_size: item.file_size == null ? null : requireNonNegativeNumber(item.file_size, "file_size"),
    width: item.width == null ? null : requirePositiveInteger(item.width, "width"),
    height: item.height == null ? null : requirePositiveInteger(item.height, "height"),
    duration_seconds: item.duration_seconds == null ? null : requireNonNegativeNumber(item.duration_seconds, "duration_seconds"),
    caption: sanitizeText(item.caption, 4000),
    metadata: isPlainObject(item.metadata) ? item.metadata : {}
  };
}

export function assertTransition(from, to) {
  if (!POST_STATUSES.includes(from) || !POST_STATUSES.includes(to) || !TRANSITIONS[from]?.includes(to)) {
    throw apiError(409, "invalid_status_transition", `Cannot transition from ${from} to ${to}.`);
  }
  return true;
}

export function applyFeedCursor(posts, query = {}) {
  if (query.offset !== undefined) throw apiError(422, "offset_not_supported", "Use sequence cursors instead of offset.");
  const before = parseCursor(query.before_sequence);
  const after = parseCursor(query.after_sequence);
  if (before !== null && after !== null) throw apiError(422, "ambiguous_cursor", "Use before_sequence or after_sequence, not both.");
  const limit = parseLimit(query.limit);
  let rows = posts.filter((post) => post.status === "published");
  if (query.topic_id) rows = rows.filter((post) => post.topic_id === query.topic_id);
  if (String(query.pinned || "") === "true") rows = rows.filter((post) => Boolean(post.pinned_at));
  if (query.search) {
    const needle = sanitizeText(query.search, 200).toLocaleLowerCase("vi");
    rows = rows.filter((post) => String(post.body_text || "").toLocaleLowerCase("vi").includes(needle));
  }
  if (before !== null) rows = rows.filter((post) => post.sequence_no < before);
  if (after !== null) rows = rows.filter((post) => post.sequence_no > after);
  rows.sort((a, b) => after !== null ? a.sequence_no - b.sequence_no : b.sequence_no - a.sequence_no);
  const page = rows.slice(0, limit);
  return {
    rows: page,
    meta: {
      limit,
      next_before_sequence: page.length === limit ? Math.min(...page.map((p) => p.sequence_no)) : null,
      next_after_sequence: page.length === limit ? Math.max(...page.map((p) => p.sequence_no)) : null
    }
  };
}

export function canonicalChecksum(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function apiError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

export function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || "internal_error";
  const message = status >= 500 ? "V5 service is temporarily unavailable." : String(error?.message || "Request failed.");
  return res.status(status).json({ ok: false, error: { code, message, ...(error?.details !== undefined ? { details: error.details } : {}) } });
}

export function requireUuid(value, field) {
  const parsed = parseUuid(value);
  if (!parsed) throw apiError(422, `invalid_${field}`, `${field} must be a UUID.`);
  return parsed;
}

function requirePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw apiError(422, `invalid_${field}`, `${field} must be positive.`);
  return number;
}

function requireNonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw apiError(422, `invalid_${field}`, `${field} must not be negative.`);
  return number;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

