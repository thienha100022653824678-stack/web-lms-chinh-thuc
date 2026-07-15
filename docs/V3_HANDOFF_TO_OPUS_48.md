# V3 Handoff — tiếp tục triển khai từ Phase 1 (⑦)

> **Người bàn giao:** Claude Fable 5 (phiên 2026-07-15).
> **Người nhận:** Claude Opus 4.8.
> **Trạng thái:** Phase 0 (runtime controller spine) DONE + committed + pushed. Master plan DONE + committed. Sắp bắt đầu Phase 1 (⑦ migration tooling + CI schema-drift gate) thì owner hết quota.
> **Mục tiêu bàn giao:** Opus 4.8 tiếp tục Phase 1 → Phase 10 theo master plan, tuần tự, auto-advance khi test đạt, dừng chỉ ở blocker owner thật sự. KHÔNG tự cutover production.

---

## 0. PROMPT COPY-PASTE (dán vào phiên Opus 4.8 làm tin nhắn đầu tiên)

```text
Bạn là Claude Opus 4.8, nhận bàn giao nhánh triển khai V3 của dự án LMS
"web-lms-chinh-thuc" (hệ đào tạo ẩm thực). Đồng nghiệp Claude Fable 5 đã lập
master plan toàn bộ V3 (①-⑫) và hoàn thành Phase 0 (runtime controller spine).
Bạn tiếp tục từ Phase 1.

BỐI CẢNH ĐÃ VERIFY (2026-07-15):
- Worktree V3: _worktrees/v3-research-20260715, branch v3/research-20260715
  (đã push lên origin, đồng bộ). Làm việc TẠI worktree này.
- V1 production BẤT BIẾN: main = f9220e8 = tag v1-stable-20260713. KHÔNG đụng.
- Runtime DB: Supabase B, project ref aqozjkfwzmyfunqvcyjv.
- Repo Portal NGOÀI worktree này:
  C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\yeubep-shop\student-web
  branch v2/platform-rebuild. One-device login-block + logout server-side
  chạy ở Portal → đổi chính sách session phải lockstep Portal (chỉ đề xuất PR,
  owner tự merge).

BƯỚC 1 — ĐỌC THEO THỨ TỰ (dùng Read):
1. docs/superpowers/specs/2026-07-15-v3-master-plan-design.md  (master plan, đồ thị phase)
2. docs/V3_HANDOFF_TO_OPUS_48.md  (file này — trạng thái + việc còn lại + quy tắc)
3. docs/V3_PHASE_0_RUNTIME_CONTROLLER.md  (Phase 0 đã làm gì)
4. docs/V3_PROPOSAL_7_MIGRATION_TOOL_PLAN.md  (plan chi tiết ⑦ = Phase 1)
5. docs/V3_SCHEMA_GAP_SQL_RESULTS.md + docs/V3_PRODUCTION_SCHEMA_SNAPSHOT.md  (schema B đã verify)
6. docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md §3 (12 đề xuất) + §3.7/§3.8 (nguyên tắc + trạng thái)

BƯỚC 2 — QUY TẮC BẤT DI BẤT DỊCH (mục 4 trong file handoff):
- Migration additive-only cho tới Phase 10. Không DROP/RENAME/ALTER TYPE.
- KHÔNG tự cutover: không set active_mode=v2/v3 trên production. Owner tự flip.
- Không db push/migration repair/INSERT/UPDATE/DELETE lên production nếu không có
  owner action ghi rõ. Các bước chạm production = owner làm.
- Không log secret. Không commit .claude/ .env* scratch/ tests/.supabase-stub.json.
- Không đụng main, tag v1-stable-20260713, repo Portal (chỉ đề xuất PR Portal).
- Mỗi phase: node --test xanh + secret scan sạch + V1 path không đổi + commit + push.
- Auto-advance sang phase kế khi test đạt. Dừng CHỈ ở blocker owner thật (mục 5).

BƯỚC 3 — BẮT ĐẦU Phase 1 (⑦). Xem mục 3 file handoff cho việc cụ thể còn lại.
Trước khi code, invoke skill superpowers:writing-plans để viết plan chi tiết
Phase 1, rồi thực hiện. Dùng TaskList (đã có sẵn 12 task, #11 Phase 1 in_progress).

Test/tooling đã biết chạy được: node --test (đã xanh 159 test), npx supabase@2.109.1
(CLI có qua npx, KHÔNG cài global — supabase db pull/dump cần Docker Desktop = owner).
```

