# V3 — Đề xuất ⑦: Migration tool thật + CI schema-drift gate + ERD từ live DB

> **Trạng thái:** IMPLEMENTATION PLAN (draft). **Chưa sửa tooling, chưa apply, chưa tạo thư mục Supabase CLI.** Đây là bản kế hoạch chi tiết để owner duyệt trước khi hiện thực hóa.
>
> **Thứ tự ưu tiên:** Đề xuất ⑦ là **foundation #1** của V3 (transfer doc §3.6) — phải làm trước RLS (①) và outbox (④), vì mọi migration sau đó cần một baseline đúng + một gate chống drift. Nhưng ⑦ **không đụng dữ liệu production** ở bước baseline — chỉ snapshot.
>
> **Ràng buộc kế thừa V2 (§3.7):** V1 bất biến (`main` / `v1-stable-20260713` = `f9220e8`), expand-and-contract, feature flag + rollback drill, không log secret, B canonical / A projection, 12 invariant V1 phải giữ.

---

## 0. Mục tiêu & phi mục tiêu

**Mục tiêu (⑦):**
1. Đưa schema Supabase B về **nguồn sự thật có version control** — thay `supabase_schema.sql` ("kịch bản khởi tạo" có seed) bằng Supabase CLI migrations có up/down + thứ tự áp dụng rõ.
2. **CI schema-drift gate**: sinh schema từ migrations → so vs dump live DB → **fail CI nếu drift** (cột/index/constraint/RLS/policy/grant lệch).
3. **Baseline production schema mà KHÔNG replay các migration lịch sử nguy hiểm** (xem §3).
4. **Tách seed khỏi schema** — seed không nằm trong migration áp dụng lên production.
5. Tự sinh **ERD** từ live DB để tài liệu hóa (housekeeping, không chặn).

**Phi mục tiêu (gác sang sau / ngoài ⑦):**
- Không hiện thực hóa RLS (①), outbox (④), session unify (②) — ⑦ chỉ là nền; các đề xuất đó sẽ *dùng* ⑦.
- Không migrate Supabase A (Portal `posts`/`post_views`) trừ khi owner chốt A cũng cần quản lý (xem §6).
- Không đổi ngôn ngữ runtime (JS → TS) — đó là ⑩.
- Không flip flag production, không deploy, không merge main.

---

## 1. Cấu trúc thư mục Supabase CLI dự kiến

```
supabase/                              # MỚI — thư mục CLI ở repo root (worktree V3)
├── config.toml                        # project_id = <ref B>, không chứa secret
├── .gitignore                         # bỏ .env, .temp/, generated ERD artifacts nếu cần
├── migrations/
│   ├── 00000000000000_baseline.sql    # BASELINE snapshot production (xem §3) — KHÔNG replay lịch sử
│   ├── 00000000000001_init_schema.sql # (tùy chọn) đặt lại init additive idempotent nếu owner muốn
│   └── YYYYMMDDHHMMSS_<slug>.sql      # các migration V3 sau này (additive-only)
├── seeds/
│   └── seed.sql                       # seed tách riêng — CHỈ cho local/preview branch (xem §4)
└── generated/
    └── schema.sql                     # do `supabase db pull` / `supabase migration list` sinh — gitignored hoặc committed tùy chính sách (xem §7)
```

**Lý do đặt ở repo root:** Supabase CLI mặc định tìm `supabase/` ở cwd; Vercel deploy không cần thư mục này (CLI chỉ chạy local/CI, không chạy runtime). Không đụng `api/`, `utils/`, `vercel.json`.

**Không hardcode secret trong `config.toml`:** `project_id` = project ref (đã công khai trong docs), connection qua `SUPABASE_DB_URL` / access token từ CI secret (không commit). Xem §5 về CI secret.

---

## 2. Lựa chọn tool: Supabase CLI (chính) + Percona-style diff

**Đề xuất:** Supabase CLI (`supabase` binary) — vì:
- Hỗ trợ `supabase db pull` (snapshot live → migration), `supabase migration list` (xem trạng thái áp dụng), `supabase db push` (apply), `supabase db remote commit`.
- Tích hợp `supabase db diff` sinh migration từ thay đổi local.
- Không cần thêm dependency runtime (CLI là binary, cài qua CI, không vào `package.json` deps runtime).

