import { supabase } from "../utils/supabase.js";
import {
  normalizeEmail,
  syncEnrollment
} from "../utils/lms.js";
import {
  getInternalSyncSecret,
  timingSafeStringEqual,
  AuthSecretError
} from "../utils/lms-secrets.js";
import { applyCors } from "../utils/cors.js";
import {
  maybeShadowCoursePublish,
  maybeShadowEnrollmentAccess,
} from "../utils/v2-outbox-shadow.js";
import { warmRuntimeConfig } from "../utils/v2-runtime-controller.js";

export default async function handler(req, res) {
  // Warm the V1/V2 runtime master switch once per request so the
  // synchronous behavioral gate (isV2ActiveCached) is populated before the
  // shadow-write helper reads V2_OUTBOX_SHADOW_MODE. Best-effort; never
  // throws. See utils/v2-runtime-controller.js.
  await warmRuntimeConfig();

  // CORS: server-to-server. We allow requests without an Origin header
  // (Shop → LMS), but reject cross-origin browser calls when the
  // feature flag is on. The INTERNAL_SYNC_SECRET check below remains
  // the authoritative authentication layer — CORS does not replace it.
  const cors = applyCors(req, res, {
    mode: "internal",
    methods: "POST, OPTIONS",
    allowedHeaders: "Content-Type, X-Sync-Secret"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // Verify internal sync secret (timing-safe, fail-closed)
  const syncSecret = req.headers["x-sync-secret"];

  let systemSecret;
  try {
    systemSecret = getInternalSyncSecret();
  } catch (err) {
    if (err instanceof AuthSecretError) {
      return res.status(503).json({
        success: false,
        code: "sync_misconfigured",
        error: "Internal sync is unavailable.",
        missingEnvVars: err.missingEnvVars
      });
    }
    throw err;
  }

  if (!syncSecret || !timingSafeStringEqual(String(syncSecret), systemSecret)) {
    return res.status(401).json({ success: false, error: "Unauthorized: Sync secret is invalid or missing." });
  }

  try {
    const { action, slug, title, subtitle, imageUrl, expected_start_date, active, email, courseSlug } = req.body || {};

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

      const nextTitle = String(title || "").trim();
      const nextSubtitle = String(subtitle || "").trim();
      const nextImageUrl = String(imageUrl || "").trim();
      const nextExpectedStartDate = /^\d{4}-\d{2}-\d{2}$/.test(String(expected_start_date || "").trim())
        ? String(expected_start_date).trim()
        : null;

      let result;
      if (existingCourse) {
        // Update metadata without breaking lessons or existing raw_data
        const updatePayload = {
          title: nextTitle,
          active: active !== undefined ? active : true,
          updated_at: new Date().toISOString()
        };
        if (nextSubtitle) {
          updatePayload.subtitle = nextSubtitle;
        }
        if (nextImageUrl) {
          updatePayload.image_url = nextImageUrl;
        }
        if (expected_start_date !== undefined) {
          updatePayload.expected_start_date = nextExpectedStartDate;
        }

        const { error: updateErr } = await supabase
          .from("courses")
          .update(updatePayload)
          .eq("id", existingCourse.id);

        if (updateErr) throw updateErr;
        result = { id: existingCourse.id, updated: true };
      } else {
        // Create new course in draft mode
        const { data: newCourse, error: insertErr } = await supabase
          .from("courses")
          .insert({
            slug: slug.trim(),
            title: nextTitle,
            subtitle: nextSubtitle || null,
            image_url: nextImageUrl || null,
            expected_start_date: nextExpectedStartDate,
            active: active !== undefined ? active : true,
            sort_order: 999 // Default to end of list
          })
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        result = { id: newCourse.id, created: true };
      }

      // V2 shadow: mirror the course publish event to the outbox when
      // V2_OUTBOX_SHADOW_MODE is on. Fail-open — never affects V1 response.
      await maybeShadowCoursePublish({
        slug: slug.trim(),
        title: nextTitle,
        image_url: nextImageUrl,
        is_published: active !== undefined ? active : true,
        expected_start_date: nextExpectedStartDate,
      });

      return res.status(200).json({ success: true, course: result });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SYNC ENROLLMENT (Duyệt cấp quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "syncEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "create"
      });

      // V2 shadow: mirror the enrollment upsert to the outbox (fail-open).
      if (syncResult?.success) {
        await maybeShadowEnrollmentAccess(
          { email: normalizeEmail(email), course_slug: courseSlug, status: "active" },
          "upserted"
        );
      }

      return res.status(200).json(syncResult);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. REVOKE ENROLLMENT (Hủy/Thu hồi quyền học viên)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "revokeEnrollment") {
      if (!email || !courseSlug) {
        return res.status(400).json({ success: false, error: "Thiếu email hoặc courseSlug" });
      }

      const syncResult = await syncEnrollment(supabase, {
        email,
        courseSlug,
        action: "revoke"
      });

      // V2 shadow: mirror the enrollment revoke to the outbox (fail-open).
      if (syncResult?.success) {
        await maybeShadowEnrollmentAccess(
          { email: normalizeEmail(email), course_slug: courseSlug },
          "revoked"
        );
      }

      return res.status(200).json(syncResult);
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ" });
  } catch (error) {
    console.error("[sync] Error in handler:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
