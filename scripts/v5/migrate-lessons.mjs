#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function checksum(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function parseLooseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; } catch { return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean); }
  }
  return [value];
}

export function mapLessons(source, { batchId = crypto.randomUUID() } = {}) {
  const lessons = Array.isArray(source) ? source : source.lessons || [];
  const courses = new Map();
  const duplicates = [];
  const missingMedia = [];
  const captionMappings = [];
  const seenIds = new Set();

  for (const raw of lessons) {
    const courseSlug = String(raw.course_slug || "").trim().toLowerCase();
    if (!courseSlug) continue;
    if (!courses.has(courseSlug)) courses.set(courseSlug, { channel: { course_slug: courseSlug, display_title: String(raw.course_title || courseSlug), status: "active" }, topics: [], posts: [] });
    const group = courses.get(courseSlug);
    const sourceId = String(raw.id || "").trim();
    if (sourceId && seenIds.has(sourceId)) { duplicates.push(sourceId); continue; }
    if (sourceId) seenIds.add(sourceId);

    const number = Number(raw.lesson_no || group.posts.length + 1);
    if (raw.is_section) {
      const topic = { source_lesson_id: sourceId || null, title: String(raw.title || `Chủ đề ${number}`), sort_order: number, status: "active" };
      group.topics.push(topic);
      group.posts.push(makePost(raw, { batchId, sequence: number, type: "topic_header", topicKey: sourceId || `section-${number}` }));
      continue;
    }
    const currentTopic = group.topics.at(-1);
    const post = makePost(raw, { batchId, sequence: number, type: "lesson", topicKey: currentTopic?.source_lesson_id || null });
    const mainUrl = String(raw.video_url || raw.image_url || "").trim();
    if (mainUrl) post.media.push(mediaFrom(mainUrl, 0, raw.main_media_caption || raw.caption || "", raw));
    const supplemental = parseLooseArray(raw.media_urls || raw.supplemental_media);
    supplemental.forEach((item, index) => {
      const normalized = typeof item === "string" ? { url: item } : item;
      if (!normalized?.url) { missingMedia.push({ source_lesson_id: sourceId, position: index + 1 }); return; }
      post.media.push(mediaFrom(normalized.url, post.media.length, normalized.caption || "", normalized));
      captionMappings.push({ source_lesson_id: sourceId, position: post.media.length - 1, caption: String(normalized.caption || "") });
    });
    parseLooseArray(raw.materials).forEach((item) => {
      const normalized = typeof item === "string" ? { url: item, name: basename(item) } : item;
      if (!normalized?.url) { missingMedia.push({ source_lesson_id: sourceId, material: true }); return; }
      post.media.push({ position: post.media.length, media_type: "document", provider: provider(normalized.url), url: normalized.url, file_name: normalized.name || normalized.file_name || "Tài liệu", caption: normalized.caption || "", metadata: { migrated: true } });
    });
    group.posts.push(post);
  }

  const output = { migration_batch_id: batchId, dry_run: true, generated_at: "deterministic-at-execution", courses: [...courses.values()] };
  const report = {
    batch_id: batchId,
    input_lessons: lessons.length,
    mapped_courses: output.courses.length,
    mapped_topics: output.courses.reduce((sum, item) => sum + item.topics.length, 0),
    mapped_posts: output.courses.reduce((sum, item) => sum + item.posts.length, 0),
    mapped_media: output.courses.reduce((sum, item) => sum + item.posts.reduce((n, post) => n + post.media.length, 0), 0),
    duplicates,
    missing_media: missingMedia,
    caption_mapping: captionMappings,
    output_checksum: checksum(output.courses)
  };
  return { output, report };
}

function makePost(raw, { batchId, sequence, type, topicKey }) {
  const canonical = {
    id: raw.id || null, course_slug: raw.course_slug, lesson_no: raw.lesson_no,
    title: raw.title || "", content: raw.content || raw.description || "",
    video_url: raw.video_url || "", image_url: raw.image_url || "",
    media_urls: raw.media_urls || [], materials: raw.materials || []
  };
  return {
    post_type: type,
    body_text: [raw.title, raw.content || raw.description].filter(Boolean).join("\n\n"),
    body_json: { title: raw.title || "", migrated: true },
    sequence_no: sequence,
    status: "draft",
    topic_source_key: topicKey,
    source_lesson_id: raw.id || null,
    migration_batch_id: batchId,
    source_checksum: checksum(canonical),
    media: []
  };
}

function mediaFrom(url, position, caption, raw) {
  const text = String(url);
  const mediaType = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(text) ? "image" : "video";
  return { position, media_type: mediaType, provider: provider(text), url: text, thumbnail_url: raw.thumbnail_url || null, mime_type: raw.mime_type || null, caption: String(caption || ""), metadata: { migrated: true } };
}

function provider(url) {
  if (/drive\.google\.com|googleusercontent\.com/i.test(url)) return "google_drive";
  if (/cloudinary\.com/i.test(url)) return "cloudinary";
  if (/bunny|iframe\.mediadelivery/i.test(url)) return "bunny";
  return "external";
}

function parseArgs(argv) {
  const result = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") result.dryRun = true;
    else if (argv[i].startsWith("--")) result[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv);
  if (!args.dryRun || !args.input || !args.output || !args.report) {
    console.error("Usage: node scripts/v5/migrate-lessons.mjs --dry-run --input lessons.json --output mapped.json --report report.json [--batch-id UUID]");
    process.exit(2);
  }
  const source = JSON.parse(await readFile(resolve(args.input), "utf8"));
  const mapped = mapLessons(source, { batchId: args.batchId || crypto.randomUUID() });
  await writeFile(resolve(args.output), `${JSON.stringify(mapped.output, null, 2)}\n`, { flag: "wx" });
  await writeFile(resolve(args.report), `${JSON.stringify(mapped.report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(mapped.report));
}
