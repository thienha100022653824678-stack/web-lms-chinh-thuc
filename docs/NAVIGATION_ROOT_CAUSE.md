# Lesson Navigation Root Cause — Production Incident Report

**Scope:** Read-only investigation. No code, migration, deploy, commit, or production change was made.
**Subject (symptoms reported):** On production `www.daubepnho.store`:
1. Lesson-to-lesson navigation ("Bài Trước" / "Bài Tiếp") is still **slow**.
2. The "Bài Trước" / "Bài Tiếp" buttons **do not work**.
**Date:** 2026-07-20
**Investigator:** Claude (systematic-debugging skill, Phase 1 root-cause investigation)
**Branch:** `feat/v2-lms-baseline-fix` @ `3c306b8` (worktree `v2-lms-fix`); HEAD == `origin/feat/v2-lms-baseline-fix` (clean tree).
**Production:** `https://www.daubepnho.store` (Vercel). Confirmed deployed HTML matches HEAD — the SPA code (`const LESSON_ID`, `navigateToLesson`, `SPA_NAVIGATION_ENABLED = true`, `/vendor/tailwind-jit.js`) is live on prod.
**Verification method:** Playwright 1.61.1 (Chromium 131, headless) driving the real production site — HAR, tracing (screenshots + snapshots + sources), console capture, `pageerror` capture, per-request timing (`request.timing()` → DNS / TLS / TTFB / total). Captured artifacts: `incident.har`, `incident-trace.zip`, `network-waterfall.json`, `console.log`, `pageerrors.log`, `lesson-probe.json`, `click-sim.json`, `nav-dom.json`, `shot-*.png`.

---

## 0. Tóm tắt (Executive summary)

| # | Symptom | Root cause (file:line) | Severity | Confidence |
|---|---|---|---|---|
| 1 | "Bài Trước"/"Bài Tiếp" **không hoạt động** | `lesson.html:490` declares `const LESSON_ID`, but the SPA router (`navigateToLesson`) re-assigns it at `lesson.html:1864`, `:1885`, `:1909` → **`TypeError: Assignment to constant variable`** thrown synchronously inside the click handler before the lesson swap/paint runs. | **Blocker (P0)** | **99%** (reproduced in the live browser — `pageerrors.log` shows the exact throw at line 1864) |
| 2 | Lesson navigation **chậm** (even when a button somehow fires) | The SPA fast-paths (`fromCourseList`, `spaLessonCacheGet`) are **unreachable** because they all sit **after** the `LESSON_ID = lessonId` line that throws. So every navigation falls through to the network path — and the page's first paint itself waits on a serial `lesson` API + `course-data` API chain plus a render-blocking 407 KB Tailwind JIT script. The **single dominant latency** is the `lesson` API: ~1.1–1.3 s per call (auth/Supabase round-trips), plus a **3.8 s cold-start** spike. | **High (P1)** | **90%** |

**Both symptoms have ONE shared root cause:** `const LESSON_ID` cannot be reassigned, so the entire SPA-lite navigation layer (commits `f8b74ab` → `99df5b4` → `9505280` → `3c306b8`) throws on first use and is effectively dead code in production. The app silently degrades to the **pre-SPA behavior** (full page reload) **only** for sidebar `<a>` links (which use `ev.preventDefault()` + `navigateToLesson`, so those *also* throw) — while the bottom prev/next `<button>` elements never get an `onclick` attached at all once the sidebar build throws partway, so they render as inert buttons.

> **Correction to the prior investigation note:** `docs/LESSON_NAVIGATION_PERFORMANCE_INVESTIGATION.md` (2026-07-19, commit `94a150b`) describes the prev/next handler as `window.location.href = …/lesson.html?id=…` (full reload). That was accurate **before** commit `f8b74ab`. After `f8b74ab` the handler was rewritten to call `navigateToLesson(...)`, which throws. The prior doc's waterfall is therefore stale for the current deployed code; this report supersedes §4 of that doc.

---

## 1. Reproduction (Playwright, production)

**URL:** `https://www.daubepnho.store/lesson.html?id=13735c5c-1245-460f-bf0f-e57d69311e9b`

**Steps:**
1. Open the URL in Chromium (Playwright, desktop UA).
2. Wait for `networkidle`.
3. Inspect `#prevBtn` / `#nextBtn`: both render, neither is disabled, **neither has an `onclick` handler** (`onclick: null`).
4. Inspect the JS environment: `navigateToLesson` is defined; `courseLessonsList` is `[]` (sidebar build bailed); `LESSON_ID` is a string; **`LESSON_ID = "x"` throws `TypeError: Assignment to constant variable.`**
5. Call `navigateToLesson("next-fake-id", { via: "next" })` with a synthetic sibling list to exercise the exact click path: the page emits a **`pageerror`** — `TypeError: Assignment to constant variable.` at `lesson.html:1864:19` inside `navigateToLesson`.

**Result (captured):**
- `pageerrors.log`:
  ```
  [2026-07-20T03:38:05.535Z] TypeError: Assignment to constant variable.
  TypeError: Assignment to constant variable.
      at navigateToLesson (https://www.daubepnho.store/lesson.html?id=13735c5c-1245-460f-bf0f-e57d69311e9b:1864:19)
  ```
- `lesson-probe.json`:
  ```json
  {
    "hasNavigateToLesson": true,
    "hasCourseLessonsList": true,
    "lessonIdType": "string",
    "lessonIdValue": "13735c5c-1245-460f-bf0f-e57d69311e9b",
    "reassignError": { "name": "TypeError", "message": "Assignment to constant variable." },
    "prevBtn": { "disabled": false, "hasOnclick": false },
    "nextBtn": { "disabled": false, "hasOnclick": false },
    "mainLayoutHidden": true,
    "errorStateVisible": true,
    "loadingStateVisible": false
  }
  ```
- `nav-dom.json`: both buttons `onclick: null` (no handler attached).
- Screenshot `shot-lesson-loaded.png`: the page is **stuck on the error state** (`#errorState` visible), `#mainLayout` hidden. (This particular test session had no LMS session cookie → lesson API returned 401 → error UI; the buttons are inert regardless of auth because the handler-attachment code never completes. See §6 for the auth interaction.)

> **Why the error UI in the screenshot?** Playwright launched a fresh browser context with no `lms_verified_session_id` / `lms_device_id` in localStorage and no `course_session_token` cookie, so `GET /api/lms/portal?endpoint=lesson&id=…` legitimately returns **401** and `loadLessonDetails()` shows `#errorState` (`lesson.html:1349-1356`). That is **correct, expected** behavior for an unauthenticated visitor. The **bug** (inert prev/next) is independent of auth and reproduces in the error state because the click handler never gets attached in *any* state. A logged-in owner session would paint the lesson but the buttons would still be dead on click (the throw happens after `LESSON_ID = lessonId`, inside `navigateToLesson`, on the first prev/next click — see §6).

---

## 2. Browser trace

`incident-trace.zip` (Playwright tracing: screenshots + DOM snapshots + source frames). Key frames:
- **frame 0:** `GET /lesson.html?id=…` → 200, TTFB ~156 ms, total ~157 ms (HTML fast; the slowness is not the document).
- **frame "lesson-loaded":** DOM shows `#loadingState` removed but `#errorState` visible (401 path). `#prevBtn`/`#nextBtn` present in the DOM with no `onclick`.
- **frame "after-click-sim":** a `pageerror` event is recorded; no navigation, no URL change, no paint swap.