**Loại trừ:** drizzle-kit / sqitch — thêm layer mà team chưa dùng; giữ surface nhỏ. Nếu V3 sau này lên TS + monorepo (⑩) có thể đánh giá lại drizzle-kit.

**Phiên bản CLI:** pin version trong CI (xem §5) để tránh breaking change ngầm.

---

## 3. Baseline production schema — KHÔNG replay migration lịch sử nguy hiểm

**Vấn đề:** Repo có 10 file `migration_*.sql` lịch sử (account_sharing, atomic_session_guard, drive_*, v2_identity_mapping, v2_sync_outbox, grants_hardening...). Một số đã apply production, một số **chưa** (outbox = 404 per snapshot, identity_mapping apply một phần). Replay toàn bộ từ `supabase_schema.sql` rồi 10 migration = **nguy hiểm**: có migration `migration_atomic_session_guard.sql` **UPDATE dữ liệu thật** (supersede duplicate active sessions) — không được replay trên production đã sạch.

**Cách baseline an toàn (không replay):**

1. **Bước snapshot (chỉ đọc, owner làm):** Owner chạy Supabase CLI hoặc SQL Editor xuất full schema production:
   - `pg_dump --schema-only --schema=public` (qua `SUPABASE_DB_URL`), HOẶC
   - `supabase db pull` (CLI tự sinh `supabase/migrations/..._baseline.sql` từ live DB).
   - Kết quả: **một file baseline = trạng thái hiện tại của production**, đóng gói thành migration duy nhất `00000000000000_baseline.sql`.
   - **KHÔNG chạy** `supabase db push` lên production ở bước này — chỉ `pull` (đọc).

2. **Đánh dấu baseline đã "applied":** CLI ghi baseline vào bảng `supabase_migrations.schema_migrations` của production qua **một thao tác ghi metadata duy nhất** (`supabase migration repair --status applied <name>`), **không apply SQL**. → Production không bị replay, nhưng CLI coi baseline là điểm bắt đầu.
   - Đây là thao tác **duy nhất chạm metadata production** trong ⑦ — owner phải duyệt. An toàn vì chỉ insert 1 row vào `supabase_migrations.schema_migrations` (bảng nội bộ CLI), không đụng data/schema thật.
   - **Rollback của bước này** (xem §7): `supabase migration repair --status reverted <name>` — xóa row metadata, không đụng schema.

3. **Không xóa `supabase_schema.sql` + `migration_*.sql` ở lượt ⑦.** Giữ chúng làm **lịch sử tham chiếu** (document why columns drifted). Đánh dấu deprecated trong README, không xóa — tránh mất ngữ cảnh. Dọn dẹp dead file là ⑧ (housekeeping).

4. **Mọi migration V3 sau baseline** = additive-only (ADD COLUMN nullable, CREATE TABLE/INDEX/RPC mới), có up (và down đảo an toàn khi được). Không DROP/RENAME/ALTER TYPE cho tới Phase 3 + owner duyệt.

**Kết quả:** Production có schema giống trước + 1 row metadata CLI; repo có `supabase/migrations/00000000000000_baseline.sql` là nguồn sự thật. Mọi drift phát sinh sau đó = migration mới, có audit.

---

## 4. Tách seed khỏi schema

**Hiện trạng:** `supabase_schema.sql` trộn `CREATE TABLE` + `INSERT INTO courses (slug='donut'...)` (seed mẫu). Nếu migration áp dụng seed lên production → tạo/sửa dữ liệu thật → **phá invariant**.

**Đề xuất tách:**
- `supabase/migrations/*.sql` = **chỉ DDL** (CREATE/ALTER/INDEX/CONSTRAINT/RPC/GRANT/REVOKE/RLS/policy). Không INSERT/UPDATE/DELETE dữ liệu nghiệp vụ.
- `supabase/seeds/seed.sql` = dữ liệu mẫu (`donut`, `banh-mi`...). **Chỉ áp dụng cho local + preview branch**, KHÔNG cho production.
- Supabase CLI phân biệt `supabase db push` (migrations) vs `supabase db seed` (seed). CI gate chỉ kiểm migrations (DDL). Seed không nằm trong drift gate.

