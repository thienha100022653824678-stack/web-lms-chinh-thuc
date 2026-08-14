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

// ── V3 verified-entry presentation handoff ───────────────────────────────────
// This hook is deliberately inert everywhere except /lms.html when the page
// was opened with an entry_token from the Student Portal. V2 remains the owner
// of token verification + one-device session creation. Only AFTER V2 removes
// the consumed token and stores the verified LMS session may this hook hand the
// already-authenticated browser to the V3 presentation.
(function installV3VerifiedEntryHandoff() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!/(?:^|\/)lms\.html$/i.test(window.location.pathname || "")) return;

  function entryTokenFromLocation() {
    try {
      var searchToken = new URLSearchParams(window.location.search || "").get("entry_token");
      if (searchToken) return searchToken;
      var hash = String(window.location.hash || "").replace(/^#/, "");
      return new URLSearchParams(hash).get("entry_token") || "";
    } catch (_) {
      return "";
    }
  }

  // No Portal entry token at initial page load => this hook does nothing.
  if (!entryTokenFromLocation()) return;

  var finished = false;
  var startedAt = Date.now();
  var timeoutMs = 20000;

  function stop() {
    finished = true;
    if (timer) window.clearInterval(timer);
  }

  function hasVerifiedLmsSession() {
    try {
      var sessionId = window.localStorage.getItem("lms_verified_session_id") ||
        window.localStorage.getItem("lms_session_id") || "";
      var deviceId = window.localStorage.getItem("lms_device_id") || "";
      return Boolean(sessionId && deviceId);
    } catch (_) {
      return false;
    }
  }

  function previewWantsV3() {
    if (!/\.vercel\.app$/i.test(window.location.hostname || "")) return null;
    try {
      var mode = String(window.localStorage.getItem("v3_preview_mode") || "").toLowerCase();
      var killed = window.localStorage.getItem("v3_preview_kill") === "1";
      if (!mode) return false;
      return mode === "v3" && !killed;
    } catch (_) {
      return false;
    }
  }

  async function effectiveV3() {
    var previewDecision = previewWantsV3();
    if (previewDecision !== null) return previewDecision;
    try {
      var response = await fetch("/api/v3-mode", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      });
      var state = await response.json();
      return Boolean(response.ok && state && state.effectiveMode === "v3");
    } catch (_) {
      return false; // fail-safe: stay on V2
    }
  }

  async function maybeHandoff() {
    if (finished) return;
    if (Date.now() - startedAt > timeoutMs) {
      stop();
      return;
    }
    // Invalid/unconsumed token: V2 owns the error UI, so do nothing.
    if (entryTokenFromLocation()) return;
    // V2 stores LMS session before removing the verified token from the URL.
    if (!hasVerifiedLmsSession()) return;

    stop();
    if (!(await effectiveV3())) return;

    var course = "";
    try {
      course = String(new URL(window.location.href).searchParams.get("course") || "").trim();
    } catch (_) {}
    if (!course) return;

    window.location.replace("/v3?course=" + encodeURIComponent(course));
  }

  var timer = window.setInterval(maybeHandoff, 120);
  maybeHandoff();
})();

// ── V3 multi-course chooser repair ──────────────────────────────────────────
// The first V3 chooser rendered course slugs inside a double-quoted inline
// onclick attribute. A slug such as "banhmi4k" therefore terminated the
// attribute early: the course names were visible but the buttons were inert.
// Keep this repair isolated to /v3. It overrides ONLY the multiple-course
// chooser and uses DOM event listeners + URLSearchParams instead of inline JS.
(function installV3MultiCourseChooserRepair() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!/(?:^|\/)v3(?:\.html)?$/i.test(window.location.pathname || "")) return;

  var startedAt = Date.now();
  var timer = window.setInterval(function () {
    if (Date.now() - startedAt > 10000) {
      window.clearInterval(timer);
      return;
    }
    if (typeof window.chooseCourse !== "function" || window.__v3CourseChooserRepairInstalled) return;

    var originalChooseCourse = window.chooseCourse;
    window.__v3CourseChooserRepairInstalled = true;
    window.chooseCourse = function (payload) {
      var courses = payload && Array.isArray(payload.allowedCourses) ? payload.allowedCourses : [];
      var current = "";
      try { current = String(new URL(window.location.href).searchParams.get("course") || "").trim(); } catch (_) {}

      // Preserve the original path whenever no chooser is needed.
      if ((payload && payload.verifiedSession && payload.verifiedCourse) ||
          (current && courses.some(function (c) { return String((c && c.slug) || c || "") === current; })) ||
          courses.length <= 1) {
        return originalChooseCourse(payload);
      }

      var appNode = document.getElementById("app");
      if (!appNode) return originalChooseCourse(payload);

      var box = document.createElement("div");
      box.className = "state";
      var icon = document.createElement("div");
      icon.style.fontSize = "40px";
      icon.textContent = "📚";
      var title = document.createElement("h2");
      title.textContent = "Chọn khóa học";
      var text = document.createElement("p");
      text.textContent = "Tài khoản của bạn có nhiều khóa đang hoạt động.";
      box.appendChild(icon);
      box.appendChild(title);
      box.appendChild(text);

      courses.forEach(function (course) {
        var slug = String((course && course.slug) || course || "").trim();
        if (!slug) return;
        var button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.dataset.course = slug;
        button.textContent = String((course && course.title) || slug);
        button.addEventListener("click", function () {
          var url = new URL(window.location.href);
          url.searchParams.set("course", slug);
          // Existing query params such as admin_preview=1 are preserved.
          window.location.assign(url.toString());
        });
        box.appendChild(button);
      });

      appNode.innerHTML = "";
      appNode.appendChild(box);
    };
    window.clearInterval(timer);
  }, 20);
})();