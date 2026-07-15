# RP2-B — GLOBAL SESSION & DEVICE GUARD PLAN

> Chỉ khảo sát + kế hoạch. **Chưa sửa mã nguồn. Chưa tạo migration. Chưa commit. Chưa push. Chưa deploy.**
>
> Owner đã chốt chính sách nghiệp vụ (mục 2). Plan này bám chính sách đó, inventory code/schema hiện có, và chia giai đoạn triển khai.

---

## 1. Executive summary

RP2-B khóa **một Gmail học viên = đúng một phiên active toàn hệ thống LMS**, xuyên khóa học, áp dụng cho mọi course khi feature flag `V2_GLOBAL_ONE_DEVICE_ENABLED` bật. Chính sách:

- B không được tạo session khi A còn active; A không bị đá.
- Chuyển thiết bị bình thường = A logout server-side → B login.
- Admin chỉ can thiệp khi học viên mất máy: **revoke A**, không approve B, không auto-login B.
- Enforcement server/DB; frontend chỉ truyền identifier.
- Không quay lại `course_session_token` làm nguồn one-device.
- Tái dụng schema/RPC/helper hiện có; migration chỉ nếu thiếu (expand-only).

**Phát hiện then chốt từ inventory:**

| # | Phát hiện | Ý nghĩa RP2-B |
|---|---|---|
| P0-1 | RPC `handle_student_session_login` **không có caller trong repo LMS**. Caller nằm ở Portal (`student-web`, ngoài worktree). | Global one-device login decision **không nằm trong LMS**. Cần xác minh Portal + có thể bổ sung enforcement phía LMS. |
| P0-2 | `course-data` / `lesson` chỉ bắt buộc LMS verified session khi `isEntryTokenRequiredCourse(slug)` (ENV `LMS_ENTRY_TOKEN_REQUIRED_COURSES`). Course ngoài list → chỉ cần cookie JWT `course_session_token`. | One-device hiện **không global**. Flag V2 phải bỏ gate ENV này. |
| P0-3 | **Không có endpoint logout học viên** trong LMS. Helper `markStudentSessionLoggedOut` / event `LOGOUT` tồn tại nhưng **không có route gọi**. | Logout hiện tại gần như client-only. Cần endpoint server-side. |
| P0-4 | Admin revoke **đã có**: `admin-account-sharing-alerts` action `reset_session` → `resetStudentSessionByEmail` → RPC `reset_student_session_guard` (status `admin_reset`). | Có thể tái dụng; cần siết reason bắt buộc + error contract + idempotency UX. |
| P0-5 | `createStudentActiveSession` (JS insert trực tiếp) **không có caller**. Schema + RPC atomic đã có unique partial index 1 active/email. | Schema đủ cho 1 active/email; thiếu caller + logout + global enforce. |
| P1-1 | `lms_verified_sessions` gắn `course_slug` (1 LMS session / course). `student_active_sessions` global theo email. | One-device đúng layer là **student_active_sessions** (global). LMS session vẫn per-course. |
| P1-2 | TTL mặc định 24h idle (`STUDENT_SESSION_IDLE_HOURS` / `LMS_SESSION_IDLE_HOURS`). Lazy expire on access, không background job. | Cần chốt TTL + touch path; chưa cần heartbeat nếu course-data/lesson touch đủ. |
| P1-3 | `exchange-code` không đụng session guard / entry token / one-device. | Bypass path: login trực tiếp LMS bằng Google code → cookie JWT, bỏ qua Portal RPC. |
| P1-4 | Status enum hiện có: `active / logged_out / expired / admin_reset / superseded`. **Không có** `revoked_by_admin`. | Dùng `admin_reset` + `logged_out` là đủ; không bắt buộc status mới. |

---

## 2. Chính sách owner đã chốt

1. Mỗi Gmail học viên = đúng **1** phiên active toàn LMS.
2. Xuyên khóa học; không per-course active; chỉ học viên; admin không bị one-device.
3. Chuyển thiết bị bình thường: A logout server-side → revoke DB → client clear → B login tạo active mới. Không admin approve.
4. B login khi A active → **block** (không create, không supersede, không đá A). HTTP 409/423, code `device_active_elsewhere`.
5. Response block **không** lộ IP/device fingerprint/device ID/session ID/loại TB/vị trí A.
6. Block có thể ghi event an toàn (telemetry best-effort, idempotent). Telemetry **không** quyết định access.
7. Admin can thiệp chỉ khi mất máy / session treo / không logout được: **thu hồi A**.
8. Admin revoke: status `admin_reset` (hoặc tương đương), actor + reason + audit, idempotent, **không** tạo session B.
9. Sau admin revoke: học viên **tự** login B.
10. Nếu admin không revoke → B vẫn block, A vẫn active.
11. Logout học viên = server-side revoke; client clear sau server OK; idempotent; fail server → không giả vờ thành công.
12. Đóng tab/trình duyệt/tắt máy **không** logout → A vẫn active → B vẫn block cho tới logout / TTL / admin revoke.
13. TTL hợp lý; touch `last_seen` qua request học hợp lệ; chưa cần heartbeat riêng nếu request hiện tại đủ.
14. Cùng thiết bị A login lại → reuse/refresh; không tạo nhiều active trùng Gmail+device; idempotent.
15. Multi-course cùng A được phép; multi-device bị chặn.
16. Không dùng `course_session_token` làm nguồn one-device.
17. Client source = `lms_verified_session` / session ID server đã verify.
18. Enforcement server/DB; frontend chỉ truyền ID.
19. Course **ngoài** `LMS_ENTRY_TOKEN_REQUIRED_COURSES` vẫn enforce khi flag V2 bật.
20. Không dùng course list để quyết định course nào được bảo vệ.
21. Tái dụng `utils/lms-session-guard.js`, bảng/RPC hiện có.
22–25. Migration chỉ additive; V1 đọc được; rollback V2 không cần migration đảo.
26. Số phiên cố định = 1. **Không** cần `LMS_MAX_CONCURRENT_SESSIONS`.
27. Feature flag: `V2_GLOBAL_ONE_DEVICE_ENABLED`. Fail-closed khi bật + DB/RPC lỗi. Tắt → compatibility; không xóa data.

---

## 3. Baseline và branch

| Mục | Giá trị |
|---|---|
| Worktree | `_worktrees/v2-rebuild-20260714` |
| Feature branch | `feat/v2-rp2b-session-device-guard` |
| Integration base | `v2/rebuild-20260714` |
| Baseline SHA | `3f329c9cc3344b803d7b4c271966e6fcda676d17` (RP2-A đã FF vào integration) |
| Parent RP2-A | `8a65ae6e304c1700d34d2a7b2bc77b7b99461050` |
| V1 baseline bất biến | `f9220e8128e13e93d803e0c014c39be5819f557c` + tag `v1-stable-20260713` |
| Preflight | Branch đúng, HEAD = baseline, working tree sạch, integration local=remote |

---

## 4. Phạm vi

- Khảo sát + plan RP2-B (file này).
- Các giai đoạn triển khai sau khi owner duyệt: global block policy, server-side logout, admin lost-device revoke polish, tests/observability/rollout.
- Feature flag `V2_GLOBAL_ONE_DEVICE_ENABLED`.
- Error contract chuẩn.
- Tái dụng helper/schema/RPC hiện có.

## 5. Ngoài phạm vi

- Sửa `utils/cors.js` (RP2-A chốt).
- Sửa `utils/lms-secrets.js` (RP-1 chốt).
- RP2-C frontend Portal/LMS UI (ngoài plan này; chỉ ghi dependency).
- RP2-D rollout ENV production / cutover.
- Migration destructive / đổi type / drop / rename.
- Admin approve device B / pending approval flow.
- Auto-kick A / supersede-by-default.
- Heartbeat endpoint (chỉ nếu chứng minh cần).
- Sửa main / tag V1 / branch cũ / force-push / deploy / production call.
- Portal repo (`student-web`) — **ngoài worktree**; chỉ inventory dependency, không sửa trong lượt này.

---

## 6. Inventory file / route

### 6.1 Bảng inventory (LMS repo)

| FILE | HÀM/ROUTE | INPUT | OUTPUT | DB/RPC | SESSION CHECK | DEVICE CHECK | COURSE CHECK | LOGOUT/REVOKE | BYPASS/RỦI RO |
|---|---|---|---|---|---|---|---|---|---|
| `utils/lms-session-guard.js` | `createStudentActiveSession` | email, portalDeviceId, … | insert row | `student_active_sessions` insert | — | portal_device_id required | — | — | **Không caller** |
| `utils/lms-session-guard.js` | `getActiveStudentSessionByEmail` | email | 1 active row | select active by email | email | — | — | — | Không caller |
| `utils/lms-session-guard.js` | `touchStudentSession` | studentSessionId | update last_seen | update active | by id | — | — | — | Gọi từ verify-entry-token + verify access |
| `utils/lms-session-guard.js` | `expireStaleStudentSessions` | idleHours | bulk expire | update active→expired | idle | — | — | expire | **Không caller** (lazy path dùng isOlderThan) |
| `utils/lms-session-guard.js` | `markStudentSessionLoggedOut` | studentSessionId | status logged_out | update | by id | — | — | logout helper | **Không route gọi** |
| `utils/lms-session-guard.js` | `resetStudentSessionByEmail` | email, adminEmail, reason | counts | RPC `reset_student_session_guard` + fallback | email | — | — | admin revoke | Có caller admin |
| `utils/lms-session-guard.js` | `createLmsEntryToken` | email, studentSessionId, portalDeviceId, courseSlug | rawToken + row | `lms_entry_tokens` | — | portal_device_id | course_slug | — | **Không caller LMS** (Portal tạo token) |
| `utils/lms-session-guard.js` | `verifyLmsEntryToken` / `markLmsEntryTokenUsed` | rawToken / id | ok/reason | entry tokens | control revoke | — | — | revoke path | Dùng verify-entry-token |
| `utils/lms-session-guard.js` | `createLmsVerifiedSession` | email, studentSessionId, lmsDeviceId, courseSlug | row | `lms_verified_sessions` | — | lms_device_id | course_slug | — | Caller: verify-entry-token |
| `utils/lms-session-guard.js` | `verifyLmsVerifiedSessionAccess` | lmsSessionId, lmsDeviceId, courseSlug? | ok/reason | lms + student + enrollment | full | device match | optional course match | lazy expire / admin_reset via control | Caller: course-data, lesson |
| `utils/lms-session-guard.js` | `isEntryTokenRequiredCourse` | courseSlug | bool | ENV list | — | — | **ENV gate** | — | **P0 bypass** khi list rỗng/không chứa slug |
| `utils/lms-session-guard.js` | `logStudentDeviceEvent` | event payload | best-effort | `student_device_change_logs` | — | hashes | — | — | Telemetry only; idempotency key |
| `utils/lms-session-guard.js` | `writeAdminAuditLog` | admin action | best-effort | `admin_audit_logs` | — | — | — | — | Best-effort |
| `utils/lms-handlers/verify-entry-token.js` | POST portal `verify-entry-token` | entry_token, lms_device_id | lms_session_id | entry + student_active + enroll + create LMS session | student active + 24h stale | lms_device_id required | enrollment | touch student | Không check “B vs A device” ở đây (đã ở Portal login) |
| `utils/lms-handlers/course-data.js` | POST portal `course-data` | credential / sessionToken / course + headers X-LMS-* | lessons + cookie JWT | enroll + courses + lessons | optional LMS verify; JWT cookie; Google credential | only if headers present | ENV entry-token list | no logout | **Bypass one-device** nếu course không trong ENV list |
| `utils/lms-handlers/lesson.js` | GET portal `lesson` | id + cookie + X-LMS-* | lesson | lessons + enroll | same pattern as course-data | headers | ENV list + course match LMS session | no logout | Same bypass |
| `utils/lms-handlers/exchange-code.js` | POST (route? qua portal/admin?) | Google code | cookie JWT + lessons | enroll | **không** LMS session | **không** | enrollment only | no | **Bypass hoàn toàn** session guard |
| `utils/lms-handlers/admin-account-sharing-alerts.js` | GET/POST admin `account-sharing-alerts` | list/detail/actions | alerts / reset | risk tables + sessions | admin auth | — | — | `reset_session` | Reason hardcode `account_sharing_admin_reset`; không bắt buộc free-text reason từ admin body |
| `utils/lms.js` | `createStudentSession` / `verifyStudentSession` | email / token | JWT cookie | — | HMAC secret (RP-1) | — | — | — | Cookie **không** phải source of truth one-device |
| `api/lms/portal.js` | router | endpoint query | dispatch | — | — | — | — | — | Endpoints: course-data, lesson, public-*, verify-entry-token |
| `api/lms/admin.js` | router | endpoint query | dispatch | — | admin | — | — | — | account-sharing-alerts included |
| `migration_student_session_guard.sql` | schema base | — | tables | student_active_sessions, lms_entry_tokens, lms_verified_sessions | status enums | portal/lms device ids | course on LMS session | — | Có |
| `migration_atomic_session_guard.sql` | unique + RPC | — | index + RPC | `idx_one_active_student_session_per_email`, `handle_student_session_login` | advisory lock | portal_device_id compare | — | supersede/block/expire | **RPC no LMS caller** |
| `migration_account_sharing_*.sql` | telemetry + admin | — | tables + reset RPC | device logs, reviews, notes, audits, session_controls, reset_student_session_guard | generation revoke | hashes | — | admin_reset | Có |

### 6.2 Portal repo (ngoài worktree — dependency)

- Tạo `portal_device_id`, gọi RPC `handle_student_session_login` (policy mặc định SQL = `block`).
- Tạo entry token (gọi LMS helper hoặc insert tương đương — **chưa xác minh source**).
- Redirect LMS `lms.html?entry_token=` / `#entry_token=`.
- Logout client-side (localStorage/cookie) — **chưa xác minh** có gọi LMS revoke hay không.
- **Bắt buộc xác minh production** trước khi implement RP2-B1.

---

## 7. Luồng đăng nhập A hiện tại

```
[Portal] Google login Gmail A
  → (dự kiến) RPC handle_student_session_login(email, portal_device_id, new_student_session_id, policy=block, idle=24h)
     - advisory lock email
     - nếu active khác device → return {ok:false, action:blocked, reason:active_session_on_another_device}
     - nếu same device → reuse + touch last_seen
     - nếu stale > idle → expire cũ + create mới
     - nếu không active → create active
  → (dự kiến) createLmsEntryToken(email, student_session_id, portal_device_id, course_slug)
  → redirect LMS lms.html?entry_token=...

[LMS] POST verify-entry-token {entry_token, lms_device_id}
  → verifyLmsEntryToken (hash, active, not expired, not revoked by control)
  → load student_active_sessions (status=active, email match)
  → stale 24h hardcode → expire + 401 student_session_expired
  → enrollment active
  → createLmsVerifiedSession (lms_session_id, lms_device_id, course_slug)
  → mark entry used + touch student + telemetry
  → return {ok, lms_session_id}

[LMS client] store lms_session_id + lms_device_id (localStorage)
  → POST course-data / GET lesson với headers X-LMS-Session-Id / X-LMS-Device-Id
  → verifyLmsVerifiedSessionAccess (device match, idle, student active, enrollment, touch both)
  → (song song) cookie course_session_token JWT 30d vẫn được set/refresh
```

**Bước chưa tồn tại / chưa xác minh trong LMS:** Portal login RPC call site; Portal logout; global enforce ngoài ENV list.

---

## 8. Luồng đăng nhập lại cùng A

- Same `portal_device_id` + active session → RPC reuse (SQL path `reused`).
- Same LMS device + valid lms_session → verify access OK + touch.
- Cookie JWT có thể refresh độc lập (không đụng one-device).
- **Rủi ro:** nếu client mất `lms_device_id` nhưng còn cookie JWT + course không trong ENV list → vẫn vào được (bypass).

---

## 9. Luồng B khi A active

**Thiết kế SQL (đã có):**

```
handle_student_session_login(..., p_conflict_policy='block')
  → existing active, different portal_device_id, not stale
  → RETURN {ok:false, action:'blocked', reason:'active_session_on_another_device', student_session_id, portal_device_id, last_seen_at}
  → KHÔNG insert B, KHÔNG supersede A
```

**Thực tế caller:** Portal (ngoài repo). LMS không gọi.

**LMS path hiện tại khi B cố vào lớp:**
- Nếu B không có entry token hợp lệ gắn student session A → verify-entry-token fail.
- Nếu B có cookie JWT + course không protected → **có thể vào** (P0 bypass).
- Telemetry event type `login_blocked_other_device` đã định nghĩa; Portal phải ghi (chưa xác minh).

**Mục tiêu RP2-B:**

```
A active
→ B login (Portal RPC block) HOẶC B hit LMS protected route
→ không create active B
→ A không đổi
→ 409/423 device_active_elsewhere (message owner)
→ 1 event an toàn (idempotent)
→ không pending approval
```

---

## 10. Luồng logout A

**Hiện tại:**

| Lớp | Có? | Ghi chú |
|---|---|---|
| Endpoint LMS logout | **Không** | Không route |
| Helper `markStudentSessionLoggedOut` | Có | Không caller |
| `revokeLmsSessionsByStudentSession` | Có | Dùng trong admin reset fallback |
| Event type `LOGOUT` | Có | Không caller |
| Cookie clear | Client-only (dự kiến) | Không server Set-Cookie clear |
| localStorage clear | Client-only | — |
| CSRF | Không cho logout | Cần thiết kế |
| Idempotency | N/A | Chưa có route |

**Mục tiêu:**

```
POST /api/lms/portal?endpoint=logout (hoặc tên tương đương)
  headers: X-LMS-Session-Id, X-LMS-Device-Id (và/hoặc student_session_id + portal_device_id)
  → verify ownership (session id + device + email match)
  → mark student_active_sessions → logged_out (chỉ row đó, status=active)
  → revoke lms_verified_sessions active của student_session_id → logged_out
  → revoke entry tokens active → revoked
  → telemetry LOGOUT (idempotent key)
  → response {success:true, status:"logged_out"|"already_logged_out"}
  → client clear cookie/localStorage CHỈ sau 2xx
  → request tiếp theo A → session_revoked / invalid
```

**Không** reuse nguyên `reset_student_session_guard` cho logout thường (RPC đó set `admin_reset` + bump `sessions_revoked_before` + audit admin). Logout học viên dùng status `logged_out` + helper riêng (có thể RPC mới `logout_student_session` hoặc update an toàn có advisory lock).

---

## 11. Luồng admin revoke A

**Hiện có:**

```
Admin UI account-sharing → POST action=reset_session {email}
  → resetStudentSessionByEmail(email, adminEmail, reason="account_sharing_admin_reset")
  → RPC reset_student_session_guard:
       advisory lock
       upsert student_session_controls (generation++, sessions_revoked_before=now)
       active student sessions → admin_reset
       related entry tokens → revoked
       related lms sessions → admin_reset
       admin_audit_logs insert
  → fallback JS nếu RPC missing
  → upsert review status monitoring
  → audit writeAdminAuditLog account_sharing_reset_session
```

**Gap so với owner policy:**

| Yêu cầu | Hiện tại | Cần |
|---|---|---|
| Reason bắt buộc free-text | Hardcode | Body `reason` required non-empty |
| Ghi chú xác minh | Không field riêng | Có thể dùng note + reason |
| Không tạo session B | Đúng | Giữ |
| Idempotent double-click | RPC vẫn OK (0 rows) | Trả status rõ `already_revoked` |
| Error contract A sau revoke | `lms_session_admin_reset` / `student_session_admin_reset` / control revoke | Map → `session_revoked` |
| Status `revoked_by_admin` | Không có; dùng `admin_reset` | **Không cần migration status mới** |

---

## 12. Bypass hiện tại

1. **ENV gate** `LMS_ENTRY_TOKEN_REQUIRED_COURSES`: course ngoài list → cookie JWT đủ.
2. **ENV rỗng** → mọi course bypass entry-token path.
3. **`exchange-code`**: Google OAuth code → cookie JWT, không session guard.
4. **`course-data` credential path**: Google id_token trực tiếp khi không có LMS headers.
5. **Cookie JWT 30 ngày** (`SESSION_DAYS`) sống lâu hơn idle 24h của student/lms session.
6. **Public endpoints** (`public-config`, `public-lesson`): không auth — ngoài one-device (đúng thiết kế public).
7. **Portal RPC policy**: nếu Portal lỡ truyền `supersede` → đá A (trái owner). Cần xác minh Portal luôn `block`.
8. **JS `createStudentActiveSession` insert** nếu ai đó gọi sau này → race với unique index (23505) nhưng không có advisory lock — hiện không caller.

---

## 13. Session source of truth

| Layer | Bảng / token | Scope | Vai trò RP2-B |
|---|---|---|---|
| **Primary one-device** | `student_active_sessions` | **Global per email** (unique partial index active) | Quyết định 1 active device |
| LMS verified | `lms_verified_sessions` | Per email + course + lms_device_id | Access lesson/course sau entry |
| Entry token | `lms_entry_tokens` | One-time bridge Portal→LMS | Không phải long-lived session |
| Control generation | `student_session_controls` | Per email | Admin bulk revoke watermark |
| Cookie JWT | `course_session_token` | Client cookie, 30d | **Legacy identity only** — không one-device |
| Portal device | `portal_device_id` trên student session | Device key Portal | So khớp RPC login |
| LMS device | `lms_device_id` trên LMS session | Device key LMS client | So khớp verify access |

