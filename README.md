# Hướng Dẫn Tích Hợp Hệ Thống Học Viên & Bài Học (LMS)

Tài liệu này hướng dẫn chi tiết cách cấu hình và vận hành hệ thống Cổng học viên (LMS) và Trang quản trị LMS mới được tích hợp vào yeubep.shop, sử dụng cơ sở dữ liệu Supabase, xác thực Google Auth và bảo mật video Bunny Stream.

---

## 1. Các Trang Giao Diện Mới (Frontend Paths)

Hệ thống LMS được triển khai thông qua các trang tĩnh sau:
1. **Cổng học viên (`lms.html`)**: 
   - Địa chỉ truy cập: `https://ten-mien-cua-ban.com/lms.html` hoặc `https://ten-mien-cua-ban.com/lms.html?course=slug`
   - Đăng nhập qua tài khoản Google của học viên để tải danh sách bài học của khóa học tương ứng.
2. **Trang xem bài học (`lesson.html`)**:
   - Địa chỉ truy cập: `https://ten-mien-cua-ban.com/lesson.html?id=lesson-uuid`
   - Trình phát video bảo mật Bunny Stream (tích hợp watermark động chống quay màn hình) + công thức chi tiết từ Google Docs + tài liệu đính kèm. Hỗ trợ xem danh sách bài học dạng sidebar và nút chuyển bài học trước/sau.
3. **Trang quản trị LMS (`lms-admin.html`)**:
   - Địa chỉ truy cập: `https://ten-mien-cua-ban.com/lms-admin.html`
   - Quản trị viên đăng nhập (so khớp email với danh sách `ADMIN_EMAILS`) để quản lý bài giảng, tài khoản học viên và cấp/thu hồi quyền truy cập lớp học.
4. **Trình phát phụ trợ (`gdrive-player.html` & `photo.html`)**:
   - Xem video bảo mật từ Google Drive qua iframe preview và xem công thức/ảnh bổ sung.

---

## 2. Các Bảng Cơ Sở Dữ Liệu LMS Mới (Supabase Tables)

> **V3 (⑦) — nguồn sự thật schema:** `supabase_schema.sql` và các `migration_*.sql` ở thư mục gốc hiện là **lịch sử tham chiếu (deprecated)**. Từ V3, schema Supabase B được quản lý qua Supabase CLI trong thư mục [`supabase/`](./supabase/) (migrations + drift allowlist + CI gate). Baseline thật do owner sinh bằng `supabase db pull` — xem [docs/V3_PHASE_1_MIGRATION_TOOLING.md](./docs/V3_PHASE_1_MIGRATION_TOOLING.md). Đừng dùng `supabase_schema.sql` để khởi tạo môi trường mới nữa.

Khi chạy các câu lệnh SQL bổ sung trong [supabase_schema.sql](./supabase_schema.sql), các bảng sau sẽ được tạo:
* `lessons`: Lưu thông tin chi tiết bài học (tiêu đề, mô tả, số thứ tự, link video Bunny, link công thức Google Docs, tài liệu đính kèm `media_urls`, trạng thái hoạt động).
* `students`: Lưu thông tin học viên (email, họ tên, điện thoại, ghi chú, trạng thái).
* `student_enrollments`: Quản lý phân quyền học viên vào khóa học (liên kết học viên với khóa học, trạng thái kích hoạt, thời gian hết hạn).
* `site_config`: Lưu các cấu hình dạng key-value của LMS (như tiêu đề, banner, phụ đề từng khóa học).
* `lesson_progress`: Theo dõi tiến trình học tập của học viên.

---

## 3. Cấu Hình Biến Môi Trường Trên Vercel / File `.env`

Để hệ thống LMS hoạt động đầy đủ, bạn cần bổ sung các biến môi trường sau trên Vercel (hoặc file `.env` cục bộ):

