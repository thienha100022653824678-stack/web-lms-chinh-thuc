import { supabase } from "../supabase.js";
import { getAdminFromRequest, normalizeEmail } from "../lms.js";
import {
  ACCOUNT_SHARING_EVENT_TYPES,
  ACCOUNT_SHARING_RISK_RULE_VERSION,
  getAccountEventHashVersion,
  getAccountSharingRiskLevel,
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

const RISK_LEVELS = new Set(["normal", "watch", "suspicious", "high"]);
const DETAIL_PAGE_SIZE_DEFAULT = 50;
const DETAIL_PAGE_SIZE_MAX = 100;
const TIMELINE_COLLAPSE_WINDOW_MS = 5 * 60 * 1000;

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

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rangeToDays(range) {
  const normalized = String(range || "7d").trim().toLowerCase();
  if (normalized === "24h" || normalized === "1d") return 1;
  if (normalized === "30d") return 30;
  return 7;
}

function isMissingSummaryTable(error) {
  return /student_account_risk_summaries|column .* does not exist|relation .* does not exist|schema cache|PGRST204/i.test(String(error?.message || ""));
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

function isAdminEvent(event) {
  const source = String(event.event_source || "").toLowerCase();
  const type = String(event.event_type || event.action || "");
  return source === "admin" || type.startsWith("admin_");
}

function dedupeEvents(events) {
  const seen = new Set();
  const output = [];
  for (const event of events || []) {
    const key = event.event_idempotency_key || `${event.id || ""}:${event.created_at || ""}:${event.event_type || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

function statusLabel(status) {
  const value = String(status || "new");
  if (value === "monitoring") return "Dang theo doi";
  if (value === "reviewed") return "Da kiem tra";
  if (value === "suspected_sharing") return "Nghi ngo chia se";
  if (value === "false_positive") return "Canh bao nham";
  if (value === "resolved") return "Da xu ly";
  return "Moi";
}

function riskLabel(level) {
  if (level === "high") return "Nguy co chia se cao";
  if (level === "suspicious") return "Dang ngo";
  if (level === "watch") return "Can theo doi";
  return "Binh thuong";
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
  const reasons = [];
  const currentHashVersion = getAccountEventHashVersion();
  const scoredEvents = dedupeEvents(events)
    .filter(event => !isAdminEvent(event))
    .filter(event => !event.hash_version || event.hash_version === currentHashVersion);

  for (const event of scoredEvents) {
    const eventType = String(event.event_type || event.action || "");

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

  const device24Score = Math.min(Math.max(0, devices24h.size - 1) * 18, 36);
  const device7Score = Math.min(Math.max(0, devices7d.size - 2) * 10, 30);
  const blockedScore = Math.min(blockedCount * 14, 42);
  const changeScore = Math.min(Math.max(0, deviceChangeCount - 1) * 8, 24);
  riskScore = device24Score + device7Score + blockedScore + changeScore;

  if (devices24h.size > 1) {
    reasons.push({
      code: "multiple_browser_profiles_24h",
      label: "Nhieu ho so trong 24h",
      detail: `${devices24h.size} ho so thiet bi/trinh duyet trong 24h`,
      points: device24Score
    });
  }
  if (blockedCount > 0) {
    reasons.push({
      code: "blocked_other_device",
      label: "Bi chan thiet bi khac",
      detail: `${blockedCount} lan bi chan do Gmail dang dung o ho so khac`,
      points: blockedScore
    });
  }
  if (deviceChangeCount > 1) {
    reasons.push({
      code: "rapid_device_changes",
      label: "Doi ho so nhanh",
      detail: `${deviceChangeCount} lan doi ho so thiet bi/trinh duyet`,
      points: changeScore
    });
  }
  if (devices7d.size > 2) {
    reasons.push({
      code: "many_profiles_7d",
      label: "Nhieu ho so trong 7 ngay",
      detail: `${devices7d.size} ho so thiet bi/trinh duyet trong 7 ngay`,
      points: device7Score
    });
  }

  reasons.sort((a, b) => b.points - a.points);

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
    assignedAdminEmail: review?.assigned_admin_email || null,
    riskRuleVersion: ACCOUNT_SHARING_RISK_RULE_VERSION,
    reasons
  };
}

function summaryToAlert(row) {
  return {
    email: normalizeEmail(row.email),
    riskScore: Number(row.risk_score || 0),
    riskLevel: row.risk_level || "normal",
    riskLabel: riskLabel(row.risk_level || "normal"),
    devices24h: Number(row.devices_24h || 0),
    devices7d: Number(row.devices_7d || 0),
    devices30d: Number(row.devices_30d || 0),
    blockedCount: Number(row.blocked_count || 0),
    deviceChangeCount: Number(row.device_change_count || 0),
    lastEventAt: row.last_event_at || null,
    lastDeviceChangeAt: row.last_device_change_at || null,
    recentDevices: safeJsonArray(row.recent_devices).slice(0, 5),
    courseSlugs: safeJsonArray(row.course_slugs).slice(0, 10),
    reviewStatus: row.review_status || "new",
    reviewStatusLabel: statusLabel(row.review_status),
    reviewNote: row.review_note || "",
    assignedAdminEmail: row.assigned_admin_email || null,
    monitoringUntil: row.monitoring_until || null,
    resolvedAt: row.resolved_at || null,
    falsePositiveAt: row.false_positive_at || null,
    riskRuleVersion: row.risk_rule_version || ACCOUNT_SHARING_RISK_RULE_VERSION,
    reasons: safeJsonArray(row.reasons)
  };
}

function summaryPayload(alert, review = null, days = 30) {
  const now = new Date();
  return {
    email: normalizeEmail(alert.email),
    risk_score: Number(alert.riskScore || 0),
    risk_level: alert.riskLevel || "normal",
    devices_24h: Number(alert.devices24h || 0),
    devices_7d: Number(alert.devices7d || 0),
    devices_30d: Number(alert.devices30d || 0),
    blocked_count: Number(alert.blockedCount || 0),
    device_change_count: Number(alert.deviceChangeCount || 0),
    last_event_at: alert.lastEventAt || null,
    last_device_change_at: alert.lastDeviceChangeAt || null,
    recent_devices: alert.recentDevices || [],
    course_slugs: alert.courseSlugs || [],
    reasons: alert.reasons || [],
    review_status: review?.status || alert.reviewStatus || "new",
    review_note: review?.note || alert.reviewNote || null,
    assigned_admin_email: review?.assigned_admin_email || alert.assignedAdminEmail || null,
    monitoring_until: review?.monitoring_until || alert.monitoringUntil || null,
    resolved_at: review?.resolved_at || alert.resolvedAt || null,
    false_positive_at: review?.false_positive_at || alert.falsePositiveAt || null,
    risk_rule_version: ACCOUNT_SHARING_RISK_RULE_VERSION,
    summary_window_days: Number(days || 30),
    computed_at: now.toISOString(),
    stale_after: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    updated_at: now.toISOString()
  };
}

async function computeAlertsFromEvents({ days, queryText = "", statusFilter = "", courseFilter = "", riskFilter = "" }) {
  const fromIso = daysAgoIso(days);
  const { data: events, error } = await supabase
    .from("student_device_change_logs")
    .select("*")
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) throw error;

  const eventsByEmail = new Map();
  for (const event of events || []) {
    const email = normalizeEmail(event.email);
    if (!email) continue;
    if (queryText && !email.includes(queryText)) continue;
    if (courseFilter && String(event.course_slug || "") !== courseFilter) continue;
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
  const alerts = [...eventsByEmail.entries()]
    .map(([email, emailEvents]) => summarizeEmailEvents(email, emailEvents, reviewMap.get(email)))
    .filter(alert => !statusFilter || alert.reviewStatus === statusFilter)
    .filter(alert => !riskFilter || alert.riskLevel === riskFilter)
    .sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return new Date(b.lastEventAt || 0) - new Date(a.lastEventAt || 0);
    });

  return { alerts, reviews: reviewMap };
}

async function refreshRiskSummaries(days = 30) {
  const { alerts, reviews } = await computeAlertsFromEvents({ days });
  if (!alerts.length) return { ok: true, refreshed: 0 };

  const payloads = alerts.map(alert => summaryPayload(alert, reviews.get(normalizeEmail(alert.email)), days));
  const { error } = await supabase
    .from("student_account_risk_summaries")
    .upsert(payloads, { onConflict: "email" });

  if (error) {
    if (isMissingSummaryTable(error)) return { ok: false, missingTable: true, refreshed: 0 };
    throw error;
  }

  return { ok: true, refreshed: payloads.length };
}

async function listAlerts(req, res) {
  const days = rangeToDays(req.query?.range);
  const queryText = normalizeEmail(req.query?.q || "");
  const statusFilter = String(req.query?.status || "").trim();
  const riskFilter = String(req.query?.risk || "").trim();
  const courseFilter = String(req.query?.course || "").trim();
  const pageSize = parsePositiveInt(req.query?.limit, 100, 250);

  if (riskFilter && !RISK_LEVELS.has(riskFilter)) {
    return res.status(400).json({ success: false, error: "Muc rui ro khong hop le" });
  }

  let usedSummaryTable = true;
  let refreshResult = { ok: false, refreshed: 0 };
  try {
    refreshResult = await refreshRiskSummaries(Math.max(days, 30));

    let query = supabase
      .from("student_account_risk_summaries")
      .select("*")
      .order("risk_score", { ascending: false })
      .order("last_event_at", { ascending: false })
      .limit(pageSize);

    if (queryText) query = query.ilike("email", `%${queryText}%`);
    if (statusFilter) query = query.eq("review_status", statusFilter);
    if (riskFilter) query = query.eq("risk_level", riskFilter);

    const { data, error } = await query;
    if (error) throw error;

    let alerts = (data || []).map(summaryToAlert)
      .filter(alert => !courseFilter || (alert.courseSlugs || []).includes(courseFilter));

    return res.status(200).json({
      success: true,
      rangeDays: days,
      usedSummaryTable,
      refresh: refreshResult,
      alerts,
      totals: {
        emails: alerts.length,
        high: alerts.filter(alert => alert.riskLevel === "high").length,
        suspicious: alerts.filter(alert => alert.riskLevel === "suspicious").length,
        watch: alerts.filter(alert => alert.riskLevel === "watch").length
      }
    });
  } catch (error) {
    if (!isMissingSummaryTable(error)) throw error;
    usedSummaryTable = false;
  }

  const { alerts } = await computeAlertsFromEvents({ days, queryText, statusFilter, courseFilter, riskFilter });

  return res.status(200).json({
    success: true,
    rangeDays: days,
    usedSummaryTable,
    alerts,
    totals: {
      emails: alerts.length,
      high: alerts.filter(alert => alert.riskLevel === "high").length,
      suspicious: alerts.filter(alert => alert.riskLevel === "suspicious").length,
      watch: alerts.filter(alert => alert.riskLevel === "watch").length
    }
  });
}

function canCollapseEvents(current, previous) {
  if (!current || !previous) return false;
  const currentTime = new Date(current.created_at).getTime();
  const previousTime = new Date(previous.created_at).getTime();
  if (!Number.isFinite(currentTime) || !Number.isFinite(previousTime)) return false;
  if (Math.abs(previousTime - currentTime) > TIMELINE_COLLAPSE_WINDOW_MS) return false;
  return String(current.event_type || current.action || "") === String(previous.event_type || previous.action || "")
    && String(current.course_slug || "") === String(previous.course_slug || "")
    && String(current.reason_code || current.reason || "") === String(previous.reason_code || previous.reason || "")
    && String(current.old_device_hash || "") === String(previous.old_device_hash || "")
    && String(current.new_device_hash || "") === String(previous.new_device_hash || "")
    && String(current.lms_device_hash || "") === String(previous.lms_device_hash || "");
}

function collapseTimelineEvents(events) {
  const output = [];
  for (const event of events || []) {
    const last = output[output.length - 1];
    if (last && canCollapseEvents(event, last)) {
      last.repeat_count = Number(last.repeat_count || 1) + 1;
      last.first_created_at = event.created_at;
      continue;
    }
    output.push({ ...event, repeat_count: 1, first_created_at: event.created_at });
  }
  return output;
}

async function getDetail(req, res) {
  const email = normalizeEmail(req.query?.email);
  if (!email) {
    return res.status(400).json({ success: false, error: "Thieu Gmail hoc vien" });
  }

  const pageSize = parsePositiveInt(req.query?.limit, DETAIL_PAGE_SIZE_DEFAULT, DETAIL_PAGE_SIZE_MAX);
  const cursor = String(req.query?.cursor || "").trim();
  const courseFilter = String(req.query?.course || "").trim();
  const collapse = String(req.query?.collapse || "1") !== "0";

  let eventsQuery = supabase
    .from("student_device_change_logs")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  if (cursor) eventsQuery = eventsQuery.lt("created_at", cursor);
  if (courseFilter) eventsQuery = eventsQuery.eq("course_slug", courseFilter);

  const [
    eventsResult,
    sessionsResult,
    lmsSessionsResult,
    reviewsResult,
    notesResult,
    auditsResult
  ] = await Promise.all([
    eventsQuery,
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
  const hasMoreEvents = events.length > pageSize;
  const pageEvents = hasMoreEvents ? events.slice(0, pageSize) : events;
  const renderedEvents = collapse ? collapseTimelineEvents(pageEvents) : pageEvents;
  const nextCursor = hasMoreEvents ? pageEvents[pageEvents.length - 1]?.created_at || null : null;
  const summary = summarizeEmailEvents(email, pageEvents, reviewsResult.data || null);

  return res.status(200).json({
    success: true,
    email,
    summary,
    events: renderedEvents,
    pagination: {
      limit: pageSize,
      nextCursor,
      hasMore: hasMoreEvents,
      collapsed: collapse
    },
    studentSessions: sessionsResult.data || [],
    lmsSessions: lmsSessionsResult.data || [],
    review: reviewsResult.data || null,
    notes: notesResult.data || [],
    audits: auditsResult.data || []
  });
}

async function updateSummaryReviewFields(email, review) {
  if (!review) return;
  const normalizedEmail = normalizeEmail(email);
  const { error } = await supabase
    .from("student_account_risk_summaries")
    .update({
      review_status: review.status || "new",
      review_note: review.note || null,
      assigned_admin_email: review.assigned_admin_email || null,
      monitoring_until: review.monitoring_until || null,
      resolved_at: review.resolved_at || null,
      false_positive_at: review.false_positive_at || null,
      updated_at: new Date().toISOString()
    })
    .eq("email", normalizedEmail);
  if (error && !isMissingSummaryTable(error)) throw error;
}

async function upsertReview({
  email,
  adminEmail,
  status = null,
  note = null,
  riskScore = null,
  riskLevel = null,
  monitoringUntil = null
}) {
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
  if (monitoringUntil !== null) payload.monitoring_until = monitoringUntil || null;
  if (status === "resolved") payload.resolved_at = new Date().toISOString();
  if (status === "false_positive") payload.false_positive_at = new Date().toISOString();
  if (status && status !== "resolved") payload.resolved_at = null;
  if (status && status !== "false_positive") payload.false_positive_at = null;

  if (existing) {
    let { data, error } = await supabase
      .from("student_account_risk_reviews")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error && isMissingSummaryTable(error)) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.monitoring_until;
      delete fallbackPayload.resolved_at;
      delete fallbackPayload.false_positive_at;
      ({ data, error } = await supabase
        .from("student_account_risk_reviews")
        .update(fallbackPayload)
        .eq("id", existing.id)
        .select("*")
        .single());
    }
    if (error) throw error;
    await updateSummaryReviewFields(normalizedEmail, data);
    return data;
  }

  let { data, error } = await supabase
    .from("student_account_risk_reviews")
    .insert({
      status: "new",
      created_at: new Date().toISOString(),
      ...payload
    })
    .select("*")
    .single();
  if (error && isMissingSummaryTable(error)) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.monitoring_until;
    delete fallbackPayload.resolved_at;
    delete fallbackPayload.false_positive_at;
    ({ data, error } = await supabase
      .from("student_account_risk_reviews")
      .insert({
        status: "new",
        created_at: new Date().toISOString(),
        ...fallbackPayload
      })
      .select("*")
      .single());
  }
  if (error) throw error;
  await updateSummaryReviewFields(normalizedEmail, data);
  return data;
}

async function postAction(req, res, adminSession) {
  const body = req.body || {};
  const action = String(body.action || "").trim();
  if (!action) {
    return res.status(400).json({ success: false, error: "Thieu thao tac" });
  }

  const adminEmail = normalizeEmail(adminSession.email);
  const ip = getClientIp(req);
  const userAgent = req.headers?.["user-agent"] || "";

  if (action === "cleanup_retention") {
    const retentionDays = parsePositiveInt(body.retentionDays, 180, 365);
    const { data, error } = await supabase.rpc("cleanup_student_account_risk_events", {
      p_retention_days: retentionDays
    });
    if (error) throw error;

    await writeAdminAuditLog(supabase, {
      adminEmail,
      action: "account_sharing_cleanup_retention",
      metadata: { retentionDays, result: data || null },
      ip,
      userAgent
    });
    return res.status(200).json({ success: true, cleanup: data || null });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return res.status(400).json({ success: false, error: "Thieu Gmail hoc vien" });
  }

  if (action === "add_note") {
    const note = String(body.note || "").trim();
    if (!note) return res.status(400).json({ success: false, error: "Thieu noi dung ghi chu" });

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
    return res.status(200).json({ success: true });
  }

  if (action === "reset_session") {
    const resetResult = await resetStudentSessionByEmail(supabase, email, {
      adminEmail,
      reason: "account_sharing_admin_reset"
    });
    await writeAdminAuditLog(supabase, {
      adminEmail,
      action: "account_sharing_reset_session",
      targetEmail: email,
      metadata: {
        affectedStudentSessions: resetResult.studentSessions,
        affectedEntryTokens: resetResult.entryTokens,
        affectedLmsSessions: resetResult.lmsSessions,
        usedRpc: resetResult.usedRpc
      },
      ip,
      userAgent
    });
    await upsertReview({ email, adminEmail, status: "monitoring" });
    return res.status(200).json({
      success: true,
      affectedSessions: resetResult.studentSessions,
      reset: resetResult
    });
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
    return res.status(400).json({ success: false, error: "Thao tac khong hop le" });
  }

  const monitoringUntil = action === "mark_monitoring" ? String(body.monitoring_until || "").trim() : null;
  const review = await upsertReview({ email, adminEmail, status, monitoringUntil });
  await writeAdminAuditLog(supabase, {
    adminEmail,
    action: `account_sharing_${action}`,
    targetEmail: email,
    metadata: { status, monitoringUntil: monitoringUntil || null },
    ip,
    userAgent
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
      return res.status(401).json({ success: false, error: "Chua dang nhap admin" });
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
      error: "Khong tai duoc du lieu canh bao chia se tai khoan"
    });
  }
}

