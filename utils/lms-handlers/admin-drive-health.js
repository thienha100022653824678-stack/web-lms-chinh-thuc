import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { applyCors } from "../cors.js";

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

    if (req.method !== "GET") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const { range } = req.query || {};
    let startDate = null;
    const now = new Date();

    if (range === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (range === "7d") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (range === "30d") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    // 1. Fetch Drive Permission Logs count and data within the range
    let logsQuery = supabase.from("drive_permission_logs").select("status, time");
    if (startDate && range !== "all_errors") {
      logsQuery = logsQuery.gte("time", startDate);
    }
    const { data: logs, error: logsError } = await logsQuery;
    if (logsError) throw logsError;

    let totalAttempts = 0;
    let successCount = 0;
    let failedCount = 0;
    let pendingRetryCount = 0;

    (logs || []).forEach(log => {
      totalAttempts++;
      const s = String(log.status || "").toLowerCase().trim();
      if (s === "success") {
        successCount++;
      } else if (s === "pending_retry") {
        pendingRetryCount++;
      } else if (s === "failed" || s === "error" || s === "quota_limited") {
        failedCount++;
      }
    });

    // 2. Fetch recent Drive errors (limit to 30)
    let recentErrorsQuery = supabase
      .from("drive_permission_logs")
      .select("id, time, email, course_slug, status, error_message, drive_admin_email, action")
      .not("status", "in", '("success","SUCCESS")')
      .order("time", { ascending: false })
      .limit(30);

    if (startDate && range !== "all_errors") {
      recentErrorsQuery = recentErrorsQuery.gte("time", startDate);
    }
    const { data: recentErrors, error: recentErrorsError } = await recentErrorsQuery;
    if (recentErrorsError) throw recentErrorsError;

    // 3. Fetch admin accounts status in Drive pool
    const { data: adminAccounts, error: adminAccountsError } = await supabase
      .from("drive_admin_accounts")
      .select("email, status, daily_share_count, last_error, last_error_at");
    if (adminAccountsError) throw adminAccountsError;

    let activeAdmins = 0;
    let errorAdmins = 0;
    let quotaLimitedAdmins = 0;

    (adminAccounts || []).forEach(acc => {
      const s = String(acc.status || "").toLowerCase().trim();
      if (s === "active") {
        activeAdmins++;
      } else if (s === "quota_limited") {
        quotaLimitedAdmins++;
      } else {
        errorAdmins++;
      }
    });

    // 4. Fetch enrollments with Drive errors (failed / pending_retry)
    const { data: errorEnrollments, error: errorEnrollmentsError } = await supabase
      .from("student_enrollments")
      .select("email, course_slug, drive_permission_status, drive_permission_error, updated_at")
      .in("drive_permission_status", ["failed", "FAILED", "pending_retry", "PENDING_RETRY", "error"])
      .order("updated_at", { ascending: false });
    if (errorEnrollmentsError) throw errorEnrollmentsError;

    const enrollmentErrorsCount = errorEnrollments?.length || 0;

    // 5. Fetch courses with lessons but missing drive_folder_id
    const [coursesResult, lessonsResult] = await Promise.all([
      supabase.from("courses").select("id, slug, title, drive_folder_id"),
      supabase.from("lessons").select("course_slug")
    ]);

    if (coursesResult.error) throw coursesResult.error;
    if (lessonsResult.error) throw lessonsResult.error;

    const distinctLessonSlugs = new Set((lessonsResult.data || []).map(l => String(l.course_slug || "").trim()).filter(Boolean));
    const missingFolderCourses = (coursesResult.data || []).filter(c => {
      const hasLesson = distinctLessonSlugs.has(String(c.slug || "").trim());
      const hasNoFolder = !c.drive_folder_id || !String(c.drive_folder_id).trim();
      return hasLesson && hasNoFolder;
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalAttempts,
        success: successCount,
        failed: failedCount,
        pendingRetry: pendingRetryCount,
        enrollmentErrors: enrollmentErrorsCount
      },
      adminPool: {
        active: activeAdmins,
        error: errorAdmins,
        quotaLimited: quotaLimitedAdmins,
        accounts: adminAccounts || []
      },
      recentErrors: recentErrors || [],
      errorEnrollments: errorEnrollments || [],
      missingFolderCourses: missingFolderCourses || []
    });

  } catch (err) {
    console.error("[drive-health] Error in handler:", err);
    return res.status(500).json({ success: false, error: err.message || "Lỗi xử lý server" });
  }
}