**Kết luận:** Source of truth one-device = **`student_active_sessions` (status=active, 1 row/email)**.
Source of truth access LMS content sau entry = **`lms_verified_sessions` + headers**.
**Không** dùng `course_session_token` cho one-device.

---

## 14. Device source of truth

| ID | Sinh ở | Lưu | So khớp |
|---|---|---|---|
| `portal_device_id` | Portal client | `student_active_sessions.portal_device_id` | RPC login same-device reuse vs block |
| `lms_device_id` | LMS client (`generateClientId("lmsdev")` theo report) | `lms_verified_sessions.lms_device_id` + header `X-LMS-Device-Id` | `verifyLmsVerifiedSessionAccess` |
| `device_hash` / `device_label` | Portal (hash) | student session + logs | Telemetry; không quyết định access |
| `ip_hash` | HMAC (RP-1) | logs | Telemetry only |

Device B ≠ A được phát hiện ở **portal_device_id** (login) và/hoặc **lms_device_id** (access).

---

## 15. Schema / RPC inventory

### Có migration + caller LMS

- `student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions` — verify-entry-token, verify access, admin detail.
- `student_device_change_logs` — logStudentDeviceEvent.
- `admin_audit_logs` — writeAdminAuditLog + RPC reset.
- `student_account_risk_reviews` / `notes` / `summaries` — admin alerts.
- `student_session_controls` — reset RPC + isRevokedBySessionControl.
- RPC `reset_student_session_guard` — admin reset.
- RPC `cleanup_student_account_risk_events` — admin cleanup.

### Có migration, **không** caller LMS

- RPC `handle_student_session_login` — **Portal only** (chưa xác minh runtime).
- Unique index `idx_one_active_student_session_per_email`.
- Columns `device_hash`, `device_label`, `ip_hash` trên student sessions.

### Có helper JS, không route

- `createStudentActiveSession`, `markStudentSessionLoggedOut`, `expireStaleStudentSessions`, `createLmsEntryToken`.

### Schema đủ cho RP2-B?

| Nhu cầu | Đủ? | Ghi chú |
|---|---|---|
| 1 active/email | **Có** | Unique partial index |
| Block without supersede | **Có** | RPC policy `block` |
| Admin revoke | **Có** | `admin_reset` + control |
| Logout student | **Helper có, route không** | Có thể không cần migration nếu update status `logged_out` an toàn |
| Status `revoked_by_admin` | **Không cần** | Dùng `admin_reset` |
| Reason bắt buộc admin | App-level | Không cần cột mới nếu audit metadata đủ |
| TTL columns | **Có** | `last_seen_at`, idle hours ENV |
| Idempotency events | **Có** | `event_idempotency_key` unique partial |

### Migration additive dự kiến (chỉ nếu owner duyệt sau survey production)

| # | Thay đổi | Bắt buộc? | Lý do |
|---|---|---|---|
| M1 | RPC `logout_student_session(p_email, p_student_session_id, p_portal_device_id|p_lms_device_id)` | **Nên có** | Atomic logout + ownership check + advisory lock |
| M2 | Status mới `revoked_by_admin` | **Không** | `admin_reset` đủ |
| M3 | Cột reason trên student session | **Không bắt buộc** | Audit log đủ |
| M4 | Background expire job | RP2-B2 optional | Lazy expire đã có |

Mọi migration: expand-only, nullable/default an toàn, không drop/rename/type change, V1 bỏ qua được.

---

## 16. Race-condition analysis

| Scenario | Cơ chế hiện có | Gap |
|---|---|---|
| A và B login đồng thời | RPC `pg_advisory_xact_lock(hashtext(email))` + unique index | Chỉ hiệu lực nếu **cả hai** đi qua RPC |
| B retry spam | Unique index chặn 2 active; event idempotency key | Portal phải gửi key ổn định |
| Double admin reset | RPC lock + update active only | OK; cần response `already_revoked` |
| Logout + login B song song | Chưa có logout RPC | Cần lock email trên logout |
| Insert JS bỏ RPC | Unique index → 23505 | Không caller; cấm thêm caller insert |
| Lazy expire vs touch | verify path expire if stale then reject | Race nhỏ: 2 request cùng lúc có thể double-update status — harmless |

---

## 17. Global cross-course behavior

| Case | Mong muốn | Hiện tại |
|---|---|---|
| A học khóa 1 trên TB A | OK | OK nếu entry path hoặc cookie |
| A học khóa 2 trên cùng TB A | OK (global session) | Student session global; LMS session **mới per course** qua entry token mới |
| A học khóa 2 trên TB B khi A active | Block | Block chỉ nếu Portal RPC + course protected |
| 2 LMS verified sessions (2 course) cùng student_session | Cho phép | Schema cho phép nhiều `lms_verified_sessions` active cùng `student_session_id` khác `course_slug` |
| Unique index per email | 1 student active | Có |

**Thiết kế giữ:** 1 `student_active_sessions` active; N `lms_verified_sessions` active (mỗi course) **cùng** student_session + device chain. Khi logout/admin reset → revoke all LMS sessions của student_session.

---

## 18. New-device block behavior

```
A active (student_active_sessions)
→ B login
→ RPC block (Portal) và/hoặc LMS reject nếu flag bật
→ HTTP 409 Conflict (ưu tiên) hoặc 423 Locked
→ body:
  {
    "success": false,
    "error": "device_active_elsewhere",
    "message": "Tài khoản đang được sử dụng trên thiết bị khác. Vui lòng đăng xuất khỏi thiết bị đang học trước, sau đó đăng nhập lại trên thiết bị này. Nếu bạn không còn sử dụng được thiết bị cũ, hãy liên hệ quản trị viên để được hỗ trợ."
  }
→ KHÔNG: IP, device fingerprint, device id, session id, loại TB A, vị trí
→ Event: login_blocked_other_device, idempotency_key = f(email, day-bucket hoặc flow_id)
→ A không đổi
```

Map RPC reason `active_session_on_another_device` → error code `device_active_elsewhere`.

---

## 19. Server-side logout design

### Route (đề xuất)

`POST /api/lms/portal?endpoint=logout` (thêm vào `api/lms/portal.js`)

### Auth input

- Ưu tiên: `X-LMS-Session-Id` + `X-LMS-Device-Id` → resolve email + student_session_id.
- Fallback: body `{ student_session_id, portal_device_id }` nếu logout từ Portal trước khi có LMS session.
- **Không** chấp nhận chỉ email (tránh logout chéo).

### Server steps

1. Resolve session row; nếu không active → `{success:true, status:"already_logged_out"}`.
2. Verify device ownership match.
3. Transaction/RPC: student → `logged_out`; LMS sessions → `logged_out`; entry tokens → `revoked`.
4. Telemetry `LOGOUT` best-effort.
5. Optional: `Set-Cookie course_session_token=; Max-Age=0`.
6. Fail DB → 503 `logout_failed`; client **không** clear local state.

### CSRF / same-origin

- CORS portal mode (RP2-A) + require custom header (`X-LMS-Session-Id`) chặn pure form CSRF.
- Khi flag CORS allowlist bật: chỉ origin portal.

---

## 20. Admin lost-device revoke design

### Tái dụng

- Endpoint hiện có: `account-sharing-alerts` `action=reset_session`.
- RPC `reset_student_session_guard`.

### Siết thêm (RP2-B3)

1. Body bắt buộc `reason` (min length, trim).
2. Optional `note` → `student_account_admin_notes`.
3. Response:
   - `{success:true, status:"revoked", studentSessions:N, ...}`
   - `{success:true, status:"already_revoked", studentSessions:0}` khi không còn active.
4. Map error cho client A: `session_revoked`.
5. **Không** tạo session B; **không** auto-login.
6. UI copy: “Thu hồi thiết bị cũ — học viên phải đăng nhập lại trên thiết bị mới”.
7. Không thiết kế admin approve B.

### Có cần endpoint mới?

- **Không bắt buộc** nếu mở rộng `reset_session` đủ reason + response.
- Endpoint alias `revoke_device` có thể thêm cho rõ nghĩa (thin wrapper).

---

## 21. Error contract

| error | HTTP | Khi nào |
|---|---|---|
| `device_active_elsewhere` | 409 (ưu tiên) / 423 | B bị block vì A active |
| `session_revoked` | 401/403 | A bị admin_reset / control revoke / logged_out |
| `session_expired` | 401 | Idle TTL vượt |
| `session_replaced` | 401 | status `superseded` (legacy path; V2 flag-on không supersede) |
| `device_mismatch` | 401/403 | lms_device_id ≠ session |
| `invalid_session` | 401 | missing/unknown session id |
| `one_device_policy_unavailable` | 503 | flag on + DB/RPC fail (fail-closed) |
| `logout_failed` | 503 | logout DB error |
| `config_missing` | 503 | secret/config (RP-1 style) |
| `already_logged_out` | 200 | logout idempotent |
| `logged_out` | 200 | logout success |

Response logout success:

```json
{ "success": true, "status": "logged_out" }
```

```json
{ "success": true, "status": "already_logged_out" }
```

**Cấm** trong body: IP đầy đủ, device fingerprint, device/session id của A, user agent A, geo.

---

## 22. Feature flag

### `V2_GLOBAL_ONE_DEVICE_ENABLED`

Parse giống RP2-A: `1|true|yes|on` (case-insensitive).

### Khi bật

- Mọi course student path enforce one-device / LMS verified session (hoặc student active session tương đương) — **không** đọc `LMS_ENTRY_TOKEN_REQUIRED_COURSES` để bypass.
- Login decision fail-closed nếu RPC/DB lỗi.
- Logout fail-closed (không fake success).
- Access `course-data`/`lesson`: thiếu/invalid LMS session → reject (không fallback cookie-only cho identity+access gộp).
- Admin routes **không** bị one-device.
- Telemetry best-effort.

### Khi tắt

- Compatibility V1: ENV list gate như hiện tại; cookie JWT path giữ.
- Không xóa session/audit/event.
- Rollback không migration đảo.

### Route đọc flag (dự kiến)

| Route | Flag effect |
|---|---|
| Portal login (Portal repo) | Bắt buộc policy block; fail-closed |
| `verify-entry-token` | Siết ownership; map errors |
| `course-data` | Bỏ ENV bypass khi flag on |
| `lesson` | Bỏ ENV bypass khi flag on |
| `logout` (mới) | Always server-side khi có; flag không tắt revoke |
| `exchange-code` | Flag on: reject hoặc force entry path (P0 quyết định owner) |
| Admin routes | Không enforce student one-device |

### `exchange-code` decision (open question P0)

Option A: flag on → `exchange-code` từ chối student login, bắt Portal entry.
Option B: flag on → `exchange-code` tạo/reuse student session qua RPC block.
**Khuyến nghị:** Option A (đơn giản, một cửa Portal) — cần owner chốt.

---

## 23. Fail-closed behavior

| Bước | Flag on + l���i DB/RPC | Flag off |
|---|---|---|
| Login RPC | 503 `one_device_policy_unavailable` | Compatibility / Portal behavior cũ |
| verify access | 503 hoặc 401 an toàn — **không** cho cookie-only fallback | Cookie fallback giữ |
| Logout | 503 `logout_failed`; client giữ state | N/A (chưa có) |
| Admin reset | 500 + không partial silent | Giữ |
| Telemetry insert fail | Log warn; **không** đổi quyết định access | Giữ |

---

## 24. Telemetry separation

- Enforcement: `student_active_sessions` + RPC + verify access.
- Telemetry: `student_device_change_logs` + risk summaries — **best-effort**, idempotent.
- Risk score **không** block login.
- Event block: `login_blocked_other_device` (points 25) — chỉ cảnh báo admin.
- Hash HMAC (RP-1); thiếu secret → null hash + flag metadata, không chặn access (telemetry path).

---

## 25. Entry-token relationship

```
Portal login (one-device gate @ student_active_sessions)
  → entry token (short TTL 30m, one-time)
  → LMS verify-entry-token
  → lms_verified_sessions (per course)
  → headers access
```

- Entry token **không** thay one-device; chỉ bridge.
- Flag V2 on: entry path (hoặc tương đương verified session) **bắt buộc** cho mọi course protected content.
- `LMS_ENTRY_TOKEN_REQUIRED_COURSES` trở thành legacy khi flag on (có thể giữ để tương thích flag off).

---

## 26. TTL và last_seen

### Hiện tại

| Tham số | Default | ENV |
|---|---|---|
| Student idle | **24h** | `STUDENT_SESSION_IDLE_HOURS` |
| LMS idle | **24h** | `LMS_SESSION_IDLE_HOURS` |
| Entry token TTL | 30 phút | `LMS_ENTRY_TOKEN_TTL_MINUTES` |
| Cookie JWT | 30 ngày | `SESSION_DAYS` |
| Expire mode | Lazy on access | Không background job |
| Touch | `verifyLmsVerifiedSessionAccess` + `verify-entry-token` | course-data/lesson khi headers OK |

### Phân tích phương án

| TTL | Ưu | Nhược | False positive |
|---|---|---|---|
| 30 phút | Giải phóng TB nhanh nếu quên logout | Xem video dài / nghỉ ngắn → bị out; B vào sớm | Cao nếu học >30p không API |
| 2 giờ | Cân bằng hơn 30p | Video rất dài / ngủ trưa ngắn vẫn có thể out | Trung bình |
| 8 giờ | Gần 1 ngày học | Máy quên logout giữ slot lâu | Thấp |
| **24 giờ (hiện tại)** | Ít out khi đang học; đã ship | Máy mất / quên logout → B chờ tới 24h hoặc admin | Thấp nhất cho learner UX |

### Đề xuất ban đầu (có cơ sở)

- **Giữ idle 24h** cho `STUDENT_SESSION_IDLE_HOURS` và `LMS_SESSION_IDLE_HOURS` ở phase đầu RP2-B.
- Lý do: (1) đã là default production-shaped; (2) owner ưu tiên không out giữa chừng; (3) admin revoke cover mất máy; (4) touch qua course-data/lesson đủ cho phiên học chủ động.
- **Không** thêm heartbeat phase 1.
- **Heartbeat chỉ khi** đo được: learner xem video >X giờ **không** gọi API nào mà vẫn cần giữ session — hiện Bunny embed không hit LMS API → với TTL 24h vẫn an toàn hơn 30p/2h.
- Touch interval: mỗi request `course-data`/`lesson` thành công đã touch; không throttle bắt buộc phase 1.
- Sau đóng trình duyệt: session vẫn active tới logout/TTL/admin (đúng owner §12).
- B được login khi: A logout **hoặc** last_seen stale > idle **hoặc** admin revoke.
- Cookie JWT 30d **không** gia hạn one-device; flag on không dùng cookie để vượt TTL student session.

### Rollback TTL

- Chỉ đổi ENV idle hours; không migration.

---

## 27. Admin exclusion

- Admin auth: `admin_session_token` + `ADMIN_EMAILS` — tách biệt hoàn toàn.
- One-device **không** áp dụng admin.
- Admin reset học viên không ảnh hưởng admin session.
- `getAdminFromRequest` không đọc student session tables cho auth.

---

## 28. Compatibility với V1

- Flag off = behavior V1 (ENV gate + cookie paths).
- Schema additive only → V1 đọc được cột/status cũ.
- Status enum hiện có giữ nguyên.
- RPC mới (logout) GRANT service_role; V1 không gọi → no-op.
- Rollback V2: tắt flag; không migration đảo; session rows giữ.

---

## 29. Migration strategy

1. **Ưu tiên zero-migration** nếu logout implement bằng helper JS + status `logged_out` hiện có (kém atomic hơn RPC).
2. **Khuyến nghị** 1 migration additive: RPC `logout_student_session` (advisory lock, ownership, cascade revoke).
3. Không thêm status enum value trừ khi production constraint chặn (hiện CHECK đã có `logged_out`, `admin_reset`).
4. Không đụng unique index / RPC login hiện có trừ khi cần fix bug production (xác minh trước).
5. Mọi SQL: `IF NOT EXISTS` / `CREATE OR REPLACE`, idempotent, expand-only.

---

## 30. Rollback strategy

1. Tắt `V2_GLOBAL_ONE_DEVICE_ENABLED` → compatibility.
2. Giữ data/session/audit.
3. Revert code commit(s) RP2-B nếu cần; DB rows/RPC mới để im.
4. Không migration đảo.
5. V1/main/tag không đụng.

---

## 31. Test matrix

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Gmail A login TB1 | active |
| 2 | A login lại TB1 | reuse/idempotent |
| 3 | A login TB2 khi A active | `device_active_elsewhere` |
| 4 | B không tạo active | DB count active=1 (A) |
| 5 | A vẫn hoạt động sau B block | A verify OK |
| 6 | Retry B | không duplicate session/event |
| 7 | A học khóa khác trên A | OK |
| 8 | A học khóa khác trên B | block |
| 9 | Course ngoài ENV list + flag on | enforce |
| 10 | ENV list rỗng + flag on | enforce |
| 11 | Gmail khác | độc lập |
| 12 | Session đúng / device sai | device_mismatch |
| 13 | Device đúng / session sai | invalid_session |
| 14 | A logout server | logged_out + cascade |
| 15 | A logout 2 lần | already_logged_out |
| 16 | Chỉ xóa localStorage | A server vẫn active; B block |
| 17 | B login sau A logout | active B |
| 18 | Admin revoke A mất máy | admin_reset |
| 19 | Admin revoke không tạo B | no new active |
| 20 | B tự login sau revoke | active B |
| 21 | Admin revoke thiếu reason | 400 |
| 22 | Admin revoke có audit | admin_audit_logs row |
| 23 | Admin revoke 2 lần | already_revoked idempotent |
| 24 | A hết TTL | B login được |
| 25 | B login trước TTL | block |
| 26 | Concurrent A/B login | 1 active |
| 27 | Concurrent B retry | no dup |
| 28 | DB/RPC lỗi + flag on | fail-closed |
| 29 | Telemetry lỗi | enforce vẫn đúng |
| 30 | Flag off | compatibility |
| 31 | Flag on | global enforce |
| 32 | Admin route | không bị khóa one-device |
| 33 | Cold start | enforce giữ |
| 34 | V1 rollback (flag off) | OK |
| 35 | Không dùng course_session_token cho one-device | assert |
| 36 | A revoked request tiếp | session_revoked |
| 37 | Logout không đụng Gmail khác | isolation |
| 38 | Logout không revoke nhầm history | chỉ active row |
| 39 | Touch last_seen từ request học | last_seen tăng |
| 40 | Video dài/idle | ghi nhận: TTL 24h; heartbeat chưa cần; **chưa E2E video** cho tới staging |

---

## 32. Implementation phases

### RP2-B1 — Global block policy & session decision

- **Mục tiêu:** Flag on → mọi course enforce; map block error; không supersede; fail-closed login/access.
- **File (dự kiến):** `utils/lms-session-guard.js`, `course-data.js`, `lesson.js`, `verify-entry-token.js`, (cân nhắc) `exchange-code.js`, tests mới.
- **Migration:** Không (trừ khi thiếu RPC production — xác minh trước).
- **Dependency:** Xác minh Portal gọi RPC policy=`block`; xác minh unique index production.
- **Test:** 1–13, 26–31, 35.
- **Rollback:** Tắt flag.
- **Rủi ro:** Portal divergence; exchange-code bypass nếu không xử lý; learner course ngoài list bị chặn lần đầu (expected).
- **DoD:** Flag on → ENV list không còn bypass; B block contract đúng; A không bị đá; RP2-A/RP-1 regression pass.

### RP2-B2 — Server-side logout & TTL

- **Mục tiêu:** Endpoint logout; cascade revoke; idempotent; TTL 24h giữ + touch; document no-heartbeat.
- **File:** handler logout mới, `api/lms/portal.js`, `lms-session-guard.js`, tests.
- **Migration:** Optional RPC `logout_student_session`.
- **Dependency:** B1 error contract; CORS portal headers.
- **Test:** 14–17, 24–25, 36–40.
- **Rollback:** Tắt route / flag; sessions cũ giữ.
- **Rủi ro:** Logout nhầm session; CSRF; client clear trước server OK.
- **DoD:** Logout server-side bắt buộc; double logout OK; fail DB → không fake success.

### RP2-B3 — Admin lost-device revoke polish

- **Mục tiêu:** Reason bắt buộc; response idempotent; audit đầy đủ; map `session_revoked`; docs/UI copy.
- **File:** `admin-account-sharing-alerts.js`, tests; có thể thin alias action.
- **Migration:** Không.
- **Dependency:** B1/B2 status mapping.
- **Test:** 18–23.
- **Rollback:** Revert handler; RPC cũ vẫn chạy.
- **Rủi ro:** Admin quên reason; nhầm email.
- **DoD:** Revoke A only; B tự login; reason+audit bắt buộc.

### RP2-B4 — Tests, observability, rollout prep

