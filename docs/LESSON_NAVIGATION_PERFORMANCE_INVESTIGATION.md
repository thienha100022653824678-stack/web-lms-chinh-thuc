# Lesson Navigation Performance Investigation

**Scope:** Read-only investigation. No code, migration, deploy, commit, or production change.
**Subject:** `/lesson.html?id=13735c5c-1245-460f-bf0f-e57d69311e9b` — "Bài Tiếp Theo" / "Bài Trước" reported 5–6 s transfer with spinner.
**Branch:** `feat/v2-lms-baseline-fix` @ `94a150b` (worktree `v2-lms-fix`).
**Environment:** Production `www.daubepnho.store` (Vercel), Supabase B runtime (`aqozjkfwzmyfunqvcyjv`), Supabase A legacy. Owner authenticated locally.

---

## 1. Tóm tắt hiện tượng

Bấm "Bài Tiếp Theo" hoặc "Bài Trước" trong trang chi tiết bài học chuyển URL ngay, nhưng UI phải chờ khoảng **5–6 s** trước khi spinner tắt và nội dung bài mới hiện ra.

Phân tích dưới đây đo bằng `curl` (không có trình duyệt), không gắn instrumentation tạm, vì môi trường không có Playwright/Puppeteer và `ChromeDriver` không được owner-authorize để cài. Baseline dưới đây phản ánh từng nhịp server-side + static mà browser sẽ gặp.

---

## 2. Phương pháp đo

- **Network timing bằng `curl`** — 6 lần cho mỗi endpoint quan trọng, đo `dns`, `tls`, `ttfb`, `total`.
- **Response-headers inspection** — `curl -I` để xác minh `Cache-Control`, `ETag`, `Server`, `X-Vercel-Cache`.
- **Static read** — gồm HTML page, API lesson, API course-data, Tailwind Play CDN, Google Fonts, `gdrive-player.html`, `lms.html`.
- **Code path** — đọc trực tiếp `lesson.html` (1551 dòng), `api/lms/portal.js`, `utils/lms-handlers/lesson.js`, `utils/lms-handlers/course-data.js`, `utils/lms-session-guard.js` (mục 680→880), `utils/lms.js:215–340`, `utils/lms-media.js`, `utils/v2-runtime-controller.js`, `vercel.json`.
- **Conditional GET** — kiểm tra xem Vercel có trả `304` khi `If-None-Match` được gửi (để xác định khoảng overhead do no-cache gây ra trên mỗi lần refresh).
- **Không gắn instrumentation tạm** — không có Playwright/Puppeteer pre-installed, owner không yêu cầu cài thêm. Baseline dưới đây hoàn toàn dựa trên response shape và code path.

---

## 3. Kết quả baseline

| Probe (HTTPS, Vercel hkg1) | TTFB (typical) | total | http | size |
|---|---|---|---|---|
| `lesson.html` (HTML) | 115–411 ms | 118–415 ms | 200 | 63 724 B |
| `api/lms/portal?endpoint=lesson&id=…` (no auth → 401) | 335–1360 ms | 336–1361 ms | 401 | 115 B |
| `api/lms/portal?endpoint=course-data` POST `{"course":"demo"}` (no auth → 401) | 322–673 ms | 322–674 ms | 401 | 96 B |
| `…course-data` GET (method → 405) | 335–341 ms | 335 ms | 405 | 46 B |
| `cdn.tailwindcss.com` (1 redirect + bundle) | 257–281 ms | 432–455 ms | 200 | 407 279 B |
| Google Fonts CSS | 263–302 ms | 263–302 ms | 200 | 2 343 B |
| `gdrive-player.html` | 114–362 ms | 114–362 ms | 200 | 4 613 B |
| `lms.html` | 125–514 ms | 153–542 ms | 200 | 108 309 B |

