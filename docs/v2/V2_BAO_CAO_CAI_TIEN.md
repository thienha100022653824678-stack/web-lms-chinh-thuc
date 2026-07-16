# Báo cáo cải tiến hệ thống — Phiên bản V2

> Tài liệu dành cho đối tác / người dùng. Viết dễ hiểu, không đi vào kỹ thuật.
> Ngày: 16/07/2026 · Hệ thống: Nền tảng học trực tuyến (LMS) tại `daubepnho.store`

---

## 1. Tóm tắt trong 30 giây

V2 là bản nâng cấp lớn của hệ thống học trực tuyến, tập trung vào **3 điều**:

1. **Bảo mật tài khoản chặt hơn** — chống chia sẻ tài khoản, mỗi học viên chỉ học trên một thiết bị tại một thời điểm.
2. **Vận hành đáng tin cậy hơn** — dữ liệu học viên và khóa học đồng bộ chính xác giữa các hệ thống, không thất lạc.
3. **An toàn khi nâng cấp** — có thể bật/tắt phiên bản mới bằng một nút bấm, quay lại ngay nếu cần, **không bao giờ mất dữ liệu**.

Điểm quan trọng nhất: **V2 được bật một cách có kiểm soát**. Hệ thống cũ (V1) vẫn nguyên vẹn và luôn sẵn sàng, nên việc nâng cấp gần như không có rủi ro.

---

## 2. Vấn đề của phiên bản cũ (V1)

Trước khi có V2, hệ thống gặp một số điểm yếu thường thấy ở các nền tảng khóa học:

| Vấn đề | Hậu quả thực tế |
|---|---|
| Một tài khoản đăng nhập được ở nhiều nơi cùng lúc | Học viên **chia sẻ tài khoản** cho nhiều người → thất thu doanh thu |
| Đăng xuất chưa dứt điểm phía máy chủ | Đóng trình duyệt không thực sự thoát → khó kiểm soát phiên học |
| Đồng bộ dữ liệu giữa các hệ thống chưa có "lưới an toàn" | Khi có sự cố mạng, một vài đơn/quyền học có thể lệch, khó truy vết |
| Nâng cấp là việc "một chiều", khó lùi | Mỗi lần đổi hệ thống đều tiềm ẩn rủi ro gián đoạn |

V2 được xây để giải quyết đúng những điểm này.

---

## 3. Những cải tiến chính của V2

### 3.1. Khóa "một tài khoản — một thiết bị"

**Trước:** một Gmail có thể mở lớp học trên nhiều máy cùng lúc.
**Giờ (V2):** mỗi Gmail học viên chỉ giữ **một phiên học đang hoạt động** trên toàn hệ thống. Nếu tài khoản đang được dùng ở máy A, thì máy B sẽ **bị chặn** với thông báo lịch sự: *"Tài khoản đang được sử dụng trên thiết bị khác."*

**Lợi ích:**
- Chống chia sẻ tài khoản — bảo vệ doanh thu khóa học.
- Học viên thật không bị làm phiền: chuyển máy chỉ cần đăng xuất máy cũ rồi đăng nhập máy mới.
- Không "đá" người đang học giữa chừng: máy đang học vẫn được ưu tiên, máy mới mới là máy bị chặn.

### 3.2. Đăng xuất dứt điểm

**Trước:** đóng tab/trình duyệt không thực sự kết thúc phiên phía máy chủ.
**Giờ (V2):** khi học viên bấm đăng xuất, hệ thống **thu hồi phiên ngay tại máy chủ**. Thiết bị khác có thể đăng nhập lại ngay sau đó.

**Lợi ích:** kiểm soát phiên học chính xác, hỗ trợ trực tiếp cho tính năng "một thiết bị" ở trên.

### 3.3. Hỗ trợ xử lý khi học viên mất thiết bị

**Giờ (V2):** quản trị viên có thể **thu hồi phiên của một học viên** (khi họ mất máy, quên đăng xuất, hoặc phiên bị treo). Mỗi lần thu hồi:
- **Bắt buộc ghi lý do** (không cho thao tác tùy tiện).
- **Lưu nhật ký đầy đủ** (ai làm, lúc nào, vì sao).
- Học viên sau đó **tự đăng nhập lại** trên thiết bị mới — quản trị viên không cần can thiệp thêm.

**Lợi ích:** xử lý sự cố nhanh, minh bạch, có thể kiểm tra lại về sau.

### 3.4. Theo dõi dấu hiệu chia sẻ tài khoản

**Giờ (V2):** hệ thống âm thầm ghi nhận các dấu hiệu bất thường (một tài khoản đổi thiết bị liên tục, đăng nhập từ nhiều nơi...) và **cảnh báo cho quản trị viên** để xem xét.

**Lợi ích:** phát hiện sớm hành vi chia sẻ tài khoản mà **không làm phiền học viên thật** — việc theo dõi này chỉ để cảnh báo, không tự động chặn ai.

### 3.5. Bảo mật kết nối chặt hơn

**Giờ (V2):** hệ thống chỉ chấp nhận yêu cầu từ những địa chỉ web đã được phê duyệt (danh sách trắng), và các "chìa khóa bí mật" nội bộ được kiểm tra nghiêm ngặt — thiếu cấu hình thì **từ chối an toàn** thay vì chạy sai.

**Lợi ích:** giảm rủi ro bị lạm dụng từ bên thứ ba, an toàn hơn cho toàn bộ hệ thống.

### 3.6. Đồng bộ dữ liệu có "lưới an toàn"