- **Mục tiêu:** Full matrix; metrics/log an toàn; checklist ENV; không bật production trong phase này trừ owner.
- **File:** `tests/rp2b-session-device.test.mjs`, docs result.
- **Migration:** Không.
- **Dependency:** B1–B3.
- **Test:** Toàn bộ 1–40 + RP2-A 29 + RP-1 48.
- **Rollback:** Flag off.
- **Rủi ro:** Portal chưa sẵn → hoãn bật flag.
- **DoD:** Test pass; plan result file; owner checklist ENV/Portal.

---

## 33. Definition of Done (toàn RP2-B)

- [ ] `V2_GLOBAL_ONE_DEVICE_ENABLED` gate rõ; default off.
- [ ] Flag on: global 1 active session/email; ENV course list không bypass.
- [ ] B block: 409/423 + `device_active_elsewhere` + message owner; không leak A metadata.
- [ ] Không supersede/auto-kick A trên login B.
- [ ] Server-side logout + cascade + idempotent + fail-closed.
- [ ] Admin revoke A: reason + audit + idempotent; không tạo B.
- [ ] TTL 24h + touch; không heartbeat trừ khi chứng minh sau.
- [ ] Fail-closed DB/RPC khi flag on.
- [ ] Telemetry tách enforcement.
- [ ] Không đụng cors.js / lms-secrets.js / main / V1 tag.
- [ ] Migration chỉ additive (nếu có) + V1-safe.
- [ ] Tests matrix + regression RP2-A + RP-1.
- [ ] Chưa deploy production trong plan phase trừ owner.

---

## 34. Open questions (owner)

| # | Câu hỏi | Ảnh hưởng | Đề xuất mặc định |
|---|---|---|---|
| Q1 | Portal production đã gọi `handle_student_session_login` với `p_conflict_policy='block'`? | B1 correctness | Xác minh Portal repo + staging logs trước code |
| Q2 | `exchange-code` khi flag on: reject hay RPC-wrap? | Bypass path | **Reject** (Option A) |
| Q3 | HTTP 409 hay 423 cho block? | Client contract | **409 Conflict** |
| Q4 | Logout body: chỉ LMS headers hay Portal cũng gọi bằng student_session_id? | Route shape | Cả hai; ownership bắt buộc |
| Q5 | TTL có hạ xuống 8h sau quan sát? | UX | Giữ 24h phase 1 |
| Q6 | Có cần RPC logout riêng hay JS update đủ? | Migration | **RPC riêng** khuyến nghị |
| Q7 | Admin reason min length / template? | UX admin | ≥10 ký tự free-text |
| Q8 | Production đã apply đủ 4 migration session/atomic/alerts/p0/p1? | Schema | **Bắt buộc xác minh Supabase** trước B1 |
| Q9 | Cookie JWT khi flag on: vẫn set nhưng không đủ access? | Client | Vẫn set optional; access cần LMS session |
| Q10 | Portal logout hiện có gọi LMS không? | B2 | Xác minh; nếu không → B2 tạo mới |

---

## 35. RECOMMENDED NEXT COMMAND

```text
Owner duyệt plan này → trả lời Q1–Q10 (đặc biệt Q1, Q2, Q8)
→ Xác minh read-only production Supabase:
   - \d student_active_sessions
   - index idx_one_active_student_session_per_email
   - function handle_student_session_login
   - function reset_student_session_guard
→ Xác minh Portal student-web caller RPC (repo ngoài)
→ Chỉ sau đó: triển khai RP2-B1 trên feat/v2-rp2b-session-device-guard
   (vẫn chưa deploy, chưa bật flag production)
```

**Không** tạo branch khác. **Không** sửa code cho tới khi owner duyệt plan + Q1/Q2/Q8.

---

## Phụ lục A — Trả lời checklist Bước 4 (Global one-session)

1. Hai khóa cùng TB: **1** student_active_session; **nhiều** lms_verified_sessions (per course).
2. Unique index: **có** (migration_atomic) — **1 active/email**.
3. Advisory lock: **có** trong RPC login + reset.
4. Race A/B: serialize bằng lock **nếu** qua RPC.
5. Policy default SQL: **block** (không supersede).
6. Policy param: `p_conflict_policy` (`block`|`supersede`).
7. Caller LMS: **không có**; Portal chưa xác minh.
8. Caller auto-supersede: không trong LMS; SQL hỗ trợ nếu policy=`supersede`.
9. Insert trực tiếp `createStudentActiveSession`: **không caller**.
10. Route học không verify LMS: course ngoài ENV list + cookie path; exchange-code.
11. Photo/progress/media: không thấy route progress riêng trong inventory; lesson/course-data là chính; public-lesson bypass auth (public).
12. Course ngoài ENV: cookie JWT / credential — **bypass one-device**.

## Phụ lục B — Trả lời checklist Bước 5 (Logout)

1. Logout hiện tại: **không có server route** → client-only (dự kiến).
2. Xóa client → server session **vẫn active**.
3. Admin reset RPC: **không** dùng cho logout thường (status admin_reset + control bump).
4. Cần helper/RPC logout riêng.
5. Verify session id + device + email.
6. Không được revoke B: chỉ row ownership match.
7. Logout 2 lần: already_logged_out.
8. DB lỗi: 503; client không clear.
9. CSRF: custom header + CORS portal.
10. Route: **LMS portal endpoint** (+ Portal client gọi).

## Phụ lục C — Trả lời checklist Bước 6 (B block)

- RPC hỗ trợ block không supersede: **có**.
- Caller policy: **chưa xác minh Portal**.
- Response RPC đủ reason: **có** (`active_session_on_another_device`).
- Duplicate log: unique idempotency key **có** (schema).
- Fail-closed: app layer khi flag on.

## Phụ lục D — Trả lời checklist Bước 7 (Admin)

1. Endpoint reset: **có** (`reset_session`).
2. Endpoint mới: không bắt buộc.
3. RPC revoke: student active → admin_reset; tokens revoked; lms admin_reset; control watermark.
4. Không xóa history rows; chỉ active.
5. Reason/actor/audit: partial (hardcode reason; actor admin email; audit có).
6. Idempotency: thực chất OK; response chưa phân biệt.
7. Status mới: **không cần**.
8. Dùng `admin_reset`.
9. Double-click: 0 rows, vẫn ok.
10. Lock account riêng: **không** trong scope (risk review statuses ≠ lock enrollment).

---

## Phụ lục E — Bảng giai đoạn tổng hợp

| GIAI ĐOẠN | MỤC TIÊU | FILE | MIGRATION | DEPENDENCY | TEST | ROLLBACK | RỦI RO | THỨ TỰ |
|---|---|---|---|---|---|---|---|---|
| RP2-B1 | Global block + bỏ ENV bypass + error contract + fail-closed | lms-session-guard, course-data, lesson, verify-entry-token, (exchange-code?) | Không* | Portal RPC block verified; prod schema | 1–13,26–31,35 | Tắt flag | Portal divergence; exchange-code | 1 |
| RP2-B2 | Server logout + TTL 24h touch | logout handler, portal router, session-guard | Optional logout RPC | B1 | 14–17,24–25,36–40 | Tắt route/flag | CSRF; fake success | 2 |
| RP2-B3 | Admin revoke polish (reason/audit/idempotent UX) | admin-account-sharing-alerts | Không | B1–B2 | 18–23 | Revert handler | Nhầm email | 3 |
| RP2-B4 | Full tests + observability + rollout checklist | tests/rp2b-*.mjs, docs result | Không | B1–B3 | 1–40 + RP2-A + RP-1 | Flag off | Portal chưa sẵn | 4 |

\*Migration chỉ nếu production thiếu index/RPC (xác minh Q8 trước).

---

## Phụ lục F — DEPENDENCY VERIFICATION RESULT (lượt xác minh 2026-07-14)

