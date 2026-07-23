# BÁO CÁO BÀN GIAO ĐẦY ĐỦ — LMS BASELINE FIX & PERFORMANCE

> **Ngày chốt bằng chứng:** 2026-07-23
> **Đối tượng nhận:** Bên thứ ba đánh giá kỹ thuật và người có thẩm quyền ra quyết định
> **Repo:** `web-lms-chinh-thuc`
> **Worktree:** `_worktrees/v2-lms-fix`
> **Nhánh:** `feat/v2-lms-baseline-fix`
> **Loại hệ thống:** Frontend HTML/JavaScript tĩnh + Vercel serverless ESM, không có framework frontend và không có build step
> **Trạng thái Git:** Nhánh hiện tại không lệch commit so với `origin/feat/v2-lms-baseline-fix`; vẫn có thay đổi chưa commit
> **Kết quả kiểm thử cuối:** **278 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo**, exit code 0
> **Trạng thái phát hành:** Chưa commit phần tối ưu cốt lõi và contract tests; chưa deploy; chưa chuyển traffic/runtime mode

> **CẬP NHẬT SAU QUYẾT ĐỊNH:** Phần code + tests đã được commit nguyên tử tại `e0f12b7` (`perf(lms): parallelize lesson loading and defer session touch`) sau khi full suite đạt 278/278 và staged diff được kiểm tra sạch. Báo cáo bên dưới giữ nguyên nội dung snapshot trước quyết định để bảo toàn dấu vết review. Chưa push, deploy hoặc đổi runtime mode.

---

## 1. Kết luận điều hành

Phần kỹ thuật trong phạm vi sửa điều hướng bài học, tối ưu truy vấn và bảo toàn hợp đồng bảo mật phiên đã hoàn thiện ở mức sẵn sàng cho quyết định commit:

- Lỗi bấm hai lần làm nhảy sai bài đã được sửa và commit.
- Điều hướng bài trước/bài sau đã được bật sớm tại first paint và commit.
- Server-Timing opt-in đã được thêm và commit.
- Song song hóa các truy vấn độc lập trong guard và lesson handler đã hoàn thiện nhưng chưa commit.
- Cơ chế `deferTouch` đã hoàn thiện, gồm xử lý an toàn các early-return, nhưng chưa commit.
- Khoảng trống test quan trọng nhất đã được đóng bằng 5 contract tests chạy guard thật.
- Test mục tiêu đạt 64/64; toàn bộ suite đạt 278/278; `git diff --check` sạch.

Không còn lỗi kỹ thuật được biết đang chặn quyết định commit. Các bước commit, deploy, chuyển V1/V2/V3, P5, xoay token và viết lại lịch sử vẫn cần phê duyệt riêng.

**Khuyến nghị kỹ thuật:** phê duyệt commit theo nhóm nguyên tử, review diff lần cuối, sau đó mới lập cửa sổ deploy/canary riêng có rollback. Không gộp commit với thao tác chuyển runtime mode.

---

## 2. Bối cảnh và mục tiêu

Nhánh này chứa hai luồng liên quan đến trải nghiệm “xem bài học → bài tiếp theo”:

1. **Độ đúng của điều hướng:** ngăn double-click hoặc click lặp trước khi trang tải xong làm chuyển sai bài.
2. **Hiệu suất và bảo mật phiên:** giảm chuỗi truy vấn nối tiếp trong endpoint lesson, đồng thời vẫn giữ chính sách fail-closed của cơ chế một thiết bị/một phiên.

Điểm nhạy cảm nhất là heartbeat phiên. Guard cập nhật `last_seen_at` trên hai bảng phiên. Khi bật `deferTouch`, heartbeat bắt đầu trong guard nhưng được await ở lesson handler để chồng lấp thời gian I/O với việc tải nội dung. Nếu promise này không được xử lý đúng:

- Happy-path có thể gửi nội dung dù heartbeat thất bại, làm suy yếu fail-closed.
- Early-return có thể để lại rejected promise sau khi response đã gửi, tạo `unhandledRejection`.

Thay đổi hiện tại và contract tests được thiết kế để ngăn cả hai tình huống.

---