**Quan sát then chốt từ baseline:**
1. **API 401 ~335–1360 ms** cho lesson endpoint — chỉ chạy `warmRuntimeConfig()` + verify headers + `parseCookies` rồi fail. Floor ~320 ms.
2. **Cache-Control header `no-cache, no-store, must-revalidate`** ở mọi static (incl. `lesson.html`) — ghi đè 304 (HTML vẫn trả `ETag` và 304 có hoạt động, nhưng cache browser thực tế bị `no-store` không lưu).
3. **Render-blocking `<script src="https://cdn.tailwindcss.com">`** trong `<head>` của `lesson.html:63` — tải 407 KB Tailwind Play CDN, ~440 ms mỗi lần.
4. **`course-data` API không có cache** — POST được, không có SWR, không có edge cache TTL.
5. **API 405 floor ~335 ms** — phần lớn latency floor không đến từ Supabase mà từ Vercel Function cold start + `applyCors` + `warmRuntimeConfig` + `parseCookies` mỗi request.

---

## 4. Request waterfall (mô phỏng trên browser thật — `lesson.html` → `lesson` → `course-data`)

Trước spinner tắt và `mainLayout` hiện ra (`lesson.html:1384–1385`), code chạy tuần tự:

```
[HTML parse 115–411 ms TTFB]
   │
   ├─ Tailwind Play CDN script (render-blocking, 407 KB, ~440 ms)
   ├─ Google Fonts CSS (~265 ms)
   ├─ Inline <script> check browser fallback
   │
[window.onload → loadLessonDetails()]
   │
   ├─ GET /api/lms/portal?endpoint=lesson&id=…        ← 335–1360 ms (server)
   │     └─ parseCookies + warmRuntimeConfig + applyCors + verifyLmsVerifiedSessionAccess
   │     (với session hợp lệ: + 4 Supabase queries):
   │        1) SELECT lessons WHERE id = ?
   │        2) SELECT student_enrollments WHERE email + course_slug
   │        3) SELECT lessons WHERE course_slug (full sibling list, ORDER BY lesson_no)
   │        4) SELECT lms_verified_sessions WHERE lms_session_id
   │        + resolveMainMediaInfo → drive.files.get (Google API)
   │        + signBunnyEmbedUrl (sync) + signMediaUrls (sync)
   │        + fetchRecipeText → googleapis.drive.files.get + .export + possibly docs.documents.get
   │
   ├─ renderLessonMaterials + renderMediaItems  (sync DOM)
   │
   └─ AWAIT loadSiblingsAndSidebar(course)            ← SECOND round-trip
         └─ POST /api/lms/portal?endpoint=course-data   ← 322–673 ms
               └─ toàn bộ course load + N×Drive metadata (Promise.all) + N×fetchRecipeText
                       N = số bài của course
                       Drive metadata fetch song song qua Promise.all
                       fetchRecipeText cho TỪNG bài — đợi Google Docs/Drive text

# spinner chỉ tắt SAU KHI tất cả thành công (line 1383–1385)
```

**Khi bấm Bài Tiếp / Bài Trước:** vì handler `nextBtn.onclick` (line 1506) gán trực tiếp `window.location.href = …/lesson.html?id=…` → **full page reload**, toàn bộ pipeline trên chạy lại từ đầu với URL mới. Không phải SPA, không có `history.pushState`.

---

## 5. Code path

### 5.1 Frontend (`lesson.html`)

| Hook | Dòng | Hành vi |
|---|---|---|
| `<script src=…/cdn.tailwindcss.com>` | `63` | Render-blocking, ~440 ms vì CDN 302 redirect + 407 KB download |
| `window.onload → loadLessonDetails()` | `1518–1548` | Gắn handler context-menu/copy/keyboard rồi gọi `loadLessonDetails()` |
| `loadLessonDetails()` | `1241–1395` | 1× `GET /api/lms/portal?endpoint=lesson&id=…`. Sau khi parse, set các header meta (title, badge, videoBox, recipe) nhưng **không tắt spinner** trước khi sidebar xong. |
| `await loadSiblingsAndSidebar(course)` | `1381` | Await cứng — spinner vẫn hiển thị đến khi promise này resolve. |
| `loadSiblingsAndSidebar()` | `1398–1515` | `POST /api/lms/portal?endpoint=course-data`. **Tại đây courseData trả về TOÀN BỘ** (đã bao gồm `lessons[i].recipeText`). |
| prev/next handler | `1498`, `1506` | `window.location.href = .../lesson.html?id=...` → toàn page reload. |
| Spinner toggle | `1377–1385` | `loadingState.hidden = true` chỉ chạy **sau** `loadSiblingsAndSidebar` resolve. |