> Lượt này **chỉ xác minh dependency + Q1–Q10**. Không sửa source, không migration, không commit/push/deploy, không gọi production mutate. Mọi phát biểu dưới đây dựa trên việc đọc source `web-lms-chinh-thuc/_worktrees/v2-rebuild-20260714` (branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9`) và `yeubep-shop/student-web` (Portal, branch `v2/platform-rebuild`, HEAD `d2a903c`). Production schema **không** được query trực tiếp — ghi rõ trong từng mục.

### F.1 Portal repo / path / HEAD

| Mục | Giá trị | Bằng chứng |
|---|---|---|
| Path repo Portal | `C:/Users/gaomi/Downloads/Telegram Desktop/web-ban-hang-chinh-thuc/yeubep-shop/student-web` | `ls` thư mục cha xác nhận duy nhất repo Portal chứa `student-web`; `web-ban-hang-chinh-thuc` đã giữ repo LMS; `git-repo` không chứa Portal; `donut-landing-agency-a` không phải Portal; `khoa-hoc-test-main-extracted` không có git. |
| Branch | `v2/platform-rebuild` (chưa có branch RP2-B trong Portal) | `git branch --show-current` → `v2/platform-rebuild`. |
| HEAD | `d2a903c1169ac97f49e3584c0f95374f350ee02b` | `git rev-parse HEAD`. |
| Remote | `https://github.com/thienha100022653824678-stack/tao-web-tra-bai-hoc-vien.git` | `git remote -v`. |
| Working tree | sạch (không có `git status --short` non-empty) | — |
| Vercel project | `student-web` (`prj_paRRXhaTAqF6NnqbZBK6HsZP4zm3`) | `.vercel/project.json`. |
| Repo khác phục vụ Portal production | **Không** tìm thấy repo nào khác chứa `student-web` / `portal`. | grep domain `yeunauan`, `daubepnho` chỉ ra repo này (Portal) và LMS. |

### F.2 Portal login caller

| # | Câu hỏi | Trả lời | Bằng chứng file:line |
|---|---|---|---|
| 1 | Caller của `handle_student_session_login` | `yeubep-shop/student-web/src/lib/session-guard.ts:421` `ensureStudentSessionAtomic` → `supabase.rpc('handle_student_session_login', {...})` | `session-guard.ts:421` |
| 2 | Caller thật gọi helper | `src/app/api/lms-entry-token/route.ts:149` gọi `ensureStudentSessionAtomic({email, portalDeviceId, ip, userAgent, deviceLabel})` | `route.ts:149` |
| 3 | RPC được gọi trực tiếp hay qua API trung gian? | Trực tiếp từ Portal server (Next.js route handler `app/api/lms-entry-token`) tới Supabase RPC | `route.ts:149` + `supabase.rpc(...)` |
| 4 | `p_conflict_policy` thật | **`'block'`** (hardcode) | `session-guard.ts:430` `p_conflict_policy: 'block'` |
| 5 | Path nào truyền `supersede`? | **Không** tồn tại trong Portal | grep `'supersede'` trong `src` → 0 hit; SQL function có nhánh `supersede` nhưng không được Portal gọi. |
| 6 | Same device reuse? | **Có** — RPC path `reused` khi `existing.portal_device_id === p_portal_device_id`; helper không tạo mới | `session-guard.ts:162-178` (helper read), SQL `migration_atomic_session_guard.sql:162-178` |
| 7 | B khác device bị block hay A bị supersede? | **Block** (B không tạo active; A giữ nguyên). Lỗi trả về client qua `studentSessionError` map `active_session_on_another_device` → HTTP 409 + message owner | `session-guard.ts:451-473` (helper throw) + `route.ts:54-60` (mapping 409 `active_session_on_another_device`) |
| 8 | Response blocked map sang error gì? | HTTP 409, body `{ ok:false, error: "Tài khoản đang được sử dụng…", code: "active_session_on_another_device" }`. **Chưa** chuẩn hoá `device_active_elsewhere` mà plan đề xuất. | `route.ts:54-60` |
| 9 | Lộ `student_session_id`/`portal_device_id`/`last_seen` của A cho client? | Trong helper `ensureStudentSessionAtomic` **không trả** cho client qua `lms-entry-token/route.ts` — chỉ gắn vào event log. RPC vẫn trả `student_session_id`, `portal_device_id`, `last_seen_at` cho Portal server-side, nhưng route chỉ `NextResponse.json({ ok: true, url })` — không leak. | `session-guard.ts:496-503`, `route.ts:171` |
| 10 | Portal ghi event `login_blocked_other_device`? | **Có** qua `safeLogStudentDeviceEvent` với `idempotencyKey = login_blocked:${email}:${deviceHash}:${sessionId}` | `session-guard.ts:452-469` |
| 11 | Retry B có duplicate event? | Không nhân đôi event nhờ `idempotencyKey` ổn định + unique partial index `idx_student_device_logs_event_idempotency` trong migration alerts | `migration_account_sharing_alerts.sql:49` + `migration_account_sharing_p0_hardening.sql:52` |
| 12 | Bypass insert `student_active_sessions` trực tiếp? | Helper `createStudentActiveSession` (insert JS) tồn tại nhưng **không có caller** ngoài chính `ensureStudentSessionCompat` (cũng không có caller bên ngoài). Caller duy nhất của `ensureStudentSessionAtomic` = `lms-entry-token/route.ts`. | grep callers |
| 13 | Race path không dùng RPC? | Không — duy nhất `ensureStudentSessionAtomic` (RPC) được gọi từ Portal. | grep callers |

### F.3 Conflict policy thực tế

- **Portal caller luôn truyền `'block'`** (`session-guard.ts:430`).
- **SQL default `block`** (`migration_atomic_session_guard.sql:108,114`).
- Nhánh SQL `supersede` chỉ chạy khi `v_policy = 'supersede'` — không có Portal path nào chọn nhánh này. (`migration_atomic_session_guard.sql:179`)
- ⇒ Tuân thủ owner §4. **Không** có path production nào `supersede` A.

### F.4 Same-device behavior

- `ensureStudentSessionAtomic` → RPC trả `{ok:true, action:'reused', student_session_id, portal_device_id}` khi `existing.portal_device_id === p_portal_device_id`. (`migration_atomic_session_guard.sql:162-178`)
- Helper không tự đổi session id; chỉ touch `last_seen_at`. (`session-guard.ts:496-503` đọc từ RPC result)
- Cookie `course_session_token` không bị xoá hay rotate — side-effect không tồn tại trong route.

### F.5 Other-device behavior

- RPC block → helper throw với `code = 'active_session_on_another_device'` (hoặc `existing_active_session` legacy).
- Portal route map thành HTTP 409, `code: 'active_session_on_another_device'`, message owner Việt (không lộ thiết bị A). (`route.ts:54-60`)
- A không bị supersede; row `student_active_sessions` của A giữ nguyên trạng thái.
- Event `login_blocked_other_device` ghi 1 lần nhờ `idempotencyKey`.

### F.6 Entry-token creation path (Portal side)

| # | Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|---|
| 1 | Portal tạo entry token ở đâu? | `src/app/api/lms-entry-token/route.ts:160` | `route.ts:160-168` |
| 2 | Gọi API LMS hay ghi trực tiếp Supabase? | **Ghi trực tiếp Supabase LMS** thông qua `lmsSupabaseAdmin` (env `LMS_SUPABASE_URL`, `LMS_SUPABASE_SERVICE_ROLE_KEY`) | `route.ts:1-2`, `src/lib/supabase.ts:8-22` |
| 3 | Token gắn email/session/device/course | `email`, `student_session_id` (từ RPC result), `portal_device_id`, `course_slug`, `post_id`, `status='active'`, `expires_at = now + ttlMinutes` (default 30 phút qua `LMS_ENTRY_TOKEN_TTL_MINUTES` / `DEFAULT_LMS_ENTRY_TOKEN_TTL_MINUTES=30`) | `session-guard.ts:506-541` |
| 4 | TTL mặc định | 30 phút | `session-guard.ts:9,20-25` |
| 5 | Hash-only lưu? | **Có** — `token_hash = sha256(rawToken)`; `rawToken` chỉ trả về client response một lần (`#entry_token=`), DB không lưu raw. | `session-guard.ts:46-51,524-541` |
| 6 | Used-once? | **Có** — `lms_entry_tokens.status` chuyển sang `used`/`expired`/`revoked`; LMS `verifyLmsEntryToken` chỉ nhận status `active` | `utils/lms-handlers/verify-entry-token.js` + `migration_student_session_guard.sql:25-26` |
| 7 | Path tạo entry token mà không có active student session? | **Không** — `lms-entry-token/route.ts:147-158` bắt buộc `ensureStudentSessionAtomic` thành công mới gọi `createLmsEntryToken`. Nếu RPC block thì 409 trả trước. | `route.ts:147-168` |
| 8 | Path redirect LMS không qua entry token? | LMS vẫn có `loadCourseData({credential\|sessionToken})` không cần entry token (line `lms.html:2192-2258`). Bypass one-device chỉ xảy ra nếu course ngoài ENV list `LMS_ENTRY_TOKEN_REQUIRED_COURSES`. | `lms.html:2208` |
| 9 | Course khác trên cùng thiết bị — reuse student session? | **Có** — `ensureStudentSessionAtomic` chỉ chạy 1 lần mỗi request `lms-entry-token`; nếu cùng `portal_device_id` thì RPC trả `reused`, `createLmsEntryToken` được gọi với cùng `student_session_id` tạo row entry mới. LMS `verify-entry-token` tạo `lms_verified_sessions` mới theo `course_slug`. | `route.ts:147-168`, `utils/lms-handlers/verify-entry-token.js` |

### F.7 Logout hiện tại (Portal side)

| # | Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|---|
| 1 | Endpoint logout | `POST /api/auth/logout` (Portal Next.js route) | `src/app/api/auth/logout/route.ts:5` |
| 2 | Server-side revoke? | **Có** — gọi `markStudentSessionLoggedOut({email, portalDeviceId})` cập nhật `student_active_sessions.status='logged_out'`, cascade `lms_verified_sessions` → `logged_out`, `lms_entry_tokens` → `revoked`, telemetry `LOGOUT`. | `route.ts:10-19`, `session-guard.ts:295-363` |
| 3 | Update `student_active_sessions → logged_out`? | Có | `session-guard.ts:325-336` |
| 4 | Revoke `lms_verified_sessions`? | Có (status `logged_out`) | `session-guard.ts:337-345` |
| 5 | Revoke `lms_entry_tokens`? | Có (status `revoked`) | `session-guard.ts:347-351` |
| 6 | Clear cookie/localStorage trước server xác nhận? | Server chạy xong (hoặc try/catch im lặng) rồi route mới `response.cookies.delete('course_session_token')`. JS client (`my-courses-client.tsx:60`, `login-client.tsx:108`) gọi `fetch('/api/auth/logout', {method:'POST'})` rồi `router.refresh()` — không có xoá localStorage trước response. | `route.ts:23-24`, `my-courses-client.tsx:58-65`, `login-client.tsx:106-113` |
| 7 | Idempotency? | **Có** — `markStudentSessionLoggedOut` trả về `null` nếu không tìm thấy active row; route không phân biệt 200/200-already trong response (chỉ `{success:true}`). | `session-guard.ts:320-322`, `route.ts:22-24` |
| 8 | CSRF / same-origin? | Cookie `course_session_token` `httpOnly`, `sameSite=lax`, `secure` ở production (`src/app/api/auth/login/route.ts:35-41`). POST không yêu cầu custom header — form-CSRF cổ điển có thể POST tới `/api/auth/logout` nếu victim đã đăng nhập Portal. | `login/route.ts:35-41` |
| 9 | Sau logout, request cũ A dùng được không? | `student_active_sessions` → `logged_out` + `lms_verified_sessions` cascade → `logged_out` ⇒ LMS `verifyLmsVerifiedSessionAccess` sẽ fail (status không còn `active`). Cookie JWT vẫn sống 30d nhưng route `course-data` sẽ trả 401 vì student active không match. **Cần test thực tế** để chắc chắn `verifyLmsVerifiedSessionAccess` block row `logged_out` — chưa xác minh production. | `session-guard.ts:325-345`, `utils/lms-session-guard.js` (verify access — chưa đọc chi tiết) |
| 10 | Logout đặt route ở Portal hay LMS? | **Portal** hiện tại (route `/api/auth/logout`). LMS không có route logout học viên. ⇒ Ownership chain hiện thuộc Portal. | `route.ts` existence + grep LMS routes |

### F.8 exchange-code usage

| Vị trí | Tìm thấy? | Bằng chứng |
|---|---|---|
| Caller trong LMS HTML/JS (`lms.html`, `lesson.html`, `admin.html`, `lms-admin.html`, `index.html`, `gdrive-player.html`) | **Không** — không có `fetch('/api/lms/portal?endpoint=exchange-code')`, không `fetch('/api/exchange-code')`, không `response_type=code` flow. | grep toàn repo `web-lms-chinh-thuc` (trừ `_worktrees`) cho `exchange-code\|/api/exchange\|exchangeCode` chỉ trả về 4 hit đều nằm trong `utils/lms-handlers/exchange-code.js` (chuỗi log). |
| Caller trong Portal (`student-web/src`) | **Không** — grep `'exchange'` trong `src` 0 hit | grep |
| Caller trong `git-repo` (legacy web-ban-hang) | **Không** — grep 0 hit | grep |
| Route mapping trong `api/lms/portal.js` | **Không có mapping cho `endpoint === "exchange-code"`**. Router chỉ switch course-data / lesson / public-config / public-lesson / verify-entry-token; mặc định trả 404. | `api/lms/portal.js:8-26` |
| `vercel.json` rewrites/routes | Không có rewrite tới handler `exchange-code` (vercel.json chỉ có headers) | `vercel.json` |
| Phân loại | **Orphan handler** — file tồn tại (`utils/lms-handlers/exchange-code.js`) nhưng không có route nào map; không có frontend gọi; không có rewrite. ⇒ Không reachable qua router `/api/lms/portal` hiện tại. **Tuy nhiên** chưa xác minh có handler đứng riêng (`api/exchange-code.js`) hoặc được gọi qua Vercel function alias khác — không tìm thấy alias trong repo. | route mapping + grep |
| Rủi ro | Nếu deploy LMS V1/V2 hiện tại qua Vercel, `exchange-code.js` chỉ là dead code. Nhưng **nếu sau này lộ route alias** hoặc lập trình viên thêm route, đường bypass one-device sẽ mở lại (cookie JWT, không gọi Portal RPC). Cần **xoá hoặc chính thức block** khi bật flag V2. | `exchange-code.js:159-167` (createStudentSession + set cookie, không touch student_active_sessions) |

### F.9 Production schema verification

**Quyết định an toàn:** Lượt này **không** thực hiện truy vấn Supabase production. Mọi phát biểu về production schema dựa trên việc đọc migration SQL đã commit trong repo LMS (`migration_student_session_guard.sql`, `migration_atomic_session_guard.sql`, `migration_account_sharing_*.sql`) — chưa chứng minh đã apply lên DB Vercel production.

| Object | Repo migration | Production EXISTS? | Signature / Index | GRANTS | Match/Mismatch | RỦI RO |
|---|---|---|---|---|---|---|
| Table `student_active_sessions` | `migration_student_session_guard.sql:4-19` | **NOT VERIFIED** (chưa query production) | columns: `id uuid PK, email, student_session_id UNIQUE, portal_device_id, status CHECK(...)`, `login_at`, `last_seen_at`, `logout_at`, `ip`, `user_agent`, `created_at`, `updated_at` | — (table default) | Cần xác minh | Nếu thiếu → mọi insert/RPC fail |
| Table `lms_entry_tokens` | `migration_student_session_guard.sql:21-36` | NOT VERIFIED | `id`, `token_hash UNIQUE`, `email`, `student_session_id`, `portal_device_id`, `course_slug`, `post_id`, `status CHECK(...)`, `expires_at`, ... | — | Cần xác minh | Tương tự |
| Table `lms_verified_sessions` | `migration_student_session_guard.sql:38-55` | NOT VERIFIED | `id`, `lms_session_id UNIQUE`, `email`, `student_session_id`, `lms_device_id`, `course_slug`, `entry_token_id REFERENCES`, `status CHECK(...)`, ... | — | Cần xác minh | Tương tự |
| Table `student_session_controls` | `migration_account_sharing_p0_hardening.sql:56-69` | NOT VERIFIED | columns: `email`, `session_generation`, `sessions_revoked_before`, `updated_by_admin_email`, `reason`, `updated_at` + unique index `idx_student_session_controls_email` | `ENABLE ROW LEVEL SECURITY` | Cần xác minh | RPC reset dùng bảng này |
| Table `student_device_change_logs` | `migration_account_sharing_alerts.sql:5-37`, `migration_atomic_session_guard.sql:44-83` | NOT VERIFIED | có event_idempotency_key unique partial `idx_student_device_logs_event_idempotency` (`migration_account_sharing_p0_hardening.sql:52`) | — | Cần xác minh | Telemetry idempotency |
| Table `student_account_risk_reviews` | `migration_account_sharing_alerts.sql:53-76` | NOT VERIFIED | unique `idx_student_account_risk_reviews_email` | — | — | — |
| Table `student_account_admin_notes` | `migration_account_sharing_alerts.sql:80-90` | NOT VERIFIED | — | — | — | — |
| Table `admin_audit_logs` | `migration_account_sharing_alerts.sql:91-103` | NOT VERIFIED | `id`, `admin_email`, `action`, `target_email`, `metadata jsonb`, `ip_hash`, `user_agent`, `created_at` | — | — | — |
| Index `idx_one_active_student_session_per_email` | `migration_atomic_session_guard.sql:40-42` | NOT VERIFIED | `UNIQUE (lower(email)) WHERE status='active'` (partial) | — | Cần xác minh | **Cốt lõi** 1 active/email |
| Index `idx_student_device_logs_event_idempotency` | `migration_account_sharing_alerts.sql:49`, `migration_account_sharing_p0_hardening.sql:52` | NOT VERIFIED | `UNIQUE ... event_idempotency_key` (partial) | — | Cần xác minh | Idempotency block event |
| Function `handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)` | `migration_atomic_session_guard.sql:99-238` | NOT VERIFIED | args theo thứ tự: `p_email, p_portal_device_id, p_new_student_session_id, p_device_hash, p_device_label, p_ip, p_ip_hash, p_user_agent, p_conflict_policy DEFAULT 'block', p_idle_hours DEFAULT 24`. RETURNS jsonb. Có `pg_advisory_xact_lock(hashtext(v_email))`. Default policy = `block`. Nhánh supersede **chỉ** chạy khi `v_policy='supersede'`. **Không thấy SECURITY DEFINER / GRANT trong file** — chưa có đoạn `REVOKE/GRANT` cho function này (khác với `reset_student_session_guard`). | **CHƯA THẤY GRANT/REVOKE cho `handle_student_session_login`** ⇒ có thể function được tạo với default `PUBLIC EXECUTE` (Postgres default) hoặc owner đã set khác — cần xác minh production. Portal hiện gọi qua `supabase.rpc` với service-role key (từ `lmsSupabaseAdmin`); service_role thường có EXECUTE mặc định cho function do `postgres`/owner tạo, nhưng vẫn cần xác minh. | Signature + lock + default policy khớp kỳ vọng. **GRANT CHƯA XÁC MINH.** | Nếu thiếu grant → Portal sẽ nhận 42501 khi gọi RPC. **Bắt buộc verify trước B1.** |
| Function `reset_student_session_guard(text,text,text)` | `migration_account_sharing_p0_hardening.sql:72-178` | NOT VERIFIED | `SECURITY DEFINER`, `SET search_path = public`, advisory lock `pg_advisory_xact_lock(hashtext('reset_student_session_guard:' || v_email))`, revoke PUBLIC/anon/authenticated, grant `service_role` | `GRANT EXECUTE TO service_role` (line 184) | Cần xác minh GRANT đã apply production | — |
| Function `cleanup_student_account_risk_events(integer)` | `migration_account_sharing_p1.sql:67-105` | NOT VERIFIED | SECURITY DEFINER; `GRANT EXECUTE TO service_role` (line 109) | `service_role` | Cần xác minh | — |

### F.10 RPC / index / grants verification

Tổng hợp từ F.9:

- **Cần xác minh trước B1**:
  1. Production có table `student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`, `student_session_controls`, `student_device_change_logs`, `admin_audit_logs`, `student_account_risk_reviews`, `student_account_admin_notes`.
  2. Unique partial index `idx_one_active_student_session_per_email` đã apply.
  3. Function `handle_student_session_login` tồn tại với signature `(text,text,text,text,text,text,text,text,text,integer)` và **GRANT EXECUTE** cho principal mà Portal dùng (service_role hoặc anon nếu Portal dùng anon — đọc lại: Portal dùng `service_role` qua `lmsSupabaseAdmin`).
  4. Function `reset_student_session_guard` đã `REVOKE PUBLIC/anon/authenticated` + `GRANT service_role`.
  5. Cột `event_idempotency_key` trên `student_device_change_logs` đã có (telemetry idempotency).
- **Hiện không có tool/credential read-only production** để xác minh an toàn — ghi nhận là **PRODUCTION SCHEMA NOT VERIFIED** (theo chính sách owner).

### F.11 Domain / runtime mapping

| Mục | Giá trị | Bằng chứng (chỉ tên biến / URL — không giá trị) |
|---|---|---|
| Portal production domain | `www.yeunauan.live` (Portal dùng `next/link` nội bộ; portal redirect người dùng sang LMS `https://www.daubepnho.store/lms.html#entry_token=...`) | `yeubep-shop/student-web/src/app/api/lms-entry-token/route.ts:11` `const LMS_ENTRY_BASE_URL = 'https://www.daubepnho.store/lms.html'`; LMS `lms.html:463` `const MY_COURSES_URL = "https://www.yeunauan.live/my-courses"`. Portal host gốc = Vercel project `student-web`; domain alias nằm trong Vercel, không thấy trong repo. |
| LMS production domain | `https://www.daubepnho.store` (alias `https://daubepnho.store`) | `handover/IMPLEMENTATION_STATUS.md:73-74`; `lms.html` + admin.html reference. |
| Portal env vars dùng (NAMES only) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LMS_SUPABASE_URL`, `LMS_SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `STUDENT_SESSION_IDLE_HOURS`, `LMS_SESSION_IDLE_HOURS`, `LMS_ENTRY_TOKEN_TTL_MINUTES`, `ACCOUNT_EVENT_HASH_SECRET`, `SESSION_GUARD_HASH_SECRET` | `student-web/src/lib/supabase.ts:6-22`, `session-guard.ts:42-58` |
| LMS env vars dùng (NAMES only) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, `SESSION_SECRET`, `ADMIN_EMAILS`, `LMS_ENTRY_TOKEN_REQUIRED_COURSES`, `LMS_ENTRY_TOKEN_TTL_MINUTES`, `STUDENT_SESSION_IDLE_HOURS`, `LMS_SESSION_IDLE_HOURS`, `V2_PLATFORM_ENABLED`, `V2_OUTBOX_SHADOW_MODE`, `V2_OUTBOX_WORKER_ENABLED`, `V2_DELIVERY_HANDLERS_ENABLED`, `V2_PORTAL_PROJECTION_ENABLED`, `V2_PORTAL_PROJECTION_DRY_RUN`, `V2_SESSION_LEASE_ENABLED`, `V2_ENTRY_TOKEN_REQUIRED`, `V2_DRIVE_WORKER_DRY_RUN`, `V2_RECONCILIATION_READONLY`, `V2_RISK_SCORING_ENABLED`, `V2_WORKER_SECRET` / `INTERNAL_SYNC_SECRET`, `V2_RUNTIME_MODE`. **Chưa có** `V2_GLOBAL_ONE_DEVICE_ENABLED` trong `utils/v2-flags.js` (cần thêm trong B1). | `utils/v2-flags.js` (repo LMS main); `.env.production` (chỉ list NAME không value) |
| Repo deploy LMS production | `web-lms-chinh-thuc` → Vercel project `web-lms-chinh-thuc` (`prj_TimQqrVhrOLW8y1KI464JBvajwlz`) | `.vercel/repo.json` |
| Repo deploy Portal production | `yeubep-shop/student-web` → Vercel project `student-web` (`prj_paRRXhaTAqF6NnqbZBK6HsZP4zm3`) | `student-web/.vercel/project.json` |

### F.12 Q1–Q10 answers

| Q | Câu hỏi | Trạng thái | Bằng chứng / tác động / blocker / hành động |
|---|---|---|---|
| Q1 | Portal production đã gọi `handle_student_session_login` với `p_conflict_policy='block'`? | **VERIFIED YES** (đọc source Portal hiện tại trên branch `v2/platform-rebuild`, HEAD `d2a903c`). Tác động: B1 có thể tin Portal truyền `block`. Không còn blocker ở mức source. **Tác động phụ**: chưa xác minh RPC có tồn tại + grant trên production (xem Q8). Hành động: xác minh production RPC + grant trước B1. | `student-web/src/lib/session-guard.ts:421-432` |
| Q2 | `exchange-code` khi flag on: reject hay RPC-wrap? | **VERIFIED ORPHAN** (xem F.8). Handler tồn tại nhưng route mapping không có → không reachable. Hành động B1: **xoá file hoặc chính thức chặn qua router guard** (đề xuất xoá file `utils/lms-handlers/exchange-code.js` vì không có caller; hoặc thêm guard `if (endpoint === "exchange-code") return 410 Gone;` trong `api/lms/portal.js` để future-proof). | `api/lms/portal.js:8-26`; không có caller trong Portal, LMS HTML, hay legacy repo. |
| Q3 | HTTP 409 hay 423 cho block? | **VERIFIED YES (Portal dùng 409)**. Tác động: B1 LMS error contract nên giữ 409 để đồng bộ với Portal. Hành động: giữ 409. | `student-web/src/app/api/lms-entry-token/route.ts:57` |
| Q4 | Logout body chỉ LMS headers hay Portal cũng gọi bằng student_session_id? | **PARTIALLY VERIFIED** — Portal hiện gọi qua cookie `course_session_token` + `portal_device_id` cookie (không body). LMS hiện **chưa có route logout** (xác minh `api/lms/portal.js` không có mapping). Hành động B2: thiết kế route LMS logout với ownership chain = LMS header **hoặc** Portal gọi trước khi LMS cần. Đề xuất: LMS logout route nhận cả LMS headers và (email + student_session_id + portal_device_id); Portal đã có cách gọi hiện tại vẫn tiếp tục. | `student-web/src/app/api/auth/logout/route.ts:5-19`; LMS không có route logout. |
| Q5 | TTL có hạ xuống 8h sau quan sát? | **NOT VERIFIED** (chưa đo lường). Hành động: giữ 24h phase 1 như plan đề xuất; đo learner behavior 1–2 tuần rồi quyết. | `session-guard.ts:10,27-32` (Portal); `utils/lms-session-guard.js:26-28` (LMS) |
| Q6 | Cần RPC logout riêng hay JS update đủ? | **VERIFIED JS-helper sufficient hiện tại** — Portal đã dùng `markStudentSessionLoggedOut` (JS, cascade LMS sessions + entry tokens) **không** qua RPC riêng. Helper này chạy **trong transaction đơn lẻ** từ Portal service_role client nhưng không có advisory lock email ⇒ race nhỏ nếu Portal + LMS đồng thời cùng logout. Hành động B2: đề xuất **RPC `logout_student_session`** với advisory lock (an toàn hơn); fallback JS helper giữ cho tương thích. | `student-web/src/lib/session-guard.ts:295-363` |
| Q7 | Admin reason min length / template? | **NOT VERIFIED** (chưa implement) — handler `account-sharing-alerts` hiện hardcode `account_sharing_admin_reset`. Hành động B3: thêm validation body `reason` (min 10 ký tự), trim, từ chối nếu rỗng; thêm optional `note` → `student_account_admin_notes`. | `utils/lms-handlers/admin-account-sharing-alerts.js` (chưa đọc chi tiết — note cho B3). |
| Q8 | Production đã apply đủ migration session/atomic/alerts/p0/p1? | **PRODUCTION SCHEMA NOT VERIFIED** (chưa query production). Hành động B1: cần owner cấp read-only view hoặc chạy diagnostics để xác minh (a) tables, (b) unique index, (c) RPC `handle_student_session_login` + grant. **BẮT BUỘC** trước khi bật flag. Nếu chưa apply migration, cần migration additive (giữ nguyên kế hoạch zero-migration nếu đã có sẵn). | Repo có 4 migration file; chưa verify production |
| Q9 | Cookie JWT khi flag on: vẫn set nhưng không đủ access? | **PARTIALLY VERIFIED** — `course-data.js` chấp nhận `credential`, `sessionToken` (cookie JWT), hoặc `X-LMS-Session-Id` + `X-LMS-Device-Id` (LMS verified session). Với flag on, B1 cần bỏ `isEntryTokenRequiredCourse` gate → LMS verified session là bắt buộc cho mọi course. Hành động: thêm guard `if (V2_GLOBAL_ONE_DEVICE_ENABLED && !lmsSessionAccess && !hasLmsSessionHeaders) → 401/403 entry_token_required` trong `course-data.js` + `lesson.js`. | `utils/lms-handlers/course-data.js:310-350,377-388` |
| Q10 | Portal logout hiện có gọi LMS không? | **VERIFIED NO** — Portal logout chỉ gọi LMS helper qua `lmsSupabaseAdmin` (Supabase service-role, không phải LMS API endpoint). LMS không nhận request logout. ⇒ Server-side revoke đang **chạy trực tiếp DB** từ Portal. Hành động B2: tạo LMS endpoint logout (ownership check + audit) để LMS có thể revoke độc lập khi learner logout từ LMS client (chưa có UI nhưng nên thiết kế trước). | `student-web/src/app/api/auth/logout/route.ts:5-19`; `session-guard.ts:295-363`; LMS không có route logout. |

### F.13 Blockers còn lại trước RP2-B1

1. **Production schema/index/RPC verification (Q8)** — chưa chứng minh:
   - Tables tồn tại (`student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`, `student_session_controls`, `student_device_change_logs`, `admin_audit_logs`, `student_account_risk_reviews`, `student_account_admin_notes`).
   - Unique partial index `idx_one_active_student_session_per_email` đã apply.
   - RPC `handle_student_session_login` signature khớp và **GRANT EXECUTE** cho principal Portal (service_role).
   - Cột `event_idempotency_key` trên `student_device_change_logs` đã có.
2. **`exchange-code.js` cleanup (Q2)** — handler không reachable hiện tại nhưng vẫn là dead code; cần quyết định xoá hoặc guard rõ ràng để tránh reopen bypass khi dev khác thêm route.
3. **Portal CSRF hardening cho `/api/auth/logout`** — hiện không có custom header; chấp nhận rủi ro form-CSRF nhỏ (cùng origin Portal). B2 nên thêm custom header `X-LMS-Session-Id` style hoặc CSRF token.

### F.14 Scope RP2-B1 đã điều chỉnh (so với plan gốc)

- **Giữ nguyên**: bỏ ENV bypass cho `isEntryTokenRequiredCourse`, fail-closed khi flag on + RPC lỗi, map RPC `active_session_on_another_device` → HTTP 409 với code chuẩn, telemetry `login_blocked_other_device` idempotent, không tạo student active row B.
- **Bổ sung**:
  - Định nghĩa code chuẩn Portal + LMS nên đồng bộ: đề xuất **giữ `active_session_on_another_device` (đang dùng)** để không phá backward compat với Portal client. **Hoặc** thống nhất sang `device_active_elsewhere` ở cả 2 repo. Cần owner chốt.
  - Thêm flag `V2_GLOBAL_ONE_DEVICE_ENABLED` vào `utils/v2-flags.js` (repo LMS) — hiện chưa có.
  - Thêm guard reject khi flag on + `lmsSupabaseAdmin` không khả dụng hoặc RPC lỗi → 503 `one_device_policy_unavailable` (fail-closed).
- **Không sửa**: `utils/cors.js`, `utils/lms-secrets.js`, file `utils/lms-handlers/exchange-code.js` (chỉ quyết định xoá hoặc guard ở router — xem F.13 #2).

### F.15 Migration bắt buộc / tùy chọn

| # | Thay đổi | Bắt buộc? | Lý do |
|---|---|---|---|
| M1 (B1) | Không migration mới nếu production đã có schema/RPC đầy đủ (Q8 = YES). | **Có điều kiện** | Nếu Q8 verify YES → zero-migration cho B1. |
| M2 (B1) | RPC `handle_student_session_login` GRANT EXECUTE nếu production thiếu. | **Nếu Q8 phát hiện thiếu grant** | Một dòng `GRANT EXECUTE ON FUNCTION public.handle_student_session_login(...) TO service_role;` + revoke public/anon/authenticated. Additive. |
| M3 (B2) | RPC `logout_student_session(p_email, p_student_session_id, p_portal_device_id)` với advisory lock + cascade. | **Nên có** | Tránh race giữa Portal logout + LMS verify-access; ownership chuẩn. |
| M4 (B3) | Không migration mới. | Không | Tận dụng `student_account_admin_notes` đã có. |

### F.16 RECOMMENDED NEXT COMMAND

```text
Owner cấp quyền read-only production Supabase (qua diagnostics/dashboard hoặc service-role read-only).
Chạy các truy vấn metadata:
  SELECT 1 FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN
   ('student_active_sessions','lms_entry_tokens','lms_verified_sessions',
    'student_session_controls','student_device_change_logs','admin_audit_logs',
    'student_account_risk_reviews','student_account_admin_notes');
  SELECT indexname FROM pg_indexes
   WHERE schemaname='public' AND indexname IN
   ('idx_one_active_student_session_per_email',
    'idx_student_device_logs_event_idempotency',
    'idx_student_session_controls_email');
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS rettype,
         p.prosecdef, p.proconfig
    FROM pg_proc p
   WHERE p.proname IN
   ('handle_student_session_login','reset_student_session_guard',
    'cleanup_student_account_risk_events');
  SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE routine_name IN
   ('handle_student_session_login','reset_student_session_guard');

Nếu đủ → tiến hành RP2-B1 với zero-migration.
Nếu thiếu → tạo migration additive (chỉ CREATE IF NOT EXISTS / GRANT) trên cùng branch `feat/v2-rp2b-session-device-guard`.
Owner chốt định danh lỗi chuẩn: giữ `active_session_on_another_device` hay đổi sang `device_active_elsewhere`.
Owner chốt `exchange-code.js`: xoá file hay guard 410.
```

### F.17 READY FOR RP2-B1

**NOT READY FOR RP2-B1**

Lý do: còn **1 điều kiện** chưa đạt theo Bước 11:

- **Schema/index/RPC production chưa xác minh** (Q8). Nếu thiếu `GRANT EXECUTE` cho `handle_student_session_login`, Portal sẽ fail-closed ngay khi bật flag — đó là fail-closed an toàn, nhưng cần biết trước để quyết định có cần migration hay không, và để owner chốt quyết định có rollout gate staging trước.

Các điều kiện khác đã đạt (xem Bước 11):
- ✅ Portal caller đã xác minh (Q1) — `ensureStudentSessionAtomic` trong `session-guard.ts:421`.
- ✅ Portal dùng `block` (Q1) — `session-guard.ts:430`.
- ✅ Không path production dùng `supersede` (F.3).
- ✅ Entry token gắn đúng active student session (F.6 #7).
- ✅ exchange-code đã phân loại orphan; phương án đóng bypass = xoá hoặc guard 410 (F.8, Q2).
- ✅ Scope RP2-B1 không đoán — đã điều chỉnh (F.14).

### F.18 Xác nhận trạng thái thao tác

- Chỉ file `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md` thay đổi (lượt này: thêm Phụ lục F).
- Không sửa source code (LMS hay Portal).
- Không tạo file SQL.
- Không commit.
- Không push.
- Không deploy.
- Không set ENV.
- Không gọi function mutate production.
- Không đọc dữ liệu học viên thật.
- Không đọc/hiển thị secret.
- Branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9` giữ nguyên.

**KẾT THÚC PHỤ LỤC F — chờ owner duyệt và cấp phương tiện verify production schema.**

> **Historical snapshot** (2026-07-14, trước khi owner cung cấp production metadata): phụ lục này mô tả trạng thái khi agent chưa được cung cấp 8/8 CSV production metadata. Mọi mục `NOT VERIFIED` ở F.9/F.10 đã được **supersede bởi Phụ lục I** (đối chiếu CSV 8/8). Trạng thái READY/NOT READY ở F.17 đã được **supersede bởi Phụ lục K — RP2-B0 PRODUCTION APPLY RESULT**. Nội dung gốc của F giữ nguyên làm audit trail.

---

## Phụ lục G — PRODUCTION SCHEMA VERIFICATION RESULT (lượt read-only 2026-07-14)

> Lượt này **chỉ** xác minh schema/index/RPC/grant bằng truy vấn metadata read-only, sau khi owner chốt cần xác minh production trước RP2-B1. Kết quả dưới đây là kết quả thực tế — không phải suy luận từ migration SQL.

### G.1 Phương thức verify

- **Không** dùng Supabase CLI, `psql`, MCP Supabase read-only, hay script metadata trong repo. Lý do:
  - Local toolchain không có `supabase`, `psql`, `pg_isready` (`which` xác nhận absent trên `bash` Git Bash).
  - Repo không có script `scripts/metadata*.js` / `scripts/metadata*.sql` / script bash nào sẵn để chạy read-only.
  - Repo không có `.claude/` config hay `.mcp.json` cấu hình MCP Supabase read-only.
  - `scripts/generate-drive-refresh-token.js` (script duy nhất trong `scripts/`) là OAuth refresh — không phải metadata reader, không phù hợp, **không** dùng.
- **Không** đọc `.env*` để bảo toàn secret; **không** in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LMS_SUPABASE_URL`, `LMS_SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SESSION_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`, `SESSION_GUARD_HASH_SECRET`.
- **Không** có phương thức read-only an toàn có sẵn tại local tại thời điểm verify → **không truy cập production**.

### G.2 Thời điểm verify

- `2026-07-14`, trong worktree `_worktrees/v2-rebuild-20260714`, branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9cc3344b803d7b4c271966e6fcda676d17`.

### G.3 Kết quả — Tables

| # | Table | EXISTS? | Ghi chú |
|---|---|---|---|
| 1 | `student_active_sessions` | **NOT VERIFIED** | Có migration trong repo (`migration_student_session_guard.sql:4-19`); chưa query production. |
| 2 | `lms_verified_sessions` | **NOT VERIFIED** | (`migration_student_session_guard.sql:38-55`). |
| 3 | `lms_entry_tokens` | **NOT VERIFIED** | (`migration_student_session_guard.sql:21-36`). |
| 4 | `student_session_controls` | **NOT VERIFIED** | (`migration_account_sharing_p0_hardening.sql:56-69`). |
| 5 | `student_device_change_logs` | **NOT VERIFIED** | (`migration_account_sharing_alerts.sql:5-37`; bổ sung ở `migration_atomic_session_guard.sql:44-83`). |
| 6 | `student_account_risk_reviews` | **NOT VERIFIED** | (`migration_account_sharing_alerts.sql:53-76`). |
| 7 | `student_account_admin_notes` | **NOT VERIFIED** | (`migration_account_sharing_alerts.sql:80-90`). |
| 8 | `admin_audit_logs` | **NOT VERIFIED** | (`migration_account_sharing_alerts.sql:91-103`). |

Tổng: **0/8 tables đã verify production** (chỉ suy luận từ migration file đã commit trong repo).

### G.4 Kết quả — Columns quan trọng

Không truy vấn được. Các cột kỳ vọng (suy luận từ migration):

- `student_active_sessions`: `id`, `email`, `student_session_id` UNIQUE, `portal_device_id`, `status` CHECK, `login_at`, `last_seen_at`, `logout_at`, `ip`, `user_agent`, `created_at`, `updated_at`.
- `lms_entry_tokens`: `id`, `token_hash` UNIQUE, `email`, `student_session_id`, `portal_device_id`, `course_slug`, `post_id`, `status` CHECK, `expires_at`.
- `lms_verified_sessions`: `id`, `lms_session_id` UNIQUE, `email`, `student_session_id`, `lms_device_id`, `course_slug`, `entry_token_id`, `status` CHECK.
- `student_device_change_logs`: `event_idempotency_key` (idempotency unique partial).

### G.5 Kết quả — Unique index

| Index | EXISTS? | Đặc tả kỳ vọng (suy luận) |
|---|---|---|
| `idx_one_active_student_session_per_email` | **NOT VERIFIED** | `CREATE UNIQUE INDEX ... ON public.student_active_sessions (lower(email)) WHERE status = 'active';` (`migration_atomic_session_guard.sql:40-42`) — UNIQUE **partial index** chỉ `status='active'`, áp dụng **global theo email** (không per-course). |
| `idx_student_device_logs_event_idempotency` | **NOT VERIFIED** | UNIQUE trên `event_idempotency_key` (partial), định nghĩa ở `migration_account_sharing_p0_hardening.sql:52`. |

### G.6 Kết quả — Event idempotency index

- Đã liệt kê ở G.5.
- Cột `student_device_change_logs.event_idempotency_key`: **NOT VERIFIED** production.

### G.7 Kết quả — Function signatures

| Function | EXISTS? | Identity args (suy luận từ migration) | Return | prosecdef (suy luận) |
|---|---|---|---|---|
| `handle_student_session_login` | **NOT VERIFIED** | `(p_email text, p_portal_device_id text, p_new_student_session_id text, p_device_hash text, p_device_label text, p_ip text, p_ip_hash text, p_user_agent text, p_conflict_policy text DEFAULT 'block', p_idle_hours integer DEFAULT 24)` | `jsonb` | Không thấy `SECURITY DEFINER` trong `migration_atomic_session_guard.sql:99-238` ⇒ suy luận **SECURITY INVOKER**; chưa verify production. |
| `reset_student_session_guard` | **NOT VERIFIED** | `(p_email text, p_admin_email text, p_reason text)` | `jsonb` | `SECURITY DEFINER`, `SET search_path = public` (`migration_account_sharing_p0_hardening.sql:72-178`); chưa verify production. |
| `cleanup_student_account_risk_events` | **NOT VERIFIED** | `(p_older_than_days integer)` | (migration) | `SECURITY DEFINER` (`migration_account_sharing_p1.sql:67-105`); chưa verify production. |

### G.8 Kết quả — Function definitions

- `handle_student_session_login` (`migration_atomic_session_guard.sql:99-238`): có `pg_advisory_xact_lock(hashtext(v_email))`; default `p_conflict_policy='block'`; nhánh `supersede` chỉ chạy khi `v_policy='supersede'`; block branch `RETURN jsonb_build_object('ok', false, 'action', 'blocked', 'reason', 'active_session_on_another_device', ...)` — **không update session A sang `superseded`**.
- `reset_student_session_guard` (`migration_account_sharing_p0_hardening.sql:72-178`): `pg_advisory_xact_lock(hashtext('reset_student_session_guard:' || v_email))`; status chuyển `admin_reset`; upsert control generation; cascade `lms_verified_sessions` + entry tokens; insert `admin_audit_logs`.
- `cleanup_student_account_risk_events` (`migration_account_sharing_p1.sql:67-105`): SECURITY DEFINER, delete best-effort risk events.
- ⇒ Định nghĩa đúng kỳ vọng **trong source migration**; chưa đối chiếu production `pg_get_functiondef()`.

### G.9 Kết quả — Advisory lock

- `handle_student_session_login`: có (xem G.8). **NOT VERIFIED production**.
- `reset_student_session_guard`: có (xem G.8). **NOT VERIFIED production**.

### G.10 Kết quả — Conflict policy

- Default SQL: `'block'` (suy luận từ `migration_atomic_session_guard.sql:108,114`).
- Portal caller luôn truyền `'block'` (đã verify ở F.2 #4).
- ⇒ Mặc định = `block` (đúng owner §4). Production metadata chưa verify.

### G.11 Kết quả — Same-device behavior

- RPC path `reused` khi `existing.portal_device_id = p_portal_device_id`; touch `last_seen_at`; **không** tạo mới (`migration_atomic_session_guard.sql:162-178`).
- **NOT VERIFIED production**.

### G.12 Kết quả — Other-device block behavior

- Block branch: `RETURN jsonb_build_object('ok', false, 'action', 'blocked', 'reason', 'active_session_on_another_device', 'student_session_id', v_existing.student_session_id, 'portal_device_id', v_existing.portal_device_id, 'last_seen_at', v_existing.last_seen_at)` — **không** update A sang `superseded`; **không** insert B.
- **NOT VERIFIED production**.

### G.13 Kết quả — Grants

| Function | Grantee kỳ vọng (suy luận) | Production EXISTS? |
|---|---|---|
| `handle_student_session_login` | Migration file **không** chứa `GRANT/REVOKE` cho function này ⇒ default `PUBLIC EXECUTE` (Postgres) hoặc owner đã set khác. Portal dùng `lmsSupabaseAdmin` (service_role). Cần verify production để biết role nào có EXECUTE. | **NOT VERIFIED** |
| `reset_student_session_guard` | `REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;` (`migration_account_sharing_p0_hardening.sql:182-184`) | **NOT VERIFIED** |
| `cleanup_student_account_risk_events` | `GRANT EXECUTE TO service_role` (`migration_account_sharing_p1.sql:109`) | **NOT VERIFIED** |

Phân loại grant (chưa áp dụng):
- `service_role`: cần EXECUTE cho cả 3 function (Portal dùng service_role; LMS admin route dùng service_role).
- `authenticated`: **không** cần EXECUTE cho cả 3 function (caller là server-side, không phải user JWT).
- `anon`: **không** cần EXECUTE cho cả 3 function.
- `PUBLIC`: **không** nên có EXECUTE mặc định — `reset_student_session_guard` đã REVOKE trong migration; `handle_student_session_login` chưa REVOKE trong migration ⇒ cần xác minh production và **có thể** cần migration additive hardening.

### G.14 Repo-vs-production matrix (read-only lượt này)

| Object | Repo expected (suy luận) | Production actual | MATCH | BLOCKER | ACTION |
|---|---|---|---|---|---|
| 8 tables (xem G.3) | Có migration trong repo | NOT VERIFIED | — | Có | Owner cấp read-only view / chạy diagnostics trước B1 |
| Index `idx_one_active_student_session_per_email` | UNIQUE partial `lower(email) WHERE status='active'`, global | NOT VERIFIED | — | Có | Tương tự |
| Index `idx_student_device_logs_event_idempotency` | UNIQUE partial trên `event_idempotency_key` | NOT VERIFIED | — | Có | Tương tự |
| `handle_student_session_login` signature | `(text,text,text,text,text,text,text,text,text,integer)` RETURNS jsonb | NOT VERIFIED | — | Có | Tương tự |
| Advisory lock email | Có | NOT VERIFIED | — | Có | Tương tự |
| Default `p_conflict_policy='block'` | Có | NOT VERIFIED | — | Có | Tương tự |
| Block branch không supersede A | Có (`active_session_on_another_device`, RETURN ok=false) | NOT VERIFIED | — | Có | Tương tự |
| Same-device branch reuse/touch | Có | NOT VERIFIED | — | Có | Tương tự |
| Stale branch expire cũ rồi tạo mới | Có | NOT VERIFIED | — | Có | Tương tự |
| Signature khớp Portal caller | Khớp (`ensureStudentSessionAtomic` → `supabase.rpc('handle_student_session_login', {p_conflict_policy:'block', p_idle_hours:24, ...})`) | NOT VERIFIED signature production | — | Có | Tương tự |
| Role Portal có EXECUTE | Suy luận có (service_role hoặc default PUBLIC) | NOT VERIFIED | — | Có | Tương tự |
| `EXECUTE` quá rộng anon/authenticated | `reset_student_session_guard` đã REVOKE; `handle_student_session_login` chưa REVOKE trong migration ⇒ rủi ro | NOT VERIFIED | — | Có | Nếu production verify mà anon/authenticated có EXECUTE → migration hardening additive |

### G.15 Mismatch

- **Không thể** phát hiện mismatch production vì **không** truy cập được production.
- Mismatch **nghi vấn** từ migration:
  1. `handle_student_session_login` không có REVOKE PUBLIC/anon/authenticated trong migration ⇒ rủi ro production mặc định `PUBLIC EXECUTE` (Postgres default cho function). Nếu production giữ mặc định → anon có thể gọi RPC login (mặc dù logic có advisory lock + check active, vẫn là attack surface không cần thiết).
  2. `handle_student_session_login` không `SECURITY DEFINER` ⇒ caller phải có quyền SELECT/INSERT/UPDATE trên `student_active_sessions` và bảng liên quan. Nếu role gọi (service_role) có đủ quyền thì OK; nếu không → lỗi permission. Cần verify production.

### G.16 Migration classification

- **E. NOT SAFE TO PROCEED** cho lượt này — không thể verify production ⇒ không thể kết luận ZERO / ADDITIVE GRANT / ADDITIVE RPC / ADDITIVE INDEX.
- Khi owner cấp read-only view / diagnostics:
  - Nếu 8 tables + 2 index + 3 function + grants khớp → **A. ZERO MIGRATION**.
  - Nếu function đủ nhưng grant sai / thiếu → **B. ADDITIVE GRANT MIGRATION**.
  - Nếu function thiếu hoặc signature lệch → **C. ADDITIVE RPC MIGRATION**.
  - Nếu unique index thiếu hoặc sai → **D. ADDITIVE INDEX MIGRATION**.

### G.17 Blocker còn lại

1. **Production read-only access chưa có** — không thể xác minh schema/index/RPC/grant production. Đây là blocker duy nhất cho lượt này.
2. Nghi vấn từ migration (xem G.15 #1, #2) cần verify production trước khi quyết định migration additive.
3. `exchange-code.js` orphan (F.8, Q2) — không phải blocker schema, là blocker bypass path ở B1.
4. Portal CSRF logout (F.13 #3) — không phải blocker schema, là blocker bảo mật ở B2.

### G.18 READY hay NOT READY FOR RP2-B1

**NOT READY FOR RP2-B1**

Lý do (theo Bước 8):
- Không xác minh được 8 tables production.
- Không xác minh được unique index global active/email.
- Không xác minh được `handle_student_session_login` tồn tại / signature / advisory lock / default policy / block path.
- Không xác minh được grant cho principal Portal dùng.
- Do đó, không loại trừ được mismatch buộc migration trước B1 (có thể là B/C/D — chưa biết).

Điều kiện đạt (F.17): vẫn giữ nguyên từ lượt Phụ lục F.

### G.19 RECOMMENDED NEXT COMMAND

```text
Owner cấp read-only access production Supabase (một trong):
  (a) chạy các truy vấn metadata ở Bước 3 của prompt này trong Supabase SQL Editor
      và dán kết quả (đã ẩn mọi key/secret) vào issue/chat; hoặc
  (b) cấp service-role read-only (khuyến nghị tạo role riêng chỉ có USAGE/SELECT trên
      information_schema + pg_catalog + pg_proc, không phải service-role thật) để
      agent tự chạy truy vấn metadata.

Khi có kết quả production, owner (hoặc agent nếu cấp quyền) chạy lại Bước 6 để
phân loại migration (A/B/C/D/E) và cập nhật Phụ lục G.

Nếu kết quả = A (ZERO MIGRATION) → cập nhật plan thành READY FOR RP2-B1.
Nếu kết quả = B/C/D → đề xuất migration additive cụ thể (chưa tạo file) trong
cùng Phụ lục G; chờ owner duyệt.

Không tạo branch mới. Không sửa code cho tới khi READY = YES.
```

### G.20 Xác nhận thao tác (lượt này)

- Chỉ file `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md` thay đổi (thêm Phụ lục G).
- Không sửa source code.
- Không tạo file SQL migration.
- Không commit.
- Không push.
- Không deploy.
- Không set ENV.
- Không gọi RPC.
- Không đọc dữ liệu học viên thật.
- Không in secret, key, anon key, service-role key, ENV value.
- Không truy cập production (không có phương tiện read-only an toàn có sẵn).
- Không hiển thị connection string hay URL project đầy đủ.
- Branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9cc3344b803d7b4c271966e6fcda676d17` giữ nguyên.

**KẾT THÚC PHỤ LỤC G — chờ owner cấp read-only access production để xác minh schema/index/RPC/grant.**

> **Historical snapshot** (2026-07-14, trước khi owner cung cấp production metadata): phụ lục này mô tả trạng thái `NOT VERIFIED` cho 8 tables, 2 indexes, 3 function signatures, 3 grant sets. Mọi mục `NOT VERIFIED` ở G.3/G.5/G.7/G.13 đã được **supersede bởi Phụ lục I** (đối chiếu 8/8 CSV). Trạng thái `NOT READY FOR RP2-B1` ở G.18 đã được **supersede bởi Phụ lục K — RP2-B0 PRODUCTION APPLY RESULT**. Phương pháp "không truy cập production" ở G.1 vẫn đúng — agent không trực tiếp truy vấn production; Phụ lục I dựa trên CSV do owner export; Phụ lục K dựa trên re-verify table do owner cung cấp. Nội dung gốc của G giữ nguyên làm audit trail.

---

## Phụ lục H — PRODUCTION SCHEMA VERIFICATION (CSV ROLE_EXECUTE_CHECK, lượt 2026-07-14)

> Lượt này owner cung cấp file `docs/v2-new/Supabase Snippet Untitled query.csv` chứa **1 result set** duy nhất: `ROLE_EXECUTE_CHECK`. CSV **không** chứa `TABLES`, `COLUMNS`, `INDEXES`, `FUNCTION_SIGNATURES`, `FUNCTION_DEFINITIONS`, `ROUTINE_GRANTS`, `PUBLIC_EXECUTE_CHECK`.

### H.1 CSV metadata

| Mục | Giá trị |
|---|---|
| Đường dẫn | `_worktrees/v2-rebuild-20260714/docs/v2-new/Supabase Snippet Untitled query.csv` |
| Đã đọc thành công | **Có** |
| Tổng dòng | **9** (1 header + 8 data rows) |
| Số cột | **5** (`verification_group, function_name, role_name, has_execute, role_exists`) |
| Encoding | UTF-8 plain CSV, không BOM, dấu phẩy phân tách |
| Ký tự đặc biệt | Không |
| File có bị sửa? | **Không** (chỉ đọc) |

### H.2 Result set nhận diện

| # | Result set | Có trong CSV? | Cột khớp? |
|---|---|---|---|
| 1 | TABLES | **Không** | — |
| 2 | COLUMNS | **Không** | — |
| 3 | INDEXES | **Không** | — |
| 4 | FUNCTION_SIGNATURES | **Không** | — |
| 5 | FUNCTION_DEFINITIONS | **Không** | — |
| 6 | ROUTINE_GRANTS | **Không** | — |
| 7 | PUBLIC_EXECUTE_CHECK | **Không** | — |
| 8 | **ROLE_EXECUTE_CHECK** | **Có** (8 rows) | Đúng 5 cột: `verification_group, function_name, role_name, has_execute, role_exists` |

⇒ Chỉ có bằng chứng về role-grant; mọi kết luận về tables / columns / indexes / signatures / definitions đều **chưa đủ dữ liệu** ⇒ giữ trạng thái NOT VERIFIED cho các mục đó.

### H.3 Dữ liệu thô CSV

```
verification_group,function_name,role_name,has_execute,role_exists
ROLE_EXECUTE_CHECK,cleanup_student_account_risk_events,anon,false,true
ROLE_EXECUTE_CHECK,cleanup_student_account_risk_events,authenticated,false,true
ROLE_EXECUTE_CHECK,cleanup_student_account_risk_events,service_role,true,true
ROLE_EXECUTE_CHECK,handle_student_session_login,anon,true,true
ROLE_EXECUTE_CHECK,handle_student_session_login,authenticated,true,true
ROLE_EXECUTE_CHECK,handle_student_session_login,service_role,true,true
ROLE_EXECUTE_CHECK,reset_student_session_guard,anon,false,true
ROLE_EXECUTE_CHECK,reset_student_session_guard,authenticated,false,true
ROLE_EXECUTE_CHECK,reset_student_session_guard,service_role,true,true
```

### H.4 Production actual (rút ra từ CSV)

| Function | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---|---|---|
| `cleanup_student_account_risk_events` | **false** | **false** | **true** |
| `handle_student_session_login` | **true** | **true** | **true** |
| `reset_student_session_guard` | **false** | **false** | **true** |

`role_exists=true` cho cả 3 role × 3 function ⇒ Postgres role `anon`, `authenticated`, `service_role` đều tồn tại trong production cluster.

### H.5 Repo expected (rút ra từ migration files)

| Function | Migration | Repo expected EXECUTE |
|---|---|---|
| `cleanup_student_account_risk_events` | `migration_account_sharing_p1.sql:106-109` | PUBLIC REVOKED; anon REVOKED; authenticated REVOKED; **service_role GRANT** |
| `reset_student_session_guard` | `migration_account_sharing_p0_hardening.sql:181-184` | PUBLIC REVOKED; anon REVOKED; authenticated REVOKED; **service_role GRANT** |
| `handle_student_session_login` | `migration_atomic_session_guard.sql:99-238` | **Không có** `REVOKE/GRANT` block trong file ⇒ Postgres default: `PUBLIC EXECUTE` (kế thừa cả `anon` + `authenticated` + `service_role`) |

### H.6 OBJECT × RESULT SET × Repo expected × Production actual × MATCH × SECURITY ISSUE × ACTION

| OBJECT | RESULT SET | REPO EXPECTED | PRODUCTION ACTUAL | MATCH | SECURITY ISSUE | ACTION |
|---|---|---|---|---|---|---|
| `handle_student_session_login` anon EXECUTE | ROLE_EXECUTE_CHECK | anon REVOKE (nhưng migration không có lệnh này ⇒ repo EXPECTED rỗng; migration EXPECTED = PUBLIC default = **TRUE**) | **true** | MATCH (migration không revoke ⇒ production giữ default `PUBLIC EXECUTE` cho anon) | **CÓ — CẢNH BÁO CAO**: anon bất kỳ có thể gọi `handle_student_session_login(email, portal_device_id, new_student_session_id, ...)` qua PostgREST/Supabase REST mà không cần auth. Function có advisory lock + check status, nhưng vẫn: (a) cho phép spam call gây log/insert noise; (b) nếu lộ email + `portal_device_id` có thể trigger block branch làm giả availability; (c) đây là attack surface không cần thiết — không có caller client-side nào cần anon role gọi RPC này (Portal dùng service_role qua `lmsSupabaseAdmin`). | Additive migration: `REVOKE ALL ON FUNCTION public.handle_student_session_login(...) FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;` — đồng bộ pattern với `reset_student_session_guard` / `cleanup_student_account_risk_events`. Đặt vào bucket **B. ADDITIVE GRANT MIGRATION**. |
| `handle_student_session_login` authenticated EXECUTE | ROLE_EXECUTE_CHECK | Migration EXPECTED = TRUE (PUBLIC default). Portal EXPECTED = FALSE (Portal dùng service_role). | **true** | MATCH migration / MISMATCH portal-practical | **CÓ — CẢNH BÁO TRUNG BÌNH**: authenticated client (JWT học viên) có thể gọi RPC qua Supabase client của LMS HTML (anon key) — bề mặt không cần thiết. So với anon, rủi ro thấp hơn (cần biết email hợp lệ + portal_device_id) nhưng vẫn là đường bypass tiềm năng nếu ai đó craft payload đúng. | Revoke authenticated (cùng migration additive ở trên). |
| `handle_student_session_login` service_role EXECUTE | ROLE_EXECUTE_CHECK | TRUE (Portal caller dùng service_role) | **true** | **MATCH** | Không | Không |
| `reset_student_session_guard` anon EXECUTE | ROLE_EXECUTE_CHECK | FALSE (migration revoke) | **false** | **MATCH** | Không | Không |
| `reset_student_session_guard` authenticated EXECUTE | ROLE_EXECUTE_CHECK | FALSE | **false** | **MATCH** | Không | Không |
| `reset_student_session_guard` service_role EXECUTE | ROLE_EXECUTE_CHECK | TRUE | **true** | **MATCH** | Không | Không |
| `cleanup_student_account_risk_events` anon EXECUTE | ROLE_EXECUTE_CHECK | FALSE | **false** | **MATCH** | Không | Không |
| `cleanup_student_account_risk_events` authenticated EXECUTE | ROLE_EXECUTE_CHECK | FALSE | **false** | **MATCH** | Không | Không |
| `cleanup_student_account_risk_events` service_role EXECUTE | ROLE_EXECUTE_CHECK | TRUE | **true** | **MATCH** | Không | Không |

### H.7 Bảng matrix tổng hợp (yêu cầu đầu ra #7)

| OBJECT | RESULT SET | REPO EXPECTED | PRODUCTION ACTUAL | MATCH | SECURITY ISSUE | ACTION |
|---|---|---|---|---|---|---|
| 8 bảng (`student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`, `student_session_controls`, `student_device_change_logs`, `admin_audit_logs`, `student_account_risk_reviews`, `student_account_admin_notes`) | TABLES (không có trong CSV) | Có migration | NOT VERIFIED | — | Chưa biết | Export `TABLES` |
| Index `idx_one_active_student_session_per_email` | INDEXES (không có trong CSV) | UNIQUE partial `lower(email) WHERE status='active'` | NOT VERIFIED | — | Chưa biết | Export `INDEXES` |
| Index idempotency `idx_student_device_logs_event_idempotency` | INDEXES (không có trong CSV) | UNIQUE partial trên `event_idempotency_key` | NOT VERIFIED | — | Chưa biết | Export `INDEXES` |
| Function `handle_student_session_login` signature | FUNCTION_SIGNATURES (không có trong CSV) | `(text,text,text,text,text,text,text,text,text,integer)` RETURNS jsonb | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_SIGNATURES` |
| Function `reset_student_session_guard` signature | FUNCTION_SIGNATURES (không có trong CSV) | `(text,text,text)` RETURNS jsonb SECURITY DEFINER | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_SIGNATURES` |
| Function `cleanup_student_account_risk_events` signature | FUNCTION_SIGNATURES (không có trong CSV) | `(integer)` RETURNS jsonb SECURITY DEFINER | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_SIGNATURES` |
| Advisory lock email trong `handle_student_session_login` | FUNCTION_DEFINITIONS (không có trong CSV) | `pg_advisory_xact_lock(hashtext(v_email))` | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_DEFINITIONS` |
| Default policy `'block'` | FUNCTION_DEFINITIONS (không có trong CSV) | `p_conflict_policy DEFAULT 'block'` | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_DEFINITIONS` |
| Same-device reuse path | FUNCTION_DEFINITIONS (không có trong CSV) | RETURN `{ok:true, action:'reused', ...}` khi same `portal_device_id` | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_DEFINITIONS` |
| Other-device block path | FUNCTION_DEFINITIONS (không có trong CSV) | RETURN `{ok:false, action:'blocked', reason:'active_session_on_another_device', ...}` không supersede A | NOT VERIFIED | — | Chưa biết | Export `FUNCTION_DEFINITIONS` |
| Grant EXECUTE cho `anon`/`authenticated`/`service_role` của 3 function | ROLE_EXECUTE_CHECK | như H.5 | như H.4 | xem H.6 | xem H.6 | Revoke additive cho `handle_student_session_login` |

### H.8 Kết luận security & migration

**Phát hiện duy nhất có bằng chứng production trong lượt này:**

- **Grant của `handle_student_session_login` quá rộng.** CSV cho thấy anon và authenticated đều có EXECUTE trên production. Repo migration không revoke ⇒ production giữ default `PUBLIC EXECUTE` (Postgres). Đây là **security issue** thực tế cần migration additive hardening.
- Hai function còn lại (`reset_student_session_guard`, `cleanup_student_account_risk_events`) khớp kỳ vọng repo: chỉ `service_role` có EXECUTE.

**Mọi kết luận khác (8 tables, idx_one_active_student_session_per_email, idempotency index, signature, advisory lock, default policy, same-device, other-device, supersede branch):** CSV không cung cấp bằng chứng. **Không** được kết luận. Giữ nguyên **NOT VERIFIED**.

### H.9 Migration classification (lượt này)

Phân loại **D. ADDITIVE GRANT MIGRATION** cho `handle_student_session_login`:

- Bảng, cột, index, signature, function body đều **chưa verify production** ⇒ không loại trừ khả năng A (zero-migration) hoàn toàn, cũng không xác nhận B (chỉ grant) là đủ. CSV mới xác nhận được **một** mục B: revoke + grant additive cho `handle_student_session_login`.
- Nếu sau khi export các result set còn thiếu (H.10) mà schema/index/RPC đều khớp ⇒ phân loại cuối cùng vẫn là **D. ADDITIVE GRANT MIGRATION** (chỉ khác block GRANT).
- Nếu export tiếp phát hiện signature lệch hoặc index thiếu ⇒ có thể leo thành **C. ADDITIVE RPC MIGRATION** hoặc **D2. ADDITIVE INDEX MIGRATION** (kết hợp grant).

**Phân loại tạm thời lượt này:** **D. ADDITIVE GRANT MIGRATION** (revoke `handle_student_session_login` cho PUBLIC/anon/authenticated + grant service_role).

### H.10 Result set còn thiếu (cần export tiếp)

Để đối chiếu đủ theo Bước 9 của prompt, cần owner chạy tiếp các truy vấn sau trong Supabase SQL Editor (read-only) và dán kết quả (đã ẩn key/secret) vào issue/chat — hoặc cấp service-role read-only an toàn cho agent tự chạy:

1. **TABLES** — xác nhận 8 bảng tồn tại.
2. **COLUMNS** — xác nhận các cột bắt buộc (`event_idempotency_key`, `event_type`, `course_slug`, `lms_device_id`, `portal_device_id`, ...).
3. **INDEXES** — xác nhận `idx_one_active_student_session_per_email` và `idx_student_device_logs_event_idempotency` tồn tại với đặc tả đúng.
4. **FUNCTION_SIGNATURES** — xác nhận `pg_get_function_identity_arguments` của 3 function khớp.
5. **FUNCTION_DEFINITIONS** — xác nhận `pg_get_functiondef` chứa `pg_advisory_xact_lock(hashtext(v_email))`, default `'block'`, branch `reused`, branch `blocked`, branch `supersede` (chỉ chạy khi policy='supersede').
6. **PUBLIC_EXECUTE_CHECK** — xác nhận `has_function_privilege('PUBLIC', ...)` cho 3 function (CSV hiện chỉ check 3 role cụ thể, không check riêng `PUBLIC`).
7. **ROUTINE_GRANTS** — danh sách đầy đủ grantee/privilege (CSV chỉ liệt kê 3 role × 3 function; không có view đầy đủ).

### H.11 READY hay NOT READY FOR RP2-B1

**NOT READY FOR RP2-B1**

Lý do (theo Bước 9 + 10):

- **CSV chỉ cung cấp 1/8 result set** (`ROLE_EXECUTE_CHECK`). Các kết luận về 8 bảng, unique partial index, idempotency index, `handle_student_session_login` signature, advisory lock, default policy, same-device path, other-device path đều **chưa đủ bằng chứng production**.
- Mặc dù grant anomaly trên `handle_student_session_login` đã được phát hiện rõ (anon + authenticated có EXECUTE) ⇒ có **1 migration additive GRANT** chắc chắn cần, nhưng:
  - Không biết signature production khớp repo hay không ⇒ nếu lệch, cần `CREATE OR REPLACE` migration.
  - Không biết index `idx_one_active_student_session_per_email` đã apply chưa ⇒ nếu thiếu, phải `CREATE UNIQUE INDEX` (idempotent).
  - Không biết tables đã tồn tại chưa ⇒ nếu thiếu, phải `CREATE TABLE` (idempotent).
- ⇒ **Không** thể chốt loại migration cuối cùng (A/B/C/D) cho tới khi có đủ result set.
- ⇒ Giữ trạng thái **NOT READY FOR RP2-B1** (đồng thời với F.17, G.18).

### H.12 RECOMMENDED NEXT COMMAND

```text
Owner chạy tiếp các truy vấn metadata read-only trong Supabase SQL Editor
  cho 7 result set còn thiếu: TABLES, COLUMNS, INDEXES,
  FUNCTION_SIGNATURES, FUNCTION_DEFINITIONS, PUBLIC_EXECUTE_CHECK, ROUTINE_GRANTS.
Dán kết quả (đã ẩn key/secret) vào issue/chat, hoặc cấp read-only service-role
an toàn để agent tự chạy.

Khi có đủ 8 result set:
  - Nếu 8 tables + 2 index + 3 signature khớp + body khớp → migration cuối = D (chỉ GRANT).
  - Nếu signature/body lệch → leo thang C (RPC migration).
  - Nếu index thiếu → bổ sung D (INDEX migration additive).
  - Nếu tables thiếu → bổ sung migration additive cho table.

Trước khi bật flag V2_GLOBAL_ONE_DEVICE_ENABLED:
  - Migration additive GRANT cho handle_student_session_login
    (REVOKE PUBLIC/anon/authenticated; GRANT service_role) phải được apply.
  - Tái xác minh ROLE_EXECUTE_CHECK để chắc chắn anon/authenticated = false.
  - Staging verify Portal vẫn gọi được RPC (service_role có EXECUTE).

Không tạo branch mới. Không sửa code cho tới khi READY = YES.
```

### H.13 Xác nhận thao tác (lượt này)

- Chỉ file `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md` thay đổi (thêm Phụ lục H).
- Không sửa source code (LMS hay Portal).
- Không tạo file SQL migration.
- Không commit.
- Không push.
- Không deploy.
- Không set ENV.
- Không gọi RPC.
- Không đọc dữ liệu học viên thật.
- Không in secret, key, anon key, service-role key, ENV value.
- CSV `Supabase Snippet Untitled query.csv` không bị sửa, không bị xóa.
- 8 file CSV trong `docs/v2-new/supabase-verification/` không bị sửa, không bị xóa.
- Branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9cc3344b803d7b4c271966e6fcda676d17` giữ nguyên.

**KẾT THÚC PHỤ LỤC H — chờ owner cung cấp 7 result set còn thiếu để chốt READY FOR RP2-B1.**

---

## Phụ lục I — FULL RESULT-SET VERIFICATION (8/8 CSV, lượt 2026-07-14)

> Lượt này owner cung cấp **đủ 8 result set** trong `docs/v2-new/supabase-verification/` (kèm `role_execute.csv` trùng nội dung `ROLE_EXECUTE_CHECK` của H). Tất cả bằng chứng dưới đây dựa trên CSV thật, không phải suy luận.

### I.1 Metadata CSV

| File | Rows | Group | Cột |
|---|---|---|---|
| `01_tables.csv` | 7 (+1 header) | TABLES | `verification_group, table_schema, table_name` |
| `02_columns.csv` | 99 (+1 header) | COLUMNS | `verification_group, table_name, column_name, data_type, udt_name, is_nullable, column_default` |
| `03_indexes.csv` | 12 (+1 header) | INDEXES | `verification_group, schemaname, tablename, indexname, indexdef` |
| `04_function_signatures.csv` | 2 (+1 header) | FUNCTION_SIGNATURES | `verification_group, schema_name, function_name, identity_arguments, full_arguments, result_type, security_definer, function_owner` |
| `05_function_definitions.csv` | 2 records (+1 header) | FUNCTION_DEFINITIONS | `verification_group, function_name, function_definition` |
| `06_public_execute.csv` | 2 (+1 header) | PUBLIC_EXECUTE_CHECK | `verification_group, schema_name, function_name, public_has_execute` |
| `07_routine_grants.csv` | 8 (+1 header) | ROUTINE_GRANTS | `verification_group, routine_schema, routine_name, grantee, privilege_type` |
| `role_execute.csv` | 8 (+1 header) | ROLE_EXECUTE_CHECK | `verification_group, function_name, role_name, has_execute, role_exists` |

⇒ Đủ **8/8** result set theo Bước 1.

### I.2 Kết quả — 8 bảng

| # | Bảng | Production EXISTS (TABLES) | Migration nguồn (repo) |
|---|---|---|---|
| 1 | `admin_audit_logs` | ✅ | `migration_account_sharing_alerts.sql:91-100` |
| 2 | `lms_entry_tokens` | ✅ | `migration_student_session_guard.sql:20-35` |
| 3 | `lms_verified_sessions` | ✅ | `migration_student_session_guard.sql:37-54` |
| 4 | `student_account_admin_notes` | ✅ | `migration_account_sharing_alerts.sql:80-86` |
| 5 | `student_account_risk_reviews` | ✅ | `migration_account_sharing_alerts.sql:53-72` |
| 6 | `student_active_sessions` | ✅ | `migration_student_session_guard.sql:4-18` |
| 7 | `student_device_change_logs` | ✅ | `migration_account_sharing_alerts.sql:5-19` (atomic cũng có table ở line 44-58) |
| 8 | `student_session_controls` | ✅ | `migration_account_sharing_p0_hardening.sql:56-65` |

⇒ 8/8 tables MATCH.

### I.3 Kết quả — Cột bắt buộc

So với `02_columns.csv` + 4 migration file:

| Bảng | Cột kiểm tra | Có ở CSV? | MATCH? |
|---|---|---|---|
| `student_active_sessions` | `email`, `student_session_id`, `portal_device_id`, `status`, `login_at`, `last_seen_at`, `logout_at`, `ip`, `user_agent`, `created_at`, `updated_at`, `device_hash`, `device_label`, `ip_hash` | ✅ đủ (lines 56-70) | ✅ |
| `lms_entry_tokens` | `token_hash`, `email`, `student_session_id`, `portal_device_id`, `course_slug`, `post_id`, `status`, `created_at`, `expires_at`, `used_at`, `created_ip`, `created_user_agent` | ✅ đủ (lines 10-22) | ✅ |
| `lms_verified_sessions` | `lms_session_id`, `email`, `student_session_id`, `lms_device_id`, `course_slug`, `entry_token_id`, `status`, `verified_at`, `last_seen_at`, `logout_at`, `ip`, `user_agent` | ✅ đủ (lines 23-37) | ✅ |
| `student_device_change_logs` | `action`, `event_type`, `course_slug`, `lms_device_hash`, `lms_session_hash`, `risk_points`, `metadata`, `admin_email`, **`event_idempotency_key`**, `correlation_id`, `request_id`, `flow_id`, `result`, `reason_code`, `schema_version`, `hash_version` | ✅ đủ (lines 71-100) | ✅ |
| `student_session_controls` | `id` (+ các cột khác) | `id` có (line 101) | ✅ (id xác nhận) |
| `student_account_risk_reviews` | `monitoring_until`, `resolved_at`, `false_positive_at` (P1) | ✅ đủ (lines 53-55) | ✅ |
| `student_account_admin_notes` | `id`, `email`, `admin_email`, `note`, `created_at` | ✅ đủ (lines 38-42) | ✅ |
| `admin_audit_logs` | `id`, `admin_email`, `action`, `target_email`, `metadata`, `ip_hash`, `user_agent`, `created_at` | ✅ đủ (lines 2-9) | ✅ |

⇒ Tất cả cột bắt buộc MATCH production.

### I.4 Kết quả — Index quan trọng

| Index | Production (INDEXES) | Repo expected (migration) | MATCH |
|---|---|---|---|
| `idx_one_active_student_session_per_email` | `CREATE UNIQUE INDEX idx_one_active_student_session_per_email ON public.student_active_sessions USING btree (lower(email)) WHERE (status = 'active'::text)` (line 2) | `migration_atomic_session_guard.sql:40-42` UNIQUE partial `lower(email) WHERE status='active'` | ✅ MATCH |
| `idx_student_device_logs_event_idempotency` | `CREATE UNIQUE INDEX idx_student_device_logs_event_idempotency ON public.student_device_change_logs USING btree (event_idempotency_key) WHERE (event_idempotency_key IS NOT NULL)` (line 10) | `migration_account_sharing_p0_hardening.sql:52-54` UNIQUE partial `event_idempotency_key WHERE ... IS NOT NULL` | ✅ MATCH |

⇒ 2/2 index quan trọng MATCH.

### I.5 Kết quả — 3 function (signature / return / security / owner / advisory lock / default / same-device / other-device / không supersede khi block)

| Thuộc tính | `handle_student_session_login` | `reset_student_session_guard` | `cleanup_student_account_risk_events` |
|---|---|---|---|
| **Identity arguments** | `p_email text, p_portal_device_id text, p_new_student_session_id text, p_device_hash text, p_device_label text, p_ip text, p_ip_hash text, p_user_agent text, p_conflict_policy text, p_idle_hours integer` (`04`:3) | `p_retention_days integer` (`04`:2) — chờ, sai; row 3 mới đúng: `p_email text, p_admin_email text, p_reason text` | `p_retention_days integer` (`04`:2) |
| **Return type** | `jsonb` | `jsonb` | `jsonb` |
| **SECURITY DEFINER** | **false** (INVOKER) | true | true |
| **Owner** | postgres | postgres | postgres |
| **Advisory lock** | ✅ `PERFORM pg_advisory_xact_lock(hashtext(v_email));` (`05`:64) | ✅ `PERFORM pg_advisory_xact_lock(hashtext('reset_student_session_guard:' || v_email));` (`05`:190) | N/A (cleanup không cần) |
| **Default `block` (login)** | ✅ `v_policy := lower(trim(coalesce(p_conflict_policy, 'block')));` (`05`:46); arg default `'block'::text` (`04`:3) | N/A | N/A |
| **Same-device reuse** | ✅ ELSIF `v_existing.portal_device_id = p_portal_device_id` → UPDATE last_seen + RETURN `action:'reused'` (`05`:94-110) | N/A | N/A |
| **Other-device block (không supersede A)** | ✅ ELSE nhánh cuối RETURN `{ok:false, action:'blocked', reason:'active_session_on_another_device', ...}` (`05`:142-149); **KHÔNG** UPDATE `student_active_sessions` sang `superseded` khi block | N/A | N/A |
| **Không supersede A khi policy = `block`** | ✅ nhánh `supersede` (`05`:111-141) chỉ chạy khi `v_policy = 'supersede'` (`05`:111) | N/A | N/A |
| **Idempotent admin reset** | N/A | ✅ lock + update active only; 0 rows vẫn OK (DB-level idempotent) | N/A |

⇒ Tất cả thuộc tính kỳ vọng đều MATCH production.

### I.6 Kết quả — Grants

Tổng hợp từ `06_public_execute.csv`, `07_routine_grants.csv`, `role_execute.csv`:

| Function | PUBLIC EXECUTE | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---|---|---|---|
| `handle_student_session_login` | **true** (`06`:3) | **true** (`07`:5, `role_execute`:5) | **true** (`07`:6, `role_execute`:6) | **true** (`07`:7, `role_execute`:7) |
| `reset_student_session_guard` | false (`06`:4) | false (`07`:9, `role_execute`:8-10) | false | true |
| `cleanup_student_account_risk_events` | false (`06`:2) | false (`07`:2-3, `role_execute`:2-4) | false | true |

Production đối chiếu repo:

| Function | Repo (migration) | Production | MATCH | SECURITY ISSUE |
|---|---|---|---|---|
| `reset_student_session_guard` | REVOKE PUBLIC/anon/authenticated + GRANT service_role (`migration_account_sharing_p0_hardening.sql:181-184`) | Đúng: PUBLIC/anon/auth=false, service_role=true | ✅ | Không |
| `cleanup_student_account_risk_events` | REVOKE PUBLIC/anon/authenticated + GRANT service_role (`migration_account_sharing_p1.sql:106-109`) | Đúng | ✅ | Không |
| `handle_student_session_login` | **Không có** REVOKE/GRANT trong `migration_atomic_session_guard.sql:99-238` ⇒ default = `PUBLIC EXECUTE` (Postgres) | Production giữ default = PUBLIC true, anon true, authenticated true, service_role true | ✅ MATCH repo (migration) | **CÓ** — anon + authenticated + PUBLIC đều gọi được RPC. Owner chưa chốt nhưng theo F.3/F.6/F.14 plan: chỉ service_role được phép. |

### I.7 OBJECT × RESULT SET × REPO EXPECTED × PRODUCTION ACTUAL × MATCH × SECURITY ISSUE × ACTION

| OBJECT | RESULT SET | REPO EXPECTED | PRODUCTION ACTUAL | MATCH | SECURITY ISSUE | ACTION |
|---|---|---|---|---|---|---|
| 8 tables (`admin_audit_logs`, `lms_entry_tokens`, `lms_verified_sessions`, `student_account_admin_notes`, `student_account_risk_reviews`, `student_active_sessions`, `student_device_change_logs`, `student_session_controls`) | `01_tables.csv` | 8/8 có migration | 8/8 EXISTS | ✅ MATCH | Không | Không |
| Cột bắt buộc (gồm `event_idempotency_key`, `device_hash`, `device_label`, `ip_hash`, `lms_device_id`, `portal_device_id`, `student_session_id`, `lms_session_id`, `token_hash`, `course_slug`, `entry_token_id`, `monitoring_until`, ...) | `02_columns.csv` | Theo 4 migration | Có đủ (xem I.3) | ✅ MATCH | Không | Không |
| `idx_one_active_student_session_per_email` | `03_indexes.csv` line 2 | UNIQUE partial `lower(email) WHERE status='active'` | UNIQUE partial khớp | ✅ MATCH | Không | Không |
| `idx_student_device_logs_event_idempotency` | `03_indexes.csv` line 10 | UNIQUE partial trên `event_idempotency_key` | UNIQUE partial khớp | ✅ MATCH | Không | Không |
| `handle_student_session_login` signature | `04_function_signatures.csv` row 3 | `(text,text,text,text,text,text,text,text,text,integer)` | Khớp | ✅ MATCH | Không | Không |
| `handle_student_session_login` return | `04_function_signatures.csv` row 3 | `jsonb` | `jsonb` | ✅ | Không | Không |
| `handle_student_session_login` security | `04_function_signatures.csv` row 3 | `security_definer=false` (INVOKER) | `false` | ✅ | Không | Không |
| `handle_student_session_login` owner | `04_function_signatures.csv` row 3 | `postgres` | `postgres` | ✅ | Không | Không |
| `handle_student_session_login` advisory lock | `05_function_definitions.csv` line 64 | `pg_advisory_xact_lock(hashtext(v_email))` | Có | ✅ | Không | Không |
| `handle_student_session_login` default policy `'block'` | `04_function_signatures.csv` row 3 + `05`:46 | `'block'::text DEFAULT 'block'::text` + coalesce fallback | Khớp | ✅ | Không | Không |
| `handle_student_session_login` same-device reuse | `05_function_definitions.csv` lines 94-110 | ELSIF `portal_device_id` match → UPDATE last_seen + RETURN `action:'reused'` | Khớp | ✅ | Không | Không |
| `handle_student_session_login` other-device block | `05_function_definitions.csv` lines 142-149 | ELSE RETURN `{ok:false, action:'blocked', reason:'active_session_on_another_device', ...}`, không supersede A | Khớp | ✅ | Không | Không |
| `handle_student_session_login` không supersede A khi policy block | `05_function_definitions.csv` lines 111-141 + 142-149 | Nhánh `supersede` chỉ chạy khi `v_policy='supersede'` | Khớp | ✅ | Không | Không |
| `reset_student_session_guard` signature/return/security/owner/advisory | `04_function_signatures.csv` row 4 + `05`:172-275 | `(text,text,text)` jsonb SECURITY DEFINER postgres + `pg_advisory_xact_lock(hashtext('reset_student_session_guard:' || v_email))` | Khớp | ✅ MATCH | Không | Không |
| `cleanup_student_account_risk_events` signature/return/security/owner | `04_function_signatures.csv` row 2 + `05`:1-38 | `(integer)` jsonb SECURITY DEFINER postgres | Khớp | ✅ MATCH | Không | Không |
| PUBLIC EXECUTE trên `handle_student_session_login` | `06_public_execute.csv` row 3 | Migration không revoke → default `true` | `true` | ✅ MATCH migration | **CÓ** — PUBLIC có EXECUTE; cần REVOKE | Migration hardening revoke |
| anon EXECUTE trên `handle_student_session_login` | `07_routine_grants.csv` row 5 + `role_execute.csv` row 5 | Migration không revoke → default `true` | `true` | ✅ MATCH migration / **MISMATCH owner-policy** | **CÓ — CAO** — anon bất kỳ gọi được RPC qua PostgREST/anon-key | Migration hardening revoke |
| authenticated EXECUTE trên `handle_student_session_login` | `07_routine_grants.csv` row 6 + `role_execute.csv` row 6 | Migration không revoke → default `true` | `true` | ✅ MATCH migration / **MISMATCH owner-policy** | **CÓ — TRUNG BÌNH** | Migration hardening revoke |
| service_role EXECUTE trên `handle_student_session_login` | `07_routine_grants.csv` row 7 + `role_execute.csv` row 7 | `true` (Portal dùng service_role) | `true` | ✅ MATCH | Không | Không |
| PUBLIC EXECUTE trên `reset_student_session_guard` | `06_public_execute.csv` row 4 | Migration REVOKE | `false` | ✅ MATCH | Không | Không |
| anon/authenticated/service_role EXECUTE trên `reset_student_session_guard` | `07_routine_grants.csv` rows 9-10 + `role_execute.csv` rows 8-10 | Migration REVOKE anon/auth + GRANT service_role | `false/false/true` | ✅ MATCH | Không | Không |
| PUBLIC EXECUTE trên `cleanup_student_account_risk_events` | `06_public_execute.csv` row 2 | Migration REVOKE | `false` | ✅ MATCH | Không | Không |
| anon/authenticated/service_role EXECUTE trên `cleanup_student_account_risk_events` | `07_routine_grants.csv` rows 2-3 + `role_execute.csv` rows 2-4 | Migration REVOKE anon/auth + GRANT service_role | `false/false/true` | ✅ MATCH | Không | Không |

### I.8 Bảng matrix đầy đủ (theo yêu cầu #7)

| OBJECT | REPO EXPECTED | PRODUCTION ACTUAL | MATCH | SECURITY ISSUE | ACTION |
|---|---|---|---|---|---|
| 8 tables | 8/8 có migration | 8/8 EXISTS | ✅ | Không | Không |
| Cột bắt buộc | Đầy đủ | Đầy đủ (99 rows COLUMNS) | ✅ | Không | Không |
| `idx_one_active_student_session_per_email` | UNIQUE partial `lower(email) WHERE status='active'` | UNIQUE partial btree `(lower(email)) WHERE (status='active')` | ✅ | Không | Không |
| `idx_student_device_logs_event_idempotency` | UNIQUE partial trên `event_idempotency_key` | UNIQUE partial btree `(event_idempotency_key) WHERE IS NOT NULL` | ✅ | Không | Không |
| `handle_student_session_login` signature | `(text,text,text,text,text,text,text,text,text,integer)` | Khớp | ✅ | Không | Không |
| `handle_student_session_login` return | `jsonb` | `jsonb` | ✅ | Không | Không |
| `handle_student_session_login` security mode | INVOKER | INVOKER | ✅ | Không | Không |
| `handle_student_session_login` owner | postgres | postgres | ✅ | Không | Không |
| `handle_student_session_login` advisory lock | `pg_advisory_xact_lock(hashtext(v_email))` | Có | ✅ | Không | Không |
| `handle_student_session_login` default `'block'` | default arg `'block'` | `'block'::text DEFAULT 'block'::text` | ✅ | Không | Không |
| `handle_student_session_login` same-device reuse | ELSIF portal_device_id match → touch + RETURN `'reused'` | Khớp | ✅ | Không | Không |
| `handle_student_session_login` other-device block | ELSE RETURN `{ok:false, action:'blocked', reason:'active_session_on_another_device', ...}`, không update A | Khớp | ✅ | Không | Không |
| `handle_student_session_login` không supersede A khi policy=`block` | Nhánh `supersede` chỉ chạy khi `v_policy='supersede'` | Khớp | ✅ | Không | Không |
| `reset_student_session_guard` signature / return / security / owner / advisory | `(text,text,text)` jsonb SECURITY DEFINER postgres + `pg_advisory_xact_lock(hashtext('reset_student_session_guard:'||v_email))` | Khớp | ✅ | Không | Không |
| `cleanup_student_account_risk_events` signature / return / security / owner | `(integer)` jsonb SECURITY DEFINER postgres | Khớp | ✅ | Không | Không |
| `handle_student_session_login` PUBLIC EXECUTE | Migration không revoke ⇒ default = true | true (`06`:3) | ✅ MATCH migration | **CÓ** — attack surface | REVOKE PUBLIC additive |
| `handle_student_session_login` anon EXECUTE | Migration không revoke ⇒ default = true | true (`07`:5, `role_execute`:5) | ✅ MATCH migration | **CÓ — CAO** | REVOKE anon additive |
| `handle_student_session_login` authenticated EXECUTE | Migration không revoke ⇒ default = true | true (`07`:6, `role_execute`:6) | ✅ MATCH migration | **CÓ — TRUNG BÌNH** | REVOKE authenticated additive |
| `handle_student_session_login` service_role EXECUTE | true (Portal caller) | true (`07`:7, `role_execute`:7) | ✅ MATCH | Không | Không |
| `reset_student_session_guard` PUBLIC / anon / authenticated / service_role | REVOKE PUBLIC/anon/auth + GRANT service_role | `06`:4 false; `07`:9-10 chỉ postgres+service_role; `role_execute`:8-10 chỉ service_role | ✅ MATCH | Không | Không |
| `cleanup_student_account_risk_events` PUBLIC / anon / authenticated / service_role | REVOKE PUBLIC/anon/auth + GRANT service_role | `06`:2 false; `07`:2-3 chỉ postgres+service_role; `role_execute`:2-4 chỉ service_role | ✅ MATCH | Không | Không |

### I.9 Kết luận migration cuối cùng

**Phân loại chính xác cần tạo: B. ADDITIVE GRANT MIGRATION (kết hợp thuần tuý về GRANT).**

Lý do:
- **8/8 tables EXISTS** ở production → không cần `CREATE TABLE`.
- **Cột bắt buộc** đầy đủ → không cần `ALTER TABLE ADD COLUMN`.
- **2 index bắt buộc** (`idx_one_active_student_session_per_email`, `idx_student_device_logs_event_idempotency`) đều EXISTS với đặc tả khớp → không cần `CREATE INDEX`.
- **3 function signature / return / security mode / owner** đều khớp → không cần `CREATE OR REPLACE FUNCTION`. Body chứa `pg_advisory_xact_lock(hashtext(v_email))`, default `'block'`, nhánh `reused`, nhánh `blocked`, nhánh `supersede` (chỉ chạy khi `v_policy='supersede'`) đều đúng migration → không cần `CREATE OR REPLACE`.
- **`reset_student_session_guard`** + **`cleanup_student_account_risk_events`**: grants đã đúng (PUBLIC/anon/auth=false, service_role=true) → không cần sửa grant.
- ❗ **`handle_student_session_login`**: anon/authenticated/PUBLIC đều có EXECUTE (do migration gốc không `REVOKE`). Migration hardening additive cần:
  - `REVOKE ALL ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;`
  - `GRANT EXECUTE ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) TO service_role;`
  - ⇒ Đồng bộ pattern với `reset_student_session_guard` / `cleanup_student_account_risk_events`.

**Tên file migration đề xuất (chưa tạo, chờ owner duyệt):**
`migration_handle_student_session_login_grants_hardening.sql`

**Nội dung tối thiểu (chưa tạo trong repo):**

```sql
-- Lock down handle_student_session_login grants to service_role only.
-- Portal server (lmsSupabaseAdmin) calls via service_role; anon/authenticated
-- do not need EXECUTE and the production default PUBLIC EXECUTE leaks attack surface.
-- Additive, idempotent. Does not change function body, signature, return type,
-- security mode, owner, advisory lock, default policy, branch behavior.
-- Apply on the Supabase B / LMS runtime database after migration_atomic_session_guard.sql
-- and before enabling V2_GLOBAL_ONE_DEVICE_ENABLED.

REVOKE ALL ON FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.handle_student_session_login(
  text, text, text, text, text, text, text, text, text, integer
) TO service_role;
```

### I.10 READY hay NOT READY FOR RP2-B1

**CONDITIONAL READY FOR RP2-B1**

Lý do (theo Bước 11):

**Điều kiện đạt:**
- ✅ 8/8 tables EXISTS production (verified).
- ✅ Cột bắt buộc đầy đủ (verified).
- ✅ `idx_one_active_student_session_per_email` UNIQUE partial EXISTS đúng đặc tả.
- ✅ `idx_student_device_logs_event_idempotency` UNIQUE partial EXISTS đúng đặc tả.
- ✅ `handle_student_session_login` signature / return / security / owner / advisory lock / default `'block'` / same-device reuse / other-device block / không supersede khi policy=`block` đều khớp kỳ vọng migration.
- ✅ `reset_student_session_guard` + `cleanup_student_account_risk_events` signature / security / owner / advisory / grants đều đúng.
- ✅ Portal caller truyền `p_conflict_policy='block'` (F.2 đã verify source).
- ✅ Không có path nào trong LMS/Portal/Repo chọn `'supersede'`.

**Điều kiện còn (blocker duy nhất):**
- ❗ Migration hardening GRANT cho `handle_student_session_login` chưa apply production (anon + authenticated + PUBLIC đều có EXECUTE; cần revoke + grant service_role).
- ⇒ Sau khi apply migration `migration_handle_student_session_login_grants_hardening.sql` và re-check `ROLE_EXECUTE_CHECK` xác nhận anon=false, authenticated=false → READY FOR RP2-B1.

**Không còn blocker khác:**
- `exchange-code.js` orphan — không phải blocker schema (xử lý ở F.8/Q2, B1 router guard hoặc xoá file).
- Portal CSRF logout — không phải blocker schema (B2 xử lý).
- Sign-out flow / B1 code — không phải blocker schema (F.14 scope đã điều chỉnh).

### I.11 Migration cần tạo (chính xác)

**Đúng 1 file, additive, idempotent, không destructive:**

| Tên (đề xuất) | Loại | Nội dung |
|---|---|---|
| `migration_handle_student_session_login_grants_hardening.sql` | B. ADDITIVE GRANT MIGRATION | 4 câu lệnh `REVOKE` (PUBLIC, anon, authenticated) + 1 câu `GRANT EXECUTE TO service_role` cho `handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)` (xem I.9) |

Các thuộc tính migration:
- Additive (không drop, không rename, không type change).
- Idempotent (Postgres `REVOKE`/`GRANT` idempotent theo trạng thái).
- Expand-only cho V1 (V1 nếu chưa gọi `handle_student_session_login` thì không ảnh hưởng; nếu V1 đã gọi qua anon/authenticated → migration sẽ từ chối quyền đó → cần owner xác nhận V1 không dùng đường này).
- Không V1-touch: V1 production hiện tại không có caller LMS của RPC này (F.2 đã xác nhận) → an toàn.
- Không đụng main / V1 tag / branch cũ.

### I.12 Blocker còn lại

1. **Migration `migration_handle_student_session_login_grants_hardening.sql` chưa apply production** — đây là blocker duy nhất.
2. `exchange-code.js` orphan (F.8/Q2) — không phải blocker schema; xử lý ở B1 router guard.
3. Portal CSRF logout (F.13 #3) — không phải blocker schema; xử lý ở B2.

### I.13 RECOMMENDED NEXT COMMAND

```text
1) Owner review Phụ lục I này.
2) Owner duyệt tạo 1 file migration_additive_grant_handle_student_session_login.sql
   (hoặc tên tương đương) với nội dung ở I.9, apply trên Supabase B / LMS runtime database
   (idempotent, REVERSE an toàn).
