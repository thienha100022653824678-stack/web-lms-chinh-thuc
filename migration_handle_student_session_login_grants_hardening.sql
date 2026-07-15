-- RP2-B0 additive grant hardening.
-- This migration does not change the function body or signature.
-- The trusted Portal backend calls this RPC with service_role.
-- PUBLIC, anon, and authenticated do not need direct EXECUTE access.
-- V1-safe and idempotent in its final privilege state.
-- Rollback must be performed through a new migration, not by editing
-- this migration after it has been applied.

BEGIN;

REVOKE ALL ON FUNCTION public.handle_student_session_login(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.handle_student_session_login(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) FROM anon;

REVOKE ALL ON FUNCTION public.handle_student_session_login(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.handle_student_session_login(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) TO service_role;

COMMIT;