### 5.2 Backend (production path)

`/api/lms/portal?endpoint=lesson` (`utils/lms-handlers/lesson.js:313`) — **mỗi request:**

1. `warmRuntimeConfig()` (`api/lms/portal.js:14`) — 1 SELECT `site_config` với 2 key (`v2_active_mode`, `v2_kill_switch`). Cached 5 s trong Vercel Function instance (`utils/v2-runtime-controller.js:54`), nên hầu hết chỉ là cold start lần đầu.
2. `applyCors({mode:"portal"})` — `utils/cors.js`.
3. `parseCookies(req)`, `getLmsSessionHeaders(req)`.
4. `verifyLmsVerifiedSessionAccess` (`utils/lms-session-guard.js:771–879`):
   - 1 SELECT `lms_verified_sessions`
   - 1 SELECT `student_session_controls`
   - 1 UPDATE (nếu expired) `lms_verified_sessions`
   - 1 SELECT `student_active_sessions`
   - 1 SELECT `student_enrollments`
   - Tổng ≥3 SELECT mỗi request có session hợp lệ.
5. `SELECT lessons WHERE id=?` — `maybeSingle()`.
6. `SELECT student_enrollments WHERE email + course_slug LIMIT 10`.
7. `SELECT lessons WHERE course_slug … ORDER BY lesson_no` — full sibling list (có thể 50+ bài).
8. `signBunnyEmbedUrl`, `signMediaUrls` — sync CPU (HMAC-SHA256 nhẹ).
9. `resolveMainMediaInfo(video_url, getDriveFileMetadata)` (`utils/lms-media.js:47`) — nếu không xác định mime từ extension, gọi `drive.files.get` qua Google API.
10. `fetchRecipeText(recipe_url)` (`utils/lms-handlers/lesson.js:293`) — `drive.files.get` (metadata), có thể gọi `drive.files.export` hoặc `docs.documents.get`, fallback `fetch()` user-content nếu API fail.

`/api/lms/portal?endpoint=course-data` (`utils/lms-handlers/course-data.js:312`) — **còn nặng hơn:**

1. Cùng đường auth (warmRuntime + CORS + verifyLms) như trên.
2. `SELECT student_enrollments WHERE email` (toàn bộ enrollments).
3. `SELECT courses WHERE slug` (maybeSingle + raw_data).
4. `SELECT site_config` (key,value) — full config dump, dùng key-prefixed parsing.
5. `SELECT lessons WHERE course_slug` ORDER BY lesson_no — full course.
6. **`Promise.all(lessons.map(async l => …))` (line 511)** — gọi `resolveMainMediaInfo` cho từng bài. Mỗi `resolveMainMediaInfo` có thể kích hoạt một `drive.files.get` (đã cache qua `driveMetadataCache`). Bài đầu tiên lạnh → 1 round-trip Drive; các bài còn lại dùng nhanh metadata.
7. `lessons = await Promise.all(lessons.map(attachRecipeText))` (line 549) — **N×fetchRecipeText** cho toàn bộ course (Google Drive/Docs reads một lần nữa, không cache). Đây là chỗ chịu lực lớn nhất với course có ≥10 bài.

---

## 6. Root cause ranking

Mỗi bảng xếp theo: **ảnh hưởng (Impact)**, **bằng chứng (Evidence)**, **chắc chắn (Confidence)**, **độ khó sửa (Effort)**, **rủi ro regression (Risk)**.