3) Re-export ROLE_EXECUTE_CHECK từ production để confirm:
     handle_student_session_login anon=false, authenticated=false, service_role=true
4) Sau khi confirm 3 → cập nhật Phụ lục I trạng thái thành READY FOR RP2-B1.
5) Triển khai RP2-B1 trên branch feat/v2-rp2b-session-device-guard (F.14 scope):
     - utils/v2-flags.js: thêm V2_GLOBAL_ONE_DEVICE_ENABLED
     - utils/lms-session-guard.js + course-data.js + lesson.js + verify-entry-token.js:
       bỏ ENV isEntryTokenRequiredCourse gate khi flag on; map RPC 'active_session_on_another_device' → 409
     - api/lms/portal.js: thêm guard cho exchange-code 410 hoặc xoá file utils/lms-handlers/exchange-code.js
     - fail-closed khi RPC lỗi (503 one_device_policy_unavailable)
     - telemetry login_blocked_other_device idempotent qua event_idempotency_key
     - KHÔNG sửa cors.js / lms-secrets.js / main / V1 tag
6) Chạy test matrix 1–13, 26–31, 35 theo Bước 31.
7) Báo cáo kết quả triển khai RP2-B1.

Không tạo branch mới. Không commit / push / deploy / set ENV production cho tới khi READY = YES + owner duyệt apply migration ở bước 2.
```

### I.14 Xác nhận thao tác (lượt này)

- Chỉ file `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md` thay đổi (thêm Phụ lục I).
- Không sửa source code (LMS hay Portal).
- Không tạo file SQL migration.
- Không commit.
- Không push.
- Không deploy.
- Không set ENV.
- Không gọi RPC.
- Không đọc dữ liệu học viên thật.
- Không in secret, key, anon key, service-role key, ENV value.
- 8 file CSV trong `docs/v2-new/supabase-verification/` không bị sửa, không bị xoá.
- Branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9cc3344b803d7b4c271966e6fcda676d17` giữ nguyên.

