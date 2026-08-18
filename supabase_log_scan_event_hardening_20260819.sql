-- ============================================================
-- TraceFlow — log_scan_event + scan_events security hardening
-- Applied to live Supabase database: 2026-08-19
-- ============================================================
-- AUTHORITATIVE RECORD.
-- This file represents the current live hardened state.
-- It is idempotent and safe to re-run.
--
-- Supersedes (do NOT re-run those files standalone):
--   • supabase_log_scan_event.sql     — pre-hardening body
--   • supabase_scan_events_security.sql — recreates public_scan_insert
--   • supabase_multitenancy_migration.sql — permissive WITH CHECK (true)
--
-- Live verification completed 2026-08-19:
--   • RLS already enabled on scan_events (relrowsecurity = true)
--   • Smoke test passed: mobile Safari QR scan created correct row
--   • All V1–V5 post-migration verification queries confirmed PASS
--
-- Changes applied (in order):
--   1. New composite index (batch_id, scanned_at) for rate guard query
--   2. Revoke all direct table grants from anon on scan_events
--   3. Revoke write/admin grants from authenticated on scan_events
--   4. Drop public_scan_insert policy if it still exists
--   5. Replace log_scan_event body with hardened version:
--        - p_device_type server-side cap: LEFT(..., 20)
--        - p_browser server-side cap: LEFT(..., 50)
--        - p_user_agent server-side cap: LEFT(..., 300)  [was already present]
--        - rate guard: max 10 inserts per batch per 60 seconds
--   6. Revoke implicit PUBLIC execute from log_scan_event
--   7. Re-grant explicit EXECUTE to anon and authenticated only
--
-- HOW TO RUN (only if applying to a fresh database — live DB already done)
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

BEGIN;

-- ── 1. Composite index for the 60-second rate guard ──────────────────
-- Supports: WHERE batch_id = p_batch_id AND scanned_at > now() - '60s'
-- The existing idx_scan_events_batch (batch_id) is preserved separately.
CREATE INDEX IF NOT EXISTS idx_scan_events_batch_time
  ON public.scan_events (batch_id, scanned_at);

-- ── 2. Revoke all direct table grants from anon on scan_events ────────
-- log_scan_event is SECURITY DEFINER (runs as postgres).
-- anon requires no direct table access for the write path to work.
REVOKE ALL ON TABLE public.scan_events FROM anon;

-- ── 3. Revoke write/admin grants from authenticated on scan_events ────
-- All authenticated writes go through SECURITY DEFINER RPCs.
-- SELECT is preserved — required by the co_scan_read RLS policy.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON TABLE public.scan_events FROM authenticated;

-- ── 4. Drop public_scan_insert policy if it exists ────────────────────
-- The SECURITY DEFINER function is the only sanctioned insert path.
-- An INSERT RLS policy for anon alongside the function is redundant
-- and widens the attack surface unnecessarily.
DROP POLICY IF EXISTS "public_scan_insert" ON public.scan_events;

-- ── 5. Hardened log_scan_event function body ─────────────────────────
-- NOTE: CREATE OR REPLACE preserves the existing ACL (PostgreSQL docs).
-- The REVOKE FROM PUBLIC in step 6 removes the pre-existing excess grant.
CREATE OR REPLACE FUNCTION public.log_scan_event(
  p_batch_id    uuid,
  p_device_type text DEFAULT NULL,
  p_browser     text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM   production_orders
  WHERE  id = p_batch_id
  LIMIT  1;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM   scan_events
    WHERE  batch_id   = p_batch_id
      AND  scanned_at > now() - interval '60 seconds'
  ) >= 10 THEN
    RETURN;
  END IF;

  INSERT INTO scan_events (
    batch_id,
    company_id,
    scanned_at,
    device_type,
    browser,
    user_agent
  )
  VALUES (
    p_batch_id,
    v_company_id,
    now(),
    LEFT(COALESCE(p_device_type, ''), 20),
    LEFT(COALESCE(p_browser,     ''), 50),
    LEFT(COALESCE(p_user_agent,  ''), 300)
  );
END;
$$;

-- ── 6. Remove pre-existing implicit PUBLIC execute grant ──────────────
-- Live Q1 confirmed public_execute = true before this migration ran.
-- PostgreSQL CREATE OR REPLACE preserves the existing ACL, so the
-- PUBLIC grant was not introduced by step 5 — it is a pre-existing
-- excess privilege being explicitly removed here.
REVOKE ALL ON FUNCTION
  public.log_scan_event(uuid, text, text, text)
  FROM PUBLIC;

-- ── 7. Explicit EXECUTE grants to anon and authenticated only ─────────
GRANT EXECUTE ON FUNCTION
  public.log_scan_event(uuid, text, text, text)
  TO anon;

GRANT EXECUTE ON FUNCTION
  public.log_scan_event(uuid, text, text, text)
  TO authenticated;

-- service_role inherits superuser-equivalent access; no explicit grant needed.

COMMIT;
