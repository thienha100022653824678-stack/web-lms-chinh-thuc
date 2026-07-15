// utils/v3-media.js
// V3 Phase 9 (⑫) — session-bound signed media URLs + opt-in DRM per course.
//
// V1 signs a Bunny embed URL with a 600s TTL but the URL is not bound to the
// session — a leak is usable for 600s by anyone. V3 binds the signature to the
// (server-minted) lms_session_id so a leaked URL dies the moment the session is
// revoked/expired (Phase 4 gives us a real, revocable session id). The signature
// mixes the session id into the HMAC, and the TTL is short.
//
// DRM (Widevine/FairPlay) is opt-in per course (high-value content). This module
// exposes the interface + a DRM-disabled default; wiring a real DRM provider
// (Bunny DRM / external) is owner infra — recorded pending, not blocking.
//
// v3-gated where it reads runtime config; the pure signing helpers are
// mode-independent so they're unit-testable without a DB.

import crypto from 'node:crypto';
import { getEffectiveMode } from './runtime-controller.js';

const DEFAULT_MEDIA_TTL_SECONDS = 120; // 2 min — short; re-sign frequently.

function cleanText(value) {
  return String(value || '').trim();
}

// Parse a Bunny embed URL (libraryId, videoId) from various input shapes.
// Reuses the V1 detection intent: https://player.mediadelivery.net/embed/<lib>/<vid>
// or https://video.bunnycdn.com/embed/<lib>/<vid>.
export function parseBunnyEmbed(videoUrl) {
  const url = cleanText(videoUrl);
  if (!url) return null;
  const m = url.match(/(?:player\.mediadelivery\.net|video\.bunnycdn\.com)\/embed\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  return { libraryId: m[1], videoId: m[2] };
}

// Sign a media URL bound to a session. The HMAC mixes tokenKey + videoId +
// expires + sessionId, so a URL minted for session A will not validate when
// presented under session B, and revoking A invalidates its URLs at once.
//
// Returns a descriptor; never throws on missing key (returns a status so the
// caller can fail closed with a clear code rather than a 500).
export function signSessionBoundMediaUrl({ videoUrl, sessionId, ttlSeconds = DEFAULT_MEDIA_TTL_SECONDS, tokenKey } = {}) {
  const sid = cleanText(sessionId);
  const key = cleanText(tokenKey ?? process.env.BUNNY_STREAM_TOKEN_KEY);
  const parsed = parseBunnyEmbed(videoUrl);

  if (!parsed) {
    return { secureVideoUrl: videoUrl || '', videoProvider: '', videoAuthStatus: 'not_bunny_embed' };
  }
  if (!sid) {
    return { secureVideoUrl: '', videoProvider: 'bunny_embed', videoAuthStatus: 'missing_session' };
  }
  if (!key) {
    return { secureVideoUrl: '', videoProvider: 'bunny_embed', videoAuthStatus: 'missing_bunny_stream_token_key', normalizedVideoUrl: normalizedEmbed(parsed) };
  }

  const expires = Math.floor(Date.now() / 1000) + Math.max(15, Number(ttlSeconds) || DEFAULT_MEDIA_TTL_SECONDS);
  const token = crypto
    .createHash('sha256')
    .update(`${key}${parsed.videoId}${expires}${sid}`)
    .digest('hex');

  const normalized = normalizedEmbed(parsed);
  return {
    secureVideoUrl: `${normalized}?token=${token}&expires=${expires}`,
    videoProvider: 'bunny_embed',
    videoAuthStatus: 'signed',
    boundSessionId: sid,
    secureVideoExpiresAt: expires,
    normalizedVideoUrl: normalized,
  };
}

function normalizedEmbed({ libraryId, videoId }) {
  return `https://player.mediadelivery.net/embed/${libraryId}/${videoId}`;
}

// Verify a presented token against a session. Server-side check (e.g. before a
// proxy/gateway streams bytes). Constant-time compare on the HMAC.
export function verifySessionBoundMediaToken({ videoUrl, sessionId, expires, token, tokenKey } = {}) {
  const parsed = parseBunnyEmbed(videoUrl);
  if (!parsed) return { ok: false, reason: 'not_bunny_embed' };
  const sid = cleanText(sessionId);
  const key = cleanText(tokenKey ?? process.env.BUNNY_STREAM_TOKEN_KEY);
  if (!sid || !key) return { ok: false, reason: 'missing_session_or_key' };
  const exp = Number(expires);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) {
    return { ok: false, reason: 'expired' };
  }
  const expected = crypto.createHash('sha256').update(`${key}${parsed.videoId}${exp}${sid}`).digest('hex');
  const a = Buffer.from(cleanText(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'invalid_token' };
  try {
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid_token' };
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
  return { ok: true };
}

// ── DRM opt-in (per course) ──────────────────────────────────────────────────
// A course opts into DRM via a flag (e.g. a column or site_config key the admin
// sets). This module resolves the policy and returns a DRM descriptor the player
// uses; the actual license-server wiring is owner infra (provider config).
//
// drmPolicy is a simple resolver: given a course slug + a policy table, return
// whether DRM is required. The default policy is DRM OFF — opt-in only.
export function resolveDrmPolicy(courseSlug, policyTable = {}) {
  const slug = cleanText(courseSlug);
  if (!slug) return { drmRequired: false, reason: 'no_course' };
  const entry = policyTable[slug];
  if (!entry || !entry.drmRequired) {
    return { drmRequired: false, reason: 'drm_opt_in_disabled' };
  }
  return {
    drmRequired: true,
    scheme: entry.scheme || 'widevine', // widevine | fairplay | playready
    licenseServerUrl: entry.licenseServerUrl || null,
    reason: 'drm_opt_in_enabled',
  };
}

// v3-gated: sign for the current session only in v3. In v1/v2 the caller should
// fall back to the V1 600s signer (utils/lms.js signBunnyEmbedUrl).
export async function signMediaForV3Session({ videoUrl, sessionId, ttlSeconds, tokenKey }) {
  const mode = await getEffectiveMode();
  if (mode !== 'v3') {
    throw new Error(`v3-media: requires v3 mode, effective mode is ${mode}`);
  }
  return signSessionBoundMediaUrl({ videoUrl, sessionId, ttlSeconds, tokenKey });
}

export const _internals = { DEFAULT_MEDIA_TTL_SECONDS, normalizedEmbed };
