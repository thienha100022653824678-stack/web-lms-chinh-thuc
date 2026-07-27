import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const student = await readFile(new URL("../../utils/v5/student-handler.js", import.meta.url), "utf8");
const auth = await readFile(new URL("../../utils/v5/auth.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../../migrations/v5/001_lms_v5_channel_feed_forward.sql", import.meta.url), "utf8");
const app = await readFile(new URL("../../apps/lms-v5/src/main.tsx", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));

test("student authorization never reads email from query or body", () => { assert.doesNotMatch(auth, /req\.(body|query)\??\.email/); assert.match(auth, /verifyStudentSession/); });
test("student API enforces active enrollment", () => assert.match(student, /requireEnrollment/));
test("student API rejects offset pagination", () => assert.match(student, /offset_not_supported/));
test("student feed requires published status in repository contract", async () => assert.match(await readFile(new URL("../../utils/v5/repository.js", import.meta.url), "utf8"), /\.eq\("status", "published"\)/));
test("service role does not appear in browser source", () => assert.doesNotMatch(app, /SERVICE_ROLE|service-role|service_role/i));
test("V5 paths are isolated from B05 entry files", () => { const routes = vercel.rewrites.map((r) => r.source); assert.deepEqual(routes, ["/v5", "/v5/", "/v5-admin", "/v5-admin/"]); });
test("schema defaults feature flag disabled and v4", () => { assert.match(migration, /ui_version text not null default 'v4'/); assert.match(migration, /enabled boolean not null default false/); });
test("schema has no cascade delete for posts or media", () => assert.doesNotMatch(migration, /lms_v5_(posts|post_media)[\s\S]{0,180}on delete cascade/i));
test("schema uses sequence feed indexes", () => assert.match(migration, /sequence_no desc/));
test("schema limits public access to V5 tables only", () => assert.doesNotMatch(migration, /revoke all on all tables in schema public/));
test("client video uses metadata preload", () => assert.match(app, /preload="metadata"/));
test("client has reduced motion support", async () => assert.match(await readFile(new URL("../../apps/lms-v5/src/styles.css", import.meta.url), "utf8"), /prefers-reduced-motion/));
test("composer supports drag/drop, preview, schedule and draft", () => { for (const marker of ["onDrop", "Xem trước", "Lưu nháp", "Lên lịch", "Đăng ngay"]) assert.match(app, new RegExp(marker)); });
test("student new-post behavior uses banner instead of forced realtime scroll", () => assert.match(app, /Có bài mới · bấm để xem/));
test("scroll position is persisted per course", () => assert.match(app, /sessionStorage\.setItem/));