**KẾT THÚC PHỤ LỤC I — đã đối chiếu đủ 8/8 result set; migration cuối = B. ADDITIVE GRANT MIGRATION (1 file, 5 câu lệnh).**

---

## Phụ lục J — RP2-B0 GRANT HARDENING MIGRATION REVIEW

> Lượt này **chỉ** tạo 1 migration additive và cập nhật plan. Không sửa function body, không sửa signature, không sửa table/index, không sửa source code, không apply production, không commit, không push, không deploy, không bắt đầu RP2-B1.

### J.1 Lý do migration

- `handle_student_session_login` được Portal (`student-web`) gọi qua `service_role` (xem `yeubep-shop/student-web/src/lib/session-guard.ts:421` + `lmsSupabaseAdmin`). Caller là server-side, không phải user JWT.
- Public/anon/authenticated không có nhu cầu gọi RPC này; để EXECUTE rộng là attack surface không cần thiết (mặc dù logic vẫn có advisory lock + active check).
- Hardening thu hẹp EXECUTE về `service_role` duy nhất, additive, không đụng function body/signature/schema/data.
- Production verification 8/8 (Phụ lục I) đã xác nhận: signature khớp Portal caller, RETURNS jsonb, có advisory lock, default conflict policy `block`, same-device reuse/touch đúng, other-device block đúng (không supersede A), policy `block` không supersede A. Sai lệch duy nhất là grant EXECUTE hiện rộng cho PUBLIC/anon/authenticated.