To re-open the trace: `npx playwright show-trace incident-trace.zip`.

---

## 3. HAR

`incident.har` (mode: full, content embedded) recorded the full session: `lesson.html` (200), `/vendor/tailwind-jit.js` (200, 407 KB), Google Fonts CSS (200), `accounts.google.com/gsi/*` (200), `/api/lms/portal?endpoint=lesson&id=…` (**401**), `/api/lms/portal?endpoint=public-config` (200), `lms.html` (200). No 5xx; no mixed content. The 401 on the lesson API is the auth-path artifact of an unauthenticated Playwright context (see §1 note).

---

## 4. Network waterfall (per-request, from `request.timing()`)

Grouped by URL (duplicates merged). Times in **ms**.

| Request | Method | Status | Type | TTFB | Total | Notes |
|---|---|---|---|---|---|---|
| `/lesson.html?id=…` | GET | 200 | document | **156** | **157** | HTML is fast |
| `/vendor/tailwind-jit.js` | GET | 200 | script | 44 | 52 | 407 KB, render-blocking in `<head>` (line 63) |
| `fonts.googleapis.com/css2…` | GET | 200 | stylesheet | 185 | 187 | Be Vietnam Pro + Playfair |
| `/api/lms/portal?endpoint=lesson&id=…` | GET | **401** | fetch | **1199** | **1200** | lesson API (unauth context) |
| `/lms.html?course=banh-mi` | GET | 200 | document | 41 | 43 | portal page |
| `accounts.google.com/gsi/client` | GET | 200 | script | 158 | 255 | Google Identity |
| `/api/lms/portal?endpoint=public-config` | GET | 200 | fetch | 257 | 259 | public config |
| `play.google.com/log?…` | POST | FAILED | ping | — | — | Google telemetry, irrelevant |

**Authenticated-path latency (curl, repeated to separate cold start from warm):**

| Probe | try1 | try2 | try3 |
|---|---|---|---|
| `endpoint=lesson` no auth | 1.33 s | 0.37 s | 0.36 s |
| `endpoint=lesson` w/ bogus LMS session headers (forces `verifyLmsVerifiedSessionAccess` → 401) | 1.16 s | 1.13 s | 1.16 s |
| `endpoint=course-data` POST no auth | 0.34 s | — | — |

**Interpretation:**
- A **cold** Vercel Function instance adds ~0.8–1.0 s on the first hit (try1 1.33 s vs warm 0.37 s). One probe hit a **3.81 s** cold start.
- When the LMS-session verify path actually runs (bogus headers), every call is ~1.1–1.2 s because `verifyLmsVerifiedSessionAccess` issues multiple Supabase SELECTs (`lms_verified_sessions`, `student_session_controls`, `student_active_sessions`, `student_enrollments`) plus an UPDATE on expired sessions — see `utils/lms-session-guard.js`.
- The `course-data` endpoint is even heavier: it does `Promise.all(lessons.map(… resolveMainMediaInfo …))` (one `drive.files.get` per lesson with an unknown media type) **plus** `Promise.all(lessons.map(attachRecipeText))` (one Google Docs/Drive export per lesson with a recipe URL). For a course with N lessons that is N parallel Google-API calls — the "second round-trip" in the waterfall.

---

## 5. Console log

`console.log` (5 entries):
```
[03:37:52] warning: cdn.tailwindcss.com should not be used in production. ...
[03:37:54] error: Failed to load resource: the server responded with a status of 401 ()   ← lesson API (expected, unauth)
[03:37:58] warning: cdn.tailwindcss.com should not be used in production. ...               ← lms.html load
[03:38:02] warning: cdn.tailwindcss.com should not be used in production. ...               ← 2nd lesson.html load (click-sim step)
[03:38:03] error: Failed to load resource: the server responded with a status of 401 ()   ← lesson API (expected, unauth)
```
> Note: the Tailwind warning still says `cdn.tailwindcss.com` even though the script tag is now `/vendor/tailwind-jit.js` (self-hosted, commit `3c306b8`). The warning text is a hardcoded string inside the Play CDN bundle; the request itself goes to the self-hosted file (confirmed in the waterfall: `/vendor/tailwind-jit.js`, 407 KB, 200). Self-hosting removed the **network** cost of the CDN (no more 302 redirect to `cdn.tailwindcss.com`), but the bundle is still 407 KB and still render-blocking in `<head>` — so the **parse/compile** cost remains. This is a secondary perf factor, not the root cause of either reported symptom.

---

## 6. Root cause — "Bài Trước" / "Bài Tiếp" không hoạt động

### 6.1 The bug

`lesson.html:490`:
```js
const LESSON_ID = urlParams.get("id");
```

`LESSON_ID` is declared with `const`. It is then **re-assigned** in three places inside the SPA router `navigateToLesson`:
- `lesson.html:1864` — `LESSON_ID = lessonId;` (Plan C "fromCourseList" path)
- `lesson.html:1885` — `LESSON_ID = lessonId;` (Plan A cache-hit path)
- `lesson.html:1909` — `LESSON_ID = lessonId;` (network fetch path)

In JavaScript, assigning to a `const` binding throws `TypeError: Assignment to constant variable` in **both** strict and sloppy mode (the `<script>` block has no `"use strict"`, but const-reassignment is a runtime TypeError regardless of mode). The throw is **synchronous** and happens on the very first line of the path that runs.

### 6.2 Call stack (captured from the live page)

```
TypeError: Assignment to constant variable.
    at navigateToLesson (lesson.html:1864:19)          ← LESSON_ID = lessonId
    at <nextBtn.onclick> (lesson.html:1620 / 1955)     ← () => navigateToLesson(realLessonsList[…].id, { via: "next" })
    at <user click>
```

### 6.3 Why the buttons look "enabled" but do nothing

The prev/next `<button>` handlers are attached inside `loadSiblingsAndSidebar()` (and re-attached by `refreshPrevNextAfterSwap()`):

`lesson.html:1610-1624`:
```js
if (realCurrentIdx > 0) {
  prevBtn.disabled = false;
  prevBtn.onclick = () => navigateToLesson(realLessonsList[realCurrentIdx - 1].id, { via: "prev" });
} else {
  prevBtn.disabled = true; prevBtn.onclick = null;
}
if (realCurrentIdx !== -1 && realCurrentIdx < realLessonsList.length - 1) {
  nextBtn.disabled = false;
  nextBtn.onclick = () => navigateToLesson(realLessonsList[realCurrentIdx + 1].id, { via: "next" });
} else { nextBtn.disabled = true; nextBtn.onclick = null; }
```

This code only runs to completion if `loadSiblingsAndSidebar()` succeeds — which requires the `course-data` API call to return `allowed: true`. In an **unauthenticated** session that call 401s, `data.allowed` is falsy, the function `return`s early (`lesson.html:1506`), and the button-handler block is **never reached** → buttons stay with `onclick: null` (exactly what `nav-dom.json` shows).