**Bảo vệ:** CI step `supabase db seed` **chỉ chạy trên ephemeral preview DB**, có guard `if [ "$DB_ENV" = "production" ]; then exit 1` để không bao giờ seed production. Không dựa solely vào flag — fail-closed.

---

## 5. CI schema-drift gate — so sánh cái gì

**Pipeline (GitHub Actions hoặc Vercel CI — tùy repo CI hiện có):**

```
┌─ job: schema-drift-gate ──────────────────────────────────────────────┐
│ 1. Cài Supabase CLI (pin version).                                     │
│ 2. Tạo ephemeral Postgres (supabase CLI local / Neon branch /          │
│    supabase start) → apply toàn bộ supabase/migrations/*.sql (từ        │
│    baseline + các migration V3). → schema "EXPECTED" (sinh từ code).    │
│ 3. Dump schema EXPECTED: pg_dump --schema-only --schema=public.         │
│ 4. Dump schema ACTUAL (production Supabase B, read-only qua            │
│    SUPABASE_DB_URL_RO secret): pg_dump --schema-only --schema=public.   │
│ 5. Diff hai dump (per-table normalized: tables/columns/indexes/         │
│    constraints/RLS/policies/grants/functions).                          │
│ 6. Gate:                                                               │
│    - Drift ở cột/constraint/index/RLS/policy/grant = FAIL CI.          │
│    - Drift chỉ ở thứ tự cột / comment / default expression dạng khác    │
│      = WARN (không fail, ghi log).                                      │
│    - ALLOWLIST: một số drift đã biết và đã được owner chấp nhận         │
│      (file supabase/drift_allowlist.json) — nếu khớp = PASS.            │
│ 7. Sinh ERD (mermaid hoặc dbdiagram.io) từ schema ACTUAL → artifact     │
│    (không chặn, housekeeping).                                          │
└────────────────────────────────────────────────────────────────────────┘
```

**So sánh cụ thể (không giả định tên):**
- **Tables/columns:** `information_schema.columns` (tên + kiểu + nullable + default).
- **Constraints:** `pg_constraint` (UNIQUE/PK/FK/CHECK + def).
- **Indexes:** `pg_indexes` + `pg_index` (unique/partial/predicate).
- **RLS + policies:** `pg_class.relrowsecurity/relforcerowsecurity` + `pg_policies`.
- **Functions/grants:** `pg_proc` (prosecdef/owner/config) + `routine_privileges` + `has_function_privilege`.
- **Triggers:** `pg_trigger` (nếu V3 thêm trigger).

→ Đây chính là nội dung 4 block trong `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql`. Gate dùng **cùng câu query catalog**, nên kết quả owner paste vào `V3_SCHEMA_GAP_SQL_RESULTS.md` sẽ là **input seed cho allowlist** ở lần chạy gate đầu (drift đã biết = production hiện trạng, được "bật khai sinh" thành baseline).

**CI secret cần (không commit):**
- `SUPABASE_DB_URL_RO`: connection string read-only tới production B (role chỉ SELECT catalog). **Owner tạo role read-only riêng**, không dùng service-role.
- `SUPABASE_ACCESS_TOKEN`: CLI Management API token (nếu dùng `db pull` automation) — tùy chọn, có thể chỉ dùng `pg_dump`.

**Tần suất:** chạy trên PR vào `v3/research-20260715` + nightly (bắt drift do ai đó sửa production tay qua SQL Editor).

---

## 6. Xử lý Supabase A và B nếu cả hai đều cần quản lý

