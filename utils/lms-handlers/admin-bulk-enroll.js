import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail, syncEnrollment } from "../lms.js";
import { applyCors } from "../cors.js";

// Helper to validate email format
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Helper to batch array into chunks
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { mode: "admin" });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { action, courseSlug, emails = [], status = "active", expiresAt = null } = req.body || {};

    if (!courseSlug) {
      return res.status(400).json({ success: false, error: "Thiếu mã khóa học (courseSlug)" });
    }

    // --- Clean and validate email list ---
    const rawEmails = emails.map(e => String(e || "").trim()).filter(Boolean);
    
    // Classify emails
    const classified = [];
    const validEmailsSet = new Set();
    
    rawEmails.forEach((rawEmail) => {
      const email = normalizeEmail(rawEmail);
      if (!isValidEmail(email)) {
        classified.push({ email: rawEmail, type: "invalid", detail: "Email sai định dạng" });
        return;
      }
      
      if (validEmailsSet.has(email)) {
        classified.push({ email, type: "duplicate", detail: "Email trùng lặp trong danh sách" });
        return;
      }
      
      validEmailsSet.add(email);
    });

    const uniqueValidEmails = Array.from(validEmailsSet);

    // --- Action: Check bulk emails ---
    if (action === "check") {
      if (uniqueValidEmails.length === 0) {
        return res.status(200).json({
          success: true,
          summary: { valid: 0, invalid: classified.filter(c => c.type === "invalid").length, duplicate: classified.filter(c => c.type === "duplicate").length, exists: 0, new: 0 },
          details: classified
        });
      }

      // Fetch existing enrollments for the unique valid emails in this course
      const existingEmails = new Set();
      const chunks = chunkArray(uniqueValidEmails, 1000);
      for (const chunk of chunks) {
        const { data: enrollments, error } = await supabase
          .from("student_enrollments")
          .select("email")
          .eq("course_slug", courseSlug)
          .in("email", chunk);
        
        if (error) throw error;
        if (enrollments) {
          enrollments.forEach(e => existingEmails.add(normalizeEmail(e.email)));
        }
      }

      // Classify the valid unique emails
      uniqueValidEmails.forEach(email => {
        if (existingEmails.has(email)) {
          classified.push({ email, type: "exists", detail: "Đã được cấp quyền từ trước" });
        } else {
          classified.push({ email, type: "new", detail: "Cần cấp quyền mới" });
        }
      });

      const summary = {
        valid: uniqueValidEmails.length,
        invalid: classified.filter(c => c.type === "invalid").length,
        duplicate: classified.filter(c => c.type === "duplicate").length,
        exists: classified.filter(c => c.type === "exists").length,
        new: classified.filter(c => c.type === "new").length
      };

      return res.status(200).json({ success: true, summary, details: classified });
    }

    // --- Action: Perform Bulk Enroll ---
    if (action === "enroll") {
      if (uniqueValidEmails.length === 0) {
        return res.status(400).json({ success: false, error: "Không có email hợp lệ để cấp quyền" });
      }

      let successCount = 0;
      let failedCount = 0;
      const reportDetails = [];

      // Process each enrollment sequentially (or in batches) using syncEnrollment
      for (const email of uniqueValidEmails) {
        try {
          const syncResult = await syncEnrollment(supabase, {
            email,
            courseSlug,
            action: "create",
            expiredAt: expiresAt
          });
          if (syncResult.success) {
            successCount++;
            reportDetails.push({
              email,
              status: "success",
              error: syncResult.driveSync?.success === false ? `Drive: ${syncResult.driveSync.error || "pending retry"}` : null,
              driveSync: syncResult.driveSync || null
            });
          } else {
            failedCount++;
            reportDetails.push({ email, status: "failed", error: syncResult.error || "Lỗi đồng bộ phân quyền" });
          }
        } catch (enrollErr) {
          failedCount++;
          reportDetails.push({ email, status: "failed", error: enrollErr.message });
        }
      }

      // Write log into audit_logs if table exists
      try {
        await supabase.from("audit_logs").insert({
          action: "bulk_enroll",
          detail: `Bulk enrolled ${successCount} successfully, ${failedCount} failed for course ${courseSlug} by ${adminSession.email}`,
          created_at: new Date().toISOString()
        });
      } catch (e) {
        // silent fail if audit_logs table doesn't exist
      }

      return res.status(200).json({
        success: true,
        report: {
          success: successCount,
          failed: failedCount,
          skipped: classified.filter(c => c.type === "invalid" || c.type === "duplicate").length
        },
        details: reportDetails
      });
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ" });

  } catch (err) {
    console.error("[bulk-enroll] Error processing action:", err);
    return res.status(500).json({ success: false, error: err.message || "Lỗi xử lý server" });
  }
}