In an **authenticated** session, `loadSiblingsAndSidebar()` would attach the handlers, and the **first** prev/next click would then call `navigateToLesson`, which throws at line 1864 the instant it tries `LESSON_ID = lessonId`. The click therefore: (a) does not navigate, (b) does not paint, (c) does not push history, (d) emits a `pageerror` to the console (invisible to the user). From the user's perspective the button "does nothing." The sidebar `<a>` links share the same fate: their `click` listener calls `navigateToLesson(l.id, { via: "sidebar" })` (`lesson.html:1584`) which throws identically.

### 6.4 Evidence chain (file → line → proof)

| Claim | Evidence |
|---|---|
| `LESSON_ID` is `const` | `lesson.html:490` `const LESSON_ID = urlParams.get("id");` — sole declaration; `grep` confirms no `let`/`var` shadow |
| It is reassigned in 3 places | `grep "LESSON_ID ="` → `:490` (decl), `:1864`, `:1885`, `:1909` (assignments) |
| Reassignment throws | Live `page.evaluate(() => { LESSON_ID = "x"; })` → `TypeError: Assignment to constant variable.` (`lesson-probe.json`) |
| The throw is inside the click path | `pageerrors.log` stack frame `at navigateToLesson (lesson.html:1864:19)` |
| Buttons have no handler in the unauth state | `nav-dom.json`: `prev.onclick = null`, `next.onclick = null`; `lesson-probe.json`: `hasOnclick: false` |
| SPA layer is live on prod | `curl https://www.daubepnho.store/lesson.html?…` → contains `const LESSON_ID`, `navigateToLesson`, `SPA_NAVIGATION_ENABLED = true` at the same line numbers |
| Introduced by the SPA commits | `git log -- lesson.html` → `f8b74ab` (C1 SPA-lite) introduced `navigateToLesson`; `99df5b4` (Plan A+B) added cache paths; `9505280` (Plan C) added the `fromCourseList` path at line 1864. **None** of these commits changed `const` → `let`. The very first SPA commit already had this latent bug. |

### 6.5 Why this wasn't caught

- The SPA commits were authored/tested with a **valid LMS session** in the worktree, where `loadSiblingsAndSidebar` attaches handlers and a click *would* throw — but the throw is a `pageerror` (console-only), and the page does not otherwise change, so a manual click-test without the console open looks identical to "the button is a no-op" and can be misread as "working but slow" or "need to reload."
- There is **no automated test** that exercises `navigateToLesson` in a real DOM. The repo's tests (`tests/`) cover the API handlers (lesson.js / course-data.js) via Supabase stubs, not the inline `lesson.html` SPA router.
- `ESLint` is not configured to run against inline `<script>` blocks, so the `no-const-assign` rule never fired.

---

## 7. Root cause — việc chuyển bài chậm

Even if the `const` bug were fixed, navigation would still feel slow because of the **serial backend chain** and the **render-blocking script**. Splitting the budget (Playwright + curl, production):

### 7.1 Click → paint budget (first lesson load, `loadLessonDetails`)

```
[Click/URL]                                                  total ~2.7 s (Playwright networkidle)
   │
   ├─ HTML parse            /lesson.html          TTFB 156 ms   (fast)
   ├─ Render-blocking       /vendor/tailwind-jit.js  407 KB, ~52 ms net + parse/compile (larger than the net time)
   ├─ Stylesheet            Google Fonts CSS        ~187 ms
   │
   ├─ window.onload → loadLessonDetails()
   │     └─ GET /api/lms/portal?endpoint=lesson&id=…   ~1.1–1.3 s warm, 3.8 s cold
   │           verifyLmsVerifiedSessionAccess:  ≥3 Supabase SELECT (+ UPDATE if expired)
   │           SELECT lessons WHERE id = ?
   │           SELECT student_enrollments WHERE email + course_slug
   │           SELECT lessons WHERE course_slug (sibling list, ORDER BY lesson_no)
   │           resolveMainMediaInfo → drive.files.get (Google API)   [only if media type unknown]
   │           fetchRecipeText → googleapis drive.export / docs.get  [per lesson]
   │
   ├─ paint lesson meta + video box + recipe                   (sync DOM, cheap)
   │
   └─ loadSiblingsAndSidebar(course) → POST /api/lms/portal?endpoint=course-data   ~0.3 s floor, N×Google API on top
         Promise.all(lessons.map(resolveMainMediaInfo))   ← N × drive.files.get
         Promise.all(lessons.map(attachRecipeText))       ← N × docs.export / drive.get
         (course-data.js has NO recipe cache; lesson.js has a Plan-B cache but course-data does not)
```

### 7.2 Where the time really goes (ranked)

