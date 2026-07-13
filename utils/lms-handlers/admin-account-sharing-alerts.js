import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";
import {
  ACCOUNT_SHARING_EVENT_TYPES,
  getAccountSharingRiskLevel,
  hashOptionalValue,
  logStudentDeviceEvent,
  resetStudentSessionByEmail,
  writeAdminAuditLog
} from "../lms-session-guard.js";

const REVIEW_STATUSES = new Set([
  "new",
  "monitoring",
  "reviewed",
  "suspected_sharing",
  "false_positive",
  "resolved"
]);

function getClientIp(req) {
  return String(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    ""
  ).split(",")[0].trim();
}

function daysAgoIso(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

function rangeToDays(range) {
  const normalized = String(range || "7d").trim().toLowerCase();
  if (normalized === "24h" || normalized === "1d") return 1;
  if (normalized === "30d") return 30;
  return 7;
}

function uniqueTruthy(values) {
  return [...new Set(values.filter(Boolean))];
}

function getEventDeviceHashes(event) {
  return uniqueTruthy([
    event.old_device_hash,
    event.new_device_hash,
    event.lms_device_hash
  ]);
}

function getEventDeviceLabels(event) {
  return uniqueTruthy([
    event.old_device_label,
    event.new_device_label
  ]);
}

function statusLabel(status) {
  const value = String(status || "new");
  if (value === "monitoring") return "Đang theo dõi";
  if (value === "reviewed") return "Đã kiểm tra";
  if (value === "suspected_sharing") return "Nghi ngờ chia sẻ";
  if (value === "false_positive") return "Cảnh báo nhầm";
  if (value === "resolved") return "Đã xử lý";
  return "Mới";
}

function riskLabel(level) {
  if (level === "high") return "Nguy cơ chia sẻ cao";
  if (level === "suspicious") return "Đáng ngờ";
  if (level === "watch") return "Cần theo dõi";
  return "Bình thường";
}

function summarizeEmailEvents(email, events, review = null) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const inWindow = (event, days) => {
    const time = new Date(event.created_at).getTime();
    return Number.isFinite(time) && now - time <= days * dayMs;
  };

  const devices24h = new Set();
  const devices7d = new Set();
  const devices30d = new Set();
  const courses = new Set();
  const recentDeviceLabels = new Set();

  let blockedCount = 0;
  let deviceChangeCount = 0;
  let riskScore = 0;
  let lastDeviceChangeAt = null;

  for (const event of events) {
    const eventType = String(event.event_type || event.action || "");
    const eventScore = Number(event.risk_points || 0);
    riskScore += eventScore;

    if (event.course_slug) courses.add(event.course_slug);
    getEventDeviceLabels(event).forEach(label => recentDeviceLabels.add(label));

    const eventDevices = getEventDeviceHashes(event);
    if (inWindow(event, 1)) eventDevices.forEach(device => devices24h.add(device));
    if (inWindow(event, 7)) eventDevices.forEach(device => devices7d.add(device));
    if (inWindow(event, 30)) eventDevices.forEach(device => devices30d.add(device));

    if (
      eventType === ACCOUNT_SHARING_EVENT_TYPES.LOGIN_BLOCKED_OTHER_DEVICE ||
      event.reason === "active_session_on_another_device"
    ) {
      blockedCount += 1;
    }

    if (event.old_device_hash && event.new_device_hash && event.old_device_hash !== event.new_device_hash) {
      deviceChangeCount += 1;
      if (!lastDeviceChangeAt || new Date(event.created_at) > new Date(lastDeviceChangeAt)) {
        lastDeviceChangeAt = event.created_at;
      }
    }
  }

  riskScore += Math.max(0, devices24h.size - 1) * 15;
  riskScore += Math.max(0, devices7d.size - 2) * 10;
  riskScore += Math.max(0, blockedCount - 1) * 8;
  riskScore += Math.max(0, deviceChangeCount - 1) * 6;

  const riskLevel = getAccountSharingRiskLevel(riskScore);

  return {
    email,
    riskScore,
    riskLevel,
    riskLabel: riskLabel(riskLevel),
    devices24h: devices24h.size,
    devices7d: devices7d.size,
    devices30d: devices30d.size,
    blockedCount,
    deviceChangeCount,
    lastEventAt: events[0]?.created_at || null,
    lastDeviceChangeAt,
    recentDevices: [...recentDeviceLabels].slice(0, 5),
    courseSlugs: [...courses].slice(0, 10),
    reviewStatus: review?.status || "new",
    reviewStatusLabel: statusLabel(review?.status),
    reviewNote: review?.note || "",
    assignedAdminEmail: review?.assigned_admin_email || null
  };
}

