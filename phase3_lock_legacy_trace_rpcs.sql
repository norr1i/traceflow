-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 3: Lock legacy trace RPCs to authenticated callers only
-- TraceFlow Security Hardening
-- ══════════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- ───────
-- Phase 2 migrated the public /trace/[id] route to call ONLY
-- get_public_batch_trace(), which has its own SECURITY DEFINER allowlist
-- and deliberately exposes no sensitive fields.
--
-- The three RPCs below were the former public read boundary.  They are still
-- required by the authenticated /product-journey/[id] internal page
-- (ProductJourneyDetailClient.tsx, RootCausePanel.tsx), so they must remain
-- available to `authenticated` and `service_role` roles.  They must no longer
-- be reachable by the `anon` role, either through an explicit grant or through
-- the PostgreSQL default PUBLIC EXECUTE privilege that every new function
-- inherits when no REVOKE FROM PUBLIC has been issued.
--
-- SAFETY ORDERING (applied per function)
-- ───────────────────────────────────────
--   1. GRANT authenticated + service_role  — ensure internal callers are safe
--      before anything is revoked (no-op if grant already exists)
--   2. REVOKE FROM anon                    — remove explicit anon grant
--   3. REVOKE FROM PUBLIC                  — remove inherited PUBLIC execute
--
-- Authenticated product-journey callers are never interrupted: their grant is
-- ensured before the revoke fires.  The whole block runs inside one transaction
-- so the privilege state is atomic.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DO NOT TOUCH in this file:
--   public.get_public_batch_trace(uuid)  — new safe public boundary; already
--                                          has REVOKE FROM PUBLIC + GRANT TO anon
--   public.log_scan_event(...)           — anonymous scan-event logging
--   RLS policies                         — unchanged by this migration
--
-- RUN ORDER:
--   1. phase3_lock_legacy_trace_rpcs.sql         ← this file
--   2. verify_phase3_trace_rpc_privileges.sql
--   3. verify_get_public_batch_trace.sql
--   4. Manual smoke test: /trace/<uuid>          (logged-out / incognito)
--   5. Manual smoke test: /product-journey/<uuid> (authenticated session)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.  public.get_batch_trace(uuid)
--
--     Before: GRANT TO anon (explicit) + GRANT TO authenticated (explicit)
--             + implicit PUBLIC EXECUTE (no REVOKE FROM PUBLIC was ever issued)
--     After:  authenticated = true | service_role = true | anon = false | PUBLIC = false
-- ─────────────────────────────────────────────────────────────────────────────

GRANT  EXECUTE ON FUNCTION public.get_batch_trace(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_batch_trace(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_batch_trace(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_batch_trace(uuid) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2.  public.get_batch_journey(uuid)
--
--     Before: NO explicit grants at all — anon accessed via PostgreSQL default
--             PUBLIC EXECUTE only.  No authenticated grant existed.
--     After:  authenticated = true | service_role = true | anon = false | PUBLIC = false
--
--     IMPORTANT: GRANT runs before REVOKE so authenticated callers experience
--     zero downtime.  The product-journey page calls this RPC on every load.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT  EXECUTE ON FUNCTION public.get_batch_journey(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_batch_journey(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_batch_journey(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_batch_journey(uuid) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3.  public.get_root_cause_analysis(uuid)
--
--     Before: GRANT TO authenticated (explicit, no anon grant) +
--             implicit PUBLIC EXECUTE (no REVOKE FROM PUBLIC was ever issued)
--     After:  authenticated = true | service_role = true | anon = false | PUBLIC = false
-- ─────────────────────────────────────────────────────────────────────────────

GRANT  EXECUTE ON FUNCTION public.get_root_cause_analysis(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_root_cause_analysis(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_root_cause_analysis(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_root_cause_analysis(uuid) FROM PUBLIC;

COMMIT;
