import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { email } = req.query || {};
    if (!email) {
      return res.status(400).json({ success: false, error: "Thiếu email để tra cứu" });
    }

    const cleanEmail = normalizeEmail(email);

    // Fetch data with separate try/catches to be highly crash-resilient
    let student = null;
    try {
      const { data } = await supabase
        .from("students")
        .select("*")
        .ilike("email", cleanEmail)
        .maybeSingle();
      student = data;
    } catch (e) {
      console.warn("Failed to fetch from students:", e.message);
    }

    let orders = [];
    try {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .ilike("customer_email", cleanEmail)
        .order("created_at", { ascending: false });
      orders = data || [];
    } catch (e) {
      console.warn("Failed to fetch from orders:", e.message);
    }

    let enrollments = [];
    try {
      const { data } = await supabase
        .from("student_enrollments")
        .select("*")
        .ilike("email", cleanEmail)
        .order("created_at", { ascending: false });
      enrollments = data || [];
    } catch (e) {
      console.warn("Failed to fetch from student_enrollments:", e.message);
    }

    let logs = [];
    try {
      const { data } = await supabase
        .from("drive_permission_logs")
        .select("*")
        .ilike("email", cleanEmail)
        .order("time", { ascending: false })
        .limit(20);
      logs = data || [];
    } catch (e) {
      console.warn("Failed to fetch from drive_permission_logs:", e.message);
    }

    let syncQueue = [];
    try {
      const { data } = await supabase
        .from("drive_sync_queue")
        .select("*")
        .ilike("email", cleanEmail)
        .order("updated_at", { ascending: false });
      syncQueue = data || [];
    } catch (e) {
      console.warn("Failed to fetch from drive_sync_queue:", e.message);
    }

    let courses = [];
    try {
      const { data } = await supabase
        .from("courses")
        .select("slug, title, drive_folder_id");
      courses = data || [];
    } catch (e) {
      console.warn("Failed to fetch from courses:", e.message);
    }

    // Process conclusions
    const conclusions = [];
    const allCourseSlugs = new Set();
    orders.forEach(o => { if (o.course_slug) allCourseSlugs.add(o.course_slug); });
    enrollments.forEach(e => { if (e.course_slug) allCourseSlugs.add(e.course_slug); });

    allCourseSlugs.forEach(slug => {
      const courseObj = courses.find(c => c.slug === slug);
      const courseTitle = courseObj ? courseObj.title : slug;
      
      const courseOrders = orders.filter(o => o.course_slug === slug);
      const courseEnrollments = enrollments.filter(e => e.course_slug === slug);
      
      const statusList = [];
      let isLmsActive = false;
      let driveStatus = "unknown";
      let driveError = null;

      // 1. Check orders sync status
      const approvedOrderWithoutEnrollment = courseOrders.some(o => o.status === "Đã duyệt" && courseEnrollments.length === 0);
      const lmsSyncFailed = courseOrders.some(o => o.sync_lms_status === "FAILED");

      if (approvedOrderWithoutEnrollment) {
        statusList.push("Có đơn đã duyệt nhưng chưa có enrollment");
      }
      if (lmsSyncFailed) {
        statusList.push("Có đơn nhưng sync_lms_status failed");
      }

      // 2. Check enrollments status
      if (courseEnrollments.length > 0) {
        const activeEnrollment = courseEnrollments.find(e => 
          ["active", "approved", "approved_ready", "approved_waiting_content", "completed", "da duyet"].includes(e.status)
        );
        if (activeEnrollment) {
          isLmsActive = true;
          statusList.push("Đã có quyền học web");
          driveStatus = activeEnrollment.drive_permission_status || "unknown";
          driveError = activeEnrollment.drive_permission_error;
        } else {
          statusList.push("Chưa có quyền học web");
        }
      } else if (!approvedOrderWithoutEnrollment) {
        statusList.push("Chưa có quyền học web");
      }

      // 3. Check Drive status & errors
      const normalizedDriveStatus = String(driveStatus).toLowerCase();
      if (normalizedDriveStatus === "success") {
        statusList.push("Drive đã cấp thành công");
        
        // Check if there is a recent drive_permission_log for this course
        const hasLog = logs.some(l => l.course_slug === slug && String(l.status).toLowerCase() === "success");
        if (!hasLog) {
          statusList.push("Gmail có enrollment success nhưng không có log Drive gần đây");
        }
      } else if (["failed", "pending_retry", "error", "quota_limited"].includes(normalizedDriveStatus)) {
        statusList.push("Drive đang lỗi");
        statusList.push("Có enrollment nhưng Drive failed");
      }

      conclusions.push({
        courseSlug: slug,
        courseTitle,
        driveFolderId: courseObj ? courseObj.drive_folder_id : null,
        isLmsActive,
        driveStatus,
        driveError,
        statusList
      });
    });

    if (conclusions.length === 0 && !student) {
      conclusions.push({
        courseSlug: "none",
        courseTitle: "N/A",
        statusList: ["Gmail này chưa có đơn/khóa nào"]
      });
    }

    return res.status(200).json({
      success: true,
      student,
      orders,
      enrollments,
      logs,
      syncQueue,
      conclusions
    });
  } catch (error) {
    console.error("STUDENT_TRACE_API_ERROR:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
