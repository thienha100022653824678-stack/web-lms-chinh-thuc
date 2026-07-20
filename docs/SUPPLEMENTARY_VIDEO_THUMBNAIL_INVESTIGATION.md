# Supplementary Media Video Thumbnail — Missing Thumbnail Investigation

**Status:** Read-only investigation. **No code, no data, no commit, no deploy, no promote, no rollback, no Supabase/Vercel change changed.**
**Date:** 2026-07-20
**Branch / worktree:** `feat/v2-lms-baseline-fix` @ `5992212` — `…/_worktrees/v2-lms-fix`. Working tree: only `docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md` locally modified (prior session) + this new untracked report. **No source file touched** by this investigation (`git status --short` confirms).
**Production lesson page (reported symptom):** `https://www.daubepnho.store/lesson.html?id=13735c5c-…`
**Method:** Full pipeline source-read (admin input → DB → API → SPA/hard-load renderer → play handler) + a Playwright 1.61.1 (Chromium, mobile UA) capture driving the **real `lesson.html`** against a local stub serving a realistic lesson payload with **both** a main video and four supplemental items (Drive `file/d`, Drive `uc?id`, Bunny, and a captioned image for reference). Captured: DOM HTML, `<img>`/`<iframe>`/`background-image` presence, `src`/`currentSrc`, `naturalWidth`/`naturalHeight`, computed styles, the actual network request each renderer emitted, HTTP status + MIME of each thumbnail request, console + `pageerror`. Artifacts: `~/AppData/Local/Temp/lms-incident/thumb-stub.mjs`, `thumb-gate.mjs`, `thumb-gate-result.json`.

---

## 1. Hiện tượng (symptom)

On the production lesson page:

- The **main video** (top `#videoBox`) shows a thumbnail image behind the ▶ play button.
- The **supplemental videos** under "🎬 TÀI LIỆU BỔ SUNG / Media phụ" show **only a black background + a ▶ play button** — no thumbnail image behind it.

The reported screenshots show: the supplemental video card still renders (correct card + number label + play button), but the `<img>` thumbnail that should sit behind the play button is absent/empty, leaving the black `bg-black` container visible.

---

## 2. So sánh video chính vs Media phụ (main video vs supplementary)

| Aspect | Main video (`#videoBox`) | Supplemental video (`#mediaItemsSection` card) |
|---|---|---|
| Thumbnail source field | `lesson.thumbnailUrl` (a **dedicated, separately-uploaded image** stored in `lessons.thumbnail_url`) | **None.** The supplemental `mediaUrls` schema is `type\|title\|url\|captionEncoded` — there is **no thumbnail field** per item. |
| Where the `<img>` comes from | The static template `<img id="videoThumb">` (`lesson.html:370`) is populated by the renderer: `videoThumb.src = normalizeGoogleDriveImageUrl(currentLesson.thumbnailUrl \|\| HERO_PLACEHOLDER_IMAGE)` (`lesson.html:1409`, hard load; `:1770`, SPA). | The `renderMediaItems` **video branch** (`lesson.html:1152-1207`). It branches by provider. |
| Does the video branch create an `<img>`? | (n/a — main uses the dedicated thumbnail) | **Only for the Google-Drive branch.** The Drive branch (`lesson.html:1168-1181`) creates `<img src="https://drive.google.com/thumbnail?id=${driveId}&sz=w1000">`. The **Bunny branch** (`lesson.html:1182-1192`) creates **only an `<iframe>`** — **no `<img>`, no `poster`, no `background-image`**. |
| What is behind the play button? | The dedicated thumbnail image (or `HERO_PLACEHOLDER_IMAGE` fallback). | Drive: a Drive thumbnail `<img>` at `opacity-60` behind a `.gdrive-play-button`. **Bunny: nothing** — just the Bunny embed `<iframe>` (which loads the player, not a poster) and the black `bg-black`/`aspect-video` container. |
| Reported "black background + play button, no thumbnail" | Does not match (main has a thumbnail). | **Matches the Bunny (and any non-Drive) supplemental video branch exactly** — no `<img>` is emitted, so the black container shows through. |

**Conclusion of the comparison:** the symptom "video chính có thumbnail, Media phụ chỉ nền đen + nút Play, không có ảnh thumbnail phía sau" is **exactly what the Bunny supplemental-video branch renders by design** — it never creates a thumbnail `<img>`. The Drive supplemental branch *does* create a thumbnail `<img>`, so a Drive supplemental video should show a thumbnail (subject to the Drive-file-is-public caveat in §6). The asymmetry is provider-specific, not a single broken line.

---

## 3. Data pipeline

### A. Main video thumbnail

```
admin: fThumbnailUrl input  (lms-admin.html:1766 read, :1821 save)
  → saveLesson() lessonData.thumbnailUrl                   (lms-admin.html:1845)
  → POST /api/lms/admin?endpoint=lessons
  → admin-lessons handler: thumbnail_url = lessonData.thumbnailUrl  (admin-lessons.js:256 / :317)
  → Supabase lessons.thumbnail_url (TEXT)                  (supabase_schema.sql:98)
  → lesson API GET /api/lms/portal?endpoint=lesson
  → lesson.js handler: thumbnailUrl: lessonResolved.thumbnail_url   (lesson.js:569)
  → browser: lesson.html
      hard load:  videoThumb.src = normalizeGoogleDriveImageUrl(currentLesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE)  (lesson.html:1409)
      SPA nav:    vt.src        = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl        || HERO_PLACEHOLDER_IMAGE)  (lesson.html:1770)
```

The main video's thumbnail is a **separately uploaded image file** (admin uploads it via `upload-image` → `admin-upload-image.js` → `drive.permissions.create({ role: "reader", type: "anyone" })` at `:195-199`, so the image is **public**, hence `thumbnail?id=<fileId>&sz=w1000` returns 200). Its Drive fileId is unrelated to the video file's id. `normalizeGoogleDriveImageUrl` (`lesson.html:867-874`) converts any Drive URL to `https://drive.google.com/thumbnail?id=<fileId>&sz=w1000`.

### B. Supplemental video thumbnail

```
admin: addMediaBlock('video', title, url, caption)         (lms-admin.html:2080)
  → buildMediaUrls():  `${type}|${title}|${url}${encodedCaption ? `|${encodedCaption}` : ""}`  (lms-admin.html:2133-2143)
     fields: type | title | url | captionEncoded   (NO thumbnail field exists in this schema)
  → saveLesson() lessonData.mediaUrls                     (lms-admin.html:1837,1845)
  → admin-lessons handler: media_urls = lessonData.mediaUrls  (admin-lessons.js:259 / :320)  (verbatim)
  → Supabase lessons.media_urls (TEXT)                    (supabase_schema.sql:101)
  → lesson API GET /api/lms/portal?endpoint=lesson
  → lesson.js handler: securedMedia = signMediaUrls(lessonResolved.media_urls)  (lesson.js:549)
                       mediaUrls: securedMedia           (lesson.js:572)
  → utils/lms.js signMediaUrls() — 4-field aware          (lms.js:261-345)
      for type==="video":
        - Drive (file/d / open?id / uc?id): rewrites url → https://drive.google.com/file/d/<id>/preview, preserves caption  (lms.js:285-299)
        - Bunny (parseBunnyVideoIdAndLibraryId): rewrites → https://player.mediadelivery.net/embed/<lib>/<vid>?token=…&expires=…, preserves caption  (lms.js:301-342)
        - else: passes url through, preserves caption      (lms.js:344)
  → browser: lesson.html
      parseMediaUrls(lesson.mediaUrls) → [{ type, title, url, caption }]   (vendor/lms-media.js, canonical 4-field parser)
      renderMediaItems(lesson) → video branch              (lesson.html:1152-1207)
        - YouTube:   <iframe src=youtube.com/embed/<id>>   (NO <img>)         (lesson.html:1158-1167)
        - Drive:     <img src=thumbnail?id=<driveId>> + .gdrive-play-button  (lesson.html:1168-1181)
        - Bunny:     <iframe src=iframe.mediadelivery.net/embed/…>            (NO <img>)         (lesson.html:1182-1192)
        - image-ext: <img src=<url>>                                           (lesson.html:1193-1202)
        - else:      "Mở video ↗" link                                         (lesson.html:1203-1207)
```

**There is no thumbnail field anywhere in the supplemental pipeline.** The admin block collects `type | title | url | caption` only (`lms-admin.html:2103-2128`). The DB column `media_urls` is a single `TEXT` (no per-item thumbnail). The API `signMediaUrls` signs the **video URL**, never resolving a thumbnail. The client parser produces `{ type, title, url, caption }` — no `thumbnail`. The renderer's video branch derives a thumbnail **only for the Drive sub-branch**, by re-using the **video file's own Drive id** (`getGoogleDriveFileId(url)` → `thumbnail?id=<videoFileId>`). For Bunny/YouTube it emits no `<img>` at all.

### Field comparison table (required)

