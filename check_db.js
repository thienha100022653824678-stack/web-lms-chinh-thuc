import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Parse .env.prod.local manually
const envText = fs.readFileSync(".env.prod.local", "utf8");
const envVars = {};
envText.split("\n").forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*"(.*)"\s*$/) || line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
  if (match) {
    envVars[match[1]] = match[2];
  }
});

const supabaseUrl = envVars.SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

console.log("Supabase URL:", supabaseUrl);
console.log("Has Key:", !!supabaseKey);

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.prod.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStudent() {
  const email = "thienha336501903@gmail.com";
  console.log("\n==================================================");
  console.log("🔍 Checking student_enrollments for:", email);
  console.log("==================================================");

  const { data: enrollments, error: enrollError } = await supabase
    .from("student_enrollments")
    .select("*")
    .eq("email", email);

  console.log("Enrollments found:", enrollments?.length || 0);
  console.log(JSON.stringify(enrollments, null, 2));
  if (enrollError) console.error("Enrollment error:", enrollError);

  console.log("\n==================================================");
  console.log("🔍 Checking ALL enrollments in student_enrollments table:");
  console.log("==================================================");

  const { data: allEnrollments } = await supabase
    .from("student_enrollments")
    .select("email, course_slug, status");

  console.log("Total enrollments:", allEnrollments?.length || 0);
  console.log(JSON.stringify(allEnrollments, null, 2));

  console.log("\n==================================================");
  console.log("🔍 Checking orders table for email containing thienha:");
  console.log("==================================================");

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .ilike("customer_email", `%thienha%`);

  console.log("Orders found:", orders?.length || 0);
  console.log(JSON.stringify(orders, null, 2));
  if (orderError) console.error("Orders error:", orderError);

  console.log("\n==================================================");
  console.log("🔍 Checking courses table:");
  console.log("==================================================");
  const { data: courses } = await supabase.from("courses").select("id, slug, title");
  console.log(courses);
}

checkStudent().catch(console.error);
