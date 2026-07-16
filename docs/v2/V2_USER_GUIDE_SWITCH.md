# Hướng dẫn sử dụng V2 — Chuyển đổi V1 ↔ V2 để test

> Dành cho **người dùng cơ bản** (không cần kỹ thuật). Bạn chỉ cần làm theo từng bước dưới đây để chuyển hệ thống giữa V1 và V2, kiểm tra thử, và quay lại V1 bất cứ lúc nào.
>
> Ngày viết: 2026-07-16. Phiên bản áp dụng: branch `v2/rebuild-20260715`, đã deploy production `www.daubepnho.store` (deploy `g3zpdnz10`).

---

## 1. Tóm tắt nhanh (3 dòng)

- Mở trang quản trị → đăng nhập → tab **"⚙️ Hệ Thống"**.
- Bấm nút **V1** hoặc **V2** → xác nhận → xong.
- Muốn quay lại V1: bấm nút **V1** (hoặc **Kill switch** nếu khẩn cấp). Không bao giờ mất dữ liệu.

> **Quan trọng:** V2 chỉ "bật" khi bạn vừa (1) chuyển sang V2 **và** (2) các tính năng V2 đã được bật trên máy chủ. Nếu bạn chỉ bấm V2 mà tính năng chưa được bật, hệ thống vẫn chạy như V1 — an toàn. Xem mục **7** nếu muốn bật tính năng V2 đầy đủ.

---

## 2. V1 và V2 là gì?

| Chế độ | Ý nghĩa | Khi nào dùng |
|---|---|---|
| **V1** | Hệ thống **hiện tại** đang phục vụ học viên. Ổn định, đã chạy lâu. | Mặc định. Dùng hàng ngày. Khi không test thì để V1. |
| **V2** | Hệ thống **mới** (cải tiến bảo mật: một thiết bị / một phiên đăng nhập, đồng bộ hóa, theo dõi tốt hơn). Đã sẵn sàng để thử nghiệm. | Khi bạn muốn **kiểm tra thử** trải nghiệm mới trước khi chuyển hẳn. |

Bạn có thể **chuyển qua lại V1 ↔ V2 nhiều lần** mà không phá vỡ gì. Việc chuyển về V1 **ngay lập tức** rút toàn bộ tính năng V2 (nhưng **không xóa** dữ liệu — dữ liệu học viên, enrollment, bài giảng đều giữ nguyên).

---

## 3. Yêu cầu trước khi bắt đầu

- Bạn cần có **tài khoản Gmail quản trị** (đã được đưa vào danh sách `ADMIN_EMAILS` của hệ thống).
- Dùng trình duyệt trên máy tính (Chrome, Edge, Firefox...). Không dùng điện thoại để thao tác chuyển phiên bản.
- Đảm bảo đang có mạng ổn định.

---

## 4. Cách truy cập trang chuyển phiên bản

1. Mở trình duyệt, vào địa chỉ:
   ```
   https://www.daubepnho.store/admin.html
   ```
2. Màn hình đăng nhập hiện ra → bấm **"Đăng nhập với Google"**.
3. Chọn Gmail quản trị của bạn.
4. Nếu Gmail có quyền → vào được trang quản trị. Nếu không → sẽ báo "Không có quyền quản trị" (liên hệ người kỹ thuật để thêm Gmail vào `ADMIN_EMAILS`).

---

## 5. Chuyển sang V2 để test

1. Sau khi đăng nhập, nhìn thanh bên trái (menu dọc) → bấm tab **"⚙️ Hệ Thống"**.
2. Bạn sẽ thấy bảng **"Chế độ hệ thống (V1 / V2)"** với:
   - Dòng trạng thái phía trên: **Chế độ hiện tại**, **Hiệu lực**, **Kill switch**.
   - Hai nút lớn phía dưới: **🟢 V1 (Hệ thống hiện tại)** và **🧪 V2 (Hệ thống mới)**.
3. Bấm nút **🧪 V2 (Hệ thống mới)**.
4. Một hộp thoại hỏi xác nhận hiện ra → đọc kỹ → bấm **OK**.
5. Chờ 1–2 giây. Thông báo xanh hiện "Hệ thống đã chuyển sang V2".
6. Nhìn lại dòng trạng thái: **Chế độ hiện tại** giờ là "V2", **Hiệu lực** là "V2 đang hoạt động".

✅ Hệ thống đã ở chế độ V2. Bạn có thể ra trang học (`lms.html`) để kiểm tra trải nghiệm.

---

## 6. Chuyển về V1 (quay lại hệ thống cũ)

Cách thường: bấm nút **🟢 V1 (Hệ thống hiện tại)** → xác nhận → xong.

Cách khẩn cấp (khi V2 bị lỗi và cần dừng ngay): dùng **Kill switch** — xem mục **8**.

Sau khi về V1, dòng trạng thái sẽ hiện "V1", "Hiệu lực: V1 đang hoạt động". Toàn bộ tính năng V2 ngừng hoạt động ngay lập tức. **Không học viên nào bị ảnh hưởng dữ liệu.**

---

## 7. Làm sao để thực sự "thấy" V2 hoạt động?

