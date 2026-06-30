import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { course } = req.query || {};
  let courseInfo = null;

  if (course) {
    try {
      const { data } = await supabase
        .from("courses")
        .select("title, subtitle, image_url, raw_data")
        .eq("slug", course)
        .eq("active", true)
        .maybeSingle();
      if (data) {
        courseInfo = {
          title: data.title || "",
          subtitle: data.subtitle || "",
          heroImage: data.image_url || data.raw_data?.heroImageUrl || data.raw_data?.bannerImageUrl || ""
        };
      }
    } catch (err) {
      console.error("Error loading public course details:", err);
    }
  }

  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    courseInfo
  });
}