### J.2 Production evidence

Từ `docs/v2-new/supabase-verification/07_routine_grants.csv`:

| routine_schema | routine_name | grantee | privilege_type |
|---|---|---|---|
| public | handle_student_session_login | PUBLIC | EXECUTE |
| public | handle_student_session_login | anon | EXECUTE |
| public | handle_student_session_login | authenticated | EXECUTE |
| public | handle_student_session_login | postgres | EXECUTE |
| public | handle_student_session_login | service_role | EXECUTE |

→ `handle_student_session_login` đang có EXECUTE cho cả 4 grantee PUBLIC/anon/authenticated/service_role (postgres mặc định owner).

### J.3 File migration

- Đường dẫn: `migration_handle_student_session_login_grants_hardening.sql`
- Thư mục gốc worktree: `_worktrees/v2-rebuild-20260714/`
- Số dòng: 63
- Số byte: 1068

### J.4 Signature production (dùng trong REVOKE/GRANT)

- 9 tham số `text` + 1 tham số `integer`.
- Identity arguments: `text, text, text, text, text, text, text, text, text, integer`.
- Identity arguments map sang full arguments (CSV `04_function_signatures.csv`):
  - `p_email text`
  - `p_portal_device_id text`
  - `p_new_student_session_id text`
  - `p_device_hash text`
  - `p_device_label text`
  - `p_ip text`
  - `p_ip_hash text`
  - `p_user_agent text`
  - `p_conflict_policy text`
  - `p_idle_hours integer`