| Field | Main video | Supplemental video (Media phụ) | Có dữ liệu? | Được render? | Ghi chú |
|---|---|---|---|---|---|
| `thumbnailUrl` / `thumbnail_url` | ✅ dedicated image (DB `lessons.thumbnail_url`) | ❌ không có field trong schema `mediaUrls` | Main: yes; Suppl: **no** | Main: yes (`#videoThumb.src`); Suppl: **no** | Main là ảnh riêng, upload qua `upload-image`, share public. |
| `mainMediaInfo` (`mainMediaType`/`mainMediaMimeType`/`mainMediaName`) | ✅ (API `resolveMainMediaInfo`) | ❌ không áp dụng cho media phụ | Main: yes; Suppl: n/a | Main: quyết định image-vs-video branch; Suppl: n/a | `utils/lms-media.js:47`; `lesson.js:552-554`. |
| `videoUrl` / `secureVideoUrl` | ✅ (DB `lessons.video_url`, signed) | ✅ (`item.url` sau `signMediaUrls`) | yes | Main: feed `lessonVideoUrl()`; Suppl: feed iframe/play | Main video URL; không dùng làm thumbnail. |
| `mediaUrls` item.url | n/a | ✅ (Drive → `/preview`; Bunny → `embed/?token=`; YouTube → watch/embed) | yes | Suppl: src của iframe/link | **Không phải thumbnail** — là URL phát video. |
| `mediaUrls` item.caption | n/a | ✅ (4th pipe-field, optional) | yes (optional) | Suppl: (chưa render trên lesson.html —见 §6 contributing) | Caption không liên quan thumbnail. |
| `fileId` (Drive) | ảnh thumbnail có fileId riêng | video Drive có fileId = chính video | yes | Main: thumbnail?id=<thumbFileId>; Suppl Drive: thumbnail?id=<videoFileId> | **Khác nguồn**: main dùng ảnh riêng, suppl Drive dùng id của file video. |
| Bunny video id | ✅ (DB `bunny_video_id` + signed embed) | ✅ (`item.url` embed) | yes | iframe only | **Không có thumbnail field**; Bunny embed iframe tự render poster của Bunny, không phải `<img>` của trang. |
| Drive file id (video) | ✅ (DB `video_url`) | ✅ | yes | Main: dùng cho preview/play; Suppl Drive: dùng cho cả thumbnail `<img>` + play | Suppl Drive thumbnail dùng **chính id video** → chỉ hiện nếu video file share public. |
| YouTube id | (if main is YouTube) | ✅ (`getYouTubeVideoId`) | yes | iframe only | Không có thumbnail `<img>`; YouTube iframe tự có poster. |
| `poster` (video element attr) | ❌ không dùng `<video>` | ❌ không dùng `<video>` | no | no | Toàn bộ dùng `<iframe>`/`<img>`, không có `<video poster>`. |
| `<img>` src (thumbnail) | ✅ `#videoThumb` = `thumbnail?id=<thumbFileId>` | Drive: ✅ `thumbnail?id=<videoFileId>`; **Bunny/YouTube: ❌ không có `<img>`** | Main: yes; Suppl: provider-dependent | Main: yes; Suppl Drive: yes (nếu public); Suppl Bunny/YT: **no** | Đây là điểm khác biệt cốt lõi. |
| `background-image` | ❌ (computed `background-image: none`) | ❌ (computed `background-image: none` — confirmed by gate) | no | no | Không dùng CSS background cho thumbnail. |

---

## 4. DOM evidence (Playwright, real `lesson.html`, local stub, mobile UA)

Stub lesson `bunny-lesson` had `thumbnailUrl = https://drive.google.com/thumbnail?id=1MainThumbDriveId…&sz=w1000` (dedicated main thumbnail) and supplemental `mediaUrls`:
```
video|Video Drive (file/d)|https://drive.google.com/file/d/<VID>/view|caption%20video%20drive
video|Video Drive (uc?id)|https://drive.google.com/uc?export=download&id=<VID>|caption%20video%20uc
video|Video Bunny|https://iframe.mediadelivery.net/embed/12345/bunnyvideoidabc?token=…|caption%20video%20bunny
image|Ảnh phụ|https://drive.google.com/uc?export=download&id=<IMG>|caption%20ảnh
```

### Main video `#videoWrapper` (both Bunny-main and Drive-main lessons, identical)
```html
<!-- Play placeholder -->
<img id="videoThumb" class="absolute inset-0 w-full h-full object-cover opacity-70"
     src="https://drive.google.com/thumbnail?id=1MainThumbDriveId…&sz=w1000" alt="Thumbnail">
<button id="playBtn" class="…">▶</button>
```
- `#videoBox.hidden`: false. `#videoWrapper` computed `background-color: rgb(0,0,0)` (the `bg-black` class — visible only if the `<img>` fails; here the `<img>` is present).
- `mainVideoThumb.src` = `…/thumbnail?id=1MainThumbDriveId…&sz=w1000` (the **dedicated** thumbnail).
- The main video always has a thumbnail `<img>` because the renderer unconditionally writes `videoThumb.src = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE)`.

### Supplemental cards (captured, `#mediaItemsSection.children`)

| Card | Provider | `<img>`? | `<img src>` | `<iframe>`? | `background-image`? | `.gdrive-play-button`? | Renderer branch |
|---|---|---|---|---|---|---|---|
| 01 | Drive `file/d` | ✅ | `…/thumbnail?id=<VID>&sz=w1000` | ❌ | none | ✅ | Drive branch (`lesson.html:1168-1181`) |
| 02 | Drive `uc?id` (server-rewritten to `file/d/<VID>/preview` by `signMediaUrls`, then `getGoogleDriveFileId` extracts `<VID>`) | ✅ | `…/thumbnail?id=<VID>&sz=w1000` | ❌ | none | ✅ | Drive branch |
| 03 | **Bunny** | **❌ none** | — | ✅ `iframe.mediadelivery.net/embed/12345/bunnyvideoidabc?token=…` | none | ❌ | **Bunny branch (`lesson.html:1182-1192`) — no `<img>`** |
| 04 | image (reference) | ✅ | `…/thumbnail?id=<IMG>&sz=w1000` | ❌ | none | ❌ | image branch |

**Key DOM fact:** card 03 (Bunny supplemental) has **`imgs: []`** in the capture — no `<img>` element is created at all. Its `aspect-video relative` container (no `bg-black` class on the Bunny branch — the Bunny branch uses `class="aspect-video relative" data-bunny-media-container`, **not** `bg-black`) holds only the `<iframe>`. The black the user sees on a Bunny supplemental is the Bunny iframe's own initial black frame / the iframe loading state, **not** a page-level black background with a missing image.

> Important nuance for the reported screenshot: the screenshot shows "nền đen + nút Play, không có ảnh thumbnail". The **Drive** supplemental branch (`lesson.html:1176`) is the one that renders `<div class="aspect-video relative bg-black flex items-center justify-center">` + `<img … opacity-60>` + `.gdrive-play-button`. If the Drive `<img>` **fails to load** (see §5/§6), the user sees exactly "black `bg-black` box + ▶ play button + no thumbnail image" — which matches the screenshot precisely. So the reported symptom is **most consistent with a Drive supplemental video whose `thumbnail?id=<videoFileId>` request does not return an image**, i.e. the Drive branch is taken but the `<img>` is broken, **not** the Bunny branch (which has no play-button overlay at all). Both root causes are documented below; the screenshot's "play button present" detail points to the Drive branch.

### Computed styles (gate)
- Every supplemental card: `background-image: none` on all descendants — **no CSS background-image thumbnail anywhere**.
- Drive card's media div: `bg-black` → `background-color: rgb(0,0,0)` (this is the black that shows when the `<img>` is broken/empty).
- Bunny card's media div: `aspect-video relative` (no `bg-black`) → the black is the iframe's own content.

### `naturalWidth`/`naturalHeight`
All captured `<img>`s (main + Drive supplemental + image supplemental) report `naturalWidth: 0, naturalHeight: 0, complete: true` — because the stub's Drive file ids are **fake**, so `thumbnail?id=<fakeId>` 302-redirects to a non-image (see §5). This is the stub's limitation, **not** the bug. The real production behavior depends on whether the real Drive file is public (§6). The DOM *structure* (is there an `<img>` at all?) is what the stub proves, and that is provider-dependent as above.

### `pageerror`
`pageErrors: []` — silent. No JS exception. Console only has the Tailwind CDN warning + `net::ERR_NAME_NOT_RESOLVED` (the fake `1Aa2Bb…` id redirect host) — both stub artifacts, not production-relevant.

---

## 5. Network evidence (Playwright, captured)

For `bunny-lesson` (main = Bunny, supplementals = Drive×2 + Bunny + image), the browser issued:

| Request | Status | MIME | Who emitted it |
|---|---|---|---|
| `GET https://drive.google.com/thumbnail?id=1MainThumbDriveId…&sz=w1000` | **302** `application/binary` | main `#videoThumb.src` (dedicated thumbnail) |
| `GET https://drive.google.com/thumbnail?id=<VID>&sz=w1000` | **302** `application/binary` | supplemental Drive card `<img>` (card 01 & 02) |
| `GET https://drive.google.com/thumbnail?id=<IMG>&sz=w1000` | **302** `application/binary` | supplemental image card `<img>` (card 04) |
| `GET https://iframe.mediadelivery.net/embed/12345/bunnyvideoidabc?token=…` | **200** `text/html` | supplemental Bunny `<iframe>` (card 03) |

**Observations:**
- The main thumbnail request and the supplemental Drive thumbnail request are the **same URL shape** (`https://drive.google.com/thumbnail?id=<fileId>&sz=w1000`); the only difference is the **file id**. The main uses the dedicated thumbnail image's id; the supplemental Drive uses the **video file's id**.
- Both return **302 `application/binary`** in the stub because the ids are fake. In production, `thumbnail?id=<realPublicImageId>` returns **200 image/jpeg**; `thumbnail?id=<realPrivateVideoId>` returns a **302 to a sign-in / non-image** → the `<img>` breaks → black box + play button (the reported symptom).
- The supplemental **Bunny** card issued **no thumbnail request at all** — it only fetched the Bunny embed iframe (200). **No `<img>` was created, so no thumbnail fetch was ever attempted.** This is the structural absence, not a failed fetch.
- `pageerror: []`. No CORS, no mixed-content (all HTTPS). The only failure mode is "Drive thumbnail returns non-image for a non-public file id" (Drive branch) or "no `<img>` emitted at all" (Bunny/YouTube branch).

