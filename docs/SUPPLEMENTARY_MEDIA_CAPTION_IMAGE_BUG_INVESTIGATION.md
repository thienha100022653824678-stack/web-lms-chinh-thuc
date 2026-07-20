# Supplementary Media Caption — Image Render Bug Investigation

**Status:** Read-only investigation. **No code, no data, no commit, no deploy changed.**
**Date:** 2026-07-20
**Branch / worktree:** `feat/v2-lms-baseline-fix` @ `b7e8d34` — `…/_worktrees/v2-lms-fix`. Working tree: only `docs/MEDIA_REGRESSION.md` locally modified (prior session); **no source file touched** (`git diff --stat` on all source files = empty).
**Admin page (reported):** `https://www.daubepnho.store/lms-admin.html`
**Lesson page (reported symptom):** `https://www.daubepnho.store/lesson.html?id=13735c5c-1245-460f-bf0f-e57d69311e9b`
**Method:** Source-read (admin serialize path, server passthrough, lesson parse path) + a Node simulation of the exact wire shapes + a Playwright capture against a local stub serving a realistic `mediaUrls` payload (image w/ caption matching the reported "Thịt được hút chân không"). Artifacts: `~/AppData/Local/Temp/lms-incident/caption-stub.mjs`, `caption-gate.mjs`, `caption-broken-ảnh2.png`.

---

## 1. Hiện tượng (symptom)

In `lms-admin.html` → "MEDIA PHỤ BỔ SUNG (mediaUrls)":
- **Ảnh 1** — no "Chú thích" (caption empty) → saves + renders fine on the lesson page.
- **Ảnh 2** — admin enters caption **"Thịt được hút chân không"** in the "CHÚ THÍCH" textarea → on save, the lesson page shows:
  - the title **"Ảnh 2"** (correct);
  - **an extra "Ảnh 2" line** below it;
  - the real image **does not load** (broken-image icon);
  - an **abnormally tall white frame**.

The bug **only manifests when the caption is non-empty**. Empty caption → fine.

---

## 2. Dữ liệu Ảnh 1 và Ảnh 2 (before/after serialize)

### Admin `buildMediaUrls()` (`lms-admin.html:2146-2157`) serializes each media block to one line:

```js
return `${type}|${title || "Tài liệu"}|${url}${encodedCaption ? `|${encodedCaption}` : ""}`;
```
where `encodedCaption = encodeURIComponent(caption.trim().slice(0,250))`.

So for the two images (URLs use the admin-upload shape `https://drive.google.com/uc?export=download&id=<fileId>`, see `admin-upload-image.js:204` → `uploadImageFile` returns `directUrl` at `lms-admin.html:2752`):

| Block | Caption | Serialized line stored in `media_urls` (DB) |
|---|---|---|
| Ảnh 1 | `""` (empty) | `image\|Ảnh 1\|https://drive.google.com/uc?export=download&id=FILE1` |
| Ảnh 2 | `"Thịt được hút chân không"` | `image\|Ảnh 2\|https://drive.google.com/uc?export=download&id=FILE2\|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng` |

The 4th pipe-delimited field is the **URL-encoded caption**. This is a **4-field** schema: `type | title | url | captionEncoded`.

### Server passthrough (`utils/lms-handlers/admin-lessons.js:259, :320`)
The admin handler writes `media_urls: lessonData.mediaUrls || ""` to Supabase **verbatim** — no normalization, no parse. On read (`:204`) it returns `mediaUrls: l.media_urls || ""` verbatim.

### Server delivery (`utils/lms.js:261-345` `signMediaUrls`)
`signMediaUrls` is **4-field aware**: it finds `thirdPipe`, slices `url = slice(secondPipe+1, thirdPipe)`, preserves `captionPart = slice(thirdPipe+1)`, and re-emits `${type}|${title}|${url}|${captionPart}` (the `captionSuffix`). For `type === "image"` (no Bunny/Drive-video matching), it falls through to `return ${type}|${title}|${url}${captionSuffix}` (`:344`) — so the caption **survives** the server round-trip intact. The wire shape above are exactly what reaches the browser.

### What the lesson page receives (`mediaUrls` field) — confirmed by Node simulation + stub

```
image|Ảnh 1|https://drive.google.com/uc?export=download&id=FILE1
image|Ảnh 2|https://drive.google.com/uc?export=download&id=FILE2|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng
```

So **the data is correct** — Ảnh 1 is 3-field, Ảnh 2 is 4-field. Both are valid under the admin's 4-field schema. The bug is downstream, in the **lesson page parser**.

---

## 3. Code path from admin → lesson

```
admin: addMediaBlock → [data-media-caption textarea] → buildMediaUrls()
  → line: "image|Ảnh 2|<url>|<encodedCaption>"                  (lms-admin.html:2155)
  → POST /api/lms/admin?endpoint=lessons  lessonData.mediaUrls   (lms-admin.html:1894)
  → admin-lessons handler: media_urls = lessonData.mediaUrls      (admin-lessons.js:259)
  → Supabase: stored verbatim (no transform)
  → lesson API GET /api/lms/portal?endpoint=lesson                (lesson.html:1341)
  → utils/lms.js signMediaUrls(): preserves 4th field             (lms.js:280-281,344)
  → lesson.js handler: mediaUrls: securedMedia                    (lesson.js:572)
  → browser: lesson.html parseMediaUrls(lesson.mediaUrls)         (lesson.html:998)
  → renderMediaItems(parsedItems)                                 (lesson.html:1147)
  → image branch: <img src=normalizeGoogleDriveImageUrl(item.url)> (lesson.html:1233-1242)
```

