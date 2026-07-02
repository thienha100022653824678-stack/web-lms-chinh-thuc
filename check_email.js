import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log("Supabase URL:", supabaseUrl);
console.log("Has Key:", !!supabaseKey);

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStudent() {
  const email = "thienha336501903@gmail.com";
  console.log("\n--- Checking student_enrollments for:", email);

  const { data: enrollments, error: enrollError } = await supabase
    .from("student_enrollments")
    .select("*")
    .eq("email", email);

  console.log("Enrollments found:", enrollments?.length || 0);
  console.log(JSON.stringify(enrollments, null, 2));
  if (enrollError) console.error("Enrollment error:", enrollError);

  console.log("\n--- Checking orders table for email containing:", email);
  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .ilike("customer_email", `%${email}%`);

  console.log("Orders found:", orders?.length || 0);
  console.log(JSON.stringify(orders, null, 2));
  if (orderError) console.error("Orders error:", orderError);

  console.log("\n--- Checking courses table:");
  const { data: courses } = await supabase.from("courses").select("id, slug, title");
  console.log(courses);
}

checkStudent().catch(console.error);
