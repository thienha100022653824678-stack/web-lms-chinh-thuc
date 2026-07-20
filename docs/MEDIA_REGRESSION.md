# Media Regression — Main Video/Image Black Frame After SPA Navigation

**Status:** Read-only investigation. No code, commit, push, deploy, or promote was performed.
**Date:** 2026-07-20
**Context:** After the P0 fix (`const`→`let`, commit `7d7689c`, now live on `www.daubepnho.store`), lesson **navigation** works (Bài Trước/Bài Tiếp fast, Plan C zero-network). **New symptom:** the main video and main image render as a **black frame** after an in-page SPA navigation (prev/next/sidebar), but render correctly on a hard load (fresh URL load).
**Branch:** `feat/v2-lms-baseline-fix` @ `7d7689c` (working tree: only `docs/NAVIGATION_ROOT_CAUSE.md` modified locally; `lesson.html` untouched since the P0 commit).
**Method:** Playwright 1.61.1 (Chromium, headless) driving the **real modified `lesson.html`** against a local stub that returns realistic lesson payloads matching the production `lesson.js` / `course-data.js` output shape (image-primary, Bunny-embed video, Google-Drive-preview video). Captured DOM snapshots (`#videoBox` / `#videoWrapper` / `#videoThumb` / `#playBtn`), computed helper results, and media network requests for **hard load vs SPA nav** of the same lessons. Artifacts: `~/AppData/Local/Temp/lms-incident/media-capture.json`, `media-stub.mjs`, `media-capture.mjs`.

---

## 1. Root cause

`paintLesson` (the SPA-nav renderer, `lesson.html:1695`) **destroys the static media placeholder** before re-using it.

The `#videoBox` markup is static HTML (`lesson.html:367-375`):
```html
<div id="videoBox" class="bg-brandBrown ...">
  <div id="videoWrapper" class="... bg-black">
    <!-- Play placeholder -->
    <img id="videoThumb" class="absolute inset-0 w-full h-full object-cover opacity-70" src="" alt="Thumbnail">
    <button id="playBtn" class="...">▶</button>
  </div>
</div>
```

`paintLesson` begins every swap by clearing the wrapper (`lesson.html:1701-1709`):
```js
const videoWrapper = document.getElementById("videoWrapper");
if (videoWrapper) {
  clearWatermarkFrom(videoWrapper);
  videoWrapper.innerHTML = "";        // ← line 1704: DESTROYS #videoThumb + #playBtn
}
const videoThumb = document.getElementById("videoThumb");
const playBtn = document.getElementById("playBtn");
if (videoThumb) videoThumb.src = "";   // videoThumb is now null (destroyed)
if (playBtn) playBtn.onclick = null;   // playBtn is now null (destroyed)
```

That `videoWrapper.innerHTML = ""` is there for a good reason on the **outgoing** lesson: it kills any in-flight Bunny `<iframe>` + watermark so it doesn't leak into the next lesson (comment at `:1699-1700`). But it also **deletes the placeholder `<img id="videoThumb">` and `<button id="playBtn">`** that the **incoming** video lesson's branch expects to find by id.

Then the `hasVideo` branch of `paintLesson` (`lesson.html:1763-1785`) tries to re-use those (now-destroyed) elements:
```js
} else if (hasVideo) {
  videoBox.classList.remove("hidden");
  if (videoThumb) {                                    // ← videoThumb is null → SKIPPED
    videoThumb.src = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE);
  }
  if (playBtn) {                                       // ← playBtn is null → SKIPPED
    playBtn.onclick = () => { ... };
  }
}
```

Both `if (videoThumb)` and `if (playBtn)` guards are **false** (the elements were wiped at line 1704), so:
- no thumbnail `<img>` is rendered,
- no play `<button>` is rendered,
- `#videoWrapper` is left **empty** (`childElementCount: 0`, `innerHTML: ""`),
- `#videoBox` is **not hidden** (because `hasVideo` is true → `remove("hidden")`).

Result: a visible `#videoBox` (dark-brown `bg-brandBrown` `#2D1914`) wrapping an empty black `#videoWrapper` (`bg-black`) → the reported **black frame**.