| Tên Biến | Mô tả / Cách lấy |
| :--- | :--- |
| `GOOGLE_CLIENT_ID` | Client ID của ứng dụng Google Cloud Credentials (dùng cho Google Sign-In ở client). |
| `GOOGLE_CLIENT_EMAIL` | Email của Google Service Account (để đọc Docs và Drive backend-to-backend). |
| `GOOGLE_PRIVATE_KEY` | Private Key của Google Service Account (bắt đầu bằng `-----BEGIN PRIVATE KEY-----\n...`). |
| `BUNNY_STREAM_TOKEN_KEY` | Token Authentication Key của Bunny Stream Library (dùng để ký số token bảo mật phát video). |
| `ADMIN_EMAILS` | Danh sách email quản trị viên cách nhau bởi dấu phẩy (Ví dụ: `admin1@gmail.com,admin2@gmail.com`). |
| `SESSION_SECRET` | Khóa bảo mật ngẫu nhiên dùng để mã hóa và ký phiên đăng nhập học viên/admin. |
| `GOOGLE_DRIVE_IMAGE_FOLDER_ID` | *(Tùy chọn)* ID thư mục Drive để tải lên hình ảnh từ admin panel. |
| `GOOGLE_DRIVE_RECIPE_FOLDER_ID` | *(Tùy chọn)* ID thư mục Drive để lưu trữ/tải lên tệp công thức. |

---

## 4. Cơ Chế Tự Động Phân Quyền Khi Duyệt Đơn Hàng (Auto-Enrollment)

Hệ thống LMS được tích hợp sâu với hệ thống bán hàng hiện tại:
1. Khi khách hàng mua khóa học trên trang bán hàng chính, họ điền email và tải lên bill chuyển khoản.
2. Quản trị viên truy cập trang `orders.html` để kiểm tra đơn hàng.
3. Khi bấm **"Duyệt"** một đơn hàng (hoặc bấm **"Duyệt tất cả"**), hệ thống bán hàng sẽ gọi đến tiện ích `autoEnroll` backend:
   - Kiểm tra xem học viên có email tương ứng đã tồn tại trong bảng `students` chưa. Nếu chưa sẽ tự động tạo tài khoản học viên mới.
   - Tạo mới hoặc cập nhật trạng thái phân quyền trong bảng `student_enrollments` thành `active` cho khóa học (`course_slug`) tương ứng với đơn hàng đó.
4. Ngay lập tức, học viên có thể truy cập `lms.html`, đăng nhập bằng Gmail của mình và bắt đầu học mà không cần quản trị viên cấp quyền thủ công.

---

## 5. Quy Trình Vận Hành & Quản Trị Hệ Thống (CMS)

Quản trị viên có thể vào trang `lms-admin.html` để quản lý các nội dung sau:

### Tab 1: Quản lý bài học (Lessons)
* Chọn khóa học muốn chỉnh sửa trong danh sách dropdown.
* Thêm bài học mới, sửa bài học cũ hoặc ẩn bài học (soft delete).
* **Tải lên hình ảnh**: Nhấp nút "Tải ảnh" bên cạnh Thumbnail hoặc Media Phụ để tự động upload ảnh lên Google Drive và lấy link trực tiếp điền vào form.
* **Tạo Google Docs**: Soạn thảo công thức dạng text hoặc tải file `.txt` lên, sau đó nhấp "Tạo Google Docs" để hệ thống tự động tạo tệp Docs trên Google Drive và lưu link `recipeUrl`.

### Tab 2: Quản lý học viên (Students)
* Tìm kiếm học viên theo Email, Họ tên hoặc Số điện thoại.
* Thêm học viên thủ công hoặc chỉnh sửa thông tin liên hệ, ghi chú nội bộ của học viên.
* Xóa học viên khỏi hệ thống.

### Tab 3: Cấp quyền học (Phân quyền - Enrollments)
* Xem danh sách tất cả học viên đã được cấp quyền truy cập khóa học.
* Cấp quyền học thủ công bằng cách nhấp "Cấp quyền mới", điền Email học viên, chọn Khóa học và thiết lập Ngày hết hạn (nếu có).
* Thay đổi trạng thái quyền học nhanh chóng (Active / Inactive) hoặc bấm "Thu hồi" để xóa quyền học của học viên đối với khóa học đó.