> Đây là phần dễ nhầm nhất — đọc kỹ.

Nút V2 chỉ **"cho phép"** V2 hoạt động. Để thực sự thấy tính năng mới (ví dụ: một Gmail chỉ được học trên 1 thiết bị cùng lúc), các tính năng đó phải **đã được bật trên máy chủ** (qua các biến môi trường như `V2_GLOBAL_ONE_DEVICE_ENABLED`, `V2_OUTBOX_SHADOW_MODE`...).

**Cách kiểm tra xem tính năng V2 đang bật hay chưa** (không cần kỹ thuật):
1. Ở tab **"⚙️ Hệ Thống"**, cuộn xuống bảng **"Trạng thái flag V2"**.
2. Mỗi dòng là một tính năng, có 2 nhãn:
   - **configured** ✅ = tính năng này **đã được set** trên máy chủ.
   - **enabled** 🟢 = tính năng này **đang thực sự hiệu lực**.
3. Quy tắc:
   - Nếu chế độ = **V1** → mọi dòng đều `enabled = false` (⚪) dù `configured = true`. → bình thường, V1 rút hết.
   - Nếu chế độ = **V2** → dòng nào `configured = true` sẽ thành `enabled = true` (🟢). → tính năng đó đang chạy.

**Nếu bạn bấm V2 mà vẫn thấy mọi tính năng `enabled = false`:** nghĩa là chưa có tính năng V2 nào được bật trên máy chủ. Để bật, cần người kỹ thuật set biến môi trường trên Vercel (xem mục **10** — phần dành cho kỹ thuật). **Bạn không tự làm bước này** trừ khi đã được hướng dẫn.

> Tóm lại: để test V2 đầy đủ, cần 2 việc — (a) người kỹ thuật đã bật các flag V2, và (b) bạn bấm switch sang V2. Thiếu 1 trong 2 thì V2 chưa hiện hiệu ứng.

---

## 8. Kill switch — nút khẩn cấp

Dùng khi V2 đang chạy mà bạn thấy lỗi bất thường (học viên báo không vào được lớp, trang trắng...) và muốn **dừng ngay lập tức**, không kịp suy nghĩ.

1. Trong tab **"⚙️ Hệ Thống"**, cuộn xuống bảng **"⛔ Kill switch (khẩn cấp)"**.
2. Bấm **"Bật kill switch (ép V1)"** → xác nhận.
3. Hệ thống **ép về V1 ngay lập tức**, bất kể chế độ đang cài đặt là gì.
4. Dòng trạng thái **Kill switch** sẽ hiện "BẬT (ép V1)".

Sau khi sự cố qua, để tắt kill switch: bấm **"Tắt kill switch"** → hệ thống quay về chế độ thường (V1 hay V2 tùy nút bạn đã bấm trước đó; nếu chưa rõ, cứ bấm **V1** để chắc chắn).

> Khuyến nghị: chỉ dùng kill switch khi thật sự khẩn. Bình thường cứ dùng nút V1 ở mục **6**.

---

## 9. Kiểm tra trải nghiệm sau khi chuyển

Sau khi bấm V2 (và tính năng đã được bật), mở thử các luồng sau để test:

| Thứ cần thử | Cách | Kỳ vọng ở V2 (nếu one-device đã bật) |
|---|---|---|
| Vào lớp học | Mở `https://www.daubepnho.store/lms.html` như học viên | Cần có phiên đăng nhập hợp lệ (header `X-LMS-Session-Id` / `X-LMS-Device-Id`). Nếu thiếu → báo lỗi `invalid_session` thay vì vào được bằng cookie cũ. |
| Đăng nhập trên 2 thiết bị cùng lúc | Đăng nhập Gmail A trên máy A, rồi lại đăng nhập A trên máy B | Máy B bị **chặn** với thông báo "Tài khoản đang được sử dụng trên thiết bị khác". Máy A không bị đá. |
| Đăng xuất | Bấm nút đăng xuất ở trang học | Server thu hồi phiên ngay. Thiết bị khác đăng nhập lại được. |
| Quay lại V1 | Bấm nút V1 ở trang admin | Tất cả hành vi trên trở về như cũ (cookie cũ đủ vào lớp, không chặn 2 thiết bị...). |

> Nếu thấy lỗi lạ → bấm **Kill switch** (mục 8) rồi báo người kỹ thuật.

---

## 10. (Dành cho kỹ thuật) Bật tính năng V2 trên máy chủ

Phần này chỉ cần làm **một lần** để chuẩn bị cho việc test. Người dùng cơ bản có thể bỏ qua.

Các biến môi trường cần set trên **Vercel** (project `web-lms-chinh-thuc`, môi trường `Production` hoặc `Preview`):