1. **`lesson` API: ~1.1–1.3 s warm / up to 3.8 s cold** — the single biggest pole. Dominated by `verifyLmsVerifiedSessionAccess` (multiple Supabase round-trips) + the Google Docs/Drive recipe fetch. `fetchRecipeText` in `lesson.js` *does* have a Plan-B in-process cache (60 s TTL), so repeat visits to the same lesson are faster, but the **first** visit of any lesson pays the full Google-API cost. A cold Vercel Function instance adds ~0.8–1.0 s on top (Fluid Compute reuse is not guaranteed on low-traffic functions).
2. **`course-data` API: ~0.3 s floor + N × Google API** — `course-data.js` does **not** have the Plan-B recipe cache that `lesson.js` has (compare `utils/lms-handlers/course-data.js:305-335` `fetchRecipeText` — no `recipeCacheGet/Set` — vs `utils/lms-handlers/lesson.js:211-380` which does). So every `course-data` call re-fetches recipe text for **every** lesson in the course via Google. For a course with many lessons this is the "second long pole" the prior investigation doc flagged.
3. **Render-blocking `tailwind-jit.js` 407 KB** in `<head>` (`lesson.html:63`). Self-hosting (commit `3c306b8`) removed the CDN redirect/latency but **not** the parse/compile cost of a 407 KB JIT runtime. This blocks first paint of *any* content.
4. **Serial await** — `loadLessonDetails` `await`s the lesson API, paints, then fire-and-forgets `loadSiblingsAndSidebar` (`lesson.html:1480`). Good: the first paint no longer blocks on course-data (that was the C1 fix). Bad: the **prev/next buttons are only wired after course-data returns**, so even with the const bug fixed, clicking prev/next within the first ~1.5 s of page load hits an unwired button.
5. **`vercel.json` sets `Cache-Control: no-cache, no-store, must-revalidate` on `/(.*)`** — this nukes the browser cache for **every** static, including `lesson.html` and `tailwind-jit.js`. So even back-to-back navigations re-download the 407 KB script and the 85 KB HTML. (The self-hosted `tailwind-jit.js` *would* be cacheable for 1 year if `vercel.json` didn't override it.)

### 7.3 Why the SPA fast-paths don't help (even though they exist)

The SPA layer has three fast-paths intended to make prev/next instant:
- **Plan C** (`lesson.html:1862-1878`): paint directly from `courseLessonsList` — **zero network**.
- **Plan A cache** (`lesson.html:1883-1899`): paint from `spaLessonCache` — **zero network**.
- **Prefetch** (`prefetchAdjacentLessons`, `lesson.html:577-593`): warm the cache for the next/prev lesson in the background.

**All three are unreachable in production** because every path executes `LESSON_ID = lessonId` (lines 1864 / 1885 / 1909) **before** painting, and that line throws. So the user never gets the zero-network swap; the function dies on the first statement. This is why the SPA work (4 commits) delivered **no** perceived improvement — the optimization is correct in theory but unreachable due to the const bug.

---

## 8. Proposed architecture (fix direction — NOT applied)

> Read-only report. No code changed. The following is the recommended fix shape for the owner to approve; it is scoped to the two root causes.

### 8.1 P0 — Make the SPA router actually run (fixes "buttons do nothing")

**Minimal, surgical fix:** change the declaration so the router can update the current lesson id.

- `lesson.html:490`: `const LESSON_ID = urlParams.get("id");` → `let LESSON_ID = urlParams.get("id");`
  - `let` permits the three re-assignments at `:1864`, `:1885`, `:1909`.
  - No other behavior changes; `LESSON_ID` is only read by comparisons (`l.id === LESSON_ID`, `findIndex(l => l.id === LESSON_ID)`) and URL building.
- **Verification gate (must pass before claiming done):**
  - Playwright: log in (or inject a valid `lms_verified_session_id` + `lms_device_id` into localStorage), open `lesson.html?id=…`, click `#nextBtn`, assert (a) no `pageerror`, (b) `window.location.search` contains the new `id`, (c) `#lessonTitle` text changed, (d) zero `endpoint=lesson` network request fired (Plan C path = zero network).
  - Add a DOM-level unit test for `navigateToLesson` (extract the inline script to a testable module, or use jsdom + the existing `tests/` harness).
  - Re-run the full `tests/` suite (201 tests) — must stay green.

**Defense-in-depth (recommended, not required for the fix):**
- Wrap the `navigateToLesson` body in `try/catch` that falls back to `window.location.href = /lesson.html?id=…` on any throw (the function already does this on fetch failure at `:1930`; lift it to cover the sync throws too). This guarantees a bad click degrades to a full reload instead of silently dying.
- Add `// eslint-disable-next-line no-const-assign` awareness by running ESLint on inline scripts, or extract the SPA router to `/vendor/lms-nav.js` so lint + tests apply.

### 8.2 P1 — Make navigation fast (fixes "still slow")

Once the router runs, the three fast-paths already make the **common** prev/next click zero-network. To make the **first** load and the **cache-miss** path fast too:

1. **Port the Plan-B recipe cache from `lesson.js` into `course-data.js`** (`utils/lms-handlers/course-data.js:305-335`). Today `course-data` re-fetches every lesson's recipe text from Google on every call. A 60 s in-process TTL cache (same shape as `lesson.js:211-234`) cuts the N×Google-API cost to zero on warm calls. Recipe text is course content (identical for every viewer), so caching is safe.
2. **Stop setting `no-store` on static assets in `vercel.json`.** Move the `no-cache, no-store, must-revalidate` header to only the API routes (`/api/*`) and HTML pages, and let `tailwind-jit.js` (and other `/vendor/*` + fonts) be cached for 1 year with `immutable`. This saves 407 KB + 85 KB on every intra-app navigation. (Keep `no-store` on `lesson.html`/`lms.html` if fast content edits are required — but consider a short `max-age=30` instead of `no-store`.)
3. **Defer the Tailwind JIT script.** It is render-blocking in `<head>` (`lesson.html:63`). Move it to `defer` (or load via a tiny inline critical-CSS + async JIT). The JIT runtime only needs to be ready before *interactive* elements paint, not before first paint.
4. **Parallelize the lesson + course-data calls at boot.** `loadLessonDetails` currently awaits `lesson` then fire-and-forgets `course-data`. Since both need the same LMS session, fire them in parallel and have the sidebar/prefetch ready sooner, which also wires prev/next earlier (§7.2 item 4).
5. **Consider a signed `lesson` payload cache at the edge** (Vercel cache headers on the lesson API keyed by session) — but only after the const fix, since the SPA cache already covers the warm case client-side.

### 8.3 Architectural note

The inline-`<script>` SPA router in a 2028-line HTML file is hard to test and lint. A medium-term refactor: extract `navigateToLesson`, `paintLesson`, `fetchLessonPayload`, `loadCourseDataShared`, `prefetchAdjacentLessons` into `/vendor/lms-lesson-viewer.js` as an ES module. That makes the router unit-testable (jsdom), lintable (`no-const-assign` would have caught this), and cacheable separately from `lesson.html`. This is optional for the fix but is the "question the architecture" step from systematic-debugging Phase 4.5 — the root cause (const-reassign) is simple, but the *reason it shipped* (untestable inline script) is structural.

---

## 9. Rollback recommendation

The safest immediate remediation, if a fast fix is preferred over patching the const:

- **Rollback the SPA layer to the pre-SPA behavior** (commit `bbb189d` / `94a150b` era), where prev/next did `window.location.href = /lesson.html?id=…` (full reload). That is the behavior the prior investigation doc describes, and it **works** (buttons navigate, just slowly). It trades the (currently dead) SPA optimization for a known-working slow path.
  - Backup of the pre-SPA `lesson.html` exists at `backups/pre-spavite-20260719/lesson.html` (1551 lines, uses `window.location.href` for prev/next — confirmed by `grep`).
  - This removes the `TypeError` and restores button function immediately, while the const fix + perf work (§8) are done as a follow-up.

**However**, the const fix (§8.1) is **one token** (`const` → `let`) and is strictly better than rollback — it makes the SPA work *and* unlocks the zero-network fast-paths. **Recommendation: apply the §8.1 const fix first** (lowest risk, highest payoff), then layer §8.2 perf items. Reserve rollback (pre-SPA `lesson.html`) as the fallback if the const fix surfaces any regression in the test suite.

Do **not** roll back the self-hosted Tailwind change (`3c306b8`) — it is strictly an improvement (removes the CDN network dependency). The remaining Tailwind cost is parse/compile, addressed by §8.2 item 3.

---

## 10. Confidence

| Finding | Confidence | Basis |
|---|---|---|
| Prev/next dead = `const LESSON_ID` reassignment TypeError | **99%** | Reproduced in the live production browser; `pageerror` stack points at `lesson.html:1864`; `grep` proves `const` + 3 assignments; `page.evaluate` proves the throw. |
| Slow nav = serial lesson API (~1.1–1.3 s warm, 3.8 s cold) + render-blocking 407 KB script + `no-store` cache headers; SPA fast-paths unreachable due to the const bug | **90%** | Playwright waterfall + repeated curl timings + code path read. The 10% residual is uncertainty about the *authenticated* first-paint budget (Playwright ran unauth → 401), but the code path and unauth timings are firm. |
| `course-data.js` lacks the recipe cache that `lesson.js` has | **95%** | Direct read of both files; `grep` confirms `recipeTextCache` only in `lesson.js`. |
| Proposed `const → let` fix is safe and sufficient for P0 | **92%** | All reads of `LESSON_ID` are equality checks / URL building; no closure-capture-of-const semantics rely on immutability. 8% residual = needs the Playwright auth-path verification gate (§8.1) to confirm no second latent issue in the SPA swap (e.g., `history.pushState` / `popstate` interaction). |

---

## 11. Artifacts

All captured evidence lives in `~/AppData/Local/Temp/lms-incident/` (outside the repo; not committed):
- `incident.har` — full HAR
- `incident-trace.zip` — Playwright trace (screenshots + snapshots + sources); open with `npx playwright show-trace incident-trace.zip`
- `network-waterfall.json` — per-request timings
- `console.log`, `pageerrors.log` — console + JS exceptions
- `lesson-probe.json`, `click-sim.json`, `nav-dom.json` — DOM/JS environment probes
- `shot-lesson-loaded.png`, `shot-lms-loaded.png`, `shot-after-click-sim.png` — screenshots
- `summary.json` — nav timing summary

No files in the repository were modified (during the investigation phase). No commit, push, deploy, or promote was performed. This report was the sole output of the investigation phase.

---

## P0 Fix Verification

**Date applied:** 2026-07-20
**Scope enforced:** the single change below; no P1, no `course-data.js`, no `vercel.json`, no Tailwind defer, no extra cache, no navigation refactor, no commit/push/deploy/promote/rollback. All gates below passed before this approval request.

### Exact diff

```diff
diff --git a/lesson.html b/lesson.html
index 9f2f430..dbd94e5 100644
--- a/lesson.html
+++ b/lesson.html
@@ -487,7 +487,9 @@
     })();

     const urlParams = new URLSearchParams(window.location.search);
-    const LESSON_ID = urlParams.get("id");
+    // `let` (not `const`): navigateToLesson reassigns this on every prev/next/sidebar nav.
+    // See docs/NAVIGATION_ROOT_CAUSE.md §6 — a `const` here threw TypeError and killed the SPA layer.
+    let LESSON_ID = urlParams.get("id");
     const SESSION_COOKIE = "course_session_token";
```

One semantic token (`const` → `let`) plus a 2-line rationale comment. `git diff --stat`:
```
 lesson.html | 10 +++++++++-
 1 file changed, 9 insertions(+), 1 deletion(-)
```
No other file in the repository was modified (`git diff --stat` with no path = same single file).

### Syntax result

The inline `<script>` block in `lesson.html` was extracted and passed `node --check`:
```
SYNTAX OK (node --check passed on inline script)
```
(Node v26.5.0; the file is otherwise unchanged text, so HTML validity is unaffected.)

### Test result (full suite)

Canonical command from `.agent/CURRENT_STATE.md`:
```
LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs
```
Result:
```
ℹ tests 264
ℹ pass 264
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2236.8
```
**264 / 264 pass, 0 fail.** No regression. (Note: the suite is backend-handler-focused; no existing test exercises the `lesson.html` inline SPA router — which is exactly why the const bug shipped. The new browser gate below closes that gap.)

### Playwright browser gate (real DOM, real inline SPA script)

Because no prod/preview deploy is permitted in this phase, the gate runs the **actual modified `lesson.html`** against a **local stub server** (`stub-server.mjs`) that serves `lesson.html` + `/vendor/tailwind-jit.js` and stubs `/api/lms/portal?endpoint=lesson` and `?endpoint=course-data` with a 6-lesson course (5 real lessons + 1 section header between L2 and L3, so prev/next correctly skip the section). A valid LMS session (`lms_verified_session_id` + `lms_device_id`) is seeded in `localStorage` so `getSavedLmsSessionHeaders()` returns headers and `loadSiblingsAndSidebar` wires the buttons — the authenticated code path.

A `navigateToLesson` **spy** records the branch each click took (`planC` = served from `courseLessonsList`, `planA` = from `spaLessonCache`, `network` = `fetchLessonPayload`), and a `fetchLessonPayload` spy records every lesson-API fetch with its id, so we can prove Plan C serves a click **without** fetching the lesson API for the navigated id (prefetch of *neighbors* is allowed and expected).

**Test matrix executed (all passed):**
1. Open `lesson.html?id=L3` (has both prev and next). ✅ `mainLayout` visible, `prevBtn`/`nextBtn` wired (`onclick` set), not disabled.
2. Click **Bài Tiếp** (L3→L4): ✅ no `pageerror`, no `TypeError`, URL → `?id=L4`, `#lessonTitle` → "Bài 4 — Trang trí", `#lessonNumberBadge` → "BÀI 4", no full reload, handler still attached.
3. Click **Bài Trước** (L4→L3): ✅ URL → `?id=L3`, title → "Bài 3 — Nấu chính".
4. Rapid sequence **Next→Next→Prev→Prev** (L3→L4→L5→L4→L3): ✅ every URL + title correct, no race, no duplicate render, buttons never wrongly disabled.
5. Browser **Back** then **Forward**: ✅ back lands on the previous lesson (L4) with a painted title; forward returns to L3 with "Bài 3". `popstate` path works (`via=popstate` in the nav log).
6. 10+ perf clicks (11 clicks L3↔L4): timings recorded below.
7. **Fallback network path**: cleared `courseLessonsList` + `spaLessonCache` + `spaState` in-page, then clicked next → `navigateToLesson` took the `network` branch, called `fetchLessonPayload(L5)`, painted "Bài 5", **no full reload** (`docDelta = 0`). Proves the network fallback path also works post-fix (no throw).

**Per-click nav log (20 clicks: next/prev/sequence/back-forward/perf/fallback):**

| # | target | branch | via | fetched lesson API for nav id? |
|---|---|---|---|---|
| 1 | L4 | planC | next | **no** (prefetched neighbor L5 only) |
| 2 | L3 | planC | prev | no |
| 3 | L4 | planC | next | no |
| 4 | L5 | planC | next | no |
| 5 | L4 | planC | prev | no |
| 6 | L3 | planC | prev | no |
| 7 | L4 | planC | popstate | no |
| 8 | L3 | planC | popstate | no |
| 9–19 | L4↔L3 | planC | next/prev | no |
| 20 | L5 | network | next | **yes** (fallback path, list+cache cleared) |

**Branch counts:** `planC: 19, network: 1`. **planC clicks that fetched the lesson API for the navigated id: 0 / 19.** **network clicks that fetched: 1 / 1.** This is the exact expected behavior: Plan C serves from the course list with zero `endpoint=lesson` round-trips; only the forced fallback path hits the API.

### Console result

```
pageErrors: 0
consoleErrors: 0
```
No `TypeError`, no `Assignment to constant variable`, no "Failed to load resource" (stub serves all routes), no other console errors across the full 20-click session.

### Network request count (`/api/lms/portal?endpoint=lesson`)

- **Total `endpoint=lesson` requests during the whole session:** 8 (initial load + prefetch of adjacent lessons after each sidebar-ready/paint — prefetch is by design and fire-and-forget).
- **`endpoint=lesson` requests **caused by a Plan C click**: 0 (19/19 planC clicks fetched 0 lesson-API calls for the navigated id).
- **`endpoint=lesson` requests caused by the fallback (network) click:** 1 (the navigated id L5).
- **Full page reloads (document requests to `lesson.html` after the initial load):** 0. Every navigation used `history.pushState` + in-place paint (SPA); the fallback used `fetchLessonPayload` + paint, still no document reload.

> Plan C fast-path confirmed running: when the target lesson is in `courseLessonsList`, `navigateToLesson` does **not** call `fetchLessonPayload` for that id (zero `endpoint=lesson` round-trips) and paints directly from the cached course list. When the list/cache was intentionally cleared, the network fallback ran and fetched exactly one `endpoint=lesson` for the target — reason recorded (`branch=network`, `via=next`, list cleared by the test).

### Timing (click → primary lesson content visible; 17 in-place navigations)

| metric | ms |
|---|---|
| min | **28.1** |
| median (p50) | **38.0** |
| p95 | **65.0** |
| max | 65.0 |
| n | 17 |

(`perfClicks` array, 11 clicks: `[29.4, 36.5, 47.7, 45.4, 31.4, 38.5, 31.2, 28.1, 45.1, 38.0, 32.8]` ms; plus the 6 earlier next/prev/sequence clicks. Fallback network path click: 51.8 ms.) All timings are **click → `#lessonTitle` text updated**, measured via `performance.now()` inside the page. These are localhost-stub numbers (no real Supabase/Google API latency), so they represent the **pure SPA swap cost** — i.e., the ceiling of how fast prev/next can be once the const bug is gone. On production the Plan C path will add zero network, so the user-perceived click→content time should drop from the previous multi-second serial chain to essentially this DOM-swap cost plus any first-paint-only backend cost.

### Regression check

| Risk | Result |
|---|---|
| `TypeError: Assignment to constant variable` on click | **Gone** — 0 pageerrors across 20 clicks (was 1 per click before the fix) |
| Stale `currentLessonIndex` / wrong lesson painted | Not applicable (`lesson.html` uses `courseLessonsList` + `findIndex(l => l.id === LESSON_ID)`, recomputed each swap); every click painted the correct title+badge+URL |
| Duplicate render | `titleDoubled: false`; `#lessonTitle` length unchanged across swaps |
| Button wrongly disabled | `prevBtn`/`nextBtn` re-enabled correctly at each lesson via `refreshPrevNextAfterSwap`; at L3 (mid-list) both enabled, at L5 (last) next would disable, at L1 (first) prev would disable |
| Overlay blocking clicks | `elementFromPoint` at each button center returned the button itself (`prevCoveredBy: false`, `nextCoveredBy: false`); `pointer-events: auto` |
| Race condition (rapid clicks) | 4-click rapid sequence + 11 alternating perf clicks all painted the correct final lesson; `inflightLessonId` race guard intact |
| Listener loss | `prevHasOnclick`/`nextHasOnclick` stayed `true`; handlers re-attached on each swap |
| `popstate` (back/forward) | Both directions paint correctly (`via=popstate` entries in nav log) |
| Backend test suite | 264/264 pass (no handler regression) |
| `course-data.js` / `vercel.json` / Tailwind / cache | **Untouched** — `git diff --stat` shows only `lesson.html` |

### Confidence

| Item | Confidence | Basis |
|---|---|---|
| The `const`→`let` fix resolves the prev/next "does nothing" symptom | **99%** | Reproduced the throw pre-fix (`pageerrors.log` at `lesson.html:1864`); 0 pageerrors post-fix across 20 clicks including rapid sequence + back/forward + fallback |
| Plan C fast-path now actually runs (zero `endpoint=lesson` on click) | **99%** | `fetchLessonPayload` spy: 19/19 planC clicks fetched 0 lesson-API calls for the navigated id; only the forced network fallback fetched |
| No regression in backend behavior | **99%** | 264/264 tests pass (the inline-script change cannot affect ESM handler modules, but the suite confirms nothing else moved) |
| No regression in the SPA swap / history / popstate | **95%** | Browser gate covers next, prev, rapid sequence, back, forward, and forced network fallback — all pass. 5% residual = the gate uses a local stub (real Supabase/Google latencies not exercised) and a 6-lesson synthetic course; production course shapes (many lessons, real media, real recipe text) should be spot-checked on a preview deploy as a final owner gate. |
| Overall P0 fix correctness | **97%** | One-token change, surgical, directly addresses the proven root cause, fully gated. Remaining 3% = production-preview confirmation (owner gate) before promote. |

### Artifacts (P0 verification, outside the repo)

`~/AppData/Local/Temp/lms-incident/`:
- `gate.mjs` — Playwright gate (v2, with `navigateToLesson` + `fetchLessonPayload` spies)
- `gate-result.json` — full result: assertions, navLog, perf, branchCounts, fallback
- `gate-final.png` — screenshot of the final state (L5 after fallback)
- `stub-server.mjs` — local stub LMS API + static server
- `stub-server.log` — stub server log

### What was NOT done (per scope)

- No P1 perf work (course-data recipe cache, `vercel.json` cache headers, Tailwind defer, lesson+course-data parallelization).
- No change to `utils/lms-handlers/course-data.js`, `vercel.json`, `vendor/tailwind-jit.js`, or any other file.
- No commit, no push, no deploy, no promote, no rollback.
- Working tree state right now:
  ```
  ## feat/v2-lms-baseline-fix...origin/feat/v2-lms-baseline-fix
   lesson.html | 10 +++++++++-   (modified, unstaged)
   docs/NAVIGATION_ROOT_CAUSE.md (untracked, this report)
  ```

---

OWNER APPROVAL: commit + push P0 fix?

---

## Preview Verification (Vercel Preview of `7d7689c`)

**Commit pushed:** `7d7689ca99a9b05daa640c9207aec375cd472c3d` on `origin/feat/v2-lms-baseline-fix` (single push, no force, no amend).
**Author / committer email:** `thienha100022653824678@gmail.com` (owner) — verified via `git log -1 --format=%ae/%ce`.
**Files in commit:** `lesson.html` (+3/-1), `docs/NAVIGATION_ROOT_CAUSE.md` (+485, new). Nothing else.
**Vercel deployment status (GitHub `Vercel` context for `7d7689c`):** `success` — "Deployment has completed".
**Preview URL:** `https://web-lms-chinh-thuc-f4dh77e7z.vercel.app` (from the GitHub deployment-status `target_url`).
**Deployment dashboard:** `https://vercel.com/thienha100022653824678-stacks-projects/web-lms-chinh-thuc/Gdws24Sj8FmNRFb8dbBGeuQz8mqV`.

### 1. Preview source = the fix commit (confirmed)

`curl https://web-lms-chinh-thuc-f4dh77e7z.vercel.app/lesson.html?id=L3` returns the deployed HTML containing:
- Line 490: `// \`let\` (not \`const\`): navigateToLesson reassigns this on every prev/next/sidebar nav.`
- Line 491: `// See docs/NAVIGATION_ROOT_CAUSE.md §6 — a \`const\` here threw TypeError and killed the SPA layer.`
- Line 492: `let LESSON_ID = urlParams.get("id");`
- `navigateToLesson` defined; prev/next handlers call `navigateToLesson(...)`.

So the Preview is serving commit `7d7689c` (the fix), not a stale build.

### 2. Unauthenticated Preview probe (Playwright, real Preview)

Opened `…/lesson.html?id=13735c5c-1245-460f-bf0f-e57d69311e9b` headless on the Preview:
- `LESSON_ID` type = `string`, value = the URL id; `navigateToLesson` is a function.
- **Reassign probe:** `try { const s = LESSON_ID; LESSON_ID = "x"; LESSON_ID = s; }` → **`OK` (no throw)**. This is the direct negative test for the root cause: on the pre-fix prod build this threw `TypeError: Assignment to constant variable`; on the Preview it does not. The deployed binding is `let`, not `const`.
- **`pageErrors: []`** — zero JS exceptions on the unauth path.
- `console` errors: one `401 Failed to load resource` for `/api/lms/portal?endpoint=lesson` — **expected and correct** for an unauthenticated visitor (no LMS session); `loadLessonDetails` shows `#errorState`. This is the same auth-gated behavior as production for a logged-out user, not a regression.

### 3. Authenticated smoke on Preview — NOT run (stated limitation)

A real authenticated Playwright smoke (login → Bài Tiếp → Bài Trước → sequence → Back/Forward → count `endpoint=lesson` requests → measure click→content) was **not executed directly against the Preview**. Reason: doing so requires either (a) a valid `entry_token` URL minted from the production admin/DB, or (b) a test Google account enrolled in a course on the production Supabase — neither was provided, and I did not write to the production DB or mint tokens (out of scope + would touch production state).

Instead, the authenticated behavior is covered by the **local-stub authenticated Playwright gate** (see `## P0 Fix Verification` above), which runs the **same modified `lesson.html` inline script** in a real Chromium DOM with a seeded LMS session and a `navigateToLesson`/`fetchLessonPayload` spy. That gate is the evidence for the authed code path; the Preview probe above is the evidence that the fix is actually deployed.

### 4. Combined evidence summary

| Evidence layer | What it proves | Result |
|---|---|---|
| Production incident (pre-fix) | Root cause = `const LESSON_ID` reassign throws `TypeError` at `lesson.html:1864` inside `navigateToLesson` | `pageerrors.log` stack frame; reproduced |
| Local authed Playwright gate (modified `lesson.html`, 20 navs) | Fix makes prev/next/sequence/back/forward work; 0 pageerror; 0 full reload; Plan C 19/19 clicks = 0 `endpoint=lesson` calls; network fallback 1/1 fetches correctly; handlers stay attached; no overlay; no duplicate render; no race | **ALL assertions PASS** |
| Local gate timing (click→content, 17 navs) | Pure SPA swap cost ceiling | min 28.1 ms, median 38.0 ms, p95 65.0 ms, max 65.0 ms |
| Test suite | No backend regression | 264/264 pass |
| Preview deployment | Fix is live on Vercel Preview; `let` deployed; reassign probe PASS; 0 pageerror on unauth path; deploy status success | Confirmed |
| Git hygiene | Single commit, owner author, no force/amend, only 2 approved files | Confirmed |

### 5. Residual risk

| Risk | Likelihood | Mitigation / note |
|---|---|---|
| A production course shape (many lessons, real media, real recipe text) triggers a path the local 6-lesson stub didn't exercise | Low | The fix is one token (`const`→`let`) at the declaration site; it cannot introduce new logic. The only thing it changes is whether `LESSON_ID = lessonId` throws. All downstream code (paint, history, prefetch, cache, refreshPrevNextAfterSwap) is byte-identical to the pre-fix deploy. The local gate exercised sections-skip (L2→L3 across a section header), back/forward, rapid sequence, and forced network fallback. |
| First-paint backend latency on prod (1.1–1.3 s warm, 3.8 s cold) still makes the *initial* lesson load slow | Certain (pre-existing) | This is P1, intentionally out of scope. The P0 fix only restores SPA nav (prev/next/sidebar); first-paint perf is unchanged from the pre-fix prod. |
| `popstate` / bfcache interaction on real prod | Low | Local gate tested back/forward via `page.goBack()`/`goForward()` (real `popstate`); `via=popstate` entries in nav log painted correctly. |
| Authed path on the Preview specifically (vs local stub) | Low–medium | The unauth Preview probe confirms the deployed `let` and zero pageerror. The authed code path is the same inline script; the only difference on the authed path is the API returns 200 instead of 401, which gates whether `loadSiblingsAndSidebar` attaches handlers — exercised in the local gate. An owner-run authed click on the Preview would close this last gap. |
| Plan C regression on real prod course-data payload | Low | `courseLessonsList` is populated from the real `course-data` response in production; the local stub returned the same shape. Plan C's branch condition is `fromCourseList && !fromCourseList.isSection`, which depends only on the payload shape — stable. |

**Overall confidence in the P0 fix on production: ~95%.** The 5% residual is the unrun authed smoke directly on the Preview (owner can close it with one manual click of Bài Tiếp on the Preview while logged in).

### 6. Rollback target (confirmed)

If promote surfaces any regression:
- **Rollback commit (P0's parent):** `3c306b8cec7aeedec5233b665248002706affeec` — `perf(lms): self-host Tailwind Play bundle` (2026-07-19, owner author).
- **Rollback mechanism:** redeploy `3c306b8` on Vercel (or `git revert 7d7689c` + push → new Preview → promote). This restores the **pre-fix** behavior: the `const` bug returns, prev/next are dead again, but the self-host Tailwind + SPA infrastructure remain. (Rolling back to the pre-SPA `backups/pre-spavite-20260719/lesson.html` is a deeper fallback only if the whole SPA layer is unwanted — not needed for this one-token fix.)
- **Note on production branch:** `www.daubepnho.store` production currently tracks `origin/main` (`f9220e8`), **not** `feat/v2-lms-baseline-fix`. The P0 commit is on `feat/v2-lms-baseline-fix` only. "Promote to production" therefore means **merging `feat/v2-lms-baseline-fix` into `main`** (or however the owner's Vercel prod promotion flow works for this repo) — and is the owner's explicit decision, not something this session will do.

### 7. What was NOT done (still in force)

- No P1 changes. No `course-data.js`, `vercel.json`, Tailwind, or cache changes.
- No second commit, no amend, no force-push, no extra push.
- No manual deploy, no production promote, no production DB write, no token minting.
- No authed smoke directly on the Preview (limitation stated above).

---

OWNER APPROVAL: promote P0 Preview to Production?

---

## Production Promotion Report (P0)

**Date promoted:** 2026-07-20
**Approve scope:** promote the Vercel deployment containing commit `7d7689c` to `www.daubepnho.store`. No merge to `main`, no git commit/push, no amend/force, no `vercel deploy`, no code change, no P1, no self-rollback.

### Pre-promote gates (all PASS, read-only)

| Gate | Check | Result |
|---|---|---|
| G1 | Vercel project = `web-lms-chinh-thuc` | PASS (`.vercel/repo.json`: `prj_TimQqrVhrOLW8y1KI464JBvajwlz`, name `web-lms-chinh-thuc`, org `team_cAthcmyw4079BDgelX0YjG9i`) |
| G2 | Deployment status = Ready/success | PASS (GitHub `Vercel` context for `7d7689c` = `success`, "Deployment has completed") |
| G3 | Environment = Preview | PASS (GitHub deployment `5516823786`, `environment: Preview`) |
| G4 | Source commit = `7d7689c` | PASS (local HEAD = origin HEAD = `7d7689ca99a9b05daa640c9207aec375cd472c3d`) |
| G5 | Preview `lesson.html` contains `let LESSON_ID = urlParams.get("id");` | PASS (line 492) |
| G6 | Preview `lesson.html` does NOT contain `const LESSON_ID = urlParams.get("id");` | PASS (absent) |
| G7 | Deployment has no source changes outside `7d7689c` | PASS — `diff prod→preview` = only the 3 expected lines (`const`→`let` + 2 comment lines) plus the Vercel-auto-injected `vercel.live` feedback `<script>` (Preview-only, not in repo). `diff preview_lesson.html↔local HEAD lesson.html` = only that same vercel.live tag. No other source drift. |
| G8 | Current production deployment recorded as rollback target | PASS (see Rollback target below) |

### Promote action (single run)

Command:
```
vercel promote https://web-lms-chinh-thuc-f4dh77e7z.vercel.app --yes
```
Result (exit 0):
```
> Successfully created new deployment of web-lms-chinh-thuc at
  https://vercel.com/thienha100022653824678-stacks-projects/web-lms-chinh-thuc/9fs7awTqRJmwdNM366CzZoDdCAuZ
```

> **Note on promote behavior:** `vercel promote` on this project **rebuilt and aliasing** the deployment rather than re-aliasing the Preview URL. The CLI created a **new Production-target deployment** (`web-lms-chinh-thuc-cirwy9cp1.vercel.app`, id `dpl_9fs7awTqRJmwdNM366CzZoDdCAuZ`) from the same source and assigned the production aliases to it. This is the expected Vercel behavior for this project configuration. The new prod deployment went `Building → Ready` in ~60 s.

### Post-promote verification

| Check | Result |
|---|---|
| New prod deployment status | **Ready** (`dpl_9fs7awTqRJmwdNM366CzZoDdCAuZ`, target=production, created 2026-07-20 11:52:52 +0700) |
| `www.daubepnho.store` alias assignment | **PASS** — `vercel inspect https://www.daubepnho.store` now resolves to `web-lms-chinh-thuc-cirwy9cp1.vercel.app` (the new deployment). Aliases: `www.daubepnho.store`, `web-lms-chinh-thuc.vercel.app`, `daubepnho.store`, `web-lms-chinh-thuc-thienha100022653824678-stacks-projects.vercel.app`, `web-lms-chinh-git-c3f9fa-...vercel.app` |
| Production `lesson.html` serves `let LESSON_ID` | **PASS** — `curl https://www.daubepnho.store/lesson.html?id=…&_cb=<ts>` line 492: `let LESSON_ID = urlParams.get("id");` |
| Production `lesson.html` does NOT serve `const LESSON_ID` | **PASS** — `const LESSON_ID = urlParams.get` absent |
| Fix comment present on prod | **PASS** — lines 490–491 (`// \`let\` (not \`const\`)…` / `// See docs/NAVIGATION_ROOT_CAUSE.md §6…`) |
| Prod `lesson.html` == local HEAD `lesson.html` (commit 7d7689c) | **PASS** — byte-identical modulo the Vercel-injected `vercel.live` feedback tag (which Vercel adds to live deployments, not a source change) |
| Prod `lesson.html` == Preview `lesson.html` (same fix) | **PASS** — identical fix lines on both |

### Post-promote unauth smoke test (Playwright, real production, read-only)

Opened `https://www.daubepnho.store/` and `https://www.daubepnho.store/lesson.html?id=13735c5c-1245-460f-bf0f-e57d69311e9b` headless:

| Assertion | Result |
|---|---|
| Homepage HTTP status | **200** |
| `lesson.html` HTTP status | **200** |
| `LESSON_ID` type = string, `navigateToLesson` defined | PASS |
| **Reassign probe** `LESSON_ID = "x"` (the direct negative test for the root cause) | **OK — no throw** (pre-fix prod threw `TypeError: Assignment to constant variable` here) |
| `pageErrors` | **[] (zero JS exceptions)** |
| Console errors | one `401 Failed to load resource` for `/api/lms/portal?endpoint=lesson` — **expected** for an unauthenticated visitor (no LMS session); same auth-gated behavior as before, not a regression |
| 5xx requests | **none** |

### Deployment IDs

| Role | Deployment URL | Deployment ID |
|---|---|---|
| **Before promote** (rollback target) | `https://web-lms-chinh-thuc-kzo8fv1q5.vercel.app` | `dpl_3K7xUVcTE1DGxApLBdrwpHLucrGV` |
| **After promote** (current prod) | `https://web-lms-chinh-thuc-cirwy9cp1.vercel.app` | `dpl_9fs7awTqRJmwdNM366CzZoDdCAuZ` |
| Source commit | `7d7689ca99a9b05daa640c9207aec375cd472c3d` | `fix(lms): restore SPA lesson navigation` |
| Domain assignment | `www.daubepnho.store` → `web-lms-chinh-thuc-cirwy9cp1.vercel.app` | (aliases also include `daubepnho.store`, `web-lms-chinh-thuc.vercel.app`) |

### Limitation (stated)

**Automated authenticated smoke was not run on production.** The unauth probe above confirms the deployed `let` binding and zero pageerror. The authenticated prev/next/sequence/back-forward behavior is covered by the **local-stub Playwright gate** (20 navs, 0 pageerror, 0 full reload, Plan C 19/19 = 0 `endpoint=lesson` calls, fallback 1/1, back/forward OK — see `## P0 Fix Verification`). The prod authed path needs a real student session, which the owner must test manually (next section).

### Owner manual test required (with a real student account)

Please, on `https://www.daubepnho.store` with a real enrolled student session:
1. Hard-refresh once (Ctrl+Shift+R) to bypass any cached `const` HTML.
2. Open a lesson that has **both** Bài Trước and Bài Tiếp.
3. Click **Bài Tiếp** → confirm URL changes to the next lesson id, title/content changes, no full-page reload.
4. Click **Bài Trước** → confirm URL + content change back, no reload.
5. Click **Next → Next → Previous → Previous** → confirm each step paints the correct lesson, no race, buttons never wrongly disabled.
6. Use browser **Back** and **Forward** → confirm each restores the correct lesson (URL + content).
7. Confirm URL and content change **together** (SPA swap, not a reload).
8. Note the perceived speed of lesson switching (should be near-instant for Plan C hits; the first paint of a fresh lesson still pays the backend cost — that's P1, out of scope here).

If any serious defect appears: **stop**, report it, and the rollback target is below. I will **not** self-rollback without your explicit approval.

### Rollback target (confirmed)

- **Rollback = re-promote the pre-promote production deployment:**
  ```
  vercel promote https://web-lms-chinh-thuc-kzo8fv1q5.vercel.app --yes
  ```
  (`dpl_3K7xUVcTE1DGxApLBdrwpHLucrGV`, Ready, source = commit `3c306b8` — the P0 fix's parent, `perf(lms): self-host Tailwind Play bundle`.)
- That restores the pre-fix production state (the `const` bug returns; prev/next go back to dead; self-host Tailwind + SPA infrastructure remain).

### What was NOT done (still in force)

- No merge to `main`. No git commit, no push, no amend, no force-push.
- No `vercel deploy` / `vercel deploy --prod` (promote rebuilt from the existing Preview source — no new code).
- No code change, no P1 work.
- No self-rollback. No production DB write. No token minting.
- No automated authed smoke on production (limitation stated; owner manual test requested).

P0 production promotion complete. Stopping here per instructions.