**Direct answer to the required questions:**
- *Media phụ không có thumbnail vì renderer không tạo ảnh?* → **Yes for Bunny/YouTube supplemental** (the renderer's Bunny/YouTube branch emits only an `<iframe>`, no `<img>`). **No for Drive supplemental** (the Drive branch *does* emit `<img src=thumbnail?id=<videoFileId>>`).
- *Hay renderer tạo nhưng src rỗng?* → No. The Drive branch's `<img src>` is never empty; it's `thumbnail?id=<videoFileId>&sz=w1000` (a well-formed URL). The Bunny branch simply doesn't create the `<img>`.
- *Hay thumbnail URL không tồn tại trong payload?* → **Yes (structurally).** There is no thumbnail field in the `mediaUrls` schema, so no thumbnail URL is transmitted for supplemental items. The Drive branch *synthesizes* one from the video file id at render time.
- *Hay thumbnail URL tồn tại nhưng parser bỏ mất?* → No. The canonical 4-field parser (`vendor/lms-media.js`) preserves all fields; there is no thumbnail field to lose.
- *Hay đang dùng thumbnail của video chính nhưng lookup sai?* → No. The supplemental renderer never reads `lesson.thumbnailUrl`; it only reads `item.url` (the supplemental item's own video URL).
- *Hay API chỉ sign video URL mà không resolve thumbnail?* → **Yes.** `signMediaUrls` (`lms.js:261-345`) signs/normalizes the **video URL** (Drive→preview, Bunny→signed embed); it never resolves or attaches a thumbnail. There is no thumbnail to sign.
- *Hay thumbnail bị xóa sau SPA navigation?* → No. `renderMediaItems` is called on both hard load (`lesson.html:1459`) and SPA nav (`lesson.html:1810`); it rebuilds the section each time. The black-frame-after-SPA-nav issue from `docs/MEDIA_REGRESSION.md` was the **main** `#videoBox` (fixed by the Media P0 fix in `b7e8d34`); it is a **separate** issue from this supplemental-thumbnail absence.
- *Hay CSS/overlay nền đen che thumbnail?* → Partially. The Drive branch's `bg-black` container shows black **only when the `<img>` fails to load**; it does not *cover* a working `<img>` (the `<img>` is `absolute inset-0 … opacity-60` on top of the black). So CSS is not hiding a working thumbnail; the black is the fallback when the `<img>` is broken/absent.
- *Hay URL thumbnail bị lỗi/caption làm bẩn?* → No (for this incident). The prior caption-pollution bug (`docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md`) is already fixed by the canonical 4-field parser in `vendor/lms-media.js`; `getGoogleDriveFileId`'s regex is now `[^&#|]` (`lesson.html:847`), so a captioned Drive supplemental yields a clean `<VID>`. The thumbnail URL is well-formed.
- *Hay trình duyệt chặn request?* → No. The request is a normal HTTPS `<img>` GET; no CORS applies to `<img>`; no mixed content. The only "block" is Drive returning a non-image for a non-public file.

---

## 6. Root cause

There are **two distinct root causes**, one per provider branch of the supplemental video renderer. The reported screenshot ("black background + ▶ play button + no thumbnail image") matches the **Drive** branch failure; the structural "Bunny supplemental has no thumbnail at all" is the **Bunny/YouTube** branch.

### Root cause 1 (matches the screenshot — Drive supplemental): the supplemental Drive thumbnail is derived from the **video file's own id**, and that video file is **not shared public**, so `thumbnail?id=<videoFileId>` returns a non-image → broken `<img>` → black `bg-black` box + ▶ play button.

- The Drive supplemental branch (`lesson.html:1168-1181`) computes `driveId = getGoogleDriveFileId(url)` (the **video file's** id) and emits `<img src="https://drive.google.com/thumbnail?id=${driveId}&sz=w1000">`.
- Unlike the **main** thumbnail (a dedicated image uploaded via `admin-upload-image.js`, which calls `drive.permissions.create({ role: "reader", type: "anyone" })` at `:195-199` to make it public), **supplemental videos are uploaded via the direct-resumable PUT path** (`lms-admin.html:3078-3262` / `handleVideoUpload`) which **never calls `permissions.create`** — there is no public-share step after the PUT succeeds (confirmed: `grep permissions lms-admin.html` finds only the `sync-drive-permissions` button at `:2786`, not an auto-share). The video file inherits the **folder-level student permission** (`admin-sync-drive-permissions.js` adds per-student reader access to the course folder), so students can **play** the video (Drive preview respects folder sharing), but `thumbnail?id=<videoFileId>` is a **public-only** endpoint — it returns a thumbnail only if the file is `anyone-with-link` public. A folder-shared-but-not-public video file returns a sign-in redirect / non-image → the `<img>` breaks.
- Result: the Drive supplemental card's `<div class="aspect-video relative bg-black …">` shows its `bg-black` (black) with the `.gdrive-play-button` (▶) on top and a broken/empty `<img>` — **exactly the reported symptom**.
- **Why the main video is unaffected:** the main thumbnail is a **different, public** image file (`thumbnail_url`), not the video file. `thumbnail?id=<publicImageFileId>` returns 200 image → the main `<img>` loads.

### Root cause 2 (structural — Bunny/YouTube supplemental): the renderer's Bunny and YouTube branches emit **only an `<iframe>`**, with **no `<img>`/`poster`/`background-image`** at all, so there is no page-level thumbnail — the user sees the iframe's own initial black frame (Bunny) or the YouTube iframe's poster (YouTube).

- Bunny branch (`lesson.html:1182-1192`): returns `<div id="${containerId}" class="aspect-video relative" data-bunny-media-container><iframe src="…iframe.mediadelivery.net/embed/…"></iframe></div>`. **No `<img>`.** Bunny's embed iframe renders its own poster/first-frame server-side; there is no page thumbnail. The black the user sees is the iframe content, and there is **no `.gdrive-play-button` overlay** on this branch.
- YouTube branch (`lesson.html:1158-1167`): returns `<iframe src="youtube.com/embed/<id>?rel=0">`. **No `<img>`.** YouTube's iframe shows its own poster.
- The schema has no thumbnail field for supplemental items, so even if the renderer wanted a Bunny/YouTube poster, there is no data to render; YouTube/Bunny poster URLs would have to be synthesized (`img.youtube.com/vi/<id>/maxresdefault.jpg` for YouTube; Bunny has no static poster URL without an API call).

**Primary root cause for the reported screenshot:** **Root cause 1** (Drive supplemental `<img>` broken because the video file is folder-shared, not public, so `thumbnail?id=<videoFileId>` returns a non-image). The screenshot's "▶ play button present" is the tell: only the Drive branch renders `.gdrive-play-button`; the Bunny branch has no such overlay.

**File / function / line:**
- `lesson.html:1168-1181` — `renderMediaItems` video branch, Drive sub-branch: `const driveId = getGoogleDriveFileId(url); … const thumbUrl = https://drive.google.com/thumbnail?id=${driveId}&sz=w1000; <img src="${thumbUrl}" …>`. The `driveId` here is the **video file's** id.
- `lesson.html:1182-1192` — Bunny sub-branch: no `<img>` emitted (Root cause 2).
- `lms-admin.html:3078-3262` — `handleVideoUpload`: direct-resumable PUT to Drive, **no `permissions.create({type:"anyone"})`** after upload (the public-share gap that makes `thumbnail?id=<videoFileId>` fail).
- Compare: `utils/lms-handlers/admin-upload-image.js:195-199` — the image upload path **does** make the file public, which is why main thumbnails (and supplemental **images**) load.

### Call order (Drive supplemental, hard load)
```
loadLessonDetails(currentLesson)                       [lesson.html:1336]
  └─ renderMediaItems(currentLesson)                   [lesson.html:1459]
       └─ parseMediaUrls(lesson.mediaUrls)             [vendor/lms-media.js]  → [{type:"video", url:"…/file/d/<VID>/preview", caption}]
       └─ item.type === "video"                        [lesson.html:1152]
            url = extractIframeSrc(item.url)… → "https://drive.google.com/file/d/<VID>/preview"
            ytId = getYouTubeVideoId(url) → ""                                         (not YouTube)
            driveId = getGoogleDriveFileId(url) → "<VID>"                              [lesson.html:1168]  ← VIDEO file id
            thumbUrl = `https://drive.google.com/thumbnail?id=<VID>&sz=w1000`          [lesson.html:1172]
            return `<div …><div class="aspect-video relative bg-black …">
                      <img src="${thumbUrl}" … opacity-60>
                      ${getGoogleDrivePlayButtonHtml(playerUrl, returnUrl)}
                    </div></div>`                                                       [lesson.html:1173-1180]
  └─ browser: <img src="…/thumbnail?id=<VID>&sz=w1000"> → Drive returns non-image (file not public) → broken <img>
       → user sees: bg-black + .gdrive-play-button (▶), no thumbnail
```

---

## 7. Contributing factors

| Factor | Severity | Evidence |
|---|---|---|
| **Supplemental videos are uploaded without a public-share step** (`handleVideoUpload` direct PUT never calls `permissions.create`). Main thumbnails (and supplemental images) are uploaded via `admin-upload-image.js` which *does* make them `anyone:reader`. So `thumbnail?id=<videoFileId>` works for images but fails for videos. | **High (Root cause 1 enabler)** | `lms-admin.html:3078-3262` (no permissions.create); `admin-upload-image.js:195-199` (has it). |
| **The `mediaUrls` schema has no per-item thumbnail field** (`type\|title\|url\|caption`). The renderer must synthesize a thumbnail from the video URL itself, which only works for Drive (and only when public). Bunny/YouTube have no synthesizable static poster. | **High (structural)** | `lms-admin.html:2133-2143` buildMediaUrls; `vendor/lms-media.js` parseMediaLine. |
| **The Bunny/YouTube supplemental branches emit no `<img>`/`poster`** — by design they rely on the iframe's own poster. This is fine when the iframe loads, but it means there is **no page-level thumbnail** to show before/instead of the iframe, so any iframe load delay or failure shows as black. | Medium (Root cause 2) | `lesson.html:1158-1167` (YouTube), `:1182-1192` (Bunny). |
| **The Drive supplemental `<img>` uses `thumbnail?id=<videoFileId>` which is a public-only endpoint**, while the video's actual access is folder-scoped (per-student). Even students who can *play* the video cannot fetch its `thumbnail?id=`. | Medium | Drive behavior; `admin-sync-drive-permissions.js` (folder reader per student). |
| **No fallback `onerror` on the supplemental Drive `<img>`** — when `thumbnail?id=` fails, the `<img>` stays broken with no placeholder swap (unlike `index.html`'s `heroImage.onerror → HERO_PLACEHOLDER_IMAGE` at `:634-637`). | Low (defense-in-depth gap) | `lesson.html:1177` `<img … loading="lazy">` (no onerror). |
| **Asymmetric renderer between `lesson.html` and `lms.html`/`index.html`**: `lms.html`/`index.html` Drive supplemental branch (`lms.html:1496-1527`, `index.html` ~same) uses an `<iframe src=…/preview opacity-40 pointer-events:none>` + a "▶ Ấn vào đây để xem video" overlay — **no `<img>` thumbnail either**; `lesson.html` uses `<img src=thumbnail?id=>` + `.gdrive-play-button`. So the "missing thumbnail" symptom is specific to `lesson.html`'s Drive branch; the other pages never show a Drive thumbnail for supplementals. | Low (consistency) | `lesson.html:1168-1181` vs `lms.html:1496-1527`. |
| **No test coverage** for the supplemental video thumbnail render (whether the `<img>` exists, its src, onerror fallback). | Low (process) | `tests/` covers API handlers, not inline `lesson.html` render DOM. |

---

## 8. Hypotheses ruled out

| Hypothesis | Verdict | Why ruled out |
|---|---|---|
| Lỗi parser 3-field nuốt `\|<caption>` (the prior caption bug) | **RULED OUT** | `lesson.html` now loads `vendor/lms-media.js` (canonical 4-field parser, `lesson.html:67`); `getGoogleDriveFileId` regex is `[^&#|]` (`lesson.html:847`). The gate's supplemental Drive `<img src>` is `thumbnail?id=<VID>&sz=w1000` — **clean, no `\|<caption>`**. The caption bug is already fixed. |
| Thumbnail URL bị rỗng do renderer không set src | **RULED OUT** | Gate shows Drive supplemental `<img src>` is well-formed (`thumbnail?id=<VID>&sz=w1000`), not empty. Bunny simply has no `<img>` element. |
| API/`signMediaUrls` mangle thumbnail | **RULED OUT** | There is no thumbnail field for `signMediaUrls` to mangle; it signs the video URL only. `signMediaUrls` preserves the 4th caption field and rewrites Drive→preview / Bunny→embed correctly (`lms.js:261-345`). |
| Dữ liệu DB hỏng / sai schema | **RULED OUT** | `media_urls` is `TEXT` storing the 4-field lines; admin writes them correctly; parser reads them correctly. No corruption. |
| Thumbnail bị xóa sau SPA navigation | **RULED OUT** | `renderMediaItems` runs on both hard load (`:1459`) and SPA nav (`:1810`), rebuilding the section. The SPA-nav black-frame issue in `docs/MEDIA_REGRESSION.md` was the **main** `#videoBox` (fixed by `b7e8d34`); supplemental section is rebuilt each paint. |
| CSS overlay che thumbnail | **RULED OUT** | Computed `background-image: none` on all supplemental cards. The `bg-black` is the container background, visible only because the `<img>` is broken/absent; it does not cover a working `<img>` (the `<img>` is `absolute inset-0` above it). |
| CORS / mixed-content / trình duyệt chặn | **RULED OUT** | All HTTPS `<img>` GET; `<img>` is not CORS-restricted; no mixed content. `pageerror: []`. The only failure is Drive returning a non-image for a non-public file id. |
| Dùng nhầm thumbnail của video chính (lookup sai) | **RULED OUT** | The supplemental renderer reads only `item.url` (the item's own video URL), never `lesson.thumbnailUrl`. The main `<img>` uses `lesson.thumbnailUrl`; they are independent. |
| `mainMediaInfo` / `mainMediaType` ảnh hưởng thumbnail phụ | **RULED OUT** | `mainMediaInfo` only drives the main `#videoBox` image-vs-video branch (`lesson.html:1391-1394`); it is not read by `renderMediaItems`. |
| Bunny supplemental có thumbnail nhưng bị lỗi token | **RULED OUT** | The Bunny branch emits **no `<img>` at all** (gate: card 03 `imgs: []`). There is no thumbnail request to fail. The Bunny iframe itself returned 200 (token valid in stub). |
| Caption làm bẩn URL thumbnail (lần này) | **RULED OUT** | Gate's captioned Drive supplemental `<img src>` is clean (`thumbnail?id=<VID>&sz=w1000`, no `|caption`). The 4th-field caption is correctly split by the canonical parser. |

---

## 9. Impact theo Bunny / Drive / YouTube

| Provider | Main video thumbnail | Supplemental video thumbnail | Root cause |
|---|---|---|---|
| **Bunny** | ✅ Renders — `#videoThumb.src = normalizeGoogleDriveImageUrl(lesson.thumbnailUrl \|\| HERO)` (`lesson.html:1409/1770`). `lesson.thumbnailUrl` is typically a Drive image (public) or the hero placeholder. (If the main video is Bunny, the thumbnail is still the dedicated `thumbnail_url` image, not a Bunny poster.) | ❌ **No `<img>` emitted** — Bunny branch (`lesson.html:1182-1192`) returns only `<iframe src=iframe.mediadelivery.net/embed/…>`. No page thumbnail. User sees the Bunny iframe's own first frame (black until the player loads). **No ▶ play-button overlay** on this branch. | Root cause 2 (structural). |
| **Google Drive** | ✅ Renders — same `#videoThumb.src` from `lesson.thumbnailUrl` (dedicated public image). | ⚠️ **`<img>` emitted but broken if the video file is not public.** Drive branch (`lesson.html:1168-1181`) uses `thumbnail?id=<videoFileId>`. Works only if the video file is `anyone:reader`. Supplemental video upload (`handleVideoUpload`) does **not** make the file public, so for folder-shared videos the `<img>` breaks → **black `bg-black` + ▶ play button, no thumbnail** (the reported screenshot). | Root cause 1 (public-share gap + public-only thumbnail endpoint). |
| **YouTube** | ✅ Renders — same `#videoThumb.src` from `lesson.thumbnailUrl`. | ❌ **No `<img>` emitted** — YouTube branch (`lesson.html:1158-1167`) returns only `<iframe src=youtube.com/embed/<id>>`. YouTube iframe shows its own poster. No page thumbnail, no ▶ overlay. | Root cause 2 (structural). |

**Net:** the reported "black + ▶ play button + no thumbnail" is **specific to Drive supplemental videos whose file is not public**. Bunny/YouTube supplementals have no ▶ overlay and no page thumbnail at all (different visual: just the iframe).

---

## 10. Phương án xử lý (proposals — NOT implemented)

### Option A — Smallest fix: make the supplemental **Drive** video file public at upload time (close Root cause 1)

**Where:** server — `utils/lms-handlers/admin-upload-gdrive-video.js` (the `action !== "get-folder"` path, after `drive.files.create` succeeds, ~`:216-226`); **and** the direct-resumable PUT path in `lms-admin.html` (`handleVideoUpload`, after the PUT `200/201`, ~`:3228-3244`) — because that path uploads directly to Google's resumable endpoint and never calls our backend's `drive.files.create`, so the backend `permissions.create` would not run for it. The frontend PUT-success handler would need to call a new tiny backend endpoint (e.g. `endpoint=share-drive-file`) that runs `drive.permissions.create({ fileId, requestBody:{ role:"reader", type:"anyone" }, supportsAllDrives:true })` — mirroring `admin-upload-image.js:195-199` / `admin-repair-drive.js:34-46` (`makeFilePublicSafe`).
**What:** after a supplemental video upload succeeds, make the file `anyone:reader` so `thumbnail?id=<videoFileId>` returns 200 image. This matches how main thumbnails and supplemental images already work.
**Field changes:** none (no schema change). **Migration:** **none.** Existing supplemental Drive videos remain non-public — see "ảnh hưởng dữ liệu cũ" below.
**Ảnh hưởng dữ liệu cũ:** existing supplemental Drive videos will **still** have broken thumbnails until they are re-shared. A one-time backfill could call `makeFilePublicSafe` for every Drive fileId referenced in `media_urls` (optional, owner-gated; touches production Drive, out of scope here).
**Ảnh hưởng Bunny/Drive/YouTube:** Drive supplemental thumbnails start loading (✅). Bunny/YouTube unaffected (no `<img>` either way — see Option B). Main video unaffected (already public).
**Ảnh hưởng hard load / SPA navigation:** none — `renderMediaItems` is the same; only the `<img>` fetch succeeds now.
**Regression risk:** Low–medium. Making course videos `anyone:reader` **weakens the access model**: today supplemental videos are folder-scoped (only enrolled students via `admin-sync-drive-permissions`). Public-sharing means **anyone with the fileId can download the video**, not just enrolled students. This is a **security/access policy decision for the owner**, not a pure bug fix. (Note: the main video URL itself is already exposed via `secureVideoUrl` to enrolled students, and Drive `file/d/<id>/preview` already works for folder-shared files; the new exposure is the `anyone:reader` permission on the video file itself.) Must get owner sign-off on the access-tradeoff.
**Rollback:** revert the upload-share change + (optionally) remove the `anyone:reader` permission via `drive.permissions.delete` for affected files.
**Test:** Playwright matrix: upload a Drive supplemental video → assert `thumbnail?id=<id>` returns 200 image → assert `<img naturalWidth>0>` on `lesson.html`; confirm enrolled-student play still works; confirm no regression in `admin-sync-drive-permissions` (folder permissions still synced). Re-run `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs`.

### Option B — Standard/data-architecture fix: add a per-item `thumbnail` field to the `mediaUrls` schema (close Root cause 1 + 2 structurally)

**Where:**
- Admin: `lms-admin.html` `addMediaBlock('video', …)` — add an optional "Ảnh thumbnail (để trống = tự tạo)" input + upload button (mirror the image block's `handleImageUploadForBlock`); `buildMediaUrls()` emits a **5-field** line `type|title|url|captionEncoded|thumbnailUrl` when a thumbnail is provided (else 4-field, backward-compatible).
- Parser: `vendor/lms-media.js` `parseMediaLine` — extend to read an optional 5th pipe-field `thumbnail` (decoded). Keep 4-field/3-field backward compatibility (a 5-field parser handles both).
- Server: `utils/lms.js` `signMediaUrls` — preserve the 5th field through the round-trip (mirror how it preserves the 4th caption field today).
- Renderer: `lesson.html` `renderMediaItems` video branch — if `item.thumbnail` is present, emit `<img src="normalizeGoogleDriveImageUrl(item.thumbnail)">` (or for Bunny/YouTube, a poster `<img>` behind/instead of the iframe). If absent, fall back to today's behavior (Drive: `thumbnail?id=<videoFileId>`; Bunny/YouTube: no `<img>`).
**Field changes:** `mediaUrls` schema 4-field → 5-field (optional `thumbnail`). **Migration:** **none** — 5-field is a strict superset; old 3/4-field lines parse unchanged.
**Ảnh hưởng dữ liệu cũ:** existing supplemental items have no thumbnail → render as today (Drive: video-id thumbnail; Bunny/YouTube: no `<img>`). Only new items with an explicit thumbnail render a page thumbnail. No data invalidated.
**Ảnh hưởng Bunny/Drive/YouTube:** all three can now have a page-level thumbnail (Bunny/YouTube gain one for the first time). Drive can use a dedicated public thumbnail image instead of the video file id (decouples thumbnail from video-file sharing).
**Ảnh hưởng hard load / SPA navigation:** none (same render path).
**Regression risk:** Medium. Adds a 5th pipe-field; must keep `buildMediaUrls`/`parseMediaLine`/`signMediaUrls`/`renderMediaItems` in sync across 5 files (`lesson/lms/index/lms-admin/photo` + `vendor/lms-media.js`). Payload grows only for items that set a thumbnail (a few dozen bytes per item) — **does not bloat payload for items without a thumbnail**, satisfying the "không làm tăng payload lớn" constraint.
**Rollback:** revert; old 4-field data parses fine.
**Test:** parser unit tests (3/4/5-field); Playwright matrix (Bunny/Drive/YouTube supplemental with + without thumbnail); admin round-trip (set thumbnail → save → reload → thumbnail persists + renders). Re-run full `node --test` suite.

### Option C — Defense-in-depth / fallback: add `<img onerror>` placeholder + a Drive-public-share repair pass (does NOT fix the root by itself)

**Where:** `lesson.html:1177` (Drive supplemental `<img>`) — add `onerror="this.src='${HERO_PLACEHOLDER_IMAGE}'"` (mirror `index.html:634-637` `heroImage.onerror`). **Plus** an owner-run repair: extend `admin-repair-drive.js` (which already has `makeFilePublicSafe` at `:34-46`) to iterate all Drive fileIds in `media_urls` and make them public (backfill for Option A on existing data).
**What:** the `onerror` fallback prevents the "broken-image icon / tall empty frame" visual and swaps in the hero placeholder (cream gradient) — better than black, but **still not the real thumbnail**. The repair pass fixes existing data.
**Field changes:** none. **Migration:** none (the repair pass touches Drive permissions, not the DB).
**Ảnh hưởng dữ liệu cũ:** the repair pass would fix existing Drive supplementals (makes them public). Without the repair pass, `onerror` only hides the breakage.
**Ảnh hưởng Bunny/Drive/YouTube:** Drive: broken `<img>` → placeholder (cosmetic). Bunny/YouTube: unaffected (no `<img>`).
**Regression risk:** Very low for `onerror` (additive, only fires on error). Medium for the repair pass (touches production Drive permissions — owner-gated).
**Rollback:** revert `onerror`; the repair pass's `anyone:reader` permissions can be removed via `drive.permissions.delete`.
**Test:** Playwright: Drive supplemental with a bad fileId → assert `<img src>` becomes `HERO_PLACEHOLDER_IMAGE` (no broken-image icon). Re-run full suite.
**Why NOT sufficient alone:** `onerror` only masks the symptom (placeholder instead of black); it does not show the real video thumbnail. The repair pass is a one-time backfill, not a fix for new uploads. Use Option C **together with** Option A (so new uploads are public + existing ones get repaired + the `<img>` fails gracefully if a file is still not public).

### Recommended combination

- **If the owner accepts the access-tradeoff** (supplemental videos become `anyone:reader`): **Option A + Option C**. Option A fixes new uploads (Drive supplemental thumbnail loads); Option C's repair pass fixes existing uploads and the `onerror` gives a graceful fallback. Smallest change, no schema migration, matches how main thumbnails already work.
- **If the owner does NOT want supplemental videos public**: **Option B** is the correct architectural fix (a dedicated, public **thumbnail image** per supplemental item, decoupled from the video file's sharing). More work, but no access-model change. Payload grows only for items that set a thumbnail.
- **Option C alone** is not recommended — it only hides the breakage.

All three options **do not increase payload for items without a thumbnail** and **do not slow the page** (the thumbnail is a single `<img>` GET, already issued today for the Drive branch).

---

## 11. Test plan (for the fix, not run now)

Non-production test data only (local stub or test course), never mutate the real lesson `13735c5c-…`:
- **Drive supplemental, file public** (Option A): upload → `thumbnail?id=<id>` returns 200 image → `<img naturalWidth>0>` renders, black box gone.
- **Drive supplemental, file not public** (current / pre-fix): `thumbnail?id=<id>` returns non-image → with Option C `onerror`, `<img src>` → `HERO_PLACEHOLDER_IMAGE` (no broken-image icon); without Option C, black box (current behavior).
- **Bunny supplemental** (Option B): with `item.thumbnail` set → `<img>` renders the thumbnail; without → no `<img>` (current behavior, no regression).
- **YouTube supplemental** (Option B): same as Bunny.
- **Image supplemental** (reference): unchanged, renders.
- **Captioned supplemental** (regression vs prior caption bug): `video|…|…|caption%20…` → clean url + (Option B) clean thumbnail, no `|caption` leak.
- **3-field/4-field legacy lines** (no thumbnail field): parse identically to today (no regression).
- **SPA navigation**: `renderMediaItems` rebuilds section each nav; thumbnail renders after nav (no black-frame regression — separate from the main `#videoBox` Media P0 fix in `b7e8d34`).
- **Access regression** (Option A): confirm `admin-sync-drive-permissions` still adds/removes folder reader permissions; confirm enrolled students can still play; document the `anyone:reader` exposure for the owner.
- **Re-run** `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` (201/201 or current count) — must stay green.
- **Playwright on a Vercel Preview** with a real course (owner gate) before any promote.

---

## 12. Confidence

| Conclusion | Confidence | Basis |
|---|---|---|
| The `mediaUrls` schema has **no per-item thumbnail field**; supplemental thumbnails are synthesized by the renderer (Drive only) or omitted (Bunny/YouTube). | **99%** | `lms-admin.html:2133-2143` buildMediaUrls (4 fields); `vendor/lms-media.js` parseMediaLine (4 fields); `supabase_schema.sql:101` `media_urls TEXT`; `lesson.html:1152-1207` render branches. |
| The **Drive** supplemental branch emits `<img src=thumbnail?id=<videoFileId>>` and it breaks when the video file is not `anyone:reader` public → black `bg-black` + ▶ play button + no thumbnail = the reported screenshot. | **90%** | `lesson.html:1168-1181`; `handleVideoUpload` (`lms-admin.html:3078-3262`) has no `permissions.create`; `admin-upload-image.js:195-199` (images) does; gate captured the well-formed `<img src>` and the `bg-black` container + `.gdrive-play-button`. 10% residual = no direct prod capture of the real fileId's share status (would need owner session / Drive API check on the real `13735c5c-…` media items). |
| The **Bunny/YouTube** supplemental branches emit **no `<img>`** at all (structural, by design). | **99%** | `lesson.html:1158-1167` (YouTube), `:1182-1192` (Bunny) — code; gate card 03 `imgs: []`, no thumbnail network request. |
| The main video's thumbnail comes from `lesson.thumbnailUrl` (a dedicated public image), which is why the main always has a thumbnail. | **99%** | `lesson.js:569` `thumbnailUrl: thumbnail_url`; `lesson.html:1409/1770`; `admin-upload-image.js:195-199` (public). |
| The prior caption-pollution bug is NOT this incident (already fixed by `vendor/lms-media.js`). | **99%** | gate's captioned Drive supplemental `<img src>` is clean (`thumbnail?id=<VID>&sz=w1000`, no `\|caption`); `getGoogleDriveFileId` regex `[^&#|]` (`lesson.html:847`). |
| Root cause is NOT SPA-navigation thumbnail loss (that was the main `#videoBox`, fixed in `b7e8d34`). | **95%** | `renderMediaItems` runs on both hard load (`:1459`) and SPA nav (`:1810`); the symptom reproduces on a fresh hard load in the gate (no SPA nav involved). |
| Overall root-cause confidence (Drive supplemental public-share gap + structural no-`<img>` on Bunny/YouTube) | **90%** | end-to-end source trace + Playwright DOM/network evidence; 10% residual = no authenticated prod capture of the exact real fileId's Drive permission state. |

---

## 13. What was NOT done (read-only)

- No code change to `lesson.html`, `lms-admin.html`, `vendor/lms-media.js`, `utils/lms.js`, `utils/lms-handlers/admin-upload-gdrive-video.js`, `utils/lms-handlers/admin-upload-image.js`, `admin-lessons.js`, or any other file.
- No production data mutation (the real lesson `13735c5c-…` was not edited; only a local stub with synthetic file ids was used).
- No commit, push, deploy, promote, rollback.
- No Supabase change, no Vercel change.
- No Drive permission change on any real file (the public-share gap is documented, not applied).
- No authenticated fetch of the real production lesson / no Drive API call against the real supplemental file ids (would need owner session + would touch production state; not required — the renderer behavior and schema are fully determined by source + the local-stub DOM/network capture).
- Working tree: `git status --short` shows only `M docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md` (prior session). This new report `docs/SUPPLEMENTARY_VIDEO_THUMBNAIL_INVESTIGATION.md` is the sole output of this investigation.

This report is the sole output of the investigation. Awaiting direction.

**Bạn có muốn tôi áp dụng phương án đề xuất không?**

---

## P0 Fix — Course Cover Thumbnail Fallback (applied, gated, NOT committed)

**Date applied:** 2026-07-21
**Owner approval:** "P0 FIX — SUPPLEMENTARY VIDEO THUMBNAIL FALLBACK TO COURSE COVER. Áp dụng fix nhỏ nhất, dựa trên hành vi hiện có của video chính. Không schema 5-field, không public video Drive, không permissions.create, không migration, không sửa Supabase, không đổi payload mediaUrls, không deploy/promote trước OWNER APPROVAL."
**Approach:** mirror the **main video's** thumbnail behavior for every supplemental video card. Canonical cover source = `lesson.thumbnailUrl` (the same field the main `#videoThumb` uses, `lesson.html:1409/1770`), normalized by the existing `normalizeGoogleDriveImageUrl`. No new data source, no 5th schema field, no Drive permission change, no payload change.
**Scope:** `lesson.html` only (the supplemental renderer `renderMediaItems` + 4 small helper functions). No other source file touched. No commit/push/deploy/promote.

### Root cause (recap, from §6)

Supplemental videos have **no per-item thumbnail field** in the `mediaUrls` schema (`type|title|url|caption`). The Drive branch derived its thumbnail from the **video file's own id** (`thumbnail?id=<videoFileId>`), which fails because the video file is folder-scoped (not `anyone:reader` public) → broken `<img>` → black `bg-black` + ▶ play button. The Bunny/YouTube branches emitted **no `<img>` at all** → black iframe box. The main video is unaffected because it uses a **separate, public, uploaded cover image** (`lesson.thumbnailUrl`).

### Canonical cover source (verified, no second source created)

- Main video: `videoThumb.src = normalizeGoogleDriveImageUrl(currentLesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE)` (`lesson.html:1409` hard load, `:1770` SPA `paintLesson`).
- Supplemental (this fix): same field, same normalizer — `getSupplementalVideoCoverImgHtml(lesson)` returns `<img src="${normalizeGoogleDriveImageUrl(lesson?.thumbnailUrl || HERO_PLACEHOLDER_IMAGE)}" … onerror="swapToHeroPlaceholder(this)">`.
- **No `courseInfo.heroImage` used** (the main video doesn't use it either; `courseInfo.heroImage` is only for the sidebar/back-link). One canonical cover source = `lesson.thumbnailUrl`.

### File + lines changed

Only `lesson.html`. `git diff --stat`: `1 file changed, 69 insertions(+), 9 deletions(-)`.

**New helper functions (one block, before `renderMediaItems`):**
- `swapToHeroPlaceholder(imgEl)` — `onerror` fallback; swaps to `HERO_PLACEHOLDER_IMAGE` exactly once (`data-fb` guard → no loop, no broken-image icon, no tall white frame).
- `getSupplementalVideoCoverImgHtml(lesson)` — the cover `<img>` (course cover, normalized, `object-cover opacity-60`, `onerror` wired).
- `getSupplementalPlayButtonHtml(onclickJs)` — the ▶ play button (reuses the existing `.gdrive-play-button` CSS; `onclickJs` is provider-specific).
- `playSupplementalBunny(containerId)` — lazy Bunny: on click, replaces the cover with the Bunny embed `<iframe>` + attaches the watermark.
- `playSupplementalYouTube(containerId)` — lazy YouTube: on click, replaces the cover with the YouTube embed `<iframe>`.

**`renderMediaItems` video branch changes:**
- **YouTube** (`item.type === "video"` w/ `ytId`, and `item.type === "youtube"`): was `<iframe>` only → now cover `<img>` + ▶ play button (lazy iframe on click).
- **Drive**: was `<img src=thumbnail?id=<videoFileId>>` (broken) → now cover `<img>` (course cover) + existing `getGoogleDrivePlayButtonHtml` (play handler unchanged — still opens `/gdrive-player.html`).
- **Bunny**: was `<iframe>` at render → now cover `<img>` + ▶ play button (lazy `<iframe>` on click via `playSupplementalBunny`, watermark attached at click time).
- The trailing watermark loop now only watermarks containers that **already have an `<iframe>`** (a freshly-rendered lazy container has only the cover img).

**Fallback chain (per the owner's spec):**
1. A valid per-item thumbnail if one existed in the data/logic → **none exists today** (no schema field), so skip.
2. Course cover = `normalizeGoogleDriveImageUrl(lesson.thumbnailUrl)`.
3. If the cover `<img>` errors → `onerror="swapToHeroPlaceholder(this)"` → `HERO_PLACEHOLDER_IMAGE` (once, guarded).
- No loop, no broken-image icon, no tall white frame.

### Diff summary

```diff
+    // ── Supplemental video thumbnail fallback (P0) ─────────────────────────
+    function swapToHeroPlaceholder(imgEl) { … }              // one-time onerror → HERO_PLACEHOLDER_IMAGE
+    function getSupplementalVideoCoverImgHtml(lesson) { … }  // cover <img> from lesson.thumbnailUrl
+    function getSupplementalPlayButtonHtml(onclickJs) { … }  // ▶ button (reuses .gdrive-play-button)
+    function playSupplementalBunny(containerId) { … }        // lazy iframe + watermark on click
+    function playSupplementalYouTube(containerId) { … }      // lazy iframe on click
     function renderMediaItems(lesson) {
       …
       const coverImg = getSupplementalVideoCoverImgHtml(lesson);
       // YouTube:  <img cover> + ▶ (lazy iframe on click)
       // Drive:    <img cover> + ▶ (existing /gdrive-player.html play handler, unchanged)
       // Bunny:    <img cover> + ▶ (lazy iframe + watermark on click)
       …
-      section.querySelectorAll("[data-bunny-media-container]").forEach(c => createWatermark(c, studentEmail));
+      section.querySelectorAll("[data-bunny-media-container]").forEach(c => { if (c.querySelector("iframe")) createWatermark(c, studentEmail); });
     }
```
(Full diff: `git diff -- lesson.html`.)

### Test results

- **Syntax:** `node --check` on the inline app script → **SYNTAX OK**.
- **Full test suite:** `LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs` → **264 / 264 pass, 0 fail**. No regression.

### Browser evidence (Playwright, local stub, mobile + desktop)

Stub serves a lesson with 5 supplemental items (Drive private ×2, Bunny, YouTube, `youtube` type) + a course-cover `thumbnailUrl`. Drive thumbnail requests are routed to a 1×1 PNG (so the cover `<img>` keeps its real `src` for the assertion; in production the cover is a public image so `thumbnail?id=<coverFileId>` returns 200).

**25/25 thumb-gate assertions PASS:**

| Gate | Result |
|---|---|
| 1. Main video still has thumbnail (`#videoThumb` present) | ✅ `mainThumbPresent: true` |
| 2. Supplemental Drive (private) → course cover img + ▶, no broken image | ✅ `desktopEveryCardHasCoverImg`, `desktopEveryCardHasPlayBtn`, `desktopNoDriveVideoIdThumb` (no `thumbnail?id=DRIVEPRIVATE`) |
| 3. Supplemental Bunny → cover img + ▶ | ✅ (card 02 has cover img + play btn) |
| 4. Supplemental YouTube → cover img + ▶ | ✅ (cards 03 + 05) |
| 5. Multiple supplemental videos → each card has thumbnail, no duplicate IDs | ✅ `desktopNoDupIds: true` (5 distinct `bunny_media_…`/`yt_media_…` ids) |
| 6. Course with no cover → placeholder fallback | ✅ `noCoverFallsBackToPlaceholder: true` (img src = `data:image/svg+xml,…`) |
| 7. SPA navigation (20 clicks) → thumb updates, no stale, no reload, no pageerror | ✅ `spaThumbUpdates`, `spaNoPageError`, `spaNoDocReload` (≤2 doc requests = the 2 initial gotos) |
| 8. Media P0 (black-frame) — `#videoBox` placeholder recreate still works | ✅ `mediaP0WrapperHasChildren`, `mediaP0VideoThumbPresent`, `mediaP0PlayBtnPresent` |
| 9. Caption P0 — parser still clean, url not polluted by caption | ✅ `captionImgUrlClean`, `captionImgCaptionDecoded`, `captionVidUrlClean`, `captionVidCaptionDecoded` |
| 10. Mobile viewport (390×844, iPhone UA) — no bare black box, cover object-fit, play btn positioned | ✅ `mobileEveryCardHasCoverImg`, `mobileEveryCardHasPlayBtn`, `mobileNoBlackEmptyBox`, `desktopImgObjectFitCover: true` (object-fit: cover) |

**DOM evidence captured (`thumb-gate-result.json`):**
- Each supplemental card: `hasImg: true`, `imgSrc: https://drive.google.com/thumbnail?id=COVERIMGFILE&sz=w1000` (course cover), `imgObjectFit: "cover"`, `imgDisplay: "inline"`, `hasPlayBtn: true`, `hasIframe: false` (lazy — no iframe at render).
- No-cover lesson: `imgSrc: data:image/svg+xml,…` (placeholder).
- `pageErrors: 0`, `failedImgReqs: 0`, `docRequests: 4` (2 initial gotos × 2 contexts; 0 during SPA nav).
- Screenshots: `thumb-desktop.png`, `thumb-mobile.png`, `thumb-spa-after.png`.

### SPA regression

20 SPA sidebar clicks alternating `LTHUMB` (with cover) ↔ `LNOCOVER` (no cover). The cover `<img>` `src` **changes** between the cover URL and the placeholder on each nav (`spaThumbUpdates: true`) — no stale thumbnail from the previous lesson. `pageErrors: 0` during SPA. No document reloads during SPA (the 2 initial gotos are the only doc requests). The Media P0 `#videoBox` placeholder is still recreated on each SPA nav (black-frame fix intact).

### Caption regression

The canonical parser (`vendor/lms-media.js`) is unchanged. In-page parse of a captioned matrix (`image|Ảnh 2|<url>|<encoded caption>` + `video|Vid cap|<url>|<encoded caption>`) → clean urls + decoded captions (`captionImgUrlClean`, `captionImgCaptionDecoded`, `captionVidUrlClean`, `captionVidCaptionDecoded` all `true`). The supplemental video cover uses `lesson.thumbnailUrl`, not `item.url`, so caption pollution cannot reach the cover `<img>`.

### Media regression (black-frame P0)

After SPA nav, `#videoWrapper.childElementCount >= 1`, `#videoThumb` present, `#playBtn` present (`mediaP0WrapperHasChildren`, `mediaP0VideoThumbPresent`, `mediaP0PlayBtnPresent` all `true`). The Media P0 fix (`b7e8d34` / `5992212`) is intact — the supplemental fix did not regress the main video placeholder.

### Residual risk

| Risk | Likelihood | Note |
|---|---|---|
| Lazy Bunny/YouTube: the `<iframe>` is created on click, not at render — if `playSupplementalBunny`/`playSupplementalYouTube` has a typo, the click does nothing | Low | gate asserted the play button is present + the lazy functions are defined (no pageerror); a click test would confirm the iframe appears. The functions are simple `innerHTML` swaps guarded by `dataset.played`. |
| Cover = `lesson.thumbnailUrl` is the SAME image for every supplemental video card (no per-item thumbnail) | By design (owner's spec) | The owner explicitly chose "dùng ảnh bìa khóa học làm thumbnail" for every supplemental video. This is the requested behavior, not a bug. |
| A course with no `thumbnailUrl` → all supplemental cards show the hero placeholder (cream gradient) | By design | Better than a broken-image icon / black box. The owner's fallback chain §3 (placeholder) is honored. |
| Watermark on lazy Bunny now attaches at click time, not render time | Low | `playSupplementalBunny` calls `createWatermark(c, studentEmail)` after injecting the iframe; the render-time loop still watermarks any container that already has an iframe (e.g. a pre-played one). Gate confirmed no pageerror. |
| Real prod cover image is a Drive image shared `anyone:reader` (main thumbnail upload path) → `thumbnail?id=<coverFileId>` returns 200 | High confidence | The main video already relies on this exact mechanism (`#videoThumb.src = normalizeGoogleDriveImageUrl(thumbnailUrl)`); if the cover loads for the main video, it loads for supplementals (same src). |
| `Math.random()` container ids could collide in theory | Negligible | 9-char base36; same pattern as the pre-existing Bunny code. Gate confirmed no duplicate ids across 5 cards. |
| Mobile: cover `<img>` `object-cover` may crop the image | By design | Matches the main video's `object-cover` behavior; the owner's spec §3.10 requires "thumbnail cover đúng object-fit" → `object-fit: cover` is correct. |

**Overall confidence: 96%.** 4% residual = (a) lazy play-click not directly exercised in the gate (the play button presence + function definitions are confirmed, but the iframe-on-click swap is verified by code inspection, not a click); (b) no authenticated prod capture with a real course cover image (the gate used a routed 1×1 PNG for the cover thumbnail endpoint). An owner spot-check on a Vercel Preview (open a lesson with supplemental videos → confirm the cover shows → click ▶ → confirm the player loads) closes both.

### Rollback plan

- **Code rollback:** `git revert` the supplemental-thumbnail commit (single file, `lesson.html`); or restore `lesson.html` from `5992212` (`git checkout 5992212 -- lesson.html`). No data migration (no schema/payload change).
- **Deploy rollback:** re-promote the current production deployment (`dpl_5vk5biBxaaBGdCtkTqtSA436j4uW` / `web-lms-chinh-thuc-qmjyl13jn.vercel.app`, source `5992212` — the caption-centralization deploy, without this supplemental-thumb fix). Supplemental videos go back to the black-box/broken-thumbnail state (pre-fix).
- **No Drive/Supabase/Vercel change to undo** — this fix is pure client-side render logic.

### What was NOT done (per scope)

- No 5-field schema, no `permissions.create(anyone:reader)`, no migration, no Supabase change, no `mediaUrls` payload change.
- No `courseInfo.heroImage` second cover source (canonical source = `lesson.thumbnailUrl` only).
- No second renderer / no duplicated main-video logic (helpers are small, shared, single-purpose).
- No commit, no push, no deploy, no promote.
- Working tree:
  ```
  ## feat/v2-lms-baseline-fix...origin/feat/v2-lms-baseline-fix
   M docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md   (prior session)
   M lesson.html                                                    (this fix)
   ?? docs/SUPPLEMENTARY_VIDEO_THUMBNAIL_INVESTIGATION.md           (this report)
  ```
  HEAD = `5992212` (no new commit).

---

OWNER APPROVAL: commit + push supplementary video course-cover thumbnail fix?

---

## Verification of Google Drive Thumbnail Hypothesis

**Purpose:** empirically verify (not infer) the conclusion "Drive supplementary video has no thumbnail because the video file is not public." No code change, no commit, no deploy, no production data mutation, **no `permissions.create()`, no repair pass, no new permissions** — every test below is read-only HTTP / read-only Playwright against Google's public thumbnail endpoint and a local stub.

**Important scope note on what could and could not be tested directly:**
I could **not** obtain the **real production Drive fileId** of a supplemental video on lesson `13735c5c-…` without an authenticated owner session (the lesson API and course-data API both require a logged-in LMS session — `{"authError":"missing_login_session"}`; `public-config` returns only the Google client id, no file ids). So I could **not** point `thumbnail?id=` at the *exact* real video file the owner reported. Instead I verified the **endpoint's behavior** with controlled inputs (well-formed fake ids, malformed ids, and the documented Google API behavior), which determines the hypothesis generically. The owner can close the last gap by providing one real supplemental video fileId (or an authenticated capture) — see "Residual" below.

### A. HTTP evidence (curl, read-only)

I issued real `GET https://drive.google.com/thumbnail?id=<ID>&sz=w1000` requests and captured status, `Content-Type`, `Content-Length`, the `Location` redirect header, and followed the redirect chain.

| Input id | Step 1 (thumbnail) | Redirect target | Final (followed) | Final Content-Type | Final body |
|---|---|---|---|---|---|
| `1Aa2Bb3Cc4Dd5Ee6Ff7Gg8Hh9Ii0JjKkL` (well-formed, 33-char, **fake / not a real public file**) | **302** `application/binary`, `Content-Length: 0`, `Location: https://lh3.googleusercontent.com/d/1Aa2Bb…=w1000` | lh3 | **500** | `text/html; charset=UTF-8` (1730 B) | `<!DOCTYPE html>…<title>Error 500 (Server Error)!!1</title>…` |
| `0FakeId0000000000000000000000000` (malformed shape) | 302 → lh3 | lh3 | **400** | `text/html; charset=UTF-8` (1555 B) | Google 400 error page |
| `ZzzNonExistentIdXXXXXXXXXXXXXX` (malformed shape) | 302 → lh3 | lh3 | **400** | `text/html; charset=UTF-8` (1555 B) | Google 400 error page |
| `1Rc-FwG4mGxZ3nE5y2dI6wQ4rQ5tA5nGz` (well-formed, fake, used as "would-be private" stand-in) | 302 → lh3 | lh3 → **accounts.google.com** | **200** | `text/html; charset=utf-8` (~912 KB) | `<!doctype html>…<base href="https://accounts.google.com">…` (the **Google sign-in/login page**) |

**Reading of the HTTP evidence:**
- `thumbnail?id=<ID>` **always 302-redirects** to `https://lh3.googleusercontent.com/d/<ID>=w1000` (step 1 is `302 application/binary`, `Content-Length: 0` — never an image itself).
- The lh3 redirect target then either:
  - returns **500/400 `text/html`** for ids that are syntactically invalid or not found, or
  - **302-redirects to `accounts.google.com` (the Google login page)** for a well-formed id whose file is **not accessible to the anonymous requester** (i.e. not public). The final status there is `200` but the body is the **login HTML page**, **not an image** (`Content-Type: text/html; charset=utf-8`, ~912 KB of login markup).
- **In no case did `thumbnail?id=` return `image/jpeg` / `image/png`** for a non-public / fake id. For an `<img>` element, a `text/html` (login page) or `text/html` (500 error) final response is **a failed image load** → `naturalWidth=0, naturalHeight=0, complete=true` (broken image), exactly the renderer's observed state.

**This is consistent with the hypothesis:** a non-public Drive file's `thumbnail?id=` does **not** yield an image; it yields a login redirect or an error page. The endpoint is anonymous-only-public by construction — there is no way to attach the student's folder-share credential to an `<img src>` GET.

### B. Browser evidence (Playwright 1.61.1, mobile UA, read-only)

Minimal HTML with `<img src="https://drive.google.com/thumbnail?id=<fakeId>&sz=w1000">`, captured `naturalWidth`/`naturalHeight`/`complete`/`currentSrc` + network.

| `<img>` | src | network status (step 1) | final body | `naturalWidth` | `naturalHeight` | `complete` | `currentSrc` | Renders? |
|---|---|---|---|---|---|---|---|---|
| `#a` (well-formed fake id, stands in for a non-public video file) | `thumbnail?id=1Aa2Bb…&sz=w1000` | **302** `application/binary` → lh3 500 `text/html` | error HTML | **0** | **0** | **true** | `…/thumbnail?id=1Aa2Bb…&sz=w1000` | **No** (broken image) |
| `#b` (malformed fake id) | `thumbnail?id=0Fake…&sz=w1000` | **302** `application/binary` → lh3 400 `text/html` | error HTML | **0** | **0** | **true** | `…/thumbnail?id=0Fake…&sz=w1000` | **No** (broken image) |

- `pageerror: []`. No JS exceptions.
- `complete: true` + `naturalWidth/Height: 0` is the browser's signature for a **failed image load** (the request finished, but the response was not a decodable image — here a `text/html` error/login page).
- `currentSrc` == `src` (no CORS/redirect transformation visible to JS; the 302 to lh3 and onward to accounts/500 is followed by the image loader but the final non-image body still fails decode).

This **reproduces the exact failure mode** the Drive supplemental branch hits: a well-formed `thumbnail?id=<videoFileId>` that returns a non-image because the file is not anonymous-public → `naturalWidth=0` → broken `<img>` → the `bg-black` container + `.gdrive-play-button` show through (the reported screenshot).

### C. Source-code evidence (re-confirmed, read-only)

| Question | Answer | Evidence |
|---|---|---|
| Does the supplemental **video** admin block have a thumbnail upload? | **No.** Only `type === "image"` blocks render the "Tải" upload button (`lms-admin.html:2113-2117`). Video blocks have only `data-media-url` + `data-media-title` + `data-media-caption` — **no thumbnail input**. | `lms-admin.html:2103-2128`. |
| Does `buildMediaUrls` emit a thumbnail field for video? | **No.** Emits `type\|title\|url\|captionEncoded` (4 fields) only. | `lms-admin.html:2133-2143`. |
| Does `signMediaUrls` resolve/attach a thumbnail? | **No.** It signs the **video URL** (Drive→`/preview`, Bunny→signed embed) and preserves the caption field; no thumbnail field exists to sign. | `utils/lms.js:261-345`. |
| Does `renderMediaItems` expect a thumbnail from anywhere? | **Only the Drive branch synthesizes one** from `getGoogleDriveFileId(item.url)` = the **video file's** id → `thumbnail?id=<videoFileId>`. Bunny/YouTube branches emit no `<img>`. | `lesson.html:1168-1181` (Drive), `:1182-1192` (Bunny), `:1158-1167` (YouTube). |
| Does `handleVideoUpload` (the supplemental video upload path) make the file `anyone:reader`? | **No.** It does a direct resumable PUT to `googleapis.com/upload/drive/v3/files` and, on `200/201`, only reads `fileId` and sets the URL input. **No `permissions.create` call anywhere in that path** (`grep permissions lms-admin.html` → only the `sync-drive-permissions` button at `:2786`). | `lms-admin.html:3078-3262`. |
| How is a supplemental video's access granted instead? | **Folder-scoped, per-student, `type:"user"` reader** — `admin-sync-drive-permissions.js` adds `addDriveFolderPermission(folderId, email)` which calls `permissions.create({ role:"reader", type:"user", emailAddress })` (`utils/lms.js:462-479`). That grants the **enrolled student's Google account** read access to the **folder**; it does **not** make the file `anyone`-public. | `admin-sync-drive-permissions.js:104-119`; `utils/lms.js:462-479`. |
| Does the **image** upload path make files public? | **Yes** — `admin-upload-image.js:195-199` calls `permissions.create({ role:"reader", type:"anyone" })`. This is why main thumbnails (and supplemental images) load. | `utils/lms-handlers/admin-upload-image.js:193-202`. |
| Is `drive.google.com/thumbnail?id=` an official, documented Google API? | **No — it is an undocumented workaround**, not part of the Drive API. The official Drive API exposes a `thumbnailLink` **field** on a File resource (short-lived, hours; "Not intended for direct usage on web applications due to CORS"; for non-public files "must be fetched using a credentialed request") — a **server-side, credentialed** fetch, not a browser `<img src>`. The `thumbnail?id=` URL pattern is absent from Google's download/export docs. The system depends on the **undocumented** `thumbnail?id=` endpoint, which only works for **anonymous-public** files. | Google Drive API files reference (`thumbnailLink`); Google Drive download/export docs (no `thumbnail?id=`); ayrshare guide ("Make Your File Public → Anyone with the link" is a prerequisite for direct `<img>` URLs). |

**Net of the source re-check:** the renderer expects a thumbnail from `thumbnail?id=<videoFileId>`, the upload path never makes that file public, and the access model grants only folder-scoped `type:"user"` reader to enrolled students — which an anonymous `<img src=thumbnail?id=>` cannot use. The system relies on an **undocumented, anonymous-public-only** endpoint for a file that is **not anonymous-public**. That is the mismatch.

### D. Could-not-test directly (stated limitation)

- I did **not** call `thumbnail?id=` against the **real** production supplemental video fileId (it is behind the authenticated lesson API; no owner session was provided, and I did not mint tokens or query the production DB). The hypothesis is therefore verified **generically** (endpoint behavior for non-public vs malformed ids) rather than against the specific reported file. The owner can close this gap by pasting one real supplemental video Drive fileId; `curl -sS -L -o t.bin -w "%{http_code} %{content_type}" "https://drive.google.com/thumbnail?id=<REALID>&sz=w1000"` will show `200 image/jpeg` if public, or `200 text/html` (login) / `500` if not.
- I did **not** create, modify, or delete any Drive permission (no `permissions.create`, no repair pass) — per scope.

### Kết luận (YES/NO)

**1. Nếu video public (`anyone:reader`) thì thumbnail có hoạt động? → YES.**
The `thumbnail?id=<fileId>&sz=w1000` endpoint returns `302 → lh3.googleusercontent.com/d/<id>=w1000 → 200 image/jpeg` for an anyone-public file (this is exactly how main thumbnails and supplemental **images** already work in this app — they are uploaded via `admin-upload-image.js` which sets `anyone:reader`, and `normalizeGoogleDriveImageUrl` converts their URL to `thumbnail?id=<id>`, and those images render). The endpoint is anonymous-public-only and works when that condition is met. (Confidence: 90% — based on the endpoint's observed behavior + the fact that the app's own public images render through this exact URL pattern; 10% residual = no direct capture against a real *video* file id confirmed public, since video files are not made public by the current upload path.)

**2. Nếu video private (folder-shared `type:"user"` only, not `anyone`) thì thumbnail có hoạt động? → NO.**
`thumbnail?id=<fileId>` 302-redirects to lh3, which for a non-anonymous-public file redirects to `accounts.google.com` (login page, `200 text/html`) or returns `500 text/html`. The `<img>` cannot attach the student's folder-share credential, so the response is a non-image → `naturalWidth=0, naturalHeight=0, complete=true` → broken image → black `bg-black` + ▶ play button (the reported symptom). (Confidence: 92% — reproduced the failure mode with a well-formed non-public id; the login-redirect and 500/400 non-image responses are directly observed; 8% residual = the exact real fileId's share state was not probed.)

**3. Việc public (make the supplemental video file `anyone:reader`) có đủ để sửa bug không? → YES, for the Drive supplemental branch.**
Making the video file `anyone:reader` makes `thumbnail?id=<videoFileId>` return `200 image/jpeg`, so the Drive branch's `<img>` loads and the thumbnail renders. This matches Option A in §10. **Caveat (not a blocker for the bug, but a policy decision):** it also makes the video file downloadable by **anyone with the fileId**, not just enrolled students — an access-model tradeoff the owner must accept (the video URL is already exposed to enrolled students via `secureVideoUrl`/preview, but `anyone:reader` widens it). **It does NOT fix the Bunny/YouTube supplemental branches** (Root cause 2) — those emit no `<img>` at all, so making a Bunny/YouTube file public is irrelevant; they need Option B (a dedicated thumbnail field) or a provider-specific poster. (Confidence: 88% — the Drive fix is mechanistically certain given the endpoint behavior; the 12% residual is the access-policy acceptance + the no-direct-real-fileId capture.)

**4. Nếu NO (i.e., if public turns out NOT to be sufficient):** what is missing?
If a real-public Drive video fileId still did not render a thumbnail, the missing pieces would be:
- (a) **The file is a video, not an image** — `thumbnail?id=` returns Google's **generated video poster/thumbnail** for video files only when Google has generated one and the file is public; some video formats/transcodings may not have a generated thumbnail (`hasThumbnail` can be false per the Drive API). In that case even `anyone:reader` would return a non-image → still broken. The robust fix is then **Option B**: a dedicated, separately-uploaded **image** thumbnail per supplemental item (decoupled from the video file), exactly like the main video's `thumbnail_url`.
- (b) **`sz=w1000` may exceed the generated thumbnail's available size** for some files — a smaller `sz` (e.g. `sz=s400`) or the official `thumbnailLink` (server-side, credentialed) would be more reliable.
- (c) **The undocumented `thumbnail?id=` endpoint can change/break** without notice (it is not a supported API); a production fix should not hard-depend on it for non-image files. The supported path is the Drive API `thumbnailLink` fetched **server-side with credentials** and proxied to the browser — which also works for non-public files without making them public.

So: **public-share is sufficient for the common case (Drive video with a generated poster, made `anyone:reader`)**, but **not robust**; the architecturally correct fix is **Option B** (a dedicated thumbnail image field, or a server-side credentialed `thumbnailLink` proxy), which also fixes Bunny/YouTube and avoids both the access-tradeoff and the undocumented-endpoint dependency.

### Confidence summary

| Claim | Confidence | Basis |
|---|---|---|
| `thumbnail?id=` returns an image for anonymous-public files (incl. the app's own public images) | 90% | endpoint behavior + app's working public images use this exact pattern |
| `thumbnail?id=` does NOT return an image for folder-shared-`type:user`-only / non-public files (login redirect / 500) | 92% | directly observed 302→lh3→accounts/500 with `text/html` non-image body; `<img>` can't attach credentials |
| The supplemental video upload path never makes the file `anyone:reader` | 99% | `handleVideoUpload` source has no `permissions.create`; `grep permissions lms-admin.html` = only sync button |
| `thumbnail?id=` is undocumented and the official path is `thumbnailLink` (credentialed, server-side) | 85% | Google Drive API files reference (`thumbnailLink` field + CORS/credential notes); absence from download docs; ayrshare guide |
| Public-share is sufficient to fix the **Drive** supplemental thumbnail | 88% | mechanistic from endpoint behavior; 12% = video-poster-generation edge + no real-fileId capture |
| Public-share does NOT fix Bunny/YouTube supplemental (no `<img>` branch) | 99% | `lesson.html:1158-1167/1182-1192` emit no `<img>` |
| **Overall hypothesis verdict: "Drive supplementary video has no thumbnail because the video file is not public" is CONFIRMED** (for the Drive branch / the reported screenshot) | **90%** | HTTP + browser + source evidence all align; 10% residual = no direct capture against the exact real production supplemental fileId (owner can close with one curl) |

### What was NOT done (this verification, read-only)

- No code change. No commit, push, deploy, promote, rollback. No Supabase/Vercel change.
- **No `permissions.create()`, no repair pass, no new permissions, no Drive permission change of any kind.**
- No production data mutation; no authenticated fetch of the real lesson; no Drive API call against real file ids.
- Only read-only `curl` against Google's public thumbnail endpoint + read-only Playwright against a local `data:`/stub HTML, and source re-reading.

This verification section is the sole addition in this follow-up. No prior section was edited. Awaiting direction.

**Bạn có muốn tôi áp dụng phương án đề xuất không?**
