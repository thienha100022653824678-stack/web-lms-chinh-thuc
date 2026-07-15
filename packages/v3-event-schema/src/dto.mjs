// packages/v3-event-schema/src/dto.mjs
// Canonical DTO shapes for the cross-repo contract. Each asserts (not just
// documents) the fields a producer must send, so a malformed payload fails at
// the boundary instead of producing a half-applied write downstream.

import { normalizeRuntimeVersion } from './runtime.mjs';

// Enrollment DTO — what Shop/Portal/LMS exchange when an enrollment changes.
export function enrollmentDto(input = {}) {
  const email = String(input.email || '').trim().toLowerCase();
  const courseSlug = String(input.course_slug || '').trim();
  if (!email || !courseSlug) {
    throw new Error('event-schema: enrollmentDto requires email + course_slug');
  }
  return Object.freeze({
    email,
    course_slug: courseSlug,
    status: String(input.status || 'active'),
    action: String(input.action || 'upserted'),
    runtime_version: normalizeRuntimeVersion(input.runtime_version),
  });
}

// Course DTO — public course surface (slug, title, image, publish state).
export function courseDto(input = {}) {
  const slug = String(input.slug || '').trim();
  if (!slug) throw new Error('event-schema: courseDto requires slug');
  return Object.freeze({
    slug,
    title: String(input.title || ''),
    image_url: String(input.image_url || ''),
    is_published: Boolean(input.is_published),
    expected_start_date: input.expected_start_date ?? null,
    runtime_version: normalizeRuntimeVersion(input.runtime_version),
  });
}

// Session/device telemetry DTO.
export function sessionEventDto(input = {}) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) throw new Error('event-schema: sessionEventDto requires email');
  return Object.freeze({
    email,
    course_slug: String(input.course_slug || '').trim() || null,
    event_type: String(input.event_type || ''),
    reason: String(input.reason || '') || null,
    runtime_version: normalizeRuntimeVersion(input.runtime_version),
  });
}