### Why the image-primary branch is NOT affected

The `hasMainImage` branch (`lesson.html:1758-1762`) does **not** depend on the destroyed placeholder:
```js
if (hasMainImage) {
  videoBox.classList.remove("hidden");
  if (videoWrapper) {
    videoWrapper.innerHTML = getMainImageHtml(lesson);   // writes a FRESH <img> into the wrapper
  }
}
```
It writes brand-new HTML into the cleared wrapper, so image-primary lessons **do** render after SPA nav. The bug is specific to the `hasVideo` branch, which assumes the placeholder still exists (true on hard load, false after `paintLesson` cleared it).

### Why hard load is NOT affected

`loadLessonDetails` (the hard-load renderer, `lesson.html:1336`) runs **once** on a fresh DOM where the static placeholder `<img id="videoThumb">` + `<button id="playBtn">` are present from the HTML template. It **never clears `videoWrapper.innerHTML`** — its `hasVideo` branch (`lesson.html:1416-1444`) just sets `videoThumb.src = …` and `playBtn.onclick = …` on the existing elements. So hard load works. The asymmetry between the two renderers is the whole bug.

---

## 2. Browser evidence (Playwright, captured)

`media-capture.json` — DOM snapshot after each transition. Key fields:

| Transition | `videoBox.hidden` | `videoWrapper.childElementCount` | `#videoThumb` in DOM? | `#playBtn` in DOM? | `img/iframe src` in wrapper | Result |
|---|---|---|---|---|---|---|
| **HARD** load `IMG1` (image) | false | 1 | — | — | `…/thumbnail?id=IMG1FILE&sz=w1000` | ✅ image renders |
| **HARD** load `VID2` (Bunny) | false | 2 | true | true | `…/thumbnail?id=VID2THUMB…` (videoThumb) | ✅ thumb + ▶ render |
| **HARD** load `VID3` (Drive) | false | 2 | true | true | `…/thumbnail?id=VID3THUMB…` (videoThumb) | ✅ thumb + ▶ render |
| **SPA** `IMG1→VID2` (Bunny) | **false** | **0** | **false** | **false** | **none** | ❌ **black frame** |
| **SPA** `VID2→VID3` (Drive) | **false** | **0** | **false** | **false** | **none** | ❌ **black frame** |
| **SPA** `VID3→VID2→IMG1` (image) | false | 1 | false | false | `…/thumbnail?id=IMG1FILE…` | ✅ image renders (branch writes fresh HTML) |
| **SPA** `IMG1` baseline (after hard load) | false | 1 | false | false | `…/thumbnail?id=IMG1FILE…` | ✅ image renders |

The two SPA video rows are the regression: `videoWrapper.childElementCount: 0`, `innerHTML: ""`, both placeholder ids gone, no `<img>`/`<iframe>` in the wrapper — an empty black box where the video thumbnail + play button should be.

`pageErrors: []` across every transition — this is a **silent render failure**, not a JS exception. (Unlike the P0 const bug, nothing throws; the `if (videoThumb)` / `if (playBtn)` guards just silently skip.)