| # | Nguyên nhân | Impact | Evidence | Confidence | Effort | Risk | Phân loại |
|---|---|---|---|---|---|---|---|
| **R1** | **Mỗi lần prev/next = full HTML reload + toàn bộ pipeline chạy lại** (Tailwind CDN, fonts, lesson API 4 SELECTs + Drive, course-data API 6 SELECTs + N×Drive/docs) | **Cao** | `lesson.html:1498,1506` set `window.location.href`. Baseline API 401 floor 320–1360 ms, mỗi lần reset mọi cache in-process (`warmRuntimeConfig` lại cold cache 5 s; Vercel Function container có thể bị evict). | **Cao** | Medium–High | Medium | **ROOT CAUSE** |
| **R2** | **`loadLessonDetails` không tắt spinner cho đến khi `loadSiblingsAndSidebar` resolve**, đợi thêm 1 round-trip server đầy đủ | **Cao** | `lesson.html:1381–1385`: spinner `hidden = true` nằm **sau** `await loadSiblingsAndSidebar`. | **Cao** | Thấp | Thấp | **ROOT CAUSE** |
| **R3** | **API `lesson` chạy ≥3 Supabase SELECT tuần tự** (lms_verified_sessions + student_active_sessions + student_enrollments) cộng với siblings + Drive docs/get | **Cao** | `utils/lms-handlers/lesson.js:386,432,452,478,486`; `utils/lms-session-guard.js:782,832,872`. Mỗi query đều độc lập và không thể cache vì liên quan session. | **Cao** | Medium | Trung bình — cần đảm bảo auth correctness | **ROOT CAUSE** |
| **R4** | **`course-data` làm N×fetchRecipeText cho TOÀN BỘ bài trong course** qua `Promise.all` | **Cao với course dài** | `utils/lms-handlers/course-data.js:549` — `lessons.map(attachRecipeText)` với mỗi call là 1+ round-trip Google Drive/Docs. Hiện tại UI chỉ cần recipe của 1 bài (bài đang xem). | **Cao** | Medium | Trung bình — phải đảm bảo các nơi khác (lms.html) vẫn dùng được | **ROOT CAUSE** |
| **R5** | **Render-blocking `<script src=…/cdn.tailwindcss.com">` tải 407 KB Tailwind JIT** mỗi lần | **Cao** | `lesson.html:63`. Baseline CDN ~440 ms full download. Phương án production nên build Tailwind compile-time. | **Cao** | Thấp (chỉ build pipeline) | Thấp | **CONTRIBUTING FACTOR** (Tailwind qua CDN đã được xác nhận là anti-pattern, chỉ phù hợp dev) |
| **R6** | **`Cache-Control: no-cache, no-store, must-revalidate` trên toàn site** (`vercel.json`) | Trung bình | `vercel.json:1–12`. Browser vẫn có thể 304 với ETag (đã quan sát 304 hoạt động), nhưng `no-store` không cho store. Vercel Function API không cache được bên ngoài TTL 5 s instance. | **Cao** | Thấp | Thấp | **CONTRIBUTING FACTOR** |
| **R7** | **CORS Preflight / applyCors chạy mỗi request** (POST `course-data` chỉ là same-origin, không cần preflight thật sự) | Thấp | `applyCors` là sync, preflight chỉ xảy ra khi cross-origin; same-origin POST không gây preflight. | **Trung bình** | — | — | **CONTRIBUTING FACTOR (nhẹ)** |
| **R8** | **Vercel Function cold start** | Trung bình | Baseline 6 lần cold-ish: lần 1 ~1.36 s, sau đó ~340 ms. | **Cao** | Cao (chỉ Vercel) | Thấp | **CONTRIBUTING FACTOR** |

---

## 7. Contributing factors (secondary)

- **CF1** `loadSiblingsAndSidebar` gọi lại toàn bộ `course-data` ngay sau khi `loadLessonDetails` đã chạy → duplicate work. `loadLessonDetails` đã lấy `lesson.course` (line 1265, 1308) — có thể dùng luôn thông tin có sẵn từ lần gọi 1.
- **CF2** `lms.html` (course home) cũng gọi `loadCourseData` POST tới cùng endpoint (line 2208) — không có SWR / client cache khi chuyển từ `lesson.html` sang `lms.html` và quay lại `lesson.html`.
- **CF3** `extractIframeSrc` / Drive helpers bị duplicate giữa `lesson.js` (server), `course-data.js` (server), `lms-media.js` và `lesson.html` client. Không gây perf nhưng tăng bundle size.
- **CF4** Vercel Funnel: mỗi `lesson.html` request gọi `warmRuntimeConfig()` để warm `v2-runtime-controller` cache (5 s) — cache miss lần đầu là SELECT `site_config` extra (cold path; warm là free vì mọi request cùng instance share cache).
- **CF5** `resolveMainMediaInfo` (server) có thể kích hoạt `drive.files.get` **per lesson** với cache `Map` (line 502) → vẫn còn 1 round-trip Google Drive mỗi course load dù sibling đã cache.
- **CF6** `fetchRecipeText` qua `Promise.all(map(...))` không có timeout ngoài 25 s trên `lms.html:2217`; từ `lesson.html` API không có timeout → một Drive file chậm có thể phá TTFB.