async function listAlerts(req, res) {
  const days = rangeToDays(req.query?.range);
  const fromIso = daysAgoIso(days);
  const queryText = normalizeEmail(req.query?.q || "");
  const statusFilter = String(req.query?.status || "").trim();

  const { data: events, error } = await supabase
    .from("student_device_change_logs")
    .select("*")
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw error;

  const eventsByEmail = new Map();
  for (const event of events || []) {
    const email = normalizeEmail(event.email);
    if (!email) continue;
    if (queryText && !email.includes(queryText)) continue;
    if (!eventsByEmail.has(email)) eventsByEmail.set(email, []);
    eventsByEmail.get(email).push(event);
  }

  const reviewEmails = [...eventsByEmail.keys()];
  let reviews = [];
  if (reviewEmails.length > 0) {
    const { data, error: reviewError } = await supabase
      .from("student_account_risk_reviews")
      .select("*")
      .in("email", reviewEmails);
    if (!reviewError) reviews = data || [];
  }

  const reviewMap = new Map(reviews.map(review => [normalizeEmail(review.email), review]));
  let alerts = [...eventsByEmail.entries()]
    .map(([email, emailEvents]) => summarizeEmailEvents(email, emailEvents, reviewMap.get(email)))
    .filter(alert => !statusFilter || alert.reviewStatus === statusFilter)
    .sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return new Date(b.lastEventAt || 0) - new Date(a.lastEventAt || 0);
    });

  return res.status(200).json({
    success: true,
    rangeDays: days,
    alerts,
    totals: {
      emails: alerts.length,
      high: alerts.filter(alert => alert.riskLevel === "high").length,
      suspicious: alerts.filter(alert => alert.riskLevel === "suspicious").length,
      watch: alerts.filter(alert => alert.riskLevel === "watch").length
    }
  });
}

async function getDetail(req, res) {
  const email = normalizeEmail(req.query?.email);
  if (!email) {
    return res.status(400).json({ success: false, error: "Thiếu Gmail học viên" });
  }

  const [
    eventsResult,
    sessionsResult,
    lmsSessionsResult,
    reviewsResult,
    notesResult,
    auditsResult
  ] = await Promise.all([
    supabase
      .from("student_device_change_logs")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("student_active_sessions")
      .select("email,student_session_id,status,login_at,last_seen_at,logout_at,device_label,created_at,updated_at")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("lms_verified_sessions")
      .select("email,student_session_id,course_slug,status,verified_at,last_seen_at,logout_at,created_at,updated_at")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("student_account_risk_reviews")
      .select("*")
      .eq("email", email)
      .maybeSingle(),
    supabase
      .from("student_account_admin_notes")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("admin_audit_logs")
      .select("admin_email,action,target_email,metadata,created_at")
      .eq("target_email", email)
      .order("created_at", { ascending: false })
      .limit(50)
  ]);

  for (const result of [eventsResult, sessionsResult, lmsSessionsResult, notesResult, auditsResult]) {
    if (result.error) throw result.error;
  }

  const events = eventsResult.data || [];
  const summary = summarizeEmailEvents(email, events, reviewsResult.data || null);

  return res.status(200).json({
    success: true,
    email,
    summary,
    events,
    studentSessions: sessionsResult.data || [],
    lmsSessions: lmsSessionsResult.data || [],
    review: reviewsResult.data || null,
    notes: notesResult.data || [],
    audits: auditsResult.data || []
  });
}