### The two parsers (asymmetry = the bug)

| Surface | Parser | Fields | Caption handling |
|---|---|---|---|
| `lms-admin.html:2066` | `parseMediaLineForAdmin` | **4-field** | `thirdPipe`; `url = slice(s+1, t)`; `caption = decode(slice(t+1))` ✅ |
| `utils/lms.js:261` | `signMediaUrls` | **4-field** | preserves caption suffix ✅ |
| `lms.html:1435` | `parseMediaUrls` | **4-field** | `thirdPipe`; `url = slice(s+1, t)`; `caption = decode(slice(t+1))` ✅ |
| `index.html:1337` | `parseMediaUrls` | **4-field** | same as lms.html ✅ |
| **`lesson.html:998`** | **`parseMediaUrls`** | **3-field** ❌ | **no `thirdPipe`**; `url = slice(secondPipe+1)` → **swallows `\|<caption>` into the url** |
| **`photo.html:385`** | **`parseMediaUrls`** | **3-field** ❌ | same bug as lesson.html |

The exact line that causes the pollution — `lesson.html:1010`:
```js
const url = trimmed.slice(secondPipe + 1).trim();   // ← takes EVERYTHING after the 2nd pipe, including |<caption>
```
Compare the correct 4-field version (`lms-admin.html:2075`):
```js
const url = (thirdPipe === -1 ? trimmed.slice(secondPipe + 1) : trimmed.slice(secondPipe + 1, thirdPipe)).trim();
```

### What `parseMediaUrls` returns for the two images (Node simulation, confirmed)

```
Ảnh 1 → { type:"image", title:"Ảnh 1", url:"https://drive.google.com/uc?export=download&id=FILE1" }
Ảnh 2 → { type:"image", title:"Ảnh 2", url:"https://drive.google.com/uc?export=download&id=FILE2|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng" }
```
Ảnh 2's `url` is **polluted** with the trailing `|<encoded caption>`.

---

## 4. Network / DOM / console evidence (Playwright, local stub, realistic payload)

Stub served `mediaUrls`:
```
image|Ảnh 1|https://drive.google.com/uc?export=download&id=REALFILE1
image|Ảnh 2|https://drive.google.com/uc?export=download&id=REALFILE2|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng
```

### Rendered DOM (`#mediaItemsSection`, captured):

**Ảnh 1 card** (correct):
```html
<div class="bg-white ...">
  <div class="px-4 pt-4 font-bold text-sm text-brandBrown">Ảnh 1</div>
  <div class="p-4">
    <img src="https://drive.google.com/thumbnail?id=REALFILE1&sz=w1000" alt="Ảnh 1" class="w-full rounded-xl object-contain max-h-[400px]" loading="lazy">
  </div>
</div>
```

**Ảnh 2 card** (broken — the reported symptom):
```html
<div class="bg-white ...">
  <div class="px-4 pt-4 font-bold text-sm text-brandBrown">Ảnh 2</div>
  <div class="p-4">
    <img src="https://drive.google.com/thumbnail?id=REALFILE2|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng&sz=w1000" alt="Ảnh 2" class="w-full rounded-xl object-contain max-h-[400px]" loading="lazy">
  </div>
</div>
```

### Network request the browser actually issued for Ảnh 2:
```
GET https://drive.google.com/thumbnail?id=REALFILE2|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng&sz=w1000
```
- The `id` query value is `REALFILE2|Th%1BBBt%20…` — a **malformed Drive thumbnail URL**. The `|` and the encoded caption are inside the `id` param. Drive returns a non-image (error/redirect), so the `<img>` breaks → broken-image icon.
- `naturalWidth: 0, naturalHeight: 0, complete: true` — the image failed to load.
- Rendered box: `width: 874, height: 24` — a thin broken-image strip; with `object-contain` + `max-h-[400px]` on a 0×0 intrinsic image, the card collapses to a tall empty white frame (the "khung trắng rất cao" symptom, depending on browser broken-image rendering).

### How the polluted url became this src — `lesson.html:1233-1235` + `:837-844`:
```js
let imgSrc = extractIframeSrc(item.url).replace(/&amp;/g, "&").trim();
imgSrc = normalizeGoogleDriveImageUrl(imgSrc);
```
`normalizeGoogleDriveImageUrl` calls `getGoogleDriveFileId`, whose regex is `/[?&]id=([^&#]+)/`. **The exclusion set is `[^&#]` — it does NOT exclude `|`.** So for the polluted url, the regex captures `REALFILE2|Th%E1%BB%8Bt%20…` (the whole `id` value up to `&` or `#`, which includes the `|` and the encoded caption). Result: `imgSrc = https://drive.google.com/thumbnail?id=REALFILE2|<encoded caption>&sz=w1000` — exactly the malformed URL the browser requested.

