import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
    const duplicateSet = new Set();
    
    rawEmails.forEach((rawEmail) => {
      const email = normalizeEmail(rawEmail);
      if (!isValidEmail(email)) {
        classified.push({ email: rawEmail, type: "invalid", detail: "Email sai định dạng" });
        return;
      }
      
      if (validEmailsSet.has(email)) {
        duplicateSet.add(email);
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

      // 1. Fetch course ID by slug
      const { data: courseRec, error: courseErr } = await supabase
        .from("courses")
        .select("id")
        .eq("slug", courseSlug)
        .maybeSingle();
      
      if (courseErr) throw courseErr;
      const courseId = courseRec?.id || null;

      // 2. Fetch existing students in batches of 1000
      const existingStudents = new Map(); // email -> student_id
      const chunks = chunkArray(uniqueValidEmails, 1000);
      for (const chunk of chunks) {
        const { data: students, error: fetchErr } = await supabase
          .from("students")
          .select("id, email")
          .in("email", chunk);
        
        if (fetchErr) throw fetchErr;
        if (students) {
          students.forEach(s => existingStudents.set(normalizeEmail(s.email), s.id));
        }
      }

      // 3. Find missing students to insert
      const missingEmails = uniqueValidEmails.filter(email => !existingStudents.has(email));
      
      if (missingEmails.length > 0) {
        const missingStudentsPayload = missingEmails.map(email => ({
          email,
          status: "active",
          created_at: new Date().toISOString()
        }));

        // Insert new students in chunks of 1000
        const missingChunks = chunkArray(missingStudentsPayload, 1000);
        for (const missingChunk of missingChunks) {
          const { data: newStudents, error: insertErr } = await supabase
            .from("students")
            .insert(missingChunk)
            .select("id, email");
          
          if (insertErr) throw insertErr;
          if (newStudents) {
            newStudents.forEach(s => existingStudents.set(normalizeEmail(s.email), s.id));
          }
        }
      }

      // 4. Construct enrollment payloads
      const enrollmentPayloads = uniqueValidEmails.map(email => {
        const studentId = existingStudents.get(email);
        return {
          student_id: studentId,
          course_id: courseId,
          course_slug: courseSlug,
          email: email,
          status: status,
          expired_at: expiresAt || null,
          updated_at: new Date().toISOString()
        };
      });

      // 5. Bulk upsert enrollments in chunks of 1000
      let successCount = 0;
      let failedCount = 0;
      const reportDetails = [];

      const enrollChunks = chunkArray(enrollmentPayloads, 1000);
      for (const enrollChunk of enrollChunks) {
        const { error: upsertErr } = await supabase
          .from("student_enrollments")
          .upsert(enrollChunk, { onConflict: "email,course_slug" });
        
        if (upsertErr) {
          console.error("[bulk-enroll] Batch upsert failed:", upsertErr);
          failedCount += enrollChunk.length;
          enrollChunk.forEach(item => {
            reportDetails.push({ email: item.email, status: "failed", error: upsertErr.message });
          });
        } else {
          successCount += enrollChunk.length;
          enrollChunk.forEach(item => {
            reportDetails.push({ email: item.email, status: "success", error: null });
          });
        }
      }

      // 6. Write log into audit_logs if table exists
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