---

## 1. Đã hoàn thành phiên này (Fable 5)

| Commit | Nội dung |
|---|---|
| `a3d3228` | docs(v3): verify production schema catalog gaps — audit + 4 gap RLS/index/constraint/grant VERIFIED |
| `bd894c3` | docs(v3): master plan — runtime-controlled platform ①-⑫ |
| `5cc3dc4` | feat(v3-p0): runtime controller spine — PLATFORM_RUNTIME_MODE |

**Trạng thái repo:** branch `v3/research-20260715` đồng bộ với origin. Tree sạch (chỉ `.claude/` + `supabase/` untracked — cố ý không commit). main + tag V1 nguyên vẹn.

**Test:** `node --test tests/*.test.mjs` — rp1 48, rp2-cors 29, rp2b1 59, rp2b2 9, runtime-controller 14 = **159 pass, 0 fail**.

### Phase 0 đã giao gì (file để đọc, không cần đọc lại code trừ khi sửa):
- `migration_v3_runtime_config.sql` — bảng `platform_runtime_config` (singleton) + `platform_runtime_config_audit`, additive, RLS-on, default `active_mode='v1'`. **Owner action pending: apply trên B** (chưa apply — controller fail-closed về v1 nên hệ thống giống hệt hôm nay).
- `utils/runtime-controller.js` — `getEffectiveMode()` là gate duy nhất (v1/v2/v3), fail-closed v1, kill_switch ép v1, cache ~3s, `stampEvent()`. Không bao giờ ghi.
- `api/v2/runtime.js` — GET/POST flip config, gate bằng `INTERNAL_SYNC_SECRET` (cùng door V2 worker, không secret mới), audit mỗi flip.
- `tests/runtime-controller.test.mjs` — 14 test.
- `docs/V3_PHASE_0_RUNTIME_CONTROLLER.md` — cách flip + rollback + owner step.

---

## 2. Master plan — đồ thị phase (chi tiết trong spec)

```
Phase 0  Runtime controller spine            ✅ DONE (commit 5cc3dc4)
Phase 1  ⑦ Migration tooling + CI drift gate  ◀── BẮT ĐẦU Ở ĐÂY
Phase 2  ① RLS + key tiering + RPC write path
Phase 3  ④ Outbox backbone + ⑤ worker
Phase 4  ② Session unify + ③ server device-id  (Portal lockstep)
Phase 5  ⑥ Router split + edge runtime         (song song 2-4)
Phase 6  ⑪ Observability                        (sau Phase 0)
Phase 7  ⑨ FE modular + diagnostics dashboard
Phase 8  ⑩ TypeScript + monorepo + shared event schema
Phase 9  ⑫ Signed-URL CDN + DRM opt-in
Phase 10 ⑧ Dead code/schema cleanup            (CUỐI, owner duyệt)
```