---

## 8. Nguyên nhân đã loại trừ (RULED OUT)

| Nguyên nhân phỏng đoán | Bằng chứng loại trừ |
|---|---|
| **"Supabase chậm"** | API 401 (chỉ chạy warm+CORS+auth) cũng ~320–1360 ms floor. Supabase không được chạm trong floor. |
| **"Google Drive chậm"** | Driver metadata được cache `Map` trong course-data; chưa cần phải vào file để hiển thị page. Lần 1 có drive.files.get; sau đó hit. |
| **"Mạng chậm"** | dns ~3 ms, tls ~80 ms đến hkg1. Network floor không đáng kể so với TTFB server. |
| **"Trình duyệt chậm"** | Không có evidence browser-specific. Static HTML parse nhanh (~13 KB inline + script). Bundle Tailwind chậm nhưng chỉ là 440 ms không phải 5 s. |
| **getSession / getUser lặp** | Không có `supabase.auth.getSession`/`getUser` trong code path lesson (xác minh qua Grep). Auth qua cookie + LMS session headers + verifyLmsVerifiedSessionAccess. |
| **Spinner chờ Promise.all asset phụ** | `loadingState.hidden = true` không dựa trên asset fetch. Spinner toggle theo JS promise của `loadSiblingsAndSidebar`, không phải `renderMediaItems`. |
| **N+1 query cho UI bài hiện tại** | UI chỉ cần 1 bài; N+1 *có* nhưng ở `course-data` (sidebar list), không ở lesson API. |
| **Event handler gắn nhiều lần** | `prevBtn.onclick = …` được set 1 lần khi sidebar load xong (`lesson.html:1498,1506`). Không bị addEventListener lặp. |
| **Fetch retry / timeout ngầm** | Không có retry code; không có timeout trên `lesson` endpoint (`lesson.html:1248`). |
| **Bundle / script blocking** | Chỉ Tailwind Play CDN 407 KB là blocking. Không có bundle JS khác. |
| **Auth check lặp trong lesson load** | Auth đúng 1 chỗ: `verifyLmsVerifiedSessionAccess` (3 SELECT có chủ đích); không có `getSession` lặp. |
| **Thiếu index** | Code KHÔNG tạo index cho `lessons.course_slug`, `lessons.lesson_no ORDER`, `student_enrollments.email + course_slug`, `site_config.key`. **Đây là rủi ro NHƯNG chưa chứng minh được ảnh hưởng** do chưa EXPLAIN query. Xếp vào **NOT CONFIRMED**. |
| **`vercel.json` Cache-Control sai** | Header `no-cache, no-store` có ảnh hưởng nhưng Vercel Function API không cache được ở edge → CONTRIBUTING FACTOR, không phải root cause. |

---

## 9. Đề xuất theo mức ưu tiên (chưa triển khai)

### A. Quick wins (effort thấp, rủi ro thấp, tác động nhanh)

#### A1. Tắt spinner ngay khi bài học đã sẵn sàng — không đợi sidebar
- **Giải quyết:** R2
- **Vùng code:** `lesson.html:1381–1385`. Di chuyển `loadingState.add('hidden'); mainLayout.remove('hidden');` lên ngay sau khi parse lesson chính; chuyển `loadSiblingsAndSidebar` thành **async fire-and-forget** (không `await`).
- **Lợi ích:** Tách spinner khỏi `course-data` round-trip → giảm TTFB cảm nhận từ ~5–6 s xuống ~1–1.5 s (chỉ lesson API + render).
- **Rủi ro:** Thấp — sidebar load muộn thì không có prev/next + chapter header trong khoảng ngắn. Disable button tới khi load xong.
- **Test bắt buộc:** Bài đầu, bài giữa, bài cuối (prev/next boundary); course không có sections vs có sections.
- **Migration:** Không.
- **Production approval:** Cần (V1 prod page).