## 3. Phạm vi đã commit

Các commit gần nhất có liên quan:

| Commit | Nội dung |
|---|---|
| `47e2031` | Thêm navigation state machine chống double-click jump |
| `3b9aacf` | Bật điều hướng lesson tại first paint |
| `7690aa9` | Thêm Server-Timing opt-in cho lesson |
| `a2e015d` | Phát Server-Timing không phụ thuộc `Buffer` |
| `eb19bc6` | Thêm fallback header cho Server-Timing |

Commit nền liên quan trực tiếp đến chuỗi sửa điều hướng:

| Commit | Nội dung |
|---|---|
| `b468a58` | Vô hiệu hóa điều hướng cho tới khi handler sẵn sàng |

Các commit trên đã tồn tại trên nhánh. Báo cáo này không đề nghị sửa lại lịch sử các commit đó.

---

## 4. Phạm vi đã hoàn thiện nhưng chưa commit

### 4.1. Production code

#### `utils/lms-session-guard.js`

Thay đổi chính:

- Giữ nguyên mặc định `deferTouch = false` cho các caller không phải lesson.
- Chạy song song ba truy vấn độc lập sau khi session cơ sở đã hợp lệ:
  - `student_session_controls`;
  - `student_active_sessions`;
  - `student_enrollments`.
- Duy trì thứ tự kiểm tra ngữ nghĩa và các reason hiện hữu sau khi truy vấn hoàn tất.
- Khi `deferTouch: true`, bắt đầu heartbeat và trả `__touchPromise`.
- Khi `deferTouch: false`, vẫn await heartbeat bên trong guard như hành vi cũ.
- `Promise.all` fast-reject giữ nguyên tính fail-closed nếu truy vấn hoặc touch ném lỗi.

#### `utils/lms-handlers/lesson.js`

Thay đổi chính:

- Gọi guard với `deferTouch: true`.
- Await `__touchPromise` trong cụm post-lesson song song cùng:
  - sibling lookup;
  - media metadata;
  - recipe fetch.
- Không bọc `__touchPromise` thêm một lớp Server-Timing, tránh đếm kép `auth_touch_db`.
- Drain promise bằng `.catch(() => {})` trước ba early-return:
  - không có email hợp lệ;
  - lesson không tồn tại;
  - course mismatch.
- Happy-path touch lỗi vẫn đi vào catch fail-closed trước khi response được gửi.
- Khi one-device flag bật, lỗi hạ tầng trả 503 `one_device_policy_unavailable` và không rò lỗi DB thô.
- Khi flag tắt, đường legacy giữ 500 cùng detail theo contract hiện hữu.

### 4.2. Test fixture và contract tests

#### `tests/_supabase_stub_loader.mjs`

- Thêm `throwOnUpdate` để ném lỗi riêng tại thao tác UPDATE.
- Cơ chế cũ `throwOn` tại `.from(table)` được giữ nguyên.
- Lỗi được ném trước `recordWrite`, giúp mô phỏng touch thất bại mà không làm hỏng SELECT session ban đầu.

#### `tests/rp2b1-session-device.test.mjs`

Thêm harness chạy lesson với **guard thật**, không set `globalThis.__RP2B1_LMS_SESSION_STUB__`.

Thêm 5 contract tests:

| Test | Kỳ vọng | Kết quả |
|---|---|---|
| Flag bật + touch UPDATE lỗi trên happy-path | 503 `one_device_policy_unavailable` | Pass |
| Flag tắt + touch UPDATE lỗi trên happy-path | Legacy 500 | Pass |
| Lesson không tồn tại + touch lỗi | 404, không `unhandledRejection` | Pass |
| Course mismatch + touch lỗi | 401 `invalid_session`, không `unhandledRejection` | Pass |
| Email rỗng + touch lỗi | 401, không `unhandledRejection` | Pass |

### 4.3. Tài liệu

Working tree còn các tài liệu điều tra/thiết kế liên quan:

