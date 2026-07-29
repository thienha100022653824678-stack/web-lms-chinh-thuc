import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveEffectiveLearningSite } from "../utils/learning-site.js";

const expectedProductionRef = "aqozjkfwzmyfunqvcyjv";
const outputJson = process.argv[2] || "PRODUCTION_LEARNING_SITE_DRY_RUN.json";
const outputMarkdown = process.argv[3] || "PRODUCTION_LEARNING_SITE_DRY_RUN.md";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("PRODUCTION_READ_ONLY_CREDENTIALS_REQUIRED");
const ref = new URL(url).hostname.split(".")[0];
if (ref !== expectedProductionRef) throw new Error("PRODUCTION_RESOURCE_IDENTITY_MISMATCH");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "x-read-only-purpose": "lms-learning-site-dry-run" } }
});

async function exactCount(table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

async function allRows(table, columns) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function tally(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function shortId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

// Production may not have the additive column yet. Probe the intended shape,
// then fall back to the current baseline without converting a missing column
// into an unresolved mapping.
let courses;
let learningSiteColumnPresent = true;
{
  const withSite = await supabase
    .from("courses")
    .select("id,slug,title,active,sales_site,learning_course_slug,learning_site")
    .order("slug");
  if (withSite.error?.code === "42703" || /learning_site/i.test(withSite.error?.message || "")) {
    learningSiteColumnPresent = false;
    const baseline = await supabase
      .from("courses")
      .select("id,slug,title,active,sales_site,learning_course_slug")
      .order("slug");
    if (baseline.error) throw baseline.error;
    courses = (baseline.data || []).map((row) => ({ ...row, learning_site: null }));
  } else {
    if (withSite.error) throw withSite.error;
    courses = withSite.data || [];
  }
}

const [lessons, orders, enrollments, openApiResponse] = await Promise.all([
  allRows("lessons", "course_slug"),
  allRows("orders", "course_slug,learning_course_slug"),
  allRows("student_enrollments", "course_slug"),
  fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/openapi+json" }
  })
]);
if (!openApiResponse.ok) throw new Error(`OPENAPI_SCHEMA_READ_FAILED:${openApiResponse.status}`);
const openApi = await openApiResponse.json();
const schemaChecksum = crypto
  .createHash("sha256")
  .update(JSON.stringify(openApi))
  .digest("hex");

const lessonCounts = tally(lessons, "course_slug");
const orderCounts = tally(orders.map((row) => ({
  course_slug: row.learning_course_slug || row.course_slug
})), "course_slug");
const enrollmentCounts = tally(enrollments, "course_slug");
const bySlug = new Map(courses.map((course) => [course.slug, course]));
const rows = [];

for (const course of courses) {
  const targetSlug = course.learning_course_slug || course.slug;
  const target = bySlug.get(targetSlug);
  const isAlias = targetSlug !== course.slug;
  let proposed = null;
  let reason = "";
  let warning = "";
  let deterministic = true;
  try {
    proposed = await resolveEffectiveLearningSite(course, {
      findCourseBySlug: async (slug) => bySlug.get(slug) || null
    });
    reason = course.learning_site
      ? "explicit"
      : isAlias
        ? "canonical_target_owner"
        : course.sales_site
          ? "self_target_sales_site_fallback"
          : "legacy_null_yeunauan_fallback";
  } catch (error) {
    deterministic = false;
    reason = `UNRESOLVED:${error.code || error.message}`;
    warning = reason;
  }

  if (course.sales_site && !["yeunauan", "yeubep"].includes(course.sales_site)) {
    deterministic = false;
    warning = "INVALID_SALES_SITE";
  } else if (course.learning_site && !["yeunauan", "yeubep"].includes(course.learning_site)) {
    deterministic = false;
    warning = "INVALID_EXISTING_LEARNING_SITE";
  } else if (isAlias && !target) {
    deterministic = false;
    warning = "TARGET_MISSING";
  } else if (isAlias && target?.active === false) {
    warning = "INACTIVE_TARGET";
  } else if (isAlias && (lessonCounts.get(course.slug) || 0) > 0) {
    warning = "ALIAS_HAS_OWN_LESSONS";
  } else if (isAlias && course.sales_site && proposed && course.sales_site !== proposed) {
    warning = "LEGACY_CROSS_SITE_SHARED_MAPPING";
  }

  rows.push({
    course_id_hash: shortId(course.id),
    course: course.slug,
    sales_site: course.sales_site,
    canonical_target: targetSlug,
    kind: isAlias ? "alias" : "canonical/self",
    active: course.active !== false,
    lesson_count: lessonCounts.get(course.slug) || 0,
    order_count: orderCounts.get(targetSlug) || 0,
    enrollment_count: enrollmentCounts.get(targetSlug) || 0,
    proposed_learning_site: proposed,
    reason,
    deterministic,
    legacy_or_new: course.learning_site ? "new/explicit" : "legacy-compatible",
    explicit_write_required: deterministic ? "no" : "blocked",
    warning
  });
}

const duplicateSlugs = [...tally(courses, "slug").entries()]
  .filter(([, count]) => count > 1)
  .map(([slug]) => slug);
const unresolved = rows.filter((row) => !row.deterministic);
const legacyAliases = rows.filter((row) => row.kind === "alias");
const counts = {};
for (const table of ["courses", "orders", "student_enrollments", "lessons", "site_config"]) {
  counts[table] = await exactCount(table);
}

const artifact = {
  generated_at: new Date().toISOString(),
  dry_run: true,
  production_ref: expectedProductionRef,
  pii_selected: false,
  schema_openapi_sha256: schemaChecksum,
  learning_site_column_present: learningSiteColumnPresent,
  counts,
  duplicate_slugs: duplicateSlugs,
  unresolved_count: unresolved.length,
  legacy_alias_count: legacyAliases.length,
  rows
};
fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });

const mdRows = rows.map((row) =>
  `| \`${row.course}\` | ${row.sales_site || "NULL"} | \`${row.canonical_target}\` | ${row.proposed_learning_site || "UNRESOLVED"} | ${row.reason} | ${row.explicit_write_required} | ${row.warning || "—"} |`
).join("\n");
const markdown = `# Production Learning Site Dry-Run

Generated: ${artifact.generated_at}

Mode: read-only, non-PII

Production ref: \`${expectedProductionRef}\`
OpenAPI schema SHA-256: \`${schemaChecksum}\`

Counts: courses ${counts.courses}, orders ${counts.orders}, enrollments ${counts.student_enrollments}, lessons ${counts.lessons}, site_config ${counts.site_config}.

Unresolved mappings: **${unresolved.length}**. Duplicate slugs: **${duplicateSlugs.length}**.

| Course | Sales site | Canonical target | Proposed learning site | Reason | Explicit write required | Legacy warning |
|---|---|---|---|---|---|---|
${mdRows}

No backfill was executed. Deterministic legacy rows require no write because the
server resolver provides compatibility. An explicit backfill remains optional
and requires separate owner approval.
`;
fs.writeFileSync(outputMarkdown, markdown, { flag: "wx" });
console.log(JSON.stringify({
  ok: unresolved.length === 0,
  rows: rows.length,
  unresolved: unresolved.length,
  schemaChecksum,
  counts
}));
if (unresolved.length) process.exitCode = 2;
