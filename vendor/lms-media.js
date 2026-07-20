// ─────────────────────────────────────────────────────────────────────────────
// /vendor/lms-media.js — CANONICAL mediaUrls parser for the whole LMS.
//
// Single source of truth for parsing the `mediaUrls` wire format:
//   "type|title|url|captionEncoded\n..."  (4-field; caption field optional)
//
// Loaded as a classic <script> (NOT a module) by every page that consumes
// mediaUrls, so the top-level function declarations below become browser
// globals: parseMediaUrls, parseMediaLine, decodeMediaCaption, encodeMediaCaption.
//
// DO NOT duplicate this parser inside lesson.html / photo.html / lms.html /
// index.html / lms-admin.html. Those pages must call the globals from this file.
//
// The previous state had 5 divergent copies (3-field in lesson.html/photo.html
// which swallowed "|<caption>" into the url field and broke captioned images;
// 4-field in lms.html/index.html/lms-admin.html). This file is the only parser.
// See docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md.
// ─────────────────────────────────────────────────────────────────────────────

// Max caption length, applied on both encode (admin write) and decode (read).
var LMS_MEDIA_CAPTION_MAX_LENGTH = 250;

// Decode a URL-encoded caption. Tolerates already-decoded input (returns raw
// on decodeURIComponent failure) so legacy/malformed data does not throw.
function decodeMediaCaption(value) {
  var raw = String(value == null ? "" : value);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

// Encode a caption for the 4th pipe-field. Trims + slices to the max length,
// then encodeURIComponent. Empty caption → "" (no 4th field emitted).
function encodeMediaCaption(value) {
  return encodeURIComponent(String(value == null ? "" : value).trim().slice(0, LMS_MEDIA_CAPTION_MAX_LENGTH));
}

// Parse ONE mediaUrls line into { type, title, url, caption } or null.
// 4-field aware: url is the slice between the 2nd and 3rd pipe (or to end if
// no 3rd pipe). caption (if present) is the decoded 4th field, sliced to the
// max length. Returns null when type or url is missing.
//
// This is the single core used by both parseMediaUrls (array) and the admin's
// parseMediaLineForAdmin (single-line). No other parser exists in the codebase.
function parseMediaLine(line) {
  var trimmed = String(line == null ? "" : line).trim();
  if (!trimmed) return null;
  var firstPipe = trimmed.indexOf("|");
  if (firstPipe === -1) return null;
  var secondPipe = trimmed.indexOf("|", firstPipe + 1);
  if (secondPipe === -1) return null;
  var thirdPipe = trimmed.indexOf("|", secondPipe + 1);
  var type = trimmed.slice(0, firstPipe).trim();
  var title = trimmed.slice(firstPipe + 1, secondPipe).trim();
  var url = (thirdPipe === -1 ? trimmed.slice(secondPipe + 1) : trimmed.slice(secondPipe + 1, thirdPipe)).trim();
  var caption = thirdPipe === -1 ? "" : decodeMediaCaption(trimmed.slice(thirdPipe + 1).trim()).slice(0, LMS_MEDIA_CAPTION_MAX_LENGTH);
  if (!type || !url) return null;
  return { type: type, title: title, url: url, caption: caption };
}

// Parse a multi-line mediaUrls string into an array of { type, title, url, caption }.
// Blank/invalid lines are dropped. Returns [] for null/undefined/non-string input.
function parseMediaUrls(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("\n")
    .map(function (line) { return parseMediaLine(line); })
    .filter(Boolean);
}

// Expose for any consumer that checks existence.
if (typeof window !== "undefined") {
  window.parseMediaUrls = parseMediaUrls;
  window.parseMediaLine = parseMediaLine;
  window.decodeMediaCaption = decodeMediaCaption;
  window.encodeMediaCaption = encodeMediaCaption;
  window.LMS_MEDIA_CAPTION_MAX_LENGTH = LMS_MEDIA_CAPTION_MAX_LENGTH;
}