- `docs/SUPPLEMENTARY_VIDEO_THUMBNAIL_INVESTIGATION.md`
- `docs/DOUBLE_CLICK_NAVIGATION_INVESTIGATION.md`
- `docs/DOUBLE_CLICK_NAV_3_DECISIONS.md`
- `docs/DOUBLE_CLICK_NAV_STATE_MACHINE_DESIGN.md`
- `docs/LMS_XEMBAIHOC_BAITIEP_THEO_PERF.md`
- `docs/LMS_WORK_STATUS_REPORT_2026-07-23.md`
- Báo cáo bàn giao hiện tại.

Ba file planning ở root (`task_plan.md`, `findings.md`, `progress.md`) là nhật ký làm việc nội bộ. Bên đánh giá cần quyết định có đưa chúng vào commit tài liệu hay giữ ngoài lịch sử sản phẩm.

---

## 5. Bằng chứng kiểm thử

### 5.1. Test mục tiêu

Lệnh PowerShell:

```powershell
$env:LMS_RP2B1_SUPABASE_STUB='1'
node --test tests/rp2b1-session-device.test.mjs
```

Kết quả:

```text
tests 64
pass 64
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

### 5.2. Toàn bộ suite

Lệnh PowerShell:

```powershell
$env:LMS_RP2B1_SUPABASE_STUB='1'
node --test tests/*.test.mjs
```

Kết quả:

```text
tests 278
pass 278
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

Baseline trước khi bổ sung contract tests là 273 pass. Năm test mới giải thích mức tăng lên 278.

### 5.3. Kiểm tra diff

```powershell
git diff --check
```

Kết quả: exit 0, không có whitespace error.

Không còn `tests/.supabase-stub.json` sau khi test hoàn tất; cleanup fixture hoạt động.

### 5.4. Đánh giá độc lập trước đó

Phần tối ưu production trước khi bổ sung contract tests đã được một agent độc lập đánh giá là `PASS_WITH_CONDITIONS`. Điều kiện mức MEDIUM là phải drain `__touchPromise` trên early-return. Điều kiện này đã được sửa trong production code và hiện được contract tests xác minh tự động.

Lưu ý: chưa có một lượt independent review mới sau khi bổ sung test. Đây không phải blocker bắt buộc, nhưng là bước review bổ sung hợp lý trước commit nếu quy trình yêu cầu hai người duyệt.

---

## 6. Sai lệch tài liệu đã phát hiện và cách xử lý

### 6.1. Course mismatch là 401, không phải 403

Bản thiết kế/báo cáo ban đầu dự kiến early-return course mismatch là 403. Khi chạy test guard thật:

- `respondWithAccessError` chuẩn hóa reason này thành 401 `invalid_session`.
- Test hiện hữu trước Task #5 cũng đã khẳng định 401.

Contract test mới giữ nguyên hành vi thực tế 401 để không tạo thay đổi API ngoài phạm vi. Nếu sản phẩm muốn 403, đó phải là một quyết định contract riêng, có đánh giá compatibility và test riêng; không nên trộn vào commit hiệu suất.

### 6.2. Số lượng commit điều hướng

Danh sách “5 commit gần nhất” là đúng theo `git log`, nhưng toàn bộ chuỗi xử lý điều hướng còn có commit nền `b468a58`. Đây là khác biệt cách diễn đạt, không phải lỗi code.

---

## 7. Trạng thái working tree tại thời điểm bàn giao

Tracked files đang sửa:

```text
M  docs/SUPPLEMENTARY_VIDEO_THUMBNAIL_INVESTIGATION.md
M  tests/_supabase_stub_loader.mjs
M  tests/rp2b1-session-device.test.mjs
M  utils/lms-handlers/lesson.js
M  utils/lms-session-guard.js
```

Untracked files:

```text
?? docs/DOUBLE_CLICK_NAVIGATION_INVESTIGATION.md
?? docs/DOUBLE_CLICK_NAV_3_DECISIONS.md
?? docs/DOUBLE_CLICK_NAV_STATE_MACHINE_DESIGN.md
?? docs/LMS_WORK_STATUS_REPORT_2026-07-23.md
?? docs/LMS_XEMBAIHOC_BAITIEP_THEO_PERF.md
?? docs/LMS_THIRD_PARTY_DECISION_REPORT_2026-07-23.md
?? findings.md
?? progress.md
?? task_plan.md
```

Tracked diff tổng hợp trước khi thêm báo cáo này:

```text
5 files changed, 457 insertions(+), 66 deletions(-)
```

Không dùng `git diff --stat` để suy ra đầy đủ nội dung commit vì lệnh đó không liệt kê file untracked.

---

## 8. Đánh giá rủi ro

| Rủi ro | Mức | Kiểm soát hiện có | Còn lại |
|---|---|---|---|
| Touch lỗi nhưng response 200 vẫn gửi | Cao | Happy-path await promise; test 503/500 | Thấp |
| Rejected promise sau early-return | Trung bình | Drain cả 3 nhánh; test không `unhandledRejection` | Thấp |
| Thay đổi thứ tự quyết định access | Cao | Chỉ song song hóa query độc lập; giữ thứ tự checks | Thấp, cần review diff |
| Đếm kép Server-Timing | Thấp | `__touchPromise` là entry trần | Thấp |
| V1/non-deferred caller bị đổi hành vi | Trung bình | `deferTouch=false` mặc định; full suite xanh | Thấp |
| Contract course mismatch bị đổi ngoài ý muốn | Trung bình | Giữ 401 hiện hữu, ghi rõ sai lệch tài liệu | Thấp |
| Test stub ảnh hưởng test khác | Trung bình | `throwOnUpdate` là additive; full suite 278/278 | Thấp |
| Chưa có quan sát latency production | Trung bình | Server-Timing opt-in đã có | Trung bình cho tới canary |
| Deploy/chuyển mode không có rollback | Cao | Chưa deploy/chưa chuyển mode | Phải có runbook trước phát hành |
| Token có thể đã xuất hiện trong lịch sử | Cao | Env files đã untrack theo báo cáo cũ | Chưa xoay token/chưa rewrite history |

---

## 9. Các quyết định bên thứ ba/owner cần đưa ra

### D1 — Có phê duyệt commit phần chưa commit không?

**Khuyến nghị:** Có, với điều kiện review diff cuối không phát hiện thay đổi ngoài phạm vi.

### D2 — Chia commit như thế nào?

**Khuyến nghị:** tách tối thiểu thành ba commit để review và rollback:

1. `perf(lms): parallelize independent lesson auth and content queries`
   - Phần song song hóa có thể tách rõ khỏi deferred heartbeat nếu diff cho phép.

2. `perf(lms): defer session touch with fail-closed contract tests`
   - `deferTouch`;
   - early-return drains;
   - `throwOnUpdate`;
   - 5 contract tests.

3. `docs(lms): record navigation and lesson performance investigation`
   - Chỉ các tài liệu được owner chọn.

Nếu việc tách production diff làm tăng nguy cơ conflict hoặc tạo commit trung gian không chạy được, phương án an toàn hơn là:

1. một commit code + tests nguyên tử;
2. một commit docs.

Không nên tách bản sửa early-return khỏi `deferTouch`, vì drain là một phần bắt buộc của contract an toàn.

### D3 — Có commit các planning files không?

**Khuyến nghị:** Không commit `task_plan.md`, `findings.md`, `progress.md` vào sản phẩm trừ khi repo có quy ước lưu nhật ký agent. Chúng có thể được giữ cục bộ hoặc lưu trong hệ thống quản lý công việc.

### D4 — Có cần independent review cuối không?

**Khuyến nghị:** Có nếu quy trình cho phép. Reviewer nên tập trung vào:

- thứ tự các access checks;
- mọi đường response có xử lý `__touchPromise`;
- không đếm kép timing;
- test harness thật sự không set session sentinel;
- không lẫn WIP runtime controller.

### D5 — Có deploy ngay sau commit không?

**Khuyến nghị:** Không deploy trực tiếp toàn lưu lượng. Commit và review trước; sau đó canary có đo Server-Timing và error rate.

### D6 — Có chuyển V1/V2/V3 hoặc chạy P5 không?

**Khuyến nghị:** Không gộp với quyết định commit. Đây là quyết định vận hành riêng, cần xác nhận owner và runbook rollback.

### D7 — Xử lý hygiene bảo mật thế nào?

**Khuyến nghị:** mở một luồng riêng để:

- xoay `VERCEL_OIDC_TOKEN`;
- kiểm kê các secret có thể đã vào lịch sử;
- quyết định rewrite history với kế hoạch phối hợp clone/fork/deploy.

Không in hoặc đọc giá trị secret trong quá trình kiểm kê.

---

## 10. Đề xuất quy trình phát hành và rollback

### 10.1. Trước commit

- Review từng hunk của hai production files.
- Review test fixture và 5 contract tests.
- Xác nhận không stage `utils/v2-runtime-controller.js` hoặc WIP ngoài phạm vi.
- Chạy lại test mục tiêu, full suite và `git diff --check`.
- Stage bằng đường dẫn tường minh; không dùng `git add .`.

### 10.2. Trước deploy

- Xác định chính xác commit SHA sẽ deploy.
- Ghi nhận runtime mode hiện tại; theo báo cáo hiện là V1.
- Chuẩn bị dashboard/log cho:
  - tỷ lệ 5xx/503 của lesson;
  - latency endpoint lesson;
  - `Server-Timing` khi opt-in;
  - lỗi session/access tăng bất thường.
- Định nghĩa ngưỡng rollback định lượng trước khi mở traffic.

### 10.3. Canary

- Bắt đầu với phạm vi nhỏ hoặc môi trường preview nếu hạ tầng hỗ trợ.
- So sánh latency và error rate với baseline.
- Xác minh 401/404/503 đúng contract, không có lỗi DB thô trong response.
- Không đồng thời thay nhiều runtime flag khiến khó quy nguyên nhân.

### 10.4. Rollback

Ưu tiên rollback có thể đảo ngược:

1. Chuyển runtime mode về V1/kill switch theo runbook đã được phê duyệt.
2. Rollback deployment về version/commit ổn định trước đó.
3. Không rewrite history hoặc force-push như một biện pháp rollback ứng dụng.

Ngưỡng rollback đề xuất cần owner điều chỉnh theo baseline sản xuất:

- 5xx/503 tăng có ý nghĩa so với baseline;
- lesson latency p95/p99 xấu đi liên tục;
- tỷ lệ invalid session tăng bất thường;
- xuất hiện `unhandledRejection` hoặc crash process;
- response rò detail DB khi one-device flag bật.

---

## 11. Ngoài phạm vi và các cổng đang khóa

Chưa thực hiện:

- stage hoặc commit thay đổi hiện tại;
- deploy production;
- migration production;
- chuyển `active_mode`;
- dịch chuyển V1→V2→V3;
- chạy P5 live delivery;
- xoay token;
- rewrite Git history;
- sửa `main` hoặc tag `v1-stable-20260713`.

Các việc này không được suy ra là đã phê duyệt chỉ vì phần test đã xanh.

---

## 12. Checklist quyết định

Bên thứ ba có thể trả lời theo mẫu:

```text
[ ] D1 — Phê duyệt / Không phê duyệt commit phần code + tests
[ ] D2 — Chọn: 3 commit / 2 commit / phương án khác
[ ] D3 — Planning files: không commit / commit
[ ] D4 — Yêu cầu / Không yêu cầu independent review cuối
[ ] D5 — Cho phép lập kế hoạch canary (chưa deploy)
[ ] D6 — Giữ nguyên runtime mode / phê duyệt quy trình chuyển mode riêng
[ ] D7 — Mở task hygiene bảo mật riêng

Điều kiện bổ sung:
Người phê duyệt:
Ngày:
```

---

## 13. Kết luận cuối

Phần code tối ưu và hợp đồng `deferTouch` đã đạt trạng thái **technical-complete, decision-pending**:

- review trước đó: `PASS_WITH_CONDITIONS`;
- điều kiện MEDIUM đã được sửa;
- 5 contract tests mới đã chứng minh hành vi quan trọng;
- full suite 278/278 xanh;
- diff check sạch;
- chưa có hành động phát hành không thể đảo ngược.

Quyết định phù hợp tiếp theo là review/stage/commit có kiểm soát. Deploy, chuyển runtime mode và hygiene bảo mật phải tiếp tục là các luồng phê duyệt riêng.
