# V3 — Handoff Prompt (copy-paste vào phiên Claude Fable 5)

> **Cập nhật 2026-07-15 (source audit + ⑦ plan):** Phiên V3 research đã hoàn thành source audit Supabase A/B ownership và soạn plan chi tiết cho Đề xuất ⑦. Xem 3 file mới:
> - `docs/V3_SOURCE_AUDIT_FINDINGS.md` — kết luận A/B sở hữu bảng nào (verified từ code).
> - `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` — file SQL read-only owner chạy (4 block: RLS / index / constraint / function grant).
> - `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` — nơi owner paste kết quả (đang trống).
> - `docs/V3_PROPOSAL_7_MIGRATION_TOOL_PLAN.md` — plan ⑦ (chưa sửa tooling, chờ GO).
>
> **Quyết định tạm (chưa chốt):** KHÔNG kết luận B canonical / A projection cho bảng `posts` khi chưa đủ bằng chứng (runtime A chưa verify — chỉ thấy tên biến trong Portal code). Xem điều kiện GO #3 trong plan ⑦.
>
> **Điều kiện GO cho ⑦:** (1) owner chạy `V3_SCHEMA_GAP_SQL_VERIFICATION.sql` + paste kết quả; (2) 4 gap VERIFIED; (3) owner chốt `posts` A/B ownership; (4) owner tạo role read-only cho CI; (5) owner duyệt plan ⑦; (6) drill rollback PASS; (7) V1 baseline nguyên vẹn (đã verify 2026-07-15). NO-GO nếu thiếu #1/#2/#3.
>
> **Cách dùng:** Mở phiên Claude Fable 5 **tại worktree V3** (xem đường dẫn dưới). Copy toàn bộ nội dung trong khung `PROMPT` bên dưới và paste vào phiên đó làm tin nhắn đầu tiên.
>
> **Điều kiện tiên quyết (owner làm trước khi paste):**
> 1. Branch `v3/research-20260715` đã push lên origin ✅ (đã xong).
> 2. Worktree V3 đã tạo ✅ (đã xong): `_worktrees/v3-research-20260715`.
> 3. `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` đã được owner điền kết quả query production (chưa xong — làm BƯỚC A). Nếu chưa điền, Fable 5 vẫn đọc được transfer doc nhưng phải đánh dấu các giả định schema là `UNVERIFIED` cho tới khi owner điền. **Bổ sung 2026-07-15:** owner cũng cần chạy `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` (4 gap catalog) và paste vào `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` — đây là input bắt buộc cho Đề xuất ⑦.

---

## PROMPT (copy từ đây ↓↓↓)

