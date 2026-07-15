// utils/v3-session.js
// V3 Phase 4 (②③) — unified opaque session + server-minted device credential.
//
// V1/V2 carry two session layers: a 30-day signed JWT-ish cookie
// (utils/lms.js createStudentSession) plus a 24h DB session guard, and they
// trust a client-declared localStorage device-id (SEC-11, spoofable). V3
// collapses this to ONE model:
//   - an OPAQUE session token (random, no claims) whose only authority is a
//     lookup into student_active_sessions/lms_verified_sessions. Revocation is
//     a row-status update, not waiting for a JWT to expire. Only the sha256
//     hash is stored (like lms_entry_tokens.token_hash).
//   - a SERVER-MINTED device credential: an HMAC over `${sessionId}.${deviceId}`
//     signed with the existing SESSION_SECRET. The client re-presents it via a
//     header; the server verifies the signature instead of trusting a declared
//     id. No new secret, no new dependency.
//
// v3-gated: entrypoints that depend on runtime config refuse unless
// getEffectiveMode()==='v3'. Pure crypto helpers are mode-independent so they
// can be unit-tested and reused during a canary dual-read.

import { getEffectiveMode } from './runtime-controller.js';
import { signSessionPayload, verifySessionToken, timingSafeStringEqual } from './lms-secrets.js';
import { generateSecureToken, hashToken } from './lms-session-guard.js';

const SESSION_COOKIE = 'course_session_token'; // same name; v3 stores an opaque value, not a JWT
const DEFAULT_IDLE_HOURS = 24;

// Issue an opaque session token. Returns the raw token (sent to the client once)
// and its sha256 hash (the only thing persisted).
export function issueSessionToken() {
  const token = generateSecureToken(32);
  return { token, tokenHash: hashToken(token) };
}

// Mint a server-side device credential bound to a session. The deviceId is
// server-generated (never client-declared); the credential is an HMAC the
// client cannot forge without SESSION_SECRET.
export function mintDeviceCredential(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('v3-session: sessionId is required to mint a device credential');
  const deviceId = `dev_${generateSecureToken(24)}`;
  const credential = signSessionPayload(`${sid}.${deviceId}`);
  return { deviceId, credential };
}

// Verify a device credential in constant time. Returns true only if the HMAC
// over `${sessionId}.${deviceId}` matches the presented credential.
export function verifyDeviceCredential(sessionId, deviceId, credential) {
  const sid = String(sessionId || '').trim();
  const did = String(deviceId || '').trim();
  const cred = String(credential || '').trim();
  if (!sid || !did || !cred) return false;
  const expected = signSessionPayload(`${sid}.${did}`);
  return timingSafeStringEqual(cred, expected);
}

// Build the session cookie string. httpOnly + Secure + SameSite=Lax, short
// max-age. maxAgeMs=0 clears it. Secure is dropped only under the explicit
// non-production insecure-local gate (mirrors utils/lms.js cookieOptions).
export function sessionCookie(token, maxAgeMs) {
  const parts = [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor((maxAgeMs || 0) / 1000))}`,
  ];
  const allowInsecure = String(process.env.LMS_ALLOW_INSECURE_COOKIE || '').trim() === '1';
  const isProduction =
    String(process.env.NODE_ENV || '').toLowerCase() === 'production' ||
    String(process.env.VERCEL_ENV || '').toLowerCase() === 'production';
  if (isProduction || !allowInsecure) parts.push('Secure');
  return parts.join('; ');
}

// Sliding-window expiry: past the idle window the session is expired; otherwise
// refresh last_seen to now. Pure — the caller persists refreshAt.
export function slidingExpiry(lastSeenIso, idleHours = DEFAULT_IDLE_HOURS, nowMs = null) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const idleMs = idleHours * 60 * 60 * 1000;
  const lastSeen = lastSeenIso ? new Date(lastSeenIso).getTime() : NaN;
  const expired = !Number.isFinite(lastSeen) || now - lastSeen > idleMs;
  return { expired, refreshAt: new Date(now).toISOString() };
}

// v3-gated wrapper: mint a full session bundle (token + hash + device
// credential) for a freshly authenticated session. Refuses outside v3 mode so
// V1/V2 continue using their own session path.
export async function beginV3Session(sessionId) {
  const mode = await getEffectiveMode();
  if (mode !== 'v3') {
    throw new Error(`v3-session: requires v3 mode, effective mode is ${mode}`);
  }
  const { token, tokenHash } = issueSessionToken();
  const { deviceId, credential } = mintDeviceCredential(sessionId);
  return { token, tokenHash, deviceId, credential };
}

export const _internals = { SESSION_COOKIE, DEFAULT_IDLE_HOURS, verifySessionToken };