#### A2. Caching client-side `courseLessonsList` qua sessionStorage sau lần `course-data` đầu
- **Giải quyết:** R1 (một phần), CF2
- **Vùng code:** `lesson.html` — sau `loadSiblingsAndSidebar`, lưu `courseLessonsList` + `LESSON_ID` vào `sessionStorage`. Khi bấm prev/next, thay vì `location.href`, dùng `history.pushState` + swap nội dung in-DOM.
- **Lợi ích:** Bỏ qua full HTML reload và network cho spinner (nhưng vẫn cần `lesson` API).
- **Rủi ro:** Trung bình — SPA nav đổi contract kỳ vọng của user, SEO, history.back, share URL. Cần test kỹ.
- **Test bắt buộc:** History back/forward, refresh giữa hai bài, copy URL và mở tab mới.
- **Migration:** Không.
- **Production approval:** Cần.

#### A3. Prefetch lesson kế tiếp + bài trước
- **Giải quyết:** R1 (UX view)
- **Vùng code:** `lesson.html` sau khi `loadSiblingsAndSidebar` xong — gọi ngầm `lesson` API cho `realLessonsList[idx-1]` và `[idx+1]`.
- **Lợi ích:** Khi user bấm, JS đã có sẵn JSON → render tức thì (chỉ còn recipe text + render).
- **Rủi ro:** Trung bình — thêm load trên Supabase. Cần giới hạn 1 prefetch.
- **Test bắt buộc:** Net tab, rapid click, course lớn.
- **Migration:** Không.
- **Production approval:** Cần.

#### A4. Thay Tailwind Play CDN bằng CSS build-time
- **Giải quyết:** R5
- **Vùng code:** `lesson.html:63` + build pipeline (Tailwind CLI). Trước mắt có thể tải về static và self-host `<script>` block (giữ JIT runtime) hoặc tốt hơn: build CSS production.
- **Lợi ích:** Bỏ 407 KB download + 302 redirect mỗi lần full reload.
- **Rủi ro:** Thấp nếu self-host JIT runtime; trung bình nếu đổi sang build-time (cần verify output classes).
- **Test bắt buộc:** Visual diff trên các trang có Tailwind (`lesson.html`, `lms.html`).
- **Migration:** Không.
- **Production approval:** Cần.

### B. Medium changes (thay đổi luồng dữ liệu/navigation; cần test kỹ)

#### B1. Tách `course-data` thành 2 endpoint: `course-summary` (sidebar list, không recipe) + `lesson-recipe?id=...` (lazy recipe fetch)
- **Giải quyết:** R4
- **Vùng code:**
  - `api/lms/portal.js` thêm route `course-summary`.
  - `utils/lms-handlers/course-summary.js` (mới) — trả về courses + lessons không có `recipeText`.
  - `utils/lms-handlers/lesson.js` — giữ `fetchRecipeText` ở endpoint lesson, **không** trong course list.
  - `utils/lms-handlers/course-data.js` (cũ) — có thể giữ lại hoặc deprecate.
- **Lợi ích:** Course-data nhẹ đi rất nhiều (mỗi bài tiết kiệm 1 round-trip Drive). Endpoint sidebar load từ 6+ s xuống ~400–600 ms.
- **Rủi ro:** Trung bình — `lms.html` cũng dùng course-data và phụ thuộc recipe (xác minh trong code render). Cần đảm bảo backward compatibility hoặc cập nhật cùng lúc.
- **Test bắt buộc:** Contract test (response shape), lms.html + lesson.html, course có/không có sections.
- **Migration:** Không (additive endpoint).
- **Production approval:** Cần.

#### B2. Cache đầu ra `lesson` API trên edge với key `lesson_id + lms_session_id hash`, TTL ngắn
- **Giải quyết:** R3 (giảm tải DB), CF4
- **Vùng code:** `utils/lms-handlers/lesson.js:313` — bọc trong `cache.getOrSet({ key, ttl: 30 })` (edge KV qua Vercel KV, hoặc in-instance LRU + stale-while-revalidate). Tuy nhiên cần **version by** `email` + `course_slug` để tránh cache kết quả của student khác.
- **Lợi ích:** Lần bấm tiếp theo cho cùng bài → gần 0 ms.
- **Rủi ro:** Cao — auth-sensitive; lỗi cache có thể dẫn đến data leakage hoặc hiển thị bài cũ khi enrollment bị revoke.
- **Test bắt buộc:** Security test (cross-tenant), revoke mid-flight test, fresh cache.
- **Migration:** Không.
- **Production approval:** Cần.