async function upsertReview({ email, adminEmail, status = null, note = null, riskScore = null, riskLevel = null }) {
  const normalizedEmail = normalizeEmail(email);
  const { data: existing, error: selectError } = await supabase
    .from("student_account_risk_reviews")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (selectError) throw selectError;

  const payload = {
    email: normalizedEmail,
    updated_at: new Date().toISOString()
  };
  if (status) payload.status = status;
  if (note !== null) payload.note = note;
  if (riskScore !== null) payload.risk_score = riskScore;
  if (riskLevel !== null) payload.risk_level = riskLevel;
  if (adminEmail) payload.assigned_admin_email = adminEmail;

  if (existing) {
    const { data, error } = await supabase
      .from("student_account_risk_reviews")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("student_account_risk_reviews")
    .insert({
      status: "new",
      created_at: new Date().toISOString(),
      ...payload
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function postAction(req, res, adminSession) {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const action = String(body.action || "").trim();
  if (!email || !action) {
    return res.status(400).json({ success: false, error: "Thiếu Gmail hoặc thao tác" });
  }

  const adminEmail = normalizeEmail(adminSession.email);
  const ip = getClientIp(req);
  const userAgent = req.headers?.["user-agent"] || "";

  if (action === "add_note") {
    const note = String(body.note || "").trim();
    if (!note) return res.status(400).json({ success: false, error: "Thiếu nội dung ghi chú" });

    const { error } = await supabase
      .from("student_account_admin_notes")
      .insert({ email, admin_email: adminEmail, note });
    if (error) throw error;

    await upsertReview({ email, adminEmail, note });
    await writeAdminAuditLog(supabase, {
      adminEmail,
      action: "account_sharing_add_note",
      targetEmail: email,
      metadata: { noteLength: note.length },
      ip,
      userAgent
    });
    await logStudentDeviceEvent(supabase, {
      email,
      eventType: ACCOUNT_SHARING_EVENT_TYPES.ADMIN_NOTE,
      adminEmail,
      userAgent,
      ip,
      source: "admin",
      metadata: { noteLength: note.length }
    });
    return res.status(200).json({ success: true });
  }

  if (action === "reset_session") {
    const sessions = await resetStudentSessionByEmail(supabase, email);
    await writeAdminAuditLog(supabase, {
      adminEmail,
      action: "account_sharing_reset_session",
      targetEmail: email,
      metadata: { affectedSessions: sessions.length },
      ip,
      userAgent
    });
    await logStudentDeviceEvent(supabase, {
      email,
      eventType: ACCOUNT_SHARING_EVENT_TYPES.ADMIN_RESET,
      adminEmail,
      userAgent,
      ip,
      source: "admin",
      metadata: { affectedSessions: sessions.length }
    });
    await upsertReview({ email, adminEmail, status: "monitoring" });
    return res.status(200).json({ success: true, affectedSessions: sessions.length });
  }

  const statusByAction = {
    mark_monitoring: "monitoring",
    mark_reviewed: "reviewed",
    mark_suspected: "suspected_sharing",
    mark_false_positive: "false_positive",
    mark_resolved: "resolved"
  };

  const status = statusByAction[action];
  if (!status || !REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ success: false, error: "Thao tác không hợp lệ" });
  }

  const review = await upsertReview({ email, adminEmail, status });
  await writeAdminAuditLog(supabase, {
    adminEmail,
    action: `account_sharing_${action}`,
    targetEmail: email,
    metadata: { status },
    ip,
    userAgent
  });
  await logStudentDeviceEvent(supabase, {
    email,
    eventType: action === "mark_suspected"
      ? ACCOUNT_SHARING_EVENT_TYPES.ADMIN_MARK_SUSPECTED
      : ACCOUNT_SHARING_EVENT_TYPES.ADMIN_MARK_REVIEWED,
    adminEmail,
    userAgent,
    ip,
    source: "admin",
    metadata: { status }
  });

  return res.status(200).json({ success: true, review });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const mode = String(req.query?.mode || "list");
    if (req.method === "GET" && mode === "detail") return getDetail(req, res);
    if (req.method === "GET") return listAlerts(req, res);
    if (req.method === "POST") return postAction(req, res, adminSession);

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    console.error("ACCOUNT_SHARING_ALERTS_API_ERROR:", error.message);
    return res.status(500).json({
      success: false,
      error: "Không tải được dữ liệu cảnh báo chia sẻ tài khoản"
    });
  }
}