**Trước:** khi Shop bán khóa học và cấp quyền cho học viên, dữ liệu được đẩy sang hệ thống học — nếu có trục trặc, khó biết và khó sửa.
**Giờ (V2):** mỗi sự kiện (mở khóa học, cấp quyền, thu hồi quyền) được **ghi vào một "hộp thư đi" (outbox)**, xử lý có kiểm soát, **tự thử lại khi lỗi**, và có báo cáo đối soát để phát hiện lệch dữ liệu.

**Lợi ích:**
- Không thất lạc quyền học của học viên đã mua.
- Khi có sự cố, hệ thống tự thử lại; nếu vẫn lỗi thì đưa vào danh sách "cần kiểm tra" để xử lý — không âm thầm bỏ sót.
- Có công cụ đối soát để đảm bảo dữ liệu hai bên khớp nhau.

### 3.7. Công cụ theo dõi tình trạng hệ thống

**Giờ (V2):** có các trang chẩn đoán nội bộ giúp quản trị viên xem nhanh: hệ thống có khỏe không, dữ liệu có lệch không, các tính năng đang bật/tắt ra sao — **mà không lộ thông tin nhạy cảm** của học viên.

**Lợi ích:** vận hành chủ động, phát hiện vấn đề trước khi nó ảnh hưởng đến người học.

---

## 4. Cải tiến quan trọng nhất: Nâng cấp an toàn, có nút lùi

Đây là điểm khiến V2 khác biệt với một bản "nâng cấp thông thường".

**Một nút chuyển đổi V1 ↔ V2 ngay trong trang quản trị:**
- Muốn thử hệ thống mới → bấm **V2**.
- Thấy cần quay lại → bấm **V1** → mọi thứ trở về như cũ **ngay lập tức**.
- Có **nút dừng khẩn cấp** (kill switch) ép về hệ thống cũ trong tình huống bất ngờ.

**Vì sao điều này quan trọng với đối tác:**
- **Không rủi ro "một đi không trở lại".** Hệ thống cũ luôn còn nguyên và sẵn sàng phục vụ.
- **Không mất dữ liệu.** Việc chuyển đổi chỉ đổi một thiết lập nhỏ, không xóa hay sửa dữ liệu học viên, đơn hàng, bài giảng.
- **Kiểm thử thật trước khi cam kết.** Có thể bật V2 để trải nghiệm, so sánh, rồi mới quyết định chuyển hẳn.
- **Mọi thao tác chuyển đổi đều được ghi nhật ký** — minh bạch, truy vết được.

---

## 5. V2 đã sẵn sàng đến đâu?

| Hạng mục | Trạng thái |
|---|---|
| Xây dựng tính năng bảo mật (một thiết bị, đăng xuất, thu hồi, theo dõi chia sẻ) | ✅ Hoàn thành |
| Đồng bộ dữ liệu có lưới an toàn (outbox, đối soát, thử lại) | ✅ Hoàn thành |
| Công cụ chẩn đoán & theo dõi | ✅ Hoàn thành |
| Nút chuyển đổi V1 ↔ V2 + dừng khẩn cấp | ✅ Hoàn thành, đã đưa lên hệ thống thật |
| Kiểm thử tự động | ✅ Toàn bộ vượt qua (hơn 200 kịch bản kiểm thử) |
| Chạy thử trên môi trường xem trước (preview) | ✅ Đã chạy, kết quả đạt |
| Chuyển toàn bộ người dùng sang V2 | ⏳ Chờ quyết định của chủ hệ thống — **đây là bước chủ động, không bắt buộc** |

Hiện tại hệ thống **vẫn đang phục vụ bằng V1** (ổn định). V2 đã cài đặt xong và **chỉ chờ được bật khi bạn sẵn sàng thử**.

---

## 6. Lộ trình đề xuất (nhẹ nhàng, từng bước)

1. **Xem thử:** bật V2 trong thời gian ngắn để trải nghiệm giao diện và các tính năng mới.
2. **Kiểm chứng:** thử các tình huống thực tế (đăng nhập 2 máy, đăng xuất, cấp quyền học viên) và so sánh với V1.
3. **Quan sát:** dùng công cụ theo dõi để đảm bảo dữ liệu khớp, không có lệch.
4. **Quyết định:** khi hài lòng, bật V2 cho toàn bộ. Nếu chưa, cứ giữ V1 — không có áp lực thời gian.

Ở mọi bước, nút quay lại V1 luôn sẵn sàng.

---

## 7. Cam kết an toàn

- ✅ **Dữ liệu được bảo toàn tuyệt đối** — chuyển đổi phiên bản không xóa/sửa dữ liệu.
- ✅ **Luôn có đường lùi** — V1 sẵn sàng bất cứ lúc nào, chỉ một nút bấm.
- ✅ **Minh bạch** — mọi thay đổi phiên bản đều được ghi nhật ký.
- ✅ **Không làm phiền học viên thật** — các biện pháp bảo mật hướng vào ngăn chặn lạm dụng, không cản trở người dùng hợp lệ.
- ✅ **Bật dần, có kiểm soát** — từng tính năng V2 được bật riêng, không phải "tất cả hoặc không có gì".

---

## 8. Kết luận

V2 mang lại **bảo mật tốt hơn** (chống chia sẻ tài khoản, bảo vệ doanh thu), **vận hành tin cậy hơn** (dữ liệu không thất lạc, có đối soát), và quan trọng nhất là **một con đường nâng cấp an toàn** — thử được, lùi được, không mất mát.

Đây là nền tảng vững chắc để hệ thống phát triển tiếp mà vẫn giữ trải nghiệm mượt mà cho học viên và sự an tâm cho người vận hành.

---

*Mọi câu hỏi chi tiết về cách thao tác, vui lòng xem thêm tài liệu "Hướng dẫn sử dụng V2 — Chuyển V1 ↔ V2 để test".*
