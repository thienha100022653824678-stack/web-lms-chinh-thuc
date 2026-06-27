import { supabase } from "../utils/supabase.js";
import { 
  normalizeEmail, 
  addDriveFolderPermission, 
  removeDriveFolderPermission, 
  getCourseFolderIdOrDiscover 
} from "../utils/lms.js";

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sync-Secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // Verify internal sync secret
  const syncSecret = req.headers["x-sync-secret"];
  const systemSecret = process.env.INTERNAL_SYNC_SECRET;

  if (!systemSecret || syncSecret !== systemSecret) {
    return res.status(401).json({ success: false, error: "Unauthorized: Sync secret is invalid or missing." });
  }

  try {
    const { action, slug, title, subtitle, imageUrl, active, email, courseSlug } = req.body || {};

    if (!action) {
      return res.status(400).json({ success: false, error: "Thiếu tham số action" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SYNC COURSE (Tạo/Sửa khóa học)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncCourse") {
      if (!slug || !title) {
        return res.status(400).json({ success: false, error: "Thiếu slug hoặc title" });
      }

      // Check if course already exists
      const { data: existingCourse, error: fetchErr } = await supabase
        .from("courses")
        .select("id, raw_data")
        .eq("slug", slug.trim())
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      let result;
      if (existingCourse) {
        // Update metadata without breaking lessons or existing raw_data
        const rawData = existingCourse.raw_data || {};
        const { error: updateErr } = await supabase
          .from("courses")
          .update({
            title: title.trim(),
            subtitle: subtitle ? subtitle.trim() : null,
            image_url: imageUrl ? imageUrl.trim() : null,
            active: active !== undefined ? active : true,
            updated_at: new Date().toISOString()
          })
          .eq("id", existingCourse.id);

        if (updateErr) throw updateErr;
        result = { id: existingCourse.id, updated: true };
      } else {
        // Create new course in draft mode
        const { data: newCourse, error: insertErr } = await supabase
          .from("courses")
          .insert({
            slug: slug.trim(),
            title: title.trim(),
            subtitle: subtitle ? subtitle.trim() : null,
            image_url: imageUrl ? imageUrl.trim() : null,
            active: active !== undefined ? active : true,
            sort_order: 999 // Default to end of list
          })
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        result = { id: newCourse.id, created: true };
      }

      return res.status(200).json({ success: true, course: result });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SYNC ENROLLMENT (Duyệt cấp quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }

      const cleanEmail = normalizeEmail(email);

      // 1. Get or create student
      let studentId;
      const { data: student, error: studentFetchErr } = await supabase
        .from("students")
        .select("id")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (studentFetchErr) throw studentFetchErr;

      if (student) {
        studentId = student.id;
      } else {
        const { data: newStudent, error: studentInsertErr } = await supabase
          .from("students")
          .insert({ email: cleanEmail, status: "active" })
          .select("id")
          .single();

        if (studentInsertErr) throw studentInsertErr;
        studentId = newStudent.id;
      }

      // 2. Fetch course ID by slug
      const { data: courseRec } = await supabase
        .from("courses")
        .select("id")
        .eq("slug", courseSlug.trim())
        .maybeSingle();

      // 3. Upsert enrollment
      const { data: enrollment, error: enrollErr } = await supabase
        .from("student_enrollments")
        .upsert({
          student_id: studentId,
          course_id: courseRec?.id || null,
          course_slug: courseSlug.trim(),
          email: cleanEmail,
          status: "active",
          updated_at: new Date().toISOString()
        }, {
          onConflict: "email,course_slug"
        })
        .select()
        .single();

      if (enrollErr) throw enrollErr;

      // 4. Background Google Drive permission sync if token is stored in site_config
      let driveSynced = false;
      let driveError = null;
      
      try {
        const { data: tokenConfig } = await supabase
          .from("site_config")
          .select("value")
          .eq("key", "google_drive_access_token")
          .maybeSingle();

        if (tokenConfig && tokenConfig.value && tokenConfig.value.val) {
          const driveAccessToken = tokenConfig.value.val;
          const folderId = await getCourseFolderIdOrDiscover(supabase, null, courseSlug.trim());
          if (folderId) {
            await addDriveFolderPermission(driveAccessToken, folderId, cleanEmail);
            driveSynced = true;
          } else {
            driveError = "Thư mục khóa học chưa được cấu hình Drive";
          }
        } else {
          driveError = "LMS admin chưa kết nối Google Drive, vui lòng đồng bộ quyền Drive thủ công sau.";
        }
      } catch (err) {
        console.error("[sync] GDrive permission sync error:", err);
        driveError = err.message;
      }

      return res.status(200).json({ 
        success: true, 
        enrollment, 
        driveSync: { synced: driveSynced, error: driveError } 
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. REVOKE ENROLLMENT (Hủy/Thu hồi quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "revokeEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }

      const cleanEmail = normalizeEmail(email);

      // Delete enrollment
      const { error: deleteErr } = await supabase
        .from("student_enrollments")
        .delete()
        .eq("email", cleanEmail)
        .eq("course_slug", courseSlug.trim());

      if (deleteErr) throw deleteErr;

      // Revoke Google Drive folder permissions
      let driveRevoked = false;
      let driveError = null;

      try {
        const { data: tokenConfig } = await supabase
          .from("site_config")
          .select("value")
          .eq("key", "google_drive_access_token")
          .maybeSingle();

        if (tokenConfig && tokenConfig.value && tokenConfig.value.val) {
          const driveAccessToken = tokenConfig.value.val;
          const folderId = await getCourseFolderIdOrDiscover(supabase, null, courseSlug.trim());
          if (folderId) {
            await removeDriveFolderPermission(driveAccessToken, folderId, cleanEmail);
            driveRevoked = true;
          }
        }
      } catch (err) {
        console.error("[sync] GDrive permission revoke error:", err);
        driveError = err.message;
      }

      return res.status(200).json({ 
        success: true, 
        driveRevoke: { revoked: driveRevoked, error: driveError } 
      });
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ" });
  } catch (error) {
    console.error("[sync] Error in handler:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