Critical path: 0 → 1 → 2 → 3 → 4. Task list đã tạo sẵn (#10-#20), #11 (Phase 1) đang in_progress.

---

## 3. Việc còn lại của Phase 1 (⑦) — cụ thể

Plan gốc: `docs/V3_PROPOSAL_7_MIGRATION_TOOL_PLAN.md`. Phần code làm được KHÔNG cần production:

1. **Drift-gate diff engine (testable core, làm trước):**
   - File đề xuất: `supabase/tools/schema-diff.mjs` — hàm thuần: nhận 2 catalog snapshot (JSON: tables/columns/indexes/constraints/RLS/policies/functions/grants), trả diff phân loại FAIL vs WARN, áp `drift_allowlist.json`.
   - Test `tests/schema-diff.test.mjs` (`node --test`): drift cột/constraint/index/RLS/grant = FAIL; thứ tự cột/comment = WARN; allowlist khớp = PASS. Dùng fixture JSON tĩnh (lấy số liệu thật từ `docs/V3_SCHEMA_GAP_SQL_RESULTS.md`), KHÔNG cần DB.
2. **Scaffold Supabase CLI:** `supabase/config.toml` đã có (`project_id`). Thêm `supabase/.gitignore` (bỏ `.env`, `.temp/`, `.branches/`), `supabase/seeds/seed.sql` (tách 2 INSERT `donut`/`banh-mi` từ `supabase_schema.sql` — chỉ preview, KHÔNG production).
3. **`supabase/drift_allowlist.json`** — seed từ 4 gap đã VERIFIED + drift columns đã biết (`is_section`, `materials`, `expected_start_date`, `is_published`, identity columns) + `sync_outbox`/`sync_deliveries` tồn tại nhưng thiếu `sync_dead_letters`. Đây là "hiện trạng production được khai sinh thành baseline".
4. **CI workflow** `.github/workflows/schema-drift-gate.yml` — job: cài supabase CLI pin `2.109.1`, dựng ephemeral PG apply `supabase/migrations/*`, dump EXPECTED, dump ACTUAL từ `SUPABASE_DB_URL_RO` (secret owner tạo), diff qua `schema-diff.mjs`, áp allowlist, WARN vs FAIL. **File hợp lệ về cú pháp + logic; chạy green thật cần owner set secret.**
5. **Docs:** `docs/V3_PHASE_1_MIGRATION_TOOLING.md` (làm gì, cách chạy gate local, owner steps). Cập nhật README đánh dấu `supabase_schema.sql` + `migration_*.sql` là lịch sử tham chiếu.

**Test bar Phase 1 (không cần production):** `node --test tests/schema-diff.test.mjs` xanh + `npx supabase@2.109.1 migration list` không lỗi cú pháp + CI file lint hợp lệ + secret scan sạch + commit/push.

### Owner-only (ghi "pending", KHÔNG chặn auto-advance sang Phase 2):
- Cài **Docker Desktop** → `npx supabase db pull` sinh `supabase/migrations/00000000000000_baseline.sql` (baseline snapshot B).
- `supabase migration repair --status applied 00000000000000_baseline` (ghi 1 row metadata, thao tác DUY NHẤT chạm production ở ⑦).
- Tạo role read-only trên B → set GitHub secret `SUPABASE_DB_URL_RO`.
- Chốt `posts` A/B ownership (GO condition #3 — chưa xong).
- Drill rollback → ghi `docs/V3_PROPOSAL_7_ROLLBACK_DRILL.md`.

> **Lưu ý quan trọng:** Baseline thật (`db pull`) cần Docker = owner. Opus 4.8 làm được toàn bộ engine + scaffold + allowlist + CI file + test bằng số liệu đã verify trong `V3_SCHEMA_GAP_SQL_RESULTS.md`, và ghi baseline placeholder + hướng dẫn owner. KHÔNG tự chạy `db pull`/`db push`/`migration repair`.

---

## 4. Quy tắc bất di bất dịch (kế thừa V2 + yêu cầu owner)

1. **Additive-only** migration cho tới Phase 10. Không DROP/RENAME/ALTER TYPE.
2. **Không tự cutover.** Không set `active_mode=v2/v3` trên production. Owner tự flip qua `api/v2/runtime.js` hoặc SQL Editor.
3. **Không chạm production** (db push, migration repair, INSERT/UPDATE/DELETE) trừ khi là owner action ghi rõ. Các thao tác chạm production = owner.
4. **Coexistence:** mọi code V3 phải để V1/V2/V3 cùng tồn tại. Branch trên `getEffectiveMode()`. Chỉ 1 version ghi authoritative; shadow mode read-only. Data V3 phải additive để rollback V1/V2 không hỏng (compatibility contract).
5. **Version stamping:** mọi event/log/delivery gắn `runtime_version` qua `stampEvent()`.
6. **Không log secret.** Không commit: `.claude/`, `.env*`, `scratch/`, `tests/.supabase-stub.json`, `supabase/config.toml` chỉ commit nếu không secret (hiện chỉ có `project_id` công khai — OK để commit khi Phase 1 bắt đầu dùng nó).
7. **Secret scan trước mỗi commit:** service-role JWT (`eyJ...`), `sbp_`, DB URL có password, access token, private key.
8. **Không đụng** main, tag `v1-stable-20260713`, repo Portal (Portal chỉ đề xuất PR, owner merge).
9. **Test trước:** `node --test`, supabase stub (`LMS_RP2B1_SUPABASE_STUB=1` + `tests/.supabase-stub.json`). Không merge không test.
10. **Portal lockstep** (Phase 4): đổi session/one-device phải đồng bộ Portal.

---

## 5. Khi nào ĐƯỢC dừng để hỏi owner (blocker thật)

CHỈ dừng khi:
- Cần thao tác chạm **production DB** (db pull/push, migration repair, tạo role, apply migration).
- Cần **provider config** (Docker Desktop, Bunny/DRM keys, GitHub secret).
- Cần **merge Portal** repo (Phase 4).
- Cần owner **chốt quyết định** chưa có dữ liệu (vd `posts` A/B ownership).
- Phase 10 cần owner **duyệt final cleanup** (DROP/contract).

KHÔNG dừng vì: phase lớn, "mất nhiều tuần", nhiều file. Auto-advance khi test đạt.

---

## 6. Lệnh hữu ích (đã kiểm chứng phiên này)

```bash
cd "C:/Users/gaomi/Downloads/Telegram Desktop/web-ban-hang-chinh-thuc/web-lms-chinh-thuc/_worktrees/v3-research-20260715"

# Test (đã xanh 159):
for f in tests/*.test.mjs; do node --test "$f" 2>&1 | rg -e 'pass [0-9]+|fail [0-9]+'; done

# Supabase CLI (qua npx, KHÔNG global; db pull/dump cần Docker = owner):
npx supabase@2.109.1 --version    # -> 2.109.1

# Secret scan trước commit (staged):
git diff --cached | rg -n -e 'eyJ[A-Za-z0-9_-]{40,}' -e 'sbp_[A-Za-z0-9]{20,}' \
  -e '(postgres|postgresql)://[^[:space:]]+:[^[:space:]@]+@' -e '-----BEGIN' \
  && echo FAIL || echo PASS

# Verify V1 nguyên vẹn:
git rev-parse refs/heads/main refs/tags/v1-stable-20260713
# main phải = f9220e8128e13e93d803e0c014c39be5819f557c
# tag  phải = bb9a5e46b9d106787f2ef937d95892724da5a814
```

---

## 7. Cạm bẫy đã biết (đừng vấp lại)

- **Node 24 không nhận `a || b ?? c`** (mixing `||` và `??` không ngoặc) — SyntaxError. Ngoặc rõ ràng hoặc tách biến. (Đã vấp ở `runtime-controller.js`, đã sửa.)
- **`tests/.supabase-stub.json`** do test ghi runtime — đã gitignore. Reset về `{}` sau khi chạy test nếu commit gần đó.
- **Test scan allow-list** (`tests/rp2b1-session-device.test.mjs`): nếu thêm chuỗi `V2_GLOBAL_ONE_DEVICE_ENABLED` vào file mới, phải thêm file đó vào `allowed` set trong test, nếu không test fail. (Đã thêm `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md`.)
- **`supabase db pull`/`db dump` cần Docker Desktop** — không có trong môi trường này. Baseline thật = owner.
- **PostgREST vs catalog:** REST expose 22 bảng, catalog có 25 (`spatial_ref_sys`, `sync_outbox`, `sync_deliveries`). `sync_dead_letters` KHÔNG có → outbox apply một phần. Xem `V3_SCHEMA_GAP_SQL_RESULTS.md`.
- **`handle_student_session_login` = SECURITY INVOKER** (không DEFINER) — lệch pattern doc. Phase 2 (①) cần chuẩn hóa.
- **Windows line endings:** git cảnh báo LF→CRLF, vô hại. Không fix.