| Biến | Khi bật thì tính năng nào chạy |
|---|---|
| `V2_GLOBAL_ONE_DEVICE_ENABLED=true` | Một Gmail = 1 phiên active toàn hệ thống (chặn 2 thiết bị). |
| `V2_CORS_ALLOWLIST_ENABLED=true` + `LMS_PORTAL_ORIGINS` / `LMS_ADMIN_ORIGINS` | CORS allowlist (chặn origin lạ). |
| `V2_OUTBOX_SHADOW_MODE=true` | Ghi song song sự kiện sync ra outbox (chỉ quan sát, không gửi). |
| `V2_RECONCILIATION_READONLY=true` | Bật reconciliation read-only. |
| `V2_PORTAL_PROJECTION_ENABLED=true` (+ `V2_PORTAL_PROJECTION_DRY_RUN=true`) | Projection portal (dry-run trước khi live). |
| `V2_DELIVERY_HANDLERS_ENABLED=true` | Bật delivery handlers (live projection). **Cẩn thận** — chỉ bật khi đã dry-run OK. |
| `V2_OUTBOX_WORKER_ENABLED=true` | Bật worker outbox. |
| `V2_DRIVE_WORKER_DRY_RUN=true` | Giữ Drive ở dry-run (không đổi permission thật). |

**Thứ tự bật an toàn** (xem `docs/v2/V2_CUTOVER_RUNBOOK.md` chi tiết):
1. `V2_CORS_ALLOWLIST_ENABLED` (kèm allowlist origin).
2. `V2_GLOBAL_ONE_DEVICE_ENABLED`.
3. `V2_OUTBOX_SHADOW_MODE` → quan sát `/api/v2/outbox`.
4. `V2_RECONCILIATION_READONLY`.
5. `V2_PORTAL_PROJECTION_ENABLED` + `V2_PORTAL_PROJECTION_DRY_RUN=true` → xem preview khớp V1.
6. (Sau khi duyệt) `V2_DELIVERY_HANDLERS_ENABLED=true`, `V2_PORTAL_PROJECTION_DRY_RUN=false`. Giữ `V2_DRIVE_WORKER_DRY_RUN=true`.

Sau khi set xong → redeploy để bind env mới → vào admin bấm switch sang **V2**.

> **Escape hatch (không cần UI):** set `V2_RUNTIME_FORCE_MODE=v1` (hoặc `v2`) trên Vercel env để ép chế độ không qua DB. `V2_RUNTIME_FORCE_KILL=1` ép kill switch. Dùng khi muốn ép toàn bộ instance về 1 chế độ mà không cần vào admin.

---

## 11. Câu hỏi thường gặp

**H: Bấm V2 xong, học viên có bị ảnh hưởng ngay không?**
Đáp: Chỉ khi tính năng V2 đã được bật (mục 7) thì hành vi mới đổi. Nếu chưa bật flag gì → bấm V2 không thay đổi gì với học viên (hệ thống vẫn chạy V1 thực tế). An toàn để thử.

**H: Tôi bấm nhầm V2, làm sao quay lại?**
Đáp: Bấm nút V1 → xác nhận. Hoặc kill switch. 1 giây là về V1.

**H: Chuyển nhiều lần có hỏng dữ liệu không?**
Đáp: Không. Việc chuyển chỉ đổi 1 dòng cấu hình trong DB (`site_config`), không xóa/sửa dữ liệu học viên, enrollment, bài giảng.

**H: Làm sao biết chắc đang ở V1 hay V2?**
Đáp: Vào admin → tab "⚙️ Hệ Thống" → xem dòng **"Chế độ hiện tại"**. Hoặc gọi `https://www.daubepnho.store/api/lms/admin?endpoint=runtime-mode` (cần đăng nhập admin) → xem trường `activeMode`.

**H: Kill switch khác gì nút V1?**
Đáp: Nút V1 = về V1 theo ý bạn. Kill switch = ép V1 **bất kể** mọi thứ (kể cả nếu V2 bị kẹt do DB lỗi). Dùng khẩn cấp.

**H: Tôi không thấy tab "⚙️ Hệ Thống"?**
Đáp: Trang admin chưa được update. Đảm bảo deploy production đã chạy commit `f10c1f7` trở lên (deploy `g3zpdnz10` trở lên). Nếu vẫn thiếu → báo kỹ thuật redeploy.

**H: Bấm V2 mà báo lỗi 503 `one_device_policy_unavailable`?**
Đáp: DB đang không đọc được cấu hình. Hệ thống tự fail-closed về V1 an toàn. Báo kỹ thuật kiểm tra kết nối Supabase. Trong lúc đó học viên vẫn dùng V1 bình thường.

---

## 12. Tóm tắt an toàn

- ✅ Chuyển V1 ↔ V2 **bao nhiêu lần cũng được**, không mất dữ liệu.
- ✅ V1 là **mặc định an toàn** — khi không test thì để V1.
- ✅ V2 chỉ chạy khi **cả** switch = V2 **và** tính năng đã bật. Thiếu 1 → vẫn V1.
- ✅ Kill switch ép V1 ngay lập tức, bất kể trạng thái.
- ✅ Mọi lần chuyển đều được **ghi audit log** (biết ai chuyển, lúc nào, sang chế độ nào).
- ❌ Không bao giờ tự xóa dữ liệu khi chuyển. Không cần rollback DB.

Khi gặp bất thường → **Kill switch** → báo kỹ thuật. Đơn giản vậy thôi.
