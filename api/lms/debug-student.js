import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  const secret = req.headers['x-debug-secret'];
  // Use a simple temporary key - will be deleted right after diagnosis
  if (secret !== 'debug-lms-2026-07') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'email param required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  const [enrollResult, orderResult] = await Promise.all([
    supabase
      .from('student_enrollments')
      .select('email, course_slug, status, drive_permission_status, created_at')
      .ilike('email', cleanEmail),
    supabase
      .from('orders')
      .select('customer_email, course_slug, course_title, status, created_at')
      .ilike('customer_email', `%${cleanEmail}%`)
  ]);

  const [sampleEnrollResult, courseResult] = await Promise.all([
    supabase.from('student_enrollments').select('email, course_slug, status').limit(3),
    supabase.from('courses').select('id, slug, title, active, is_published').limit(3),
  ]);

  res.json({
    supabase_url_prefix: process.env.SUPABASE_URL?.slice(0, 40) || 'NOT_SET',
    checked_email: cleanEmail,
    enrollments: enrollResult.data || [],
    enrollment_error: enrollResult.error?.message || null,
    orders: orderResult.data || [],
    order_error: orderResult.error?.message || null,
    sample_enrollments: sampleEnrollResult.data || [],
    sample_courses: courseResult.data || [],
  });
}