#### B3. Promise.all trong `course-data` gọi `fetchRecipeText` song song nhưng fail-safe: timeout 4 s mỗi bài; dùng placeholder khi chậm
- **Giải quyết:** R4 (1 phần), CF6
- **Vùng code:** `utils/lms-handlers/course-data.js:549` — wrap mỗi `attachRecipeText` qua `Promise.race([fetchRecipeText, timeout(4000)])`.
- **Lợi ích:** 1 Drive docs bị chậm không kéo sập sidebar.
- **Rủi ro:** Thấp — chỉ cần đảm bảo UI xử lý recipeText rỗng (đã có).
- **Test bắt buộc:** Disable Drive (fake 4xx), timeout edge case.
- **Migration:** Không.
- **Production approval:** Cần.

### C. Structural changes (client-side navigation + cache layer; refactor)

#### C1. Biến navigation bài học thành in-page swap (SPA-lite, không framework)
- **Giải quyết:** R1, R2, CF1, CF2
- **Vùng code:** `lesson.html` — dựng router tối thiểu (hash-based hoặc `history.pushState`), tách hàm `loadLesson(id)` thành idempotent, swap sidebar+main. Không dùng React/Vue.
- **Lợi ích:** Giảm TTFB cảm nhận từ 5–6 s xuống <800 ms. Bỏ full HTML reload.
- **Rủi ro:** Trung bình–cao: SEO, share URL, history, refresh, mobile back gesture.
- **Test bắt buộc:** E2E trên Chrome + Safari + Mobile Chrome.
- **Migration:** Không.
- **Production approval:** Cần.

#### C2. Tách endpoint / cache layer theo domain
- **Giải quyết:** R3 + R4
- **Vùng code:**
  - Tạo `endpoint=lesson-summary` (chỉ metadata lesson, không recipe) cho sidebar/preview.
  - `endpoint=lesson-recipe?id=…` (lazy).
  - Cache `lesson` API 30 s với key bao gồm session fingerprint.
- **Lợi ích:** Tách rõ ràng data flow; sidebar load nhanh; recipe chỉ tải khi cần.
- **Rủi ro:** Trung bình.
- **Test bắt buộc:** Cross-version cache invalidation, concurrent edit.
- **Migration:** Không (additive).
- **Production approval:** Cần.

#### C3. Tái cấu trúc navigation React-style (chuyển sang Svelte/React/Preact)
- **Giải quyết:** Toàn bộ chuỗi navigation
- **Vùng code:** Rewrite `lesson.html` và `lms.html`. KHÔNG đề xuất trong scope hiện tại.
- **Lợi ích:** SPA hoàn chỉnh, có CSR/SWR.
- **Rủi ro:** Cao; đụng nhiều file.
- **Production approval:** Cần.

---

## 10. Ước lượng tác động (chưa đo được vì chưa triển khai)

| Đề xuất | TTFB giảm (ước tính) | Ghi chú |
|---|---|---|
| A1 (spinner sớm) | Cảm nhận ~ 60–70 % (5–6 s → ~1.5–2 s) | Không giảm server cost nhưng đỡ user-perceived |
| A2 (SPA-lite + cache) | Cảm nhận 70–85 % | Cần đo sau khi code |
| A3 (prefetch next/prev) | Cảm nhận 50–70 % | Còn phụ thuộc backend |
| A4 (Tailwind self-host) | Giảm 440 ms/render | |
| B1 (tách course-summary) | Course-data load giảm ≥70 % | |
| B2 (cache lesson API) | Lần 2+ gần 0 ms | |
| B3 (timeout recipe) | Loại bỏ tail latency | |
| C1 (in-page nav) | 90 %+ UX improvement | |

---

## 11. Rủi ro nếu triển khai (chưa triển khai)

