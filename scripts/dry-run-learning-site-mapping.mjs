import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resolveEffectiveLearningSite } from "../utils/learning-site.js";

const outputPath = process.argv[2] || "learning-site-proposed-mapping.json";
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Thiếu SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const { data: courses, error } = await supabase
  .from("courses")
  .select("id,slug,sales_site,learning_course_slug,learning_site")
  .order("slug");
if (error) throw error;

const bySlug = new Map((courses || []).map((course) => [course.slug, course]));
const proposed = [];
for (const course of courses || []) {
  let site = null;
  let reason = "";
  try {
    site = await resolveEffectiveLearningSite(course, {
      findCourseBySlug: async (slug) => bySlug.get(slug) || null
    });
    reason = course.learning_site
      ? "explicit"
      : course.learning_course_slug && course.learning_course_slug !== course.slug
        ? "canonical_target_owner"
        : course.sales_site
          ? "self_target_sales_site_fallback"
          : "legacy_null_yeunauan_fallback";
  } catch (err) {
    reason = `UNRESOLVED:${err.code || err.message}`;
  }
  proposed.push({
    id: course.id,
    slug: course.slug,
    current_sales_site: course.sales_site,
    learning_target: course.learning_course_slug || course.slug,
    current_learning_site: course.learning_site,
    proposed_learning_site: site,
    reason
  });
}

fs.writeFileSync(outputPath, `${JSON.stringify({ dry_run: true, rows: proposed }, null, 2)}\n`, {
  flag: "wx"
});
console.log(`Dry-run only. Wrote ${proposed.length} rows to ${outputPath}`);

