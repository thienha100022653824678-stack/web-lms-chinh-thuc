import fs from "node:fs";
import path from "node:path";

const base = String(process.env.LMS_PREVIEW_URL || "").replace(/\/$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const harness = process.env.LMS_PREVIEW_HARNESS_SECRET;
if (!base || !bypass || !harness) throw new Error("HOSTED_GATE_ENV_REQUIRED");

const commonHeaders = { "x-vercel-protection-bypass": bypass };
const auth = await fetch(`${base}/api/lms/admin?endpoint=preview-auth`, {
  method: "POST",
  headers: { ...commonHeaders, "x-lms-preview-harness-secret": harness }
});
if (!auth.ok) throw new Error(`PREVIEW_AUTH_${auth.status}`);
const cookie = auth.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
const request = async (endpoint, tenant, { method = "GET", body } = {}) => {
  const response = await fetch(`${base}/api/lms/admin?endpoint=${endpoint}`, {
    method,
    headers: {
      ...commonHeaders,
      cookie,
      "x-lms-tenant": tenant,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { status: response.status, payload };
};

const courseA = "preview-yeunauan-course-a";
const courseB = "preview-yeubep-course-a";
const courseListA = await request("courses", "yeunauan");
const courseListB = await request("courses", "yeubep");
const invalid = await request("courses", "invalid");
const crossLesson = await request(`lessons&course=${courseB}`, "yeunauan");
const crossEnrollment = await request(`enrollments&course=${courseB}`, "yeunauan");
const crossProgress = await request(`progress&course=${courseB}`, "yeunauan");

const driveCases = [
  ["upload-image", { course: courseA }],
  ["upload-recipe", { course: courseA }],
  ["upload-material", { course_slug: courseA }],
  ["upload-gdrive-video", { course_slug: courseA }],
  ["verify-media", { courseSlug: courseA }],
  ["sync-drive-permissions", { courseSlug: courseA }],
  ["repair-drive", { courseSlug: courseA }],
  ["drive-retry", { type: "single", courseSlug: courseA, email: "drive-student.preview@example.test" }],
  ["drive-permission", { courseSlug: courseA, email: "drive-student.preview@example.test", action: "create" }]
];
const drive = [];
for (const [endpoint, body] of driveCases) {
  const result = await request(endpoint, "yeunauan", { method: "POST", body });
  drive.push({
    endpoint,
    status: result.status,
    dryRun: result.payload.dryRun === true,
    tenant: result.payload.lms_tenant,
    action: result.payload.action
  });
}
const mixedDrive = await request("drive-retry", "yeunauan", {
  method: "POST", body: { type: "all", courseSlug: courseA }
});
const wrongDrive = await request("drive-permission", "yeunauan", {
  method: "POST",
  body: { courseSlug: courseB, email: "drive-student.preview@example.test", action: "create" }
});

const slugs = (result) => (result.payload.courses || []).map((course) =>
  typeof course === "string" ? course : course.slug
);
const evidence = {
  deployment: base,
  course_lists: { yeunauan: slugs(courseListA), yeubep: slugs(courseListB) },
  invalid_tenant: { status: invalid.status, code: invalid.payload.code },
  idor: {
    lesson: { status: crossLesson.status, code: crossLesson.payload.code },
    enrollment: { status: crossEnrollment.status, code: crossEnrollment.payload.code },
    progress: { status: crossProgress.status, code: crossProgress.payload.code },
    drive: { status: wrongDrive.status, code: wrongDrive.payload.code }
  },
  mixed_batch: { status: mixedDrive.status, code: mixedDrive.payload.code },
  drive
};

const assertions = [
  courseListA.status === 200 && slugs(courseListA).every((slug) => !slug.includes("yeubep-course")),
  courseListB.status === 200 && slugs(courseListB).every((slug) => !slug.includes("yeunauan-course")),
  invalid.status === 400 && invalid.payload.code === "INVALID_LMS_TENANT",
  [crossLesson, crossEnrollment, crossProgress, wrongDrive].every((item) =>
    item.status === 403 && item.payload.code === "COURSE_LMS_TENANT_MISMATCH"
  ),
  mixedDrive.status === 409 && mixedDrive.payload.code === "MIXED_LMS_BATCH_FORBIDDEN",
  drive.length === 9 && drive.every((item) =>
    item.status === 200 && item.dryRun && item.tenant === "yeunauan"
  )
];
if (assertions.some((value) => !value)) {
  console.error(JSON.stringify(evidence, null, 2));
  throw new Error("HOSTED_GATE_FAILED");
}
const output = path.resolve("_local_artifacts/dual-lms-preview/hosted-api-evidence-final.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, driveActions: drive.length, idor: 4, output }));