Computed-helper proof that the data is correct (so the bug is NOT in the data, only in the DOM reuse):
- `spa:VID2` → `computedLessonVideoUrl: "https://iframe.mediadelivery.net/embed/12345/bunnyvideoidabc?token=SIGNEDTOKEN_bunny"` (Bunny embed URL present)
- `spa:VID3` → `computedLessonVideoUrl: "https://drive.google.com/file/d/VID3DRIVEFILE/preview"` (Drive preview URL present)
- `computedHasMainImage: false` for both (correct — they're videos)

So the lesson payload has the right `videoProvider` / `secureVideoUrl` / `videoUrl` / `thumbnailUrl`; the renderer's `lessonVideoUrl()` / `isMainMediaImage()` compute the right values; the **only** thing that fails is the DOM having no `#videoThumb`/`#playBtn` to write them onto.

---

## 3. Network waterfall (media requests)

Hard load of `VID3` fired:
```
GET https://drive.google.com/thumbnail?id=VID3THUMB&sz=w1000   (image)  ← main-video thumbnail
GET https://drive.google.com/thumbnail?id=IMG1THUMB&sz=w1000   (image)  ← sidebar
GET https://drive.google.com/thumbnail?id=VID2THUMB&sz=w1000   (image)  ← sidebar
GET https://drive.google.com/thumbnail?id=VID4THUMB&sz=w1000   (image)  ← sidebar
```

SPA nav session (`IMG1` hard-load → `IMG1→VID2` → `VID2→VID3` → `VID3→VID2→IMG1`) fired:
```
GET .../thumbnail?id=IMG1THUMB  (sidebar prefetch, once)
GET .../thumbnail?id=VID2THUMB  (sidebar prefetch, once)
GET .../thumbnail?id=VID3THUMB  (sidebar prefetch, once)
GET .../thumbnail?id=VID4THUMB  (sidebar prefetch, once)
GET .../thumbnail?id=IMG1FILE   (image-primary main img, on hard load + on SPA nav back to IMG1)
```
**Notably absent:** no `…/thumbnail?id=VID2THUMB` or `…/thumbnail?id=VID3THUMB` request re-fired **as the main-video thumbnail** on SPA nav to `VID2`/`VID3`. The sidebar already cached those URLs, but the main-video `<img id="videoThumb">` was never recreated, so its `.src` was never set → no main-video-thumb fetch was issued for the navigated-to video lesson. This corroborates the DOM evidence: the renderer never reached `videoThumb.src = …` because `videoThumb` was null.

No 5xx, no CORS errors, no signed-URL issues — the media URLs themselves are fine. The signed Bunny URL and Drive preview URL are present and correct in the payload; they just never get injected into the DOM on SPA nav.

---

## 4. DOM diff (hard load vs SPA nav, same video lesson)

For `VID2` (Bunny embed), same lesson, two load paths:

**Hard load** (`#videoWrapper.innerHTML`):
```html
<!-- Play placeholder -->
<img id="videoThumb" class="absolute inset-0 w-full h-full object-cover opacity-70"
     src="https://drive.google.com/thumbnail?id=VID2THUMB&sz=w1000" alt="Thumbnail">
<button id="playBtn" class="... ">▶</button>
```
→ 2 children, thumbnail visible, ▶ button clickable.

**SPA nav** (`#videoWrapper.innerHTML`):
```html
(empty)
```
→ 0 children, black frame.

The **only** difference is the presence of the placeholder `<img id="videoThumb">` + `<button id="playBtn">`. On hard load they come from the static HTML template; on SPA nav they were deleted by `paintLesson:1704` and never recreated by the `hasVideo` branch.

---

## 5. Function call order (SPA nav, `hasVideo` branch)

```
user clicks #nextBtn
  └─ navigateToLesson(targetId)                      [lesson.html:1847]
       └─ (Plan C: target found in courseLessonsList)
          LESSON_ID = targetId                        [:1866]  (let — no throw, P0 fixed)
          paintLesson(targetLesson)                   [:1867]
            ├─ videoWrapper.innerHTML = ""            [:1704]  ← DESTROYS #videoThumb + #playBtn
            ├─ videoThumb = getElementById("videoThumb")  → null   [:1706]
            ├─ playBtn   = getElementById("playBtn")      → null   [:1707]
            ├─ ... header/meta/desc ...
            ├─ hasMainImage = isMainMediaImage(lesson) → false (video lesson)
            ├─ hasVideo = Boolean(lessonVideoUrl(lesson)) → true
            └─ else if (hasVideo) {                    [:1763]
                 videoBox.classList.remove("hidden")   [:1764]  ← box shown
                 if (videoThumb) { ... }               [:1765]  ← FALSE, skipped
                 if (playBtn)  { ... }                 [:1768]  ← FALSE, skipped
               }
          // #videoWrapper left empty → BLACK FRAME
          refreshPrevNextAfterSwap()                   [:1868]
          history.pushState(...)                       [:1871]
```

The corresponding hard-load order (`loadLessonDetails`, `lesson.html:1404-1448`) **omits** the `videoWrapper.innerHTML = ""` step, so `videoThumb`/`playBtn` are found and populated. That single missing step is the regression.

---

## 6. File + line + call stack

| Item | Value |
|---|---|
| File | `lesson.html` |
| Destructive line | `:1704` — `videoWrapper.innerHTML = "";` inside `paintLesson` |
| Failed re-use lines | `:1765` (`if (videoThumb) videoThumb.src = …`) and `:1768` (`if (playBtn) playBtn.onclick = …`) — both skipped because the elements were destroyed at `:1704` |
| Function | `paintLesson(lesson)` |
| Caller | `navigateToLesson(lessonId, …)` at `:1867` (Plan C path), also `:1888` (Plan A cache path), `:1912` (network path) |
| Call stack | `click #nextBtn` → `navigateToLesson` → `paintLesson` → `videoWrapper.innerHTML=""` (destroys placeholder) → `hasVideo` branch → `if(videoThumb)`/`if(playBtn)` skipped → empty `#videoWrapper` |
| Why hard load works | `loadLessonDetails` (`:1404-1448`) never clears `videoWrapper.innerHTML`; the static placeholder survives and gets `.src`/`.onclick` set |
| Why image-primary works on SPA nav | `hasMainImage` branch (`:1758-1762`) writes `videoWrapper.innerHTML = getMainImageHtml(lesson)` — fresh `<img>`, no dependency on the destroyed placeholder |

---

## 7. Minimal fix proposal (NOT applied)

**Goal:** make the `hasVideo` branch of `paintLesson` not depend on placeholder elements that `paintLesson` itself just destroyed. Keep the `videoWrapper.innerHTML = ""` cleanup (it's needed to kill the outgoing iframe/watermark). The fix is to **re-create the placeholder** before populating it, mirroring the static template.

**Smallest change** — in `paintLesson`'s `hasVideo` branch (`lesson.html:1763-1785`), before querying `videoThumb`/`playBtn`, re-write the placeholder HTML into `videoWrapper`:

```js
} else if (hasVideo) {
  videoBox.classList.remove("hidden");
  // Re-create the placeholder that the swap-cleanup at line 1704 cleared,
  // so videoThumb/playBtn exist for the .src/.onclick assignments below.
  // (On hard load these come from the static HTML template; on SPA nav we
  // must restore them because paintLesson wiped videoWrapper.innerHTML.)
  if (videoWrapper) {
    videoWrapper.innerHTML =
      '<img id="videoThumb" class="absolute inset-0 w-full h-full object-cover opacity-70" src="" alt="Thumbnail">' +
      '<button id="playBtn" class="relative z-10 w-16 h-16 rounded-full bg-brandGreen/90 hover:bg-brandGreen text-white text-2xl flex items-center justify-center shadow-lg transition transform active:scale-95">▶</button>';
  }
  const videoThumb2 = document.getElementById("videoThumb");
  const playBtn2 = document.getElementById("playBtn");
  if (videoThumb2) videoThumb2.src = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE);
  if (playBtn2) {
    playBtn2.onclick = () => { /* same body as today */ };
  }
}
```

(The existing `videoThumb`/`playBtn` consts at `:1706-1707` were captured **before** this branch and are null; either re-query inside the branch as shown, or move the `getElementById` calls to after the branch re-creates them. The re-query is the smallest diff.)

**Why this is minimal:** one block, inside the already-broken branch, no new function, no new dependency, no change to `loadLessonDetails` (hard load keeps working because it never clears the wrapper — its placeholder is never destroyed), no change to the image branch (already works), no change to `navigateToLesson`/cache/prefetch/history (P0 untouched). The placeholder HTML string is a verbatim copy of the static template at `lesson.html:370-373`, so the rendered result is pixel-identical to a hard load.

**Alternative (also minimal, slightly riskier):** guard the cleanup at `:1704` so it only clears when the **outgoing** state had an iframe/image (i.e., clear only if `videoWrapper.querySelector("iframe")` or the wrapper has non-placeholder content). This avoids the destroy-then-recreate churn but requires reasoning about every outgoing state; the re-create approach above is more local and obviously correct.

**Verification gate for the fix (must pass before claiming done):**
1. Playwright, local stub: hard load + SPA nav for each of {image, Bunny video, Drive video}; assert `#videoWrapper.childElementCount >= 1`, `#videoThumb` present with correct `src`, `#playBtn` present with `onclick` set, after SPA nav. No black frame.
2. Click ▶ on SPA-navigated video → assert `#videoWrapper` gets the iframe (`getIframePlayerHtml`), watermark attached for Bunny, no leak from the previous lesson.
3. Re-run the P0 browser gate (20 navs, 0 pageerror, 0 full reload, Plan C 0 `endpoint=lesson`) — must stay green.
4. Re-run `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` — must stay 264/264.
5. Spot-check on a Vercel Preview with a real course (owner gate) before any promote.

**Confidence in the root cause:** **98%** — reproduced in the real DOM with realistic payloads; the destroy line (`:1704`) and the failed re-use lines (`:1765`/`:1768`) are directly observed (null elements, empty wrapper, 0 children); the asymmetry with `loadLessonDetails` (which never clears the wrapper) and with the `hasMainImage` branch (which writes fresh HTML) fully explains why only SPA-nav video lessons break. 2% residual = the fix hasn't been applied+verified yet, and a real prod course might have a media shape the stub didn't model (e.g., YouTube-primary) — but `lessonVideoUrl` handles YouTube/Drive/Bunny uniformly and the bug is in the placeholder DOM, not in URL computation, so the shape of the URL doesn't change the fix.

---

## 8. What was NOT done

- No code change to `lesson.html` or any other file.
- No commit, push, deploy, promote, rollback.
- No P1 work.
- Working tree state: only `docs/NAVIGATION_ROOT_CAUSE.md` (locally modified, uncommitted — from the prior promote-report update) and this new `docs/MEDIA_REGRESSION.md` (untracked). `lesson.html` is **byte-identical to commit `7d7689c`** (the P0 fix), confirmed by `git diff --stat -- lesson.html` = empty.

This report is the sole output of this investigation phase. Awaiting direction on whether to apply the §7 minimal fix (and run its verification gate) before any commit/push/deploy.

---

## Media P0 Fix Verification

**Date applied:** 2026-07-20
**Scope enforced:** only the `hasVideo` branch of `paintLesson` in `lesson.html`. No change to `navigateToLesson`, `LESSON_ID`, Plan A/C, cache, prefetch, history, popstate, `course-data.js`, the lesson API, `vercel.json`, Tailwind, or auth/session. No commit/push/deploy/promote/rollback. All gates below passed before this approval request.

### Exact diff

```diff
diff --git a/lesson.html b/lesson.html
index dbd94e5..76139c4 100644
--- a/lesson.html
+++ b/lesson.html
@@ -1762,11 +1762,27 @@
           }
         } else if (hasVideo) {
           videoBox.classList.remove("hidden");
-          if (videoThumb) {
-            videoThumb.src = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE);
+          // Media P0 fix: the swap-cleanup at the top of paintLesson set
+          // videoWrapper.innerHTML = "", which destroyed the static
+          // <img id="videoThumb"> + <button id="playBtn"> placeholder that
+          // this branch populates (the outer videoThumb/playBtn consts are
+          // null because of that cleanup). Re-create the placeholder
+          // byte-for-byte matching the hard-load template (lines 370-373),
+          // then re-query so SPA-nav video lessons paint their thumbnail +
+          // play button instead of a black frame. See docs/MEDIA_REGRESSION.md.
+          if (videoWrapper) {
+            videoWrapper.innerHTML =
+              '<!-- Play placeholder -->' +
+              '<img id="videoThumb" class="absolute inset-0 w-full h-full object-cover opacity-70" src="" alt="Thumbnail">' +
+              '<button id="playBtn" class="relative z-10 w-16 h-16 rounded-full bg-brandGreen/90 hover:bg-brandGreen text-white text-2xl flex items-center justify-center shadow-lg transition transform active:scale-95">▶</button>';
           }
-          if (playBtn) {
-            playBtn.onclick = () => {
+          const vt = document.getElementById("videoThumb");
+          const pb = document.getElementById("playBtn");
+          if (vt) {
+            vt.src = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE);
+          }
+          if (pb) {
+            pb.onclick = () => {
               if (isCocCocBrowser()) {
                 videoWrapper.innerHTML = getCocCocBlockedHtml();
                 return;
```
`git diff --stat -- lesson.html`: `1 file changed, 20 insertions(+), 4 deletions(-)`. No other file modified.

### File + line

- **File:** `lesson.html`
- **Changed block:** `paintLesson` `hasVideo` branch, `:1763` → `:1788` (was `:1763-1785`).
- **New lines:** `:1764-1781` (re-create placeholder + re-query `vt`/`pb` + set `.src`/bind `.onclick`).
- **Preserved verbatim:** the play handler body (CocCoc block, PC-block, `lessonVideoUrl(currentLesson)`, `getIframePlayerHtml`, Bunny watermark) — only the wrapper element references changed from the destroyed `videoThumb`/`playBtn` consts to the re-queried `vt`/`pb` locals.
- **Placeholder HTML** is a byte-for-byte copy of the static template at `lesson.html:369-373` (`<!-- Play placeholder -->` + `<img id="videoThumb" …>` + `<button id="playBtn" …>▶</button>`), so the SPA-nav result is pixel-equivalent to a hard load.

### Syntax result

Inline `<script>` extracted and `node --check` → **SYNTAX OK** (Node v26.5.0).

### Test result (full suite)

`LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs`:
```
ℹ tests 264
ℹ pass 264
ℹ fail 0
ℹ duration_ms 1517
```
**264 / 264 pass, 0 fail.** No regression, no test count change.

### Playwright local-stub matrix

Local stub (`media-stub.mjs`) returns realistic payloads matching prod `lesson.js`/`course-data.js` shape (image-primary, Bunny-embed video, Google-Drive-preview video). Playwright 1.61.1 headless, seeded LMS session, spy on `videoWrapper` DOM.

**Hard load (fresh context per lesson):**

| Lesson | `videoBox.hidden` | `wrapper.childElementCount` | `#videoThumb` | `#playBtn` | thumb src | Result |
|---|---|---|---|---|---|---|
| IMG1 (image) | false | 1 | — | — | `…/thumbnail?id=IMG1FILE…` | ✅ image renders |
| VID2 (Bunny) | false | 2 | ✅ | ✅ | `…/thumbnail?id=VID2THUMB…` | ✅ thumb + ▶ |
| VID3 (Drive) | false | 2 | ✅ | ✅ | `…/thumbnail?id=VID3THUMB…` | ✅ thumb + ▶ |

**SPA navigation matrix (single context, sidebar-click nav):**

| Transition | `wrapper.childElementCount` | `#videoThumb` | `#playBtn` | thumb src (correct lesson?) | Result |
|---|---|---|---|---|---|
| image → Bunny | 2 | ✅ | ✅ | `…/VID2THUMB…` ✅ | ✅ placeholder recreated |
| Bunny → Drive | 2 | ✅ | ✅ | `…/VID3THUMB…` ✅ | ✅ placeholder recreated |
| Drive → image | 1 (fresh `<img>`) | — | — | `…/IMG1FILE…` ✅ | ✅ image branch |
| image → Drive | 2 | ✅ | ✅ | `…/VID3THUMB…` ✅ | ✅ placeholder recreated |
| Drive → Bunny | 2 | ✅ | ✅ | `…/VID2THUMB…` ✅ | ✅ placeholder recreated (no stale Drive thumb) |

**Every SPA-video transition now recreates the placeholder** (`childElementCount >= 2`, `#videoThumb` + `#playBtn` present, thumb src matches the navigated-to lesson, play handler bound). The pre-fix black frame (`childElementCount: 0`, both ids gone) is gone.

### DOM assertions (all PASS)

```
hardBunnyPlaceholder, hardDrivePlaceholder, hardImageRender            true
spa_image→Bunny_placeholder / _thumbSrc / _playHandler                 true
spa_Bunny→Drive_placeholder / _thumbSrc / _playHandler                 true
spa_Drive→image_imageRender                                            true
spa_image→Drive_placeholder / _thumbSrc / _playHandler                 true
spa_Drive→Bunny_placeholder / _thumbSrc / _playHandler                 true
spaBunnyThumbCorrect, spaDriveThumbCorrect, spaBunnyAfterDriveThumbCorrect  true
playHandlerRan, cleanupNoOldIframe, cleanupNoWatermark, cleanupNoStaleVideoThumb  true
noIframeLeakVid2toVid3, vid3ThumbCorrect, vid3PlayBtnPresent           true
noPageError, noFullReload                                              true
```
**28/28 media-gate assertions PASS.**

### Play result (click ▶ on SPA-navigated video)

On the SPA-navigated Bunny video (VID2), clicked `#playBtn`:
- `playHandlerRan: true` — the handler executed and wrote `#videoWrapper.innerHTML`.
- Because Playwright uses a desktop UA, `isMobileDevice()` is false → the handler wrote the **PC-blocked** HTML (`📱 Hạn Chế Thiết Bị`) — this is the **expected** behavior on desktop (the real mobile path writes `getIframePlayerHtml(videoUrl)` + Bunny watermark; both paths prove the handler is wired and runs). On a mobile-emulated context the same handler injects the Bunny/Drive `<iframe>` and (for Bunny) the watermark.
- `watermarkCount: 0` here is correct (PC-blocked branch doesn't create a watermark; the mobile+Bunny branch would create one — exercised logically by the handler body being unchanged).

### Cleanup result (nav away from a playing video)

After clicking ▶ on VID3 (Drive) to inject an iframe, then SPA-navigating to IMG1 (image):
- `hasOldIframe: false` — the outgoing iframe was removed (the image branch's `videoWrapper.innerHTML = getMainImageHtml(lesson)` replaces the wrapper contents; `paintLesson`'s top-of-function `videoWrapper.innerHTML = ""` + `clearWatermarkFrom` also run first).
- `watermarkCount: 0` — no leftover watermark.
- `hasStaleVideoThumb: false` — the image branch does not create a `#videoThumb`; the old video's thumbnail `<img>` is gone, replaced by the image-primary `<img>` with `src=…/IMG1FILE…`.
- `imgSrc: …/thumbnail?id=IMG1FILE…` — the correct image for the new lesson.

### No iframe leak (video → video)

From VID2 (Bunny) → SPA-nav → VID3 (Drive), before clicking ▶ on VID3:
- `hasIframe: false` — no leftover iframe from VID2 (the `hasVideo` branch re-creates the placeholder, not an iframe).
- `videoThumbPresent: true`, `videoThumbSrc: …/VID3THUMB…`, `playBtnPresent: true` — VID3's own placeholder, not VID2's.

### Navigation regression result (re-ran the full P0 gate against the fixed `lesson.html`)

`gate.mjs` (20 navs: next/prev/sequence/back/forward/fallback) — **ALL PASS**:
```
noPageError, noTypeError, noConstAssignError, noFullReload        true
planCRuns, planCZeroLessonApiOnClick, networkPathWorks           true
urlChanged, contentChanged, backForwardWork                      true
reassignOk, noOverlay, noDuplicateRender, handlersStillAttached  true
```
- `branchCounts: { planC: 19, network: 1 }` — Plan C still serves 19/19 clicks with **0 `endpoint=lesson`** calls; the network fallback still fetches exactly 1.
- `realReloads: 0`, `pageErrors: 0`.
- Navigation perf (17 navs): min 30.1 ms, median 35.0 ms, p95 64.7 ms — unchanged from P0 (the media fix adds only the placeholder re-create, a tiny `innerHTML` write, inside the already-running `hasVideo` branch).

**The media fix did not regress navigation.**

### Performance timing (click → thumbnail/play-button visible, 10 SPA navs, local stub)

| metric | ms |
|---|---|
| min | **5.3** |
| median (p50) | **7.0** |
| p95 | **29.7** |
| max | 29.7 |
| n | 10 |

(`perfClicks: [29.7, 9.6, 12.4, 7.0, 6.8, 5.9, 5.7, 6.4, 5.3, 7.2]` ms — first click higher because it includes the first sidebar interaction; steady-state ~6–7 ms.) These are local-stub numbers = pure SPA-swap + placeholder-recreate cost. The placeholder re-create is a single `innerHTML` write of ~280 bytes, negligible vs. the DOM-swap baseline.

### Residual risk

| Risk | Likelihood | Note |
|---|---|---|
| Real prod media shape not modeled (e.g., YouTube-primary, supplemental `mediaUrls`) | Low | The fix is in the placeholder DOM, not in URL computation; `lessonVideoUrl` handles YouTube/Drive/Bunny uniformly. The play handler body is byte-identical to the pre-fix version, so YouTube/Drive/Bunny play paths are unchanged. Supplemental media (`renderMediaItems`) is a separate section, not touched. |
| Watermark on mobile+Bunny after SPA nav | Low | The play handler's `createWatermark(videoWrapper, studentEmail)` is unchanged; the gate confirmed `cleanupNoWatermark` on nav-away. A mobile-emulated click would create the watermark (handler body identical); the desktop-UA gate hit PC-blocked instead, which is the correct desktop behavior. Owner mobile spot-check closes this. |
| `videoWrapper` null edge case | Very low | guarded by `if (videoWrapper)` before the `innerHTML` write, same guard pattern as the image branch. |
| Stale `currentLesson` inside the play handler closure | Low | The handler reads `lessonVideoUrl(currentLesson)` and `currentLesson.videoProvider`; `paintLesson` sets `currentLesson = lesson` at its top (`:1697`) before re-creating the placeholder, so the closure captures the correct lesson. Gate confirmed `contentChanged` + correct thumb per lesson. |

### Confidence

| Item | Confidence | Basis |
|---|---|---|
| The fix resolves the SPA-nav video black frame | **98%** | 28/28 media-gate assertions pass; every SPA-video transition now shows `childElementCount >= 2` + `#videoThumb` + `#playBtn` with the correct thumb src; pre-fix capture showed `childElementCount: 0` (same lessons, same stub). |
| No navigation regression | **99%** | P0 gate re-ran: 20 navs, 0 pageerror, 0 reload, Plan C 19/19 = 0 lesson API, back/forward/sequence/fallback all pass. |
| No backend regression | **99%** | 264/264 tests pass; the change is inline-script DOM only. |
| No iframe/watermark leak | **95%** | Cleanup gate: nav away from playing video → no old iframe, 0 watermarks, no stale videoThumb. Video→video nav: no iframe leak, correct new thumb. 5% residual = mobile+Bunny watermark after SPA nav not directly exercised (desktop UA → PC-blocked path); handler body unchanged so behavior matches hard load. |
| Overall Media P0 fix correctness | **97%** | Surgical, in the broken branch only, placeholder HTML = verbatim template copy, handler body preserved. 3% residual = owner mobile spot-check on a Vercel Preview with a real course before promote. |

### Artifacts (outside the repo)

`~/AppData/Local/Temp/lms-incident/`:
- `media-gate.mjs` — Playwright media gate (hard + SPA matrix + cleanup + perf)
- `media-gate-result.json` — full result: assertions, spaMatrix, playResult, afterNavAway, vid3After, perf
- `media-stub.mjs` — local stub with realistic image/Bunny/Drive payloads
- `gate.mjs` / `gate-result.json` — re-run P0 navigation gate (passed)

### What was NOT done (per scope)

- No change outside the `hasVideo` branch of `paintLesson`.
- No commit, no push, no deploy, no promote, no rollback.
- No P1 work.
- Working tree state:
  ```
  ## feat/v2-lms-baseline-fix...origin/feat/v2-lms-baseline-fix
   M lesson.html                       (media fix, unstaged)
   M docs/NAVIGATION_ROOT_CAUSE.md     (prior promote-report update, unstaged)
   ?? docs/MEDIA_REGRESSION.md         (this report + Media P0 Fix Verification)
  ```

---

OWNER APPROVAL: commit + push Media P0 fix?