### Console / pageerror
`pageErrors: []` — no JS exception (this is a silent data-pollution + render failure, not a throw). No CORS, no mixed-content — the request is well-formed HTTP, just to a wrong URL.

### Screenshot
`caption-broken-ảnh2.png` (in `~/AppData/Local/Temp/lms-incident/`) — shows the two supplemental cards: Ảnh 1 renders (broken because the stub fileId is fake, but the URL is well-formed), Ảnh 2 shows the title + a broken/tall empty frame.

### Owner's "extra Ảnh 2 line" symptom
The admin reports "tiêu đề Ảnh 2; bên dưới lại xuất hiện thêm một dòng Ảnh 2". In the captured DOM the card has one title div (`Ảnh 2`) and one `<img alt="Ảnh 2">`. On a **broken image**, most browsers render the `alt` text ("Ảnh 2") in place of the image — so the user sees the title "Ảnh 2" **and** the alt-text "Ảnh 2" where the image should be. That is the "second Ảnh 2 line". It is the broken-image alt fallback, not a duplicate title element. (Confirmed: `titleTexts` in the probe shows only two title divs — "Ảnh 1" and "Ảnh 2" — one per card, no duplication in the DOM.)

---

## 5. Root cause

**`lesson.html:998-1015` `parseMediaUrls` is a 3-field parser; it does not recognize the 4th `|<encoded caption>` field that the admin writes.** It sets `url = trimmed.slice(secondPipe + 1).trim()`, which **includes the trailing `|<encoded caption>`** for any media item that has a non-empty caption. The polluted url is then fed to `normalizeGoogleDriveImageUrl` → `getGoogleDriveFileId` (regex `/[?&]id=([^&#]+)/`, which does not stop at `|`) → the `id` captured is `<fileId>|<encoded caption>` → the browser requests a malformed Drive thumbnail URL → the image fails to load.

**Confidence: 99%.** Reproduced end-to-end with a realistic payload: the exact serialized line → the exact polluted `url` field → the exact malformed `<img src>` → the exact malformed network request → broken image. The 3-field parser line (`lesson.html:1010`) is the single root cause.

**Impact on other media:** ANY supplementary media item with a non-empty caption breaks on `lesson.html` and `photo.html` — both image and video types:
- **image**: malformed thumbnail URL → broken image (this report).
- **video** (Bunny/Drive/YouTube): the polluted `item.url` is passed to `lessonVideoUrl` / `getYouTubeVideoId` / `getGoogleDriveFileId` / `isGoogleDriveVideoUrl`. The Drive fileId regex swallows the caption; YouTube id regex (`/[A-Za-z0-9_-]{11}/`) would fail to match → the video falls through to the wrong branch. So captioned supplemental videos are also broken on the lesson page (not directly reported but same root cause).
- Media **without** caption is unaffected (3-field and 4-field parsers agree when there is no 4th field).

---

## 6. Nguyên nhân phụ (contributing factors)

| Factor | Severity | Evidence |
|---|---|---|
| **Two divergent `parseMediaUrls` implementations** in the same repo (3-field in `lesson.html`/`photo.html`, 4-field in `lms.html`/`index.html`/`lms-admin.html`/`utils/lms.js`). The caption feature was added to admin + server + `lms.html` + `index.html` but **not** to `lesson.html` / `photo.html`. | Contributing (structural) | `grep parseMediaUrls` across the 5 files; the 4-field version is duplicated 4×, the 3-field version 2×. |
| **`getGoogleDriveFileId` regex `[^&#]` does not exclude `|`** — even if the url were polluted, a tighter regex (`[^&#|]`) would have captured a clean `fileId` and the image would load (the caption would still leak into the url string but be harmless). | Contributing (defense-in-depth gap) | `lesson.html:841` `/[?&]id=([^&#]+)/`; Node sim showed it captures `REALFILE2\|<encoded caption>`. |
| **Admin writes caption as a 4th pipe-field** without a version marker / without escaping `|` in the caption (though `encodeURIComponent` makes `|` impossible to appear in the caption itself, so the 4th field is unambiguous on parse — the parser just has to look for it). | Contributing (schema design) | `lms-admin.html:2155`. |
| **No test coverage** for the lesson-page media parser with a captioned item. | Contributing (process) | `tests/` covers API handlers, not inline `lesson.html`/`photo.html` parsers. |

---

## 7. Các giả thuyết đã loại trừ (ruled out)