**Hiện trạng (xem source audit — `docs/V3_SOURCE_AUDIT_FINDINGS.md`):**
- **Supabase B** (LMS runtime, ref `aqozjkfwzmyfunqvcyjv`): 22 bảng, 3 RPC, LMS repo ghi qua service-role `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; Portal ghi session-guard qua `LMS_SUPABASE_URL`/`LMS_SUPABASE_SERVICE_ROLE_KEY` (alias cùng B).
- **Supabase A** (Portal `posts`/`post_views`, RPC `record_view`): Portal đọc/ghi qua `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Runtime A chưa xác minh** (env Portal trống trong worktree — chỉ thấy tên biến trong code).

**Quyết định tạm (chưa chốt):** ⑦ ban đầu **chỉ quản lý B** (canonical, LMS runtime). Lý do:
- B là nguồn sự thật nghiệp vụ; 12 invariant V1 sống ở B.
- A = projection (transfer doc §H: "A không ghi ngược"). Quản lý A = complexity gấp đôi + 2 baseline + 2 gate.
- **Nhưng**: bảng `posts` thực tế **tồn tại trên cùng Supabase B** (snapshot Q1: `posts` 1 row, cùng project ref B) → câu hỏi "A có thực sự là project riêng hay chỉ schema tách trong B" **chưa đủ bằng chứng để chốt** (xem điều kiện GO #4).

**Nếu owner chốt A là project riêng và cần quản lý:**
- Mở rộng cấu trúc: `supabase-b/` + `supabase-a/` (2 thư mục CLI, 2 `config.toml`, 2 baseline, 2 gate job).
- Hoặc giữ `supabase/` cho B, thêm `supabase-portal/` cho A.
- Data ownership contract (§H) phải được gate tôn trọng: gate B fail nếu A-only object xuất hiện trong B baseline và ngược lại.

**Khuyến nghị ⑦ (draft):** Phase 1 chỉ B. Khi owner verify A runtime + chốt A cần version control → Phase 1.5 thêm A (riêng branch con, riêng gate). Không gộp trong cùng PR để rollback độc lập.

---

## 7. Rollback của tooling (⑦ cụ thể)

⑦ là **tooling + documentation + CI**, không đổi runtime code, không đổi production schema (trừ 1 row metadata baseline — xem §3 bước 2). Rollback因而 rẻ:

| Thành phần ⑦ | Rollback |
|---|---|
| `supabase/` thư mục + migrations | `git revert` commit ⑦ → xóa khỏi repo. Không đụng runtime. |
| Baseline metadata trên production B | `supabase migration repair --status reverted 00000000000000_baseline` → xóa 1 row trong `supabase_migrations.schema_migrations`. **Không đụng schema/data thật.** Owner làm, có audit. |
| CI schema-drift gate | Tắt job trong CI config (xóa file workflow / comment out). Không ảnh hưởng deploy. |
| Seed tách rời | `git revert` — seed chỉ trên preview, không production. |
| ERD artifact | Xóa file generated. |

**Drill rollback (bắt buộc trước GO):**
1. Trên preview branch, áp dụng ⑦ đầy đủ → chạy gate → PASS.
2. Thực hiện rollback đầy đủ (revert + repair metadata) → xác nhận repo về trạng thái trước ⑦, production `supabase_migrations.schema_migrations` không còn row baseline.
3. Ghi kết quả drill vào `docs/V3_PROPOSAL_7_ROLLBACK_DRILL.md`.
4. Chỉ GO khi drill rollback PASS.

**Không rollback được (cần owner biết):** baseline metadata row — nhưng nó chỉ là 1 row trong bảng nội bộ CLI, không có tác dụng phụ ngoài việc CLI "biết" baseline đã applied. Trạng thái trước/sau giống hệt về schema/data.

---

## 8. Danh sách file dự kiến thêm/sửa (chưa tạo — chờ GO)

**THÊM:**
- `supabase/config.toml` — CLI config (project_id = ref B, không secret).
- `supabase/.gitignore` — bỏ `.env`, `.temp/`.
- `supabase/migrations/00000000000000_baseline.sql` — baseline snapshot production (do owner `db pull` sinh, KHÔNG viết tay).
- `supabase/seeds/seed.sql` — seed tách từ `supabase_schema.sql` (chỉ preview).
- `.github/workflows/schema-drift-gate.yml` (hoặc tương đương Vercel CI) — job gate.
- `supabase/drift_allowlist.json` — drift đã biết được owner chấp nhận (seed từ kết quả `V3_SCHEMA_GAP_SQL_RESULTS.md`).
- `docs/V3_PROPOSAL_7_ROLLBACK_DRILL.md` — kết quả drill rollback (GO condition).
- `docs/V3_ERD_B.md` (hoặc `supabase/generated/erd.mmd`) — ERD tự sinh (housekeeping).

**SỬA (documentation only — không sửa runtime code ở ⑦):**
- `README.md` — đánh dấu `supabase_schema.sql` + `migration_*.sql` là **lịch sử tham chiếu deprecated**, trỏ sang `supabase/migrations/`.
- `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md` — cập nhật §3 đề xuất ⑦: đánh dấu "PLAN READY", link file này.
- `docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md` — sau khi owner paste gap results, đánh dấu 4 gap `VERIFIED`.
- `docs/V3_HANDOFF_PROMPT.md` — thêm ⑦ vào "thứ tự hiện thực hóa" nếu owner duyệt.

**KHÔNG SỬA ở ⑦:**
- `api/*.js`, `utils/*.js` — runtime code (RLS/outbox/session là ①/④/②, không ⑦).
- `supabase_schema.sql`, `migration_*.sql` — giữ làm lịch sử (dọn là ⑧).
- `package.json` deps runtime — CLI là CI binary, không vào deps runtime.
- Bất kỳ file nào ở branch `main` / tag `v1-stable-20260713`.

---

## 9. Điều kiện GO cho ⑦ (tất cả phải ✓)

1. [ ] **Owner đã chạy** `docs/V3_SCHEMA_GAP_SQL_VERIFICATION.sql` trên Supabase B SQL Editor và paste kết quả vào `docs/V3_SCHEMA_GAP_SQL_RESULTS.md` (4 block đầy đủ).
2. [ ] **4 gap VERIFIED**: RLS status, unique/partial index (đặc biệt 1-active/email), constraint UNIQUE(email, course_slug) hoặc tương đương, `handle_student_session_login` grant/security-mode. → Đây là input seed cho `drift_allowlist.json` + cho baseline đúng.
3. [ ] **Owner chốt Supabase A/B ownership** cho bảng `posts`: A là project riêng hay chỉ schema trong B? (xem source audit). ⑦ Phase 1 chỉ B; nếu A riêng → Phase 1.5 thêm A.
4. [ ] **Owner tạo role read-only** trên B cho CI (`SUPABASE_DB_URL_RO`), chỉ SELECT catalog — không service-role.
5. [ ] **Owner duyệt** bản plan này (file hiện tại) — đặc biệt §3 (baseline metadata row là thao tác duy nhất chạm production) + §6 (chỉ B Phase 1).
6. [ ] **Drill rollback PASS** (§7) trên preview branch trước khi gate chạy trên PR thật.
7. [ ] V1 baseline xác nhận nguyên vẹn: `git rev-parse f9220e8` = `f9220e8128e13e93d803e0c014c39be5819f557c`, tag `v1-stable-20260713` vẫn points-at `f9220e8` (đã verify 2026-07-15).

**NO-GO nếu:** bất kỳ điều kiện nào thiếu — đặc biệt #1+#2 (gap SQL chưa chạy = baseline sẽ sai, gate sẽ fail ngay lần đầu) hoặc #3 (ownership `posts` chưa chốt = không biết baseline B có nên chứa `posts` không).

---

## 10. Rủi ro + giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Baseline `db pull` bao gồm drift ẩn (`is_section`, `materials`, `expected_start_date`) → "đóng băng" drift thành chính thức | Đây **chính là mục đích**: baseline = sự thật hiện tại. Drift sẽ được ⑧ chính thức hóa bằng migration additive sau. ⑦ không sửa drift, chỉ ghi nhận. Allowlist minh bạch. |
| `migration repair --status applied` chạm production | Chỉ 1 row metadata nội bộ CLI; không schema/data. Owner làm, có audit log. Drill rollback verify. |
| CI dùng DB connection có quyền quá cao | Role read-only riêng (`SUPABASE_DB_URL_RO`), chỉ SELECT catalog. Không service-role trong CI. |
| Gate fail do diff "noise" (thứ tự cột, comment) | Normalize diff + allowlist + WARN vs FAIL phân biệt (§5 bước 6). |
| Supabase CLI version drift giữa local/CI | Pin version trong CI workflow + ghi version vào `supabase/config.toml`/README. |
| Owner sửa production qua SQL Editor (bypass CLI) → drift | Nightly gate + rule quy trình: mọi schema change qua migration, SQL Editor chỉ cho read-only verify (chính file `V3_SCHEMA_GAP_SQL_VERIFICATION.sql`). |
| `posts` ownership chưa chốt → baseline sai scope | GO condition #3; chặn đến khi chốt. |
| Tooling phình, team chưa quen CLI | ⑦ giữ surface tối thiểu (chỉ B, chỉ gate + baseline); README có quickstart. |

---

## 11. Phụ thuộc Portal (lockstep repo student-web?)

**⑦ KHÔNG cần lockstep Portal** — vì:
- ⑦ chỉ quản lý schema B (LMS runtime). Portal session-guard code đọc/ghi B qua `lmsSupabaseAdmin` nhưng **không định nghĩa schema B** (schema B do migration LMS repo quản lý).
- Portal cũng có `posts`/`student_enrollments` access (qua `supabaseAdmin` = Supabase A candidate) — nhưng đó là **A**, không nằm trong scope ⑦ Phase 1 (xem §6).

**Ngoại lệ — khi nào ⑦ chạm Portal:**
- Nếu owner chốt A cũng cần CLI quản lý (Phase 1.5) → cần đọc Portal env `NEXT_PUBLIC_SUPABASE_URL` để biết ref A → nhưng **không sửa code Portal**, chỉ thêm `supabase-portal/` trong **repo LMS** hoặc repo Portal (quyết định owner).
- Nếu baseline B có object mà Portal code phụ thuộc (RPC `handle_student_session_login`, bảng `student_active_sessions`...) → gate B phải bảo vệ chúng — nhưng đó là bảo vệ, không sửa Portal.

→ ⑦ Phase 1 = **repo LMS only**, không PR Portal.

---

## 12. Thứ tự hiện thực hóa (sau GO, mỗi bước = branch con merge ngược vào v3/research-20260715)

1. **B-1 (docs only):** Cập nhật `V3_PRODUCTION_SCHEMA_SNAPSHOT.md` đánh dấu gap VERIFIED từ `V3_SCHEMA_GAP_SQL_RESULTS.md` + cập nhật transfer doc link plan này. → branch `v3/p7-doc-verify`.
2. **B-2 (tooling skeleton):** Tạo `supabase/config.toml` + `.gitignore` + `seeds/seed.sql` (tách seed) + README quickstart. **Chưa baseline, chưa gate.** → branch `v3/p7-skeleton`. Test: `supabase migration list` chạy local không lỗi.
3. **B-3 (baseline, owner làm):** Owner `supabase db pull` → sinh `00000000000000_baseline.sql` → commit. Owner `supabase migration repair --status applied` trên B (1 row metadata). Drill rollback. → branch `v3/p7-baseline`.
4. **B-4 (gate):** CI workflow + `drift_allowlist.json` (seed từ gap results) + diff script. Chạy gate trên preview → PASS. → branch `v3/p7-gate`.
5. **B-5 (ERD + housekeeping docs):** Sinh ERD, đánh dấu `supabase_schema.sql`/`migration_*.sql` deprecated trong README. → branch `v3/p7-erd-docs`.

Mỗi bước: `node --test` pass (nếu có test liên quan) + review + merge ngược. Không deploy, không flip flag.

---

> **Kết:** ⑦ là nền an toàn — đưa schema về version control + gate chống drift, **không sửa runtime, không sửa production schema** (trừ 1 row metadata CLI có rollback). GO khi owner chạy gap SQL + chốt `posts` ownership + duyệt plan này + drill rollback PASS.