- **Auth/Session correctness** — RB1 (cache) có thể leak dữ liệu. Cần audit từng item.
- **SEO & share URL** — A2, C1 có thể phá share-link contract nếu không xử lý `history.pushState` + canonical URL.
- **Memory pressure** — `sessionStorage` large cache có thể vượt quota trên mobile; bounded bằng courseId.
- **Regression tailwind classes** — A4 build-time cần verify toàn bộ class utilities đang dùng; rủi ro trung bình.
- **Cache invalidation** — RB2/B2: cần clear cache khi `site_config` row update hoặc `lessons` mutate (admin).
- **`lesson.html` không test framework** — không thấy test Playwright/Vitest cho UI. Các thay đổi SPA-lite cần test harness trước.

---

## 12. Kế hoạch test nếu sau này triển khai

### Tests bắt buộc cho A1
- Tự động (nếu Playwright được owner cho phép cài):
  - cold load 5x với lesson đầu/cuối/không có section.
  - đo `performance.now()` từ click → `loadingState.hidden`.
- Manual QA checklist: bài không có recipe, bài có recipe Docs nặng, bài cuối (next disabled), section header.

### Tests cho B1
- Contract test khi thêm `course-summary` endpoint.
- Vercel Functions smoke test: latency p50/p95 trong 3 vùng (hkg, sin, lax).
- Supabase dashboard giám sát query count.

### Tests cho C1 (SPA-lite)
- E2E: back/forward, refresh trong lúc SPA swap, share URL qua tab 2.
- Lighthouse / Web Vitals so sánh trước sau.

### Tests cho B2/RB2 (cache lesson)
- Security: cross-tenant cache poisoning attempt.
- Concurrency: enrollment revoke ngay trước khi cache hit.
- Pre-warming: first request vẫn <800 ms.

### Tests chung
- **Không commit instrumentation tạm** (theo yêu cầu chủ đề).
- **Không thay đổi production** trong phase này.

---

## 13. Bằng chứng tóm gọn (file:line)

| Claim | Source |
|---|---|
| Prev/Next = full reload | `lesson.html:1498`, `lesson.html:1506` |
| Spinner đợi course-data | `lesson.html:1381–1385` |
| Tailwind CDN render-blocking | `lesson.html:63` |
| Cache-Control toàn site no-cache | `vercel.json:1–12` |
| Multi-SELECT trong lesson endpoint | `utils/lms-handlers/lesson.js:386,432,452` |
| `verifyLmsVerifiedSessionAccess` ≥3 SELECT | `utils/lms-session-guard.js:782,832,872` |
| `course-data` N×Drive metadata + N×recipe | `utils/lms-handlers/course-data.js:511,549` |
| Cache TTL 5 s cho `v2_active_mode` | `utils/v2-runtime-controller.js:54` |
| `warmRuntimeConfig` per request | `api/lms/portal.js:14` |
| `lesson.html` không cache (no-store nhưng có ETag) | response headers `www.daubepnho.store/lesson.html` |
| API 401 floor ~335 ms | curl 6× measurement |

---

## 14. Kết luận

**Root cause chính:** Full HTML reload cho mỗi lần prev/next (line 1498/1506) kết hợp spinner đợi `loadSiblingsAndSidebar` (line 1381–1385) → 5–6 s đến từ tổng của:
1. Tải lại `lesson.html` 63 KB (`Cache-Control: no-cache` bắt buộc).
2. Tải lại Tailwind Play CDN 407 KB (~440 ms render-blocking).
3. Google Fonts CSS (~265 ms render-blocking).
4. `/api/lms/portal?endpoint=lesson` (≥3 SELECT Supabase + drive.files.get + drive.files.export hoặc docs.documents.get).
5. `/api/lms/portal?endpoint=course-data` (≥5 SELECT + N×fetchRecipeText = N round-trip Drive/Docs).

**Spinning time** thực = TTFB #4 + TTFB #5 + tổng thời gian Google Drive cho recipe/main-media (ảnh hưởng lớn tùy course).

**Top 3 phương án đề xuất (theo thứ tự ưu tiên nếu được owner duyệt):**

1. **A1** tắt spinner sớm — giải quyết cảm nhận ngay lập tức, effort thấp.
2. **B1** tách `course-summary` + lazy recipe — giảm backend latency thật.
3. **C1** SPA-lite navigation — loại bỏ gốc rễ "full reload".

Mọi phương án này **CHƯA ĐƯỢC TRIỂN KHAI** trong đợt điều tra này.