- Default values **không** dùng trong REVOKE/GRANT (Postgres identity signature).
- Tên tham số **không** dùng trong REVOKE/GRANT.
- Source: `migration_atomic_session_guard.sql:99-110` + `docs/v2-new/supabase-verification/04_function_signatures.csv`.

### J.5 Quyền trước migration (production actual)

| Grantee | EXECUTE | Nguồn |
|---|---|---|
| PUBLIC | true | `07_routine_grants.csv` |
| anon | true | `07_routine_grants.csv` |
| authenticated | true | `07_routine_grants.csv` |
| service_role | true | `07_routine_grants.csv` |
| postgres | true | owner (mặc định) |

### J.6 Quyền mong muốn sau migration

| Grantee | EXECUTE | Lý do |
|---|---|---|
| PUBLIC | false | Không cần EXECUTE mặc định. |
| anon | false | Caller là server-side service_role, không phải anon. |
| authenticated | false | Caller là server-side service_role, không phải user JWT. |
| service_role | true | Portal + LMS admin route dùng service_role. |
| postgres | true | owner; mặc định; migration không thu hồi owner. |

### J.7 Không thay function body

- Migration chỉ chứa REVOKE/GRANT và `BEGIN; ... COMMIT;`.
- Không có `CREATE OR REPLACE FUNCTION`.
- Không có `ALTER FUNCTION`.
- Không có `DROP FUNCTION`.
- Function body giữ nguyên 100% như `migration_atomic_session_guard.sql:99-238`.

### J.8 Không thay schema hoặc data

- Không có `CREATE TABLE`.
- Không có `ALTER TABLE`.
- Không có `CREATE INDEX`.
- Không có `INSERT/UPDATE/DELETE`.
- Không có migration destructive.
- Không có `TRUNCATE`.

### J.9 V1 compatibility

- Function vẫn tồn tại; signature giữ nguyên; behavior giữ nguyên.
- V1 (Portal code `v2/platform-rebuild` HEAD `d2a903c`) gọi RPC qua `service_role` — vẫn có EXECUTE sau migration.
- V1 (LMS repo main, integration `v2/rebuild-20260714`) **không** gọi RPC này (theo inventory Phụ lục F) ⇒ REVOKE anon/authenticated không ảnh hưởng V1 LMS.
- Rollback V2: tắt feature flag, không migration đảo. Migration này additive: nếu rollback cần phục hồi EXECUTE cho anon/authenticated/PUBLIC, **phải** tạo migration mới, không sửa file này.

### J.10 Apply procedure cho owner

1. Owner mở **Supabase SQL Editor** của LMS project (B / LMS runtime database, **không phải** Portal).
2. Paste nguyên nội dung file `migration_handle_student_session_login_grants_hardening.sql`.
3. Trước khi Run: xác minh đúng database target (LMS, không phải Portal/Shop/landing).
4. Run trong transaction nguyên tử (đã có `BEGIN; ... COMMIT;`).
5. Sau khi chạy thành công, **không** cần làm thêm gì — V1 Portal vẫn chạy bình thường qua service_role.
6. Owner KHÔNG cần set ENV mới.
7. Owner KHÔNG cần restart service.

### J.11 SQL re-verify read-only (cho owner chạy SAU apply)

```sql
SELECT
  p.proname AS function_name,
  role_info.role_name,
  CASE
    WHEN role_info.role_exists = false THEN NULL
    ELSE has_function_privilege(role_info.role_name, p.oid, 'EXECUTE')
  END AS has_execute,
  role_info.role_exists
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL (
  SELECT
    requested.role_name,
    EXISTS (
      SELECT 1
      FROM pg_roles r
      WHERE r.rolname = requested.role_name
    ) AS role_exists
  FROM (
    VALUES
      ('anon'::text),
      ('authenticated'::text),
      ('service_role'::text)
  ) AS requested(role_name)
) AS role_info
WHERE n.nspname = 'public'
  AND p.proname = 'handle_student_session_login'
ORDER BY role_info.role_name;
```

```sql
SELECT
  has_function_privilege(
    'public',
    'public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer)',
    'EXECUTE'
  ) AS public_has_execute;
```

### J.12 Expected results (sau apply)

- `anon.has_execute = false`
- `authenticated.has_execute = false`
- `service_role.has_execute = true`
- `public_has_execute = false`

### J.13 Rollback strategy

- **Không** chỉnh sửa file `migration_handle_student_session_login_grants_hardening.sql` sau khi đã apply (theo nguyên tắc additive migration).
- Nếu cần rollback grant, tạo **migration mới** `migration_handle_student_session_login_grants_rollback.sql` với nội dung:
  - `GRANT EXECUTE ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) TO PUBLIC;`
  - `GRANT EXECUTE ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) TO anon;`
  - `GRANT EXECUTE ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) TO authenticated;`
  - `REVOKE EXECUTE ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) FROM service_role;`
  (Hoặc 4 lệnh đảo ngược tuỳ owner đánh giá an toàn.)
- Rollback cũng có thể bằng cách chạy các lệnh ngược trong Supabase SQL Editor thay vì tạo file.
- Tuyệt đối: không `DROP FUNCTION`, không `CREATE OR REPLACE FUNCTION`, không sửa function body.
- Rollback V2: tắt feature flag `V2_GLOBAL_ONE_DEVICE_ENABLED` (chưa tồn tại trong B0) khi đến B1; B0 không có flag để tắt.

### J.14 Điều kiện READY FOR APPLY

- [x] Branch `feat/v2-rp2b-session-device-guard` đúng.
- [x] HEAD `3f329c9cc3344b803d7b4c271966e6fcda676d17` đúng (RP2-A đã FF vào integration).
- [x] Production signature production đã verify khớp `text×9 + integer`.
- [x] Production evidence đã verify EXECUTE hiện có cho PUBLIC/anon/authenticated/service_role.
- [x] Migration chỉ REVOKE/GRANT — không CREATE/ALTER/DROP/INSERT/UPDATE/DELETE.
- [x] Migration idempotent ở trạng thái cuối (chạy lần 2 không lỗi).
- [x] Migration additive — không sửa function body.
- [x] Migration V1-safe — Portal service_role vẫn gọi được.
- [x] Migration không yêu cầu ENV mới.
- [x] SQL re-verify read-only đã chuẩn bị cho owner.
- [x] Rollback strategy rõ ràng (migration mới hoặc SQL Editor).
- [x] File 8 CSV verification giữ nguyên không sửa.
- [x] Plan `RP2_B_SESSION_DEVICE_GUARD_PLAN.md` được cập nhật (phụ lục J này).

### J.15 Điều kiện READY FOR RP2-B1

- [ ] Owner apply migration `migration_handle_student_session_login_grants_hardening.sql` lên production.
- [ ] Owner chạy SQL re-verify (J.11) và xác nhận 4 kết quả đúng kỳ vọng (J.12).
- [ ] Owner duyệt bước tiếp theo (RP2-B1).

**Trạng thái hiện tại:**

- READY FOR MIGRATION REVIEW.
- NOT YET READY FOR RP2-B1.

---

**KẾT THÚC PHỤ LỤC J — migration file `migration_handle_student_session_login_grants_hardening.sql` đã tạo; chờ owner review + apply production + re-verify role execute.**

---

**KẾT THÚC PLAN — chờ owner duyệt migration I.9, apply production, re-verify ROLE_EXECUTE_CHECK, rồi triển khai RP2-B1. Không sửa code. Không commit. Không deploy.**

---

## Phụ lục K — RP2-B0 PRODUCTION APPLY RESULT

> Phụ lục này ghi lại kết quả sau khi owner apply migration `migration_handle_student_session_login_grants_hardening.sql` lên production Supabase (LMS project) ngày 2026-07-14. Nguồn bằng chứng là re-verify table do owner cung cấp trực tiếp từ Supabase SQL Editor (read-only, post-apply). Phụ lục này **supersede** trạng thái READY/NOT READY của F.17, G.18, H.11, I.10, J.15.

### K.1 Thời điểm apply

- **Apply**: 2026-07-14, owner thực hiện trong Supabase SQL Editor của LMS project.
- **Migration file**: `migration_handle_student_session_login_grants_hardening.sql` (đã audit tại Phụ lục J).
- **Database target**: LMS runtime database (Supabase B / LMS project), **không** phải Portal/Shop/landing.

### K.2 Migration đã apply

- `migration_handle_student_session_login_grants_hardening.sql`
  - 3 × `REVOKE ALL ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) FROM <principal>` (PUBLIC, anon, authenticated)
  - 1 × `GRANT EXECUTE ON FUNCTION public.handle_student_session_login(text,text,text,text,text,text,text,text,text,integer) TO service_role`
  - Wrapped trong `BEGIN; ... COMMIT;`
  - Không có `CREATE OR REPLACE FUNCTION`, `ALTER FUNCTION`, `DROP FUNCTION`, `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `INSERT/UPDATE/DELETE/TRUNCATE`.

### K.3 Nguồn bằng chứng

- **Re-verify table (quyền sau migration)**: Owner-provided production re-verification from Supabase SQL Editor, 2026-07-14.
- **Schema/index/RPC production metadata (trước migration)**: Owner-exported production metadata CSV from Supabase SQL Editor, reviewed by agent, 2026-07-14 — tại `docs/v2-new/supabase-verification/01_tables.csv`, `02_columns.csv`, `03_indexes.csv`, `04_function_signatures.csv`, `05_function_definitions.csv`, `06_public_execute.csv`, `07_routine_grants.csv`, `role_execute.csv` (8 file, 8 result set; tổng cộng Phụ lục I).
- **Migration scope (file SQL đã apply)**: nội dung file `migration_handle_student_session_login_grants_hardening.sql` đã audit ở Phụ lục J và Phần 3 của lượt này.

Agent **không** tự truy vấn production. Agent **không** đọc `.env*` hay in giá trị secret/key/anon-key/service-role-key.

### K.4 Quyền trước migration

| Grantee | EXECUTE | Nguồn |
|---|---|---|
| PUBLIC | true | `07_routine_grants.csv` row 4 (Phụ lục I/J.5) |
| anon | true | `07_routine_grants.csv` row 5 + `role_execute.csv` row 5 |
| authenticated | true | `07_routine_grants.csv` row 6 + `role_execute.csv` row 6 |
| service_role | true | `07_routine_grants.csv` row 7 + `role_execute.csv` row 7 |
| postgres | true | owner (mặc định) |

### K.5 Quyền sau migration

| Grantee | EXECUTE | Nguồn |
|---|---|---|
| PUBLIC | **false** | Owner-provided production re-verification, 2026-07-14 |
| anon | **false** | Owner-provided production re-verification, 2026-07-14 |
| authenticated | **false** | Owner-provided production re-verification, 2026-07-14 |
| service_role | **true** | Owner-provided production re-verification, 2026-07-14 |

(Mục K.5 supersede Mục J.6 expected-after và Mục I.6 pre-migration.)

### K.6 Re-verification result (post-apply)

- **Apply result: PASS** theo Owner-provided production re-verification from Supabase SQL Editor, 2026-07-14.
- Bốn giá trị (PUBLIC=false, anon=false, authenticated=false, service_role=true) khớp đúng kỳ vọng J.12 và migration scope ở K.2.
- Không có `42501 permission denied` cho principal service_role trên `handle_student_session_login` được báo cáo trong re-verify.

### K.7 Function body / signature không thay đổi

Kết luận: function body và signature giữ nguyên 100% sau migration.

Lý do (đây là kết luận từ production metadata trước migration + phạm vi SQL migration, **không phải** agent tự chạy query sau migration):

1. **Body/signature trước migration đã được xác minh** trong `05_function_definitions.csv` và `04_function_signatures.csv` (Phụ lục I.5/I.7):
   - Identity arguments: `p_email text, p_portal_device_id text, p_new_student_session_id text, p_device_hash text, p_device_label text, p_ip text, p_ip_hash text, p_user_agent text, p_conflict_policy text, p_idle_hours integer` (9 text + 1 integer).
   - RETURN: `jsonb`.
   - SECURITY: INVOKER (security_definer=false).
   - Owner: postgres.
   - Body chứa: `pg_advisory_xact_lock(hashtext(v_email))`, default `'block'`, branch `reused` (same-device), branch `blocked` (other-device, không supersede A), branch `supersede` (chỉ chạy khi `v_policy='supersede'`).
2. **Migration scope** chỉ chứa `REVOKE ... FROM ...` và `GRANT EXECUTE ... TO service_role` (Phụ lục J.7, K.2).
3. **Không có** `CREATE OR REPLACE FUNCTION`, `ALTER FUNCTION`, `DROP FUNCTION` trong file migration.

⇒ Migration B0 không có cú pháp nào có thể thay đổi function body hoặc signature; do đó, sau apply production, body và signature production vẫn là những gì CSV metadata trước migration ghi nhận.

### K.8 Portal compatibility

- **Caller duy nhất**: `yeubep-shop/student-web/src/lib/session-guard.ts`, hàm `ensureStudentSessionAtomic`.
- **Được gọi từ**: `src/app/api/lms-entry-token/route.ts` (route handler Next.js).
- **Supabase client**: `lmsSupabaseAdmin` (được khởi tạo tại `src/lib/supabase.ts:24-31`).
- **Env dùng**: `LMS_SUPABASE_SERVICE_ROLE_KEY` (service_role).
- **`p_conflict_policy`**: hardcode `'block'` tại `session-guard.ts:430`.
- **Caller anon/authenticated**: không tồn tại trong repo Portal (grep `'handle_student_session_login'` chỉ ra `session-guard.ts`; `'.rpc('` chỉ gọi trên `lmsSupabaseAdmin`).
- **Path `supersede` trong Portal source**: không có (grep `'supersede'` trong `src` = 0 hit).
- **RPC khác trong Portal dùng anon client**: `record_view` tại `src/app/api/posts/[id]/view/route.ts:59` — **không liên quan** đến `handle_student_session_login`.

⇒ **V1/Portal compatibility: PASS theo source inspection.** Migration B0 không ảnh hưởng luồng hợp lệ: caller duy nhất = service_role vẫn còn EXECUTE sau migration; không có caller anon/authenticated bị mất quyền ngoài ý muốn.

### K.9 V1 compatibility

- LMS V1 production (repo main, integration `v2/rebuild-20260714`, branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9`) **không có caller** của `handle_student_session_login` trong LMS source (đã verify ở Phụ lục F, F.13; Mục I.7 matrix không có hàng nào cho LMS caller).
- Portal V1 (branch `v2/platform-rebuild`, HEAD `d2a903c`) caller là `service_role` — vẫn có EXECUTE sau migration.
- Anon/authenticated direct RPC access bị đóng **có chủ đích** theo mục tiêu migration B0 (giảm attack surface).

⇒ **V1 compatibility: PASS** theo source inspection; không có đường gọi V1 nào bị gãy.

### K.10 Rollback note

- **Không** sửa `migration_handle_student_session_login_grants_hardening.sql` sau khi đã apply (nguyên tắc additive migration).
- Nếu cần phục hồi grant: tạo **migration mới** (ví dụ `migration_handle_student_session_login_grants_rollback.sql`) với 4 lệnh `GRANT EXECUTE ... TO PUBLIC/anon/authenticated` + `REVOKE EXECUTE ... FROM service_role`, **hoặc** chạy trực tiếp các lệnh ngược trong Supabase SQL Editor.
- **Tuyệt đối không** `DROP FUNCTION`, không `CREATE OR REPLACE FUNCTION`, không sửa function body trong rollback.
- Rollback **không** thu hồi EXECUTE của `service_role` trừ khi owner xác nhận an toàn.
- Mẫu rollback ở J.13 chỉ là mẫu tham khảo; owner quyết định áp dụng hay không dựa trên đánh giá rủi ro thực tế.
- Rollback V2 (RP2-B1+): tắt feature flag `V2_GLOBAL_ONE_DEVICE_ENABLED` (chưa tồn tại trong B0) khi đến B1; B0 không có flag để tắt.

### K.11 Trạng thái

**RP2-B0 PRODUCTION APPLY: PASS**
**READY FOR RP2-B1** (về mặt migration + grant; B1 source code change vẫn chưa bắt đầu trong lượt này).

### K.12 Điều kiện đi kèm READY FOR RP2-B1

- Migration B0 đã apply production; re-verify xác nhận anon/authenticated/PUBLIC = false, service_role = true (K.5, K.6).
- **Chưa** bật `V2_GLOBAL_ONE_DEVICE_ENABLED`.
- **Chưa** deploy RP2-B1 source code change.
- **Chưa** commit/push lần RP2-B0 này (sẽ commit sau khi owner duyệt Phụ lục K).
- Migration B0 đã apply nhưng source code RP2-B1 chưa bắt đầu.

### K.13 RECOMMENDED NEXT COMMAND

```text
Owner duyệt Phụ lục K.
Sau đó: tiến hành các bước Phần 3–7 của lượt này trên cùng branch feat/v2-rp2b-session-device-guard:
  - .git/info/exclude cho CSV
  - git diff --check / status / diff stat / name-only
  - chạy RP2-A 29/29 + RP-1 48/48 regression
  - stage đúng 2 file (migration SQL + plan)
  - commit + push feature branch
  - KHÔNG merge / KHÔNG deploy / KHÔNG bật flag / KHÔNG bắt đầu RP2-B1 code change trong lượt này.
```

### K.14 Xác nhận thao tác (lượt này)

- File `docs/v2-new/RP2_B_SESSION_DEVICE_GUARD_PLAN.md` được cập nhật (chú thích supersede ở F.18-end và G.20-end, thêm Phụ lục K).
- Không sửa source code (LMS hay Portal).
- Không tạo file SQL migration mới.
- 8 CSV trong `docs/v2-new/supabase-verification/` và `Supabase Snippet Untitled query.csv` không bị sửa, không bị xoá.
- Branch `feat/v2-rp2b-session-device-guard`, HEAD `3f329c9cc3344b803d7b4c271966e6fcda676d17` giữ nguyên cho tới khi commit.
- Không commit. Không push. Không deploy. Không set ENV. Không gọi RPC. Không đọc dữ liệu học viên thật. Không in secret.

**KẾT THÚC PHỤ LỤC K — RP2-B0 production apply result PASS; READY FOR RP2-B1 (về grant), chưa bắt đầu source change.**
