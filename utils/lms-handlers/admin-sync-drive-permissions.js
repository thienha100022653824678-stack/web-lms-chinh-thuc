import { getAdminFromRequest, getDriveClientWithToken, getCourseFolderIdOrDiscover, addDriveFolderPermission } from "../lms.js";
import { supabase } from "../supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const { courseSlug, accessToken } = req.body || {};

    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({ success: false, needsOAuth: true, error: "Chưa kết nối Google Drive" });
    }

    const drive = getDriveClientWithToken(accessToken);
    const errors = [];
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Get list of courses to sync
    let coursesToSync = [];
    if (courseSlug) {
      const { data: course } = await supabase
        .from("courses")
        .select("slug, title")
        .eq("slug", courseSlug.trim())
        .maybeSingle();

      if (!course) {
        return res.status(404).json({ success: false, error: `Không tìm thấy khóa học với mã ${courseSlug}` });
      }
      coursesToSync.push(course);
    } else {
      const { data: courses } = await supabase
        .from("courses")
        .select("slug, title")
        .eq("active", true);
      coursesToSync = courses || [];
    }

    for (const course of coursesToSync) {
      const slug = course.slug;
      const title = course.title;

      try {
        const folderId = await getCourseFolderIdOrDiscover(supabase, drive, slug, title);
        if (!folderId) {
          const errMsg = `Không tìm thấy hoặc không tự tạo được thư mục Google Drive cho khóa học: ${slug}`;
          console.error(errMsg);
          errorCount++;
          errors.push({ course: slug, error: errMsg });
          continue;
        }

        // Fetch active enrollments
        const { data: enrollments, error: enrollErr } = await supabase
          .from("student_enrollments")
          .select("email")
          .eq("course_slug", slug)
          .eq("status", "active");

        if (enrollErr) {
          throw new Error(`Lỗi đọc enrollments từ database: ${enrollErr.message}`);
        }

        const activeEmails = (enrollments || []).map(e => String(e.email || "").trim().toLowerCase()).filter(Boolean);

        if (activeEmails.length === 0) {
          continue; // No active students to sync for this course
        }

        // Fetch existing permissions on folder
        let existingEmails = new Set();
        try {
          const permList = await drive.permissions.list({
            fileId: folderId,
            fields: "permissions(id, emailAddress, role)",
            supportsAllDrives: true
          });
          const permissions = permList.data.permissions || [];
          permissions.forEach(p => {
            if (p.emailAddress) {
              existingEmails.add(p.emailAddress.toLowerCase().trim());
            }
          });
        } catch (permListErr) {
          console.warn(`[sync-drive-permissions] Could not list permissions for folder ${folderId}:`, permListErr.message);
        }

        // Add reader permission for each active enrollment
        for (const email of activeEmails) {
          if (existingEmails.has(email)) {
            skippedCount++;
            continue; // Already has permission
          }

          try {
            await addDriveFolderPermission(accessToken, folderId, email);
            successCount++;
          } catch (addErr) {
            console.error(`[sync-drive-permissions] Failed to add permission for ${email} on ${slug}:`, addErr.message);
            errorCount++;
            errors.push({ course: slug, email, error: addErr.message });
          }
        }
      } catch (courseErr) {
        console.error(`[sync-drive-permissions] Error syncing course ${slug}:`, courseErr.message);
        errorCount++;
        errors.push({ course: slug, error: courseErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      report: {
        successCount,
        skippedCount,
        errorCount,
        errors
      }
    });

  } catch (err) {
    console.error("[admin-sync-drive-permissions] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: `Đồng bộ thất bại: ${err.message}`,
      message: err.message
    });
  }
}