```text
Bạn là Claude Fable 5, nhận bàn giao nhánh nghiên cứu V3 của dự án LMS
"web-lms-chinh-thuc" (hệ đào tạo ẩm thực — 3 repo: Shop / Student Portal / LMS).
Đồng nghiệp Opus 4.8 đã đồng hành phân tích V1 + xây dựng V2 và để lại tài liệu
transfer để bạn nắm dự án KHÔNG cần scan lại codebase từ đầu.

═══════════════════════════════════════════════════════════════════
BỐI CẢNH THỰC TẾ (đã verify 2026-07-15)
═══════════════════════════════════════════════════════════════════
- Bạn đang chạy trong worktree V3, branch v3/research-20260715
  (tách từ v2/rebuild-20260715 @ commit 78b02a7, kế thừa cả code V2).
- V1 production = branch main = f9220e8 = tag v1-stable-20260713 (BẤT BIẾN,
  là rollback target — KHÔNG đụng).
- Repo LMS (repo này): web-lms-chinh-thuc, domain www.daubepnho.store.
- Repo Portal (NGOÀI worktree này, Next.js):
  đường dẫn:  C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\yeubep-shop\student-web
  branch:     v2/platform-rebuild
  HEAD:       d2a903c  "chore(v2): isolate portal session guard telemetry changes"
  Vai trò:   Google login học viên, tạo entry_token, enforcement one-device
              (RPC handle_student_session_login), logout server-side.
  → RPC one-device + logout server-side đang chạy ở PORTAL, không trong LMS.
    Mọi đổi chính sách session/one-device phải đồng bộ lockstep với Portal.
- Runtime DB: Supabase B, project ref aqozjkfwzmyfunqvcyjv.

═══════════════════════════════════════════════════════════════════
BƯỚC 1 — ĐỌC TÀI LIỆU BÀN GIAO TRƯỚC KHI LÀM GÌ KHÁC
═══════════════════════════════════════════════════════════════════
Đọc tuần tự 2 file (dùng tool Read):
  1) docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md
     — tổng quan V1 (cấu trúc/schema/data flow/12 invariant), pitfalls V1,
       giải pháp V2, trạng thái V2, và 12 đề xuất đột phá cho V3 (mục §3,
       thứ tự ưu tiên ở §3.7).
  2) docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md
     — schema Supabase B THẬT (do owner điền). Nếu còn mục "PASTE RESULTS
       HERE" trống → đánh dấu các giả định schema liên quan là UNVERIFIED
       và liệt kê vào câu trả lời; không đoán.

═══════════════════════════════════════════════════════════════════
BƯỚC 2 — XÁC MINH BẰNG CHỨNG (đừng tin mù các mục NOT VERIFIED/UNVERIFIED)
═══════════════════════════════════════════════════════════════════
Trước khi architect bất kỳ thay đổi schema/session/sync nào:
  - Đọc code hiện tại tại SYMBOL được nhắc trong transfer doc (không chỉ tên file).
  - Nếu schema snapshot chưa điền → liệt kê rõ những gì bạn CẦN owner verify
    (theo các query trong V3_PRODUCTION_SCHEMA_SNAPSHOT.md).
  - Với phần session/one-device: đọc thêm repo Portal ở đường dẫn trên
    (src/lib/session-guard.ts, src/app/api/lms-entry-token/route.ts,
     src/app/api/auth/logout/route.ts) — caller RPC nằm ở đó.
  - Confirm: git branch --show-current = v3/research-20260715;
    git rev-parse f9220e8 không đổi; git tag --points-at f9220e8 có
    v1-stable-20260713.

═══════════════════════════════════════════════════════════════════
BƯỚC 3 — BÁO CÁO KẾ HOẠCH V3 (CHƯA SỬA CODE, CHƯA MIGRATION)
═══════════════════════════════════════════════════════════════════
Chọn 3–5 đề xuất đột phá ưu tiên cao nhất từ §3.7 của transfer doc.
Với mỗi đề xuất, viết:
  - Vấn đề gốc (P0/P1 nào của V1/V2, dẫn chứng file:symbol).
  - Thiết kế kiến trúc.
  - Migration cần (additive-only, liệt kê CREATE/ADD COLUMN cụ thể).
  - Phụ thuộc Portal (cần lockstep repo student-web cái gì).
  - Rủi ro + đường rollback (flag off, không migration đảo).
  - Điều kiện verify production trước khi hiện thực hóa.

Tôn trọng:
  - 12 invariant V1 (transfer doc §1.6) — phá = mất quyền học viên.
  - Hành vi keep (§1.7).
  - Nguyên tắc kế thừa V2 (§3.7): V1 bất biến, expand-and-contract,
    feature flag + canary + rollback drill, không log secret, data ownership
    (B canonical, A projection, repair cần audit+dry-run, không auto-revoke).

═══════════════════════════════════════════════════════════════════
NGUYÊN TẮC TUYỆT ĐỐI (kế thừa V2)
═══════════════════════════════════════════════════════════════════
- KHÔNG merge vào main. KHÔNG deploy production. KHÔNG flip flag production.
- KHÔNG đụng V1 baseline (main / v1-stable-20260713) — rollback target.
- Migration additive-only (ADD COLUMN nullable / CREATE TABLE/RPC/INDEX mới),
  không DROP / RENAME / ALTER TYPE cho tới Phase 3 + owner duyệt.
- KHÔNG log secret/token/private-key/service-role. Mask email, hash ip/device,
  hash user_agent (sửa SEC-10).
- KHÔNG commit scratch/, review-dossier-*, .env*, node_modules.
- Mỗi thay đổi: branch con → test pass (node --test) → merge ngược vào
  v3/research-20260715 → push. Commit message kết thúc Co-Authored-By.
- Đọc source + verify production + đọc Portal RỒI mới đề xuất — không đoán.

═══════════════════════════════════════════════════════════════════
BẮT ĐẦU
═══════════════════════════════════════════════════════════════════
Bắt đầu bằng BƯỚC 1: đọc docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md, rồi tóm tắt lại:
  (a) 3 điểm bạn thấy quan trọng nhất,
  (b) 1 điểm bạn muốn xác minh production (qua schema snapshot hoặc owner)
      TRƯỚC khi đi tiếp,
  (c) 3–5 đề xuất V3 bạn sẽ lên kế hoạch chi tiết ở BƯỚC 3.
Chưa sửa code ở lượt này.
```

## (kết thúc copy ↑↑↑)

---

## Phụ lục — thông tin tham chiếu cho owner

### Đường dẫn tuyệt đối
| Hạng mục | Đường dẫn |
|---|---|
| Worktree V3 (mở terminal ở đây rồi chạy `claude`) | `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\web-lms-chinh-thuc\_worktrees\v3-research-20260715` |
| Tài liệu transfer | `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` (đã commit 78b02a7) |
| Schema snapshot template | `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` (file này kế bên) |
| Portal repo (NGOÀI worktree, Next.js) | `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\yeubep-shop\student-web` (branch `v2/platform-rebuild`, HEAD `d2a903c`) |

### Thứ tự thao tác cho owner
1. **BƯỚC A (chỉ owner làm được):** Mở Supabase B SQL Editor → chạy 12 query trong `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` → paste kết quả vào các section → commit (`docs(v3): fill production schema snapshot`) → push.
2. **BƯỚC A2 (chỉ owner làm được — mới 2026-07-15):** Cùng SQL Editor → chạy file `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` (4 block, read-only SELECT) → paste result grid vào `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` (theo section heading) → commit (`docs(v3): fill production schema gap SQL results`) → push. Đây là input bắt buộc cho Đề xuất ⑦ (drift allowlist seed + baseline fidelity).
3. Mở terminal tại worktree V3 (đường dẫn trên) → chạy `claude` (chọn model Fable 5).
4. Copy khối `PROMPT` bên trên → paste làm tin nhắn đầu tiên.

### Lưu ý
- Nếu owner chưa kịp làm BƯỚC A, vẫn paste prompt được — Fable 5 sẽ đọc transfer doc, liệt kê các mục cần verify, và đánh dấu `UNVERIFIED` thay vì đoán.
- Prompt ép Fable 5 **chưa sửa code ở lượt đầu** (chỉ đọc + báo cáo kế hoạch) — đúng tinh thần "nhánh nghiên cứu", tránh tự ý refactor hỏng invariant.
- Sau khi Fable 5 báo cáo kế hoạch, owner duyệt rồi mới cho hiện thực hóa từng đề xuất (mỗi đề xuất = 1 feature branch con merge ngược vào `v3/research-20260715`).