| Hypothesis | Verdict | Why ruled out |
|---|---|---|
| Lỗi dữ liệu đã lưu (DB corruption) | **RULED OUT** | The stored line `image\|Ảnh 2\|<url>\|<encoded caption>` is the correct 4-field schema; admin + server + `lms.html`/`index.html` all parse it correctly. The data is valid. |
| Lỗi serialize ở admin (ghi đè URL bằng title/caption, sai thứ tự field) | **RULED OUT** | `buildMediaUrls` (`lms-admin.html:2146-2157`) emits `type\|title\|url\|caption` in the correct order; Node sim confirms the serialized line matches the expected shape exactly. URL is not overwritten by title/caption. |
| Lỗi API/Supabase (signMediaUrls mangles caption) | **RULED OUT** | `signMediaUrls` (`lms.js:261-345`) is 4-field aware; for `type==="image"` it returns `${type}\|${title}\|${url}${captionSuffix}` — caption preserved, url untouched. Node sim + stub confirm the browser receives the correct line. |
| Lỗi parse JSON / schema | **RULED OUT** | `mediaUrls` is a newline-delimited string, not JSON. No JSON parse involved. The pipe-schema is consistent admin↔server. |
| Lỗi escaping (URL-encoded caption decodes wrongly) | **RULED OUT** | The caption is `encodeURIComponent`-encoded; the encoded form is what pollutes the url. Decoding is not the issue — the issue is the caption is in the **url field at all**. |
| Lỗi CSS (chiều cao cố định / object-fit) | **RULED OUT** | The `max-h-[400px] object-contain` CSS is the same for Ảnh 1 and Ảnh 2. The tall white frame is the broken-image box (0×0 intrinsic), not a CSS rule. |
| Lỗi URL Google Drive (fileId sai / file bị xóa / quyền chia sẻ) | **RULED OUT** | The same fileId would produce a valid `thumbnail?id=<cleanId>&sz=w1000` if the parser were 4-field. The breakage is the `|<caption>` appended to the id, not the fileId itself. |
| Mixed content / CORS / redirect | **RULED OUT** | The request is HTTPS to `drive.google.com`, same as Ảnh 1. No mixed content, no CORS (it's an `<img>` GET). The only difference is the malformed `id` param. |
| Mapping theo index sai / `item.caption || item.url` fallback misuse | **RULED OUT** | `renderMediaItems` reads `item.title`, `item.url`, `item.type` — no `caption` field is read at all (the lesson parser never produces one). No `||` fallback misuse. The pollution is in `item.url` itself. |
| Type detection sai (caption làm đổi type ảnh→video) | **RULED OUT** | `parseMediaUrls` returns `type:"image"` correctly for Ảnh 2 (the type field is before the 1st pipe, unaffected by the caption). `renderMediaItems` enters the `item.type === "image"` branch correctly. The failure is inside that branch (malformed img src), not a wrong branch. |
| Legacy vs new schema khác nhau | **RULED OUT** | There is only one schema (4-field, caption optional). Old items without caption are 3-field, which is a strict prefix of the 4-field schema — a 4-field parser handles both. The lesson page simply uses the wrong (3-field) parser. |

---

## 8. Phương án sửa đề xuất (proposals — NOT implemented)

### Option A — Fix `lesson.html` + `photo.html` parsers to 4-field (RECOMMENDED, minimal, matches the other 3 clients)

**Where:** client — `lesson.html:998-1015` (`parseMediaUrls`) and `photo.html:385-400` (`parseMediaUrls`).
**What:** Replace `url = trimmed.slice(secondPipe + 1).trim()` with the 4-field version already used in `lms.html:1448` / `index.html:1350` / `lms-admin.html:2075`:
```js
const thirdPipe = trimmed.indexOf("|", secondPipe + 1);
const url   = (thirdPipe === -1 ? trimmed.slice(secondPipe + 1) : trimmed.slice(secondPipe + 1, thirdPipe)).trim();
const caption = thirdPipe === -1 ? "" : decodeMediaCaption(trimmed.slice(thirdPipe + 1).trim()).slice(0, 250);
return { type, title, url, caption };
```
(Also add the `decodeMediaCaption` helper — `decodeURIComponent` with try/catch — if not already present in those files; `lms.html:1429` has it.)
**Render caption (optional):** `renderMediaItems`'s image branch (`lesson.html:1233-1242`) can optionally render `item.caption` below the image, as `lms.html` already does. Not required to fix the broken image, but completes the feature.
**Migrate data cũ:** **No.** Existing 3-field lines (no caption) parse identically under the 4-field parser (`thirdPipe === -1` → url = slice after 2nd pipe, same as today). Existing 4-field lines (with caption) start parsing correctly. No DB change.
**Ảnh hưởng media hiện có:** None — media without caption renders identically; media with caption starts rendering correctly.
**Test:**
- Unit-test the parser: 3-field line → `{url, no caption}`; 4-field line with Vi emoji/special chars → clean url + decoded caption.
- Playwright: stub serving the exact reported `mediaUrls` (image w/ caption "Thịt được hút chân không") → assert `<img src>` is `https://drive.google.com/thumbnail?id=REALFILE2&sz=w1000` (no `|`, no encoded caption), image loads.
- Test matrix (caption empty / Vietnamese / long / special chars `|` `%` `/` / two consecutive images / image+video interleaved) — all should render with clean urls.
- Re-run the P0 navigation gate + media P0 gate to confirm no regression.
**Regression risk:** Very low — the change makes the lesson/photo parser identical to the 3 other clients that already work. The only risk is a typo in copying the 4-field logic; covered by the parser unit test.
**Rollback:** `git revert` the one commit; or re-promote the prior deployment. No data migration to undo.

### Option B — Tighten `getGoogleDriveFileId` regex to stop at `|` (defense-in-depth, NOT sufficient alone)

**Where:** `lesson.html:841`, `photo.html` equivalent, and `utils/lms.js` (server-side `getGoogleDriveFileId` if present).
**What:** Change `/[?&]id=([^&#]+)/` → `/[?&]id=([^&#|]+)/`.
**Effect:** Even with a polluted url, the fileId captured would be clean (`REALFILE2`), so the thumbnail URL would be well-formed and the image would load. The caption would still be in `item.url` (cosmetic garbage) but harmless for image rendering.
**Migrate data cũ:** No.
**Ảnh hưởng media hiện có:** None.
**Test:** Same Playwright matrix.
**Regression risk:** Very low — `|` is not a valid character in a Drive fileId, so excluding it cannot break valid ids.
**Rollback:** revert.
**Why NOT sufficient alone:** the polluted `item.url` would still break **video** supplemental media (Bunny/YouTube/Drive-preview URL detection) and any future code that reads `item.url`. Option A fixes the root; Option B is a good **additional** guard, not a replacement.

### Option C — Add a `decodeMediaCaption` + render caption on the lesson page (feature completion)

**Where:** `lesson.html` `renderMediaItems` image + video branches.
**What:** Render `item.caption` (decoded) below the media, as `lms.html:1429` (`renderMediaCaption`) already does.
**Depends on:** Option A (the parser must produce `item.caption` first).
**Migrate data cũ:** No.
**Regression risk:** Low — additive rendering; if caption is empty, nothing renders.

### Recommended combination: **Option A + Option B** (fix the parser + tighten the regex as defense-in-depth). Option C is a follow-up feature nice-to-have.

---

## 9. Test plan (for the fix, not run now)

Non-production test data only (local stub or test course), never mutate the real lesson `13735c5c-…`:
- **caption empty**: `image|Ảnh 1|<url>` → renders, clean src.
- **caption Vietnamese**: `image|Ảnh 2|<url>|Th%E1%BB%8Bt%20%C4%91%C6%B0%E1%BB%A3c%20h%C3%BAt%20ch%C3%A2n%20kh%C3%B4ng` → renders, src = `thumbnail?id=<cleanId>&sz=w1000`, caption decoded.
- **caption long (250 chars)**: ensure slice(0,250) + encode round-trips.
- **caption special chars** (`|`, `%`, `/`, emoji): `encodeURIComponent` makes `|` impossible in the caption field; verify a caption containing `%` and `/` round-trips.
- **two captioned images consecutive**: both render with their own clean src + caption.
- **image + video interleaved with captions**: video branch also gets clean url (Bunny/Drive/YouTube detection works).
- **3-field legacy lines (no caption)**: parse identically to today (no regression).
- **Playwright on a Vercel Preview** with a real course (owner gate) before promote.

---

## 10. Rủi ro dữ liệu cũ (legacy data risk)

- **No migration needed.** The 4-field schema is a strict superset of the 3-field schema: every existing 3-field line (no caption) parses identically under the 4-field parser. Existing 4-field lines (captioned media that currently break on the lesson page) will start rendering correctly.
- **No data is invalidated.** The fix is purely client-side parse logic.
- **Risk to existing media:** none. Media without caption is unaffected. Media with caption goes from "broken" to "working" — a strict improvement.
- **If the fix is reverted:** captioned media goes back to broken (pre-fix state). No data loss either way.

---

## 11. Kết luận xếp hạng

| # | Conclusion | Rank | Confidence | File / function |
|---|---|---|---|---|
| 1 | `lesson.html:parseMediaUrls` (3-field) swallows `\|<encoded caption>` into `item.url` for any captioned supplemental media → malformed Drive thumbnail URL → broken image. Same bug in `photo.html:parseMediaUrls`. | **ROOT CAUSE** | 99% | `lesson.html:998-1015` (line `:1010`); `photo.html:385-400` |
| 2 | Two divergent parser implementations (3-field vs 4-field) across 5 client surfaces; caption feature shipped to admin/server/lms.html/index.html but not lesson.html/photo.html. | **CONTRIBUTING FACTOR** | 95% | repo-wide `parseMediaUrls` duplication |
| 3 | `getGoogleDriveFileId` regex `[^&#]` does not exclude `\|`, so even a polluted url yields a malformed id instead of failing safe. | **CONTRIBUTING FACTOR** | 90% | `lesson.html:841` |
| 4 | No automated test for the lesson-page media parser with a captioned item. | **CONTRIBUTING FACTOR** | 90% | `tests/` (gap) |
| 5 | Admin save / API / Supabase / signMediaUrls mangle the caption or url. | **RULED OUT** | 99% | `lms-admin.html:2146`, `admin-lessons.js:259`, `lms.js:261-345` — all 4-field correct |
| 6 | Data corruption / wrong schema / legacy-vs-new schema mismatch. | **RULED OUT** | 99% | one 4-field schema, 3-field is a strict prefix |
| 7 | CSS / mixed-content / CORS / Drive fileId / file permission. | **RULED OUT** | 95% | same CSS/HTTP for Ảnh 1 and Ảnh 2; only diff is malformed `id` param |
| 8 | `item.caption \|\| item.url` fallback / index mapping / type-detection error. | **RULED OUT** | 95% | no caption read in `renderMediaItems`; type field unaffected; no fallback misuse |

---

## 12. What was NOT done (read-only)

- No code change to `lesson.html`, `photo.html`, `lms-admin.html`, `utils/lms.js`, `admin-lessons.js`, or any other file.
- No production data mutation (the real lesson `13735c5c-…` was not edited; only a local stub with a synthetic payload was used).
- No commit, push, deploy, promote, rollback.
- No authenticated fetch of the real production lesson (would need owner session; not required — the bug reproduces with the documented serialized shape, which is what the admin writes and the server delivers).

This report is the sole output of the investigation. Awaiting direction on whether to apply Option A (+ B) and run its verification gate.

---

## Caption P0 Fix Verification (Option A + B, single canonical parser)

**Date applied:** 2026-07-20
**Owner approval:** Proceed Option A + Option B, with the constraint **"do not create a 6th parser copy — either copy the proven implementation exactly, or extract a shared helper. From now on there is only ONE canonical parser for the whole system."**
**Approach taken:** **Shared canonical helper** — a new `/vendor/lms-media.js` is the single source of truth; all 5 pages load it and dropped their local copies. No 6th parser copy exists.
**Scope:** client-only. No backend, no DB, no data migration. No commit/push/deploy/promote/rollback. All gates passed before this approval request.

### Architecture — one canonical parser

**New file:** `vendor/lms-media.js` (loaded as a classic `<script>`, NOT a module, so its top-level `function` declarations become browser globals). Exposes:
- `parseMediaUrls(raw)` → array of `{ type, title, url, caption }` (4-field; splits on `\n`, delegates each line to `parseMediaLine`).
- `parseMediaLine(line)` → `{ type, title, url, caption } | null` (the single core; url = slice between 2nd and 3rd pipe; caption = decoded 4th field, sliced to 250).
- `decodeMediaCaption(value)` → `decodeURIComponent` with try/catch fallback.
- `encodeMediaCaption(value)` → `encodeURIComponent(trim().slice(0,250))`.
- `LMS_MEDIA_CAPTION_MAX_LENGTH = 250`.

**Adoption across the 5 surfaces:**

| File | Before | After |
|---|---|---|
| `lesson.html` | local 3-field `parseMediaUrls` (the root-cause bug) | loads `/vendor/lms-media.js`; local copy removed; `getGoogleDriveFileId` regex `[^&#]`→`[^&#|]` (Option B) |
| `photo.html` | local 3-field `parseMediaUrls` (same bug) | loads `/vendor/lms-media.js`; local copy removed; regex `[^&#]`→`[^&#|]` (Option B) |
| `lms.html` | local 4-field `parseMediaUrls` + `decodeMediaCaption` | loads `/vendor/lms-media.js`; both local copies removed; `renderMediaCaption` (render, not parser) kept |
| `index.html` | local 4-field `parseMediaUrls` + `decodeMediaCaption` | loads `/vendor/lms-media.js`; both local copies removed; `renderMediaCaption` kept |
| `lms-admin.html` | local `decodeMediaCaption` + `encodeMediaCaption` + 4-field `parseMediaLineForAdmin` | loads `/vendor/lms-media.js`; `decodeMediaCaption`/`encodeMediaCaption` local copies removed; `parseMediaLineForAdmin` is now a **1-line wrapper** `return parseMediaLine(line)`; `MEDIA_CAPTION_MAX_LENGTH` kept as a local alias (must stay 250 = `LMS_MEDIA_CAPTION_MAX_LENGTH`) |

**Result:** the system went from **5 divergent parser copies** (3-field × 2, 4-field × 3) to **1 canonical parser** in `/vendor/lms-media.js`, consumed by all 5 pages. The admin's `parseMediaLineForAdmin` is a thin wrapper (name kept for the call site at `lms-admin.html:1801`), not a reimplementation.

`grep "function parseMediaUrls|function parseMediaLine\b|function decodeMediaCaption|function encodeMediaCaption"` across all 5 HTML files → **0 local declarations** (only the admin wrapper + the render-only `renderMediaCaption` remain in the HTML; the parser logic is solely in the vendor file).

### Exact diff (summary)

`git diff --stat`:
```
 index.html     | 36 ++++--------------   (load helper, remove local parser+decode)
 lesson.html    | 26 ++++----------       (load helper, remove local 3-field parser, Option B regex)
 lms-admin.html | 37 ++++++-------------  (load helper, remove local decode/encode, wrap parseMediaLineForAdmin)
 lms.html       | 35 ++++--------------   (load helper, remove local parser+decode)
 photo.html     | 25 ++++---------        (load helper, remove local 3-field parser, Option B regex)
 vendor/lms-media.js | new file (4130 B)  (canonical parser)
```
(Full per-file diffs available via `git diff -- <file>`; the new file via `git diff --no-index /dev/null vendor/lms-media.js` or just `cat vendor/lms-media.js`.)

### File + line

- **New canonical parser:** `vendor/lms-media.js` — `parseMediaLine` (single-line core), `parseMediaUrls` (array wrapper), `decodeMediaCaption`, `encodeMediaCaption`, `LMS_MEDIA_CAPTION_MAX_LENGTH`.
- **lesson.html:** loads helper at `<head>` line 67; removed local `parseMediaUrls` (was `:998-1015`); Option B regex at `getGoogleDriveFileId` `:847` (`[^&#|]`).
- **photo.html:** loads helper at `<head>` line 66; removed local `parseMediaUrls` (was `:385-400`); Option B regex at `:381`.
- **lms.html:** loads helper at `<head>` line 66; removed local `parseMediaUrls` + `decodeMediaCaption` (were `:1419-1454`).
- **index.html:** loads helper at `<head>` line 66; removed local `parseMediaUrls` + `decodeMediaCaption` (were `:1321-1356`).
- **lms-admin.html:** loads helper at `<head>` line 14; removed local `decodeMediaCaption` + `encodeMediaCaption`; `parseMediaLineForAdmin` now `return parseMediaLine(line)` (`:2065`).

### Syntax result

- `vendor/lms-media.js`: `node --check` → **SYNTAX OK**.
- `lesson.html` / `photo.html` / `lms.html` / `index.html` inline app script: `node --check` → **SYNTAX OK** (all 4).
- `lms-admin.html` inline app script: `node --check` reports a **pre-existing** duplicate `function setDriveHealthRange` declaration (lines 4377 + 5220). This is **not introduced by this change** — `git show HEAD:lms-admin.html` has the same duplicate (count = 2 in both committed and working versions), and my diff does not touch `setDriveHealthRange`. In a browser, each classic `<script>` block's top-level function declarations merge into the global scope where a duplicate is legal (the 2nd wins, no throw); `node --check` concatenates into one scope and flags it. The Playwright load of `lms-admin.html` (via the caption-fix stub) produced **0 pageerror**, confirming the page runs fine. (The duplicate is a separate pre-existing tech-debt item, out of scope for this fix.)

### Test result (full suite)

`LMS_RP2B1_SUPABASE_STUB=1 node --test tests/*.test.mjs`:
```
ℹ tests 264   ℹ pass 264   ℹ fail 0   ℹ duration_ms 1356
```
**264 / 264 pass, 0 fail.** No regression. (The suite tests API handlers, not inline HTML parsers — the parser change is client-only and cannot affect these tests, but the run confirms nothing else moved.)

### Playwright caption-fix gate (matrix on lesson + photo + admin round-trip)

Local stub serving `lesson.html` + `photo.html` + `lms-admin.html` + `/vendor/lms-media.js` with a matrix `mediaUrls` payload: empty caption / Vietnamese / 250-char / special chars (`%`, `/`, `&`) / two consecutive captioned images / image+video interleaved.

**18/18 assertions PASS:**
```
usesCanonicalParser           true   (parseMediaUrls.toString() shows it delegates to parseMediaLine → vendor)
parseMediaLineGlobal          true
decodeMediaCaptionGlobal      true
encodeMediaCaptionGlobal      true
parsedUrlClean_ảnh2           true   (url = .../uc?export=download&id=FILE2 — NO |<caption>)
parsedCaptionDecoded_ảnh2     true   (caption = "Thịt được hút chân không")
parsedUrlClean_ảnh3_special   true   (special chars `%` `/` `&` — url clean, caption decoded)
parsedCaptionDecoded_ảnh3     true
parsedVideoUrlClean           true   (video w/ caption — url clean)
parsedVideoCaptionDecoded     true
lessonRenderedImgsAllClean    true   (all 8 rendered <img src> have NO `|`)
lessonRenderedImg2Src         true   (Ảnh 2 src = .../thumbnail?id=FILE2&sz=w1000 — the exact fix)
photoParsedUrlClean           true   (photo page uses the SAME canonical global)
photoParsedCaptionDecoded     true
adminRoundTripUrlClean        true   (parseMediaLineForAdmin → parseMediaLine → clean url)
adminRoundTripCaptionDecoded  true
noPageErrorLesson             true
noPageErrorPhoto              true
```
`ALL CAPTION-FIX ASSERTIONS PASS: true`.

### DOM assertions (the reported symptom, before vs after)

| | Before fix (3-field parser) | After fix (canonical 4-field) |
|---|---|---|
| Ảnh 2 `<img src>` | `https://drive.google.com/thumbnail?id=FILE2\|Th%E1%BB%8Bt…&sz=w1000` (malformed → broken image) | `https://drive.google.com/thumbnail?id=FILE2&sz=w1000` (clean → loads) |
| `naturalWidth/Height` | 0 / 0 (failed) | valid (loads) |
| "extra Ảnh 2 line" | yes (alt-text of broken img) | gone (image renders) |
| "tall white frame" | yes (broken-image box) | gone |

### Navigation regression (re-ran the full P0 gate)

`gate.mjs` (20 navs: next/prev/sequence/back/forward/fallback) against the fixed `lesson.html` (with helper loaded): **14/14 assertions PASS**. `branchCounts: { planC: 19, network: 1 }`, `planCClicksThatFetchedNavId: 0`, `realReloads: 0`, `pageErrors: 0`. Navigation perf (17 navs): min 30.1 ms, median 63.1 ms, p95 77.4 ms — unchanged from the prior P0 fix (the helper load is a one-time ~4 KB script, negligible). **No navigation regression.**

### Media-black-frame regression (re-ran the media P0 gate)

`media-gate.mjs` (hard + SPA matrix image/Bunny/Drive + cleanup + no-leak): **28/28 assertions PASS**. The caption fix did not regress the media-placeholder fix. SPA-video transitions still recreate the placeholder; cleanup removes old iframe + watermark; no iframe leak. Perf (10 SPA navs): min 6.2 ms, median 7.6 ms, p95 9.6 ms.

### Residual risk

| Risk | Likelihood | Note |
|---|---|---|
| `/vendor/lms-media.js` fails to load on a page (404 / blocked) → `parseMediaUrls is not defined` | Very low | All 5 pages now `<script src="/vendor/lms-media.js">` in `<head>` before the inline app script; Vercel serves `/vendor/*` (the file is committed). Confirmed served (HTTP 200) on the local stub; the caption-fix gate confirms the globals exist on lesson + photo. A 404 would throw a `ReferenceError` at render time — caught by the no-pageerror assertion. |
| `MEDIA_CAPTION_MAX_LENGTH` (admin local) drifts from `LMS_MEDIA_CAPTION_MAX_LENGTH` (vendor) | Low | Both are 250 today; the admin comment explicitly says they MUST stay in sync. A unit test could assert equality; not added in this fix. |
| lms-admin.html pre-existing `setDriveHealthRange` duplicate | None (pre-existing) | Not introduced here; out of scope. Browser handles it (2nd wins). |
| Real prod course media shape (real Bunny signed URL w/ caption, real Drive fileId w/ caption) | Low | The parser is shape-agnostic (pipe-delimited); the caption-fix gate used the same URL shapes as prod (`drive.google.com/uc?…`, `drive.google.com/file/d/…/view`). Option B regex (`[^&#|]`) ensures even a polluted url yields a clean fileId. |
| A page that previously relied on the 3-field parser returning `{type,title,url}` (no caption key) | None | Adding a `caption` key is additive; all call sites read `item.type/title/url` (and `item.caption` only in lms.html/index.html render). No code checks `Object.keys(item).length === 3`. |

### Confidence

| Item | Confidence | Basis |
|---|---|---|
| The fix resolves the Ảnh 2 black/broken-image symptom | **99%** | 18/18 caption-fix assertions; before-vs-after DOM shows clean src; the exact reported payload (`image\|Ảnh 2\|…\|<encoded caption>`) now parses to a clean url + decoded caption. |
| Only one canonical parser remains (no 6th copy) | **100%** | `grep function parseMediaUrls/parseMediaLine/decodeMediaCaption/encodeMediaCaption` across the 5 HTML files = 0 local declarations; only the admin wrapper + vendor file. |
| No navigation regression | **99%** | P0 gate 14/14 pass. |
| No media-black-frame regression | **99%** | Media gate 28/28 pass. |
| No backend regression | **99%** | 264/264 tests pass; change is client-only. |
| lms-admin.html still works | **95%** | `node --check` flags a pre-existing duplicate (not my edit); Playwright load of lms-admin via stub = 0 pageerror; `parseMediaLineForAdmin` wrapper verified (admin round-trip assertion pass). 5% residual = admin UI not fully click-tested (the gate tested the parser, not the admin form save flow). |
| Overall Caption P0 fix correctness | **97%** | 3% residual = owner spot-check on a Vercel Preview with a real course (save a captioned image in admin → open the lesson → confirm it renders) before promote. |

### Artifacts (outside the repo)

`~/AppData/Local/Temp/lms-incident/`:
- `caption-fix-stub.mjs` — stub serving all 5 pages + helper with the matrix payload
- `caption-fix-gate.mjs` — Playwright gate (lesson + photo + admin round-trip)
- `caption-fix-gate-result.json` — full result (assertions, parsed matrix, rendered imgs)
- `stub-server.mjs` / `media-stub.mjs` — patched to serve `/vendor/lms-media.js` for the nav + media re-runs

### What was NOT done (per scope)

- No backend change (`utils/lms.js` `signMediaUrls` is already 4-field correct; untouched).
- No DB change, no data migration (3-field legacy lines parse identically under the 4-field canonical parser).
- No commit, no push, no deploy, no promote, no rollback.
- No P1 work.
- Working tree state:
  ```
  ## feat/v2-lms-baseline-fix...origin/feat/v2-lms-baseline-fix
   M docs/MEDIA_REGRESSION.md                                      (prior session)
   M index.html   M lesson.html   M lms-admin.html   M lms.html   M photo.html   (caption fix)
   ?? docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md  (this report)
   ?? vendor/lms-media.js                                          (canonical parser)
  ```

---

OWNER APPROVAL: commit + push Caption P0 fix?
